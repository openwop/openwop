/**
 * auth-subject-link-key-class — RFC 0163: SCIM ⟷ SAML subject-linking
 * hardening (the declarable, witnessable link-key class + the same-IdP
 * trust-root MUST).
 *
 * Status: DRAFT. RFC 0163 is `Draft` (additive follow-on to RFC 0159, which
 * is `Accepted`). The obligations are documented in `auth-profiles.md`
 * §"Subject linking (SAML ⟷ SCIM)" → "Link-key-class declaration and same-IdP
 * trust root — RFC 0163", and are discoverable via
 * `capabilities.auth.subjectLinkKey` (a closed enum) under the same
 * `capabilities.auth.subjectLinking` opt-in as RFC 0159.
 *
 * TWO LEGS:
 *   (§A) ADVERTISEMENT — server-free, runs whenever subjectLinking:true. A
 *        subjectLinking:true host MUST advertise a subjectLinkKey that is a
 *        member of the CLOSED enum {opaque-idp, oid, immutable-id}. Mutable/PII
 *        keys are inexpressible by construction, which is the witness that
 *        converts RFC 0159 §A.2/§A.4's negative-existence prohibition into a
 *        positive advertisement.
 *   (§B) SAME-IDP TRUST ROOT — behavioral. A SAML(IdP-A) + SCIM(IdP-B)
 *        identifier collision MUST NOT form a cross-lane link. This leg needs a
 *        TWO-TRUST-ROOT fixture (two distinct-entityID synthetic IdPs); it is
 *        DECLARED here and PHASED — soft-skips `blocked` until the fixture is
 *        engineered (RFC 0163 gap G-fixture), mirroring how RFC 0159 phased its
 *        cross-lane behavioral legs. Do not delete this describe block: it is
 *        the placeholder that records the requirement as declared-but-unwitnessed.
 *
 * @see RFCS/0163-subject-linking-hardening.md
 * @see spec/v1/auth-profiles.md §"Subject linking (SAML ⟷ SCIM)"
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const SAML_PROFILE = 'openwop-auth-saml';
const SCIM_PROFILE = 'openwop-auth-scim';
const SUBJECT_LINK_KEY_CLASSES = ['opaque-idp', 'oid', 'immutable-id'] as const;

interface DiscoveryAuth {
  profiles?: string[];
  subjectLinking?: boolean;
  subjectLinkKey?: string;
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

describe('auth-subject-link-key-class: advertisement shape (RFC 0163 §A)', () => {
  it('subjectLinking:true requires a subjectLinkKey drawn from the closed safe-class enum', async () => {
    const auth = await readAuth();
    if (auth === null || auth.subjectLinking !== true) {
      return softSkip('inapplicable', 'auth.subjectLinking not claimed');
    }

    // §A.1 — a subjectLinking:true host MUST advertise a subjectLinkKey.
    expect(
      typeof auth.subjectLinkKey === 'string' && auth.subjectLinkKey.length > 0,
      driver.describe(
        'auth-profiles.md §Subject linking',
        'RFC 0163 §A.1: a host advertising capabilities.auth.subjectLinking:true MUST also advertise capabilities.auth.subjectLinkKey',
      ),
    ).toBe(true);

    // §A.3 — the value MUST be a member of the CLOSED enum of allowed classes
    // (opaque-idp | oid | immutable-id). Mutable/PII keys (email, userName,
    // displayName) are absent from the enum by construction, so a conforming
    // host cannot name one.
    expect(
      (SUBJECT_LINK_KEY_CLASSES as readonly string[]).includes(auth.subjectLinkKey ?? ''),
      driver.describe(
        'auth-profiles.md §Subject linking',
        `RFC 0163 §A.3: subjectLinkKey MUST be one of ${SUBJECT_LINK_KEY_CLASSES.join(', ')} — a closed enum of allowed classes only; a mutable/PII key is inexpressible`,
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

describe('auth-subject-link-key-class: same-IdP trust root (RFC 0163 §B — PHASED, follow-on fixture)', () => {
  it('a SAML(IdP-A) + SCIM(IdP-B) identifier collision MUST NOT form a cross-lane link', async () => {
    const auth = await readAuth();
    if (auth === null || auth.subjectLinking !== true) {
      return softSkip('inapplicable', 'capability-gated on auth.subjectLinking');
    }
    // The §B behavioral leg needs a TWO-TRUST-ROOT fixture (two distinct-entityID
    // synthetic IdPs minting a colliding identifier). That fixture is a declared
    // follow-on (RFC 0163 gap G-fixture); until it is bundled this leg is
    // `blocked` (RFC 0148 §A — unobservable, not unmet), exactly as RFC 0159
    // phased its cross-lane behavioral legs. The requirement is recorded as
    // declared-but-unwitnessed rather than silently omitted.
    return softSkip('blocked', 'RFC 0163 §B two-trust-root fixture is a declared follow-on (gap G-fixture)');
  });
});
