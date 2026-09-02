/**
 * auth-subject-link — RFC 0159: SCIM ⟷ SAML subject linking (the combined
 * leaver contract).
 *
 * Status: ACCEPTED. RFC 0159 is `Accepted` (amends RFC 0050; hardened by RFC 0163). The obligation is
 * documented in `auth-profiles.md` §"Subject linking (SAML ⟷ SCIM)" and is
 * discoverable via `capabilities.auth.subjectLinking`.
 *
 * Advertisement shape runs unconditionally when the flag is set. The
 * cross-lane behavioral legs (a SCIM deactivation fail-closing the linked SAML
 * identity; a mutable-key link never producing a cross-lane pass) are opt-in
 * via `OPENWOP_TEST_SAML_IDP_URL` + `OPENWOP_TEST_SCIM_URL` (operator-supplied
 * endpoints), following the `auth-scim-profile.test.ts` opt-in precedent.
 * Soft-skips otherwise; soft-skips `blocked` until the host wires the seam.
 *
 * @see RFCS/0159-scim-saml-subject-linking.md
 * @see spec/v1/auth-profiles.md §"Subject linking (SAML ⟷ SCIM)"
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const SAML_PROFILE = 'openwop-auth-saml';
const SCIM_PROFILE = 'openwop-auth-scim';

interface DiscoveryAuth {
  profiles?: string[];
  subjectLinking?: boolean;
}

interface DiscoveryDoc {
  capabilities?: { auth?: DiscoveryAuth };
  extensions?: { auth?: DiscoveryAuth };
}

async function readAuth(): Promise<DiscoveryAuth | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily<DiscoveryAuth>(body, 'auth') ?? body?.extensions?.auth ?? null;
}

describe('auth-subject-link: advertisement shape (RFC 0159 §B)', () => {
  it('subjectLinking:true is only claimed alongside both SAML and SCIM profiles', async () => {
    const auth = await readAuth();
    if (auth === null || auth.subjectLinking !== true) {
      return softSkip('inapplicable', 'auth.subjectLinking not claimed');
    }
    const profiles = auth.profiles ?? [];
    expect(
      profiles.includes(SAML_PROFILE) && profiles.includes(SCIM_PROFILE),
      driver.describe(
        'auth-profiles.md §Subject linking',
        'a host MUST NOT set capabilities.auth.subjectLinking:true unless BOTH openwop-auth-saml and openwop-auth-scim are advertised',
      ),
    ).toBe(true);
  });
});

describe('auth-subject-link: cross-lane deactivation (RFC 0159 §A.3 — opt-in)', () => {
  const idpUrl = process.env.OPENWOP_TEST_SAML_IDP_URL;
  const scimUrl = process.env.OPENWOP_TEST_SCIM_URL;

  it('a SCIM deactivation fail-closes the linked SAML identity', async () => {
    const auth = await readAuth();
    if (auth === null || auth.subjectLinking !== true) return softSkip('inapplicable', 'capability-gated');
    if (!idpUrl || !scimUrl) return softSkip('inapplicable', 'opt-in: SAML IdP and/or SCIM endpoint not provided');

    // 1. Provision a SCIM user carrying an opaque, IdP-stable externalId.
    const externalId = 'idp-op-8f3a';
    const provision = await driver.post('/v1/host/sample/auth/scim/provision', {
      scimUrl,
      op: 'create-user',
      externalId,
      userName: 'r.smith',
    });
    if (provision.status === 404) return softSkip('blocked', 'seam unwired');
    expect(provision.status, driver.describe('auth-profiles.md §Subject linking', 'SCIM provisioning MUST succeed')).toBeLessThan(400);

    // 2. A valid SAML assertion whose persistent NameID equals the externalId
    //    links to the same subject and authenticates.
    const before = await driver.post('/v1/host/sample/auth/saml/validate', { idpUrl, variant: 'valid', nameId: externalId });
    if (before.status === 404) return softSkip('blocked', 'seam unwired');
    expect(
      (before.json as { authenticated?: boolean } | undefined)?.authenticated,
      driver.describe('auth-profiles.md §Subject linking', 'a valid linked SAML assertion authenticates before deactivation'),
    ).toBe(true);

    // 3. SCIM-deactivate the provisioned user.
    const deactivate = await driver.post('/v1/host/sample/auth/scim/provision', { scimUrl, op: 'deactivate-user', externalId });
    expect(deactivate.status, driver.describe('auth-profiles.md §Subject linking', 'SCIM deactivation MUST succeed')).toBeLessThan(400);

    // 4. THE CONTRACT: a subsequent SAML assertion for the linked subject MUST
    //    NOT yield an authorized decision (fail-closed across the link).
    const after = await driver.post('/v1/host/sample/auth/saml/validate', { idpUrl, variant: 'valid', nameId: externalId });
    expect(
      (after.json as { authenticated?: boolean } | undefined)?.authenticated === true,
      driver.describe(
        'auth-profiles.md §Subject linking',
        'RFC 0159 §A.3: after a SCIM deactivation the LINKED SAML identity MUST be denied (a provisioned leaver cannot still SSO in)',
      ),
    ).toBe(false);
  });
});

describe('auth-subject-link: link-key hygiene (RFC 0159 §A.2 — opt-in)', () => {
  const idpUrl = process.env.OPENWOP_TEST_SAML_IDP_URL;
  const scimUrl = process.env.OPENWOP_TEST_SCIM_URL;

  it('a mutable/PII link key (email) never produces a cross-lane pass', async () => {
    const auth = await readAuth();
    if (auth === null || auth.subjectLinking !== true) return softSkip('inapplicable', 'capability-gated');
    if (!idpUrl || !scimUrl) return softSkip('inapplicable', 'opt-in: SAML IdP and/or SCIM endpoint not provided');

    // Attempt to form the cross-lane link on email (a mutable/PII attribute).
    // §A.2 forbids it: the host MUST reject the mutable-key link (4xx) OR
    // decline to apply any cross-lane effect from it. Either way, an email
    // "link" MUST NOT yield an authorized cross-lane pass after a deactivation.
    const link = await driver.post('/v1/host/sample/auth/scim/provision', {
      scimUrl,
      op: 'link',
      linkKey: 'email',
      email: 'r.smith@example.test',
    });
    if (link.status === 404) return softSkip('blocked', 'seam unwired');

    if (link.status >= 400) {
      // Conforming: the host rejected a mutable-key link outright.
      expect(
        link.status,
        driver.describe('auth-profiles.md §Subject linking', 'RFC 0159 §A.2: a link on a mutable/PII key (email) MUST be rejected'),
      ).toBeGreaterThanOrEqual(400);
      return;
    }

    // If the host accepted the request, it MUST NOT have formed a cross-lane
    // link on email: a deactivation via the email "link" MUST NOT deny (or
    // otherwise act on) an unrelated SAML subject, and MUST NOT let a mutable
    // key authorize one. Probe: deactivate by email, then a SAML assertion for
    // a DIFFERENT opaque subject MUST be unaffected by the email operation.
    await driver.post('/v1/host/sample/auth/scim/provision', { scimUrl, op: 'deactivate-user', email: 'r.smith@example.test' });
    const other = await driver.post('/v1/host/sample/auth/saml/validate', { idpUrl, variant: 'valid', nameId: 'idp-op-DIFFERENT' });
    expect(
      (other.json as { linkedDenied?: boolean } | undefined)?.linkedDenied === true,
      driver.describe(
        'auth-profiles.md §Subject linking',
        'RFC 0159 §A.2: a mutable-key (email) operation MUST NOT drive a cross-lane deny on any opaque subject',
      ),
    ).toBe(false);
  });
});
