/**
 * Unit tests for `requirement-ledger.ts` — recording precedence.
 *
 * These pin the property `setup.ts` relies on when it decides whether to write
 * its automatic file-level record: a scenario that classified ITSELF must win
 * outright. The comment on that line claimed as much for years while the code
 * only delivered it on DISAGREEMENT — a same-disposition re-record reached
 * `ledger.set` and replaced the scenario's own `detail` and `assertionCount`
 * with the file-level ones. Harmless while details were rarely set on a pass;
 * visible the moment `resolveFileRecord` began attaching a `partial-witness:`
 * marker, which would have stamped "may not have witnessed this" over a
 * scenario's own explicit finding.
 *
 * @see requirement-ledger.ts, setup.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordRequirement,
  hasRequirement,
  entryOf,
  dispositionOf,
  resetLedger,
} from './requirement-ledger.js';

const ID = 'openwop.scenario.ledger-precedence-fixture';

beforeEach(() => {
  resetLedger();
});

describe('requirement-ledger: recording precedence', () => {
  it('hasRequirement distinguishes "not recorded" from "recorded", which dispositionOf cannot', () => {
    // `dispositionOf` folds the absent case to `blocked`, so it reads the same
    // for a requirement nobody touched and one deliberately recorded blocked.
    expect(hasRequirement(ID)).toBe(false);
    expect(dispositionOf(ID)).toBe('blocked');

    recordRequirement(ID, 'blocked', 'seam absent');
    expect(hasRequirement(ID)).toBe(true);
    expect(dispositionOf(ID)).toBe('blocked');
  });

  it('a same-disposition re-record OVERWRITES detail and assertionCount — the reason setup.ts must guard', () => {
    recordRequirement(ID, 'executed-pass', 'witnessed the MUST NOT on the wire', { assertionCount: 9 });
    expect(entryOf(ID).detail).toBe('witnessed the MUST NOT on the wire');

    // No throw: `recordRequirement` only rejects a CONFLICTING disposition.
    recordRequirement(ID, 'executed-pass', 'partial-witness: inapplicable: branch leg skipped', { assertionCount: 2 });
    expect(entryOf(ID).detail).toBe('partial-witness: inapplicable: branch leg skipped');
    expect(entryOf(ID).assertionCount).toBe(2);
  });

  it('a CONFLICTING disposition throws, which is how the explicit record already won on disagreement', () => {
    recordRequirement(ID, 'executed-pass', undefined, { assertionCount: 4 });
    expect(() => recordRequirement(ID, 'blocked', 'file-level fold said blocked')).toThrow(/already recorded/);
    // The first recording survives the rejected second one.
    expect(dispositionOf(ID)).toBe('executed-pass');
  });

  it('guarding on hasRequirement preserves the explicit record in BOTH directions', () => {
    // This is precisely what setup.ts now does before its automatic write.
    recordRequirement(ID, 'executed-pass', 'witnessed the MUST NOT on the wire', { assertionCount: 9 });
    if (!hasRequirement(ID)) {
      recordRequirement(ID, 'executed-pass', 'partial-witness: inapplicable: branch leg skipped', { assertionCount: 2 });
    }
    expect(entryOf(ID).detail).toBe('witnessed the MUST NOT on the wire');
    expect(entryOf(ID).assertionCount).toBe(9);
  });

  it('still refuses a non-pass disposition with no reason — an unactionable row', () => {
    expect(() => recordRequirement(ID, 'blocked', '   ')).toThrow(/without a reason/);
    expect(hasRequirement(ID)).toBe(false);
  });
});

/**
 * `fold: true` — the per-`it` path (2.37.0).
 *
 * MEASURED, `v2-run-bulk-cancel.test.ts` on a tier-2 host, both rows from ONE
 * run: `openwop.floor.v2-run-bulk-cancel` `executed-fail`, 10 assertions;
 * `openwop.requirement.0170.run-bulk-cancel` `executed-pass`, 3. The file has
 * two `it`s and both hand `req()` the same module-level `const ID` — leg 1
 * passed with 3 assertions, leg 2 failed on its 7th. `setup.ts` computed the
 * failing row, `recordRequirement` threw on the conflict, and `setup.ts`'s
 * "never fail a test for bookkeeping" catch swallowed it. The verdict never
 * reached the ledger OR the JSONL sink, so the requirement read as a clean pass
 * while its own file read as a failure, and the message naming what the host
 * had actually returned was destroyed.
 *
 * 27 scenario files share one explicit id across several `it`s this way (the
 * `check-req-only` duplicate-id rule reads only STRING LITERALS at the call
 * site, so a `const` is invisible to it), so this was never one file's bug.
 */
describe('requirement-ledger: fold (several `it` legs, one requirement id)', () => {
  it('a FAILING leg after a passing one wins the row and keeps its message', () => {
    recordRequirement(ID, 'executed-pass', undefined, { assertionCount: 3, fold: true });
    recordRequirement(ID, 'executed-fail', 'the test executed and failed in "results[] come back in request order": an own entry MUST be ok: true', { assertionCount: 7, fold: true });
    expect(dispositionOf(ID)).toBe('executed-fail');
    expect(entryOf(ID).detail).toMatch(/an own entry MUST be ok: true/);
    // Both legs really did assert for this one requirement — the count sums,
    // and now agrees with the file row's 10 instead of reporting leg 1's 3.
    expect(entryOf(ID).assertionCount).toBe(10);
  });

  it('order does not decide the verdict: passing leg SECOND reads the same', () => {
    recordRequirement(ID, 'executed-fail', 'leg 2 failed', { assertionCount: 7, fold: true });
    recordRequirement(ID, 'executed-pass', undefined, { assertionCount: 3, fold: true });
    expect(dispositionOf(ID)).toBe('executed-fail');
    expect(entryOf(ID).detail).toBe('leg 2 failed');
    expect(entryOf(ID).assertionCount).toBe(10);
  });

  it('folds by CERTIFIABILITY, the same rank readLedgerFile applies across workers', () => {
    // blocked (1) beats executed-pass (2): a requirement one leg could not
    // observe does not certify on the strength of another leg (RFC 0168 §E.1).
    recordRequirement(ID, 'executed-pass', undefined, { assertionCount: 2, fold: true });
    recordRequirement(ID, 'blocked', 'the seam answered 404', { assertionCount: 0, fold: true });
    expect(dispositionOf(ID)).toBe('blocked');
    expect(entryOf(ID).detail).toBe('the seam answered 404');

    resetLedger();
    // executed-pass (2) beats inapplicable (4): a leg that did not apply must
    // not erase a leg that was genuinely witnessed.
    recordRequirement(ID, 'inapplicable', 'facet not advertised', { assertionCount: 0, fold: true });
    recordRequirement(ID, 'executed-pass', undefined, { assertionCount: 5, fold: true });
    expect(dispositionOf(ID)).toBe('executed-pass');
    expect(entryOf(ID).assertionCount).toBe(5);
  });

  it('WITHOUT fold the conflict still throws — a scenario that classifies itself twice is an authoring bug', () => {
    recordRequirement(ID, 'executed-pass', undefined, { assertionCount: 4 });
    expect(() => recordRequirement(ID, 'executed-fail', 'and again')).toThrow(/already recorded/);
  });
});
