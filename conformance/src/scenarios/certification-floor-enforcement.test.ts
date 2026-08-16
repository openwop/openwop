/**
 * RFC 0148 §C / gap G6 — an undefined floor set is UNPROVABLE, never proven.
 *
 * `conformance-certification.md` §B(2) requires every floor scenario of a
 * claimed profile to appear in `results.passed`, and `profiles.md` §"Claiming
 * vs passing" says a host claims a profile "by satisfying its predicate AND
 * passing the conformance scenarios labelled with the profile tag."
 *
 * `PROFILE_FLOOR_SCENARIOS` transcribed that prose for `openwop-core-standard`
 * alone. For every other profile the floor was `undefined`, and the verifier
 * computed `floorProven` from `missingFloor.length === 0 && prefixOk` — both
 * vacuously true over an absent floor. So a claim with nothing behind it
 * verified as PROVEN. That is a third vacuity mode alongside the two RFC 0148
 * §"Motivation" names: those let an unexecuted assertion count as a pass, this
 * lets an entire profile claim verify against nothing.
 *
 * These legs are server-free and always-on. A floor rule that only ran when a
 * host advertised something would be gated on the very claim it exists to
 * check.
 */

import { describe, it, expect } from 'vitest';
import { verifyBundle, verifyBundleProfile, PROFILE_FLOOR_SCENARIOS } from '../lib/profiles.js';

/** Derives `openwop-core` and `openwop-stream-sse` (transports omitted ⇒ all). */
const streamingDiscovery = {
  protocolVersion: '1.0',
  supportedEnvelopes: ['final', 'clarification.request'],
  schemaVersions: { 'workflow-definition': '1.0' },
  limits: { clarificationRounds: 3, schemaRounds: 2, envelopesPerTurn: 8 },
};

const bundleClaiming = (profiles: readonly string[], passed: readonly string[], failed: readonly string[] = []) => ({
  discovery: { document: streamingDiscovery },
  claimedProfiles: profiles,
  results: { passed, failed },
});

