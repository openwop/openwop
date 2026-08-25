/**
 * Pins `forkDeclined` (RFC 0148 §A).
 *
 * The risk in a helper like this is not that it misses a status — that shows up
 * as a red test somebody investigates. It is that it swallows one: every status
 * it accepts turns an assertion into a skip, silently, and a suite that skips
 * is indistinguishable from a suite that passes unless something records why.
 * So the load-bearing cases here are the NEGATIVE ones.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { forkDeclined } from './fork-availability.js';
import { resetSoftSkips, softSkipDisposition } from './soft-skip.js';

describe('forkDeclined', () => {
  beforeEach(() => resetSoftSkips());

  it('treats 404 and 403 the same as 501 — route absent is not weaker than route-declines', () => {
    // The asymmetry this fixes: every replay scenario handled 501 and none
    // handled 404. `501` means "I know this route and decline"; `404` means
    // "there is no such route" — strictly less implemented. The suite treated
    // the weaker signal as a skip and the stronger one as a defect, so a host
    // had to implement the route in order to say it had not implemented it.
    for (const status of [404, 403, 501]) {
      expect(forkDeclined(status, 'leg'), `status ${status} means the fork did not happen`).toBe(true);
    }
  });

  it('does NOT swallow any other status — a 500 is still a defect, not a skip', () => {
    // If this ever goes green for one of these, a real failure has become a
    // silent skip and no assertion downstream will ever run again.
    for (const status of [200, 201, 202, 400, 409, 422, 500, 502, 503]) {
      expect(forkDeclined(status, 'leg'), `status ${status} must reach the assertion`).toBe(false);
    }
  });

  it('records WHY, so the ledger row is not an unclassified return', () => {
    // Two of the eleven original call sites were a bare `return`. A bare return
    // in a file whose OTHER tests assert is invisible: the file records
    // `executed-pass` and the leg that never ran leaves no trace.
    forkDeclined(404, 'fanout-suppression replay fork');
    const noted = softSkipDisposition('fork-availability.test.ts');
    expect(noted?.kind).toBe('blocked');
    expect(noted?.reason).toContain('404');
    expect(noted?.reason).toContain('fanout-suppression replay fork');
    expect(noted?.reason).toContain('not mounted');
  });

  it('records nothing when the status is not a decline', () => {
    forkDeclined(201, 'leg');
    expect(softSkipDisposition('fork-availability.test.ts')).toBeNull();
  });

  it('names the leg, so one file with several forks stays attributable', () => {
    forkDeclined(501, 'branch fork');
    expect(softSkipDisposition('fork-availability.test.ts')?.reason).toContain('branch fork');
  });

  it('distinguishes the three declines in its reason text', () => {
    forkDeclined(404, 'a');
    const a = softSkipDisposition('fork-availability.test.ts')?.reason ?? '';
    resetSoftSkips();
    forkDeclined(501, 'a');
    const b = softSkipDisposition('fork-availability.test.ts')?.reason ?? '';
    // `blocked` alone does not tell a bundle reader whether the host lacks the
    // route or declines the range; the reason must.
    expect(a).not.toBe(b);
  });
});
