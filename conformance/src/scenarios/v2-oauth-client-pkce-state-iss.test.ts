/**
 * RFC 0199 §A — the host as an OAuth authorization-code client
 * (`spec/v2/core/oauth.md` §The authorization-code client). Target major 2.
 *
 * Gate: the v2 `oauth` record lists `authorization_code` and advertises the
 * provider `synthetic`, and the host advertises the seams profile. The grant is
 * driven through `POST /conformance/seams/sample/oauth/authorize-start`
 * (api/seams-v2.yaml), which points the provider at the suite's
 * authorization-server double and returns the URL the host's PRODUCTION
 * authorization-URL builder produced; the suite then plays the user agent
 * against the double and against the host's PRODUCTION callback. A seam that
 * answers 404 is `blocked`, never a pass.
 *
 * The witness is the double's token-request counter (`lib/oauth-as-double.ts`):
 * every "the host refused the callback" leg asserts ZERO new token requests at
 * a server the suite owns, and each carries a positive control that the same
 * path, unaltered, does make one — so a host that refuses everything fails too.
 *
 * Reachability: the host must reach the double. Front it with a public https
 * tunnel (`OPENWOP_OAUTH_AS_URL`), or the host must relax its egress guard for
 * loopback, which a bundle records as a relaxation.
 *
 * @see spec/v2/core/oauth.md §The authorization-code client
 * @see RFCS/0199-outbound-oauth-client-and-credential-interrupt.md §A
 * @see SECURITY/invariants.yaml id: oauth-same-user-binding
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadEnv } from '../lib/env.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { S256, authorizeStart, authorizationUrlOf, consent, oauthGate, secondSubject, startAsDouble, userAgentGet, type AsDouble } from '../lib/oauth-as-double.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'the suite plays the user agent: it reads the authorization URL from the authorize-start seam, consents at its own authorization-server double, and GETs the host\'s callback itself; the double is the only fixture the host reaches';

const DOC = 'spec/v2/core/oauth.md §The authorization-code client (RFC 0199 §A)';
const R = (slug: string): string => `openwop.requirement.0199.${slug}`;
const PROVIDER = 'synthetic';
const ISSUERLESS = ['synthetic-noiss', 'synthetic-noiss-b'];
const SCOPES = ['openwop.read'];

let double: AsDouble | null = null;
async function as(): Promise<AsDouble> { double ??= await startAsDouble(); return double; }
afterAll(async () => { await double?.close(); double = null; });

type Ready = { ok: true; d: AsDouble } | { ok: false; skip: () => undefined };
async function ready(providers: string[] = [PROVIDER]): Promise<Ready> {
  const g = await oauthGate();
  if (!g.ok) return { ok: false, skip: () => softSkip(g.kind, g.reason) };
  const missing = providers.filter((p) => !g.providers.has(p));
  if (missing.length > 0) return { ok: false, skip: () => softSkip('blocked', `oauth.providers does not list ${missing.join(', ')} — the suite's synthetic provider(s) (conformance/fixtures/oauth-providers/synthetic.json)`) };
  return { ok: true, d: await as() };
}

const withIssuer = (d: AsDouble, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ provider: PROVIDER, authUrl: d.authorizeUrl, tokenUrl: d.tokenUrl, issuer: d.issuer, scopes: SCOPES, ...extra });

/** authorize-start → the authorization URL, or a recorded skip/fail. */
async function start(body: Record<string, unknown>, id: string, bearer?: string): Promise<URL | 'absent'> {
  const r = await authorizeStart(body, bearer);
  if (r.status === 404 || r.status === 405) return 'absent';
  const url = authorizationUrlOf(r);
  expect(url, req(id, 'api/seams-v2.yaml startOAuthAuthorization', `authorize-start MUST answer 201 { authorizationUrl } for an advertised provider (got ${r.status} ${r.text.slice(0, 300)})`)).not.toBeNull();
  return url as URL;
}

