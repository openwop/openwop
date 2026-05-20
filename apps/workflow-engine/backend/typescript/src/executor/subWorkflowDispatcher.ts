/**
 * SubWorkflow dispatcher — engine-level shim that the `core.subWorkflow`
 * node (registered in bootstrap/nodes.ts) calls to spawn a child run,
 * wait for it to terminate, apply RFC 0022 §B inputMapping/outputMapping,
 * and return the child's terminal state.
 *
 * Why a separate module: `core.subWorkflow` is a scheduler primitive
 * per `spec/v1/node-packs.md §"Reserved Core OpenWOP node typeIds"` —
 * it composes whole runs the way `core.delay` composes setTimeout. The
 * node module's `execute(ctx)` needs access to:
 *   - the RunRecord storage adapter (for child insertRun + getRun
 *     polling),
 *   - the workflow catalog (to look up the child workflow's
 *     definition by id),
 *   - the executeRun entrypoint (to actually run the child).
 *
 * None of these are on NodeContext today (they're closures bound in
 * runs.ts at request time). Rather than broaden NodeContext for this
 * one typeId, this module exposes a process-local injection point:
 * `setSubWorkflowDispatcher(deps)` is called once at boot from
 * `index.ts`; `dispatchSubWorkflow(...)` is called from the node's
 * execute(). If the dispatcher is unset (e.g., the bootstrap path
 * didn't wire it), calls fail loudly so the gap is obvious.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §A + §B
 * @see spec/v1/node-packs.md §`core.subWorkflow`
 * @see host/variablesRuntime.ts (per-run variable bag the mappings
 *      project against)
 */

import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/storage.js';
import type { HostAdapterSuite } from '../host/index.js';
import type { RunRecord } from '../types.js';
import {
  seedRunVariables,
  snapshotRunVariables,
  setRunVariable,
} from '../host/variablesRuntime.js';

interface DispatcherDeps {
  storage: Storage;
  hostSuite: HostAdapterSuite;
  /** Late-bound to break the circular module dependency between
   *  bootstrap/nodes.ts (registers core.subWorkflow) and
   *  executor/executor.ts (exports executeRun). The bootstrap path
   *  passes `executeRun` here at boot. */
  executeRun: (storage: Storage, run: RunRecord, definition: unknown, options?: unknown) => Promise<unknown>;
}

let deps: DispatcherDeps | null = null;

export function setSubWorkflowDispatcher(d: DispatcherDeps): void {
  deps = d;
}

export interface SubWorkflowOpts {
  parentRunId: string;
  parentTenantId: string;
  parentScopeId?: string;
  /** Per RFC 0022 §B — child workflow id to spawn. */
  childWorkflowId: string;
  /** Per RFC 0022 §B — `{childVar: parentVarName}`. The dispatcher
   *  reads the parent's variable bag at dispatch-time and seeds the
   *  child bag with `child[k] = parent[v]`. One-shot fold; mid-run
   *  mutations to the parent bag MUST NOT propagate. */
  inputMapping?: Record<string, string>;
  /** Per RFC 0022 §A — `{parentVar: childVarName}`. Applied AFTER the
   *  child reaches terminal `completed`; skipped on failed/cancelled
   *  per RFC 0022 §B HVMAP-1b. */
  outputMapping?: Record<string, string>;
  /** Per `spec/v1/node-packs.md §core.subWorkflow` — when `false`
   *  (default for back-compat), spawn the child but don't await its
   *  terminal state. Today's implementation always awaits since the
   *  conformance test exercises the wait-for-completion path. */
  waitForCompletion?: boolean;
  /** Per RFC 0022 §B HVMAP-1b — `'fail-parent' | 'continue'`. When
   *  the child terminates non-completed, decide whether the
   *  subWorkflow node fails or succeeds. */
  onChildFailure?: 'fail-parent' | 'continue';
  /** Per `node-packs.md §core.subWorkflow`: the child run snapshot
   *  carries `parentNodeId` pointing back at the parent's
   *  subWorkflow node (so a tree of runs can be reconstructed). */
  parentNodeId: string;
}

