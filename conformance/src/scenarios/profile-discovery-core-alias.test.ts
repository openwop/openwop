/**
 * RFC 0155 §A — `openwop-discovery-core` is the canonical name of the discovery
 * predicate; `openwop-core` is its deprecated alias for all of v1 and MUST derive
 * exactly when the canonical name derives.
 *
 * Why a scenario for a rename: the predicate is a discovery-payload check and
 * says nothing about whether a run can be started, suspended, or replayed. A
 * published certification bundle claimed `openwop-core` while failing six
 * `interrupt-*` scenarios (RFC 0155 §A's motivating defect) — possible only
 * because the name did not say what it measured. The rename makes the claim
 * vocabulary unambiguous; this file makes the alias rule checkable:
 *
 *   - both names are in the closed catalog;
 *   - for ANY payload, the alias derives iff the canonical name derives, and
 *     `deriveProfiles` emits both or neither (never the alias alone);
 *   - `profiles.md` states the rename, the alias rule, and the claim
 *     vocabulary (an unqualified claim means `openwop-core-standard`);
 *   - (gated) a live host's derived set contains both or neither.
 *
 * Server-free except the last leg. Reads `profiles.md` from `V1_DIR` when the
 * repo layout is present; skips that leg from the published tarball.
 *
 * @see spec/v1/profiles.md §"openwop-discovery-core" + §"Claim vocabulary"
 * @see RFCS/0155-core-profile-and-extension-discipline.md §A
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { PROFILE_NAMES, deriveProfiles, hasProfile, type DiscoveryPayload } from '../lib/profiles.js';
import { V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const CANONICAL = 'openwop-discovery-core';
const ALIAS = 'openwop-core';

const CORE: DiscoveryPayload = {
  protocolVersion: '1.0', // MAJOR.MINOR — RFC 0149 §C grammar, not semver
  supportedEnvelopes: [],
  schemaVersions: { workflow: 1 },
  limits: { clarificationRounds: 0, schemaRounds: 0, envelopesPerTurn: 0 },
};

/** Payloads on both sides of the predicate, so the equivalence leg is not vacuous. */
const PAYLOADS: ReadonlyArray<readonly [string, DiscoveryPayload]> = [
  ['minimal core', CORE],
  ['rich', { ...CORE, supportedEnvelopes: ['clarification.request'], secrets: { supported: true } }],
  ['empty object', {}],
  ['wrong major', { ...CORE, protocolVersion: '2.0' }],
  ['semver not grammar', { ...CORE, protocolVersion: '1.0.0' }],
  ['missing limits', { protocolVersion: '1.0', supportedEnvelopes: [], schemaVersions: {} }],
  ['negative limit', { ...CORE, limits: { clarificationRounds: -1, schemaRounds: 0, envelopesPerTurn: 0 } }],
  ['envelopes not array', { ...CORE, supportedEnvelopes: 'clarification.request' as unknown as string[] }],
];

describe('RFC 0155 §A — openwop-discovery-core is canonical, openwop-core is its deprecated alias', () => {
  it('both names are in the closed catalog, canonical first', () => {
    expect(PROFILE_NAMES).toContain(CANONICAL);
    expect(PROFILE_NAMES).toContain(ALIAS);
    expect(
      PROFILE_NAMES.indexOf(CANONICAL),
      req('openwop.it.profile-discovery-core-alias.both-names-are-in-the-closed-catalog-canonical-first', 'RFC 0155 §A', 'the canonical name precedes its alias so derived sets read canonical-first'),
    ).toBeLessThan(PROFILE_NAMES.indexOf(ALIAS));
  });

  it('the alias derives exactly when the canonical name derives — for payloads on both sides', () => {
    let trueCount = 0;
    let falseCount = 0;
    for (const [label, c] of PAYLOADS) {
      const canonical = hasProfile(c, CANONICAL);
      const alias = hasProfile(c, ALIAS);
      expect(alias, req('openwop.it.profile-discovery-core-alias.the-alias-derives-exactly-when-the-canonical-name-derives-for-payloads-on-both-s', 'RFC 0155 §A', `${label}: hasProfile(alias) MUST equal hasProfile(canonical)`)).toBe(canonical);
      const derived = deriveProfiles(c);
      expect(
        derived.includes(ALIAS),
        req('openwop.it.profile-discovery-core-alias.the-alias-derives-exactly-when-the-canonical-name-derives-for-payloads-on-both-s', 'RFC 0155 §A', `${label}: deriveProfiles MUST emit the alias iff it emits the canonical name (never the alias alone)`),
      ).toBe(derived.includes(CANONICAL));
      if (canonical) trueCount++;
      else falseCount++;
    }
    // Non-vacuity: an equivalence over payloads that all derive (or none do)
    // proves nothing about the other side.
    expect(trueCount, req('openwop.it.profile-discovery-core-alias.the-alias-derives-exactly-when-the-canonical-name-derives-for-payloads-on-both-s', 'RFC 0155 §A', 'at least one payload MUST derive the predicate')).toBeGreaterThan(0);
    expect(falseCount, req('openwop.it.profile-discovery-core-alias.the-alias-derives-exactly-when-the-canonical-name-derives-for-payloads-on-both-s', 'RFC 0155 §A', 'at least one payload MUST fail the predicate')).toBeGreaterThan(0);
  });

  it('a derived set that carries the alias carries the canonical name immediately before it', () => {
    const derived = deriveProfiles(CORE);
    const i = derived.indexOf(CANONICAL);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(derived[i + 1], req('openwop.it.profile-discovery-core-alias.a-derived-set-that-carries-the-alias-carries-the-canonical-name-immediately-befo', 'RFC 0155 §A', 'alias rides directly beside its canonical name')).toBe(ALIAS);
  });
});

