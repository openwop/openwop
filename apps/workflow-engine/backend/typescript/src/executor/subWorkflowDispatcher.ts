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
  /** Includes non-terminal `waiting-*` / `paused` so callers can map a
   *  child suspension to a parent-side suspension per the
   *  `openwop-interrupt-parent-child` profile (interrupt-profiles.md).
   *  Callers MUST handle non-terminal child status: typically by
   *  returning `NodeOutcome.suspended` from the parent's subWorkflow
   *  node so the cascade contract holds (parent cancel → child cancel,
   *  child resolve → parent resume). */
  childStatus: string;
  childVariables: Record<string, unknown>;
  /** Per RFC 0022 §B HVMAP-1b — `true` when outputMapping was
   *  skipped because the child terminated non-completed. */
  outputMappingSkipped: boolean;
  /** When the child is in a `waiting-*` state (not terminal), this
   *  carries the open child-side interrupt the parent's subWorkflow
   *  node SHOULD echo into its own NodeOutcome.suspended payload. */
  childInterruptKind?: 'approval' | 'clarification' | 'refinement' | 'cancellation' | 'external-event';
  childInterruptNodeId?: string;
  /** RFC 0037 §"Handoff state machine" — set when `executeRun` threw
   *  AFTER the child run was created (child ran at least one node before
   *  failing). The dispatch already succeeded; the child died at runtime.
   *  Carriers MAY surface this on `core.workflowChain.event { phase: "child.failed" }`
   *  per the spec's `running → failed` transition. Distinct from a
   *  pre-creation failure, which throws `DispatchCreationError` instead. */
  childRuntimeError?: { code: string; message: string };
}

/** RFC 0037 §"Handoff state machine" — distinct error class for the
 *  `dispatching → failed` transition (creation failed BEFORE the child
 *  ran any node). Thrown by `dispatchSubWorkflow` when the dispatcher
 *  rejects pre-creation: ancestor cycle, depth-cap exceeded, unknown
 *  child workflow, storage.insertRun failure, etc.
 *
 *  Throws from `executeRun` (child ran briefly then died) are NOT
 *  surfaced as DispatchCreationError — they're caught inside
 *  dispatchSubWorkflow and converted to a normal return with
 *  `childStatus: 'failed' + childRuntimeError`. Callers can then emit
 *  the correct `core.workflowChain.event { phase: "child.failed" }`
 *  per RFC 0037's `running → failed` row instead of misattributing the
 *  failure to `dispatching → failed`. */
export class DispatchCreationError extends Error {
  readonly code: string;
  constructor(message: string, code = 'dispatch_creation_failed') {
    super(message);
    this.name = 'DispatchCreationError';
    this.code = code;
  }
}

/** Maximum sub-workflow nesting depth. A workflow A whose subWorkflow
 *  targets B which subWorkflows back to A (or self → self) would
 *  recurse infinitely without a bound; each spawn is a separate run
 *  so the per-run `recursionLimit` cap doesn't catch the
 *  cross-workflow case. 32 is generous for legitimate fan-out
 *  patterns and tight enough to stop a hand-crafted DoS fixture
 *  before it exhausts memory/CPU. Override via env if a real
 *  deployment needs deeper nesting. */
const MAX_SUBWORKFLOW_DEPTH = Number(process.env.OPENWOP_MAX_SUBWORKFLOW_DEPTH) || 32;

/** Spawn a child run, wait for terminal, apply output mapping back to
 *  parent's variable bag, return child snapshot. Throws if the
 *  dispatcher isn't initialized, the child workflow isn't found, the
 *  ancestor chain exceeds MAX_SUBWORKFLOW_DEPTH, or the same
 *  workflowId appears more than once in the ancestor chain (cycle). */
