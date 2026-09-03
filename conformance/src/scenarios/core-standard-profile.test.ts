/**
 * openwop-core-standard — operational-annex predicate derivation (RFC 0088).
 *
 * Always-on, server-free derivation probe. Verifies that `isCoreStandard`
 * derives the Core Standard Profile floor correctly from representative
 * discovery payloads (RFC 0088 §B / core-standard-profile.md §B):
 *   - a host meeting openwop-core + openwop-interrupts + a transport is core-standard;
 *   - a bare openwop-core host (no interrupts) is NOT core-standard — the floor is
 *     deliberately stricter than the v1 minimum;
 *   - a host with no event transport (supportedTransports: []) fails the floor;
 *   - the floor is the AND of three existing closed-catalog predicates (it composes,
 *     it does not redefine — so it is absent from deriveProfiles()).
 *
 * The LIVE aggregate-evidence assertion (does every §C floor scenario actually
 * pass against a host claiming the profile?) is the `Active → Accepted` step per
 * RFC 0088 §C — already satisfied by MyndHyve + all reference hosts, asserted via
 * each constituent scenario, and deferred here. This scenario asserts the
 * discovery-predicate derivation only.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/core-standard-profile.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0088-core-standard-profile.md
 */

import { describe, it, expect } from 'vitest';
import { isCoreStandard, isCore, deriveProfiles } from '../lib/profiles.js';
import { req } from '../lib/requirement-ids.js';

const CORE = {
  protocolVersion: '1.0',
  supportedEnvelopes: ['clarification.request'],
  schemaVersions: {},
  limits: { clarificationRounds: 1, schemaRounds: 1, envelopesPerTurn: 1 },
};

describe('core-standard-profile: floor predicate (RFC 0088 §B, server-free)', () => {
  it('a host meeting core + interrupts + a default transport is core-standard', () => {
    // No supportedTransports ⇒ both stream predicates default-true (profiles.md).
    const c = { ...CORE };
    expect(isCoreStandard(c), req('openwop.it.core-standard-profile.a-host-meeting-core-interrupts-a-default-transport-is-core-standard', 'core-standard-profile.md §B', 'core + interrupts + transport ⇒ core-standard')).toBe(true);
  });

  it('a bare openwop-core host without interrupts is NOT core-standard', () => {
    // openwop-core minimum, but no clarification.request ⇒ fails openwop-interrupts.
    const c = { ...CORE, supportedEnvelopes: ['schema.request'] };
    expect(isCore(c), req('openwop.it.core-standard-profile.a-bare-openwop-core-host-without-interrupts-is-not-core-standard', 'profiles.md §openwop-core', 'still a valid openwop-core host')).toBe(true);
    expect(isCoreStandard(c), req('openwop.it.core-standard-profile.a-bare-openwop-core-host-without-interrupts-is-not-core-standard', 'core-standard-profile.md §B', 'the floor is stricter than the v1 minimum')).toBe(false);
  });

  it('a host advertising no event transport fails the floor', () => {
    const c = { ...CORE, supportedTransports: [] as string[] };
    expect(isCoreStandard(c), req('openwop.it.core-standard-profile.a-host-advertising-no-event-transport-fails-the-floor', 'core-standard-profile.md §B', 'at least one event transport is required')).toBe(false);
  });

  it('a host advertising the rest transport satisfies the transport term', () => {
    const c = { ...CORE, supportedTransports: ['rest'] };
    expect(isCoreStandard(c), req('openwop.it.core-standard-profile.a-host-advertising-the-rest-transport-satisfies-the-transport-term', 'core-standard-profile.md §B', 'rest transport ⇒ stream term satisfied')).toBe(true);
  });

  it('a non-1.x host is not core-standard', () => {
    const c = { ...CORE, protocolVersion: '2.0' };
    expect(isCoreStandard(c), req('openwop.it.core-standard-profile.a-non-1-x-host-is-not-core-standard', 'profiles.md §openwop-core', 'core-standard implies openwop-core (1.x)')).toBe(false);
  });
});

describe('core-standard-profile: composes, does not redefine (RFC 0088 §A, server-free)', () => {
  it('openwop-core-standard is an annex, NOT a closed-catalog profile (absent from deriveProfiles)', () => {
    const c = { ...CORE };
    expect(
      (deriveProfiles(c) as readonly string[]).includes('openwop-core-standard'),
      req('openwop.it.core-standard-profile.openwop-core-standard-is-an-annex-not-a-closed-catalog-profile-absent-from-deriv', 'core-standard-profile.md §A', 'the annex is not a closed-catalog predicate'),
    ).toBe(false);
  });
});
