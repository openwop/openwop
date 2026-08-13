/**
 * RFC 0010 §C: openwop-auth-oauth2-client-credentials profile.
 *
 * Verifies that hosts claiming the OAuth2-CC profile satisfy
 * `spec/v1/auth-profiles.md` §`openwop-auth-oauth2-client-credentials`:
 *
 *   1. `capabilities.auth.profiles[]` includes
 *      `openwop-auth-oauth2-client-credentials` and `oauth2.supported`.
 *   2. When advertised, `oauth2.issuer` is a non-empty URI, `audience`
 *      is a non-empty string, `supportedAlgorithms` is a non-empty
 *      array.
 *   3. Malformed JWT bearer (not three dot-separated segments) returns
 *      401 with the canonical error envelope.
 *   4. Tokens minted by the conformance suite's synthetic OIDC issuer
 *      with deliberately-broken claims (wrong aud, expired exp,
 *      unsupported alg in header) return 401 when the host has been
 *      configured to trust the harness via `OPENWOP_TEST_OAUTH_ISSUER_TRUSTED=true`.
 *   5. Positive token (`OPENWOP_TEST_OAUTH_TOKEN`) returns 201 on
 *      `POST /v1/runs` per the canonical run-create contract.
 *
 * Negative cases that require the host to trust the harness soft-skip
 * when the operator hasn't wired up trust. The capability-shape and
 * malformed-JWT assertions run unconditionally when the profile is
 * advertised.
 *
 * @see RFCS/0010-auth-profile-conformance.md §C
 * @see spec/v1/auth-profiles.md §`openwop-auth-oauth2-client-credentials`
 * @see conformance/src/lib/oidc-issuer.ts — synthetic harness
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { createSyntheticOIDCIssuer } from '../lib/oidc-issuer.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

/**
 * Callback-shaped: the host fetches the token endpoint on the suite's synthetic OIDC issuer.
 *
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance; no route.
 */
export const REQUIRES_HOST_CALLBACK = "the host fetches the token endpoint on the suite's synthetic OIDC issuer";

interface OAuth2Caps {
  supported?: boolean;
  issuer?: string;
  audience?: string;
  supportedAlgorithms?: string[];
}

interface AuthCaps {
  profiles?: string[];
  oauth2?: OAuth2Caps;
}

const PROFILE = 'openwop-auth-oauth2-client-credentials';
const FIXTURE = 'conformance-noop';

async function readAuthCaps(): Promise<AuthCaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily((disco.json as { capabilities?: { auth?: AuthCaps } }), 'auth');
}

function isProfileAdvertised(auth: AuthCaps | undefined): boolean {
  return (
    Array.isArray(auth?.profiles) &&
    auth.profiles.includes(PROFILE) &&
    auth.oauth2?.supported === true
  );
}

describe('auth-oauth2-client-credentials: capability shape', () => {
  it('host claiming OAuth2-CC profile advertises required fields', async () => {
    const auth = await readAuthCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(auth))) {
      return;
    }

    expect(auth?.profiles?.includes(PROFILE), driver.describe(
      'auth-profiles.md §`openwop-auth-oauth2-client-credentials`',
      'capabilities.auth.profiles MUST include openwop-auth-oauth2-client-credentials when the profile is claimed',
    )).toBe(true);

    expect(auth?.oauth2?.supported, driver.describe(
      'auth-profiles.md §`openwop-auth-oauth2-client-credentials`',
      'capabilities.auth.oauth2.supported MUST be true when the profile is claimed',
    )).toBe(true);

    if (auth?.oauth2?.issuer !== undefined) {
      expect(
        typeof auth.oauth2.issuer === 'string' && auth.oauth2.issuer.length > 0,
        driver.describe(
          'capabilities.schema.json auth.oauth2.issuer',
          'issuer MUST be a non-empty string when advertised',
        ),
      ).toBe(true);
    }

    if (auth?.oauth2?.audience !== undefined) {
      expect(
        typeof auth.oauth2.audience === 'string' && auth.oauth2.audience.length > 0,
        driver.describe(
          'capabilities.schema.json auth.oauth2.audience',
          'audience MUST be a non-empty string when advertised',
        ),
      ).toBe(true);
    }

    if (auth?.oauth2?.supportedAlgorithms !== undefined) {
      expect(
        Array.isArray(auth.oauth2.supportedAlgorithms) &&
          auth.oauth2.supportedAlgorithms.length > 0,
        driver.describe(
          'capabilities.schema.json auth.oauth2.supportedAlgorithms',
          'supportedAlgorithms MUST be a non-empty array when advertised',
        ),
      ).toBe(true);
    }
  });
});

