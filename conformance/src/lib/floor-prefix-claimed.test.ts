/**
 * A prefix floor group (`requiredAnyPrefix`) is a requirement only on a host
 * that claims its profile (2.45.5).
 *
 * The runner wrote `openwop.floor.any.interrupt-` for every floor in the v1
 * table. On a major-1 host that does not claim `openwop-interrupts`, no
 * `interrupt-*` file passes, the row is `blocked`, and a v3 bundle with any
 * `blocked` row certifies nothing (RFC 0168 §E.1). The any-of rows had the
 * same defect until 2.45.4 (`floor-any-of.test.ts`). Proven in both directions.
 */

import { describe, it, expect } from 'vitest';
import { deriveRequirementDispositions } from './scenario-disposition.js';
import { requirementIdForPrefix, requirementIdForScenario } from './requirement-registry.js';
import { PROFILE_FLOOR_SCENARIOS } from './profiles.js';
import type { Disposition, LedgerEntry } from './requirement-ledger.js';

const PROFILE = 'openwop-interrupts';
const PREFIX = 'interrupt-';
const ROW = requirementIdForPrefix(PREFIX);
const FILE = 'interrupt-clarification.test.ts';

const entry = (disposition: Disposition, assertionCount = disposition === 'executed-pass' ? 3 : 0): LedgerEntry =>
  ({ requirementId: requirementIdForScenario(FILE), disposition, assertionCount, ...(disposition === 'executed-pass' ? {} : { detail: 'd' }) } as LedgerEntry);
const report = new Map<string, 'passed' | 'failed' | 'skipped'>([[FILE, 'passed']]);

describe('a prefix floor row is written only for a claimed profile', () => {
  it('the interrupts floor is the prefix group this test is about', () => {
    expect(PROFILE_FLOOR_SCENARIOS[PROFILE]?.requiredAnyPrefix).toEqual([PREFIX]);
  });

  it('a host that does not claim the profile gets no prefix row, so the unclaimed floor cannot block its bundle', () => {
    delete process.env['OPENWOP_TARGET_MAJOR'];
    const unclaimed = deriveRequirementDispositions(report, [entry('inapplicable')], ['openwop-discovery-core'], {});
    expect(unclaimed.requirements.find((r) => r.requirementId === ROW)).toBeUndefined();
    const claimedRun = deriveRequirementDispositions(report, [entry('inapplicable')], [PROFILE], {});
    expect(claimedRun.requirements.find((r) => r.requirementId === ROW)?.disposition).toBe('blocked');
    expect(claimedRun.totals.blocked - unclaimed.totals.blocked).toBe(1);
  });

  it('a claimed profile is unchanged: a witnessed interrupt-* pass satisfies the row', () => {
    delete process.env['OPENWOP_TARGET_MAJOR'];
    const d = deriveRequirementDispositions(report, [entry('executed-pass')], [PROFILE], {});
    expect(d.requirements.find((r) => r.requirementId === ROW)?.disposition).toBe('executed-pass');
  });
});
