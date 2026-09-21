import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_WAIT_CAP_MS, MAX_RETRY_WAIT_CAP_MS, RETRY_WAIT_ENV, RETRY_WAIT_FLOOR_MS, retryWaitCapMs, retryWaitFor, windowClosedNote } from './webhook-retry-window.js';

describe('the webhook retry window is operator-RAISABLE and never lowerable', () => {
  it('defaults to 90 s when unset, empty, or not a number', () => {
    expect(retryWaitCapMs({})).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: 'five minutes' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
  });
  it('is raised by a larger value — the 15/30/60/120 s, five-attempt host needs > 225 s and gets it', () => {
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '300000' })).toBe(300_000);
  });
  // The property that keeps this from being a way to hide a slow retry.
  it('IGNORES a smaller value: no operator can shrink the window', () => {
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '1000' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '0' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '-5' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
  });
  it('is bounded above, so a typo cannot hold a certification cut open for a day', () => {
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '86400000' })).toBe(MAX_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: 'Infinity' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
  });
  it('a host that advertises no policy, or backoff none, is measured at the 20 s floor whatever the cap', () => {
    expect(retryWaitFor(null, 300_000)).toBe(RETRY_WAIT_FLOOR_MS);
    expect(retryWaitFor({ backoff: 'none' }, 300_000)).toBe(RETRY_WAIT_FLOOR_MS);
    expect(retryWaitFor({}, 300_000)).toBe(RETRY_WAIT_FLOOR_MS);
    expect(retryWaitFor({ backoff: 'exponential' }, 300_000)).toBe(300_000);
    expect(retryWaitFor({ backoff: 'fixed' }, DEFAULT_RETRY_WAIT_CAP_MS)).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
  });
  it('the blocked note names the variable, the numbers the run used, and whether it was already raised', () => {
    const d = windowClosedNote(4, 5, 90_000, DEFAULT_RETRY_WAIT_CAP_MS);
    expect(d).toContain('4 of the advertised 5'); expect(d).toContain(RETRY_WAIT_ENV); expect(d).toContain('never lowered');
    expect(windowClosedNote(4, 5, 120_000, 120_000)).toContain('already raised to 120000ms');
  });
});
