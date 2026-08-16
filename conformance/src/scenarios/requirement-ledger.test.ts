/**
 * RFC 0148 §A — the requirement execution ledger, and the properties that make
 * it non-vacuous.
 *
 * §A's operative sentence is negative: "A plain test return, caught exception
 * converted to a return, or empty assertion body **MUST NOT** produce
 * `executed-pass`." A ledger that merely *offers* five dispositions does not
 * deliver that — it delivers it only if **absence** resolves to something other
 * than a pass, because every vacuity found in this corpus so far reached
 * `pass` by not running rather than by running wrong:
 *
 *   - `floorProven = missingFloor.length === 0 && prefixOk` over an undefined
 *     floor — `[].every(...)` is `true`;
 *   - a gated subtest that 404'd, soft-skipped, and left the file green;
 *   - a scenario whose assertions never executed but whose file still counted.
 *
 * So these legs test the *default*, not the happy path. A ledger where an
 * unrecorded requirement reads as `executed-pass` would pass every
 * disposition-vocabulary check and still be the bug.
 *
 * Server-free and always-on.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  DISPOSITIONS,
  CERTIFIABLE,
  recordRequirement,
  dispositionOf,
  entryOf,
  snapshot,
  resetLedger,
  suspendSinkForFixtures,
  verifyProfileRequirements,
} from '../lib/requirement-ledger.js';
import { allRequirements, requirementsFor } from '../lib/requirement-registry.js';

// This file records REAL requirement ids as fixtures; keep them out of a live
// --certify ledger sink (they would out-vote genuine dispositions).
let restoreSink: (() => void) | undefined;
beforeAll(() => {
  restoreSink = suspendSinkForFixtures();
});
afterAll(() => restoreSink?.());

describe('RFC 0148 §A — requirement execution ledger', () => {
  beforeEach(() => resetLedger());

  it('the disposition vocabulary is exactly the five §A names', () => {
    expect([...DISPOSITIONS].sort()).toEqual(
      ['blocked', 'executed-fail', 'executed-pass', 'inapplicable', 'skipped'].sort(),
    );
  });

  it('an unrecorded requirement resolves to blocked, NOT to a pass', () => {
    // The load-bearing leg. A scenario that returned early, threw and swallowed,
    // or was never written leaves no entry — and the honest reading of no entry
    // is "not exercised". Every vacuity in this corpus reached `pass` this way.
    expect(
      dispositionOf('openwop.never.recorded'),
      'RFC 0148 §A: silence is evidence of nothing. An absent disposition MUST NOT read as executed-pass.',
    ).toBe('blocked');
    expect(entryOf('openwop.never.recorded').detail).toMatch(/not exercised/);
  });

  it('blocked is not certifiable, while skipped and inapplicable are', () => {
    // "We could not check" and "we checked and it holds" are the two states this
    // whole program exists to stop conflating.
    expect(CERTIFIABLE).not.toContain('blocked');
    expect(CERTIFIABLE).not.toContain('executed-fail');
    expect([...CERTIFIABLE].sort()).toEqual(['executed-pass', 'inapplicable', 'skipped']);
  });

  it('a profile with no requirements is not certifiable', () => {
    // This is the `[].every(...)` shape itself. An empty requirement list must
    // not vacuously certify; callers distinguish "no floor by design" from "no
    // floor written yet" BEFORE reaching here.
    const verdict = verifyProfileRequirements('openwop-example', []);
    expect(
      verdict.certifiable,
      'RFC 0148 §C / gap G6: an empty requirement set is exactly the vacuity that started this program.',
    ).toBe(false);
  });

  it('one blocked requirement invalidates the whole profile', () => {
    recordRequirement('openwop.a', 'executed-pass');
    recordRequirement('openwop.b', 'skipped', 'profile not advertised; operator opted out');
    const verdict = verifyProfileRequirements('openwop-example', ['openwop.a', 'openwop.b', 'openwop.c']);
    expect(verdict.certifiable, 'RFC 0148 §A: a blocked requirement invalidates the claim').toBe(false);
    expect(verdict.blocking.map((b) => b.requirementId)).toEqual(['openwop.c']);
  });

  it('a fully-exercised profile certifies', () => {
    recordRequirement('openwop.a', 'executed-pass');
    recordRequirement('openwop.b', 'inapplicable', 'host advertises no streaming surface');
    expect(verifyProfileRequirements('openwop-example', ['openwop.a', 'openwop.b']).certifiable).toBe(true);
  });

  it('a non-pass disposition without a reason is rejected', () => {
    // A `blocked` with no explanation is an outcome nobody can act on, and it is
    // the shape a lazily-instrumented scenario would emit by default.
    expect(() => recordRequirement('openwop.a', 'blocked')).toThrow(/without a reason/);
    expect(() => recordRequirement('openwop.b', 'skipped', '   ')).toThrow(/without a reason/);
    // A pass needs no prose — the assertion itself is the evidence.
    expect(() => recordRequirement('openwop.c', 'executed-pass')).not.toThrow();
  });

  it('contradictory dispositions for one requirement throw rather than last-write-wins', () => {
    // Silent overwrite would let a later soft-skip bury an earlier real failure
    // — the same conflation running the other direction.
    recordRequirement('openwop.a', 'executed-fail', 'assertion failed against target');
    expect(() => recordRequirement('openwop.a', 'executed-pass')).toThrow(/already recorded/);
    expect(dispositionOf('openwop.a')).toBe('executed-fail');
  });

  it('re-recording the same disposition is idempotent', () => {
    recordRequirement('openwop.a', 'executed-pass');
    recordRequirement('openwop.a', 'executed-pass');
    expect(snapshot()).toHaveLength(1);
  });
});

describe('RFC 0148 §A — the registry binds to the certification floor', () => {
  beforeEach(() => resetLedger());

  it('every profile with a runtime floor yields requirement IDs', () => {
    // Guard: an empty registry would make the legs below vacuous.
    expect(allRequirements().length, 'the floor MUST produce requirement IDs').toBeGreaterThan(10);
    expect(allRequirements()).toContain('openwop.floor.runs-lifecycle');
    expect(allRequirements()).toContain('openwop.floor.any.interrupt-');
  });

  it('an unwritten floor returns null, not an empty list', () => {
    // `openwop-replay-fork` is deliberately unspecified — `profiles.md` gives it
    // a discovery-conditional floor a flat list cannot express (gap G7). Null
    // forces the caller to decide; an empty array would silently certify.
    expect(
      requirementsFor('openwop-replay-fork'),
      'RFC 0148 §C: unspecified MUST be distinguishable from empty-by-design',
    ).toBeNull();
    expect(requirementsFor('openwop-does-not-exist')).toBeNull();
  });

  it('a discovery-only profile returns an empty list, which does not certify', () => {
    // `openwop-core` has no runtime floor BY DESIGN — the predicate is the whole
    // claim. That is a decision on record, and it is still not a runtime pass.
    expect(requirementsFor('openwop-core')).toEqual([]);
    expect(
      verifyProfileRequirements('openwop-core', requirementsFor('openwop-core') ?? []).certifiable,
      'RFC 0155 §A: an `openwop-core` badge is a statement about a document, not a running system',
    ).toBe(false);
  });

  it('the real core-standard floor does not certify until every requirement is exercised', () => {
    const ids = requirementsFor('openwop-core-standard');
    expect(ids).not.toBeNull();
    const requirements = ids as readonly string[];
    // Nothing recorded yet: every requirement is blocked, so the profile fails.
    expect(verifyProfileRequirements('openwop-core-standard', requirements).blocking).toHaveLength(
      requirements.length,
    );
    // Record all but one — still not certifiable. Partial evidence is not evidence.
    for (const id of requirements.slice(1)) recordRequirement(id, 'executed-pass');
    const partial = verifyProfileRequirements('openwop-core-standard', requirements);
    expect(partial.certifiable).toBe(false);
    expect(partial.blocking.map((b) => b.requirementId)).toEqual([requirements[0]]);
    // Record the last one and it certifies.
    recordRequirement(requirements[0] as string, 'executed-pass');
    expect(verifyProfileRequirements('openwop-core-standard', requirements).certifiable).toBe(true);
  });
});
