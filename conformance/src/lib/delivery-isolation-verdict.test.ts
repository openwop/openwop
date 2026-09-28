import { describe, expect, it } from 'vitest';
import { isolationDetail, isolationVerdict, type IsolationObservation } from './delivery-isolation-verdict.js';

const T = 100_000;
const base: IsolationObservation = {
  floor: 8, terminalAt: T, healthyAt: null, openAtHealthy: -1, arrivedAtTerminal: 0, openAtTerminal: 0,
  arrivedByVerdict: 0, peakOpen: 0, earliestClose: Infinity, windowMs: 20_000, delayMs: 2_000,
};
const obs = (o: Partial<IsolationObservation>): IsolationObservation => ({ ...base, ...o });

// The MyndHyve 00821-qec re-cut (myndhyve#560: a starved run.started fan-out).
const lateFanOut = obs({ healthyAt: T + 5_943, openAtHealthy: 7, arrivedAtTerminal: 2, openAtTerminal: 2, arrivedByVerdict: 7, peakOpen: 7 });

describe('RFC 0215 no-head-of-line: 2.44.2 changes the message, never the verdict', () => {
  it('8 held attempts open plus a healthy attempt passes', () => {
    expect(isolationVerdict(obs({ healthyAt: T + 50, openAtHealthy: 8, arrivedAtTerminal: 8, openAtTerminal: 8, arrivedByVerdict: 8, peakOpen: 8 })).kind).toBe('pass');
  });

  it('a host holding fewer than 8 fails, whatever the cause', () => {
    // A late fan-out (MyndHyve 00821-qec) and its first cut, with no held attempt at all.
    expect(isolationVerdict(lateFanOut).kind).toBe('fail');
    expect(isolationVerdict(obs({ healthyAt: T - 2_735, openAtHealthy: 0 })).kind).toBe('fail');
    // A bounded pool of 7, released by a 15 s timeout, or never.
    expect(isolationVerdict(obs({ healthyAt: T + 13_000, openAtHealthy: 6, arrivedAtTerminal: 7, openAtTerminal: 7, arrivedByVerdict: 7, peakOpen: 7, earliestClose: T + 12_990 })).kind).toBe('fail');
    expect(isolationVerdict(obs({ arrivedAtTerminal: 7, openAtTerminal: 7, arrivedByVerdict: 7, peakOpen: 7 })).kind).toBe('fail');
  });

  it('8 held open at the due time with the healthy attempt waiting fails', () => {
    expect(isolationVerdict(obs({ arrivedAtTerminal: 8, openAtTerminal: 8, arrivedByVerdict: 8, peakOpen: 8 })).kind).toBe('fail');
  });

  it('a serial dispatcher with a short timeout reaches the peak assertion, as before', () => {
    expect(isolationVerdict(obs({ healthyAt: T + 9_000, openAtHealthy: 1, arrivedAtTerminal: 2, openAtTerminal: 1, arrivedByVerdict: 8, peakOpen: 1, earliestClose: T - 1_000 })).kind).toBe('blocked-after-peak');
  });

  it('the detail names the time each count was sampled, and the failure names no cause', () => {
    const v = isolationVerdict(lateFanOut);
    expect(isolationDetail(lateFanOut)).toBe('at terminal, 2 held attempt(s) had arrived and 2 were open; by the verdict, 7 had arrived, at most 7 open at once; the healthy attempt arrived 5943ms after the run was seen terminal, with 7 held open; no held attempt was closed by the host');
    expect(v.kind === 'fail' && v.message).toBe("a host MUST sustain 8 subscriptions' attempts outstanding at once; only 2 were outstanding when the healthy delivery fell due, and 7 at most by the verdict");
    expect(`${v.kind === 'fail' ? v.message : ''} ${v.detail}`).not.toMatch(/bounded dispatcher/);
  });
});
