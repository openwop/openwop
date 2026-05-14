/**
 * mTLS termination smoke (Phase I.7).
 *
 * Verifies that the Postgres reference host satisfies
 * `auth-profiles.md` §`openwop-auth-mtls` end-to-end:
 *
 *   1. With OPENWOP_MTLS_{CERT,KEY,CA}_PATH configured, the host listens
 *      on HTTPS and `capabilities.auth.profiles` includes
 *      `openwop-auth-mtls` + `auth.mtls.supported === true` +
 *      `subjectMapping === 'cn'`.
 *   2. A request with a valid client cert + valid bearer key on a
 *      protected route (`POST /v1/runs`) succeeds (201).
 *   3. A request without a client cert, when `mtls.required === true`,
 *      terminates at the TLS handshake (Node surfaces this as a socket
 *      error rather than a 4xx — per `auth-profiles.md` §`openwop-auth-
 *      mtls`, hosts MAY choose either).
 *
 * Test certs are generated inline via `openssl` so we don't commit
 * private-key material. If openssl is unavailable, the test exits 0 with
 * a skip message (matches the broader conformance suite's opt-in
 * pattern for environmental capabilities).
 *
 * @see spec/v1/auth-profiles.md §`openwop-auth-mtls`
 * @see conformance/src/scenarios/auth-mtls.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { PGlite } from '@electric-sql/pglite';

const __dirname = dirname(fileURLToPath(import.meta.url));
void __dirname; // reserved for future fixture loads

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-mtls-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

// Skip the test cleanly when openssl isn't available.
const opensslProbe = spawnSync('openssl', ['version'], { stdio: ['ignore', 'pipe', 'ignore'] });
if (opensslProbe.status !== 0) {
  // eslint-disable-next-line no-console
  console.log('skip mtls — openssl not available');
  process.exit(0);
}

// Generate a self-signed CA + a server cert + a client cert. The CA
// signs both, so the server trusts the client when `ca` is presented.
const certDir = mkdtempSync(join(tmpdir(), 'openwop-pg-mtls-certs-'));
const caKeyPath = join(certDir, 'ca.key');
const caCrtPath = join(certDir, 'ca.crt');
const serverKeyPath = join(certDir, 'server.key');
const serverCsrPath = join(certDir, 'server.csr');
const serverCrtPath = join(certDir, 'server.crt');
const clientKeyPath = join(certDir, 'client.key');
const clientCsrPath = join(certDir, 'client.csr');
const clientCrtPath = join(certDir, 'client.crt');
const opensslExtPath = join(certDir, 'server.ext');

function sh(args: string[]): void {
  const r = spawnSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) {
    throw new Error(`openssl ${args.join(' ')} failed: ${r.stderr?.toString() ?? ''}`);
  }
}

// CA.
sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', caKeyPath, '-out', caCrtPath,
    '-days', '365', '-subj', '/CN=openwop-test-ca']);

// Server cert with SAN for 127.0.0.1 (Node's TLS requires SAN for hostname verification).
writeFileSync(
  opensslExtPath,
  'subjectAltName = IP:127.0.0.1\nbasicConstraints = CA:FALSE\n',
);
sh(['req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', serverKeyPath, '-out', serverCsrPath,
    '-subj', '/CN=127.0.0.1']);
sh(['x509', '-req', '-in', serverCsrPath, '-CA', caCrtPath, '-CAkey', caKeyPath,
    '-CAcreateserial', '-out', serverCrtPath, '-days', '365',
    '-extfile', opensslExtPath]);

// Client cert.
sh(['req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', clientKeyPath, '-out', clientCsrPath,
    '-subj', '/CN=openwop-test-client']);
sh(['x509', '-req', '-in', clientCsrPath, '-CA', caCrtPath, '-CAkey', caKeyPath,
    '-CAcreateserial', '-out', clientCrtPath, '-days', '365']);

assert.ok(existsSync(caCrtPath) && existsSync(serverCrtPath) && existsSync(clientCrtPath),
  'all three test certs MUST exist');

// Wire mTLS env vars BEFORE importing the server (env captured at import time).
process.env.OPENWOP_MTLS_CERT_PATH = serverCrtPath;
process.env.OPENWOP_MTLS_KEY_PATH = serverKeyPath;
process.env.OPENWOP_MTLS_CA_PATH = caCrtPath;
process.env.OPENWOP_MTLS_REQUIRED = 'true';

void resolve;

const { setQuerier, start } = await import('../src/server.js');
type Querier = {
  query<T>(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rows: T[]; rowCount: number }>;
};

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []) {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

interface HttpsResp { status: number; body: string }

function mtlsRequest(
  port: number,
  path: string,
  method: 'GET' | 'POST',
  body: unknown | undefined,
  headers: Record<string, string>,
  certs: { cert: Buffer; key: Buffer; ca: Buffer } | { ca: Buffer },
): Promise<HttpsResp | { error: Error }> {
  return new Promise((resolveP) => {
    const payload = body !== undefined ? JSON.stringify(body) : '';
    const req = httpsRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
      },
      ca: certs.ca,
      ...('cert' in certs ? { cert: certs.cert, key: certs.key } : {}),
    }, (res) => {
      let chunks = '';
      res.on('data', (c: Buffer | string) => { chunks += typeof c === 'string' ? c : c.toString('utf8'); });
      res.on('end', () => resolveP({ status: res.statusCode ?? 0, body: chunks }));
    });
    req.on('error', (error) => resolveP({ error }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function main(): Promise<void> {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();

  const ca = readFileSync(caCrtPath);
  const cert = readFileSync(clientCrtPath);
  const key = readFileSync(clientKeyPath);
  try {
    const port = Number(process.env.OPENWOP_PORT ?? '3839');
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';

    // 1. Discovery (with client cert).
    const disco = await mtlsRequest(port, '/.well-known/openwop', 'GET', undefined, {}, { cert, key, ca });
    assert.ok(!('error' in disco), `discovery MUST succeed with valid cert: ${('error' in disco ? disco.error.message : '')}`);
    if ('error' in disco) return; // type narrowing — unreachable per assertion above
    assert.equal(disco.status, 200);
    const discoBody = JSON.parse(disco.body) as {
      capabilities?: {
        auth?: {
          profiles?: string[];
          mtls?: { supported?: boolean; required?: boolean; subjectMapping?: string };
        };
      };
    };
    const auth = discoBody.capabilities?.auth;
    assert.ok(auth?.profiles?.includes('openwop-auth-mtls'),
      'profiles MUST include openwop-auth-mtls when host is configured for mTLS');
    assert.equal(auth?.mtls?.supported, true);
    assert.equal(auth?.mtls?.required, true);
    assert.equal(auth?.mtls?.subjectMapping, 'cn');

    // 2. Valid cert + valid bearer → 201.
    const create = await mtlsRequest(port, '/v1/runs', 'POST',
      { workflowId: 'conformance-noop' },
      { Authorization: `Bearer ${apiKey}` },
      { cert, key, ca });
    assert.ok(!('error' in create), `mtls POST /v1/runs MUST succeed with valid cert: ${('error' in create ? create.error.message : '')}`);
    if ('error' in create) return;
    assert.equal(create.status, 201,
      `valid cert + valid bearer MUST authenticate POST /v1/runs (got ${create.status}: ${create.body})`);

    // 3. No client cert with mtls.required=true → TLS handshake fails.
    const noCert = await mtlsRequest(port, '/v1/runs', 'POST',
      { workflowId: 'conformance-noop' },
      { Authorization: `Bearer ${apiKey}` },
      { ca });
    assert.ok('error' in noCert,
      'mtls.required=true MUST reject no-cert requests at the TLS handshake (got HTTP response instead)');

    // eslint-disable-next-line no-console
    console.log('ok mtls — Phase I.7 verified (advertisement + 201 with cert + handshake-fail without cert)');
  } finally {
    await close();
    rmSync(workdir, { recursive: true, force: true });
    rmSync(certDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
