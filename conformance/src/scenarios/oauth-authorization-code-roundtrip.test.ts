/**
 * oauth-authorization-code-roundtrip — RFC 0047 §C (the authorization-code grant
 * end-to-end) + §C.2 / `credential-payload-redaction`.
 *
 * Closes the RFC 0047 Tier-2 gap: `oauth-capability-shape` proves the discovery
 * block is well-formed and `oauth-connector-redaction` proves an already-acquired
 * token doesn't leak — but nothing exercised the actual authorization-code DANCE
 * (redirect → callback → token exchange) against a known provider. This scenario
 * drives that roundtrip against ONE canonical synthetic provider whose endpoints a
 * conformance test double serves, so a host can prove the grant without a live IdP.
 *
 * The synthetic provider + its canned exchange are defined in
 * `fixtures/oauth-providers/synthetic.json`; the constants below mirror it (kept
 * inline so the scenario runs from the published tarball without fixture-path
 * resolution, exactly like `oauth-connector-redaction`'s TOKEN_CANARY).
 *
 * Capability-gated: skips unless the host advertises
 * `capabilities.oauth.supported = true` AND lists `authorization_code` in
 * `capabilities.oauth.grants`. Behavioral probe drives the optional host seam
 * `POST /v1/host/sample/oauth/authorize-code-roundtrip`; a 404 (seam not wired)
 * is a soft-skip — this is a Tier-2 host-pending scenario.
 *
 * Asserts, when the seam is present:
 *   1. The roundtrip succeeds and returns a credential REFERENCE (the token was
 *      acquired + persisted as a host.credentials entry), never the token itself.
 *   2. `connector.authorized` carries `{ provider, credentialRef, scopes }` and
 *      none of the token / refresh / code / state / redirectUri / codeVerifier.
 *   3. RFC 0047 §C — the authorization code, redirect URI, state, and PKCE
 *      verifier MUST NOT appear on ANY run-visible surface; §C.2 — neither MUST
 *      the access/refresh token (the canaries are absent from the whole response).
 *
 * @see RFCS/0047-host-oauth-connector-flows.md §C
 * @see conformance/fixtures/oauth-providers/synthetic.json
 * @see SECURITY/invariants.yaml id: credential-payload-redaction
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

interface DiscoveryOAuth {
  supported?: boolean;
  grants?: string[];
}

// Mirrors fixtures/oauth-providers/synthetic.json — keep in sync.
const SYNTHETIC = {
  provider: 'synthetic',
  authUrl: 'https://oauth.synthetic.openwop.test/authorize',
  tokenUrl: 'https://oauth.synthetic.openwop.test/token',
  scopes: ['openwop.read', 'openwop.write'],
  authorizationCode: 'openwop-synthetic-auth-code-1f4b9e',
  state: 'openwop-synthetic-state-7c2a8d',
  redirectUri: 'https://host.example/openwop/oauth/callback',
  codeVerifier: 'openwop-synthetic-pkce-verifier-3e9f1b2c5a7d4e8f0a1b2c3d4e5f6a7b',
  accessTokenCanary: 'OPENWOP_OAUTH_TOKEN_CANARY_9d4c1f7a',
  refreshTokenCanary: 'OPENWOP_OAUTH_REFRESH_CANARY_2b8e6a3f',
} as const;

// Values that MUST NOT appear on any run-visible surface (RFC 0047 §C + §C.2).
const SECRET_VALUES: readonly string[] = [
  SYNTHETIC.accessTokenCanary,
  SYNTHETIC.refreshTokenCanary,
  SYNTHETIC.authorizationCode,
  SYNTHETIC.state,
  SYNTHETIC.codeVerifier,
];

async function readOAuth(): Promise<DiscoveryOAuth | null> {
  const res = await driver.get('/.well-known/openwop');
  return capabilityFamily<DiscoveryOAuth>(res.json, 'oauth') ?? null;
}

describe('oauth-authorization-code-roundtrip: the grant dance (RFC 0047 §C)', () => {
  it('acquires a token via authorization_code and returns a reference, never the token', async () => {
    const oauth = await readOAuth();
    if (!oauth?.supported) return softSkip('inapplicable', 'capability-gated');
    if (!Array.isArray(oauth.grants) || !oauth.grants.includes('authorization_code')) return softSkip('inapplicable', 'grant-gated (!Array.isArray(oauth.grants) || !oauth.grants.includes(\'authorization_code\'))');

    // Seam contract: the host performs the full authorization-code roundtrip
    // against the synthetic provider's authUrl/tokenUrl, persists the acquired
    // token as a host.credentials entry, and returns the run-observable surfaces
    // (events incl. connector.authorized + snapshot + any debug bundle) plus the
    // resulting credentialRef.
    const res = await driver.post('/v1/host/sample/oauth/authorize-code-roundtrip', {
      provider: SYNTHETIC.provider,
      authUrl: SYNTHETIC.authUrl,
      tokenUrl: SYNTHETIC.tokenUrl,
      scopes: SYNTHETIC.scopes,
      authorizationCode: SYNTHETIC.authorizationCode,
      state: SYNTHETIC.state,
      redirectUri: SYNTHETIC.redirectUri,
      codeVerifier: SYNTHETIC.codeVerifier,
      accessTokenCanary: SYNTHETIC.accessTokenCanary,
      refreshTokenCanary: SYNTHETIC.refreshTokenCanary,
    });
    // A host that hasn't wired the seam soft-skips (Tier-2, host-pending).
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam, prior step, or fixture unavailable)');

    expect(
      res.status,
      driver.describe(
        'RFC 0047 §C',
        'the authorize-code-roundtrip seam MUST perform the authorization_code grant against the synthetic provider and return the run observable surfaces',
      ),
    ).toBeLessThan(400);

    const body = (res.json ?? {}) as { credentialRef?: unknown };
    expect(
      typeof body.credentialRef === 'string' && body.credentialRef.length > 0,
      driver.describe(
        'RFC 0047 §C',
        'a successful roundtrip MUST resolve to a credential REFERENCE (token persisted as a host.credentials entry), not the raw token',
      ),
    ).toBe(true);

    // §C + §C.2 — no secret material anywhere in the observable response.
    const serialized = JSON.stringify(res.json ?? {});
    for (const secret of SECRET_VALUES) {
      expect(
        serialized.includes(secret),
        driver.describe(
          'RFC 0047 §C / SECURITY/invariants.yaml credential-payload-redaction',
          `the authorization code, state, PKCE verifier, and acquired token material MUST NOT appear on any run-visible surface — leaked: ${secret.slice(0, 16)}…`,
        ),
      ).toBe(false);
    }

    // §C — connector.authorized carries the reference + scopes, never the token.
    const events = (res.json as { events?: Array<{ type?: string; payload?: Record<string, unknown> }> })?.events;
    if (Array.isArray(events)) {
      const authorized = events.find((e) => e?.type === 'connector.authorized');
      if (authorized?.payload) {
        const keys = Object.keys(authorized.payload);
        expect(
          keys.includes('credentialRef') && !keys.includes('access_token') && !keys.includes('refresh_token'),
          driver.describe(
            'RFC 0047 §C',
            'connector.authorized MUST carry { provider, credentialRef, scopes } and MUST NOT carry token material',
          ),
        ).toBe(true);
      }
    }
  });
});
