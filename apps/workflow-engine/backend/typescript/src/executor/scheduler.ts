/**
 * DAG scheduler. Replaces the linear `for (let i = 0; i < nodes.length; i++)`
 * walk with a topology-aware ready-queue + concurrency cap.
 *
 * Concurrency:
 *   - `OPENWOP_MAX_CONCURRENT_NODES` (default 8) caps in-flight nodes per run.
 *   - Ready queue drains in `(toposort index, nodeId)` order for replay
 *     determinism.
 *
 * Trigger rules — applied at the *target* node level. Each edge declares
 * a `triggerRule` (default `all_success`); all incoming edges to a single
 * target SHOULD agree, but if they diverge the scheduler picks the rule
 * from the first edge encountered (stable by edgeId).
 *
 *   all_success: every upstream completed && none failed (default)
 *   any_success: any upstream completed successfully
 *   all_complete: every upstream reached terminal (completed | failed | skipped)
 *   none_failed: every upstream reached terminal && none failed
 *   any_failed: any upstream failed (error-routing branches)
 *
 * Edge conditions: per-edge predicate evaluated against the source's
 * output. When false, that edge's contribution is omitted from the
 * target's input map (the target still fires per triggerRule, just
 * without input from this edge).
 *
 * Suspend semantics:
 *   - A node returning `suspended` keeps state 'suspended'; other ready
 *     branches continue to drain.
 *   - When no nodes are ready or running AND at least one is suspended,
 *     the run transitions to `waiting-*` (kind depends on the
 *     first-suspended node).
 *   - On resume, the resolved node flips to 'completed' with the resolve
 *     value mapped onto its `outputs.output` port; the scheduler re-runs
 *     to release any newly-ready downstream nodes.
 *
 * @see spec/v1/workflow-definition.schema.json $defs.WorkflowEdge
 * @see spec/v1/replay.md (cached outputs key on runId+nodeId+request-hash)
 */

import type {
  EdgeDef,
  WorkflowDefinition,
} from './types.js';

export type NodeState =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'suspended'
  | 'skipped';

export type TriggerRule =
  | 'all_success'
  | 'any_success'
  | 'all_complete'
  | 'none_failed'
  | 'any_failed';

export interface EdgeCondition {
  path: string;
  op: 'eq' | 'neq' | 'truthy' | 'falsy' | 'exists' | 'contains';
  value?: unknown;
}

export interface SchedulerSnapshot {
  /** Topological order, source-first. Stable across runs of the same DAG. */
  order: string[];
  /** nodeId → state. */
  nodeState: Map<string, NodeState>;
  /** nodeId → port → value. Empty for non-completed nodes. */
  nodeOutputs: Map<string, Record<string, unknown>>;
  /** nodeId → error (when state === 'failed'). */
  nodeErrors: Map<string, { code: string; message: string }>;
}

export interface SchedulerGraph {
  /** Adjacency: outgoing edges per source node id. */
  outgoing: Map<string, EdgeDef[]>;
  /** Adjacency: incoming edges per target node id. */
  incoming: Map<string, EdgeDef[]>;
  /** Source nodes (no incoming edges). */
  sources: string[];
}

/* ─── Graph construction ────────────────────────────────────── */

