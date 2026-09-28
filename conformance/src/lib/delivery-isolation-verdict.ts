/**
 * The verdict of RFC 0215's `no-head-of-line` leg, as a pure function of what
 * the leg observed (suite 2.44.2), so the rule and its message can be tested
 * without a host.
 *
 * 2.44.2 changes the MESSAGE, not the verdict. The detail read "2 held
 * attempt(s) arrived (at most 7 open at once)": the 2 was sampled when the run
 * was seen terminal, the 7 at the verdict, and the failure named "a bounded
 * dispatcher" whatever the cause. On MyndHyve `00821-qec` the cause was a
 * starved `run.started` fan-out (myndhyve#560), and the mixed sampling hid it.
 * The detail now names the time of each count, and the failure states only
 * what was observed. The row still fails whenever fewer than the floor were
 * outstanding at once when the healthy delivery fell due.
 */

export interface IsolationObservation {
  /** §A.2's floor. */
  readonly floor: number;
  /** When the leg saw the run terminal (the healthy delivery is due by then). */
  readonly terminalAt: number;
  /** When the healthy attempt arrived, or null if it did not within the window. */
  readonly healthyAt: number | null;
  /** Held attempts open when the healthy attempt arrived (-1 if it did not). */
  readonly openAtHealthy: number;
  /** Held attempts that had arrived by `terminalAt`. */
  readonly arrivedAtTerminal: number;
  /** Held attempts still open at `terminalAt`. */
  readonly openAtTerminal: number;
  /** Held attempts that had arrived by the verdict. */
  readonly arrivedByVerdict: number;
  /** The most held attempts open at once, up to the verdict. */
  readonly peakOpen: number;
  /** When the first held attempt closed (the host abandoning it), or Infinity. */
  readonly earliestClose: number;
  readonly windowMs: number;
  readonly delayMs: number;
}

export type IsolationVerdict =
  /** The healthy attempt started while `floor` held attempts were open. */
  | { readonly kind: 'pass'; readonly detail: string }
  | { readonly kind: 'fail'; readonly message: string; readonly detail: string }
  /** Unjudged, after asserting `peakOpen >= floor` (which fails a pool below the floor). */
  | { readonly kind: 'blocked-after-peak'; readonly message: string; readonly detail: string };

/** What the leg saw, each count against the time it was sampled. */
export function isolationDetail(o: IsolationObservation): string {
  const at = (t: number): string => `${t - o.terminalAt}ms after the run was seen terminal`;
  const healthy = o.healthyAt === null
    ? `the healthy attempt did not arrive within ${o.windowMs}ms of that`
    : `the healthy attempt arrived ${at(o.healthyAt)}, with ${o.openAtHealthy} held open`;
  const closed = Number.isFinite(o.earliestClose) ? `the first held attempt was closed by the host ${at(o.earliestClose)}` : 'no held attempt was closed by the host';
  return `at terminal, ${o.arrivedAtTerminal} held attempt(s) had arrived and ${o.openAtTerminal} were open; by the verdict, ${o.arrivedByVerdict} had arrived, at most ${o.peakOpen} open at once; ${healthy}; ${closed}`;
}

export function isolationVerdict(o: IsolationObservation): IsolationVerdict {
  const detail = isolationDetail(o);
  const F = o.floor;
  if (o.healthyAt !== null && o.openAtHealthy >= F) return { kind: 'pass', detail };
  if (o.openAtTerminal >= F) {
    // The healthy attempt waited (or never came), and the contention §A.2
    // names was present when it fell due.
    return { kind: 'fail', message: `with ${F} subscriptions' attempts unanswered, a further subscription's attempt MUST still start; it waited for the host to release one`, detail };
  }
  if (o.arrivedAtTerminal >= F || o.earliestClose < o.terminalAt) {
    // Contention was not sustained to the due time. Either the host's own
    // delivery timeout released the held attempts early (its choice), or it
    // never opened F of them at once. peakOpen separates the two: below F the
    // host never had F attempts outstanding at once, which is the defect.
    const released = Number.isFinite(o.earliestClose) ? `${o.terminalAt - o.earliestClose}ms ` : '';
    return { kind: 'blocked-after-peak', message: `unjudged: ${F} held attempts were open at once, but the host closed held attempts ${released}before the run was terminal (its delivery timeout is shorter than this leg's ${o.delayMs}ms delay), so ${F} attempts were not outstanding when the healthy delivery fell due`, detail };
  }
  // Fewer than F held attempts were outstanding when the healthy delivery
  // fell due. The message states that and no cause: a bounded pool, a serial
  // dispatcher and a late fan-out all land here, and the detail's sampling
  // times are what tell them apart.
  return { kind: 'fail', message: `a host MUST sustain ${F} subscriptions' attempts outstanding at once; only ${o.openAtTerminal} were outstanding when the healthy delivery fell due, and ${o.peakOpen} at most by the verdict`, detail };
}
