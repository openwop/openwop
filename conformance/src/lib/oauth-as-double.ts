/**
 * RFC 0199 — a suite-owned OAuth 2.0 authorization-server double, and a
 * protected-resource double (RFC 9728) for the MCP-reach legs.
 *
 * The host under test is the OAuth CLIENT. Every leg that asserts "the host
 * made no token request" reads THIS double's counter, which the suite owns —
 * never the host's own ledger (a row that reads the host's ledger to prove the
 * host did not act cannot fail).
 *
 *   GET  /.well-known/oauth-authorization-server   RFC 8414 metadata (switchable)
 *   GET  /authorize                                  plays the consenting user: 302 to
 *                                                    redirect_uri?code&state[&iss]
 *   POST /token                                      authorization_code (PKCE-checked)
 *                                                    and refresh_token; EVERY request counted
 *
 * The protected-resource double serves `/.well-known/oauth-protected-resource<path>`
 * and answers any other request `401` with a `resource_metadata` challenge.
 *
 * Reachability. Each double listens on loopback (or `OPENWOP_CONFORMANCE_HARNESS_HOST`)
 * and is advertised through `resolvePublicFront`, so an operator can front it
 * with a public https tunnel: `OPENWOP_OAUTH_AS_URL` (+ `_PORT` to pin the
 * listener), `OPENWOP_OAUTH_AS2_URL` (the foreign issuer a PRM may name), and
 * `OPENWOP_OAUTH_RESOURCE_URL`. Without a front the host must relax its egress
 * guard to reach them, which a bundle records as a relaxation.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { receiverBinding, resolvePublicFront } from './webhook-receiver.js';
import { driver, type OpenWOPResponse } from './driver.js';
import { v2Discovery, familyAdvertised } from './v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from './seams.js';

export interface TokenRequest {
  grantType: string;
  params: Record<string, string>;
  at: number;
  status: number;
  /** why the double refused it, when it did */
  refused?: string;
}

export interface AuthorizeRequest { params: Record<string, string>; at: number }

interface CodeRecord { clientId: string; redirectUri: string; challenge: string | null; method: string | null; resource: string | null; used: boolean; scope: string }

export interface AsDouble {
  /** The issuer identifier — the public front when set, else the local URL. No trailing slash. */
  readonly issuer: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly tunnelled: boolean;
  readonly tokenRequests: TokenRequest[];
  readonly authorizeRequests: AuthorizeRequest[];
  readonly metadataHits: string[];
  /** RFC 9207 — advertise authorization_response_iss_parameter_supported (default true). */
  issParameterSupported: boolean;
  /** RFC 8414 code_challenge_methods_supported (default ['S256']; `null` omits the member). */
  codeChallengeMethods: string[] | null;
  /** Overrides for the metadata document (a mismatch the host must refuse). */
  metadataOverride: Record<string, unknown>;
  /** When true every refresh_token grant is refused invalid_grant (a revoked refresh token). */
  refreshRevoked: boolean;
  /** Token requests whose grant is authorization_code. */
  codeExchanges(): TokenRequest[];
  close(): Promise<void>;
}

export const S256 = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
  });
}

