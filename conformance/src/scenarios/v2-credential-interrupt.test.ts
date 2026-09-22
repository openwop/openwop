/**
 * RFC 0199 §C — the `credential` interrupt (`spec/v2/core/oauth.md` §The
 * credential interrupt, `spec/v2/core/interrupt.md` §Payload). Target major 2.
 *
 * Gate: the v2 `oauth` record advertises provider `synthetic` and the fixture
 * `conformance-credential` is in `fixtures[]` (one `conformance.oauth.use` node
 * declaring `auth { type: oauth2, provider: synthetic, scopes: [openwop.read] }`).
 * The facet splits the file:
 *   - `oauth.credentialInterrupt` present ⇒ the suspend legs (the node
 *     suspends instead of failing; `connectUrl`; the host-side re-check;
 *     `declined`; refresh failure raises `reason: expired` after
 *     `connector.auth-expired`);
 *   - absent ⇒ the RFC 0047 §C.3 regression leg (refresh failure fails the
 *     node `connector_auth_expired` and raises no interrupt).
 *
 * Every run belongs to a FRESH Subject from the credential mint seam, so no
 * credential another scenario acquired can satisfy the node (a Subject that
 * already holds one would make the "missing" leg vacuous). No mint seam ⇒
 * `blocked`. The grant legs point `synthetic` at the suite's
 * authorization-server double through `authorize-start` and play the user
 * agent through the host's own `connectUrl` and production callback.
 *
 * @see spec/v2/core/oauth.md §The credential interrupt
 * @see RFCS/0199-outbound-oauth-client-and-credential-interrupt.md §C
 * @see SECURITY/invariants.yaml id: oauth-same-user-binding
 */
import { describe, it, expect, afterAll } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { v2Validator } from '../lib/v2.js';
import { SEAMS_PREFIX } from '../lib/seams.js';
import { EXPIRE_REFRESH, authorizeStart, authorizationUrlOf, consent, oauthGate, startAsDouble, userAgentGet, type AsDouble } from '../lib/oauth-as-double.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'the suite plays the user agent through the host\'s own connectUrl and callback; the only fixture the host reaches is the suite\'s authorization-server double';

const DOC = 'spec/v2/core/oauth.md §The credential interrupt (RFC 0199 §C)';
const R = (slug: string): string => `openwop.requirement.0199.${slug}`;
const FIXTURE = 'conformance-credential';
const NODE = 'use-credential';
const PROVIDER = 'synthetic';
const SCOPES = ['openwop.read'];
const MINT = `${SEAMS_PREFIX}/sample/auth/credential/mint`;
const validInterrupt = v2Validator('suspend-request');

let double: AsDouble | null = null;
async function as(): Promise<AsDouble> { double ??= await startAsDouble(); return double; }
afterAll(async () => { await double?.close(); double = null; });

const auth = (bearer: string): { authenticated: false; headers: Record<string, string> } => ({ authenticated: false, headers: { Authorization: `Bearer ${bearer}` } });

interface Ev { type?: string; sequence?: number; nodeId?: string; payload?: Record<string, unknown> }

type Ready = { ok: true; d: AsDouble; facet: boolean; bearer: string } | { ok: false; skip: () => undefined };
async function ready(): Promise<Ready> {
  const g = await oauthGate();
  if (!g.ok) return { ok: false, skip: () => softSkip(g.kind, g.reason) };
  if (!g.providers.has(PROVIDER)) return { ok: false, skip: () => softSkip('blocked', `oauth.providers does not list ${PROVIDER} — the fixture's provider`) };
  if (!isFixtureAdvertised(FIXTURE)) return { ok: false, skip: () => softSkip('blocked', `fixture ${FIXTURE} is not in the advertised fixtures[]`) };
  const minted = await driver.post(MINT, { lane: 'api-key' }).catch(() => null);
  const bearer = (minted?.json as { credential?: unknown } | undefined)?.credential;
  if (minted === null || minted.status >= 300 || typeof bearer !== 'string') return { ok: false, skip: () => seamAbsent(`${MINT} did not mint a fresh Subject (${minted?.status ?? 'unreachable'}) — a Subject that may already hold a credential would make every leg vacuous`) };
  const d = await as();
  const point = await authorizeStart({ provider: PROVIDER, authUrl: d.authorizeUrl, tokenUrl: d.tokenUrl, issuer: d.issuer, scopes: SCOPES }, bearer);
  if (point.status === 404 || point.status === 405) return { ok: false, skip: () => seamAbsent('POST /conformance/seams/sample/oauth/authorize-start is not mounted — the provider cannot be pointed at the suite\'s double') };
  return { ok: true, d, facet: g.oauth['credentialInterrupt'] === true, bearer };
}

