/**
 * Unit tests for `polling.ts` — the poll-bound scaling knob.
 *
 * These exist because the defect being fixed was a knob that did not reach
 * what its documentation said it reached: `OPENWOP_LIFECYCLE_TIMEOUT_MS` was
 * documented as the way to bound long polls, but it supplies only the DEFAULT,
 * so every call site passing an explicit `timeoutMs` ignored it. Shipping the
 * replacement untested would repeat the defect one layer up, so the scale is
 * asserted here rather than assumed.
 *
 * @see polling.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { scaledTimeoutMs } from './polling.js';

const KEY = 'OPENWOP_POLL_TIMEOUT_SCALE';

function withScale(value: string | undefined, fn: () => void): void {
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  fn();
}

afterEach(() => {
  delete process.env[KEY];
});

describe('polling: scaledTimeoutMs', () => {
  it('is an exact no-op when the knob is unset — no existing measurement moves', () => {
    withScale(undefined, () => {
      for (const ms of [100, 1_000, 5_000, 10_000, 15_000, 30_000, 60_000]) {
        expect(scaledTimeoutMs(ms)).toBe(ms);
      }
    });
  });

  it('is an exact no-op at scale 1, including the string form', () => {
    withScale('1', () => expect(scaledTimeoutMs(10_000)).toBe(10_000));
    withScale('1.0', () => expect(scaledTimeoutMs(10_000)).toBe(10_000));
  });

  it('scales explicit bounds, which the documented env var could never reach', () => {
    withScale('3', () => {
      expect(scaledTimeoutMs(10_000)).toBe(30_000);
      expect(scaledTimeoutMs(15_000)).toBe(45_000);
    });
  });

  it('preserves the ORDERING of deliberately-short bounds — the reason this scales rather than floors', () => {
    withScale('4', () => {
      const short = scaledTimeoutMs(100);
      const long = scaledTimeoutMs(10_000);
      expect(short).toBe(400);
      expect(long).toBe(40_000);
      // A floor would have collapsed these two to the same value, silently
      // rewriting every negative assertion that depends on a short bound.
      expect(short).toBeLessThan(long);
    });
  });

  it('rounds up, so a fractional scale never shortens a bound', () => {
    withScale('1.5', () => expect(scaledTimeoutMs(1_001)).toBe(1_502));
    withScale('1.0001', () => expect(scaledTimeoutMs(100)).toBeGreaterThanOrEqual(100));
  });

  it('falls back to 1 for a mis-set knob rather than producing an instant failure', () => {
    // A zero, negative, or unparseable scale would turn every poll into an
    // immediate timeout — which reads as a catastrophic host defect, the exact
    // misattribution this knob exists to prevent.
    for (const bad of ['0', '-2', 'abc', 'NaN', 'Infinity', '', '  ']) {
      withScale(bad, () => expect(scaledTimeoutMs(10_000)).toBe(10_000));
    }
  });

  it('reads the environment at CALL time, so a harness may set it after import', () => {
    withScale('2', () => expect(scaledTimeoutMs(1_000)).toBe(2_000));
    withScale('5', () => expect(scaledTimeoutMs(1_000)).toBe(5_000));
  });
});