function formOf(body: string, contentType: string | undefined): Record<string, string> {
  if (contentType !== undefined && /json/i.test(contentType)) {
    try { return Object.fromEntries(Object.entries(JSON.parse(body) as Record<string, unknown>).map(([k, v]) => [k, String(v)])); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(body).entries());
}

async function listen(server: Server, portEnv: string): Promise<string> {
  const pinned = Number(process.env[portEnv] ?? '');
  const port = Number.isInteger(pinned) && pinned > 0 && pinned < 65536 ? pinned : 0;
  const binding = receiverBinding();
  // A pinned port is shared by every scenario file that starts this double, and
  // vitest runs files in parallel: wait for the holder to close rather than fail.
  const deadline = Date.now() + 25_000;
  for (;;) {
    const e = await new Promise<NodeJS.ErrnoException | null>((ok) => {
      const onErr = (err: NodeJS.ErrnoException): void => ok(err);
      server.once('error', onErr);
      server.listen(port, binding.bind, () => { server.off('error', onErr); ok(null); });
    });
    if (e === null) break;
    if (e.code !== 'EADDRINUSE' || port === 0 || Date.now() > deadline) throw e;
    await new Promise((ok) => setTimeout(ok, 250));
  }
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('double address unavailable');
  return `http://${binding.advertise}:${addr.port}`;
}

/** Start an authorization-server double. `frontEnv` names its public front (default OPENWOP_OAUTH_AS_URL). */
export async function startAsDouble(frontEnv = 'OPENWOP_OAUTH_AS_URL'): Promise<AsDouble> {
  const tokenRequests: TokenRequest[] = [];
  const authorizeRequests: AuthorizeRequest[] = [];
  const metadataHits: string[] = [];
  const codes = new Map<string, CodeRecord>();
  const refresh = new Set<string>();
  let issuer = '';
  const state = {
    issParameterSupported: true,
    codeChallengeMethods: ['S256'] as string[] | null,
    metadataOverride: {} as Record<string, unknown>,
    refreshRevoked: false,
  };
  const json = (res: ServerResponse, status: number, body: unknown): void => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://double');
      if (req.method === 'GET' && url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
        metadataHits.push(url.pathname);
        const md: Record<string, unknown> = {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          authorization_response_iss_parameter_supported: state.issParameterSupported,
          ...(state.codeChallengeMethods === null ? {} : { code_challenge_methods_supported: state.codeChallengeMethods }),
          ...state.metadataOverride,
        };
        return json(res, 200, md);
      }
      if (req.method === 'GET' && url.pathname === '/authorize') {
        const params = Object.fromEntries(url.searchParams.entries());
        authorizeRequests.push({ params, at: Date.now() });
        const redirectUri = params['redirect_uri'];
        if (params['response_type'] !== 'code' || redirectUri === undefined) return json(res, 400, { error: 'invalid_request' });
        const code = `code-${randomBytes(12).toString('hex')}`;
        codes.set(code, { clientId: params['client_id'] ?? '', redirectUri, challenge: params['code_challenge'] ?? null, method: params['code_challenge_method'] ?? null, resource: params['resource'] ?? null, used: false, scope: params['scope'] ?? '' });
        const to = new URL(redirectUri);
        to.searchParams.set('code', code);
        if (params['state'] !== undefined) to.searchParams.set('state', params['state']);
        to.searchParams.set('iss', issuer);
        res.writeHead(302, { Location: to.toString() });
        return res.end();
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        const params = formOf(await readBody(req), req.headers['content-type']);
        const grantType = params['grant_type'] ?? '';
        const record = (status: number, refused?: string): void => { tokenRequests.push({ grantType, params, at: Date.now(), status, ...(refused ? { refused } : {}) }); };
        if (grantType === 'authorization_code') {
          const c = codes.get(params['code'] ?? '');
          if (!c || c.used) { record(400, 'unknown or used code'); return json(res, 400, { error: 'invalid_grant' }); }
          c.used = true;
          if (params['redirect_uri'] !== c.redirectUri) { record(400, 'redirect_uri mismatch'); return json(res, 400, { error: 'invalid_grant' }); }
          if (c.challenge !== null) {
            const verifier = params['code_verifier'] ?? '';
            const ok = c.method === 'S256' ? S256(verifier) === c.challenge : verifier === c.challenge;
            if (!ok) { record(400, 'PKCE verifier does not match'); return json(res, 400, { error: 'invalid_grant' }); }
          }
          const rt = `rt-${randomBytes(12).toString('hex')}`;
          refresh.add(rt);
          record(200);
          return json(res, 200, { access_token: `at-${randomBytes(12).toString('hex')}`, token_type: 'Bearer', expires_in: 3600, refresh_token: rt, scope: c.scope });
        }
        if (grantType === 'refresh_token') {
          if (state.refreshRevoked || !refresh.has(params['refresh_token'] ?? '')) { record(400, 'refresh token revoked'); return json(res, 400, { error: 'invalid_grant' }); }
          record(200);
          return json(res, 200, { access_token: `at-${randomBytes(12).toString('hex')}`, token_type: 'Bearer', expires_in: 3600 });
        }
        record(400, 'unsupported grant');
        return json(res, 400, { error: 'unsupported_grant_type' });
      }
      return json(res, 404, { error: 'not_found' });
    })();
  });
  const local = await listen(server, frontEnv.replace(/_URL$/, '_PORT'));
  const front = resolvePublicFront(frontEnv, local);
  issuer = front.url.replace(/\/+$/, '');
  const d: AsDouble = {
    issuer,
    authorizeUrl: `${issuer}/authorize`,
    tokenUrl: `${issuer}/token`,
    tunnelled: front.tunnelled,
    tokenRequests,
    authorizeRequests,
    metadataHits,
    get issParameterSupported() { return state.issParameterSupported; },
    set issParameterSupported(v: boolean) { state.issParameterSupported = v; },
    get codeChallengeMethods() { return state.codeChallengeMethods; },
    set codeChallengeMethods(v: string[] | null) { state.codeChallengeMethods = v; },
    get metadataOverride() { return state.metadataOverride; },
    set metadataOverride(v: Record<string, unknown>) { state.metadataOverride = v; },
    get refreshRevoked() { return state.refreshRevoked; },
    set refreshRevoked(v: boolean) { state.refreshRevoked = v; },
    codeExchanges: () => tokenRequests.filter((t) => t.grantType === 'authorization_code'),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
  return d;
}

