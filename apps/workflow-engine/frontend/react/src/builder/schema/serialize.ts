/**
 * Builder graph → backend WorkflowDefinition.
 *
 * The backend executor is a DAG scheduler (see
 * `backend/.../executor/scheduler.ts`). Branching, fan-in, conditional
 * routing, and parallel paths are all supported. The serializer
 * emits the canonical `{ workflowId, nodes, edges }` shape with a
 * stable topological ordering for replay-friendly diffs.
 *
 * Rejected at serialize time:
 *   - empty graphs
 *   - cycles (Kahn's algorithm — finds the first reachable cycle node)
 *   - nodes unreachable from any source node
 */

import { catalogEntry } from '../palette/catalogRegistry.js';
import type {
  BuilderEdge,
  BuilderNode,
  EdgeCondition,
  EdgeTriggerRule,
  SavedWorkflow,
} from './workflow.js';

export interface BackendNode {
  nodeId: string;
  typeId: string;
  config?: Record<string, unknown>;
}

export interface BackendEdge {
  edgeId: string;
  sourceNodeId: string;
  sourceOutput?: string;
  targetNodeId: string;
  targetInput?: string;
  /** Default `all_success` per spec. Emitted only when not the default. */
  triggerRule?: EdgeTriggerRule;
  condition?: EdgeCondition;
  label?: string;
}

export interface BackendWorkflowDefinition {
  workflowId: string;
  nodes: BackendNode[];
  /** Emitted whenever the graph has at least one edge. Linear (one-source,
   *  one-sink, single-chain) workflows still emit edges so the backend
   *  scheduler can route consistently. */
  edges: BackendEdge[];
}

export class SerializeError extends Error {
  constructor(message: string, readonly nodeId?: string) {
    super(message);
    this.name = 'SerializeError';
  }
}

/**
 * Kahn's algorithm. Returns a topological ordering (one of possibly
 * many). When a cycle exists, returns `{ cycleNodeId }` naming a node
 * still inside the residual cycle.
 */