export function buildGraph(definition: WorkflowDefinition): SchedulerGraph {
  // First pass: build the raw forward graph including any back-edges.
  // We need this to run DFS over the candidate edge set.
  const rawOutgoing = new Map<string, EdgeDef[]>();
  for (const n of definition.nodes) rawOutgoing.set(n.nodeId, []);
  for (const e of definition.edges ?? []) rawOutgoing.get(e.sourceNodeId)?.push(e);

  // Detect back-edges via DFS coloring (WHITE→GRAY→BLACK). An edge to
  // a node currently on the recursion stack is a back-edge — same
  // definition used by Tarjan/Cormen. Back-edges are how supervisor-
  // dispatch loops express "re-invoke the supervisor after dispatch"
  // (RFC 0022 §A); the dispatch node drives the loop INTERNALLY, so
  // the scheduler treats the back-edge as inert and proceeds with the
  // forward DAG only. Cycles that DON'T include a `core.dispatch` /
  // `core.orchestrator.supervisor` typeId on either endpoint are still
  // rejected by `topologicalOrder` (the back-edge here gets dropped,
  // but unrelated cycles will trip Kahn's leftover-nodes check).
  // Key back-edges by `${src}\x00${tgt}` rather than edgeId: fixture
  // edges arrive as `{id, sourceNodeId, targetNodeId}` (per the JSON
  // schema), but EdgeDef declares `edgeId` — so `e.edgeId` is often
  // undefined here, and an edgeId-keyed Set would collapse all
  // undefined-keyed edges together. The (src, tgt) pair is unique per
  // edge in any well-formed workflow.
  const backEdges = findBackEdges(definition, rawOutgoing);

  const outgoing = new Map<string, EdgeDef[]>();
  const incoming = new Map<string, EdgeDef[]>();
  for (const n of definition.nodes) {
    outgoing.set(n.nodeId, []);
    incoming.set(n.nodeId, []);
  }
  for (const e of definition.edges ?? []) {
    if (backEdges.has(`${e.sourceNodeId}\x00${e.targetNodeId}`)) continue;
    outgoing.get(e.sourceNodeId)?.push(e);
    incoming.get(e.targetNodeId)?.push(e);
  }
  const sources = definition.nodes
    .map((n) => n.nodeId)
    .filter((id) => (incoming.get(id)?.length ?? 0) === 0);
  return { outgoing, incoming, sources };
}

/** TypeIds whose presence on either endpoint of a DFS back-edge marks
 *  the cycle as a legitimate RFC 0022 dispatch-supervisor loop — the
 *  dispatch step owns iteration internally, so the scheduler treats the
 *  back-edge as inert and proceeds with the forward DAG only. Any
 *  back-edge whose endpoints are NEITHER of these typeIds is left in
 *  place so Kahn's algorithm in `topologicalOrder()` trips with
 *  `cycle_detected`. */
const DISPATCH_LOOP_TYPEIDS = new Set<string>([
  'core.dispatch',
  'core.orchestrator.supervisor',
]);

function findBackEdges(
  definition: WorkflowDefinition,
  rawOutgoing: Map<string, EdgeDef[]>,
): Set<string> {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const typeIdByNode = new Map<string, string>();
  for (const n of definition.nodes) {
    color.set(n.nodeId, WHITE);
    typeIdByNode.set(n.nodeId, n.typeId);
  }
  const back = new Set<string>();
  // Iterative DFS (sample workflows are small but pathological depth
  // shouldn't blow the stack — workflow-definition.schema.json doesn't
  // cap node count).
  const visit = (start: string): void => {
    type Frame = { node: string; edges: EdgeDef[]; idx: number };
    const stack: Frame[] = [{ node: start, edges: rawOutgoing.get(start) ?? [], idx: 0 }];
    color.set(start, GRAY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.idx >= top.edges.length) {
        color.set(top.node, BLACK);
        stack.pop();
        continue;
      }
      const e = top.edges[top.idx++]!;
      const c = color.get(e.targetNodeId);
      if (c === GRAY) {
        // Only treat as inert when at least one endpoint is a known
        // dispatch-loop typeId. Otherwise leave the back-edge in the
        // graph so `topologicalOrder()` rejects the cycle.
        const srcTypeId = typeIdByNode.get(e.sourceNodeId);
        const tgtTypeId = typeIdByNode.get(e.targetNodeId);
        const isDispatchLoop =
          (srcTypeId !== undefined && DISPATCH_LOOP_TYPEIDS.has(srcTypeId)) ||
          (tgtTypeId !== undefined && DISPATCH_LOOP_TYPEIDS.has(tgtTypeId));
        if (isDispatchLoop) {
          back.add(`${e.sourceNodeId}\x00${e.targetNodeId}`);
        }
      } else if (c === WHITE) {
        color.set(e.targetNodeId, GRAY);
        stack.push({ node: e.targetNodeId, edges: rawOutgoing.get(e.targetNodeId) ?? [], idx: 0 });
      }
      // BLACK: cross-edge or forward-edge — leave alone.
    }
  };
  for (const n of definition.nodes) {
    if (color.get(n.nodeId) === WHITE) visit(n.nodeId);
  }
  return back;
}

/**
 * Kahn's algorithm. Returns a stable topological order. Throws
 * `cycle_detected` if the DAG isn't acyclic.
 */