describe('RFC 0199 §A — v2-oauth-client-pkce-state-iss (host as OAuth client, gated on oauth + authorization_code + seams)', () => {
  it('sends PKCE S256 and the verifier at the token endpoint hashes to the challenge', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const { d } = r;
    const id = R('pkce-s256');
    const url = await start(withIssuer(d), id);
    if (url === 'absent') return seamAbsent('POST /conformance/seams/sample/oauth/authorize-start is not mounted — the grant cannot be driven against the suite\'s double');
    expect(`${url.origin}${url.pathname}`, req(id, DOC, 'the authorization URL MUST be the provider\'s authorization endpoint (the double\'s)')).toBe(d.authorizeUrl);
    expect(url.searchParams.get('code_challenge_method'), req(id, `${DOC} rule 1`, `PKCE MUST use S256, never plain (got ${url.searchParams.get('code_challenge_method')})`)).toBe('S256');
    const challenge = url.searchParams.get('code_challenge') ?? '';
    expect(/^[A-Za-z0-9_-]{43}$/.test(challenge), req(id, `${DOC} rule 1; RFC 7636 §4.2`, `code_challenge MUST be BASE64URL(SHA256(verifier)) — 43 characters (got ${JSON.stringify(challenge)})`)).toBe(true);
    const callback = await consent(url.toString());
    expect(callback, req(id, DOC, 'the double answers the authorization request with a redirect to the host\'s redirect URI')).not.toBeNull();
    const before = d.codeExchanges().length;
    const cb = await userAgentGet(callback!, loadEnv().apiKey);
    expect(cb.status, req(id, DOC, `positive control: the unaltered callback, authenticated as the initiating Subject, MUST complete (got ${cb.status} ${cb.text.slice(0, 200)})`)).toBeLessThan(400);
    const exchanges = d.codeExchanges().slice(before);
    expect(exchanges.length, req(id, DOC, 'the completed callback makes exactly one token request at the provider')).toBe(1);
    const verifier = exchanges[0]!.params['code_verifier'] ?? '';
    expect(verifier.length >= 43 && S256(verifier) === challenge, req(id, `${DOC} rule 1; RFC 7636 §4.6`, 'the code_verifier sent to the token endpoint MUST hash (S256) to the challenge sent in the authorization request')).toBe(true);
    expect(exchanges[0]!.status, req(id, DOC, `the double accepted the exchange (${exchanges[0]!.refused ?? 'ok'})`)).toBe(200);
  });

  it('sends a fresh state per grant, and a forged, missing or replayed state makes no token request', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const { d } = r;
    const id = R('state-single-use');
    const a = await start(withIssuer(d), id);
    if (a === 'absent') return seamAbsent('authorize-start is not mounted');
    const b = await start(withIssuer(d), id);
    if (b === 'absent') return seamAbsent('authorize-start is not mounted');
    const sa = a.searchParams.get('state') ?? ''; const sb = b.searchParams.get('state') ?? '';
    expect(sa.length >= 22 && sb.length >= 22, req(id, `${DOC} rule 2`, `state MUST be present and carry at least 128 bits (got ${sa.length} and ${sb.length} characters)`)).toBe(true);
    expect(sa, req(id, `${DOC} rule 2`, 'state MUST be fresh for every grant')).not.toBe(sb);
    const cbA = await consent(a.toString());
    const cbB = await consent(b.toString());
    expect(cbA !== null && cbB !== null, req(id, DOC, 'the double redirects both grants to the host')).toBe(true);
    const key = loadEnv().apiKey;

    const forged = new URL(cbA!.toString()); forged.searchParams.set('state', randomBytes(24).toString('base64url'));
    let n = d.codeExchanges().length;
    const f = await userAgentGet(forged, key);
    expect([f.status >= 400, d.codeExchanges().length], req(id, `${DOC} rule 2`, `a callback whose state is unknown MUST be refused with no token request (got ${f.status}, ${d.codeExchanges().length - n} token request(s))`)).toEqual([true, n]);

    const bare = new URL(cbB!.toString()); bare.searchParams.delete('state');
    const m = await userAgentGet(bare, key);
    expect([m.status >= 400, d.codeExchanges().length], req(id, `${DOC} rule 2`, `a callback with no state MUST be refused with no token request (got ${m.status})`)).toEqual([true, n]);

    const ok = await userAgentGet(cbA!, key);
    expect([ok.status < 400, d.codeExchanges().length], req(id, DOC, `positive control: the genuine callback completes with one token request (got ${ok.status} ${ok.text.slice(0, 200)})`)).toEqual([true, n + 1]);
    n = d.codeExchanges().length;
    const replay = await userAgentGet(cbA!, key);
    expect([replay.status >= 400, d.codeExchanges().length], req(id, `${DOC} rule 2`, `a replayed (already consumed) state MUST be refused with no token request (got ${replay.status})`)).toEqual([true, n]);
    // 120 s, not the 30 s default (2.37.2): this leg makes eight sequential
    // round trips — two grants, two consents, four callbacks — and on a public
    // cut every one crosses the operator's tunnel to the AS double. The
    // 2026-09-24 public v2-reference cut on 2.37.1 timed out here at 30 s while
    // the sibling legs (pkce-s256, iss-validated, same-user-callback), which
    // make fewer trips, passed. No assertion or window inside the leg changes.
  }, 120_000);

  it('a callback authenticated as another Subject makes no token request and stores nothing', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const { d } = r;
    const id = R('same-user-callback');
    const other = await secondSubject();
    if (other === null) return softSkip('blocked', 'no second Subject: the credential mint seam is not mounted and OPENWOP_TEST_TENANT_B_API_KEY is not set');
    const url = await start(withIssuer(d), id);
    if (url === 'absent') return seamAbsent('authorize-start is not mounted');
    const cb = await consent(url.toString());
    expect(cb, req(id, DOC, 'the double redirects the grant to the host')).not.toBeNull();
    const n = d.codeExchanges().length;
    const wrong = await userAgentGet(cb!, other.bearer);
    expect([wrong.status >= 400, d.codeExchanges().length], req(id, `${DOC} rule 3; invariant oauth-same-user-binding`, `the callback of Subject A's grant, authenticated as another Subject (${other.how}), MUST be refused and make no token request (got ${wrong.status}, ${d.codeExchanges().length - n} token request(s))`)).toEqual([true, n]);
    // Positive control on the same path: a grant the second Subject itself started completes for it.
    const own = await start(withIssuer(d), id, other.bearer);
    if (own === 'absent') return seamAbsent('authorize-start is not mounted');
    const ownCb = await consent(own.toString());
    const done = await userAgentGet(ownCb!, other.bearer);
    expect([done.status < 400, d.codeExchanges().length], req(id, DOC, `positive control: the second Subject's own grant completes for it with one token request (got ${done.status} ${done.text.slice(0, 200)})`)).toEqual([true, n + 1]);
  });

  it('a wrong or missing iss (with authorization_response_iss_parameter_supported) makes no token request', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const { d } = r;
    const id = R('iss-validated');
    d.issParameterSupported = true;
    const key = loadEnv().apiKey;
    const one = await start(withIssuer(d), id);
    if (one === 'absent') return seamAbsent('authorize-start is not mounted');
    const cb1 = await consent(one.toString());
    const wrong = new URL(cb1!.toString()); wrong.searchParams.set('iss', `${d.issuer}/evil`);
    let n = d.codeExchanges().length;
    const w = await userAgentGet(wrong, key);
    expect([w.status >= 400, d.codeExchanges().length], req(id, `${DOC} rule 4; RFC 9207 §2.4`, `a response whose iss differs from the provider's issuer MUST be refused before any token request (got ${w.status})`)).toEqual([true, n]);
    const two = await start(withIssuer(d), id);
    if (two === 'absent') return seamAbsent('authorize-start is not mounted');
    const cb2 = await consent(two.toString());
    const missing = new URL(cb2!.toString()); missing.searchParams.delete('iss');
    const m = await userAgentGet(missing, key);
    expect([m.status >= 400, d.codeExchanges().length], req(id, `${DOC} rule 4; RFC 9207 §2.4`, `a response without iss from a provider whose metadata sets authorization_response_iss_parameter_supported MUST be refused before any token request (got ${m.status})`)).toEqual([true, n]);
    const three = await start(withIssuer(d), id);
    if (three === 'absent') return seamAbsent('authorize-start is not mounted');
    const cb3 = await consent(three.toString());
    const good = await userAgentGet(cb3!, key);
    n += 1;
    expect([good.status < 400, d.codeExchanges().length], req(id, DOC, `positive control: the same grant with the issuer's own iss completes (got ${good.status} ${good.text.slice(0, 200)})`)).toEqual([true, n]);
  });

  it('issuer-less providers get redirect URIs no other provider shares', async () => {
    const r = await ready([PROVIDER, ...ISSUERLESS]);
    if (!r.ok) return r.skip();
    const { d } = r;
    const id = R('iss-validated');
    const uris: string[] = [];
    for (const provider of [PROVIDER, ...ISSUERLESS]) {
      const body = provider === PROVIDER ? withIssuer(d) : { provider, authUrl: d.authorizeUrl, tokenUrl: d.tokenUrl, scopes: SCOPES };
      const url = await start(body, id);
      if (url === 'absent') return seamAbsent('authorize-start is not mounted');
      uris.push(url.searchParams.get('redirect_uri') ?? '');
    }
    expect(uris.every((u) => u.length > 0), req(id, DOC, 'every authorization URL carries redirect_uri')).toBe(true);
    expect(new Set(uris).size, req(id, `${DOC} rule 4; RFC 9700 §4.4.2.2`, `a provider with no known issuer MUST get a redirect URI no other provider on the host shares (got ${JSON.stringify(uris)})`)).toBe(uris.length);
  });

  it('the redirect URI is fixed per provider whatever the request carries', async () => {
    const r = await ready();
    if (!r.ok) return r.skip();
    const { d } = r;
    const id = R('redirect-uri-fixed');
    const first = await start(withIssuer(d), id);
    if (first === 'absent') return seamAbsent('authorize-start is not mounted');
    const probe = 'https://attacker.example/openwop/oauth/callback';
    const second = await start(withIssuer(d, { redirectUri: probe }), id);
    if (second === 'absent') return seamAbsent('authorize-start is not mounted');
    const a = first.searchParams.get('redirect_uri'); const b = second.searchParams.get('redirect_uri');
    expect(b, req(id, `${DOC} rule 5`, 'the redirect URI MUST NOT be derived from request input')).not.toBe(probe);
    expect(b, req(id, `${DOC} rule 5`, `one fixed redirect URI per provider: two grants for one provider carry the same redirect_uri (got ${a} and ${b})`)).toBe(a);
  });
});
