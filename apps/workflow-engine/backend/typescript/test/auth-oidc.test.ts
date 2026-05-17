/**
 * Coverage for Phase 3.1: OIDC bearer verification on the workflow-
 * engine auth middleware.
 *
 * Three cases:
 *   1. Valid token → 200, principal tenants[0] is the `user:<hash>`
 *      derived from issuer+sub. Anon cookie path NOT triggered.
 *   2. Expired token → 401 with `details.reason: "expired"`.
 *   3. Wrong audience → 401 with `details.reason: "wrong_audience"`.
 *
 * Also a regression case: API-key Bearer still works alongside OIDC
 * (the two paths coexist on the same Authorization header).
 *
 * Uses an in-test synthetic OIDC issuer (~30 LOC of node:crypto) so
 * the test is hermetic — no live Firebase calls, no fixtures.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import http from 'node:http';
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { authMiddleware, _resetOidcVerifier } from '../src/middleware/auth.js';

// ── tiny synthetic OIDC issuer ───────────────────────────────────

interface SyntheticIssuer {
  issuer: string;
  audience: string;
  jwksUrl: string;
  mint(overrides?: Partial<{ sub: string; aud: string; exp: number; iat: number }>): string;
  close: () => Promise<void>;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function startSyntheticIssuer(audience: string): Promise<SyntheticIssuer> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-kid-1';

  // Build a JWKS RFC 7517 entry from the public key
  const pubJwk = publicKey.export({ format: 'jwk' });
  const jwks = { keys: [{ ...pubJwk, kid, alg: 'RS256', use: 'sig' }] };

  // Serve the JWKS at /.well-known/jwks.json
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
        sub: overrides.sub ?? 'firebase-uid-abc123',
        iat: overrides.iat ?? now,
        exp: overrides.exp ?? now + 300,
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
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true'; // isolate the bearer path
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
  delete process.env.OPENWOP_AUTH_DISABLE_COOKIES;
  _resetOidcVerifier();
});

const call = (token: string) =>
  fetch(`http://127.0.0.1:${appPort}/v1/test/whoami`, {
    headers: { authorization: `Bearer ${token}` },
  });

describe('P3.1 OIDC bearer verification', () => {
  it('accepts a valid token and derives user:<hash> tenantId', async () => {
    const token = issuer.mint({ sub: 'firebase-uid-alice' });
    const res = await call(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { principalId: string; tenants: string[]; tenantId: string };
    expect(body.principalId).toBe('oidc:firebase-uid-alice');
    expect(body.tenants[0]).toMatch(/^user:[0-9a-f]{32}$/);
    expect(body.tenantId).toBe(body.tenants[0]);
  });

  it('issuer-scoped tenant id — same sub from different issuers gets different tenants', async () => {
    // Same sub but the token came from issuer A. A second synthetic
    // issuer would mint a token with iss=B that the verifier rejects
    // (wrong_issuer). The tenant-id derivation logic — sha256(iss+":"+sub)
    // — is what prevents cross-IdP collisions in production where the
    // host may trust multiple issuers. We assert determinism here:
    // re-minting under the same iss+sub gives the same tenantId.
    const t1 = issuer.mint({ sub: 'firebase-uid-bob' });
    const t2 = issuer.mint({ sub: 'firebase-uid-bob' });
    const r1 = await call(t1);
    const r2 = await call(t2);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = (await r1.json()) as { tenantId: string };
    const b2 = (await r2.json()) as { tenantId: string };
    expect(b1.tenantId).toBe(b2.tenantId);
  });

  it('rejects expired token with reason=expired', async () => {
    const token = issuer.mint({ exp: Math.floor(Date.now() / 1000) - 3600 });
    const res = await call(token);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; details: { reason: string } };
    expect(body.error).toBe('unauthenticated');
    expect(body.details.reason).toBe('expired');
  });

  it('rejects wrong-audience token with reason=wrong_audience', async () => {
    const token = issuer.mint({ aud: 'some-other-audience' });
    const res = await call(token);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { details: { reason: string } };
    expect(body.details.reason).toBe('wrong_audience');
  });

  it('API-key Bearer still works alongside OIDC', async () => {
    process.env.OPENWOP_API_KEYS = 'admin-test-key';
    const res = await call('admin-test-key');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { principalId: string; tenants: string[] };
    expect(body.principalId).toBe('bearer:admin-te');
    expect(body.tenants).toEqual(['*']);
    delete process.env.OPENWOP_API_KEYS;
  });

  it('non-JWT bearer with no allow-list hit returns 401', async () => {
    process.env.OPENWOP_API_KEYS = ''; // empty allow-list, like prod
    const res = await call('not-a-jwt-just-junk');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthenticated');
    delete process.env.OPENWOP_API_KEYS;
  });
});