export function topologicalOrder(
  definition: WorkflowDefinition,
  graph: SchedulerGraph,
): string[] {
  const indegree = new Map<string, number>();
  for (const n of definition.nodes) {
    indegree.set(n.nodeId, graph.incoming.get(n.nodeId)?.length ?? 0);
  }
  // Stable seeding by nodeId for replay determinism.
  const ready = [...graph.sources].sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const cur = ready.shift();
    if (!cur) break;
    order.push(cur);
    const out = graph.outgoing.get(cur) ?? [];
    const targets = [...new Set(out.map((e) => e.targetNodeId))].sort();
    for (const t of targets) {
      const d = (indegree.get(t) ?? 0) - 1;
      indegree.set(t, d);
      if (d === 0) ready.push(t);
    }
  }
  if (order.length !== definition.nodes.length) {
    const stuck = definition.nodes.find((n) => (indegree.get(n.nodeId) ?? 0) > 0);
    const err = new Error(
      `Workflow contains a cycle reaching node "${stuck?.nodeId ?? 'unknown'}"`,
    );
    (err as Error & { code?: string }).code = 'cycle_detected';
    throw err;
  }
  return order;
}

/* ─── Trigger-rule + condition evaluation ───────────────────── */

function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const segs = path.split('.');
  let cur: unknown = obj;
  for (const seg of segs) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function evaluateCondition(
  condition: EdgeCondition,
  sourceOutputs: Record<string, unknown> | undefined,
): boolean {
  const v = resolvePath(sourceOutputs ?? {}, condition.path);
  switch (condition.op) {
    case 'eq': return JSON.stringify(v) === JSON.stringify(condition.value);
    case 'neq': return JSON.stringify(v) !== JSON.stringify(condition.value);
    case 'truthy': return Boolean(v);
    case 'falsy': return !v;
    case 'exists': return v !== undefined && v !== null;
    case 'contains':
      if (typeof v === 'string') return v.includes(String(condition.value));
      if (Array.isArray(v)) return v.some((x) => JSON.stringify(x) === JSON.stringify(condition.value));
      return false;
    default: return false;
  }
}

const TERMINAL: ReadonlySet<NodeState> = new Set(['completed', 'failed', 'skipped']);

export function evaluateTrigger(
  nodeId: string,
  graph: SchedulerGraph,
  snapshot: SchedulerSnapshot,
): 'ready' | 'wait' | 'skip' {
  const ins = graph.incoming.get(nodeId) ?? [];
  // Source node: always ready (caller seeds these as ready up front).
  if (ins.length === 0) return 'ready';

  const upstreamStates = ins.map((e) => snapshot.nodeState.get(e.sourceNodeId) ?? 'pending');
  const allTerminal = upstreamStates.every((s) => TERMINAL.has(s));
  const anyTerminal = upstreamStates.some((s) => TERMINAL.has(s));
  const anyCompleted = upstreamStates.some((s) => s === 'completed');
  const anyFailed = upstreamStates.some((s) => s === 'failed');

  // Pick the triggerRule from the first edge (by edgeId) — incoming edges
  // to the same target SHOULD agree on the rule, but we don't enforce.
  const rule: TriggerRule =
    [...ins].sort((a, b) => a.edgeId.localeCompare(b.edgeId))[0]?.triggerRule ?? 'all_success';

  switch (rule) {
    case 'all_success':
      if (allTerminal && !anyFailed && anyCompleted) return 'ready';
      if (allTerminal && anyFailed) return 'skip';
      // All upstreams terminal but none completed (all skipped) — can never satisfy.
      if (allTerminal && !anyCompleted) return 'skip';
      return 'wait';
    case 'any_success':
      if (anyCompleted) return 'ready';
      if (allTerminal) return 'skip';
      return 'wait';
    case 'all_complete':
      if (allTerminal) return 'ready';
      return 'wait';
    case 'none_failed':
      if (allTerminal && !anyFailed) return 'ready';
      if (anyFailed) return 'skip';
      return 'wait';
    case 'any_failed':
      if (anyFailed) return 'ready';
      if (allTerminal && !anyFailed) return 'skip';
      // anyTerminal but no fail yet — keep waiting in case another upstream fails.
      void anyTerminal; // intentional read; behavior is the same either way.
      return 'wait';
  }
}

/* ─── Input wiring ──────────────────────────────────────────── */