function topoSort(
  nodes: ReadonlyArray<BuilderNode>,
  edges: ReadonlyArray<BuilderEdge>,
): { order: BuilderNode[] } | { cycleNodeId: string } {
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, BuilderEdge[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    outgoing.get(e.source)?.push(e);
  }
  // Stable seed: sort starting nodes by Y then X so layout reflects ordering.
  const ready: BuilderNode[] = nodes
    .filter((n) => (indegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const order: BuilderNode[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  while (ready.length > 0) {
    const current = ready.shift();
    if (!current) break;
    order.push(current);
    const out = outgoing.get(current.id) ?? [];
    // Deterministic neighbor ordering by target node position.
    const neighbors = [...new Set(out.map((e) => e.target))]
      .map((id) => byId.get(id))
      .filter((n): n is BuilderNode => Boolean(n))
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    for (const n of neighbors) {
      const d = (indegree.get(n.id) ?? 0) - 1;
      indegree.set(n.id, d);
      if (d === 0) ready.push(n);
    }
  }
  if (order.length !== nodes.length) {
    // Any node still with indegree > 0 is on or downstream of a cycle.
    const stuck = nodes.find((n) => (indegree.get(n.id) ?? 0) > 0);
    return { cycleNodeId: stuck?.id ?? nodes[0]?.id ?? '' };
  }
  return { order };
}

export function serializeWorkflow(wf: SavedWorkflow): BackendWorkflowDefinition {
  if (wf.nodes.length === 0) {
    throw new SerializeError('Workflow has no nodes.');
  }

  // Verify every edge references known nodes before topo-sorting.
  const nodeIds = new Set(wf.nodes.map((n) => n.id));
  for (const e of wf.edges) {
    if (!nodeIds.has(e.source)) {
      throw new SerializeError(`Edge "${e.id}" references unknown source node.`, e.source);
    }
    if (!nodeIds.has(e.target)) {
      throw new SerializeError(`Edge "${e.id}" references unknown target node.`, e.target);
    }
  }

  // Topological sort + cycle detection.
  const sortResult = topoSort(wf.nodes, wf.edges);
  if ('cycleNodeId' in sortResult) {
    throw new SerializeError(
      `Workflow contains a cycle reaching node "${sortResult.cycleNodeId}".`,
      sortResult.cycleNodeId,
    );
  }
  const ordered = sortResult.order;

  // Reachability check: every node MUST be reachable from at least one source
  // (a node with no incoming edges). Topo-sort returning order.length ===
  // nodes.length already proves there's no cycle, but doesn't catch isolated
  // sub-graphs. With a single shared source set walk, we can flag orphans.
  if (wf.nodes.length > 1) {
    const incoming = new Map<string, number>(wf.nodes.map((n) => [n.id, 0]));
    for (const e of wf.edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    const sources = wf.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
    if (sources.length === 0) {
      // Should be unreachable because topo would have flagged the cycle, but
      // defensive — surfaces clearly if the algorithm changes.
      throw new SerializeError('Workflow has no source nodes (every node has an incoming edge).');
    }
    // BFS from all sources.
    const outgoing = new Map<string, string[]>(wf.nodes.map((n) => [n.id, []]));
    for (const e of wf.edges) outgoing.get(e.source)?.push(e.target);
    const reachable = new Set<string>();
    const queue = sources.map((s) => s.id);
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || reachable.has(cur)) continue;
      reachable.add(cur);
      for (const t of outgoing.get(cur) ?? []) if (!reachable.has(t)) queue.push(t);
    }
    if (reachable.size !== wf.nodes.length) {
      const orphan = wf.nodes.find((n) => !reachable.has(n.id));
      throw new SerializeError(
        orphan
          ? `Node "${orphan.name}" is disconnected from every source.`
          : 'Some nodes are disconnected from every source.',
        orphan?.id,
      );
    }
  }

  // Map builder nodes → backend nodes via the catalog. Backend nodeId pattern
  // is [a-zA-Z0-9_-]{1,64}; we synthesize from the catalog kind + position
  // index so a saved+reloaded workflow produces stable identifiers.
  const backendNodes: BackendNode[] = ordered.map((n, i) => {
    const entry = catalogEntry(n.kind);
    if (!entry) {
      throw new SerializeError(`Unknown node kind "${n.kind}".`, n.id);
    }
    const safeKind = entry.kind.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    const nodeId = `${safeKind}_${i}`;
    return {
      nodeId,
      typeId: entry.typeId,
      ...(Object.keys(n.config).length > 0 ? { config: n.config } : {}),
    };
  });

  // Build a map from builder-node-id → backend-node-id so edges resolve.
  const builderIdToBackend = new Map<string, string>(
    ordered.map((n, i) => [n.id, backendNodes[i]!.nodeId]),
  );

  const backendEdges: BackendEdge[] = wf.edges.map((e) => {
    const sourceNodeId = builderIdToBackend.get(e.source);
    const targetNodeId = builderIdToBackend.get(e.target);
    if (!sourceNodeId || !targetNodeId) {
      // Already validated above; defensive.
      throw new SerializeError(`Edge "${e.id}" failed backend-id resolution.`, e.source);
    }
    const out: BackendEdge = {
      edgeId: e.id,
      sourceNodeId,
      targetNodeId,
    };
    if (e.sourcePort && e.sourcePort !== 'output' && e.sourcePort !== 'out') {
      out.sourceOutput = e.sourcePort;
    }
    if (e.targetPort && e.targetPort !== 'input' && e.targetPort !== 'in') {
      out.targetInput = e.targetPort;
    }
    if (e.triggerRule && e.triggerRule !== 'all_success') out.triggerRule = e.triggerRule;
    if (e.condition) out.condition = e.condition;
    if (e.label) out.label = e.label;
    return out;
  });

  return { workflowId: wf.id, nodes: backendNodes, edges: backendEdges };
}
