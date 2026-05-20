/**
 * Locks in the executor's terminal-failure event-sequence contract.
 *
 * Every failure path in `executeRun` MUST emit:
 *   1. (when a node is active) `node.failed`
 *   2. `run.failed`
 *   3. storage.updateRun({ status: 'failed', error, completedAt })
 *
 * Two paths were previously emitting only `run.failed` and skipping
 * `node.failed` (workflow_not_found / capability_not_provided). The
 * `emitTerminalFailure` helper in executor.ts normalizes them; this
 * test pins the ordering so future refactors don't regress.
 *
 * The canonical error code for unsatisfied node `requires` is
 * `capability_not_provided` per `spec/v1/capabilities.md §"Runtime
 * capabilities"`. `host_capability_missing` is a legacy alias still
 * in OpenwopErrorCode for back-compat with older `aiProviders`
 * dispatch surfaces; the executor emits the canonical name.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { openStorage } from '../src/storage/index.js';
import type { Storage } from '../src/storage/storage.js';
import { executeRun } from '../src/executor/executor.js';
import { setEventLogBackend } from '../src/executor/eventLog.js';
import { setSuspendBackend } from '../src/executor/suspendManager.js';
import { setRuntimeCapabilities } from '../src/executor/runtimeCapabilities.js';
import { getNodeRegistry } from '../src/executor/nodeRegistry.js';
import { configureSecretResolver } from '../src/byok/secretResolver.js';
import type { RunRecord } from '../src/types.js';
import type { WorkflowDefinition } from '../src/executor/types.js';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

let storage: Storage;

beforeEach(async () => {
  storage = await openStorage('memory://');
  setEventLogBackend(storage);
  setSuspendBackend(storage);
  setRuntimeCapabilities([]);
  // secretResolver is consulted by prepareRunSecrets before the node
  // loop runs; configure it against the same memory store so the
  // pre-loop secret-prep step is a no-op for these definitions
  // (no requiresSecrets declared).
  const dataDir = mkdtempSync(join(tmpdir(), 'openwop-test-'));
  configureSecretResolver({ storage, dataDir });
});

async function newRun(workflowId: string): Promise<RunRecord> {
  const now = new Date().toISOString();
  const run: RunRecord = {
    runId: `run-${Math.random().toString(36).slice(2, 10)}`,
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

describe('executor terminal-failure event sequence', () => {
  it('emits node.failed → run.failed when a node typeId is not registered', async () => {
    const run = await newRun('wf.test.missing-node');
    const definition: WorkflowDefinition = {
      workflowId: 'wf.test.missing-node',
      nodes: [{ nodeId: 'n1', typeId: 'no.such.node.type' }],
    };

    const result = await executeRun(storage, run, definition);

    expect(result.status).toBe('failed');

    const events = await storage.listEvents(run.runId);
    const sequence = events.map((e) => e.type);
    // run.started fires before the node loop; then the helper appends
    // node.failed + run.failed in that order.
    expect(sequence).toEqual(['run.started', 'node.failed', 'run.failed']);

    const nodeFailed = events.find((e) => e.type === 'node.failed')!;
    const runFailed = events.find((e) => e.type === 'run.failed')!;
    expect(nodeFailed.nodeId).toBe('n1');
    expect((nodeFailed.payload as { error: { code: string } }).error.code).toBe('workflow_not_found');
    expect((runFailed.payload as { error: { code: string } }).error.code).toBe('workflow_not_found');
    expect(nodeFailed.sequence).toBeLessThan(runFailed.sequence);

    const stored = (await storage.getRun(run.runId))!;
    expect(stored.status).toBe('failed');
    expect(stored.error?.code).toBe('workflow_not_found');
    expect(stored.completedAt).toBeDefined();
  });

  it('emits node.failed → run.failed when a node requires an unprovided capability', async () => {
    getNodeRegistry().register({
      typeId: 'test.capability-gated.node',
      version: '1.0.0',
      requires: ['some.unsupported.capability'],
      async execute() {
        throw new Error('unreachable: capability gate should refuse before execute');
      },
    });

    const run = await newRun('wf.test.cap-gated');
    const definition: WorkflowDefinition = {
      workflowId: 'wf.test.cap-gated',
      nodes: [{ nodeId: 'n1', typeId: 'test.capability-gated.node' }],
    };

    const result = await executeRun(storage, run, definition);

    expect(result.status).toBe('failed');

    const events = await storage.listEvents(run.runId);
    const sequence = events.map((e) => e.type);
    expect(sequence).toEqual(['run.started', 'node.failed', 'run.failed']);

    const nodeFailed = events.find((e) => e.type === 'node.failed')!;
    const runFailed = events.find((e) => e.type === 'run.failed')!;
    expect(nodeFailed.nodeId).toBe('n1');
    expect((nodeFailed.payload as { error: { code: string } }).error.code).toBe('capability_not_provided');
    expect((runFailed.payload as { error: { code: string } }).error.code).toBe('capability_not_provided');
    expect(nodeFailed.sequence).toBeLessThan(runFailed.sequence);

    const stored = (await storage.getRun(run.runId))!;
    expect(stored.status).toBe('failed');
    expect(stored.error?.code).toBe('capability_not_provided');
  });
});
