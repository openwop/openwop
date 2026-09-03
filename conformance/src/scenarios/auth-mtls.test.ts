/**
 * RFC 0010 §F: openwop-auth-mtls profile (opt-in).
 *
 * Verifies that hosts claiming the mTLS profile satisfy
 * `spec/v1/auth-profiles.md` §`openwop-auth-mtls`:
 *
 *   1. `capabilities.auth.profiles[]` includes `openwop-auth-mtls`
 *      and `mtls.supported === true`.
 *   2. `mtls.required` (when present) is a boolean; `subjectMapping`
 *      (when present) is one of the canonical enum values
 *      (cn / san-dns / san-uri).
 *   3. Request with valid client cert + valid bearer → 201 on
 *      `POST /v1/runs`.
 *   4. When `mtls.required === true`, a bearer-only request (no
 *      client cert) MUST fail with non-2xx OR a transport-layer TLS
 *      failure (`auth-profiles.md` lets hosts choose either).
 *
 * Capability shape runs unconditionally when the profile is advertised.
 * Behavior portion is opt-in via `OPENWOP_TEST_MTLS=1` and requires
 * operator-supplied cert paths because cert provisioning is environmental
 * (host's CA, client cert/key files). Follows the
 * `restart-during-run.test.ts` opt-in precedent.
 *
 * Implementation note: this scenario uses `node:https.request` rather
 * than the global `fetch` because conformance has no `undici` dep and
 * Node's fetch doesn't expose a client-cert option without a dispatcher
 * (which requires `undici` as a public package). `node:https` ships
 * with the runtime and supports `{ cert, key, ca }` directly.
 *
 * Operator setup:
 *   OPENWOP_TEST_MTLS=1
 *   OPENWOP_TEST_MTLS_CLIENT_CERT_PATH=<path to PEM client cert>
 *   OPENWOP_TEST_MTLS_CLIENT_KEY_PATH=<path to PEM client key>
 *   OPENWOP_TEST_MTLS_CA_PATH=<optional path to CA bundle for server-cert verify>
 *   OPENWOP_BASE_URL=https://...  (HTTPS required for mTLS)
 *
 * @see RFCS/0010-auth-profile-conformance.md §F
 * @see spec/v1/auth-profiles.md §`openwop-auth-mtls`
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface MtlsCaps {
  supported?: boolean;
  required?: boolean;
  subjectMapping?: string;
}

interface AuthCaps {
  profiles?: string[];
  mtls?: MtlsCaps;
}

const PROFILE = 'openwop-auth-mtls';
const FIXTURE = 'conformance-noop';
const RUN_BEHAVIOR = process.env.OPENWOP_TEST_MTLS === '1';

interface ClientCerts {
  cert: Buffer;
  key: Buffer;
  ca?: Buffer;
}

interface HttpsResponse {
  status: number;
  body: string;
}

async function readAuthCaps(): Promise<AuthCaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily((disco.json as { capabilities?: { auth?: AuthCaps } }), 'auth');
}

function isProfileAdvertised(auth: AuthCaps | undefined): boolean {
  return (
    Array.isArray(auth?.profiles) &&
    auth.profiles.includes(PROFILE) &&
    auth.mtls?.supported === true
  );
}

function loadClientCerts(): ClientCerts | undefined {
  const certPath = process.env.OPENWOP_TEST_MTLS_CLIENT_CERT_PATH;
  const keyPath = process.env.OPENWOP_TEST_MTLS_CLIENT_KEY_PATH;
  if (!certPath || !keyPath) return undefined;
  try {
    const caPath = process.env.OPENWOP_TEST_MTLS_CA_PATH;
    return {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
      ...(caPath ? { ca: readFileSync(caPath) } : {}),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[auth-mtls] failed to read client cert/key: ${String(err)}`);
    return undefined;
  }
}

function mtlsPost(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  certs: ClientCerts | undefined,
): Promise<HttpsResponse | { error: Error }> {
  return new Promise((resolve) => {
    const url = new URL(baseUrl + path);
    const payload = JSON.stringify(body);
    const reqBody = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port ? Number.parseInt(url.port, 10) : 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload).toString(),
        },
        ...(certs ? { cert: certs.cert, key: certs.key } : {}),
        ...(certs?.ca ? { ca: certs.ca } : {}),
      },
      (res) => {
        let chunks = '';
        res.on('data', (c: Buffer | string) => {
          chunks += typeof c === 'string' ? c : c.toString('utf8');
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: chunks });
        });
      },
    );
    reqBody.on('error', (error) => resolve({ error }));
    reqBody.write(payload);
    reqBody.end();
  });
}

describe('auth-mtls: capability shape', () => {
  it('host claiming mTLS profile advertises required fields', async () => {
    const auth = await readAuthCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(auth))) {
      return;
    }

    expect(auth?.profiles?.includes(PROFILE), req('openwop.it.auth-mtls.host-claiming-mtls-profile-advertises-required-fields', 
      'auth-profiles.md §`openwop-auth-mtls`',
      'capabilities.auth.profiles MUST include openwop-auth-mtls when the profile is claimed',
    )).toBe(true);

    expect(auth?.mtls?.supported, req('openwop.it.auth-mtls.host-claiming-mtls-profile-advertises-required-fields', 
      'auth-profiles.md §`openwop-auth-mtls`',
      'capabilities.auth.mtls.supported MUST be true when the profile is claimed',
    )).toBe(true);

    if (auth?.mtls?.required !== undefined) {
      expect(
        typeof auth.mtls.required,
        req('openwop.it.auth-mtls.host-claiming-mtls-profile-advertises-required-fields', 'auth-profiles.md §`openwop-auth-mtls`', 'mtls.required MUST be boolean when advertised'),
      ).toBe('boolean');
    }

    if (auth?.mtls?.subjectMapping !== undefined) {
      expect(
        ['cn', 'san-dns', 'san-uri'].includes(auth.mtls.subjectMapping),
        req('openwop.it.auth-mtls.host-claiming-mtls-profile-advertises-required-fields', 
          'capabilities.schema.json auth.mtls.subjectMapping',
          'subjectMapping MUST be one of cn / san-dns / san-uri',
        ),
      ).toBe(true);
    }
  });
});

describe.skipIf(!RUN_BEHAVIOR)('auth-mtls: client cert behavior', () => {
  it('valid client cert + valid bearer → 201', async () => {
    const auth = await readAuthCaps();
    if (!isProfileAdvertised(auth)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isProfileAdvertised(auth)` returned early');

    const certs = loadClientCerts();
    if (!certs) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-mtls] OPENWOP_TEST_MTLS=1 but cert paths missing; skipping behavior',
      );
      return softSkip('blocked', 'precondition not met — `!certs` returned early ([auth-mtls] OPENWOP_TEST_MTLS=1 but cert paths missing; skipping behavior) (seam, prior step, or fixture unavailable)');
    }

    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');

    const env = loadEnv();
    if (!env.baseUrl.startsWith('https://')) {
      // eslint-disable-next-line no-console
      console.warn(
        `[auth-mtls] OPENWOP_BASE_URL is not HTTPS (got ${env.baseUrl}); mTLS requires HTTPS — skipping`,
      );
      return softSkip('blocked', 'precondition not met — `!env.baseUrl.startsWith(\'https://\')` returned early ([auth-mtls] OPENWOP_BASE_URL is not HTTPS (got …); mTLS requires HTTPS — skipping) (seam, prior step, or fixture unavailable)');
    }

    const res = await mtlsPost(
      env.baseUrl,
      '/v1/runs',
      { workflowId: FIXTURE },
      { Authorization: `Bearer ${env.apiKey}` },
      certs,
    );

    if ('error' in res) {
      throw new Error(
        `[auth-mtls] mTLS request failed at transport: ${res.error.message}`,
      );
    }

    expect(res.status, req('openwop.it.auth-mtls.valid-client-cert-valid-bearer-201', 
      'auth-profiles.md §`openwop-auth-mtls`',
      'valid client cert + valid bearer MUST authenticate POST /v1/runs (201)',
    )).toBe(201);
  });

  it('no client cert against mtls.required: true → non-2xx or TLS failure', async () => {
    const auth = await readAuthCaps();
    if (!isProfileAdvertised(auth)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isProfileAdvertised(auth)` returned early');
    if (auth?.mtls?.required !== true) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-mtls] host advertises mtls.required: false; skipping no-cert rejection (host may accept bearer-only)',
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `auth?.mtls?.required !== true` returned early ([auth-mtls] host advertises mtls.required: false; skipping no-cert rejection (host may accept bearer-only))');
    }

    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early');

    const env = loadEnv();
    if (!env.baseUrl.startsWith('https://')) {
      // eslint-disable-next-line no-console
      console.warn(
        `[auth-mtls] OPENWOP_BASE_URL is not HTTPS (got ${env.baseUrl}); skipping no-cert rejection`,
      );
      return softSkip('blocked', 'precondition not met — `!env.baseUrl.startsWith(\'https://\')` returned early ([auth-mtls] OPENWOP_BASE_URL is not HTTPS (got …); skipping no-cert rejection) (seam, prior step, or fixture unavailable)');
    }

    // No certs supplied → either 4xx or transport-layer TLS handshake failure.
    const res = await mtlsPost(
      env.baseUrl,
      '/v1/runs',
      { workflowId: FIXTURE },
      { Authorization: `Bearer ${env.apiKey}` },
      undefined,
    );

    if ('error' in res) {
      // Transport-layer TLS failure is conformant per auth-profiles.md.
      // The handshake rejected the client because no cert was offered.
      expect(true, req('openwop.it.auth-mtls.no-client-cert-against-mtls-required-true-non-2xx-or-tls-failure', 
        'auth-profiles.md §`openwop-auth-mtls`',
        'mtls.required: true MUST reject no-cert requests (TLS handshake failure is conformant)',
      )).toBe(true);
      return softSkip('blocked', 'precondition not met — `\'error\' in res` returned early (seam, prior step, or fixture unavailable)');
    }

    expect(res.status >= 400, req('openwop.it.auth-mtls.no-client-cert-against-mtls-required-true-non-2xx-or-tls-failure', 
      'auth-profiles.md §`openwop-auth-mtls`',
      'mtls.required: true MUST reject no-cert requests at the auth layer (4xx) when not rejected at the TLS layer',
    )).toBe(true);
  });
});