describe('auth-oauth2-client-credentials: malformed JWT rejected', () => {
  it('returns 401 on bearer that is not a valid JWT shape', async () => {
    const auth = await readAuthCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(auth))) {
      return;
    }

    const res = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: 'Bearer not.a.real.jwt' },
      },
    );

    expect(res.status, driver.describe(
      'auth.md §3',
      'malformed JWT bearer MUST return 401 (canonical invalid_token envelope)',
    )).toBe(401);

    const body = res.json as { error?: unknown; message?: unknown } | undefined;
    expect(typeof body?.error, driver.describe(
      'auth.md §3 + rest-endpoints.md error envelope',
      'response body MUST include `error` (machine code) string',
    )).toBe('string');
  });
});

describe('auth-oauth2-client-credentials: harness-minted negative cases', () => {
  it('wrong-audience token returns 401 when host trusts the harness', async () => {
    const auth = await readAuthCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(auth))) {
      return;
    }

    if (process.env.OPENWOP_TEST_OAUTH_ISSUER_TRUSTED !== 'true') {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-oauth2-client-credentials] OPENWOP_TEST_OAUTH_ISSUER_TRUSTED not set; skipping harness-minted negative cases (operator must pre-configure the host to trust the conformance harness)',
      );
      return;
    }

    const issuerUrl =
      process.env.OPENWOP_TEST_OAUTH_ISSUER_URL ?? 'http://127.0.0.1:0/oauth';
    const audience = auth?.oauth2?.audience ?? 'openwop-conformance';
    const issuer = createSyntheticOIDCIssuer({
      issuer: issuerUrl,
      audience,
      algorithm: 'RS256',
    });

    // Wrong audience.
    const wrongAud = issuer.mint({ aud: 'wrong-audience', sub: 'conformance-suite' });
    const wrongAudRes = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${wrongAud.token}` },
      },
    );
    expect(wrongAudRes.status, driver.describe(
      'auth-profiles.md §`openwop-auth-oauth2-client-credentials`',
      'token with wrong aud claim MUST return 401',
    )).toBe(401);

    // Expired token.
    const expired = issuer.mint(
      { sub: 'conformance-suite' },
      { expiresInSeconds: -3600 },
    );
    const expiredRes = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${expired.token}` },
      },
    );
    expect(expiredRes.status, driver.describe(
      'auth-profiles.md §`openwop-auth-oauth2-client-credentials`',
      'expired token (exp < now) MUST return 401',
    )).toBe(401);

    // Algorithm header lies (claims HS256, signature is RS256).
    const algSpoofed = issuer.mint(
      { sub: 'conformance-suite' },
      { algorithm: 'HS256' },
    );
    const algSpoofedRes = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${algSpoofed.token}` },
      },
    );
    expect(algSpoofedRes.status, driver.describe(
      'auth-profiles.md §`openwop-auth-oauth2-client-credentials`',
      'token with alg outside supportedAlgorithms MUST return 401',
    )).toBe(401);
  });
});

describe('auth-oauth2-client-credentials: positive token', () => {
  it('operator-supplied valid token authenticates POST /v1/runs', async () => {
    const auth = await readAuthCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(auth))) {
      return;
    }

    const token = process.env.OPENWOP_TEST_OAUTH_TOKEN;
    if (!token) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-oauth2-client-credentials] OPENWOP_TEST_OAUTH_TOKEN not supplied; skipping positive-path assertion',
      );
      return;
    }

    if (!isFixtureAdvertised(FIXTURE)) {
      return;
    }

    const res = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(res.status, driver.describe(
      'auth-profiles.md §`openwop-auth-oauth2-client-credentials`',
      'valid OAuth2-CC token MUST authenticate POST /v1/runs (201)',
    )).toBe(201);
  });
});
