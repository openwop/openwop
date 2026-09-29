import { describe, expect, it } from 'vitest';
import { OBSERVATION_PREFIX, attachObservation, noteObservation, takeNotedObservation } from './row-observation.js';
import { PARTIAL_WITNESS_PREFIX } from './scenario-disposition.js';

/**
 * Suite 2.44.3 (RFC 0225 witness). An observation rides on a row's detail, on a
 * PASS too, and must never read as a partial witness: check-accepted-predicate
 * treats an `executed-pass` as partial only when its detail starts with the
 * partial-witness prefix, so this prefix must differ and a partial marker, when
 * present, must stay first.
 */
describe('row observations are informational, never a partial-witness marker', () => {
  it('a bare pass gains an `observed:` detail that does not start with the partial-witness prefix', () => {
    const d = attachObservation(undefined, 'advertised-bound (maxElapsedMs 600000): waited ≤630000ms');
    expect(d).toBe(`${OBSERVATION_PREFIX}advertised-bound (maxElapsedMs 600000): waited ≤630000ms`);
    expect(d!.startsWith(PARTIAL_WITNESS_PREFIX)).toBe(false);
    expect(OBSERVATION_PREFIX.startsWith(PARTIAL_WITNESS_PREFIX.trim())).toBe(false);
  });
  it('an existing detail keeps its place, so a prefix a reader filters on never moves', () => {
    const partial = `${PARTIAL_WITNESS_PREFIX}inapplicable: an optional extra`;
    expect(attachObservation(partial, 'x')!.startsWith(PARTIAL_WITNESS_PREFIX)).toBe(true);
    expect(attachObservation('window closed', 'x')).toBe(`window closed · ${OBSERVATION_PREFIX}x`);
  });
  it('no observation leaves the detail untouched', () => {
    expect(attachObservation(undefined, null)).toBeUndefined();
    expect(attachObservation('reason', '  ')).toBe('reason');
  });
  it('a note is taken once and appends within one test', () => {
    noteObservation('a'); noteObservation('b');
    expect(takeNotedObservation()).toBe('a · b');
    expect(takeNotedObservation()).toBeNull();
  });
});