export async function dispatchSubWorkflow(
  opts: SubWorkflowOpts,
): Promise<SubWorkflowResult> {
  if (!deps) {
    throw new DispatchCreationError(
      'subWorkflow dispatcher not initialized — bootstrap path missing setSubWorkflowDispatcher() call',
      'dispatcher_not_initialized',
    );
  }
  const { storage, hostSuite, executeRun } = deps;

  // Walk the parent chain to enforce depth + cycle invariants
  // BEFORE allocating the child run. Reading parent → ancestor →
  // root via storage; bounded by MAX_SUBWORKFLOW_DEPTH so even a
  // hand-crafted chain can't pathologically slow this check.
  const ancestorWorkflowIds: string[] = [];
  let cursorRunId: string | undefined = opts.parentRunId;
  while (cursorRunId && ancestorWorkflowIds.length < MAX_SUBWORKFLOW_DEPTH) {
    const ancestor = await storage.getRun(cursorRunId);
    if (!ancestor) break;
    ancestorWorkflowIds.push(ancestor.workflowId);
    cursorRunId = ancestor.parentRunId;
  }
  if (ancestorWorkflowIds.length >= MAX_SUBWORKFLOW_DEPTH) {
    throw new DispatchCreationError(
      `subWorkflow: ancestor chain depth ${ancestorWorkflowIds.length} exceeds MAX_SUBWORKFLOW_DEPTH=${MAX_SUBWORKFLOW_DEPTH}`,
      'subworkflow_depth_exceeded',
    );
  }
  if (ancestorWorkflowIds.includes(opts.childWorkflowId)) {
    throw new DispatchCreationError(
      `subWorkflow: cycle detected — child workflow '${opts.childWorkflowId}' already in ancestor chain (${ancestorWorkflowIds.join(' → ')})`,
      'subworkflow_cycle_detected',
    );
  }

  // Look up the child workflow definition.
  const wf = await hostSuite.workflowCatalog.getWorkflow(opts.childWorkflowId);
  if (!wf) {
    throw new DispatchCreationError(
      `subWorkflow: child workflow '${opts.childWorkflowId}' not found in catalog`,
      'subworkflow_child_not_found',
    );
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
  try {
    await storage.insertRun(childRun);
  } catch (err) {
    // Storage failure during insertRun is a pre-creation failure per
    // RFC 0037 §"Handoff state machine" (child run was never persisted),
    // surfaced as a DispatchCreationError.
    throw new DispatchCreationError(
      `subWorkflow: child run insertion failed for workflow '${opts.childWorkflowId}': ${err instanceof Error ? err.message : String(err)}`,
      'subworkflow_insert_failed',
    );
  }
  childParentNodeId.set(childRunId, opts.parentNodeId);

  // Seed child variable bag — inputMapping wins over the workflow's
  // defaultValues per RFC 0022 §B HVMAP-2.
  seedRunVariables(childRunId, wf.definition.variables, childInputs);

  // Run the child to terminal. executeRun is synchronous-Promise:
  // returns when the run reaches terminal status (completed / failed /
  // cancelled) or suspends. For the subWorkflow conformance case the
  // child reaches terminal because it has no interrupts.
  //
  // RFC 0037 §"Handoff state machine" — executeRun throwing means the
  // child STARTED but died mid-execution (the child run record exists in
  // storage at this point; the dispatch already "succeeded"). Catch and
  // convert the throw to a `childStatus: 'failed'` return with
  // `childRuntimeError` populated, so callers emit the correct
  // `running → failed` transition (`child.failed` phase) instead of
  // misattributing to the `dispatching → failed` transition.
  let childRuntimeError: { code: string; message: string } | undefined;
  try {
    await executeRun(storage, childRun, wf.definition, {});
  } catch (err) {
    childRuntimeError = {
      code: 'child_runtime_error',
      message: err instanceof Error ? err.message : String(err),
    };
    // Persist the child as failed so finalChild.status below reflects it
    // (in case executeRun didn't update the RunRecord before throwing).
    try {
      await storage.updateRun(childRunId, { status: 'failed', updatedAt: new Date().toISOString() });
    } catch {
      // Update failure here doesn't change the dispatch contract — the
      // caller will read the latest snapshot via storage.getRun below.
    }
  }

  // Read final child state.
  const finalChild = await storage.getRun(childRunId);
  const childStatus = finalChild?.status ?? 'failed';
  const childVariables = snapshotRunVariables(childRunId) ?? {};

  // Non-terminal child status (waiting-approval / waiting-external /
  // paused / waiting-input) means the child suspended on an interrupt.
  // Per `interrupt-profiles.md §openwop-interrupt-parent-child` the
  // parent's subWorkflow node MUST suspend too so cancel/resume
  // cascades. Surface the open child-side interrupt so the node module
  // can echo it into NodeOutcome.suspended.
  const TERMINAL: readonly string[] = ['completed', 'failed', 'cancelled'];
  if (!TERMINAL.includes(childStatus)) {
    const open = await storage.listOpenInterrupts(childRunId);
    const first = open[0];
    return {
      childRunId,
      childStatus,
      childVariables,
      outputMappingSkipped: false,
      ...(first ? { childInterruptKind: first.kind as SubWorkflowResult['childInterruptKind'] } : {}),
      ...(first ? { childInterruptNodeId: first.nodeId } : {}),
    };
  }

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

  return {
    childRunId,
    childStatus,
    childVariables,
    outputMappingSkipped,
    ...(childRuntimeError ? { childRuntimeError } : {}),
  };
}