describe.skipIf(V1_DIR === null)('RFC 0155 §A — profiles.md states the rename and the claim vocabulary', () => {
  const doc = () => readFileSync(join(V1_DIR as string, 'profiles.md'), 'utf8');

  it('names the canonical profile and marks openwop-core as a deprecated alias', () => {
    const md = doc();
    expect(md).toMatch(/###\s+`openwop-discovery-core`\s+\(canonical\)/);
    expect(md).toMatch(/alias `openwop-core` \(deprecated\)/);
    expect(md, req('openwop.it.profile-discovery-core-alias.names-the-canonical-profile-and-marks-openwop-core-as-a-deprecated-alias', 'RFC 0155 §A', 'the alias MUST be defined as deriving exactly when the canonical name derives')).toMatch(
      /derives \*\*exactly when\*\* `openwop-discovery-core` derives/,
    );
  });

  it('states that an unqualified conformance claim means openwop-core-standard', () => {
    const md = doc();
    expect(md).toMatch(/unqualified\*\* "OpenWOP conformant".*\*\*MUST\*\* mean \*\*`openwop-core-standard`\*\*/s);
    expect(md, req('openwop.it.profile-discovery-core-alias.states-that-an-unqualified-conformance-claim-means-openwop-core-standard', 'RFC 0155 §A', 'discovery-only claims MUST say openwop-discovery-core')).toMatch(
      /discovery-only\*\* claim \*\*MUST\*\* say \*\*`openwop-discovery-core`\*\*/,
    );
  });

  it('the reference derivation lists the alias beside the canonical name, never alone', () => {
    const md = doc();
    const canonicalLine = md.indexOf("'openwop-discovery-core'             if openwop-discovery-core(c)");
    const aliasLine = md.indexOf("'openwop-core'                       if openwop-discovery-core(c)");
    expect(canonicalLine, req('openwop.it.profile-discovery-core-alias.the-reference-derivation-lists-the-alias-beside-the-canonical-name-never-alone', 'RFC 0155 §A', 'the reference derivation lists the alias beside the canonical name, never alone')).toBeGreaterThan(0);
    expect(aliasLine).toBeGreaterThan(canonicalLine);
  });
});

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0155 §A — a live host derives both names or neither', () => {
  it('the discovery payload derives the alias iff it derives the canonical name', async () => {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return softSkip('blocked', 'precondition not met — `res.status !== 200` returned early (discovery is witnessed elsewhere; this leg is about the alias rule) (seam, prior step, or fixture unavailable)'); // discovery is witnessed elsewhere; this leg is about the alias rule
    const derived = deriveProfiles(res.json as DiscoveryPayload);
    expect(
      derived.includes(ALIAS),
      req('openwop.it.profile-discovery-core-alias.the-discovery-payload-derives-the-alias-iff-it-derives-the-canonical-name', 
        'profiles.md §"openwop-discovery-core"',
        'the deprecated alias MUST derive exactly when the canonical name derives — a host is never `openwop-core` without being `openwop-discovery-core`',
      ),
    ).toBe(derived.includes(CANONICAL));
  });
});
