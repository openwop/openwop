/**
 * auth-subject-link-key-class — RFC 0163: SCIM ⟷ SAML subject-linking
 * hardening (the declarable, witnessable link-key class + the same-IdP
 * trust-root MUST).
 *
 * Status: ACTIVE. RFC 0163 is `Active` (additive follow-on to RFC 0159, which
 * is `Accepted`); wire shape locked 2026-09-01. The obligations are documented in `auth-profiles.md`
 * §"Subject linking (SAML ⟷ SCIM)" → "Link-key-class declaration and same-IdP
 * trust root — RFC 0163", and are discoverable via
 * `capabilities.auth.subjectLinkKey` (a closed enum) under the same
 * `capabilities.auth.subjectLinking` opt-in as RFC 0159.
 *
 * TWO LEGS:
 *   (§A) ADVERTISEMENT — a discovery read, runs whenever both profiles are advertised.
 *        A subjectLinking:true host MUST advertise a subjectLinkKey that is a
 *        member of the CLOSED enum {opaque-idp, configured-immutable}. The
 *        enum names classes, not attributes. Mutable/PII keys are
 *        inexpressible by construction, which is the witness that converts
 *        RFC 0159 §A.2/§A.4's negative-existence prohibition into a positive
 *        advertisement. The schema conditional (subjectLinking:true ⇒
 *        subjectLinkKey required) is pinned server-free in
 *        src/lib/capabilities-auth-subject-link.test.ts.
 *   (§B) SAME-IDP TRUST ROOT — behavioral. A SAML(IdP-A) + SCIM(IdP-B)
 *        identifier collision MUST NOT form a cross-lane link. This leg is
 *        backed by the TWO-TRUST-ROOT fixture engineered in
 *        `conformance/src/lib/saml-idp.ts` (two synthetic IdPs with distinct
 *        `entityID`s / signing keys minting a colliding subject id — RFC 0163
 *        gap G-fixture, addressed in #1163). The fixture's own proof (distinct
 *        roots, colliding subject, signed Issuers, cross-root rejection) lives
 *        in `src/lib/saml-idp.test.ts` — deliberately NOT in this file, so a
 *        host that never advertises linking does not record an executed-pass
 *        about a fixture (certification gap G8). This file carries only the
 *        live BLACK-BOX leg over the host's SCIM+SAML seams, opt-in via the
 *        two-IdP env vars below, `inapplicable` until a host wires the seam.
 *
 * @see RFCS/0163-subject-linking-hardening.md §B (same-IdP trust root)
 * @see conformance/src/lib/saml-idp.ts — the two-trust-root fixture
 * @see spec/v1/auth-profiles.md §"Subject linking (SAML ⟷ SCIM)"
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const SAML_PROFILE = 'openwop-auth-saml';
const SCIM_PROFILE = 'openwop-auth-scim';
const SUBJECT_LINK_KEY_CLASSES = ['opaque-idp', 'configured-immutable'] as const;

interface DiscoveryAuth {
  profiles?: string[];
  subjectLinking?: boolean;
  subjectLinkKey?: string;
}

interface DiscoveryDoc {
  capabilities?: { auth?: DiscoveryAuth };
  extensions?: { auth?: DiscoveryAuth };
}

/** RFC 0164: the gate is the profile PAIR, not the (now derived) flag. */
function advertisesBoth(auth: DiscoveryAuth | null): auth is DiscoveryAuth {
  const p = auth?.profiles ?? [];
  return p.includes(SAML_PROFILE) && p.includes(SCIM_PROFILE);
}

async function readAuth(): Promise<DiscoveryAuth | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily<DiscoveryAuth>(body, 'auth') ?? body?.extensions?.auth ?? null;
}

describe('auth-subject-link-key-class: advertisement shape (RFC 0163 §A)', () => {
  it('subjectLinking:true requires a subjectLinkKey drawn from the closed safe-class enum', async () => {
    const auth = await readAuth();
    if (!advertisesBoth(auth)) {
      return softSkip('inapplicable', 'RFC 0164 gate: host does not advertise both openwop-auth-saml and openwop-auth-scim');
    }

    // §A.1 — a subjectLinking:true host (RFC 0164: any host advertising both
    // profiles) MUST advertise a subjectLinkKey.
    expect(
      typeof auth.subjectLinkKey === 'string' && auth.subjectLinkKey.length > 0,
      driver.describe(
        'auth-profiles.md §Subject linking',
        'RFC 0163 §A.1: a host advertising capabilities.auth.subjectLinking:true MUST also advertise capabilities.auth.subjectLinkKey',
      ),
    ).toBe(true);

    // §A.3 — the value MUST be a member of the CLOSED enum of allowed classes
    // (opaque-idp | configured-immutable). Mutable/PII keys (email, userName,
    // displayName) are absent from the enum by construction, so a conforming
    // host cannot name one.
    expect(
      (SUBJECT_LINK_KEY_CLASSES as readonly string[]).includes(auth.subjectLinkKey ?? ''),
      driver.describe(
        'auth-profiles.md §Subject linking',
        `RFC 0163 §A.3: subjectLinkKey MUST be one of ${SUBJECT_LINK_KEY_CLASSES.join(', ')} — a closed enum of allowed CLASSES (not attributes); a mutable/PII key is inexpressible`,
      ),
    ).toBe(true);
  });

  it('subjectLinkKey is only claimed alongside both SAML and SCIM profiles (rides the RFC 0159 §B gate)', async () => {
    const auth = await readAuth();
    if (auth === null || auth.subjectLinkKey === undefined) {
      return softSkip('inapplicable', 'auth.subjectLinkKey not claimed');
    }
    const profiles = auth.profiles ?? [];
    expect(
      profiles.includes(SAML_PROFILE) && profiles.includes(SCIM_PROFILE),
      driver.describe(
        'auth-profiles.md §Subject linking',
        'RFC 0163: subjectLinkKey is meaningful only when both openwop-auth-saml and openwop-auth-scim are advertised (it names the class the two lanes are joined on)',
      ),
    ).toBe(true);
  });
});

