/**
 * Multi-instance run-dispatch crash recovery. Exercises the storage claim
 * semantics (the correctness crux) against the in-memory sqlite backend, plus
 * one sweeper re-dispatch pass with a stub host suite.
 *
 *   - claimOrphanedRuns claims ONLY genuinely-orphaned runs: pending/running,
 *     past the createdAt grace window, with an absent/expired lease.
 *   - It excludes fresh runs (grace), live-leased runs, terminal runs, and
 *     parked (waiting-*) runs.
 *   - setRunDispatchLease parks a run out of the sweep until the lease expires.
 *   - sweepOrphanedRuns re-claims the orphan under the sweeper's worker id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStorage } from '../src/storage/index.js';
import type { Storage } from '../src/storage/storage.js';
import type { RunRecord } from '../src/types.js';
import type { HostAdapterSuite } from '../src/host/index.js';
import { sweepOrphanedRuns } from '../src/host/runDispatchSweeper.js';
import { setEventLogBackend } from '../src/executor/eventLog.js';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const oldIso = new Date(NOW - HOUR).toISOString(); // well past the grace window
const freshIso = new Date(NOW).toISOString();

function makeRun(over: Partial<RunRecord> & { runId: string }): RunRecord {
  return {
    workflowId: 'wf-1',
    tenantId: 't1',
    status: 'pending',
    inputs: null,
    metadata: {},
    configurable: {},
    createdAt: oldIso,
    updatedAt: oldIso,
    ...over,
  };
}

describe('run-dispatch crash recovery', () => {
  let storage: Storage;
  beforeEach(async () => {
    storage = await openStorage('memory://');
  });
  afterEach(() => vi.restoreAllMocks());

  it('claims only genuinely-orphaned runs', async () => {
    await storage.insertRun(makeRun({ runId: 'old-pending', status: 'pending' }));
    await storage.insertRun(makeRun({ runId: 'old-running', status: 'running' }));
    await storage.insertRun(makeRun({ runId: 'fresh', status: 'pending', createdAt: freshIso }));
    await storage.insertRun(makeRun({ runId: 'done', status: 'completed' }));
    await storage.insertRun(makeRun({ runId: 'parked', status: 'waiting-input' }));

    const claimed = await storage.claimOrphanedRuns('sweeper-a', NOW, new Date(NOW - 60_000).toISOString(), 720_000, 10);
    expect(claimed.map((r) => r.runId).sort()).toEqual(['old-pending', 'old-running']);
    // Claimed rows carry the new owner + a fresh lease.
    for (const r of claimed) {
      expect(r.dispatchOwner).toBe('sweeper-a');
      expect(r.dispatchLeaseExpiresAt).toBe(NOW + 720_000);
    }
  });

  it('excludes a run holding a live lease, then re-claims it once the lease expires', async () => {
    await storage.insertRun(makeRun({ runId: 'leased', status: 'running' }));
    // A live lease 10 min in the future → not orphaned.
    await storage.setRunDispatchLease('leased', 'instance-x', NOW + 600_000);
    expect(await storage.claimOrphanedRuns('sweeper-a', NOW, new Date(NOW - 60_000).toISOString(), 720_000, 10)).toEqual([]);

    // After the lease expires, it's re-claimable.
    const after = await storage.claimOrphanedRuns('sweeper-a', NOW + 600_001, new Date(NOW).toISOString(), 720_000, 10);
    expect(after.map((r) => r.runId)).toEqual(['leased']);
    expect(after[0]!.dispatchOwner).toBe('sweeper-a');
  });

  it('does not claim the same run twice within one lease window', async () => {
    await storage.insertRun(makeRun({ runId: 'once', status: 'running' }));
    const first = await storage.claimOrphanedRuns('sweeper-a', NOW, new Date(NOW - 60_000).toISOString(), 720_000, 10);
    expect(first.map((r) => r.runId)).toEqual(['once']);
    // Immediately re-claiming finds nothing (the row now holds a fresh lease).
    expect(await storage.claimOrphanedRuns('sweeper-b', NOW + 1, new Date(NOW).toISOString(), 720_000, 10)).toEqual([]);
  });

  it('sweepOrphanedRuns re-claims and reports orphaned runs', async () => {
    await storage.insertRun(makeRun({ runId: 'orphan', status: 'running' }));
    const hostSuite = {
      workflowCatalog: { getWorkflow: async () => ({ definition: { workflowId: 'wf-1', nodes: [] } }) },
      providerPolicyResolver: undefined,
    } as unknown as HostAdapterSuite;

    const redispatched = await sweepOrphanedRuns({ storage, hostSuite }, 'sweeper-a', NOW);
    expect(redispatched).toBe(1);
    // The orphan now belongs to the sweeper (claimed before re-dispatch).
    const run = await storage.getRun('orphan');
    expect(run?.dispatchOwner).toBe('sweeper-a');
  });

  it('abandons (fails) a chronically-orphaned run instead of re-dispatching it forever', async () => {
    setEventLogBackend(storage); // emitTerminalFailure appends run.failed
    // Created > 1h ago and still running → past the re-dispatch ceiling.
    await storage.insertRun(makeRun({ runId: 'stuck', status: 'running', createdAt: new Date(NOW - 2 * HOUR).toISOString() }));
    const hostSuite = {
      workflowCatalog: { getWorkflow: async () => ({ definition: { workflowId: 'wf-1', nodes: [] } }) },
      providerPolicyResolver: undefined,
    } as unknown as HostAdapterSuite;

    const redispatched = await sweepOrphanedRuns({ storage, hostSuite }, 'sweeper-a', NOW);
    expect(redispatched).toBe(0); // abandoned, not re-dispatched
    const run = await storage.getRun('stuck');
    expect(run?.status).toBe('failed');
    expect(run?.error?.code).toBe('dispatch_abandoned');
  });
});
