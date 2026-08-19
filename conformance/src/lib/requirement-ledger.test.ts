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
