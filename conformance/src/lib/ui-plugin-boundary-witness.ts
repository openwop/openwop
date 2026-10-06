/**
 * The front-end plugin boundary (RFC 0238; `spec/v2/core/packs.md` §Front-end
 * plugin packs), observed through the two `uiPlugins.served` operations against
 * the operator-installed `ui-plugin-pack-narrow` fixture.
 *
 * Two halves, as in the other shared witnesses: `observe*` assert nothing and
 * return what the host answered (or why it could not be read); the `judge*`
 * functions are pure and return findings. The scenario maps findings to
 * requirement ids.
 */

import { findCanaryLeaks } from './canaries.js';
import { driver, type OpenWOPResponse } from './driver.js';
import { v2Discovery } from './v2.js';

export const FIXTURE_PACK = 'core.openwop.conformance.ui-plugin-narrow';
export const FIXTURE_PLUGIN = 'narrow';
export const FIXTURE_ARTIFACT = 'ui-plugin-narrow-artifact';

export const framePath = (pack = FIXTURE_PACK, plugin = FIXTURE_PLUGIN): string =>
  `/host/ui-plugins/${encodeURIComponent(pack)}/${encodeURIComponent(plugin)}/frame`;
export const rpcPath = (pack = FIXTURE_PACK, plugin = FIXTURE_PLUGIN): string =>
  `/host/ui-plugins/${encodeURIComponent(pack)}/${encodeURIComponent(plugin)}/rpc`;

/** A Content-Security-Policy header as directive → source/token list (names lower-cased). */
export function parseCsp(header: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of (header ?? '').split(';')) {
    const [name, ...tokens] = part.trim().split(/\s+/).filter(Boolean);
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), tokens);
  }
  return out;
}

/** §B.3 — the `sandbox` directive admits `allow-scripts` and never `allow-same-origin`. */
export function judgeIsolation(csp: string | null): string[] {
  const p = parseCsp(csp);
  const sandbox = p.get('sandbox');
  if (sandbox === undefined) return [`the frame's Content-Security-Policy carries no sandbox directive (got ${JSON.stringify(csp)})`];
  const out: string[] = [];
  const tokens = sandbox.map((t) => t.toLowerCase());
  if (tokens.includes('allow-same-origin')) out.push('the sandbox directive admits allow-same-origin, so the plugin shares the host origin');
  if (!tokens.includes('allow-scripts')) out.push('the sandbox directive does not admit allow-scripts, so the plugin cannot run');
  return out;
}

/** §B.4 — `default-src 'none'`, and no `connect-src` source beyond the declared `connectSrc`. */
export function judgeEgress(csp: string | null, declared: readonly string[] = []): string[] {
  const p = parseCsp(csp);
  const out: string[] = [];
  const def = p.get('default-src');
  if (def === undefined || def.length !== 1 || def[0] !== "'none'") out.push(`default-src MUST be 'none' (got ${def === undefined ? 'no default-src' : def.join(' ')})`);
  const connect = (p.get('connect-src') ?? []).filter((s) => s !== "'none'");
  const extra = connect.filter((s) => !declared.includes(s));
  if (extra.length) out.push(`connect-src admits ${extra.join(' ')}, which the plugin did not declare`);
  return out;
}

export interface RpcReply { readonly status: number; readonly json: unknown; readonly text: string }

/** One `ui-plugin/1` request envelope. */
export const request = (id: number, method: string, params?: Record<string, unknown>): Record<string, unknown> =>
  ({ openwop: 'ui-plugin/1', type: 'request', id, method, ...(params ? { params } : {}) });

const field = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);

/**
 * §C.4 — a method the plugin did not declare (or the host does not allow) is
 * refused inside a `200` with `method_not_allowed`, never executed.
 */
export function judgeRefused(method: string, r: RpcReply): string[] {
  const code = field(field(r.json, 'error'), 'code');
  if (r.status === 200 && field(r.json, 'ok') === false && code === 'method_not_allowed') return [];
  return [`${method}: a method outside the allowlists MUST return 200 with ok:false and method_not_allowed; got ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`];
}

/** §C.2 — a method outside the closed `ui-plugin/1` enum fails validation: `400`, never executed. */
export function judgeInvalid(method: string, r: RpcReply): string[] {
  if (r.status === 400) return [];
  if (r.status === 200 && field(r.json, 'ok') === false) return [];
  return [`${method}: a request outside the ui-plugin/1 method enum MUST NOT execute; got ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`];
}

/** The control: the one declared method succeeds on the fixture artifact. */
export function judgeControl(r: RpcReply): string[] {
  if (r.status === 200 && field(r.json, 'ok') === true) return [];
  return [`artifact.read of ${FIXTURE_ARTIFACT}, the plugin's one declared method, MUST succeed; got ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`];
}

