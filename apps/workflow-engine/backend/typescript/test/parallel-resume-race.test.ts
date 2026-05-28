/**
 * Regression test for the parallel-resume race in
 * `routes/interrupts.ts::resolveAndResume`.
 *
 * Bug (pre-fix): when a single run has N parallel-suspended interrupts
 * (a fan-out workflow where N approval nodes all suspend on the same
 * run) and the user resolves all N in quick succession, only some of
 * them complete. The route layer read `run.schedulerSnapshot` at API
 * time and scheduled `executeRun` via setImmediate; the N executors
 * then raced — each hydrated from the same stale snapshot, marked
 * only its own node `completed`, drained, and persisted. Each persist
 * overwrote the previous one, leaving only the *last* writer's view
 * in the stored snapshot.
 *
 * Symptom in the event log: N × `node.interrupt.resolved`, but only
 * 1-2 × `run.resumed` + `node.completed`. The run stays "Running"
 * forever from the user's perspective.
 *
 * Fix: per-run resume serialization chain (`runResumeChains`) that
 * makes each resume read the freshest snapshot and run its executor
 * to completion before the next resume starts. This test drives 4
 * parallel resolves through the `__resolveAndResumeForTests` seam and
 * asserts every approval emits `node.completed` and the run reaches
 * `completed`.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { executeRun } from '../src/executor/executor.js';
import { getNodeRegistry } from '../src/executor/nodeRegistry.js';
import { openStorage } from '../src/storage/index.js';
import { setEventLogBackend } from '../src/executor/eventLog.js';
import { setSuspendBackend } from '../src/executor/suspendManager.js';
import { initInMemorySurfaces } from '../src/host/inMemorySurfaces.js';
import { createHostAdapterSuite } from '../src/host/index.js';
import { registerWorkflow as registerHostWorkflow } from '../src/host/workflowsRegistry.js';
import {
  __resolveAndResumeForTests,
  __awaitRunResumeChainForTests,
} from '../src/routes/interrupts.js';
import type { WorkflowDefinition } from '../src/executor/types.js';
import type { RunRecord } from '../src/types.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const storage = await openStorage('memory://');
setEventLogBackend(storage);
setSuspendBackend(storage);
initInMemorySurfaces({ dataDir: mkdtempSync(join(tmpdir(), 'openwop-resume-')) });

const hostSuite = createHostAdapterSuite({ storage });

beforeAll(() => {
  const registry = getNodeRegistry();
  // A node that suspends on first execution and completes on resume.
  // The `resumed_<nodeId>` typeId distinguishes the 4 parallel
  // approvals so the scheduler treats them as independent.
  registry.register({
    typeId: 'test.parallel-approval',
    version: '1.0.0',
    async execute() {
      return {
        status: 'suspended',
        interrupt: { kind: 'approval', data: { actions: ['approve'] } },
      };
    },
  });
  registry.register({
    typeId: 'test.sink',
    version: '1.0.0',
    async execute(ctx) {
      // Echo whichever upstream value the converge node received.
      return { status: 'success', outputs: { output: ctx.inputs ?? null } };
    },
  });
});

async function newRun(workflowId: string): Promise<RunRecord> {
  const now = new Date().toISOString();
  const run: RunRecord = {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    workflowId,
    tenantId: 'demo',
    status: 'pending',
    inputs: {},
    metadata: {},
    configurable: {},
    createdAt: now,
    updatedAt: now,
  };
  await storage.insertRun(run);
  return run;
}

describe('parallel resume — race regression', () => {
  it('resolving 4 parallel-suspended approvals concurrently completes every branch', async () => {
    // Fan-out: a single source feeds 4 parallel approval nodes; all 4
    // converge at a `sink` with default trigger (all_success). Pre-fix
    // this workflow would lose 2-3 of the 4 approvals when their
    // resolves arrived concurrently.
    const workflowId = 'wf.parallel-approvals';
    const def: WorkflowDefinition = {
      workflowId,
      nodes: [
        { nodeId: 'a1', typeId: 'test.parallel-approval' },
        { nodeId: 'a2', typeId: 'test.parallel-approval' },
        { nodeId: 'a3', typeId: 'test.parallel-approval' },
        { nodeId: 'a4', typeId: 'test.parallel-approval' },
        { nodeId: 'sink', typeId: 'test.sink' },
      ],
      edges: [
        { edgeId: 'e1', sourceNodeId: 'a1', targetNodeId: 'sink', triggerRule: 'all_success' },
        { edgeId: 'e2', sourceNodeId: 'a2', targetNodeId: 'sink', triggerRule: 'all_success' },
        { edgeId: 'e3', sourceNodeId: 'a3', targetNodeId: 'sink', triggerRule: 'all_success' },
        { edgeId: 'e4', sourceNodeId: 'a4', targetNodeId: 'sink', triggerRule: 'all_success' },
      ],
    };
    // Register so `hostSuite.workflowCatalog.getWorkflow(workflowId)`
    // resolves inside `resolveAndResume` — the catalog reads
    // `getRegisteredWorkflow` for non-sample workflowIds.
    registerHostWorkflow(def);

    const run = await newRun(workflowId);

    // Initial drain — every approval suspends.
    const initial = await executeRun(storage, run, def);
    expect(initial.status).toBe('waiting-approval');
    expect(new Set(initial.pausedNodeIds)).toEqual(new Set(['a1', 'a2', 'a3', 'a4']));

    // Confirm the suspend manager has 4 open interrupts on this run.
    const open = await storage.listOpenInterrupts(run.runId);
    expect(open.length).toBe(4);
    const interruptIds = open.map((i) => i.interruptId);

    // The actual race reproducer: fire all 4 resolves in parallel.
    // Pre-fix, 2-3 of these would silently no-op (only
    // node.interrupt.resolved, no run.resumed / node.completed).
    await Promise.all(
      interruptIds.map((id) =>
        __resolveAndResumeForTests(storage, hostSuite, id, { action: 'approve' }),
      ),
    );
    // Block until the chained executors have all settled — the
    // function above returns *after* enqueueing each resume on the
    // per-run chain, not after the executor finishes.
    await __awaitRunResumeChainForTests(run.runId);

    // Verify: every approval node and the sink emitted node.completed,
    // and the run reached terminal completed.
    const events = await storage.listEvents(run.runId);
    const completedIds = events
      .filter((e) => e.type === 'node.completed')
      .map((e) => e.nodeId);
    expect(new Set(completedIds)).toEqual(new Set(['a1', 'a2', 'a3', 'a4', 'sink']));
    expect(events.some((e) => e.type === 'run.completed')).toBe(true);

    // And the per-interrupt resolve event fired for each.
    const resolved = events.filter((e) => e.type === 'node.interrupt.resolved').map((e) => e.nodeId);
    expect(new Set(resolved)).toEqual(new Set(['a1', 'a2', 'a3', 'a4']));

    // Run record reflects terminal status.
    const finalRun = await storage.getRun(run.runId);
    expect(finalRun?.status).toBe('completed');
  });

  it('serialization preserves single-resume behaviour for sequential resolves', async () => {
    // Sanity guard: the chain MUST also work when resolves happen
    // strictly sequentially — no extra waits, no extra events. This
    // is the common case (one approval per fan-out branch with the
    // user clicking each in turn) and would regress if the chain
    // accidentally double-dispatched or held a stale entry.
    const workflowId = 'wf.parallel-approvals-sequential';
    const def: WorkflowDefinition = {
      workflowId,
      nodes: [
        { nodeId: 'a1', typeId: 'test.parallel-approval' },
        { nodeId: 'a2', typeId: 'test.parallel-approval' },
        { nodeId: 'sink', typeId: 'test.sink' },
      ],
      edges: [
        { edgeId: 'e1', sourceNodeId: 'a1', targetNodeId: 'sink', triggerRule: 'all_success' },
        { edgeId: 'e2', sourceNodeId: 'a2', targetNodeId: 'sink', triggerRule: 'all_success' },
      ],
    };
    registerHostWorkflow(def);
    const run = await newRun(workflowId);

    await executeRun(storage, run, def);
    const open = await storage.listOpenInterrupts(run.runId);
    expect(open.length).toBe(2);

    // Sequential resolves — await each before issuing the next.
    for (const it of open) {
      await __resolveAndResumeForTests(storage, hostSuite, it.interruptId, { action: 'approve' });
      await __awaitRunResumeChainForTests(run.runId);
    }

    const events = await storage.listEvents(run.runId);
    const completedIds = events
      .filter((e) => e.type === 'node.completed')
      .map((e) => e.nodeId);
    expect(new Set(completedIds)).toEqual(new Set(['a1', 'a2', 'sink']));
    expect(events.some((e) => e.type === 'run.completed')).toBe(true);
  });
});
