/**
 * Builder graph → backend WorkflowDefinition.
 *
 * The backend executor is linear (see backend/.../executor/executor.ts).
 * v1 enforces a single source → single sink chain: branches, multiple
 * sources/sinks, and cycles all reject. The error message names the
 * offending node so the inspector can highlight it.
 */

import { catalogEntry } from '../palette/catalogRegistry.js';
import type { BuilderEdge, BuilderNode, SavedWorkflow } from './workflow.js';

export interface BackendNode {
  nodeId: string;
  typeId: string;
  config?: Record<string, unknown>;
}

export interface BackendWorkflowDefinition {
  workflowId: string;
  nodes: BackendNode[];
}

export class SerializeError extends Error {
  constructor(message: string, readonly nodeId?: string) {
    super(message);
    this.name = 'SerializeError';
  }
}

export function serializeWorkflow(wf: SavedWorkflow): BackendWorkflowDefinition {
  if (wf.nodes.length === 0) {
    throw new SerializeError('Workflow has no nodes.');
  }

  const nodeById = new Map<string, BuilderNode>(wf.nodes.map((n): [string, BuilderNode] => [n.id, n]));
  const incoming = new Map<string, BuilderEdge[]>();
  const outgoing = new Map<string, BuilderEdge[]>();
  for (const n of wf.nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of wf.edges) {
    const outFromSource = outgoing.get(e.source);
    const inToTarget = incoming.get(e.target);
    if (!outFromSource || !inToTarget) {
      throw new SerializeError('Edge references unknown node.', e.source);
    }
    outFromSource.push(e);
    inToTarget.push(e);
  }

  // Single source.
  const sources = wf.nodes.filter((n) => (incoming.get(n.id) ?? []).length === 0);
  if (sources.length === 0) {
    throw new SerializeError('Workflow has a cycle (no source node).');
  }
  if (sources.length > 1) {
    const secondSource = sources[1];
    throw new SerializeError(
      `Workflow has ${sources.length} source nodes; v1 supports a single linear chain.`,
      secondSource?.id,
    );
  }

  // Walk forward; each node has at most one outgoing edge.
  const ordered: BuilderNode[] = [];
  const visited = new Set<string>();
  let cursor: BuilderNode | undefined = sources[0];
  while (cursor) {
    if (visited.has(cursor.id)) {
      throw new SerializeError('Workflow has a cycle.', cursor.id);
    }
    visited.add(cursor.id);
    ordered.push(cursor);
    const next: BuilderEdge[] = outgoing.get(cursor.id) ?? [];
    if (next.length > 1) {
      throw new SerializeError(
        `Node "${cursor.name}" branches to ${next.length} targets; v1 supports a single linear chain.`,
        cursor.id,
      );
    }
    const onlyNext = next.length === 1 ? next[0] : undefined;
    cursor = onlyNext ? nodeById.get(onlyNext.target) : undefined;
  }

  // Every node must be reachable from the source.
  if (ordered.length !== wf.nodes.length) {
    const orphan = wf.nodes.find((n) => !visited.has(n.id));
    throw new SerializeError(
      orphan
        ? `Node "${orphan.name}" is disconnected from the chain.`
        : 'Some nodes are disconnected from the chain.',
      orphan?.id,
    );
  }

  // Map each builder node → backend node via the catalog.
  const backendNodes: BackendNode[] = ordered.map((n, i) => {
    const entry = catalogEntry(n.kind);
    if (!entry) {
      throw new SerializeError(`Unknown node kind "${n.kind}".`, n.id);
    }
    // Backend nodeId pattern is [a-zA-Z0-9_-]{1,64} — sanitize.
    const nodeId = `${entry.kind}_${i}`;
    return {
      nodeId,
      typeId: entry.typeId,
      ...(Object.keys(n.config).length > 0 ? { config: n.config } : {}),
    };
  });

  return { workflowId: wf.id, nodes: backendNodes };
}
