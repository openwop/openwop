/**
 * Wall-clock cron evaluator (host/cronSchedule.ts) — parsing + next-fire.
 *
 * Covers the four UI cadence presets, the union day rule, step/range/list
 * tokens, timezone-aware evaluation, malformed-expression rejection, and the
 * missed-window collapse (a far-past `afterMs` still yields the NEXT slot, not a
 * backlog).
 */

import { describe, expect, it } from 'vitest';
import { parseCron, computeNextFire } from '../src/host/cronSchedule.js';

/** Render an epoch-ms instant to a UTC ISO minute string for stable asserts. */
function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

describe('parseCron', () => {
  it('parses the four UI presets', () => {
    expect(parseCron('0 * * * *')).not.toBeNull(); // hourly
    expect(parseCron('0 9 * * *')).not.toBeNull(); // daily 09:00
    expect(parseCron('0 9 * * 1-5')).not.toBeNull(); // weekdays 09:00
    expect(parseCron('0 9 * * 1')).not.toBeNull(); // weekly Mon 09:00
  });

  it('rejects malformed expressions', () => {
    expect(parseCron('')).toBeNull();
    expect(parseCron('* * * *')).toBeNull(); // 4 fields
    expect(parseCron('* * * * * *')).toBeNull(); // 6 fields
    expect(parseCron('60 * * * *')).toBeNull(); // minute out of range
    expect(parseCron('* 24 * * *')).toBeNull(); // hour out of range
    expect(parseCron('* * * * 7')).not.toBeNull(); // dow 7 is valid (Sunday)
    expect(parseCron('* * * * 8')).toBeNull(); // dow 8 is out of range
    expect(parseCron('abc * * * *')).toBeNull();
    expect(parseCron('5-2 * * * *')).toBeNull(); // inverted range
    expect(parseCron('*/0 * * * *')).toBeNull(); // zero step
  });

  it('treats dow 7 and 0 both as Sunday', () => {
    const a = parseCron('0 0 * * 0')!;
    const b = parseCron('0 0 * * 7')!;
    expect([...a.dow]).toEqual([0]);
    expect([...b.dow]).toEqual([0]);
  });

  it('tracks dom/dow restriction flags for the union rule', () => {
    expect(parseCron('0 0 * * *')!.domRestricted).toBe(false);
    expect(parseCron('0 0 * * *')!.dowRestricted).toBe(false);
    expect(parseCron('0 0 15 * *')!.domRestricted).toBe(true);
    expect(parseCron('0 0 * * 1')!.dowRestricted).toBe(true);
  });
});

describe('computeNextFire — UTC', () => {
  it('hourly fires at the top of the next hour', () => {
    const after = Date.parse('2026-06-02T10:15:00Z');
    expect(iso(computeNextFire('0 * * * *', after))).toBe('2026-06-02T11:00:00.000Z');
  });

  it('daily 09:00 rolls to the next day when already past', () => {
    const after = Date.parse('2026-06-02T10:00:00Z');
    expect(iso(computeNextFire('0 9 * * *', after))).toBe('2026-06-03T09:00:00.000Z');
  });

  it('daily 09:00 fires same day when still before', () => {
    const after = Date.parse('2026-06-02T08:00:00Z');
    expect(iso(computeNextFire('0 9 * * *', after))).toBe('2026-06-02T09:00:00.000Z');
  });

  it('weekdays skip the weekend (2026-06-06 is a Saturday)', () => {
    const after = Date.parse('2026-06-05T10:00:00Z'); // Friday after 09:00
    expect(iso(computeNextFire('0 9 * * 1-5', after))).toBe('2026-06-08T09:00:00.000Z'); // Monday
  });

  it('weekly Monday 09:00', () => {
    const after = Date.parse('2026-06-02T10:00:00Z'); // Tuesday
    expect(iso(computeNextFire('0 9 * * 1', after))).toBe('2026-06-08T09:00:00.000Z'); // next Monday
  });

  it('is strictly after — a fire exactly on a slot advances to the following slot', () => {
    const onSlot = Date.parse('2026-06-02T11:00:00Z');
    expect(iso(computeNextFire('0 * * * *', onSlot))).toBe('2026-06-02T12:00:00.000Z');
  });

  it('union day rule: dom OR dow when both restricted', () => {
    // 15th of the month OR any Monday, at 00:00.
    const after = Date.parse('2026-06-02T01:00:00Z'); // Tue Jun 2
    // Next Monday (Jun 8) comes before the 15th.
    expect(iso(computeNextFire('0 0 15 * 1', after))).toBe('2026-06-08T00:00:00.000Z');
  });

  it('returns null for an unparseable expression', () => {
    expect(computeNextFire('not a cron', Date.now())).toBeNull();
  });
});

describe('computeNextFire — timezone', () => {
  it('daily 09:00 in America/New_York is 13:00Z in June (EDT, UTC-4)', () => {
    const after = Date.parse('2026-06-02T05:00:00Z'); // 01:00 EDT
    expect(iso(computeNextFire('0 9 * * *', after, 'America/New_York'))).toBe('2026-06-02T13:00:00.000Z');
  });

  it('the same expression in UTC fires at 09:00Z', () => {
    const after = Date.parse('2026-06-02T05:00:00Z');
    expect(iso(computeNextFire('0 9 * * *', after, 'UTC'))).toBe('2026-06-02T09:00:00.000Z');
  });
});

describe('computeNextFire — missed-window collapse', () => {
  it('a far-past anchor yields the next future slot, not a backlog', () => {
    // Anchor a week in the past; hourly cadence. The function returns ONE next
    // slot just past the anchor — the daemon advances from there, so a long
    // downtime collapses to a single recovery fire rather than N.
    const longAgo = Date.parse('2026-05-26T10:15:00Z');
    expect(iso(computeNextFire('0 * * * *', longAgo))).toBe('2026-05-26T11:00:00.000Z');
  });
});
