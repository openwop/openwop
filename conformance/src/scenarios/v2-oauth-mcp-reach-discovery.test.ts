/**
 * RFC 0199 §B / §E.2 — a provider reached as an MCP server
 * (`spec/v2/core/oauth.md` §The authorization-code client, MCP-reach
 * paragraph; `connection-packs.md` §Manifest clause 3a). Target major 2.
 *
 * Gate: the oauth gate of `lib/oauth-as-double.ts` (oauth + authorization_code
 * + seams). Each leg hands the host a `reach.mcp` + `oauth2` connection pack
 * through `authorize-start`'s `connection` member, which the host registers
 * through its PRODUCTION connection-pack path.
 *
 *   - The two host-side refusals (§E.2: no `issuer`; `pkce: "unsupported"`)
 *     need nothing reachable — the host must refuse before it sends anything —
 *     so they run on any host.
 *   - The discovery legs (`resource`, verify-not-select, S256 in metadata,
 *     pinning) need the suite's authorization-server doubles and its
 *     protected-resource double reachable over https, because a connection
 *     pack's endpoints and server URL are `https://` by schema. Without the
 *     public fronts (`OPENWOP_OAUTH_AS_URL`, `OPENWOP_OAUTH_AS2_URL`,
 *     `OPENWOP_OAUTH_RESOURCE_URL`) they record `blocked`.
 *
 * The witness is the doubles' own counters: a refused discovery shows ZERO
 * requests at the foreign issuer the PRM named and ZERO token requests.
 *
 * @see spec/v2/core/oauth.md §The authorization-code client
 * @see spec/v1/connection-packs.md §Manifest clause 3a
 * @see RFCS/0199-outbound-oauth-client-and-credential-interrupt.md §B, §E.2
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadEnv } from '../lib/env.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { v2Validator } from '../lib/v2.js';
import { authorizeStart, authorizationUrlOf, consent, oauthGate, startAsDouble, startResourceDouble, userAgentGet, type AsDouble, type ResourceDouble } from '../lib/oauth-as-double.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'the suite hands the host a connection pack through authorize-start and plays the user agent; the host reaches only the suite\'s authorization-server and protected-resource doubles';

const DOC = 'spec/v2/core/oauth.md §The authorization-code client (MCP reach; RFC 0199 §B)';
const R = (slug: string): string => `openwop.requirement.0199.${slug}`;
const validPack = v2Validator('connection-pack-manifest');

const opened: Array<{ close(): Promise<void> }> = [];
afterAll(async () => { for (const o of opened.splice(0)) await o.close(); });

function pack(opts: { id: string; serverUrl: string; authorize: string; token: string; issuer?: string; pkce?: string }): Record<string, unknown> {
  const auth: Record<string, unknown> = { kind: 'oauth2', authFlow: 'pkce', scopeModel: 'coarse', endpoints: { authorize: opts.authorize, token: opts.token } };
  if (opts.issuer !== undefined) auth['issuer'] = opts.issuer;
  if (opts.pkce !== undefined) auth['pkce'] = opts.pkce;
  return {
    name: `vendor.openwop-conformance.connections.${opts.id}`,
    version: '1.0.0',
    kind: 'connection',
    engines: { openwop: '>=2.0.0' },
    provider: { id: opts.id, displayName: `Conformance ${opts.id}`, category: 'other', auth, reach: { mcp: { server: { url: opts.serverUrl, transport: 'http' } } } },
  };
}
const uniqueId = (tag: string): string => `conf-${tag}-${randomBytes(4).toString('hex')}`;

type Env = { ok: true; as: AsDouble; foreign: AsDouble; resource: ResourceDouble } | { ok: false; kind: 'blocked'; reason: string };
let started: Env | null = null;
async function doubles(): Promise<Env> {
  started ??= await startDoubles();
  return started;
}
async function startDoubles(): Promise<Env> {
  const as = await startAsDouble('OPENWOP_OAUTH_AS_URL');
  const foreign = await startAsDouble('OPENWOP_OAUTH_AS2_URL');
  const resource = await startResourceDouble([as.issuer]);
  opened.push(as, foreign, resource);
  if (!as.tunnelled || !foreign.tunnelled || !resource.tunnelled) {
    return { ok: false, kind: 'blocked', reason: 'a connection pack names https endpoints and an https MCP server URL, so the discovery legs need the suite\'s doubles behind public https fronts — set OPENWOP_OAUTH_AS_URL, OPENWOP_OAUTH_AS2_URL and OPENWOP_OAUTH_RESOURCE_URL (a tunnel or TLS-terminating proxy per double)' };
  }
  return { ok: true, as, foreign, resource };
}

async function startWith(p: Record<string, unknown>): Promise<{ status: number; code: string | undefined; url: URL | null } | 'absent'> {
  const id = String((p['provider'] as { id: string }).id);
  const r = await authorizeStart({ provider: id, connection: p });
  if (r.status === 404 || r.status === 405) return 'absent';
  return { status: r.status, code: readErrorCode(r.json), url: authorizationUrlOf(r) };
}

describe('RFC 0199 §B — v2-oauth-mcp-reach-discovery (gated on oauth + authorization_code + seams)', () => {
  it('a reach.mcp + oauth2 pack without issuer validates, and its grant is refused with no authorization URL', async () => {
    const g = await oauthGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const id = R('mcp-metadata-bound');
    const p = pack({ id: uniqueId('noiss'), serverUrl: 'https://mcp.conformance.invalid/mcp', authorize: 'https://as.conformance.invalid/authorize', token: 'https://as.conformance.invalid/token' });
    const v = validPack(p);
    expect(v.ok, req(id, 'schemas/v2/connection-pack-manifest.schema.json (issuer stays optional, RFC 0199 §E.2)', `an issuer-less reach.mcp + oauth2 manifest MUST still validate — the rule refuses a grant, never a document: ${v.errors}`)).toBe(true);
    const r = await startWith(p);
    if (r === 'absent') return seamAbsent('POST /conformance/seams/sample/oauth/authorize-start is not mounted');
    expect([r.status, r.code, r.url], req(id, `${DOC}; RFC 0199 §E.2`, `a host MUST NOT authorize a reach.mcp + oauth2 provider whose manifest declares no issuer: 422 connection_auth_metadata_mismatch before any authorization URL (got ${r.status} ${r.code})`)).toEqual([422, 'connection_auth_metadata_mismatch', null]);
  });

  it('a reach.mcp provider declaring pkce unsupported is refused with no authorization URL', async () => {
    const g = await oauthGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const id = R('mcp-pkce-verified');
    const p = pack({ id: uniqueId('nopkce'), serverUrl: 'https://mcp.conformance.invalid/mcp', authorize: 'https://as.conformance.invalid/authorize', token: 'https://as.conformance.invalid/token', issuer: 'https://as.conformance.invalid', pkce: 'unsupported' });
    const r = await startWith(p);
    if (r === 'absent') return seamAbsent('authorize-start is not mounted');
    expect([r.status, r.code, r.url], req(id, `${DOC}; RFC 0199 §B.2/§E.2`, `a provider reached as an MCP server MUST use PKCE: pkce unsupported is refused 422 connection_auth_metadata_mismatch before any authorization URL (got ${r.status} ${r.code})`)).toEqual([422, 'connection_auth_metadata_mismatch', null]);
  });

  it('sends resource (RFC 8707) equal to the canonical server URI on the authorization and the token request', async () => {
    const g = await oauthGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const e = await doubles();
    if (!e.ok) return softSkip(e.kind, e.reason);
    const id = R('resource-indicator');
    const p = pack({ id: uniqueId('res'), serverUrl: e.resource.resource, authorize: e.as.authorizeUrl, token: e.as.tokenUrl, issuer: e.as.issuer });
    const r = await startWith(p);
    if (r === 'absent') return seamAbsent('authorize-start is not mounted');
    expect(r.url, req(id, DOC, `a verified reach.mcp provider is authorized: 201 with an authorization URL (got ${r.status} ${r.code})`)).not.toBeNull();
    expect(r.url!.searchParams.get('resource'), req(id, `${DOC}; RFC 8707 §2`, 'the authorization request MUST carry resource = the canonical server URI')).toBe(e.resource.resource);
    const cb = await consent(r.url!.toString());
    const n = e.as.codeExchanges().length;
    const done = await userAgentGet(cb!, loadEnv().apiKey);
    const ex = e.as.codeExchanges().slice(n);
    expect([done.status < 400, ex.length], req(id, DOC, `the callback completes with one token request (got ${done.status})`)).toEqual([true, 1]);
    expect(ex[0]!.params['resource'], req(id, `${DOC}; RFC 8707 §2`, 'the token request MUST carry the same resource')).toBe(e.resource.resource);
  });

  it('discovery verifies and never selects: a PRM naming another issuer, or metadata naming another token endpoint, is refused and contacted nowhere', async () => {
    const g = await oauthGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const e = await doubles();
    if (!e.ok) return softSkip(e.kind, e.reason);
    const id = R('mcp-metadata-bound');
    e.resource.prm = { ...e.resource.prm, authorization_servers: [e.foreign.issuer] };
    const tokensBefore = e.as.tokenRequests.length;
    const one = await startWith(pack({ id: uniqueId('prm'), serverUrl: e.resource.resource, authorize: e.as.authorizeUrl, token: e.as.tokenUrl, issuer: e.as.issuer }));
    if (one === 'absent') return seamAbsent('authorize-start is not mounted');
    expect([one.status, one.code, one.url], req(id, `${DOC} (discovery verifies; it never selects)`, `a PRM whose authorization_servers does not contain the manifest's issuer MUST be refused 422 connection_auth_metadata_mismatch (got ${one.status} ${one.code})`)).toEqual([422, 'connection_auth_metadata_mismatch', null]);
    expect([e.foreign.metadataHits.length, e.foreign.authorizeRequests.length, e.foreign.tokenRequests.length], req(id, DOC, 'the foreign issuer the PRM named MUST receive zero requests — discovery never selects an endpoint')).toEqual([0, 0, 0]);
    e.resource.prm = { ...e.resource.prm, authorization_servers: [e.as.issuer] };
    e.as.metadataOverride = { token_endpoint: `${e.as.issuer}/token-elsewhere` };
    try {
      const two = await startWith(pack({ id: uniqueId('asmd'), serverUrl: e.resource.resource, authorize: e.as.authorizeUrl, token: e.as.tokenUrl, issuer: e.as.issuer }));
      if (two === 'absent') return seamAbsent('authorize-start is not mounted');
      expect([two.status, two.code, two.url], req(id, DOC, `authorization-server metadata whose token_endpoint differs from the manifest MUST be refused (got ${two.status} ${two.code})`)).toEqual([422, 'connection_auth_metadata_mismatch', null]);
    } finally {
      e.as.metadataOverride = {};
    }
    expect(e.as.tokenRequests.length, req(id, DOC, 'a refused discovery sends no token request')).toBe(tokensBefore);
  });

  it('refuses a provider whose authorization-server metadata does not list S256', async () => {
    const g = await oauthGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const e = await doubles();
    if (!e.ok) return softSkip(e.kind, e.reason);
    const id = R('mcp-pkce-verified');
    e.as.codeChallengeMethods = ['plain'];
    try {
      const r = await startWith(pack({ id: uniqueId('plain'), serverUrl: e.resource.resource, authorize: e.as.authorizeUrl, token: e.as.tokenUrl, issuer: e.as.issuer }));
      if (r === 'absent') return seamAbsent('authorize-start is not mounted');
      expect([r.status, r.url], req(id, `${DOC}; RFC 0199 §B.2`, `metadata whose code_challenge_methods_supported lacks S256 MUST be refused with no authorization URL (got ${r.status} ${r.code})`)).toEqual([422, null]);
    } finally {
      e.as.codeChallengeMethods = ['S256'];
    }
  });

  it('pins the verified tuple at registration and refuses a later discovery that disagrees', async () => {
    const g = await oauthGate();
    if (!g.ok) return softSkip(g.kind, g.reason);
    const e = await doubles();
    if (!e.ok) return softSkip(e.kind, e.reason);
    const id = R('mcp-metadata-bound');
    const p = pack({ id: uniqueId('pin'), serverUrl: e.resource.resource, authorize: e.as.authorizeUrl, token: e.as.tokenUrl, issuer: e.as.issuer });
    const first = await startWith(p);
    if (first === 'absent') return seamAbsent('authorize-start is not mounted');
    expect(first.url, req(id, DOC, `positive control: the pack verifies and is authorized at registration (got ${first.status} ${first.code})`)).not.toBeNull();
    e.resource.prm = { ...e.resource.prm, authorization_servers: [e.foreign.issuer] };
    try {
      const later = await startWith(p);
      if (later === 'absent') return seamAbsent('authorize-start is not mounted');
      expect([later.status, later.code, later.url], req(id, `${DOC} (pinned at registration, RFC 0199 §B.4)`, `a PRM changed after registration (now naming another issuer) MUST be refused on the next grant, not adopted silently (got ${later.status} ${later.code})`)).toEqual([422, 'connection_auth_metadata_mismatch', null]);
      expect(e.foreign.metadataHits.length + e.foreign.tokenRequests.length, req(id, DOC, 'the newly named issuer is contacted nowhere')).toBe(0);
    } finally {
      e.resource.prm = { ...e.resource.prm, authorization_servers: [e.as.issuer] };
    }
  });
});