export interface ResourceDouble {
  /** The protected resource's canonical URI (the MCP server URL a pack names). */
  readonly resource: string;
  readonly tunnelled: boolean;
  readonly hits: string[];
  /** The PRM document served; mutate to rewrite it (the pinning leg). */
  prm: Record<string, unknown>;
  close(): Promise<void>;
}

/** Start a protected-resource double at path `/mcp`, whose PRM names `authorizationServers`. */
export async function startResourceDouble(authorizationServers: string[], frontEnv = 'OPENWOP_OAUTH_RESOURCE_URL'): Promise<ResourceDouble> {
  const hits: string[] = [];
  let resource = '';
  const holder = { prm: {} as Record<string, unknown> };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://double');
    hits.push(`${req.method ?? ''} ${url.pathname}`);
    if (req.method === 'GET' && url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(holder.prm));
    }
    res.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${new URL(resource).origin}/.well-known/oauth-protected-resource/mcp"` });
    return res.end();
  });
  const local = await listen(server, frontEnv.replace(/_URL$/, '_PORT'));
  const front = resolvePublicFront(frontEnv, local);
  resource = `${front.url.replace(/\/+$/, '')}/mcp`;
  holder.prm = { resource, authorization_servers: authorizationServers, bearer_methods_supported: ['header'] };
  return {
    resource,
    tunnelled: front.tunnelled,
    hits,
    get prm() { return holder.prm; },
    set prm(v: Record<string, unknown>) { holder.prm = v; },
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

/**
 * Play the user agent through one grant: GET the authorization URL at the
 * double (it answers 302 to the host's redirect URI with code/state/iss) and
 * return that callback URL, unfollowed, so a leg can alter it before the host
 * sees it.
 */
export async function consent(authorizationUrl: string): Promise<URL | null> {
  const res = await fetch(authorizationUrl, { redirect: 'manual' });
  const loc = res.headers.get('location');
  return res.status >= 300 && res.status < 400 && loc !== null ? new URL(loc) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Host-side helpers shared by the three RFC 0199 scenarios.
// ─────────────────────────────────────────────────────────────────────────────


export const AUTHORIZE_START = `${SEAMS_PREFIX}/sample/oauth/authorize-start`;
export const EXPIRE_REFRESH = `${SEAMS_PREFIX}/sample/oauth/expire-refresh`;
const MINT = `${SEAMS_PREFIX}/sample/auth/credential/mint`;

export type OAuthGate = { ok: true; oauth: Record<string, unknown>; providers: Set<string> } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };

/** `oauth` advertised at major 2 with `authorization_code`, and the seams profile (the grant is driven through `authorize-start`). */
export async function oauthGate(): Promise<OAuthGate> {
  const doc = await v2Discovery();
  if (!doc) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const oauth = await familyAdvertised('oauth');
  if (!oauth) return { ok: false, kind: 'inapplicable', reason: 'oauth not advertised at major 2 — the host is not an OAuth client' };
  const grants = Array.isArray(oauth['grants']) ? (oauth['grants'] as unknown[]).map(String) : [];
  if (!grants.includes('authorization_code')) return { ok: false, kind: 'inapplicable', reason: `oauth.grants [${grants.join(', ')}] does not list authorization_code` };
  // An absent seams advert means the host never claimed the instrument — inapplicable, not blocked.
  if (!seamsProfileAdvertised(doc)) return { ok: false, kind: 'inapplicable', reason: 'conformance.seamsProfile not advertised (the host claims no seams instrument) — the grant can only be driven against the suite\'s authorization-server double through the authorize-start seam' };
  const providers = new Set((Array.isArray(oauth['providers']) ? (oauth['providers'] as Array<{ id?: unknown }>) : []).map((p) => String(p.id)));
  return { ok: true, oauth, providers };
}

const bearerInit = (bearer: string | undefined): { authenticated?: boolean; headers?: Record<string, string> } =>
  bearer === undefined ? {} : { authenticated: false, headers: { Authorization: `Bearer ${bearer}` } };

/** POST the authorize-start seam as `bearer` (default: the suite's key). */
export function authorizeStart(body: Record<string, unknown>, bearer?: string): Promise<OpenWOPResponse> {
  return driver.post(AUTHORIZE_START, body, bearerInit(bearer));
}

/** The `authorizationUrl` a 201 answered, parsed; null otherwise. */
export function authorizationUrlOf(r: OpenWOPResponse): URL | null {
  const u = (r.json as { authorizationUrl?: unknown } | undefined)?.authorizationUrl;
  if (r.status !== 201 || typeof u !== 'string') return null;
  try { return new URL(u); } catch { return null; }
}

/** GET a host URL as the user agent (a callback or a connectUrl), never following a redirect. */
export async function userAgentGet(url: string | URL, bearer: string | null): Promise<{ status: number; location: string | null; text: string }> {
  const res = await fetch(url, { redirect: 'manual', headers: bearer === null ? { Accept: 'application/json' } : { Accept: 'application/json', Authorization: `Bearer ${bearer}` } });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}

/**
 * A second Subject: a fresh credential from the per-lane mint seam (same
 * tenant, new subject), else OPENWOP_TEST_TENANT_B_API_KEY. null ⇒ the
 * same-Subject legs are blocked.
 */
export async function secondSubject(): Promise<{ bearer: string; how: string } | null> {
  const minted = await driver.post(MINT, { lane: 'api-key' }).catch(() => null);
  const cred = (minted?.json as { credential?: unknown } | undefined)?.credential;
  if (minted !== null && minted.status < 300 && typeof cred === 'string') return { bearer: cred, how: 'a fresh api-key Subject from the credential mint seam' };
  const b = process.env['OPENWOP_TEST_TENANT_B_API_KEY'];
  return b ? { bearer: b, how: 'OPENWOP_TEST_TENANT_B_API_KEY' } : null;
}
