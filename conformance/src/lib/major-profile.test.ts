/**
 * The per-major table: a missing row is loud, and the two rows differ where
 * the majors differ.
 */

import { describe, expect, it } from 'vitest';
import { MAJOR_PROFILES, majorProfile } from './major-profile.js';

describe('major-profile', () => {
  it('a major with no row throws and names the fix, never falling back to an older major', () => {
    expect(() => majorProfile(3)).toThrow(/add a row to MAJOR_PROFILES/);
  });

  it('every row is keyed by its own major', () => {
    for (const [k, p] of Object.entries(MAJOR_PROFILES)) expect(p.major).toBe(Number(k));
  });

  it('family advertisement: v1 needs supported: true, v2 needs the record', () => {
    const doc = { budget: { dimensions: ['toolCalls'] }, production: { supported: true } };
    expect(majorProfile(1).family(doc, 'budget')).toBeNull();
    expect(majorProfile(1).family(doc, 'production')).not.toBeNull();
    expect(majorProfile(2).family(doc, 'budget')).not.toBeNull();
    expect(majorProfile(2).family(doc, 'absent')).toBeNull();
  });

  it('a run budget has a createRun surface at major 2 and none at major 1', () => {
    expect(majorProfile(1).runBudget({ maxToolCalls: 2 })).toBeNull();
    expect(majorProfile(2).runBudget({ maxToolCalls: 2 })).toEqual({ configurable: { version: 1, budget: { maxToolCalls: 2 } } });
  });

  it('retry timing and event names follow the major', () => {
    expect(majorProfile(1).retryTiming).toBe('header-and-details');
    expect(majorProfile(2).retryTiming).toBe('header-only');
    expect(majorProfile(1).eventType('budget.threshold.crossed')).toBe('budget.threshold.crossed');
    expect(majorProfile(2).eventType('budget.threshold.crossed')).toBe('budget.threshold-crossed');
  });
});
