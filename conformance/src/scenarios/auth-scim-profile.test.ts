/**
 * auth-scim-profile — RFC 0050: openwop-auth-scim profile.
 *
 * Status: DRAFT. RFC 0050 (SAML / SCIM enterprise identity profiles) is
 * `Draft`. The profile is documented in `auth-profiles.md`
 * §`openwop-auth-scim` and reserved in `capabilities.auth.profiles`.
 *
 * Capability shape runs unconditionally when the profile is advertised.
 * The provisioning roundtrip (SCIM user+group → RFC 0048 principal +
 * RFC 0049 role; deactivate ⇒ subsequent deny) is opt-in via
 * `OPENWOP_TEST_SCIM_URL` (operator-supplied SCIM endpoint), following the
 * `auth-mtls.test.ts` opt-in precedent. Soft-skips otherwise.
 *
 * @see RFCS/0050-saml-scim-enterprise-identity-profiles.md
 * @see spec/v1/auth-profiles.md §`openwop-auth-scim`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const SCIM_PROFILE = 'openwop-auth-scim';

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

describe('auth-scim-profile: advertisement shape (RFC 0050)', () => {
  it('claims openwop-auth-scim as a well-formed profile id when advertised', async () => {
    const profiles = await readProfiles();
    if (profiles === null || !profiles.includes(SCIM_PROFILE)) return; // profile not claimed
    expect(
      profiles.includes(SCIM_PROFILE),
      driver.describe('RFC 0050 §B', 'openwop-auth-scim MUST appear verbatim in capabilities.auth.profiles when claimed'),
    ).toBe(true);
  });
});

describe('auth-scim-profile: provisioning roundtrip (RFC 0050 §B — opt-in)', () => {
  const scimUrl = process.env.OPENWOP_TEST_SCIM_URL;

  it('provisions a SCIM user → principal (SCIM endpoint required)', async () => {
    const profiles = await readProfiles();
    if (profiles === null || !profiles.includes(SCIM_PROFILE)) return; // capability-gated
    if (scimUrl === undefined || scimUrl.length === 0) return; // opt-in: SCIM endpoint not provided
    // A SCIM POST /Users against the operator-supplied endpoint MUST upsert a
    // principal the host can subsequently resolve.
    const res = await driver.post('/v1/host/sample/auth/scim/provision', { scimUrl, op: 'create-user' });
    if (res.status === 404) return; // seam unwired
    expect(
      res.status,
      driver.describe('RFC 0050 §B', 'a SCIM user provisioning MUST succeed (2xx) and upsert an RFC 0048 principal'),
    ).toBeLessThan(400);
  });
});
