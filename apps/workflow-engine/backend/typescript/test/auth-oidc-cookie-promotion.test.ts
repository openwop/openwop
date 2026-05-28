/**
 * Regression coverage for the cookie-vs-bearer identity coherence fix:
 * when a request arrives with a valid OIDC bearer token AND an anon
 * session cookie, the middleware MUST promote the session cookie to a
 * user-tier cookie keyed to the OIDC-derived tenantId. Without the
 * promotion the cookie path and bearer path disagree about identity —
 * the next request that drops the Authorization header falls back to
 * the still-anon cookie and lands at managed-dispatch as anon, which
 * was the root cause of `sign_in_required` for signed-in users on the
 * free tier.
 *
 * Three checks:
 *   1. Anon cookie + valid OIDC bearer → response carries a Set-Cookie
 *      reissuing the session as `tier:'user'` with the OIDC tenantId.
 *   2. Already-promoted user cookie + matching OIDC bearer → no
 *      Set-Cookie reissued (idempotent steady state).
 *   3. No cookie + valid OIDC bearer → cookie minted at user-tier on
 *      the spot so the next request is covered.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import http from 'node:http';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { authMiddleware, _resetOidcVerifier } from '../src/middleware/auth.js';

interface SyntheticIssuer {
  issuer: string;
  audience: string;
  jwksUrl: string;
  mint(overrides?: Partial<{ sub: string }>): string;
  close: () => Promise<void>;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function startSyntheticIssuer(audience: string): Promise<SyntheticIssuer> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-kid-promo';
  const pubJwk = publicKey.export({ format: 'jwk' });
  const jwks = { keys: [{ ...pubJwk, kid, alg: 'RS256', use: 'sig' }] };
  const app = express();
  app.get('/.well-known/jwks.json', (_req, res) => res.json(jwks));
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const issuer = `http://127.0.0.1:${port}`;
  return {
    issuer,
    audience,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    mint(overrides = {}) {
      const now = Math.floor(Date.now() / 1000);
      const header = { alg: 'RS256', kid, typ: 'JWT' };
      const payload = {
        iss: issuer,
        aud: audience,
        sub: overrides.sub ?? 'firebase-uid-promo',
        iat: now,
        exp: now + 300,
      };
      const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
      const sig = createSign('sha256').update(signingInput).sign(privateKey as KeyObject);
      return `${signingInput}.${b64url(sig)}`;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let appServer: http.Server;
let appPort: number;
let issuer: SyntheticIssuer;

beforeAll(async () => {
  issuer = await startSyntheticIssuer('openwop-promo-aud');
  process.env.OPENWOP_OIDC_ISSUER = issuer.issuer;
  process.env.OPENWOP_OIDC_AUDIENCE = issuer.audience;
  process.env.OPENWOP_OIDC_JWKS_URL = issuer.jwksUrl;
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = ''; // cookie mode ON
  process.env.OPENWOP_SESSION_SECRET = 'a'.repeat(48);
  _resetOidcVerifier();

  const app: Express = express();
  app.use(express.json());
  app.use(authMiddleware());
  app.get('/v1/test/whoami', (req, res) =>
    res.json({ tenantId: req.tenantId, principalId: req.principal?.principalId }),
  );
  appServer = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  appPort = (appServer.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => appServer.close(() => r()));
  await issuer.close();
  delete process.env.OPENWOP_OIDC_ISSUER;
  delete process.env.OPENWOP_OIDC_AUDIENCE;
  delete process.env.OPENWOP_OIDC_JWKS_URL;
  delete process.env.OPENWOP_AUTH_DISABLE_COOKIES;
  delete process.env.OPENWOP_SESSION_SECRET;
  _resetOidcVerifier();
});

function extractCookieValue(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const head = setCookie.split(';')[0];
  if (!head) return null;
  return head.trim();
}

function getCookieValue(kv: string): string {
  const eq = kv.indexOf('=');
  return eq > 0 ? kv.slice(eq + 1) : kv;
}

function decodePayload(cookieValue: string): { tenantId: string; tier: string } | null {
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = cookieValue.slice(0, dot);
  let pad = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
  while (pad.length % 4 !== 0) pad += '=';
  try {
    return JSON.parse(Buffer.from(pad, 'base64').toString('utf8')) as { tenantId: string; tier: string };
  } catch {
    return null;
  }
}

describe('OIDC verify → session cookie promotion', () => {
  it('reissues an anon cookie as user-tier when OIDC verifies', async () => {
    // 1. Anonymous request mints an anon cookie.
    const anonRes = await fetch(`http://127.0.0.1:${appPort}/v1/test/whoami`);
    expect(anonRes.status).toBe(200);
    const anonCookieKv = extractCookieValue(anonRes.headers.get('set-cookie'));
    expect(anonCookieKv).toBeTruthy();
    const anonPayload = decodePayload(getCookieValue(anonCookieKv!));
    expect(anonPayload?.tier).toBe('anon');
    expect(anonPayload?.tenantId.startsWith('anon:')).toBe(true);

    // 2. Same browser signs in: same anon cookie + valid OIDC bearer.
    const token = issuer.mint({ sub: 'firebase-uid-alice' });
    const promoteRes = await fetch(`http://127.0.0.1:${appPort}/v1/test/whoami`, {
      headers: { authorization: `Bearer ${token}`, cookie: anonCookieKv! },
    });
    expect(promoteRes.status).toBe(200);
    const body = (await promoteRes.json()) as { tenantId: string };
    expect(body.tenantId).toMatch(/^user:[0-9a-f]{32}$/);

    // 3. Response MUST reissue the cookie as user-tier.
    const promotedCookieKv = extractCookieValue(promoteRes.headers.get('set-cookie'));
    expect(promotedCookieKv).toBeTruthy();
    const promotedPayload = decodePayload(getCookieValue(promotedCookieKv!));
    expect(promotedPayload?.tier).toBe('user');
    expect(promotedPayload?.tenantId).toBe(body.tenantId);
  });

  it('is idempotent: an already-user cookie matching the bearer is not reissued', async () => {
    // Bootstrap an upgraded cookie via one promotion request.
    const anonRes = await fetch(`http://127.0.0.1:${appPort}/v1/test/whoami`);
    const anonCookieKv = extractCookieValue(anonRes.headers.get('set-cookie'))!;
    const token = issuer.mint({ sub: 'firebase-uid-bob' });
    const promoteRes = await fetch(`http://127.0.0.1:${appPort}/v1/test/whoami`, {
      headers: { authorization: `Bearer ${token}`, cookie: anonCookieKv },
    });
    const userCookieKv = extractCookieValue(promoteRes.headers.get('set-cookie'))!;

    // Now resend with the user cookie AND the matching bearer — no
    // Set-Cookie should appear because identity already agrees.
    const steady = await fetch(`http://127.0.0.1:${appPort}/v1/test/whoami`, {
      headers: { authorization: `Bearer ${token}`, cookie: userCookieKv },
    });
    expect(steady.status).toBe(200);
    expect(steady.headers.get('set-cookie')).toBeNull();
  });

  it('mints a user-tier cookie when no prior cookie exists', async () => {
    const token = issuer.mint({ sub: 'firebase-uid-carol' });
    const res = await fetch(`http://127.0.0.1:${appPort}/v1/test/whoami`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const cookieKv = extractCookieValue(res.headers.get('set-cookie'));
    expect(cookieKv).toBeTruthy();
    const payload = decodePayload(getCookieValue(cookieKv!));
    expect(payload?.tier).toBe('user');
    expect(payload?.tenantId).toMatch(/^user:[0-9a-f]{32}$/);
  });
});