/**
 * Build the input port-map for a target node from its upstream completed
 * sources. Edges with a `condition` that evaluates false contribute nothing.
 * Edges from non-completed sources (failed/skipped) also contribute nothing
 * — the target sees `undefined` on those input ports.
 *
 * Source nodes (no incoming edges) get `{ input: runInputs }`. The executor's
 * `runOneNode` then unwraps the single-`input` key back to the raw value so
 * legacy nodes that read `ctx.inputs.foo` against the run's input payload
 * continue to work — preserves bit-identical behavior with the pre-DAG
 * linear executor for source-position nodes. Downstream nodes (with edges)
 * always see a port-keyed map.
 */
export function buildNodeInputs(
  nodeId: string,
  graph: SchedulerGraph,
  snapshot: SchedulerSnapshot,
  runInputs: unknown,
): Record<string, unknown> {
  const ins = graph.incoming.get(nodeId) ?? [];
  if (ins.length === 0) {
    return { input: runInputs };
  }
  const out: Record<string, unknown> = {};
  for (const e of ins) {
    if (snapshot.nodeState.get(e.sourceNodeId) !== 'completed') continue;
    const sourceOutputs = snapshot.nodeOutputs.get(e.sourceNodeId);
    if (e.condition && !evaluateCondition(e.condition as EdgeCondition, sourceOutputs)) continue;
    const sourcePort = e.sourceOutput ?? 'output';
    const targetPort = e.targetInput ?? 'input';
    let value: unknown;
    if (sourceOutputs && Object.prototype.hasOwnProperty.call(sourceOutputs, sourcePort)) {
      value = sourceOutputs[sourcePort];
    } else if (sourceOutputs && Object.prototype.hasOwnProperty.call(sourceOutputs, 'output')) {
      // Many sample nodes (mock-ai, uppercase) return a single named output;
      // forward the whole outputs map when the explicit port isn't present.
      value = sourceOutputs;
    } else {
      value = sourceOutputs;
    }
    out[targetPort] = value;
  }
  return out;
}

/* ─── Snapshot factory ──────────────────────────────────────── */

export function freshSnapshot(definition: WorkflowDefinition): SchedulerSnapshot {
  const order = topologicalOrder(definition, buildGraph(definition));
  const state = new Map<string, NodeState>();
  for (const id of order) state.set(id, 'pending');
  // Sources start as ready.
  const graph = buildGraph(definition);
  for (const id of graph.sources) state.set(id, 'ready');
  return {
    order,
    nodeState: state,
    nodeOutputs: new Map(),
    nodeErrors: new Map(),
  };
}

/* ─── Terminal-state predicate ──────────────────────────────── */

export interface RunDisposition {
  /** True when no nodes can make further progress without external input. */
  done: boolean;
  /** Terminal status of the run when `done` is true. */
  status: 'completed' | 'failed' | 'waiting' | null;
  /** When `status === 'waiting'`, the first-suspended node id (for kind lookup). */
  suspendedNodeId?: string;
  /** When `status === 'failed'`, the node id that triggered the failure. */
  failedNodeId?: string;
}

