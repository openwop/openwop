/**
 * `refiredAttempts` detects a re-fire that a count comparison cannot
 * (lib/effect-refire.ts; `v2-effect-seam-no-refire`, suite 2.42.2).
 *
 * The first leg is the measured defect: a one-attempt source and a host that
 * re-fires on replay. The old `fork <= parent` check passed it at 1 <= 1.
 */

import { describe, expect, it } from 'vitest';
import { refiredAttempts } from './effect-refire.js';

const PARENT = [{ nodeId: 'fire', attempt: 1, at: '2026-09-26T10:00:00.000Z' }];

describe('refiredAttempts', () => {
  it('a re-firing host stub (one-attempt source, one new attempt on the fork) is caught, where the old count check passed it', () => {
    const fork = [{ nodeId: 'fire', attempt: 1, at: '2026-09-26T10:00:01.250Z' }];
    expect(fork.length <= PARENT.length).toBe(true); // the old assertion: green over a broken host
    expect(refiredAttempts(PARENT, fork)).toHaveLength(1);
  });

  it('a suppressing host passes whether its fork projection is empty or carries the parent attempt as history', () => {
    expect(refiredAttempts(PARENT, [])).toEqual([]);
    expect(refiredAttempts(PARENT, [...PARENT])).toEqual([]);
  });

  it('inherited history plus a re-fire is still a re-fire, and one parent row covers only one fork row', () => {
    expect(refiredAttempts(PARENT, [...PARENT, { nodeId: 'fire', attempt: 1, at: '2026-09-26T10:00:02.000Z' }])).toHaveLength(1);
    expect(refiredAttempts(PARENT, [...PARENT, ...PARENT])).toHaveLength(1);
  });
});
