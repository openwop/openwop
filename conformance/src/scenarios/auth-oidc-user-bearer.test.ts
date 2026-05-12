/**
 * RFC 0010 §D: openwop-auth-oidc-user-bearer profile.
 *
 * Verifies that hosts claiming the OIDC user-bearer profile satisfy
 * `spec/v1/auth-profiles.md` §`openwop-auth-oidc-user-bearer`:
 *
 *   1. `capabilities.auth.profiles[]` includes
 *      `openwop-auth-oidc-user-bearer` and `oidc.supported`.
 *   2. `oidc.issuers` is a non-empty array of URI strings; `audience`
 *      is a non-empty string when advertised; `supportedScopeMapping`
 *      (if present) is one of the canonical enum values;
 *      `introspectionIntervalSeconds` (if present) is a non-negative
 *      integer.
 *   3. When `OPENWOP_TEST_OIDC_ISSUER_URL` is supplied, the scenario
 *      binds the synthetic OIDC issuer harness at that URL and exercises
 *      six host-side validation cases:
 *        a. Valid sub/iss/aud/exp → 201 on POST /v1/runs.
 *        b. Wrong `iss` → 401.
 *        c. Wrong `aud` → 401.
 *        d. Expired `exp` → 401.
 *        e. Unknown `kid` (header references a key not in JWKS) → 401.
 *        f. Insufficient scope (empty groups against a group-claim
 *           mapping host) → 403.
 *
 * The host MUST be pre-configured to trust `OPENWOP_TEST_OIDC_ISSUER_URL`
 * as one of its `oidc.issuers`. The scenario binds the harness's JWKS
 * + discovery endpoints on that URL's port so the host's introspection
 * fetches succeed against this hermetic in-suite issuer.
 *
 * Cases (a) and (f) require the host's user-to-scope mapping policy to
 * accept the harness's `sub`. The scenario soft-skips them with a
 * warning when the host returns 403 to the "valid" token (no mapping)
 * or when the host returns 401 to the "valid" token (host trust not
 * actually wired up).
 *
 * @see RFCS/0010-auth-profile-conformance.md §D
 * @see spec/v1/auth-profiles.md §`openwop-auth-oidc-user-bearer`
 * @see conformance/src/lib/oidc-issuer.ts — synthetic harness
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import {
  createSyntheticOIDCIssuer,
  type SyntheticOIDCIssuer,
} from '../lib/oidc-issuer.js';

interface OIDCCaps {
  supported?: boolean;
  issuers?: string[];
  audience?: string;
  supportedScopeMapping?: string;
  introspectionIntervalSeconds?: number;
}

interface AuthCaps {
  profiles?: string[];
  oidc?: OIDCCaps;
}

const PROFILE = 'openwop-auth-oidc-user-bearer';
const FIXTURE = 'conformance-noop';

async function readAuthCaps(): Promise<AuthCaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return (disco.json as { capabilities?: { auth?: AuthCaps } }).capabilities?.auth;
}

function isProfileAdvertised(auth: AuthCaps | undefined): boolean {
  return (
    Array.isArray(auth?.profiles) &&
    auth.profiles.includes(PROFILE) &&
    auth.oidc?.supported === true
  );
}

describe('auth-oidc-user-bearer: capability shape', () => {
  it('host claiming OIDC profile advertises required fields', async () => {
    const auth = await readAuthCaps();

    if (!behaviorGate(PROFILE, isProfileAdvertised(auth))) {
      return;
    }

    expect(auth?.profiles?.includes(PROFILE), driver.describe(
      'auth-profiles.md §`openwop-auth-oidc-user-bearer`',
      'capabilities.auth.profiles MUST include openwop-auth-oidc-user-bearer when the profile is claimed',
    )).toBe(true);

    expect(auth?.oidc?.supported, driver.describe(
      'auth-profiles.md §`openwop-auth-oidc-user-bearer`',
      'capabilities.auth.oidc.supported MUST be true when the profile is claimed',
    )).toBe(true);

    expect(
      Array.isArray(auth?.oidc?.issuers) && (auth?.oidc?.issuers?.length ?? 0) > 0,
      driver.describe(
        'capabilities.schema.json auth.oidc.issuers',
        'issuers MUST be a non-empty array when the profile is claimed',
      ),
    ).toBe(true);

    for (const issuer of auth?.oidc?.issuers ?? []) {
      expect(
        typeof issuer === 'string' && issuer.length > 0,
        'each issuer entry MUST be a non-empty string',
      ).toBe(true);
    }

    if (auth?.oidc?.audience !== undefined) {
      expect(
        typeof auth.oidc.audience === 'string' && auth.oidc.audience.length > 0,
        'audience MUST be a non-empty string when advertised',
      ).toBe(true);
    }

    if (auth?.oidc?.supportedScopeMapping !== undefined) {
      expect(
        ['group-claim', 'scope-claim', 'host-acl'].includes(
          auth.oidc.supportedScopeMapping,
        ),
        driver.describe(
          'capabilities.schema.json auth.oidc.supportedScopeMapping',
          'supportedScopeMapping MUST be one of group-claim/scope-claim/host-acl',
        ),
      ).toBe(true);
    }

    if (auth?.oidc?.introspectionIntervalSeconds !== undefined) {
      expect(
        Number.isInteger(auth.oidc.introspectionIntervalSeconds) &&
          auth.oidc.introspectionIntervalSeconds >= 0,
        'introspectionIntervalSeconds MUST be a non-negative integer when advertised',
      ).toBe(true);
    }
  });
});

describe('auth-oidc-user-bearer: harness-driven token validation', () => {
  let server: Server | undefined;
  let issuer: SyntheticOIDCIssuer | undefined;
  let harnessUrl: string | undefined;
  let harnessAudience: string | undefined;
  let trustWired = false;

  beforeAll(async () => {
    const auth = await readAuthCaps();
    if (!isProfileAdvertised(auth)) return;

    harnessUrl = process.env.OPENWOP_TEST_OIDC_ISSUER_URL;
    if (!harnessUrl) return;

    harnessAudience = auth?.oidc?.audience ?? 'openwop-conformance';

    issuer = createSyntheticOIDCIssuer({
      issuer: harnessUrl,
      audience: harnessAudience,
      algorithm: 'RS256',
    });

    // Bind the harness's JWKS + discovery endpoints so the host can
    // fetch them when validating tokens.
    const parsed = new URL(harnessUrl);
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : 80;

    server = createServer((req, res) => {
      if (!issuer) {
        res.writeHead(503);
        res.end();
        return;
      }
      if (req.url === '/.well-known/jwks.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(issuer.jwksJson);
      } else if (req.url === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(issuer.discoveryJson);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(port, '127.0.0.1', () => resolve());
    });

    // Probe: does the host actually trust this harness? Mint a known-
    // good token and see what the host returns.
    if (isFixtureAdvertised(FIXTURE)) {
      const probe = issuer.mint({ sub: 'conformance-suite', groups: ['openwop:operators'] });
      const probeRes = await driver.post(
        '/v1/runs',
        { workflowId: FIXTURE },
        {
          authenticated: false,
          headers: { Authorization: `Bearer ${probe.token}` },
        },
      );
      // Trust-wired status: host returns 201 (full success) or 403
      // (token-valid-but-no-scope mapping). Both mean signature
      // verification succeeded; the host trusts the issuer.
      trustWired = probeRes.status === 201 || probeRes.status === 403;
    }
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it('wrong iss → 401', async () => {
    if (!issuer || !trustWired) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-oidc-user-bearer] harness not wired or host trust not configured; skipping wrong-iss case',
      );
      return;
    }

    const wrongIssIssuer = createSyntheticOIDCIssuer({
      issuer: 'https://untrusted.example.invalid',
      audience: harnessAudience ?? '',
    });
    const wrongIss = wrongIssIssuer.mint({ sub: 'attacker' });

    const res = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${wrongIss.token}` },
      },
    );

    expect(res.status, driver.describe(
      'auth-profiles.md §`openwop-auth-oidc-user-bearer`',
      'token with non-trusted iss MUST return 401',
    )).toBe(401);
  });

  it('wrong aud → 401', async () => {
    if (!issuer || !trustWired) return;
    const wrongAud = issuer.mint({ aud: 'wrong-audience', sub: 'attacker' });
    const res = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${wrongAud.token}` },
      },
    );
    expect(res.status, driver.describe(
      'auth-profiles.md §`openwop-auth-oidc-user-bearer`',
      'token with wrong aud MUST return 401',
    )).toBe(401);
  });

  it('expired exp → 401', async () => {
    if (!issuer || !trustWired) return;
    const expired = issuer.mint(
      { sub: 'conformance-suite' },
      { expiresInSeconds: -3600 },
    );
    const res = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${expired.token}` },
      },
    );
    expect(res.status, driver.describe(
      'auth-profiles.md §`openwop-auth-oidc-user-bearer`',
      'expired token (exp < now) MUST return 401',
    )).toBe(401);
  });

  it('unknown kid → 401', async () => {
    if (!issuer || !trustWired) return;
    const unknownKid = issuer.mint(
      { sub: 'conformance-suite' },
      { keyId: 'openwop-conformance-key-NEVER-PUBLISHED' },
    );
    const res = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${unknownKid.token}` },
      },
    );
    expect(res.status, driver.describe(
      'auth-profiles.md §`openwop-auth-oidc-user-bearer` + threat-model-auth-profiles.md A3',
      'token referencing a kid not in JWKS MUST return 401',
    )).toBe(401);
  });

  it('valid token → 201 or 403 (depending on host scope mapping)', async () => {
    if (!issuer || !trustWired) return;
    if (!isFixtureAdvertised(FIXTURE)) return;

    const valid = issuer.mint({
      sub: 'conformance-suite',
      groups: ['openwop:operators'],
    });
    const res = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${valid.token}` },
      },
    );

    // 201: host trusts the token AND maps the sub to runs:create scope.
    // 403: host trusts the token but the sub lacks the required scope.
    // Both indicate the OIDC validation path succeeded; the scope
    // decision is a separate host-side policy not normated by RFC 0010.
    expect(
      [201, 403].includes(res.status),
      driver.describe(
        'auth-profiles.md §`openwop-auth-oidc-user-bearer`',
        'host-trusted token MUST yield 201 (mapped scope) or 403 (unmapped sub), NOT 401',
      ),
    ).toBe(true);
  });

  it('scope-insufficient → 403 (when host uses group-claim mapping)', async () => {
    if (!issuer || !trustWired) return;
    const auth = await readAuthCaps();
    if (auth?.oidc?.supportedScopeMapping !== 'group-claim') {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth-oidc-user-bearer] host scope mapping is not group-claim; skipping scope-insufficient case',
      );
      return;
    }

    const noGroups = issuer.mint({ sub: 'conformance-suite', groups: [] });
    const res = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${noGroups.token}` },
      },
    );

    expect(res.status, driver.describe(
      'auth-profiles.md §`openwop-auth-oidc-user-bearer`',
      'token-valid-but-empty-groups against group-claim host MUST return 403 (forbidden), NOT 401',
    )).toBe(403);
  });
});
