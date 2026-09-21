import { describe, expect, it } from 'vitest';
import { watchForResumption, type Observation, type WatchIo } from './durability-watch.js';

const obs = (runStarted: number, restored = 0, readable = true): Observation => ({ readable, runStarted, nodeStarted: runStarted, restored });
const resumedDuringExecution = (o: Observation): boolean => o.runStarted > 1 || o.restored >= 1;

/** A host whose state advances once per REQUEST, so the order of the two reads is what is under test. */
function host(states: ReadonlyArray<{ status: string; log: Observation }>): WatchIo & { reads: string[] } {
  let i = 0; let t = 0; const reads: string[] = [];
  const at = (): { status: string; log: Observation } => states[Math.min(i, states.length - 1)] as { status: string; log: Observation };
  return {
    reads,
    readStatus: async () => { reads.push('status'); const s = at().status; i++; return s; },
    readLog: async () => { reads.push('log'); const l = at().log; i++; return l; },
    now: () => t,
    sleep: async (ms) => { t += ms; },
  };
}

describe('watchForResumption — the two reads are not atomic, so their ORDER decides soundness', () => {
  it('reads the status FIRST and the log SECOND, every iteration', async () => {
    const io = host([{ status: 'running', log: obs(1) }, { status: 'running', log: obs(1) }, { status: 'running', log: obs(2) }, { status: 'completed', log: obs(2) }]);
    await watchForResumption(io, 10_000, resumedDuringExecution);
    expect(io.reads.slice(0, 4)).toEqual(['status', 'log', 'status', 'log']);
  });

  // THE RACE, reproduced: the host re-dispatches and completes between two
  // requests. Under the old order (log, then status) this is exactly the state
  // that latched a false "completed un-re-executed" on a conformant host.
  it('a recovery that lands between the two requests is NOT a completed-un-re-executed observation', async () => {
    // request 1 (status): still running, 1 run.started.  request 2 (log): recovered — 2 run.started.
    const io = host([{ status: 'running', log: obs(1) }, { status: 'completed', log: obs(2) }]);
    const w = await watchForResumption(io, 10_000, resumedDuringExecution);
    expect(w.completedUnresumed).toBe(false);
    expect(w.resumedAfterMs).not.toBeNull();
    expect(w.last.runStarted).toBe(2);
  });

  it('the old interleaving — log read BEFORE the recovery, status read AFTER it — can no longer be constructed into a false latch', async () => {
    // Whatever the host does between requests, the log is read after the status,
    // so a `completed` status is always judged against a log at least as new.
    const io = host([{ status: 'completed', log: obs(1) }, { status: 'completed', log: obs(2) }]);
    const w = await watchForResumption(io, 10_000, resumedDuringExecution);
    expect(w.completedUnresumed).toBe(false); // status read saw `completed`; the LATER log read saw the re-execution
  });

  it('the genuine defect still latches: completed, and a log read AFTER that status still shows no re-execution', async () => {
    const io = host([{ status: 'completed', log: obs(1) }, { status: 'completed', log: obs(1) }, { status: 'completed', log: obs(1) }]);
    const w = await watchForResumption(io, 1_000, resumedDuringExecution);
    expect(w.completedUnresumed).toBe(true);
    expect(w.resumedAfterMs).toBeNull();
  });

  it('the latch is sticky: a host that was observably completed-un-re-executed and re-executes LATER has still shown the defect', async () => {
    const io = host([{ status: 'completed', log: obs(1) }, { status: 'completed', log: obs(1) }, { status: 'completed', log: obs(2) }, { status: 'completed', log: obs(2) }]);
    const w = await watchForResumption(io, 10_000, resumedDuringExecution);
    expect(w.completedUnresumed).toBe(true);
    expect(w.resumedAfterMs).not.toBeNull();
  });

  it('an unreadable log concludes nothing — neither resumption nor the defect', async () => {
    const io = host([{ status: 'completed', log: obs(0, 0, false) }, { status: 'completed', log: obs(0, 0, false) }]);
    const w = await watchForResumption(io, 500, resumedDuringExecution);
    expect(w.completedUnresumed).toBe(false);
    expect(w.resumedAfterMs).toBeNull();
    expect(w.last.readable).toBe(false);
  });
});

describe('a transport failure mid-watch is unreadable, not a verdict (2.34.2)', () => {
  /** Dies for `down` requests after the first `upFor`, then answers again. */
  function dyingHost(upFor: number, down: number, after: { status: string; log: Observation }): WatchIo {
    let n = 0; let t = 0;
    const fail = (): boolean => { n++; return n > upFor && n <= upFor + down; };
    return {
      readStatus: async () => { if (fail()) throw new TypeError('fetch failed'); return n <= upFor ? 'running' : after.status; },
      readLog: async () => { if (fail()) throw new TypeError('fetch failed'); return n <= upFor ? obs(1) : after.log; },
      now: () => t,
      sleep: async (ms) => { t += ms; },
    };
  }
  it('a host that dies AFTER the seam answered, and comes back, is observed resuming — the throw no longer fails the row', async () => {
    const w = await watchForResumption(dyingHost(2, 6, { status: 'running', log: obs(2) }), 60_000, resumedDuringExecution);
    expect(w.resumedAfterMs).not.toBeNull();
    expect(w.transportErrors).toBeGreaterThan(0);
  });
  it('a host that never comes back still runs out the budget and resumes nothing', async () => {
    const io: WatchIo = { readStatus: async () => { throw new TypeError('fetch failed'); }, readLog: async () => { throw new TypeError('fetch failed'); }, now: (() => { let t = 0; return () => (t += 500); })(), sleep: async () => undefined };
    const w = await watchForResumption(io, 5_000, resumedDuringExecution);
    expect(w.resumedAfterMs).toBeNull();
    expect(w.last.readable).toBe(false);
  });
  it('an unreadable read concludes nothing about completed-un-re-executed', async () => {
    const w = await watchForResumption(dyingHost(0, 4, { status: 'completed', log: obs(2) }), 60_000, resumedDuringExecution);
    expect(w.completedUnresumed).toBe(false);
  });
});
