/**
 * RFC 0208 §A/§B — the host as an MCP 2026-07-28 server, held to the `mcp.*`
 * rows of `spec/v2/interop-map.json` (`spec/v2/core/interop.md` §"The
 * operation mappings"). Target major 2.
 *
 * Gate: the v2 `mcp` record carries `serverMount` and lists profile
 * `mcp-2026-07-28`. The mount is `mcp.serverUrls[0]` (an absolute URL, or a
 * path joined to the base URL); a host that advertises a mount with no URL is
 * `blocked`, never a silent return. A host advertising `mcp` for its client
 * path only is `inapplicable`.
 *
 * Tools (a suite requirement, `conformance/fixtures.md`, not a spec MUST): each
 * advertised fixture the legs call — `conformance-noop`, `conformance-failure`,
 * `conformance-approval` — is exposed as a tool under its workflowId.
 *
 * The v1 host-as-server legs (`mcp-2026-07-28-discover`, `mcp-stateless-request`,
 * `mcp-mrtr-roundtrip` server half, `mcp-cache-tenant-scope`,
 * `mcp-extension-opacity` server half, `mcp-current-auth-boundary`) are ported
 * here as v2 twins: they cannot join `BOTH_MAJORS`, because they gate on v1
 * `.supported` seats that do not exist at major 2.
 *
 * @see spec/v2/core/interop.md §"The operation mappings"
 * @see spec/v2/interop-map.json mcp.features / methods / headers / meta / mrtr / cache / authorization
 * @see RFCS/0208-v2-a2a-mcp-operation-mappings.md §A, §B
 * @see RFCS/0199-outbound-oauth-client-and-credential-interrupt.md §D.2 (the URL-mode and form-mode legs; interop-map.json mcp.mrtr InputRequiredResult (host as server))
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { loadEnv } from '../lib/env.js';
import { softSkip } from '../lib/soft-skip.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { SEAMS_PREFIX } from '../lib/seams.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'the suite is the MCP client: every leg POSTs JSON-RPC to the mount the host advertises in mcp.serverUrls; nothing harness-hosted is handed to the host';

const DOC = 'spec/v2/core/interop.md §"The operation mappings" (RFC 0208)';
const PROFILE = 'mcp-2026-07-28';
const REV = '2026-07-28';
const R = (slug: string): string => `openwop.requirement.0208.${slug}`;
const META_V = 'io.modelcontextprotocol/protocolVersion';
const META_C = 'io.modelcontextprotocol/clientCapabilities';
const ERR = { HEADER_MISMATCH: -32020, MISSING_CAPABILITY: -32021, UNSUPPORTED_VERSION: -32022, INVALID_PARAMS: -32602 } as const;

const MAP = JSON.parse(readFileSync(join(SCHEMAS_DIR, '..', 'spec', 'v2', 'interop-map.json'), 'utf8')) as { mcp: { features: Array<{ id: string; requiredFor: string[] }> } };
// `interruptId` is host-minted and tenant-bound (`<tenant>/<opaque>`); `nodeId` is author-chosen
// inside a workflow definition and carries no `/`, so the two grammars cannot both admit one string.
const INTERRUPT_ID = new RegExp((JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'ids.schema.json'), 'utf8')) as { $defs: { interruptId: { pattern: string } } }).$defs.interruptId.pattern);
const REQUIRED_FEATURES = MAP.mcp.features.filter((f) => f.requiredFor.includes(PROFILE)).map((f) => f.id).sort();

interface RpcError { code: number; message?: string; data?: Record<string, unknown> }
interface Rpc { status: number; headers: Headers; result?: Record<string, unknown> | undefined; error?: RpcError | undefined }
type Mount = { ok: true; url: string; facet: Record<string, unknown> } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };

async function mount(): Promise<Mount> {
  if (!(await v2Discovery())) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const facet = await familyAdvertised('mcp');
  if (!facet) return { ok: false, kind: 'inapplicable', reason: 'mcp not advertised at major 2' };
  const profiles = Array.isArray(facet['profiles']) ? (facet['profiles'] as unknown[]) : [];
  if (facet['serverMount'] === undefined || !profiles.includes(PROFILE)) return { ok: false, kind: 'inapplicable', reason: 'mcp is advertised without serverMount + profile mcp-2026-07-28 — the host serves no MCP mount (client path only)' };
  const urls = Array.isArray(facet['serverUrls']) ? (facet['serverUrls'] as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
  if (urls.length === 0) return { ok: false, kind: 'blocked', reason: 'mcp.serverMount is advertised with no mcp.serverUrls[0] — the mount is unaddressable' };
  const u = urls[0]!;
  return { ok: true, url: /^https?:\/\//i.test(u) ? u : `${loadEnv().baseUrl}${u.startsWith('/') ? '' : '/'}${u}`, facet };
}
const skip = (m: Exclude<Mount, { ok: true }>): undefined => softSkip(m.kind, m.reason);

interface CallOpts { version?: string | null; bodyVersion?: string | null; mcpMethod?: string | null; mcpName?: string; caps?: Record<string, unknown>; bearer?: string | null; extraMeta?: Record<string, unknown>; headers?: Record<string, string> }
async function call(url: string, method: string, params: Record<string, unknown>, o: CallOpts = {}): Promise<Rpc> {
  const version = o.version === undefined ? REV : o.version;
  const bodyVersion = o.bodyVersion === undefined ? version : o.bodyVersion;
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(o.headers ?? {}) };
  if (version !== null) headers['MCP-Protocol-Version'] = version;
  const mcpMethod = o.mcpMethod === undefined ? method : o.mcpMethod;
  if (mcpMethod !== null) headers['Mcp-Method'] = mcpMethod;
  if (o.mcpName !== undefined) headers['Mcp-Name'] = o.mcpName;
  const bearer = o.bearer === undefined ? loadEnv().apiKey : o.bearer;
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  const meta: Record<string, unknown> = { [META_C]: o.caps ?? {}, ...(o.extraMeta ?? {}) };
  if (bodyVersion !== null) meta[META_V] = bodyVersion;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method, params: { ...params, _meta: meta } }) });
  const body = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: RpcError };
  return { status: res.status, headers: res.headers, ...body };
}
const toolCall = (url: string, name: string, extra: Record<string, unknown> = {}, o: CallOpts = {}): Promise<Rpc> => call(url, 'tools/call', { name, arguments: {}, ...extra }, { mcpName: name, ...o });

function needFixtures(ids: string[]): string | null {
  const missing = ids.filter((id) => !isFixtureAdvertised(id));
  return missing.length === 0 ? null : `fixture(s) ${missing.join(', ')} not in the advertised fixtures[] — the leg calls them as tools`;
}

describe('RFC 0208 — v2-mcp-mount-map (host as MCP 2026-07-28 server, gated on mcp.serverMount + profile)', () => {
  it('a host claiming mcp-2026-07-28 lists every feature the map requires for it', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    const features = Array.isArray(m.facet['features']) ? (m.facet['features'] as unknown[]).map(String) : [];
    expect(REQUIRED_FEATURES.filter((f) => !features.includes(f)), req(R('mcp-features-required'), 'interop.md §"The operation mappings"; interop-map.json mcp.features requiredFor', `a host advertising ${PROFILE} MUST list every feature the map requires for it (${REQUIRED_FEATURES.join(', ')}); advertised [${features.join(', ')}]`)).toEqual([]);
  });

  it('server/discover supportedVersions equals mcp.revisions, with resultType and cache hints', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    const r = await call(m.url, 'server/discover', {});
    expect(r.error, req(R('mcp-discover-revisions'), 'interop-map.json mcp.methods server/discover', `server/discover MUST be served (feature server-discover): ${r.status} ${JSON.stringify(r.error)}`)).toBeUndefined();
    const revisions = (Array.isArray(m.facet['revisions']) ? (m.facet['revisions'] as string[]) : []).slice().sort();
    expect([...((r.result?.['supportedVersions'] as string[] | undefined) ?? [])].sort(), req(R('mcp-discover-revisions'), 'interop-map.json mcp.methods server/discover', 'supportedVersions[] MUST equal mcp.revisions — two documents, one fact')).toEqual(revisions);
    expect(r.result?.['resultType'], req(R('mcp-discover-revisions'), 'interop-map.json mcp.features cacheable-lists', 'a current-revision result carries resultType complete')).toBe('complete');
    expect(typeof r.result?.['ttlMs'], req(R('mcp-discover-revisions'), 'interop-map.json mcp.features cacheable-lists', 'server/discover is cacheable: ttlMs')).toBe('number');
    expect(['public', 'private'], req(R('mcp-discover-revisions'), 'interop-map.json mcp.cache cacheScope', 'cacheScope is public | private')).toContain(r.result?.['cacheScope']);
  });

  it('header/body disagreement fails closed -32020 before version selection; an unsupported revision is -32022', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    const id = R('mcp-header-body-consistent');
    const mismatch = await call(m.url, 'tools/list', {}, { version: REV, bodyVersion: '2025-06-18' });
    expect([mismatch.status, mismatch.error?.code], req(id, 'interop-map.json mcp.headers MCP-Protocol-Version', `MCP-Protocol-Version ≠ _meta protocolVersion MUST be 400 HeaderMismatchError -32020, checked before version selection (got ${mismatch.status} ${JSON.stringify(mismatch.error)})`)).toEqual([400, ERR.HEADER_MISMATCH]);
    const method = await call(m.url, 'tools/list', {}, { mcpMethod: 'resources/list' });
    expect([method.status, method.error?.code], req(id, 'interop-map.json mcp.headers Mcp-Method | Mcp-Name', `Mcp-Method ≠ method MUST fail closed 400 -32020 (got ${method.status} ${JSON.stringify(method.error)})`)).toEqual([400, ERR.HEADER_MISMATCH]);
    const name = await call(m.url, 'tools/call', { name: 'conformance-noop', arguments: {} }, { mcpName: 'not-conformance-noop' });
    expect([name.status, name.error?.code], req(id, 'interop-map.json mcp.headers Mcp-Method | Mcp-Name', `Mcp-Name ≠ params.name MUST fail closed 400 -32020 (got ${name.status} ${JSON.stringify(name.error)})`)).toEqual([400, ERR.HEADER_MISMATCH]);
    const unsupported = await call(m.url, 'tools/list', {}, { version: '1999-01-01' });
    expect([unsupported.status, unsupported.error?.code], req(id, 'interop-map.json mcp.methods server/discover', `a revision outside mcp.revisions MUST be refused 400 -32022 (got ${unsupported.status} ${JSON.stringify(unsupported.error)})`)).toEqual([400, ERR.UNSUPPORTED_VERSION]);
    expect(Array.isArray(unsupported.error?.data?.['supported']), req(id, 'interop-map.json mcp.methods server/discover', 'the refusal lists data.supported[]')).toBe(true);
  });

  it('tools/list needs no initialize and no session; results carry cache hints and agree across requests', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    const id = R('mcp-stateless');
    const a = await call(m.url, 'tools/list', {});
    expect(a.error, req(id, 'interop-map.json mcp.methods initialize | Mcp-Session-Id', `a current-profile request MUST NOT require initialize or a session: ${a.status} ${JSON.stringify(a.error)}`)).toBeUndefined();
    expect(a.status, req(id, 'interop-map.json mcp.methods tools/list', 'tools/list answers 200')).toBe(200);
    expect(a.result?.['resultType'], req(id, 'interop-map.json mcp.features cacheable-lists', 'resultType complete')).toBe('complete');
    expect(typeof a.result?.['ttlMs'] === 'number' && (a.result['ttlMs'] as number) >= 0, req(id, 'interop-map.json mcp.features cacheable-lists', 'tools/list MUST carry ttlMs >= 0')).toBe(true);
    expect(['public', 'private'], req(id, 'interop-map.json mcp.cache cacheScope', 'tools/list MUST carry cacheScope')).toContain(a.result?.['cacheScope']);
    const names = ((a.result?.['tools'] as Array<{ name?: string }> | undefined) ?? []).map((t) => String(t.name));
    expect(names, req(id, 'interop-map.json mcp.methods tools/list', 'the tool list is sorted by name')).toEqual([...names].sort());
    const b = await call(m.url, 'tools/list', {});
    expect(JSON.stringify(b.result?.['tools']), req(id, 'interop-map.json mcp.methods tools/list', 'tools/list MUST be identical for every connection of one caller')).toBe(JSON.stringify(a.result?.['tools']));
  });

  it('tools/call answers a completed run isError false and a failed run isError true, never a JSON-RPC error', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    const missing = needFixtures(['conformance-noop', 'conformance-failure']);
    if (missing) return softSkip('blocked', missing);
    const ok = await toolCall(m.url, 'conformance-noop');
    expect(ok.error, req(R('mcp-tool-outcome'), 'interop-map.json mcp.methods tools/call', `tools/call on a completing workflow MUST answer a result: ${JSON.stringify(ok.error)}`)).toBeUndefined();
    expect([ok.result?.['resultType'], ok.result?.['isError']], req(R('mcp-tool-outcome'), 'interop-map.json mcp.methods tools/call', 'completed is CallToolResult isError false')).toEqual(['complete', false]);
    const bad = await toolCall(m.url, 'conformance-failure');
    expect(bad.error, req(R('mcp-tool-outcome'), 'interop-map.json mcp.methods tools/call', `a failed run MUST be a CallToolResult, not a JSON-RPC error (got ${JSON.stringify(bad.error)})`)).toBeUndefined();
    expect(bad.result?.['isError'], req(R('mcp-tool-outcome'), 'interop-map.json mcp.methods tools/call', 'failed is CallToolResult isError true')).toBe(true);
    const invalid = await call(m.url, 'tools/call', { name: 'conformance-noop', arguments: 'not-an-object' }, { mcpName: 'conformance-noop' });
    expect(invalid.error?.code, req(R('mcp-tool-outcome'), 'interop-map.json mcp.methods tools/call', `arguments are validated against inputSchema before any run is created (else -32602); got ${JSON.stringify(invalid.error ?? invalid.result)}`)).toBe(ERR.INVALID_PARAMS);
  });

  it('a run started by tools/call records run.started.transport mcp', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    const missing = needFixtures(['conformance-noop']);
    if (missing) return softSkip('blocked', missing);
    if (!(await familyAdvertised('runList'))) return softSkip('inapplicable', 'runList not advertised — the suite has no black-box way to find the run a tools/call started');
    const list = async (): Promise<string[]> => {
      const r = await driver.get('/runs?workflowId=conformance-noop&limit=50');
      return ((r.json as { runs?: Array<{ runId?: string }> } | undefined)?.runs ?? []).map((x) => String(x.runId));
    };
    const before = new Set(await list());
    const ok = await toolCall(m.url, 'conformance-noop');
    const fresh = (await list()).filter((x) => !before.has(x));
    expect(fresh.length, req(R('mcp-run-transport'), 'interop-map.json mcp.methods tools/call', `tools/call MUST start a run (v2Operation createRun) that listRuns shows the same Subject (got ${fresh.length} new run(s); result ${JSON.stringify(ok.error ?? ok.result)})`)).toBeGreaterThanOrEqual(1);
    // WHICH new run is ours (2.42.1). The leg counted `fresh.length === 1`, but
    // the suite runs files concurrently and conformance-noop is every file's
    // smallest run, so a sibling's run landed in the same window: the v2
    // reference host's CI (4 workers) failed "got 2 new run(s)" on a host whose
    // own tools/call started exactly one, and `fresh[0]` could have been the
    // sibling's run, read for the wrong transport. Ours is the runId the result
    // names when it names one listRuns shows, else the only new run; when the
    // window stays ambiguous, the requirement holds if any new run started mcp.
    const named = ((): string | null => {
      const m = /"runId"\s*:\s*"([^"]+)"/.exec(JSON.stringify(ok.result ?? ''));
      return m && fresh.includes(m[1]!) ? m[1]! : null;
    })();
    const transportOf = async (runId: string): Promise<string | undefined> => {
      const poll = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
      return ((poll.json as { events?: Array<{ type?: string; payload?: { transport?: string } }> } | undefined)?.events ?? []).find((e) => e.type === 'run.started')?.payload?.transport;
    };
    const ours = named ?? (fresh.length === 1 ? fresh[0]! : null);
    const transports = ours !== null ? [await transportOf(ours)] : await Promise.all(fresh.map(transportOf));
    expect(transports.includes('mcp') ? 'mcp' : transports[0], req(R('mcp-run-transport'), 'interop-map.json mcp.methods tools/call; runs.md run.started', `the run starts with run.started.transport mcp (${ours !== null ? `run ${ours}` : `${fresh.length} runs started in the window, none named by the result`}; transports ${JSON.stringify(transports)})`)).toBe('mcp');
  });

  it('a suspending tool answers InputRequiredResult; the retry resolves it; requestState is single use and forgery-proof', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    const missing = needFixtures(['conformance-approval']);
    if (missing) return softSkip('blocked', missing);
    const id = R('mcp-mrtr-server');
    const TOOL = 'conformance-approval';
    const caps = { elicitation: {} };
    const noCap = await toolCall(m.url, TOOL);
    expect(noCap.error?.code, req(id, 'interop-map.json mcp.meta clientCapabilities', `a request that needs elicitation but did not declare it MUST be MissingRequiredClientCapabilityError -32021, never assumed (got ${JSON.stringify(noCap.error ?? noCap.result)})`)).toBe(ERR.MISSING_CAPABILITY);
    const first = await toolCall(m.url, TOOL, {}, { caps });
    expect(first.result?.['resultType'], req(id, 'interop-map.json mcp.mrtr InputRequiredResult (host as server)', `a run reaching waiting-approval MUST answer the in-flight tools/call with InputRequiredResult (got ${JSON.stringify(first.error ?? first.result)})`)).toBe('input_required');
    const requests = (first.result?.['inputRequests'] ?? {}) as Record<string, { method?: string }>;
    const key = Object.keys(requests)[0];
    expect(key !== undefined && requests[key]?.method === 'elicitation/create', req(id, 'interop-map.json mcp.mrtr InputRequiredResult (host as server)', 'inputRequests carries { <interruptId>: elicitation/create }')).toBe(true);
    const state = first.result?.['requestState'];
    expect(typeof state, req(id, 'interop-map.json mcp.mrtr requestState (host as server)', 'a requestState accompanies the input request')).toBe('string');
    const retry = await toolCall(m.url, TOOL, { requestState: state, inputResponses: { [key!]: { action: 'accept', content: { action: 'accept' } } } }, { caps });
    expect([retry.error, retry.result?.['resultType'], retry.result?.['isError']], req(id, 'interop-map.json mcp.mrtr inputResponses[key] (host as server)', `ElicitResult accept resumes the run to completion (got ${JSON.stringify(retry.error ?? retry.result)})`)).toEqual([undefined, 'complete', false]);
    const again = await toolCall(m.url, TOOL, { requestState: state, inputResponses: { [key!]: { action: 'accept', content: { action: 'accept' } } } }, { caps });
    expect(again.error !== undefined || again.status >= 400, req(id, 'interop-map.json mcp.mrtr requestState (host as server)', `requestState is single use: a second retry with it MUST fail (got ${again.status} ${JSON.stringify(again.result)})`)).toBe(true);
    const forged = await toolCall(m.url, TOOL, { requestState: `${String(state)}x`, inputResponses: { [key!]: { action: 'accept', content: { action: 'accept' } } } }, { caps });
    expect(forged.error !== undefined || forged.status >= 400, req(id, 'interop-map.json mcp.mrtr requestState (host as server)', `a requestState that fails integrity verification MUST be refused (got ${forged.status} ${JSON.stringify(forged.result)})`)).toBe(true);
  });

  it('the MRTR input-request key is the open interrupt’s interruptId, never the node it suspended on', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    const missing = needFixtures(['conformance-approval']);
    if (missing) return softSkip('blocked', missing);
    const id = R('mcp-mrtr-input-request-key');
    const TOOL = 'conformance-approval';
    const caps = { elicitation: {} };
    const runs = async (): Promise<string[]> => ((((await driver.get(`/runs?workflowId=${TOOL}&limit=50`)).json as { runs?: Array<{ runId?: string }> } | undefined)?.runs ?? []).map((x) => String(x.runId)));
    const listable = await familyAdvertised('runList');
    const before = listable ? await runs() : [];
    // TWO runs of ONE workflow: both suspend at the SAME node, so a node-keyed host
    // advertises the SAME key for two different outstanding interrupts and the key stops
    // naming the request. (`tasks/get` projects this same key — mcp.tasks.status.)
    const a = await toolCall(m.url, TOOL, {}, { caps });
    const b = await toolCall(m.url, TOOL, {}, { caps });
    expect([a.result?.['resultType'], b.result?.['resultType']], req(id, 'interop-map.json mcp.mrtr InputRequiredResult (host as server)', `both calls MUST answer InputRequiredResult (got ${JSON.stringify([a.error ?? a.result, b.error ?? b.result])})`)).toEqual(['input_required', 'input_required']);
    const keys = [a, b].map((r) => Object.keys((r.result?.['inputRequests'] ?? {}) as Record<string, unknown>));
    expect(keys.map((k) => k.length), req(id, 'interop-map.json mcp.tasks.status waiting-approval', `inputRequests carries exactly one key per open interrupt (got ${JSON.stringify(keys)})`)).toEqual([1, 1]);
    const [ka, kb] = [keys[0]![0]!, keys[1]![0]!];
    expect([INTERRUPT_ID.test(ka), INTERRUPT_ID.test(kb)], req(id, 'interop-map.json mcp.mrtr InputRequiredResult (host as server); schemas/v2/ids.schema.json interruptId', `the key MUST be the interrupt’s interruptId, which is tenant-bound (${INTERRUPT_ID.source}) and so can never be an author-chosen nodeId (got ${JSON.stringify([ka, kb])})`)).toEqual([true, true]);
    expect(ka === kb, req(id, 'interop-map.json mcp.mrtr InputRequiredResult (host as server)', `two outstanding interrupts MUST NOT share a key — these runs suspend at the same node, so an equal key is that node’s id, not either interrupt’s (got ${ka})`)).toBe(false);
    if (listable) {
      // The positive tie: the key is an id the run’s own log minted, not merely a well-formed
      // string. Runs another leg started in parallel only widen the pool, never narrow it.
      const minted = new Set<string>();
      for (const runId of (await runs()).filter((r) => !before.includes(r))) {
        const poll = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
        for (const e of ((poll.json as { events?: Array<{ type?: string; payload?: { interruptId?: unknown } }> } | undefined)?.events ?? [])) if (e.type === 'node.suspended' && typeof e.payload?.interruptId === 'string') minted.add(e.payload.interruptId);
      }
      expect([minted.has(ka), minted.has(kb)], req(id, 'interop-map.json mcp.mrtr InputRequiredResult (host as server); runs.md node.suspended', `each key MUST be an interruptId the run’s own node.suspended carries (keys ${JSON.stringify([ka, kb])}; minted ${JSON.stringify([...minted])})`)).toEqual([true, true]);
    }
    // …and that key is the one the retry answers: the state minted beside it resolves the run.
    const done = await toolCall(m.url, TOOL, { requestState: a.result?.['requestState'], inputResponses: { [ka]: { action: 'accept', content: { action: 'accept' } } } }, { caps });
    expect([done.error, done.result?.['resultType'], done.result?.['isError']], req(id, 'interop-map.json mcp.mrtr inputResponses[key] (host as server)', `the interruptId key MUST be the key inputResponses is read under (got ${JSON.stringify(done.error ?? done.result)})`)).toEqual([undefined, 'complete', false]);
    await toolCall(m.url, TOOL, { requestState: b.result?.['requestState'], inputResponses: { [kb]: { action: 'decline' } } }, { caps });
  });

  it('a list that differs per caller is cacheScope private', async () => {
    const other = process.env.OPENWOP_TEST_TENANT_B_API_KEY;
    if (!other) return softSkip('blocked', 'OPENWOP_TEST_TENANT_B_API_KEY (a credential bound to a second tenant) is not set — the cross-caller half cannot run');
    const m = await mount();
    if (!m.ok) return skip(m);
    const mine = await call(m.url, 'tools/list', {});
    const theirs = await call(m.url, 'tools/list', {}, { bearer: other });
    if (mine.status === 200 && theirs.status === 200 && JSON.stringify(mine.result?.['tools']) === JSON.stringify(theirs.result?.['tools'])) {
      // A byte-identical list may be public; the private-scope rule binds only a
      // list that differs per caller. Passing here would be a row that cannot fail.
      return softSkip('inapplicable', 'the tool list is byte-identical for both tenants — the cacheScope private rule has nothing to bind on this host');
    }
    expect([mine.status, theirs.status], req(R('mcp-cache-scope'), 'interop-map.json mcp.methods tools/list', 'tools/list is served to both callers')).toEqual([200, 200]);
    const scopes = [mine.result?.['cacheScope'], theirs.result?.['cacheScope']];
    expect(scopes.every((s) => s === 'private'), req(R('mcp-cache-scope'), 'interop-map.json mcp.cache cacheScope', `a list that differs per caller MUST be cacheScope private — public only when byte-identical for every caller (mcp-cache-tenant-scoped); scopes ${JSON.stringify(scopes)}`)).toBe(true);
  });

  it('unknown _meta extension keys and capabilities.extensions are opaque: processed normally, granting nothing', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    const r = await call(m.url, 'tools/list', {}, { caps: { extensions: { 'io.example/authority': { admin: true } } }, extraMeta: { 'io.example/authority': { grantScopes: ['*'] } } });
    expect([r.status, r.error, r.result?.['resultType']], req(R('mcp-extension-opacity'), `${DOC} (what the map does not name is opaque); mcp-extension-no-authority`, `an unknown extension is opaque — neither refused nor honoured (got ${r.status} ${JSON.stringify(r.error)})`)).toEqual([200, undefined, 'complete']);
    const plain = await call(m.url, 'tools/list', {});
    expect(JSON.stringify(r.result?.['tools']), req(R('mcp-extension-opacity'), 'mcp-extension-no-authority', 'an extension asserting authority MUST NOT widen what the caller sees')).toBe(JSON.stringify(plain.result?.['tools']));
  });

  it('an unauthenticated request is refused at the boundary unless anonymousActor is advertised', async () => {
    const m = await mount();
    if (!m.ok) return skip(m);
    if (await familyAdvertised('anonymousActor')) return softSkip('inapplicable', 'anonymousActor is advertised — anonymous MCP callers are routed through that surface\'s rules');
    const authed = await call(m.url, 'tools/list', {});
    expect(authed.status, req(R('mcp-auth-boundary'), 'interop-map.json mcp.authorization', 'the authenticated call succeeds at the same URL, so a refusal below is not a wrong path')).toBe(200);
    const anon = await call(m.url, 'tools/list', {}, { bearer: null });
    expect([401, 403], req(R('mcp-auth-boundary'), 'interop-map.json mcp.authorization', `every tools/* request MUST be authenticated at the OpenWOP boundary (got ${anon.status})`)).toContain(anon.status);
    const cookies = (anon.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    if (cookies.length > 0) {
      const withSession = await call(m.url, 'tools/list', {}, { bearer: null, headers: { Cookie: cookies.map((c) => c.split(';')[0]).join('; ') } });
      expect([401, 403], req(R('mcp-auth-boundary'), 'interop-map.json mcp.authorization', `a host-minted anonymous session is still an anonymous principal (got ${withSession.status})`)).toContain(withSession.status);
    }
  });

  // ── RFC 0199 §D.2 — what the bridge sends for a credential interrupt, and what it refuses to send in form mode ──

  it('a credential interrupt is answered in URL mode (url = connectUrl), isError without URL support, and input_required again on an accept retry with no credential', async () => {
    const id = 'openwop.requirement.0199.mcp-url-mode';
    const m = await mount();
    if (!m.ok) return skip(m);
    const oauth = await familyAdvertised('oauth');
    if (oauth?.['credentialInterrupt'] !== true) return softSkip('inapplicable', 'oauth.credentialInterrupt is not advertised — the host raises no credential interrupt to bridge (RFC 0199 §C.1)');
    const missing = needFixtures(['conformance-credential']);
    if (missing) return softSkip('blocked', missing);
    const minted = await driver.post(`${SEAMS_PREFIX}/sample/auth/credential/mint`, { lane: 'api-key' }).catch(() => null);
    const bearer = (minted?.json as { credential?: unknown } | undefined)?.credential;
    if (typeof bearer !== 'string') return softSkip('blocked', 'the credential mint seam did not mint a fresh Subject — a Subject that may already hold a credential makes the leg vacuous');
    const TOOL = 'conformance-credential';
    const urlCaps = { elicitation: { url: {} } };
    const first = await toolCall(m.url, TOOL, {}, { caps: urlCaps, bearer });
    expect(first.result?.['resultType'], req(id, 'interop-map.json mcp.mrtr InputRequiredResult (host as server)', `a run suspended on a credential interrupt MUST answer input_required (got ${JSON.stringify(first.error ?? first.result)})`)).toBe('input_required');
    const requests = (first.result?.['inputRequests'] ?? {}) as Record<string, { method?: string; params?: { mode?: string; url?: string; message?: string } }>;
    const key = Object.keys(requests)[0];
    const params = key === undefined ? undefined : requests[key]?.params;
    expect([requests[key ?? '']?.method, params?.mode], req(id, 'RFC 0199 §D.2(a); interop-map.json mcp.mrtr', `a credential interrupt MUST be elicitation/create in mode url, never form (got ${JSON.stringify(requests)})`)).toEqual(['elicitation/create', 'url']);
    let connectUrl: string | undefined;
    if (await familyAdvertised('runList')) {
      const runs = await driver.get('/runs?workflowId=conformance-credential&limit=5', { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });
      const runId = ((runs.json as { runs?: Array<{ runId?: string }> } | undefined)?.runs ?? [])[0]?.runId;
      if (runId !== undefined) {
        const poll = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`, { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });
        connectUrl = ((poll.json as { events?: Array<{ type?: string; payload?: { kind?: string; data?: { connectUrl?: string } } }> } | undefined)?.events ?? []).find((e) => e.type === 'interrupt.requested' && e.payload?.kind === 'credential')?.payload?.data?.connectUrl;
      }
    }
    if (connectUrl !== undefined) {
      expect(params?.url, req(id, 'RFC 0199 §D.2(a)', 'the url MUST be the credential interrupt\'s connectUrl')).toBe(connectUrl);
    } else {
      expect(typeof params?.url === 'string' && params.url.startsWith('https://'), req(id, 'RFC 0199 §D.2(a)', `the url MUST be an https connectUrl (runList unavailable, so it is not compared with the log; got ${params?.url})`)).toBe(true);
    }
    const formOnly = await toolCall(m.url, TOOL, {}, { caps: { elicitation: {} }, bearer });
    expect([formOnly.error, formOnly.result?.['isError'], formOnly.result?.['inputRequests']], req(id, 'RFC 0199 §D.2(b) (an empty elicitation capability is form mode only)', `without elicitation.url the host MUST answer CallToolResult isError true and MUST NOT fall back to form mode (got ${JSON.stringify(formOnly.error ?? formOnly.result)})`)).toEqual([undefined, true, undefined]);
    const retry = await toolCall(m.url, TOOL, { requestState: first.result?.['requestState'], inputResponses: { [key!]: { action: 'accept' } } }, { caps: urlCaps, bearer });
    const again = (retry.result?.['inputRequests'] ?? {}) as Record<string, { params?: { mode?: string; url?: string } }>;
    const againParams = Object.values(again)[0]?.params;
    expect([retry.error, retry.result?.['resultType'], againParams?.mode, againParams?.url], req(id, 'RFC 0199 §D.2(c); interop-map.json mcp.mrtr inputResponses[key] (host as server)', `an accept retry with no credential MUST answer input_required again with the same url, not an error (got ${JSON.stringify(retry.error ?? retry.result)})`)).toEqual([undefined, 'input_required', 'url', params?.url]);
  });

  it('form mode is never emitted for a nested schema or a sensitive (format password) field', async () => {
    const id = 'openwop.requirement.0199.form-mode-no-secret';
    const m = await mount();
    if (!m.ok) return skip(m);
    const missing = needFixtures(['conformance-clarification', 'conformance-clarification-nested', 'conformance-clarification-sensitive']);
    if (missing) return softSkip('blocked', missing);
    const modes = (r: Rpc): string[] => Object.values((r.result?.['inputRequests'] ?? {}) as Record<string, { params?: { mode?: string } }>).map((x) => String(x.params?.mode));
    // Positive control: a flat primitive clarification IS bridged in form mode, so a refusal below is not a bridge that never answers.
    const flat = await toolCall(m.url, 'conformance-clarification', {}, { caps: { elicitation: {} } });
    expect([flat.result?.['resultType'], modes(flat)], req(id, 'interop-map.json mcp.mrtr InputRequiredResult (host as server)', `positive control: a flat primitive clarification is bridged in form mode (got ${JSON.stringify(flat.error ?? flat.result)})`)).toEqual(['input_required', ['form']]);
    for (const tool of ['conformance-clarification-nested', 'conformance-clarification-sensitive']) {
      for (const caps of [{ elicitation: {} }, { elicitation: { url: {} } }]) {
        const r = await toolCall(m.url, tool, {}, { caps });
        expect(r.error, req(id, 'RFC 0199 §D.2(d)', `${tool} MUST be answered with a result, not a JSON-RPC error (got ${JSON.stringify(r.error)})`)).toBeUndefined();
        expect(modes(r).includes('form'), req(id, 'RFC 0199 §D.2(d); invariant elicitation-form-no-secret (MCP Elicitation §Requested Schema / §User Interaction Model)', `${tool} with ${JSON.stringify(caps)}: form mode MUST NOT be emitted for a non-flat or sensitive schema — URL mode when declared, else isError (got ${JSON.stringify(r.result)})`)).toBe(false);
        const urlDeclared = (caps.elicitation as Record<string, unknown>)['url'] !== undefined;
        if (urlDeclared) expect(modes(r), req(id, 'RFC 0199 §D.2(d)', `${tool}: with elicitation.url declared the host emits URL mode (a host-owned resolve page)`)).toEqual(['url']);
        else expect(r.result?.['isError'], req(id, 'RFC 0199 §D.2(d)/(b)', `${tool}: without elicitation.url the host answers isError true`)).toBe(true);
      }
    }
  });
});
