/**
 * Keeps `SPEC_COHERENCE_SCENARIOS` honest by re-deriving it from source.
 *
 * A hand-maintained list of filenames is a claim that decays silently: a new
 * spec-coherence scenario lands and reports `blocked` in every host's bundle
 * forever, or one grows a `driver` call and starts telling hosts a requirement
 * about their own behaviour does not apply to them. Neither shows up as a
 * failure anywhere — which is the whole reason the original defect survived.
 *
 * The membership rule is mechanical, so the check can be too:
 *   gates on `V1_DIR === null`  AND  never calls `driver.get/post/delete`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_COHERENCE_SCENARIOS, SPEC_COHERENCE_DETAIL, SPEC_COHERENCE_EXCLUDED } from './spec-coherence.js';
import { resolveFileRecord } from './scenario-disposition.js';

const SCENARIOS = new URL('../scenarios/', import.meta.url).pathname;

function derive(): { pure: string[]; hostTouching: string[] } {
  const pure: string[] = [];
  const hostTouching: string[] = [];
  for (const f of readdirSync(SCENARIOS)) {
    if (!f.endsWith('.test.ts')) continue;
    const src = readFileSync(join(SCENARIOS, f), 'utf8');
    if (!/V1_DIR\s*===?\s*null/.test(src)) continue;
    (/\bdriver\.(get|post|delete)\b/.test(src) ? hostTouching : pure).push(f);
  }
  return { pure: pure.sort(), hostTouching: hostTouching.sort() };
}

describe('SPEC_COHERENCE_SCENARIOS is derivable, not asserted', () => {
  it('matches every scenario that reads spec/v1 and never drives a host', () => {
    const { pure } = derive();
    const listed = [...SPEC_COHERENCE_SCENARIOS].sort();
    // Named diffs rather than a bare inequality: a failure here should say
    // which file to add or drop, not that two sets differ.
    expect(pure.filter((f) => !SPEC_COHERENCE_SCENARIOS.has(f)), 'reads spec/v1, drives no host, NOT in the registry — it will report `blocked` in every host bundle').toEqual([]);
    expect(listed.filter((f) => !pure.includes(f)), 'in the registry but no longer qualifies — it now drives a host, or stopped reading spec/v1').toEqual([]);
  });

  it('the EXCLUDED set is exactly the host-touching ones — the exclusions are checked, not asserted in prose', () => {
    // These used to live only in a docblock sentence. A peer grepping this file
    // for membership matched that sentence and read all three named scenarios
    // as members — the opposite of the truth, and the dangerous direction: it
    // would mean host-behaviour rows downgraded to "does not apply to you" as a
    // credit. Naming them in prose made the file lie to a reasonable reader.
    const { hostTouching } = derive();
    expect([...SPEC_COHERENCE_EXCLUDED].sort()).toEqual(hostTouching);
  });

  it('the two sets are disjoint and jointly exhaustive over the V1_DIR-gated files', () => {
    // Disjoint: no scenario can be both "does not apply to any host" and
    // "applies but was unwitnessable". Exhaustive: every V1_DIR-gated file has
    // a decided disposition, so none falls back to the unclassified marker.
    const { pure, hostTouching } = derive();
    const overlap = [...SPEC_COHERENCE_SCENARIOS].filter((f) => SPEC_COHERENCE_EXCLUDED.has(f));
    expect(overlap, 'a scenario cannot be both inapplicable-to-all-hosts and blocked-for-this-host').toEqual([]);
    const union = new Set([...SPEC_COHERENCE_SCENARIOS, ...SPEC_COHERENCE_EXCLUDED]);
    expect([...union].sort()).toEqual([...pure, ...hostTouching].sort());
  });

  it('excludes the host-touching ones, which are honestly `blocked`', () => {
    // These assert ADVERTISED behaviour that a missing dependency prevented
    // exercising — RFC 0148 §A's definition of `blocked`, verbatim. Calling
    // them `inapplicable` would tell a host a requirement about its own
    // behaviour does not apply to it.
    const { hostTouching } = derive();
    expect(hostTouching.length, 'expected some V1_DIR-gated scenarios to also drive the host').toBeGreaterThan(0);
    for (const f of hostTouching) {
      expect(SPEC_COHERENCE_SCENARIOS.has(f), `${f} drives a host and must NOT be classified inapplicable`).toBe(false);
    }
  });

  it('the registry is non-empty — an empty set would silently disable the fix', () => {
    expect(SPEC_COHERENCE_SCENARIOS.size).toBeGreaterThan(20);
  });
});

describe('resolveFileRecord classifies a corpus scenario as inapplicable, not blocked', () => {
  // A published-layout run: describe.skipIf fires at COLLECTION, so vitest
  // reports the file's tests as skipped, nothing notes a reason, and before
  // this change resolveFileRecord returned `blocked` with the unclassified
  // marker — the row a host operator could not tell from a real gap.
  const CORPUS = 'protocol-version-grammar.test.ts';

  it('a corpus scenario that never ran is inapplicable, with a reason aimed at the host operator', () => {
    const r = resolveFileRecord(['skip', 'skip'], undefined, 0, null, CORPUS);
    expect(r.disposition).toBe('inapplicable');
    expect(r.detail).toBe(SPEC_COHERENCE_DETAIL);
    expect(r.detail).toContain('asserts nothing about a host');
    expect(r.detail).toContain('OPENWOP_CONFORMANCE_ROOT');
  });

  it('WITHOUT the registry it would still be blocked — the branch is what changes it', () => {
    // Same inputs, filename withheld: the pre-change behaviour. This is the
    // negative control; if it ever returns `inapplicable`, the branch is not
    // what is doing the work and the test above proves nothing.
    const r = resolveFileRecord(['skip', 'skip'], undefined, 0, null);
    expect(r.disposition).toBe('blocked');
  });

  it('a non-corpus scenario is untouched', () => {
    const r = resolveFileRecord(['skip', 'skip'], undefined, 0, null, 'webhook-signed-delivery.test.ts');
    expect(r.disposition).toBe('blocked');
  });

  it('a corpus scenario that FAILED is never laundered into inapplicable', () => {
    // The guard that matters: if the corpus IS present and an assertion fails,
    // that is a real spec-coherence defect and must stay executed-fail.
    const r = resolveFileRecord(['pass', 'fail'], undefined, 12, null, CORPUS);
    expect(r.disposition).toBe('executed-fail');
  });

  it('a corpus scenario that RAN and passed stays executed-pass', () => {
    const r = resolveFileRecord(['pass'], undefined, 40, null, CORPUS);
    expect(r.disposition).toBe('executed-pass');
  });
});

describe('the published layout is what makes these rows comparable across hosts', () => {
  // Load-bearing and, until now, tested nowhere.
  //
  // A spec-coherence row is `inapplicable` only when V1_DIR is null, and V1_DIR
  // is null only when the layout resolves to `published`. Two peers established
  // by measurement what the code implies: `resolveLayout()` keys off PKG_ROOT,
  // not the consuming repo, so an npm-installed consumer's parent is always
  // `node_modules/@openwop/` — which never contains `schemas/` no matter where
  // the host's checkout sits on disk. Every npm-consuming host therefore gets
  // the same answer, and the dispositions are comparable BY CONSTRUCTION.
  //
  // One peer had generalised the opposite way — "the disposition is a property
  // of where the bundle was cut" — from a host whose own runner sets
  // OPENWOP_CONFORMANCE_ROOT when it finds a sibling checkout. True of that
  // host, false of the artifact. The distinction only survives if something
  // holds the artifact to it.
  //
  // The thing that would break it is a change that looks HELPFUL: adding
  // `spec` to `files` so "the corpus tests run for consumers too". That would
  // silently give npm consumers V1_DIR, the 28 would execute instead of
  // flipping, and every host's numbers would shift with no failure anywhere.
  it('the published package ships no spec/ — so V1_DIR is null for npm consumers', () => {
    const pkg = JSON.parse(readFileSync(join(SCENARIOS, '../../package.json'), 'utf8')) as { files: string[] };
    expect(
      pkg.files.filter((f) => f === 'spec' || f.startsWith('spec/')),
      'adding spec/ to `files` would give npm consumers a V1_DIR, so the spec-coherence rows would execute '
        + 'instead of reporting `inapplicable` — changing every host bundle with no test going red',
    ).toEqual([]);
    // schemas/ IS shipped, and is what selects the `published` layout. If this
    // ever stops being true the layout resolves to neither branch.
    expect(pkg.files, 'schemas/ is what makes resolveLayout() pick `published`').toContain('schemas');
  });
});