export function inspectDisposition(
  snapshot: SchedulerSnapshot,
  graph: SchedulerGraph,
  runningCount: number,
): RunDisposition {
  if (runningCount > 0) return { done: false, status: null };
  const anyReady = [...snapshot.nodeState.values()].some((s) => s === 'ready');
  if (anyReady) return { done: false, status: null };

  const suspendedIds = [...snapshot.nodeState.entries()]
    .filter(([, s]) => s === 'suspended')
    .map(([id]) => id);
  if (suspendedIds.length > 0) {
    return { done: true, status: 'waiting', suspendedNodeId: suspendedIds[0]! };
  }

  // No ready/running/suspended — re-evaluate every pending node to either
  // mark them skipped (failed branch) or detect terminal completion.
  const stillPending = [...snapshot.nodeState.entries()].filter(
    ([, s]) => s === 'pending',
  );
  for (const [id] of stillPending) {
    const verdict = evaluateTrigger(id, graph, snapshot);
    if (verdict === 'skip') snapshot.nodeState.set(id, 'skipped');
  }

  const stillPendingNow = [...snapshot.nodeState.values()].some((s) => s === 'pending');
  if (stillPendingNow) {
    // Some pending nodes wait on suspended/non-terminal — shouldn't reach
    // here in well-formed runs, but guard against it.
    return { done: false, status: null };
  }

  // Run is 'completed' iff every terminal-by-graph node (no outgoing
  // edges) is in 'completed' or 'skipped' state. If any terminal-by-graph
  // node is 'failed', the run is 'failed'. This lets error-routing
  // branches (via `any_failed` etc.) recover a workflow that had upstream
  // failures — as long as the terminal node downstream of the recovery
  // path completes successfully, the run is treated as a success.
  const terminalNodes = [...snapshot.nodeState.keys()].filter(
    (id) => (graph.outgoing.get(id)?.length ?? 0) === 0,
  );
  const anyTerminalFailed = terminalNodes.some((id) => snapshot.nodeState.get(id) === 'failed');
  if (anyTerminalFailed) {
    const failedId = terminalNodes.find((id) => snapshot.nodeState.get(id) === 'failed')!;
    return { done: true, status: 'failed', failedNodeId: failedId };
  }
  // If no node ever completed (every terminal is skipped due to upstream
  // failures with no error-route), the run failed.
  const anyTerminalCompleted = terminalNodes.some((id) => snapshot.nodeState.get(id) === 'completed');
  if (!anyTerminalCompleted) {
    const failedId =
      [...snapshot.nodeState.entries()].find(([, s]) => s === 'failed')?.[0] ?? terminalNodes[0];
    return { done: true, status: 'failed', failedNodeId: failedId };
  }
  return { done: true, status: 'completed' };
}

/* ─── Concurrency knob ──────────────────────────────────────── */

/** Hard ceiling on per-run concurrent in-flight nodes. Sample's event loop
 *  thrashes well below this; production-grade hosts override via env var.
 *  Real-backend hosts (Postgres) MAY raise this since their durability
 *  layer absorbs the burst. */
const DEFAULT_MAX_CONCURRENT = 8;
const HARD_CEILING = 64;

export function maxConcurrentNodes(): number {
  const raw = process.env.OPENWOP_MAX_CONCURRENT_NODES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_CONCURRENT;
  return Math.min(Math.trunc(n), HARD_CEILING);
}

/* ─── State helpers (mutations the executor invokes) ────────── */

export function markCompleted(
  nodeId: string,
  outputs: Record<string, unknown>,
  snapshot: SchedulerSnapshot,
): void {
  snapshot.nodeState.set(nodeId, 'completed');
  snapshot.nodeOutputs.set(nodeId, outputs);
}

export function markFailed(
  nodeId: string,
  error: { code: string; message: string },
  snapshot: SchedulerSnapshot,
): void {
  snapshot.nodeState.set(nodeId, 'failed');
  snapshot.nodeErrors.set(nodeId, error);
}

export function markSuspended(
  nodeId: string,
  snapshot: SchedulerSnapshot,
): void {
  snapshot.nodeState.set(nodeId, 'suspended');
}

/**
 * Release any downstream nodes that have become ready given the current
 * snapshot. Idempotent; safe to call after every state mutation.
 */
export function releaseDownstream(
  changedNodeId: string,
  graph: SchedulerGraph,
  snapshot: SchedulerSnapshot,
): void {
  const downstream = graph.outgoing.get(changedNodeId) ?? [];
  const visited = new Set<string>();
  const queue = [...new Set(downstream.map((e) => e.targetNodeId))];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const cur = snapshot.nodeState.get(id);
    if (cur !== 'pending') continue;
    const verdict = evaluateTrigger(id, graph, snapshot);
    if (verdict === 'ready') snapshot.nodeState.set(id, 'ready');
    else if (verdict === 'skip') {
      snapshot.nodeState.set(id, 'skipped');
      // Skipped propagates — re-evaluate downstream.
      const out = graph.outgoing.get(id) ?? [];
      for (const e of out) if (!visited.has(e.targetNodeId)) queue.push(e.targetNodeId);
    }
  }
}

/** Pop up to `n` ready nodes off the snapshot in topological order. */
export function popReady(
  n: number,
  snapshot: SchedulerSnapshot,
): string[] {
  const out: string[] = [];
  for (const id of snapshot.order) {
    if (out.length >= n) break;
    if (snapshot.nodeState.get(id) === 'ready') out.push(id);
  }
  for (const id of out) snapshot.nodeState.set(id, 'running');
  return out;
}
