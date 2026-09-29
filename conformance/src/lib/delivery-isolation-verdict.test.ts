import { describe, expect, it } from 'vitest';
import { isolationDetail, isolationVerdict, type IsolationObservation } from './delivery-isolation-verdict.js';

const T = 100_000;
const base: IsolationObservation = {
  floor: 8, terminalAt: T, healthyAt: null, openAtHealthy: -1, arrivedAtTerminal: 0, openAtTerminal: 0,
  arrivedByVerdict: 0, peakOpen: 0, earliestClose: Infinity, windowMs: 20_000, delayMs: 2_000,
};
const obs = (o: Partial<IsolationObservation>): IsolationObservation => ({ ...base, ...o });

describe('RFC 0215 no-head-of-line verdict (suite 2.44.2)', () => {
  it('passes when the healthy attempt starts with 8 held attempts open', () => {
    expect(isolationVerdict(obs({ healthyAt: T + 50, openAtHealthy: 8, arrivedAtTerminal: 8, openAtTerminal: 8, arrivedByVerdict: 8, peakOpen: 8 })).kind).toBe('pass');
  });

  it('fails when 8 held attempts were open at the due time and the healthy attempt waited or never came', () => {
    expect(isolationVerdict(obs({ arrivedAtTerminal: 8, openAtTerminal: 8, arrivedByVerdict: 8, peakOpen: 8 })).kind).toBe('fail');
    expect(isolationVerdict(obs({ healthyAt: T + 15_000, openAtHealthy: 7, arrivedAtTerminal: 8, openAtTerminal: 8, arrivedByVerdict: 8, peakOpen: 8, earliestClose: T + 14_990 })).kind).toBe('fail');
  });

  it('a bounded pool of 7 with a 15 s timeout still fails: its healthy attempt starts only after a held attempt closes', () => {
    const v = isolationVerdict(obs({ healthyAt: T + 13_000, openAtHealthy: 6, arrivedAtTerminal: 7, openAtTerminal: 7, arrivedByVerdict: 7, peakOpen: 7, earliestClose: T + 12_990 }));
    expect(v.kind).toBe('fail');
    if (v.kind === 'fail') expect(v.message).toContain('only after a held attempt finished');
  });

  it('a bounded pool whose healthy attempt never starts while held attempts stay open still fails', () => {
    expect(isolationVerdict(obs({ arrivedAtTerminal: 7, openAtTerminal: 7, arrivedByVerdict: 7, peakOpen: 7 })).kind).toBe('fail');
  });

  it('a serial dispatcher with a short timeout lands on the peak assertion, which it fails', () => {
    expect(isolationVerdict(obs({ healthyAt: T + 9_000, openAtHealthy: 1, arrivedAtTerminal: 2, openAtTerminal: 1, arrivedByVerdict: 8, peakOpen: 1, earliestClose: T - 1_000 })).kind).toBe('blocked-after-peak');
  });

  // MyndHyve 00821-qec, 2.44.x. The old rule failed both as "a bounded
  // dispatcher below the floor": fewer than 8 held attempts at terminal, no
  // held close before the peak test, so it fell through to the last branch.
  it('MyndHyve re-cut: held fan-out late (2 at terminal, 7 later), healthy started with 7 open and none closed, so unjudged, not failed', () => {
    const v = isolationVerdict(obs({ healthyAt: T + 5_943, openAtHealthy: 7, arrivedAtTerminal: 2, openAtTerminal: 2, arrivedByVerdict: 7, peakOpen: 7 }));
    expect(v.kind).toBe('blocked');
  });
  it('MyndHyve first cut: no held attempt at all, healthy delivered before terminal was seen, so unjudged, not failed', () => {
    expect(isolationVerdict(obs({ healthyAt: T - 2_735, openAtHealthy: 0, arrivedAtTerminal: 0, openAtTerminal: 0, arrivedByVerdict: 0, peakOpen: 0 })).kind).toBe('blocked');
  });

  it('the detail names the time each count was sampled', () => {
    const d = isolationDetail(obs({ healthyAt: T + 5_943, openAtHealthy: 7, arrivedAtTerminal: 2, openAtTerminal: 2, arrivedByVerdict: 7, peakOpen: 7 }));
    expect(d).toBe('at terminal, 2 held attempt(s) had arrived and 2 were open; by the verdict, 7 had arrived, at most 7 open at once; the healthy attempt arrived 5943ms after the run was seen terminal, with 7 held open; no held attempt was closed by the host');
    expect(d).not.toMatch(/bounded dispatcher/);
  });
});
