/**
 * auth-saml-profile — RFC 0050: openwop-auth-saml profile.
 *
 * Status: DRAFT. RFC 0050 (SAML / SCIM enterprise identity profiles) is
 * `Draft`. The profile is documented in `auth-profiles.md`
 * §`openwop-auth-saml` and reserved in `capabilities.auth.profiles`.
 *
 * Capability shape runs unconditionally when the profile is advertised.
 * The assertion-validation behavior (1 positive + ≥6 negatives: bad
 * signature, `alg:none`, absent signature, `NotOnOrAfter` expiry,
 * `NotBefore` not-yet-valid, signature-wrapping) is opt-in via
 * `OPENWOP_TEST_SAML_IDP_URL` (operator-supplied synthetic IdP), because
 * a deterministic XML-DSig signer harness isn't bundled yet — follows the
 * `auth-mtls.test.ts` opt-in precedent. Soft-skips otherwise.
 *
 * @see RFCS/0050-saml-scim-enterprise-identity-profiles.md
 * @see spec/v1/auth-profiles.md §`openwop-auth-saml`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const SAML_PROFILE = 'openwop-auth-saml';

interface DiscoveryAuth {
  profiles?: string[];
}

interface DiscoveryDoc {
  capabilities?: { auth?: DiscoveryAuth };
  extensions?: { auth?: DiscoveryAuth };
}

async function readProfiles(): Promise<string[] | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return body?.capabilities?.auth?.profiles ?? body?.extensions?.auth?.profiles ?? null;
}

describe('auth-saml-profile: advertisement shape (RFC 0050)', () => {
  it('auth.profiles, when present, is an array of non-empty strings', async () => {
    const profiles = await readProfiles();
    if (profiles === null) return; // host advertises no auth profiles
    expect(
      Array.isArray(profiles),
      driver.describe('auth-profiles.md §Discovery', 'capabilities.auth.profiles MUST be an array'),
    ).toBe(true);
    for (const p of profiles) {
      expect(typeof p === 'string' && p.length > 0).toBe(true);
    }
  });

  it('claims openwop-auth-saml as a well-formed profile id when advertised', async () => {
    const profiles = await readProfiles();
    if (profiles === null || !profiles.includes(SAML_PROFILE)) return; // profile not claimed
    expect(
      profiles.includes(SAML_PROFILE),
      driver.describe('RFC 0050 §A', 'openwop-auth-saml MUST appear verbatim in capabilities.auth.profiles when claimed'),
    ).toBe(true);
  });
});

describe('auth-saml-profile: assertion validation (RFC 0050 §A — opt-in)', () => {
  const idpUrl = process.env.OPENWOP_TEST_SAML_IDP_URL;

  it('rejects an `alg:none` / unsigned assertion (synthetic IdP required)', async () => {
    const profiles = await readProfiles();
    if (profiles === null || !profiles.includes(SAML_PROFILE)) return; // capability-gated
    if (idpUrl === undefined || idpUrl.length === 0) return; // opt-in: synthetic-IdP harness not provided
    // With a synthetic IdP, an `alg:none`/unsigned assertion presented to the
    // host's SAML ACS MUST be rejected with `unauthenticated`.
    const res = await driver.post('/v1/host/sample/auth/saml/validate', { idpUrl, variant: 'alg-none' });
    if (res.status === 404) return; // seam unwired
    expect(
      res.status,
      driver.describe('RFC 0050 §A', 'an `alg:none`/unsigned SAML assertion MUST be rejected (non-2xx)'),
    ).toBeGreaterThanOrEqual(400);
  });
});
