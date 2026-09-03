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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyBundle, verifyBundleProfile, PROFILE_FLOOR_SCENARIOS } from '../lib/profiles.js';
import { SCENARIOS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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
    expect(v.floorUnspecified, req('openwop.it.certification-floor-enforcement.a-profile-with-no-floor-definition-is-unprovable-not-proven', 'RFC 0148 §C', 'no floor set is defined for a profile outside the floor map')).toBe(true);
    expect(v.floorProven, req('openwop.it.certification-floor-enforcement.a-profile-with-no-floor-definition-is-unprovable-not-proven', 'RFC 0148 §C', 'RFC 0148 §C: an undefined floor MUST NOT satisfy the floor condition')).toBe(false);
    expect(v.valid).toBe(false);
    expect(v.missingFloor, req('openwop.it.certification-floor-enforcement.a-profile-with-no-floor-definition-is-unprovable-not-proven', 'RFC 0148 §C', 'nothing is "missing" — the floor was never evaluable')).toEqual([]);
  });

  it('G7: a discovery-conditional floor (openwop-replay-fork) requires the branch the document advertises — and nothing when it advertises none', () => {
    const doc = (modes: string[]) => ({ protocolVersion: '1.0', supportedEnvelopes: [], schemaVersions: {}, limits: { clarificationRounds: 1, schemaRounds: 1, envelopesPerTurn: 1 }, replay: { supported: true, modes } });
    const claim = (modes: string[], passed: string[]) => ({ discovery: { document: doc(modes) }, claimedProfiles: ['openwop-replay-fork'], results: { passed, failed: [] } });
    // replay-only host: replayDeterminism suffices; replay-fork is NOT required
    let v = verifyBundleProfile(claim(['replay'], ['replayDeterminism.test.ts', 'replay-side-effect-suppression.test.ts']), 'openwop-replay-fork');
    expect(v.floorUnspecified, req('openwop.it.certification-floor-enforcement.g7-a-discovery-conditional-floor-openwop-replay-fork-requires-the-branch-the-doc', 'RFC 0148 §C', 'G7: a discovery-conditional floor (openwop-replay-fork) requires the branch the document advertises — and nothing when it advertises none')).toBe(false);
    expect(v.floorProven).toBe(true);
    // determinism alone does NOT prove replay mode: caveat 1 (no re-fire) is part of the branch
    v = verifyBundleProfile(claim(['replay'], ['replayDeterminism.test.ts']), 'openwop-replay-fork');
    expect(v.floorProven).toBe(false);
    expect(v.missingFloor).toEqual(['replay-side-effect-suppression.test.ts']);
    // branch-only host: replay-fork suffices
    v = verifyBundleProfile(claim(['branch'], ['replay-fork.test.ts']), 'openwop-replay-fork');
    expect(v.floorProven).toBe(true);
    // both advertised: both required
    v = verifyBundleProfile(claim(['replay', 'branch'], ['replay-fork.test.ts', 'replay-side-effect-suppression.test.ts']), 'openwop-replay-fork');
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
    expect(PROFILE_FLOOR_SCENARIOS['openwop-fixtures']?.discoveryOnly, req('openwop.it.certification-floor-enforcement.a-discovery-only-profile-with-an-explicit-empty-floor-is-proven-by-its-predicate', 'RFC 0148 §C', 'a discovery-only profile with an EXPLICIT empty floor is proven by its predicate alone')).toBe(true);
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
    expect(v.derivable, req('openwop.it.certification-floor-enforcement.a-claimed-streaming-profile-whose-floor-scenarios-failed-is-rejected', 'RFC 0148 §C', 'the discovery document does derive the profile')).toBe(true);
    expect(v.floorProven, req('openwop.it.certification-floor-enforcement.a-claimed-streaming-profile-whose-floor-scenarios-failed-is-rejected', 'RFC 0148 §C', 'profiles.md §openwop-stream-sse: predicate AND those scenarios pass')).toBe(false);
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
    expect(v.floorProven, req('openwop.it.certification-floor-enforcement.a-claimed-streaming-profile-whose-floor-scenarios-all-passed-is-accepted', 'RFC 0148 §C', 'a claimed streaming profile whose floor scenarios all PASSED is accepted')).toBe(true);
    expect(v.valid).toBe(true);
  });

  it('one unprovable claim invalidates the whole bundle', () => {
    // A bundle is valid iff EVERY claim is. Mixing a provable claim with an
    // unprovable one must not average out to valid.
    const r = verifyBundle(bundleClaiming(['openwop-core', 'openwop-interrupts'], []));
    expect(r.verdicts.find((v) => v.profile === 'openwop-core')?.valid, req('openwop.it.certification-floor-enforcement.one-unprovable-claim-invalidates-the-whole-bundle', 'RFC 0148 §C', 'one unprovable claim invalidates the whole bundle')).toBe(true);
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
    expect(all.length, req('openwop.it.certification-floor-enforcement.every-transcribed-floor-names-scenario-files-that-exist-in-this-suite', 'RFC 0148 §C', 'the floor map MUST NOT be empty — an empty map re-opens the vacuity')).toBeGreaterThan(0);
    for (const { profile, scenario } of all) {
      expect(scenario, req('openwop.it.certification-floor-enforcement.every-transcribed-floor-names-scenario-files-that-exist-in-this-suite', 'RFC 0148 §C', `${profile} floor cites a non-scenario filename`)).toMatch(/\.test\.ts$/);
    }

    // 2026-08-18: this leg's NAME promised "files that exist" and it only
    // matched the `.test.ts` suffix — a string check wearing an existence
    // check's name. The phantom `audit-log-verification.test.ts` floor row sat
    // in `openwop-core-standard` until `--certify` hit it against a live host,
    // because nothing here opened the directory.
    if (SCENARIOS_DIR === null) return softSkip('blocked', 'precondition not met — `SCENARIOS_DIR === null` returned early (published layout ships src/, but stay honest if it ever does not) (seam, prior step, or fixture unavailable)'); // published layout ships src/, but stay honest if it ever does not
    const dir = SCENARIOS_DIR as string;
    const missing = all
      .filter(({ scenario }) => !existsSync(join(dir, scenario)))
      .map(({ profile, scenario }) => `${profile} → ${scenario}`);
    expect(
      missing,
      'a floor cites a scenario file that does not exist — that requirement can never be satisfied, ' +
        'so the profile can never certify, for a reason unrelated to any host',
    ).toEqual([]);
  });

  it('no floor scenario is corpus-only — a floor must be provable from the published package', () => {
    // openwop-app's suggestion, and it is right that this be a red test rather
    // than a paragraph: the failure mode is SOMEONE LATER adding a corpus
    // self-check to a floor, and prose in a PR body will not be in front of
    // them.
    //
    // A scenario that can only run in a repo checkout (it reads `spec/` or
    // `RFCS/` through `V1_DIR`) records `blocked` in the published layout,
    // where the package ships no corpus by design. `blocked` is correct there
    // — RFC 0148 §A defines it as a missing dependency — but a `blocked`
    // requirement in a claimed profile invalidates that profile. So a
    // corpus-only scenario in a floor makes the profile UNCERTIFIABLE from the
    // npm tarball, permanently, for a reason no host can fix. It is the mirror
    // of the phantom-row trap above: that one named a file that does not
    // exist, this one names a file that cannot execute where certification is
    // measured.
    if (SCENARIOS_DIR === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `SCENARIOS_DIR === null` returned early (openwop-app\'s suggestion, and it is right that this be a red test rather than a paragraph: the failure mode is SOMEONE …');
    const dir = SCENARIOS_DIR as string;

    /** Every `it`/`test` in the file is V1_DIR-guarded, or every `describe` is. */
    const isCorpusOnly = (source: string): boolean => {
      if (!source.includes('V1_DIR')) return false;
      const guard = /\(V1_DIR === null\)/;
      const its = [...source.matchAll(/\b(?:it|test)(\.skipIf\([^)]*\))?\s*\(/g)];
      const describes = [...source.matchAll(/\bdescribe(\.skipIf\([^)]*\))?\s*\(/g)];
      const allItsGuarded = its.length > 0 && its.every((m) => guard.test(m[1] ?? ''));
      const allDescribesGuarded = describes.length > 0 && describes.every((m) => guard.test(m[1] ?? ''));
      return allItsGuarded || allDescribesGuarded;
    };

    const offenders = Object.entries(PROFILE_FLOOR_SCENARIOS)
      .flatMap(([profile, floor]) => floor.required.map((scenario) => ({ profile, scenario })))
      .filter(({ scenario }) => {
        const path = join(dir, scenario);
        return existsSync(path) && isCorpusOnly(readFileSync(path, 'utf8'));
      })
      .map(({ profile, scenario }) => `${profile} → ${scenario}`);

    expect(
      offenders,
      req('openwop.it.certification-floor-enforcement.no-floor-scenario-is-corpus-only-a-floor-must-be-provable-from-the-published-pac', 'RFC 0148 §C', 'a profile floor cites a CORPUS-ONLY scenario (all of its tests are guarded on `V1_DIR === null`). ' +
        'It records `blocked` in the published layout, so that profile can never certify from the npm ' +
        'tarball — no host can fix it. Keep corpus self-checks out of floors.'),
    ).toEqual([]);
  });
});
