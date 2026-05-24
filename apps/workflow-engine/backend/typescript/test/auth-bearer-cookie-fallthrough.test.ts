/**
 * Coverage for the bearer-token fall-through to cookie path landed
 * 2026-05-24. Without this behavior, the Firebase JS SDK's ~hourly
 * ID-token rotation would surface as 401 storms on every request that
 * lands in the few-second window between rotation events — including
 * the `listOpenInterrupts` GET that surfaces the approval card after
 * a workflow suspends.
 *
 * Three cases (cookies enabled — the browser deploy shape):
 *   1. Expired OIDC JWT + valid `__session` cookie → request succeeds
 *      with `principal.principalId.startsWith('session:')`. The cookie's
 *      tenant wins; the stale bearer doesn't poison the request.
 *   2. Bogus non-JWT Bearer + no cookie → request succeeds with a
 *      freshly-minted anon `__session` cookie. The Bearer is ignored;
 *      the response Set-Cookie carries the new session.
 *   3. Expired OIDC JWT + no cookie → same as #2 (anon session minted).
 *
 * A fourth case (server-to-server callers — cookies disabled) lives in
 * `auth-oidc.test.ts`: when cookies are off there's nothing to fall
 * back to, so the strict 401 with `details.reason` is preserved.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import http from 'node:http';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { authMiddleware, _resetOidcVerifier, _resetFallthroughTracker } from '../src/middleware/auth.js';

// ── tiny synthetic OIDC issuer ───────────────────────────────────
// Mirrors the helper in auth-oidc.test.ts. Kept inline so this test
// is hermetic and can run in isolation (vitest's file-level isolation
// means the other test's beforeAll doesn't apply here).

interface SyntheticIssuer {
  issuer: string;
  audience: string;
  jwksUrl: string;
  mint(overrides?: Partial<{ sub: string; aud: string; exp: number; iat: number }>): string;
  /** Mint a token with the realistic Firebase Auth claim shape
   *  (`auth_time`, `email_verified`, `firebase.identities`, etc.).
   *  Catches verifier changes that tighten claim checks against
   *  fields the synthetic minimal shape doesn't carry. */
  mintFirebaseShape(overrides?: Partial<{ sub: string; aud: string; exp: number; email: string }>): string;
  close: () => Promise<void>;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function startSyntheticIssuer(audience: string): Promise<SyntheticIssuer> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-kid-fallthrough';
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
        aud: overrides.aud ?? audience,
        sub: overrides.sub ?? 'firebase-uid-stale',
        iat: overrides.iat ?? now,
        exp: overrides.exp ?? now + 300,
      };
      const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
      const sig = createSign('sha256').update(signingInput).sign(privateKey as KeyObject);
      return `${signingInput}.${b64url(sig)}`;
    },
    mintFirebaseShape(overrides = {}) {
      const now = Math.floor(Date.now() / 1000);
      const sub = overrides.sub ?? 'firebase-uid-real-shape';
      const email = overrides.email ?? 'user@example.com';
      const header = { alg: 'RS256', kid, typ: 'JWT' };
      // Mirrors the actual claim set Firebase Auth issues for a
      // password-provider sign-in (snapshot from `firebase auth:export`
      // sanitized). The verifier presently only checks iss/aud/exp;
      // adding these fields here pins the contract — if a future
      // change starts asserting on `firebase.identities.email`
      // existence, this fixture catches the break.
      const payload = {
        iss: issuer,
        aud: overrides.aud ?? audience,
        sub,
        iat: now,
        exp: overrides.exp ?? now + 3600,
        auth_time: now - 60,
        email,
        email_verified: true,
        user_id: sub,
        firebase: {
          identities: { email: [email] },
          sign_in_provider: 'password',
        },
      };
      const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
      const sig = createSign('sha256').update(signingInput).sign(privateKey as KeyObject);
      return `${signingInput}.${b64url(sig)}`;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ── test app + bench ─────────────────────────────────────────────

let appServer: http.Server;
let appPort: number;
let issuer: SyntheticIssuer;

beforeAll(async () => {
  issuer = await startSyntheticIssuer('openwop-test-aud');
  process.env.OPENWOP_OIDC_ISSUER = issuer.issuer;
  process.env.OPENWOP_OIDC_AUDIENCE = issuer.audience;
  process.env.OPENWOP_OIDC_JWKS_URL = issuer.jwksUrl;
  // Cookies ENABLED — the browser deploy shape, where the fall-through
  // is supposed to engage.
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = '';
  delete process.env.OPENWOP_AUTH_DISABLE_COOKIES;
  _resetOidcVerifier();

  const app: Express = express();
  app.use(express.json());
  app.use(authMiddleware());
  app.get('/v1/test/whoami', (req, res) => res.json({
    principalId: req.principal?.principalId,
    tenants: req.principal?.tenants,
    tenantId: req.tenantId,
  }));
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
  _resetOidcVerifier();
});

function extractSessionCookie(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  // "__session=<value>; Path=/; Max-Age=..." → just `__session=<value>`.
  const head = setCookieHeader.split(';')[0]!;
  return head.trim();
}

const call = (headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${appPort}/v1/test/whoami`, { headers });

describe('bearer → cookie fall-through (browser-shape deploys)', () => {
  it('valid OIDC JWT still produces an oidc:* principal (regression guard)', async () => {
    _resetFallthroughTracker();
    const token = issuer.mint({ sub: 'firebase-uid-valid' });
    const res = await call({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { principalId: string };
    expect(body.principalId).toBe('oidc:firebase-uid-valid');
  });

  it('valid Firebase-shape JWT (auth_time + firebase.identities) verifies cleanly', async () => {
    // Pins contract: if a future verifier change starts asserting on
    // Firebase-specific claims, this test exercises them so the
    // change is caught here rather than at first prod deploy.
    _resetFallthroughTracker();
    const token = issuer.mintFirebaseShape({ sub: 'firebase-uid-realshape', email: 'alice@example.com' });
    const res = await call({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { principalId: string };
    expect(body.principalId).toBe('oidc:firebase-uid-realshape');
  });

  it('expired JWT + valid session cookie → session:* principal, NOT 401', async () => {
    // Step 1: warm up an anon session so we have a real signed cookie.
    const seed = await call();
    expect(seed.status).toBe(200);
    const sessionCookie = extractSessionCookie(seed.headers.get('set-cookie'));
    expect(sessionCookie).toMatch(/^__session=/);
    const seedBody = (await seed.json()) as { principalId: string };
    expect(seedBody.principalId).toMatch(/^session:/);

    // Step 2: replay the same cookie alongside an expired JWT.
    // Pre-fix behavior: 401 (bearer kills the request before cookie
    // path runs). Post-fix: bearer verify fails, fall through, cookie
    // path resolves the same session.
    const expired = issuer.mint({ exp: Math.floor(Date.now() / 1000) - 3600 });
    const res = await call({
      authorization: `Bearer ${expired}`,
      cookie: sessionCookie!,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { principalId: string };
    expect(body.principalId).toMatch(/^session:/);
    // Same session id — fall-through didn't mint a new anon session
    // when a valid cookie was present.
    expect(body.principalId).toBe(seedBody.principalId);
  });

  it('bogus non-JWT bearer + no cookie → fresh anon session minted, NOT 401', async () => {
    const res = await call({ authorization: 'Bearer not-a-jwt-just-junk' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { principalId: string };
    expect(body.principalId).toMatch(/^session:/);
    // Set-Cookie was issued because the cookie path minted an anon
    // session — no pre-existing cookie was present on this request.
    expect(res.headers.get('set-cookie')).toMatch(/^__session=/);
  });

  it('expired JWT + no cookie → fresh anon session minted', async () => {
    const expired = issuer.mint({ exp: Math.floor(Date.now() / 1000) - 3600 });
    const res = await call({ authorization: `Bearer ${expired}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { principalId: string };
    expect(body.principalId).toMatch(/^session:/);
    expect(res.headers.get('set-cookie')).toMatch(/^__session=/);
  });
});
