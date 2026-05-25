/**
 * Canonical WorkflowDefinition → builder graph (inverse of serialize.ts).
 *
 * Accepts the authoring/example shape used by `examples/*` and by the
 * registry chain-pack compositions:
 *   nodes: { id, typeId, name?, position?, config? }
 *   edges: { id?, sourceNodeId, targetNodeId, sourceOutput?, targetInput?,
 *            triggerRule?, condition?, label? }
 * and the backend shape (`nodeId` instead of `id`).
 *
 * Each node's `typeId` is resolved to a catalog `kind`; edges that omit
 * ports inherit the node's first catalog port (canonical edges usually
 * carry no port names — see serialize.ts, which omits the default
 * `out`/`in`). Throws `CanonicalParseError` naming the offending typeIds
 * when a node kind isn't installed on this host (so the import fails
 * loudly rather than dropping nodes silently).
 */

import { catalogEntryByTypeId } from '../palette/catalogRegistry.js';
import type { NodeCatalogEntry } from '../palette/nodeCatalog.js';
import type {
  BuilderEdge,
  BuilderNode,
  EdgeCondition,
  EdgeTriggerRule,
} from './workflow.js';

export class CanonicalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalParseError';
  }
}

interface CanonicalNode {
  id?: string;
  nodeId?: string;
  typeId?: string;
  name?: string;
  position?: { x?: number; y?: number };
  config?: Record<string, unknown>;
}

interface CanonicalEdge {
  id?: string;
  edgeId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  sourceOutput?: string;
  targetInput?: string;
  triggerRule?: string;
  condition?: EdgeCondition;
  label?: string;
}

interface CanonicalDefinition {
  workflowId?: string;
  id?: string;
  name?: string;
  nodes?: CanonicalNode[];
  edges?: CanonicalEdge[];
  defaultInputs?: unknown;
  variables?: unknown;
}

const TRIGGER_RULES: ReadonlySet<string> = new Set<EdgeTriggerRule>([
  'all_success',
  'any_success',
  'all_complete',
  'none_failed',
  'any_failed',
]);

/** True when `obj` looks like a canonical WorkflowDefinition (nodes carry
 *  a `typeId`) rather than a builder SavedWorkflow (nodes carry `kind`).
 *  Lets the import path pick a parser without guessing. */
export function looksCanonical(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const nodes = (obj as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  const first = nodes[0] as Record<string, unknown> | null;
  return Boolean(first) && typeof first!.typeId === 'string' && typeof first!.kind !== 'string';
}

export interface DeserializeResult {
  name: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  defaultInputs: string;
}

// Simple grid layout for nodes that arrive without a position.
function autoPosition(index: number): { x: number; y: number } {
  const COLS = 4;
  return { x: (index % COLS) * 220, y: Math.floor(index / COLS) * 140 };
}

function normalizeDefaultInputs(def: CanonicalDefinition): string {
  const candidate = def.defaultInputs ?? def.variables;
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object') {
    return JSON.stringify(candidate, null, 2);
  }
  return '{}';
}

export function fromCanonicalDefinition(input: unknown): DeserializeResult {
  const def = (input && typeof input === 'object' ? input : {}) as CanonicalDefinition;
  const rawNodes = Array.isArray(def.nodes) ? def.nodes : [];
  if (rawNodes.length === 0) {
    throw new CanonicalParseError('Workflow definition has no nodes.');
  }

  const entryByNodeId = new Map<string, NodeCatalogEntry>();
  const unresolved: string[] = [];
  const nodes: BuilderNode[] = [];

  rawNodes.forEach((n, i) => {
    const id = n.id ?? n.nodeId;
    const typeId = n.typeId;
    if (!id || !typeId) {
      throw new CanonicalParseError(`Node ${i} is missing an id or typeId.`);
    }
    const entry = catalogEntryByTypeId(typeId);
    if (!entry) {
      unresolved.push(typeId);
      return;
    }
    entryByNodeId.set(id, entry);
    const pos =
      n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number'
        ? { x: n.position.x, y: n.position.y }
        : autoPosition(i);
    nodes.push({
      id,
      kind: entry.kind,
      name: n.name ?? entry.label,
      position: pos,
      config: n.config && typeof n.config === 'object' ? { ...n.config } : {},
    });
  });

  if (unresolved.length > 0) {
    const uniq = [...new Set(unresolved)];
    throw new CanonicalParseError(
      `This host can't load ${uniq.length} node type${uniq.length === 1 ? '' : 's'} ` +
        `(not installed): ${uniq.join(', ')}.`,
    );
  }

  const rawEdges = Array.isArray(def.edges) ? def.edges : [];
  const edges: BuilderEdge[] = rawEdges.map((e, i) => {
    const source = e.sourceNodeId ?? '';
    const target = e.targetNodeId ?? '';
    const srcEntry = entryByNodeId.get(source);
    const tgtEntry = entryByNodeId.get(target);
    const edge: BuilderEdge = {
      id: e.id ?? e.edgeId ?? `e_${i}`,
      source,
      sourcePort: e.sourceOutput ?? srcEntry?.outputs[0]?.name ?? 'out',
      target,
      targetPort: e.targetInput ?? tgtEntry?.inputs[0]?.name ?? 'in',
    };
    if (e.triggerRule && TRIGGER_RULES.has(e.triggerRule)) {
      edge.triggerRule = e.triggerRule as EdgeTriggerRule;
    }
    if (e.condition) edge.condition = e.condition;
    if (e.label) edge.label = e.label;
    return edge;
  });

  return {
    name: typeof def.name === 'string' && def.name.trim() ? def.name : 'Imported workflow',
    nodes,
    edges,
    defaultInputs: normalizeDefaultInputs(def),
  };
}