describe('auth-subject-link-key-class: same-IdP trust root (RFC 0163 §B — behavioral, opt-in two-IdP seam)', () => {
  // Two distinct trust roots served over two operator-supplied synthetic-IdP
  // endpoints, plus the RFC 0159 SCIM seam. IdP-A feeds the SCIM lane; IdP-B is
  // the colliding cross-root SAML issuer. Opt-in and soft-skipping until a host
  // wires the two-trust-root seam — it MUST NOT fail a host that has not.
  const idpAUrl = process.env.OPENWOP_TEST_SAML_IDP_URL; // trust root A (also the SCIM lane's IdP)
  const idpBUrl = process.env.OPENWOP_TEST_SAML_IDP_URL_B; // trust root B (the cross-IdP collider)
  const scimUrl = process.env.OPENWOP_TEST_SCIM_URL;

  it('a same-IdP link forms (control) but a cross-IdP collision MUST NOT link', async () => {
    const auth = await readAuth();
    if (!advertisesBoth(auth)) return softSkip('inapplicable', 'RFC 0164 gate: host does not advertise both openwop-auth-saml and openwop-auth-scim');
    if (!idpAUrl || !idpBUrl || !scimUrl) {
      return softSkip('inapplicable', 'opt-in: the two-trust-root seam needs OPENWOP_TEST_SAML_IDP_URL (IdP-A) + OPENWOP_TEST_SAML_IDP_URL_B (IdP-B) + OPENWOP_TEST_SCIM_URL');
    }

    // POSITIVE CONTROL — same trust root both lanes. Provision a SCIM user
    // whose SCIM connection is fed by IdP-A, then present a valid SAML assertion
    // from IdP-A for the same opaque id: the link forms and authenticates.
    // Proving presence here is what keeps the negative leg non-vacuous — "no
    // cross-IdP link" passes identically on a host that never links at all.
    const sameId = 'idp-op-same-8f3a';
    const provSame = await driver.post('/v1/host/sample/auth/scim/provision', {
      scimUrl,
      idpUrl: idpAUrl, // the SCIM connection's IdP trust root
      op: 'create-user',
      externalId: sameId,
      userName: 'r.smith',
    });
    if (provSame.status === 404) return softSkip('blocked', 'SCIM provisioning seam unwired');
    expect(provSame.status, driver.describe('auth-profiles.md §Subject linking', 'SCIM provisioning MUST succeed')).toBeLessThan(400);

    const sameIdp = await driver.post('/v1/host/sample/auth/saml/validate', { idpUrl: idpAUrl, variant: 'valid', nameId: sameId });
    if (sameIdp.status === 404) return softSkip('blocked', 'SAML validate seam unwired');
    expect(
      (sameIdp.json as { authenticated?: boolean } | undefined)?.authenticated,
      driver.describe('auth-profiles.md §Subject linking', 'RFC 0163 §B positive control: a SAML assertion from the SAME IdP trust root as the SCIM lane links and authenticates'),
    ).toBe(true);

    // THE §B.1 MUST — cross-IdP identifier collision. Provision a SCIM user fed
    // by IdP-A, then present a valid SAML assertion for the SAME opaque id but
    // ISSUED BY IdP-B (a different trust root). The string collides; the trust
    // roots do not. The host MUST NOT form the link, so the assertion MUST NOT
    // authenticate as the SCIM-provisioned principal.
    const collideId = 'idp-op-collide-8f3a';
    const provCross = await driver.post('/v1/host/sample/auth/scim/provision', {
      scimUrl,
      idpUrl: idpAUrl, // SCIM lane trust root = IdP-A
      op: 'create-user',
      externalId: collideId,
      userName: 'a.other',
    });
    expect(provCross.status, driver.describe('auth-profiles.md §Subject linking', 'SCIM provisioning MUST succeed')).toBeLessThan(400);

    const crossIdp = await driver.post('/v1/host/sample/auth/saml/validate', { idpUrl: idpBUrl, variant: 'valid', nameId: collideId });
    if (crossIdp.status === 404) return softSkip('blocked', 'SAML validate seam unwired');
    expect(
      (crossIdp.json as { authenticated?: boolean } | undefined)?.authenticated === true,
      driver.describe(
        'auth-profiles.md §Subject linking',
        'RFC 0163 §B.1: a SAML assertion from IdP-B colliding on an identifier the SCIM lane provisioned from IdP-A MUST NOT form a cross-lane link (no cross-IdP identifier collision joins two principals)',
      ),
    ).toBe(false);
  });
});