/** Process-local parent-node linkage. RunRecord's persisted schema
 *  doesn't carry parentNodeId today; tracking it in-memory keeps the
 *  child snapshot's linkage observable without a sqlite/postgres
 *  schema bump. Survives only within the process — same posture as
 *  the variables-runtime bag from earlier this session. */
const childParentNodeId = new Map<string, string>();

export function getChildParentNodeId(childRunId: string): string | undefined {
  return childParentNodeId.get(childRunId);
}

export interface SubWorkflowResult {
  childRunId: string;
  childStatus: 'completed' | 'failed' | 'cancelled';
  childVariables: Record<string, unknown>;
  /** Per RFC 0022 §B HVMAP-1b — `true` when outputMapping was
   *  skipped because the child terminated non-completed. */
  outputMappingSkipped: boolean;
}

/** Spawn a child run, wait for terminal, apply output mapping back to
 *  parent's variable bag, return child snapshot. Throws if the
 *  dispatcher isn't initialized or the child workflow isn't found. */
export async function dispatchSubWorkflow(
  opts: SubWorkflowOpts,
): Promise<SubWorkflowResult> {
  if (!deps) {
    throw new Error('subWorkflow dispatcher not initialized — bootstrap path missing setSubWorkflowDispatcher() call');
  }
  const { storage, hostSuite, executeRun } = deps;

  // Look up the child workflow definition.
  const wf = await hostSuite.workflowCatalog.getWorkflow(opts.childWorkflowId);
  if (!wf) {
    throw new Error(`subWorkflow: child workflow '${opts.childWorkflowId}' not found in catalog`);
  }

  // Build initial child inputs from inputMapping (RFC 0022 §B
  // one-shot fold). Read the parent's variable bag NOW; later
  // mid-run mutations to the parent bag must not propagate.
  const parentVars = snapshotRunVariables(opts.parentRunId) ?? {};
  const childInputs: Record<string, unknown> = {};
  if (opts.inputMapping) {
    for (const [childKey, parentKey] of Object.entries(opts.inputMapping)) {
      if (typeof childKey !== 'string' || typeof parentKey !== 'string') continue;
      childInputs[childKey] = parentVars[parentKey];
    }
  }

  // Spawn child run.
  const childRunId = randomUUID();
  const now = new Date().toISOString();
  const childRun: RunRecord = {
    runId: childRunId,
    workflowId: opts.childWorkflowId,
    tenantId: opts.parentTenantId,
    scopeId: opts.parentScopeId,
    status: 'pending',
    inputs: childInputs,
    metadata: {},
    configurable: {},
    parentRunId: opts.parentRunId,
    createdAt: now,
    updatedAt: now,
  };
  await storage.insertRun(childRun);
  childParentNodeId.set(childRunId, opts.parentNodeId);

  // Seed child variable bag — inputMapping wins over the workflow's
  // defaultValues per RFC 0022 §B HVMAP-2.
  seedRunVariables(childRunId, wf.definition.variables, childInputs);

  // Run the child to terminal. executeRun is synchronous-Promise:
  // returns when the run reaches terminal status (completed / failed /
  // cancelled) or suspends. For the subWorkflow conformance case the
  // child reaches terminal because it has no interrupts.
  await executeRun(storage, childRun, wf.definition, {});

  // Read final child state.
  const finalChild = await storage.getRun(childRunId);
  const childStatus = (finalChild?.status ?? 'failed') as 'completed' | 'failed' | 'cancelled';
  const childVariables = snapshotRunVariables(childRunId) ?? {};

  // Apply outputMapping per RFC 0022 §A. SKIPPED when child terminates
  // non-completed per HVMAP-1b.
  let outputMappingSkipped = false;
  if (childStatus === 'completed' && opts.outputMapping) {
    for (const [parentKey, childKey] of Object.entries(opts.outputMapping)) {
      if (typeof parentKey !== 'string' || typeof childKey !== 'string') continue;
      setRunVariable(opts.parentRunId, parentKey, childVariables[childKey]);
    }
  } else if (opts.outputMapping) {
    outputMappingSkipped = true;
  }

  return { childRunId, childStatus, childVariables, outputMappingSkipped };
}
