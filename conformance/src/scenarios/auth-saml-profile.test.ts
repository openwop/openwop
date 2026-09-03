/**
 * auth-saml-profile — RFC 0050: openwop-auth-saml profile.
 *
 * Status: ACTIVE. RFC 0050 (SAML / SCIM enterprise identity profiles) is
 * `Active`. The profile is documented in `auth-profiles.md`
 * §`openwop-auth-saml` and reserved in `capabilities.auth.profiles`.
 *
 * Capability shape runs unconditionally when the profile is advertised.
 * The assertion-validation behavior is exercised over the host's live
 * `auth/saml/validate` seam for the FULL §A variant set — 1 positive
 * (valid, signed, in-window, non-wrapped → accepted) + 6 negatives
 * (`alg:none`, unsigned, bad-signature, `NotOnOrAfter` expiry, `NotBefore`
 * not-yet-valid, signature-wrapping → rejected). This behavioral leg is
 * opt-in via `OPENWOP_TEST_SAML_IDP_URL` (an operator-supplied HTTP
 * synthetic IdP serving the bundled `createSyntheticSamlIdp()` assertions),
 * because it requires a live host ACS + an HTTP IdP the seam can resolve
 * variants from — the in-process minter below is not a server. Follows the
 * `auth-mtls.test.ts` opt-in precedent. Soft-skips otherwise.
 *
 * @see RFCS/0050-saml-scim-enterprise-identity-profiles.md
 * @see spec/v1/auth-profiles.md §`openwop-auth-saml`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { type SamlVariant } from '../lib/saml-idp.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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
  return capabilityFamily<{ profiles?: string[] }>(body, 'auth')?.profiles ?? body?.extensions?.auth?.profiles ?? null;
}

describe('auth-saml-profile: advertisement shape (RFC 0050)', () => {
  it('auth.profiles, when present, is an array of non-empty strings', async () => {
    const profiles = await readProfiles();
    if (profiles === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `profiles === null` returned early (host advertises no auth profiles)'); // host advertises no auth profiles
    expect(
      Array.isArray(profiles),
      req('openwop.it.auth-saml-profile.auth-profiles-when-present-is-an-array-of-non-empty-strings', 'auth-profiles.md §Discovery', 'capabilities.auth.profiles MUST be an array'),
    ).toBe(true);
    for (const p of profiles) {
      expect(typeof p === 'string' && p.length > 0).toBe(true);
    }
  });

  it('claims openwop-auth-saml as a well-formed profile id when advertised', async () => {
    const profiles = await readProfiles();
    if (profiles === null || !profiles.includes(SAML_PROFILE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `profiles === null || !profiles.includes(SAML_PROFILE)` returned early (profile not claimed)'); // profile not claimed
    expect(
      profiles.includes(SAML_PROFILE),
      req('openwop.it.auth-saml-profile.claims-openwop-auth-saml-as-a-well-formed-profile-id-when-advertised', 'RFC 0050 §A', 'openwop-auth-saml MUST appear verbatim in capabilities.auth.profiles when claimed'),
    ).toBe(true);
  });
});

describe('auth-saml-profile: assertion validation (RFC 0050 §A — opt-in)', () => {
  const idpUrl = process.env.OPENWOP_TEST_SAML_IDP_URL;

  // The host's real SAML ACS is driven over the `auth/saml/validate` seam for
  // every variant the bundled synthetic IdP mints — the full RFC 0050 §A MUST
  // list, not just one negative. The seam receives `{ idpUrl, variant }`,
  // resolves `{ certificatePem, assertion }` of that variant from the
  // operator-supplied synthetic IdP, runs it through the host's genuine
  // validator, and answers 2xx (accepted) / non-2xx (rejected). This is the
  // NON-VACUOUS behavioral leg: it exercises the host's ACS on the live wire,
  // distinct from the in-process reference suite below (which proves the
  // assertions are detectably malformed against the bundled oracle, not the
  // host). All legs soft-skip until `OPENWOP_TEST_SAML_IDP_URL` is supplied.
  const gated = (): boolean => idpUrl !== undefined && idpUrl.length > 0;

  it('ACCEPTS a valid signed, in-window, non-wrapped assertion (synthetic IdP required)', async () => {
    const profiles = await readProfiles();
    if (profiles === null || !profiles.includes(SAML_PROFILE)) return softSkip('blocked', 'precondition not met — `profiles === null || !profiles.includes(SAML_PROFILE)` returned early (capability-gated) (seam, prior step, or fixture unavailable)'); // capability-gated
    if (!gated()) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!gated()` returned early (opt-in: synthetic-IdP harness not provided)'); // opt-in: synthetic-IdP harness not provided
    const res = await driver.post('/v1/host/sample/auth/saml/validate', { idpUrl, variant: 'valid' });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired) (seam, prior step, or fixture unavailable)'); // seam unwired
    expect(
      res.status,
      req('openwop.it.auth-saml-profile.accepts-a-valid-signed-in-window-non-wrapped-assertion-synthetic-idp-required', 'RFC 0050 §A', 'a valid signed, in-window, non-wrapped SAML assertion MUST be accepted (2xx)'),
    ).toBeLessThan(400);
  });

  // The 6 negatives the RFC 0050 §A MUST list requires a host to reject. The
  // signature-wrapping (XSW) case is the load-bearing security property — a
  // host MUST bind the validated signature to the consumed assertion.
  const negatives: ReadonlyArray<[Exclude<SamlVariant, 'valid'>, string]> = [
    ['alg-none', 'an `alg:none` SAML assertion MUST be rejected (non-2xx)'],
    ['unsigned', 'an unsigned SAML assertion MUST be rejected (non-2xx)'],
    ['bad-signature', 'a SAML assertion with an invalid signature MUST be rejected (non-2xx)'],
    ['expired', 'a SAML assertion past `NotOnOrAfter` MUST be rejected (non-2xx)'],
    ['not-yet-valid', 'a SAML assertion before `NotBefore` MUST be rejected (non-2xx)'],
    ['signature-wrapping', 'a signature-wrapped (XSW) SAML assertion MUST be rejected (non-2xx)'],
  ];

  for (const [variant, requirement] of negatives) {
    it(`REJECTS the ${variant} assertion over the seam (synthetic IdP required)`, async () => {
      const profiles = await readProfiles();
      if (profiles === null || !profiles.includes(SAML_PROFILE)) return softSkip('blocked', 'precondition not met — `profiles === null || !profiles.includes(SAML_PROFILE)` returned early (capability-gated) (seam, prior step, or fixture unavailable)'); // capability-gated
      if (!gated()) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!gated()` returned early (opt-in: synthetic-IdP harness not provided)'); // opt-in: synthetic-IdP harness not provided
      const res = await driver.post('/v1/host/sample/auth/saml/validate', { idpUrl, variant });
      if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired) (seam, prior step, or fixture unavailable)'); // seam unwired
      expect(res.status, req('openwop.it.auth-saml-profile.rejects-the-assertion-over-the-seam-synthetic-idp-required', 'RFC 0050 §A', requirement)).toBeGreaterThanOrEqual(400);
    });
  }
});

// The RFC 0050 §A synthetic-IdP reference suite (1 positive + 6 negatives against
// the bundled fixture) moved to `conformance/src/lib/saml-idp.test.ts` on
// 2026-09-02 (RFC 0163 gap G5): it proves the FIXTURE, not a host, and a
// server-free block inside a scenario file records `executed-pass` in every
// host bundle (conformance-certification.md gap G8). This file keeps only the
// host-facing legs above.
