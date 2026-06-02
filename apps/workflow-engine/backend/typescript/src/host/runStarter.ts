/**
 * Shared run-starter for host-extension trigger surfaces (sample-grade).
 *
 * The scheduler "Run now" + the agent heartbeat "Check now" both need to start
 * a workflow run the same way `POST /v1/runs` does — resolve the workflow via
 * the catalog, insert a pending run, dispatch it — but with a small attribution
 * block stamped onto the run's metadata so the run-detail UI can show where the
 * run came from (a schedule, a heartbeat pick-up, …). This centralizes that
 * recipe so replay/fork/observability are inherited unchanged.
 *
 * The Kanban card→run path does NOT use this — it routes through the RFC 0083
 * durable trigger bridge (dedup/retry/dead-letter) in routes/kanban.ts, a
 * stronger guarantee that the simple schedule/heartbeat triggers don't need.
 *
 * @see src/routes/runs.ts — the POST /v1/runs recipe this mirrors
 */

import { randomUUID } from 'node:crypto';
import type { RunRecord } from '../types.js';
import type { HostAdapterSuite } from './index.js';
import type { Storage } from '../storage/storage.js';
import { executeRun } from '../executor/executor.js';
import { recordRunAttribution } from './agentRunActivityIndex.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('host.runStarter');

export interface StartRunDeps {
  storage: Storage;
  /** Only the two members startWorkflowRun actually uses, narrowed from the
   *  full 15-slot HostAdapterSuite (interface segregation). A full HostAdapterSuite
   *  is structurally assignable, so production callers pass it unchanged; tests
   *  can supply a minimal, fully-typed stub without casting the whole suite. */
  hostSuite: Pick<HostAdapterSuite, 'workflowCatalog' | 'providerPolicyResolver'>;
}

/** Resolve `workflowId`, insert a pending run, and dispatch it. Returns the new
 *  runId, or null when the workflow id does not resolve (the caller treats a
 *  null as "nothing fired" rather than an error — mirrors the Kanban posture). */
export async function startWorkflowRun(
  deps: StartRunDeps,
  input: {
    tenantId: string;
    workflowId: string;
    /** Attribution block stamped onto `run.metadata` (e.g. `{ schedule: {...} }`). */
    metadata?: Record<string, unknown>;
    inputs?: Record<string, unknown> | null;
  },
): Promise<string | null> {
  const { storage, hostSuite } = deps;
  const wf = await hostSuite.workflowCatalog.getWorkflow(input.workflowId);
  if (!wf) {
    log.warn('run_starter_workflow_not_found', { workflowId: input.workflowId });
    return null;
  }
  const runId = randomUUID();
  const now = new Date().toISOString();
  const run: RunRecord = {
    runId,
    workflowId: input.workflowId,
    tenantId: input.tenantId,
    status: 'pending',
    inputs: input.inputs ?? null,
    metadata: input.metadata ?? {},
    configurable: {},
    createdAt: now,
    updatedAt: now,
  };
  await storage.insertRun(run);
  // Index the agent attribution (if any) so fleet/per-agent activity queries
  // hit an index instead of scanning recent runs. Best-effort — never blocks.
  await recordRunAttribution(storage, run);
  setImmediate(() => {
    executeRun(storage, run, wf.definition, { policyResolver: hostSuite.providerPolicyResolver }).catch((err) => {
      log.error('run_starter_dispatch_failed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
  return runId;
}
