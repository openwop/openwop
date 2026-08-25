/**
 * "The fork seam did not run" — one rule, one place (RFC 0148 §A).
 *
 * `POST /v1/runs/{runId}:fork` can decline in more than one way, and eleven
 * call sites across six scenarios each decided for themselves which ways
 * counted:
 *
 *   - **501** — every site handled this. "Advertised but not implemented for
 *     this range", per the suite convention their comments cite.
 *   - **404 / 403** — *no* site in the replay family handled it. A host that
 *     never mounts the route hard-failed `expect(status).toBe(201)`.
 *
 * That asymmetry is backwards. `501` means "I know this route and decline";
 * `404` means "there is no such route" — strictly less implemented, and the
 * suite treated the weaker signal as a skip and the stronger one as a defect.
 * The postgres reference host 404s, so `replay-fanout-suppression` was red in
 * CI on every run while the other four replay scenarios skipped past the same
 * seam for unrelated fixture reasons. **The suite required a host to implement
 * the route in order to say it had not implemented the route.**
 *
 * Recording matters as much as the predicate. Two of those eleven sites were a
 * bare `return` with no note: `replay-fork.test.ts` reported "6 tests | 6
 * skipped" against a host whose fork surface is entirely unmeasured, and the
 * ledger had nothing to say about why. §A resolves an unclassified return to
 * `blocked`, but only when the file records nothing at all — a bare return in a
 * file whose *other* tests assert is invisible.
 *
 * Disposition is `blocked`, not `inapplicable`: the obligation applies to this
 * host, it simply could not be witnessed. `inapplicable` would claim the host
 * is outside the requirement's scope, which nothing here establishes — these
 * scenarios carry no capability gate, so the suite does not actually know
 * whether the host advertises fork. Saying `blocked` is the claim the evidence
 * supports.
 */

import { softSkip } from './soft-skip.js';

/** Statuses that mean "the fork did not happen", with what each one tells us. */
const DECLINED: ReadonlyMap<number, string> = new Map([
  [404, 'the route is not mounted on this host'],
  [403, 'the caller is not permitted to fork (route present, access refused)'],
  [501, 'the host knows the route and declines this range as not implemented'],
]);

/**
 * True when `status` means the fork seam did not run — and records WHY for the
 * RFC 0148 §A ledger as a side effect, so a caller can `if (forkDeclined(...))
 * return;` without leaving an unclassified return behind.
 *
 * `where` names the leg, so a bundle reader can tell which of several forks in
 * one file declined.
 */
export function forkDeclined(status: number, where: string): boolean {
  const why = DECLINED.get(status);
  if (why === undefined) return false;
  softSkip(
    'blocked',
    `${where}: POST /v1/runs/{runId}:fork returned ${status} — ${why}, so the behaviour this requirement is stated over never occurred and its absence below would prove nothing`,
  );
  return true;
}