/** §C.6 — no response carries the BYOK canary. */
export function judgeNoCanary(replies: readonly RpcReply[]): string[] {
  const out: string[] = [];
  for (const r of replies) for (const leak of findCanaryLeaks(r.text)) out.push(`a dispatch response carries canary material (${leak.label})`);
  return out;
}

// ------------------------------------------------------------------ the legs
// Each leg observes through the suite driver and returns findings or the reason it
// could not run, so the scenario and the self-test double run the same code.


export type Skip = { readonly kind: 'skip'; readonly skip: 'blocked' | 'inapplicable'; readonly reason: string };
export type LegOutcome = { readonly kind: 'observed'; readonly findings: string[] } | Skip;

const skip = (s: 'blocked' | 'inapplicable', reason: string): Skip => ({ kind: 'skip', skip: s, reason });
const NOT_INSTALLED = "the ui-plugin-pack-narrow fixture is not installed (404); installing it is the operator's choice (RFC 0238 §D)";

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

async function gate(): Promise<{ isolation: string } | Skip> {
  let doc: Record<string, unknown> | null = null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return skip('blocked', 'v2 discovery unreachable');
  const fam = doc['uiPlugins'] as { served?: unknown; isolation?: unknown } | undefined;
  if (!fam || fam.served !== true) return skip('inapplicable', 'the host does not advertise uiPlugins.served');
  return { isolation: typeof fam.isolation === 'string' ? fam.isolation : 'cross-origin-iframe' };
}

async function frameCsp(): Promise<{ csp: string | null } | Skip> {
  const r = await http(() => driver.get(framePath()));
  if (r === null) return skip('blocked', 'GET …/frame could not be made');
  if (r.status === 404) return skip('inapplicable', NOT_INSTALLED);
  if (r.status !== 200) return skip('blocked', `GET …/frame answered ${r.status}`);
  return { csp: r.headers.get('content-security-policy') };
}

async function rpc(id: number, method: string, params?: Record<string, unknown>): Promise<RpcReply | null> {
  const r = await http(() => driver.post(rpcPath(), { message: request(id, method, params) }));
  return r === null ? null : { status: r.status, json: r.json, text: r.text };
}

/** §B.3, `openwop.requirement.0238.ui-plugin.frame-isolated`. */
export async function isolationLeg(): Promise<LegOutcome> {
  const g = await gate();
  if ('kind' in g) return g;
  if (g.isolation !== 'cross-origin-iframe') return skip('inapplicable', `uiPlugins.isolation is ${g.isolation}: only a cross-origin-iframe boundary is visible over HTTP (RFC 0238 §Decisions 3)`);
  const f = await frameCsp();
  return 'kind' in f ? f : { kind: 'observed', findings: judgeIsolation(f.csp) };
}

/** §B.4, `openwop.requirement.0238.ui-plugin.frame-deny-egress`. */
export async function egressLeg(): Promise<LegOutcome> {
  const g = await gate();
  if ('kind' in g) return g;
  const f = await frameCsp();
  return 'kind' in f ? f : { kind: 'observed', findings: judgeEgress(f.csp) };
}

/** §C.2/§C.4, `openwop.requirement.0238.ui-plugin.rpc-allowlist`. */
export async function allowlistLeg(): Promise<LegOutcome> {
  const g = await gate();
  if ('kind' in g) return g;
  const control = await rpc(1, 'artifact.read', { artifactId: FIXTURE_ARTIFACT });
  if (control === null) return skip('blocked', 'POST …/rpc could not be made');
  if (control.status === 404) return skip('inapplicable', NOT_INSTALLED);
  const findings = [...judgeControl(control)];
  for (const [id, method, params] of [[2, 'artifact.write', { artifactId: FIXTURE_ARTIFACT, content: 'openwop-conformance' }], [3, 'host.navigate', { to: '/' }]] as const) {
    const r = await rpc(id, method, params);
    if (r === null) return skip('blocked', `the ${method} dispatch could not be made`);
    findings.push(...judgeRefused(method, r));
  }
  const exec = await rpc(4, 'host.exec');
  if (exec === null) return skip('blocked', 'the host.exec dispatch could not be made');
  findings.push(...judgeInvalid('host.exec', exec));
  return { kind: 'observed', findings };
}

/** §C.6, `openwop.requirement.0238.ui-plugin.no-byok`. */
export async function noByokLeg(): Promise<LegOutcome> {
  const g = await gate();
  if ('kind' in g) return g;
  const replies: RpcReply[] = [];
  for (const [id, method] of [[1, 'artifact.read'], [2, 'artifact.write']] as const) {
    const r = await rpc(id, method, { artifactId: FIXTURE_ARTIFACT });
    if (r === null) return skip('blocked', `the ${method} dispatch could not be made`);
    if (r.status === 404) return skip('inapplicable', NOT_INSTALLED);
    replies.push(r);
  }
  return { kind: 'observed', findings: judgeNoCanary(replies) };
}
