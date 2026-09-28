/**
 * `unrecordedTests`: a scenario's `afterEach` that throws runs before the
 * runner's recorder (vitest's stack order), so the recorder never sees that
 * test. The file row then read "no test executed" (`blocked`, no reason) over
 * a real failure. `afterAll` recovers such tests from vitest's own results.
 */
import { describe, expect, it } from 'vitest';
import { resolveFileRecord, unrecordedTests } from './scenario-disposition.js';

describe('unrecordedTests', () => {
  it('recovers a failed test the recorder never saw, with its error', () => {
    const hidden = unrecordedTests([{ id: 'a', name: 'leg', state: 'fail', message: 'cleanup 429' }], new Set());
    expect(hidden.states).toEqual(['fail']);
    expect(hidden.failures[0]?.message).toContain('cleanup 429');
    const rec = resolveFileRecord(hidden.states, undefined, 0, null, 'x.test.ts', hidden.failures);
    expect(rec.disposition).toBe('executed-fail');
    expect(rec.detail).toContain('cleanup 429');
  });

  it('leaves recorded and skipped tests to the existing rules', () => {
    const hidden = unrecordedTests(
      [
        { id: 'a', name: 'recorded', state: 'fail', message: 'x' },
        { id: 'b', name: 'skipped', state: 'skip' },
        { id: 'c', name: 'hidden pass', state: 'pass' },
      ],
      new Set(['a']),
    );
    expect(hidden).toEqual({ states: ['pass'], failures: [] });
  });

  it('without the recovery the same file reads "no test executed" (the defect)', () => {
    expect(resolveFileRecord([], undefined, 0, null, 'x.test.ts', []).detail).toContain('no test executed');
  });
});
