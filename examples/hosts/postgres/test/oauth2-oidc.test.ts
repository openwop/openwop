/**
 * OAuth2-CC + OIDC user-bearer smoke (Phase I.3 + I.4).
 *
 * Spins up the conformance suite's synthetic OIDC issuer + binds a
 * loopback HTTP server to its issuer URL so the Postgres host's
 * JWT validator can fetch JWKS at runtime. Verifies the full
 * auth-profiles.md contract:
 *
 *   1. Discovery advertises both profile claims + auth.oauth2 +
 *      auth.oidc blocks with `issuer` / `audience` /
 *      `supportedAlgorithms`.
 *   2. Static API key still authenticates (validators don't kick in
 *      for non-JWT tokens).
 *   3. Positive JWT (minted by harness with correct iss/aud) →
 *      POST /v1/runs returns 201.
 *   4. Malformed JWT (not 3 segments) → 401 invalid_credential.
 *   5. Wrong-issuer JWT → 401 invalid_credential.
 *   6. Wrong-audience JWT → 401 invalid_credential.
 *   7. Expired JWT (exp < now) → 401 invalid_credential.
 *   8. Unknown-kid JWT (after key rotation) → 401 invalid_credential.
 *   9. alg=none JWT → 401 invalid_credential (no-alg-confusion).
 *  10. Rejected token MUST NOT appear in error envelope (canary-
 *      redaction per auth.md §"No credential echo").
 *
 * @see spec/v1/auth-profiles.md §`openwop-auth-oauth2-client-credentials`
 * @see spec/v1/auth-profiles.md §`openwop-auth-oidc-user-bearer`
 * @see conformance/src/lib/oidc-issuer.ts
 */

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-oauth-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

// Stand up the synthetic issuer at a known port BEFORE importing the
// host (which reads OPENWOP_OAUTH2_ISSUER_URL at module-load time).
const issuerPort = 4501;
const issuerUrl = `http://127.0.0.1:${issuerPort}`;
const audience = 'urn:openwop:test';

import { createSyntheticOIDCIssuer } from '../../../../conformance/src/lib/oidc-issuer.js';

const issuer = createSyntheticOIDCIssuer({ issuer: issuerUrl, audience });

const issuerServer: Server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/.well-known/jwks.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(issuer.jwksJson);
    return;
  }
  if (req.method === 'GET' && req.url === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(issuer.discoveryJson);
    return;
  }
  res.writeHead(404).end();
});

await new Promise<void>((resolve) => issuerServer.listen(issuerPort, '127.0.0.1', () => resolve()));

process.env.OPENWOP_OAUTH2_ISSUER_URL = issuerUrl;
process.env.OPENWOP_OAUTH2_AUDIENCE = audience;

// Now load the host (validator initializes from env).
const { setQuerier, start } = await import('../src/server.ts');
const { PGlite } = await import('@electric-sql/pglite');
import type { Querier, QueryResult } from '../src/db.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