async function createRun(bearer: string): Promise<string> {
  const r = await driver.post('/runs', { workflowId: FIXTURE, inputs: {} }, auth(bearer));
  const runId = (r.json as { runId?: unknown } | undefined)?.runId;
  expect(typeof runId, req(R('credential-interrupt'), 'runs.md createRun', `createRun of ${FIXTURE} MUST be accepted (got ${r.status} ${r.text.slice(0, 200)})`)).toBe('string');
  return runId as string;
}
async function status(runId: string, bearer: string): Promise<string | undefined> {
  const r = await driver.get(`/runs/${encodeURIComponent(runId)}`, auth(bearer));
  return r.status === 200 ? (r.json as { status?: string }).status : undefined;
}
async function settle(runId: string, bearer: string, want: (s: string | undefined) => boolean, ms = 10_000): Promise<string | undefined> {
  const end = Date.now() + ms;
  let s = await status(runId, bearer);
  while (!want(s) && Date.now() < end) { await new Promise((ok) => setTimeout(ok, 100)); s = await status(runId, bearer); }
  return s;
}
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const settledOrSuspended = (s: string | undefined): boolean => s !== undefined && (TERMINAL.has(s) || s.startsWith('waiting-'));
async function events(runId: string, bearer: string): Promise<Ev[]> {
  const r = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`, auth(bearer));
  return ((r.json as { events?: Ev[] } | undefined)?.events ?? []);
}
const credentialRequest = (evs: Ev[]): Ev | undefined => evs.find((e) => e.type === 'interrupt.requested' && e.payload?.['kind'] === 'credential');
const resolve = (runId: string, bearer: string, resumeValue: unknown): Promise<OpenWOPResponse> => driver.post(`/runs/${encodeURIComponent(runId)}/interrupts/${NODE}`, { resumeValue }, auth(bearer));
const errCode = (r: OpenWOPResponse): string | undefined => (r.json as { error?: unknown } | undefined)?.error as string | undefined;

/** Run one full grant for `bearer` through authorize-start → the double → the production callback. */
async function grant(d: AsDouble, bearer: string): Promise<number> {
  const start = await authorizeStart({ provider: PROVIDER, authUrl: d.authorizeUrl, tokenUrl: d.tokenUrl, issuer: d.issuer, scopes: SCOPES }, bearer);
  const url = authorizationUrlOf(start);
  if (url === null) return start.status;
  const cb = await consent(url.toString());
  if (cb === null) return 0;
  return (await userAgentGet(cb, bearer)).status;
}

describe('RFC 0199 §C — v2-credential-interrupt (gated on oauth + provider synthetic + fixture conformance-credential)', () => {
  it('a node with no credential suspends on a credential interrupt with a closed CredentialData, status waiting-input', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    if (!r.facet) return softSkip('inapplicable', 'oauth.credentialInterrupt is not advertised — the host keeps RFC 0047 §C.3 (the regression leg below covers it)');
    const id = R('credential-interrupt');
    const runId = await createRun(r.bearer);
    const s = await settle(runId, r.bearer, settledOrSuspended);
    expect(s, req(id, DOC, `a node declaring oauth2 auth with no credential for the Subject MUST suspend instead of failing — snapshot status waiting-input (got ${s})`)).toBe('waiting-input');
    const ev = credentialRequest(await events(runId, r.bearer));
    expect(ev, req(id, `${DOC}; interrupt.md §Payload`, 'the log carries interrupt.requested with kind credential')).toBeDefined();
    const v = validInterrupt(ev!.payload);
    expect(v.ok, req(id, 'schemas/v2/suspend-request.schema.json CredentialData (closed)', `the interrupt payload MUST validate, CredentialData closed: ${v.errors}`)).toBe(true);
    const data = (ev!.payload!['data'] ?? {}) as Record<string, unknown>;
    expect([data['provider'], data['reason']], req(id, DOC, 'data names the provider and reason missing')).toEqual([PROVIDER, 'missing']);
    const connect = new URL(String(data['connectUrl']));
    expect(connect.protocol, req(id, DOC, 'connectUrl MUST be https')).toBe('https:');
    expect(connect.origin, req(id, `${DOC} (connectUrl is host-owned)`, `connectUrl MUST be on the host's own origin (${new URL(loadEnv().baseUrl).origin})`)).toBe(new URL(loadEnv().baseUrl).origin);
    await driver.post(`/runs/${encodeURIComponent(runId)}:cancel`, {}, auth(r.bearer));
  });

  it('a caller resolve of authorized is refused while no credential resolves, and a resume value cannot carry a credential', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    if (!r.facet) return softSkip('inapplicable', 'oauth.credentialInterrupt is not advertised');
    const id = R('credential-resume-rechecked');
    const runId = await createRun(r.bearer);
    expect(await settle(runId, r.bearer, settledOrSuspended), req(id, DOC, 'precondition: the run suspends on the credential interrupt')).toBe('waiting-input');
    const trusted = await resolve(runId, r.bearer, { outcome: 'authorized' });
    expect([trusted.status, errCode(trusted)], req(id, `${DOC} (the host re-checks; it does not trust the caller)`, `a resolve of authorized with no credential for the Subject MUST be refused 400 validation_error (got ${trusted.status} ${trusted.text.slice(0, 200)})`)).toEqual([400, 'validation_error']);
    const field = ((trusted.json as { details?: { field?: unknown } } | undefined)?.details?.field);
    expect(field, req(id, 'RFC 0199 §C.4', 'the refusal names details.field resumeValue')).toBe('resumeValue');
    const smuggled = await resolve(runId, r.bearer, { outcome: 'authorized', token: 'xoxb-conformance-not-a-credential' });
    expect(smuggled.status, req(id, 'interrupt.md §Payload (the resume value is { outcome } and carries no credential)', `a resume value carrying anything but outcome MUST fail resumeSchema with 400 (got ${smuggled.status})`)).toBe(400);
    expect(await status(runId, r.bearer), req(id, DOC, 'the refused resolves change nothing: the run is still waiting-input')).toBe('waiting-input');
    await driver.post(`/runs/${encodeURIComponent(runId)}:cancel`, {}, auth(r.bearer));
  });

  it('connectUrl is not pre-authenticated and begins the grant only for the initiating Subject', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    if (!r.facet) return softSkip('inapplicable', 'oauth.credentialInterrupt is not advertised');
    const id = R('credential-interrupt');
    const runId = await createRun(r.bearer);
    expect(await settle(runId, r.bearer, settledOrSuspended), req(id, DOC, 'precondition: the run suspends on the credential interrupt')).toBe('waiting-input');
    const connect = String(((credentialRequest(await events(runId, r.bearer))?.payload?.['data'] ?? {}) as Record<string, unknown>)['connectUrl']);
    const startsGrant = (x: { status: number; location: string | null; text: string }): boolean => (x.location ?? '').startsWith(r.d.authorizeUrl) || x.text.includes(r.d.authorizeUrl);
    const anon = await userAgentGet(connect, null);
    expect(startsGrant(anon), req(id, `${DOC} (connectUrl MUST NOT be pre-authenticated)`, `an unauthenticated GET of connectUrl MUST NOT reach an authorization URL (got ${anon.status} → ${anon.location})`)).toBe(false);
    const minted = await driver.post(MINT, { lane: 'api-key' });
    const other = (minted.json as { credential?: string } | undefined)?.credential;
    if (typeof other === 'string') {
      const foreign = await userAgentGet(connect, other);
      expect(startsGrant(foreign), req(id, `${DOC}; invariant oauth-same-user-binding`, `connectUrl opened by another Subject MUST NOT begin the grant (got ${foreign.status} → ${foreign.location})`)).toBe(false);
    }
    const own = await userAgentGet(connect, r.bearer);
    expect(startsGrant(own), req(id, DOC, `positive control: the initiating Subject opening connectUrl is sent to the provider's authorization endpoint (got ${own.status} → ${own.location})`)).toBe(true);
    expect(/ow2\.[a-z0-9]+\.[^/?#]+\./i.test(decodeURIComponent(connect)), req(id, `${DOC} (connectUrl is not the interrupt's capability token)`, 'connectUrl MUST NOT embed the interrupt token (identity.md §4 grammar ow2.<alg>.<kid>.…)')).toBe(false);
    await driver.post(`/runs/${encodeURIComponent(runId)}:cancel`, {}, auth(r.bearer));
  });

  it('the grant completes through connectUrl, the host resolves the interrupt itself and the run continues', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    if (!r.facet) return softSkip('inapplicable', 'oauth.credentialInterrupt is not advertised');
    const id = R('credential-interrupt');
    const runId = await createRun(r.bearer);
    expect(await settle(runId, r.bearer, settledOrSuspended), req(id, DOC, 'precondition: the run suspends on the credential interrupt')).toBe('waiting-input');
    const connect = String(((credentialRequest(await events(runId, r.bearer))?.payload?.['data'] ?? {}) as Record<string, unknown>)['connectUrl']);
    const open = await userAgentGet(connect, r.bearer);
    expect(open.location, req(id, DOC, `connectUrl redirects the initiating Subject to the provider (got ${open.status})`)).not.toBeNull();
    const n = r.d.codeExchanges().length;
    const cb = await consent(open.location!);
    const done = await userAgentGet(cb!, r.bearer);
    expect([done.status < 400, r.d.codeExchanges().length], req(id, DOC, `the production callback completes the grant with one token request (got ${done.status} ${done.text.slice(0, 200)})`)).toEqual([true, n + 1]);
    const s = await settle(runId, r.bearer, (x) => x !== undefined && TERMINAL.has(x));
    expect(s, req(id, DOC, `the host resolves the interrupt when the grant completes and the run continues to completion (got ${s})`)).toBe('completed');
    const resolved = (await events(runId, r.bearer)).find((e) => e.type === 'interrupt.resolved');
    expect(resolved?.payload?.['resumeValue'], req(id, 'RFC 0199 §C.4', 'interrupt.resolved records resumeValue { outcome: authorized }')).toEqual({ outcome: 'authorized' });
  });

  it('declined fails the node with connector_auth_declined', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    if (!r.facet) return softSkip('inapplicable', 'oauth.credentialInterrupt is not advertised');
    const id = R('credential-declined');
    const runId = await createRun(r.bearer);
    expect(await settle(runId, r.bearer, settledOrSuspended), req(id, DOC, 'precondition: the run suspends on the credential interrupt')).toBe('waiting-input');
    const dec = await resolve(runId, r.bearer, { outcome: 'declined' });
    expect(dec.status, req(id, DOC, `a resolve of declined is accepted (got ${dec.status} ${dec.text.slice(0, 200)})`)).toBeLessThan(300);
    const s = await settle(runId, r.bearer, (x) => x !== undefined && TERMINAL.has(x));
    expect(s, req(id, DOC, 'declined fails the node, and the run')).toBe('failed');
    const failed = (await events(runId, r.bearer)).find((e) => e.type === 'node.failed');
    expect((failed?.payload?.['error'] as { code?: string } | undefined)?.code, req(id, `${DOC}; errors.json connector_auth_declined`, 'the node fails with connector_auth_declined')).toBe('connector_auth_declined');
  });

  it('a terminal refresh failure emits connector.auth-expired, then suspends with reason expired', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    if (!r.facet) return softSkip('inapplicable', 'oauth.credentialInterrupt is not advertised');
    const id = R('credential-interrupt');
    const got = await grant(r.d, r.bearer);
    expect(got, req(id, DOC, `precondition: the Subject acquires a credential through the production grant (callback ${got})`)).toBeLessThan(400);
    const exp = await driver.post(EXPIRE_REFRESH, { provider: PROVIDER }, auth(r.bearer));
    if (exp.status === 404 || exp.status === 405) return seamAbsent('POST /conformance/seams/sample/oauth/expire-refresh is not mounted');
    expect(exp.status, req(id, 'api/seams-v2.yaml expireOAuthAccessToken', `expire-refresh answers 204 (got ${exp.status})`)).toBe(204);
    r.d.refreshRevoked = true;
    try {
      const refreshesBefore = r.d.tokenRequests.filter((t) => t.grantType === 'refresh_token').length;
      const runId = await createRun(r.bearer);
      const s = await settle(runId, r.bearer, settledOrSuspended);
      expect(r.d.tokenRequests.filter((t) => t.grantType === 'refresh_token').length, req(id, 'oauth.md §Token lifecycle', 'the expired token is refreshed host-side at the provider (the double counts the refresh)')).toBeGreaterThan(refreshesBefore);
      expect(s, req(id, DOC, `a terminal refresh failure MUST suspend the node instead of failing it (got ${s})`)).toBe('waiting-input');
      const evs = await events(runId, r.bearer);
      const expired = evs.findIndex((e) => e.type === 'connector.auth-expired');
      const asked = evs.findIndex((e) => e.type === 'interrupt.requested' && e.payload?.['kind'] === 'credential');
      expect(expired >= 0 && asked > expired, req(id, 'RFC 0199 §C.2(b)', `connector.auth-expired MUST precede the credential interrupt (indices ${expired}, ${asked})`)).toBe(true);
      expect(((evs[asked]?.payload?.['data'] ?? {}) as Record<string, unknown>)['reason'], req(id, DOC, 'the interrupt carries reason expired')).toBe('expired');
      await driver.post(`/runs/${encodeURIComponent(runId)}:cancel`, {}, auth(r.bearer));
    } finally {
      r.d.refreshRevoked = false;
    }
  });

  it('without oauth.credentialInterrupt, a terminal refresh failure fails the node connector_auth_expired and raises no interrupt', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    if (r.facet) return softSkip('inapplicable', 'oauth.credentialInterrupt is advertised — the host suspends instead (the legs above)');
    const id = R('refresh-failure-fails-node');
    const got = await grant(r.d, r.bearer);
    expect(got, req(id, DOC, `precondition: the Subject acquires a credential through the production grant (callback ${got})`)).toBeLessThan(400);
    const exp = await driver.post(EXPIRE_REFRESH, { provider: PROVIDER }, auth(r.bearer));
    if (exp.status === 404 || exp.status === 405) return seamAbsent('POST /conformance/seams/sample/oauth/expire-refresh is not mounted');
    r.d.refreshRevoked = true;
    try {
      const runId = await createRun(r.bearer);
      const s = await settle(runId, r.bearer, settledOrSuspended);
      expect(s, req(id, 'oauth.md §Token lifecycle; RFC 0047 §C.3 (unchanged by RFC 0199 C1)', `without the facet a terminal refresh failure MUST fail the node (got ${s})`)).toBe('failed');
      const evs = await events(runId, r.bearer);
      expect(evs.some((e) => e.type === 'connector.auth-expired'), req(id, 'oauth.md §Token lifecycle', 'connector.auth-expired is emitted')).toBe(true);
      expect(evs.some((e) => e.type === 'interrupt.requested'), req(id, 'RFC 0199 §C.1', 'a host that does not advertise the facet MUST NOT raise an interrupt')).toBe(false);
      expect(((evs.find((e) => e.type === 'node.failed')?.payload?.['error']) as { code?: string } | undefined)?.code, req(id, 'oauth.md §Token lifecycle', 'the node fails with connector_auth_expired')).toBe('connector_auth_expired');
    } finally {
      r.d.refreshRevoked = false;
    }
  });
});