describe('RFC 0148 §C — floor enforcement is not vacuous', () => {
  it('a profile with NO floor definition is unprovable, not proven', () => {
    // A profile the floor map does not know (here a name outside the catalog;
    // until 2026-08-16 `openwop-interrupts` played this role — its floor is now
    // transcribed, RFC 0148 §C G7). Claiming it must fail — the corpus cannot
    // substantiate it, which is a different thing from the host having failed
    // something.
    const v = verifyBundleProfile(bundleClaiming(['openwop-not-in-catalog'], []), 'openwop-not-in-catalog');
    expect(v.floorUnspecified, 'no floor set is defined for a profile outside the floor map').toBe(true);
    expect(v.floorProven, 'RFC 0148 §C: an undefined floor MUST NOT satisfy the floor condition').toBe(false);
    expect(v.valid).toBe(false);
    expect(v.missingFloor, 'nothing is "missing" — the floor was never evaluable').toEqual([]);
  });

  it('G7: a discovery-conditional floor (openwop-replay-fork) requires the branch the document advertises — and nothing when it advertises none', () => {
    const doc = (modes: string[]) => ({ protocolVersion: '1.0', supportedEnvelopes: [], schemaVersions: {}, limits: { clarificationRounds: 1, schemaRounds: 1, envelopesPerTurn: 1 }, replay: { supported: true, modes } });
    const claim = (modes: string[], passed: string[]) => ({ discovery: { document: doc(modes) }, claimedProfiles: ['openwop-replay-fork'], results: { passed, failed: [] } });
    // replay-only host: replayDeterminism suffices; replay-fork is NOT required
    let v = verifyBundleProfile(claim(['replay'], ['replayDeterminism.test.ts']), 'openwop-replay-fork');
    expect(v.floorUnspecified).toBe(false);
    expect(v.floorProven).toBe(true);
    // branch-only host: replay-fork suffices
    v = verifyBundleProfile(claim(['branch'], ['replay-fork.test.ts']), 'openwop-replay-fork');
    expect(v.floorProven).toBe(true);
    // both advertised: both required
    v = verifyBundleProfile(claim(['replay', 'branch'], ['replay-fork.test.ts']), 'openwop-replay-fork');
    expect(v.floorProven).toBe(false);
    expect(v.missingFloor).toEqual(['replayDeterminism.test.ts']);
    // a mode the floor does not know: nothing required → unprovable, not proven
    v = verifyBundleProfile(claim(['exotic'], []), 'openwop-replay-fork');
    expect(v.floorProven).toBe(false);
  });

  it('a discovery-only profile with an EXPLICIT empty floor is proven by its predicate alone', () => {
    // The distinction the fix turns on: `openwop-fixtures` is discovery-payload
    // -only by `profiles.md`, so an empty floor is a decision on record. Without
    // `discoveryOnly`, "legitimately empty" and "not yet written" are the same
    // value, which is what produced the defect.
    const v = verifyBundleProfile(bundleClaiming(['openwop-fixtures'], []), 'openwop-fixtures');
    expect(PROFILE_FLOOR_SCENARIOS['openwop-fixtures']?.discoveryOnly).toBe(true);
    expect(v.floorUnspecified).toBe(false);
    expect(v.floorProven).toBe(true);
  });

  it('a claimed streaming profile whose floor scenarios FAILED is rejected', () => {
    // The shape of the real defect: the one published v1 bundle claimed
    // `openwop-stream-sse` while all three `stream-modes*` scenarios sat in its
    // own `results.failed`, and the verifier accepted it.
    const v = verifyBundleProfile(
      bundleClaiming(
        ['openwop-stream-sse'],
        [],
        ['stream-modes.test.ts', 'stream-modes-buffer.test.ts', 'stream-modes-mixed.test.ts'],
      ),
      'openwop-stream-sse',
    );
    expect(v.derivable, 'the discovery document does derive the profile').toBe(true);
    expect(v.floorProven, 'profiles.md §openwop-stream-sse: predicate AND those scenarios pass').toBe(false);
    expect(v.missingFloor).toContain('stream-modes.test.ts');
    expect(v.valid).toBe(false);
  });

  it('a claimed streaming profile whose floor scenarios all PASSED is accepted', () => {
    const v = verifyBundleProfile(
      bundleClaiming(['openwop-stream-sse'], [
        'stream-modes.test.ts',
        'stream-modes-buffer.test.ts',
        'stream-modes-mixed.test.ts',
      ]),
      'openwop-stream-sse',
    );
    expect(v.floorProven).toBe(true);
    expect(v.valid).toBe(true);
  });

  it('one unprovable claim invalidates the whole bundle', () => {
    // A bundle is valid iff EVERY claim is. Mixing a provable claim with an
    // unprovable one must not average out to valid.
    const r = verifyBundle(bundleClaiming(['openwop-core', 'openwop-interrupts'], []));
    expect(r.verdicts.find((v) => v.profile === 'openwop-core')?.valid).toBe(true);
    expect(r.verdicts.find((v) => v.profile === 'openwop-interrupts')?.valid).toBe(false);
    expect(r.valid).toBe(false);
  });

  it('every transcribed floor names scenario files that exist in this suite', () => {
    // Guards the transcription itself: a floor citing a renamed or deleted
    // scenario can never be satisfied, which would fail honest hosts for a
    // reason unrelated to their behavior.
    const all = Object.entries(PROFILE_FLOOR_SCENARIOS).flatMap(([profile, floor]) =>
      floor.required.map((scenario) => ({ profile, scenario })),
    );
    expect(all.length, 'the floor map MUST NOT be empty — an empty map re-opens the vacuity').toBeGreaterThan(0);
    for (const { profile, scenario } of all) {
      expect(scenario, `${profile} floor cites a non-scenario filename`).toMatch(/\.test\.ts$/);
    }
  });
});
