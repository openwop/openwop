/**
 * Template validator. Exercises the same structural checks the
 * serializer enforces (empty graph, cycle, reachability, known kinds)
 * without importing the catalog chain — that pulls in `import.meta.env`
 * from Vite and won't run under plain Node/tsx.
 *
 * Usage:  npx tsx scripts/check-templates.ts
 */

import {
  PREMADE_WORKFLOWS,
  cloneTemplateToUserWorkflow,
} from '../src/builder/templates/premadeWorkflows.js';
import type { BuilderEdge, BuilderNode, SavedWorkflow } from '../src/builder/schema/workflow.js';

// Mirror the palette's known kinds. Anything else would fail at
// catalogEntry() in the real serializer.
const KNOWN_KINDS = new Set([
  'noop',
  'delay',
  'uppercase',
  'approval',
  'mock-ai',
  'chat',
]);

class CheckError extends Error {
  constructor(message: string, readonly nodeId?: string) {
    super(message);
  }
}

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
  const ready: BuilderNode[] = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const order: BuilderNode[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  while (ready.length > 0) {
    const cur = ready.shift();
    if (!cur) break;
    order.push(cur);
    for (const e of outgoing.get(cur.id) ?? []) {
      const t = byId.get(e.target);
      if (!t) continue;
      const d = (indegree.get(t.id) ?? 0) - 1;
      indegree.set(t.id, d);
      if (d === 0) ready.push(t);
    }
  }
  if (order.length !== nodes.length) {
    const stuck = nodes.find((n) => (indegree.get(n.id) ?? 0) > 0);
    return { cycleNodeId: stuck?.id ?? '' };
  }
  return { order };
}

function validate(wf: SavedWorkflow): { nodeCount: number; edgeCount: number } {
  if (wf.nodes.length === 0) throw new CheckError('Workflow has no nodes.');

  // Unknown kinds.
  for (const n of wf.nodes) {
    if (!KNOWN_KINDS.has(n.kind)) {
      throw new CheckError(`Unknown node kind "${n.kind}" on node ${n.id}.`, n.id);
    }
  }

  // Edge endpoints reference known nodes.
  const ids = new Set(wf.nodes.map((n) => n.id));
  for (const e of wf.edges) {
    if (!ids.has(e.source)) throw new CheckError(`Edge ${e.id}: unknown source ${e.source}.`);
    if (!ids.has(e.target)) throw new CheckError(`Edge ${e.id}: unknown target ${e.target}.`);
  }

  // Cycles + reachability.
  const sorted = topoSort(wf.nodes, wf.edges);
  if ('cycleNodeId' in sorted) {
    throw new CheckError(`Cycle reaches node ${sorted.cycleNodeId}.`, sorted.cycleNodeId);
  }
  if (wf.nodes.length > 1) {
    const incoming = new Map<string, number>(wf.nodes.map((n) => [n.id, 0]));
    for (const e of wf.edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    const sources = wf.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
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
      throw new CheckError(
        orphan ? `Node "${orphan.name}" is disconnected.` : 'Some nodes are disconnected.',
        orphan?.id,
      );
    }
  }
  return { nodeCount: wf.nodes.length, edgeCount: wf.edges.length };
}

let failures = 0;
for (const tpl of PREMADE_WORKFLOWS) {
  const saved = cloneTemplateToUserWorkflow(tpl);
  try {
    const { nodeCount, edgeCount } = validate(saved);
    const shape =
      edgeCount === 0 ? `${nodeCount} nodes, no edges` : `${nodeCount} nodes, ${edgeCount} edges`;
    console.log(`  ok   ${tpl.templateId.padEnd(50)} ${shape}`);
  } catch (err) {
    failures++;
    console.error(
      `  FAIL ${tpl.templateId.padEnd(50)} ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
if (failures > 0) {
  console.error(`\n${failures} of ${PREMADE_WORKFLOWS.length} templates failed validation.`);
  process.exit(1);
}
console.log(`\nAll ${PREMADE_WORKFLOWS.length} templates validate cleanly.`);