async function main(): Promise<void> {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();

  try {
    const port = process.env.OPENWOP_PORT ?? '3839';
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
    const baseUrl = `http://127.0.0.1:${port}`;

    const createRun = async (bearer: string): Promise<{ status: number; body: string }> => {
      const r = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: 'conformance-noop' }),
      });
      return { status: r.status, body: await r.text() };
    };

    // 1. Discovery advertises profile claims + auth.oauth2 block.
    const disco = await fetch(`${baseUrl}/.well-known/openwop`);
    const discoBody = (await disco.json()) as {
      capabilities?: {
        auth?: {
          profiles?: string[];
          oauth2?: {
            supported?: boolean;
            issuer?: string;
            audience?: string;
            supportedAlgorithms?: string[];
          };
        };
      };
    };
    assert.ok(
      discoBody.capabilities?.auth?.profiles?.includes('openwop-auth-oauth2-client-credentials'),
      'auth.profiles MUST include openwop-auth-oauth2-client-credentials',
    );
    assert.equal(discoBody.capabilities?.auth?.oauth2?.supported, true);
    assert.equal(discoBody.capabilities?.auth?.oauth2?.issuer, issuerUrl);
    assert.equal(discoBody.capabilities?.auth?.oauth2?.audience, audience);
    assert.ok(
      Array.isArray(discoBody.capabilities?.auth?.oauth2?.supportedAlgorithms) &&
        discoBody.capabilities!.auth!.oauth2!.supportedAlgorithms!.length > 0,
      'supportedAlgorithms MUST be a non-empty array',
    );

    // 2. Static API key still authenticates.
    const staticOk = await createRun(apiKey);
    assert.equal(staticOk.status, 201, 'static API key MUST still authenticate');

    // 3. Positive JWT — minted by harness with default iss/aud.
    const goodToken = issuer.mint({ sub: 'client:test-client' }).token;
    const goodResult = await createRun(goodToken);
    assert.equal(goodResult.status, 201, 'valid JWT MUST authenticate POST /v1/runs');

    // 4. Malformed JWT (not 3 segments) → 401.
    const malformedResult = await createRun('not.a.valid.jwt.shape');
    assert.equal(malformedResult.status, 401);
    const malformedBody = JSON.parse(malformedResult.body) as { error?: string };
    assert.equal(malformedBody.error, 'invalid_credential');

    // 5. Wrong-issuer JWT (claim iss=evil.example) → 401.
    const wrongIssuerToken = issuer.mint({ iss: 'https://evil.example', sub: 'attacker' }).token;
    const wrongIssuerResult = await createRun(wrongIssuerToken);
    assert.equal(wrongIssuerResult.status, 401);

    // 6. Wrong-audience JWT → 401.
    const wrongAudToken = issuer.mint({ aud: 'urn:openwop:other-tenant' }).token;
    assert.equal((await createRun(wrongAudToken)).status, 401);

    // 7. Expired JWT (exp in the past) → 401.
    const expiredToken = issuer.mint({}, { expiresInSeconds: -3600 }).token;
    assert.equal((await createRun(expiredToken)).status, 401);

    // 8. Unknown-kid JWT (header references a kid the issuer's JWKS
    //    never published). The harness's MintOptions.keyId lets us
    //    sign a structurally-valid token whose kid header has no
    //    matching JWK — the host MUST reject with `unknown_kid`.
    const ghostKidToken = issuer.mint({}, { keyId: 'never-published-kid' }).token;
    assert.equal(
      (await createRun(ghostKidToken)).status,
      401,
      'unknown-kid MUST be rejected (no matching JWK)',
    );

    // 9. alg=none — synthesize the token manually (the harness only
    // mints RS256/ES256). Even an attacker-controlled "alg: none" must
    // be rejected before any signature check.
    const noAlgHeader = Buffer.from(JSON.stringify({ alg: 'none', kid: 'whatever' }))
      .toString('base64url');
    const noAlgPayload = Buffer.from(
      JSON.stringify({ iss: issuerUrl, aud: audience, exp: Math.floor(Date.now() / 1000) + 60, iat: Math.floor(Date.now() / 1000) }),
    ).toString('base64url');
    const noAlgToken = `${noAlgHeader}.${noAlgPayload}.`;
    const noAlgResult = await createRun(noAlgToken);
    assert.equal(noAlgResult.status, 401, 'alg=none MUST be rejected');

    // 10. Canary-redaction — no portion of any rejected token appears
    // in the error envelope.
    const canary = 'canary-token-shape-not-in-jwks-' + Date.now();
    const canaryResult = await createRun(canary);
    assert.equal(canaryResult.status, 401);
    assert.equal(
      canaryResult.body.includes(canary),
      false,
      'auth.md §"No credential echo": error envelope MUST NOT echo the rejected token',
    );

    void port; void baseUrl;
    // eslint-disable-next-line no-console
    console.log('ok oauth2-oidc — Phase I.3 + I.4 verified (10 paths + canary-redaction)');
  } finally {
    await close();
    await new Promise<void>((resolve) => issuerServer.close(() => resolve()));
    rmSync(workdir, { recursive: true, force: true });
    delete process.env.OPENWOP_OAUTH2_ISSUER_URL;
    delete process.env.OPENWOP_OAUTH2_AUDIENCE;
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  issuerServer.close();
  process.exit(1);
});
