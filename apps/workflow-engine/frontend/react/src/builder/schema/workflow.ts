/**
 * Builder-side workflow types.
 *
 * The backend executor is linear (one node feeds into the next; see
 * `backend/.../executor/types.ts` WorkflowDefinition). The builder
 * stores a graph (nodes + edges) for the visual editor, then
 * topologically sorts to that linear shape at serialize time. v1
 * enforces a single source → single sink chain — branches reject.
 */

export type PortType = 'any' | 'string' | 'number' | 'boolean' | 'object';

export type NodeCategory = 'flow' | 'data' | 'ai' | 'control' | 'integration';

/** Identifier for a palette entry. Static catalog uses friendly slugs
 *  ('noop', 'delay'); pack-derived entries use the full typeId
 *  ('core.openwop.http.fetch'). Either way it's an opaque string the
 *  catalog resolves to a NodeCatalogEntry. */
export type BuilderNodeKind = string;

export interface PortDef {
  name: string;
  type: PortType;
}

export interface BuilderNode {
  id: string;
  kind: BuilderNodeKind;
  /** User-visible label, defaults to the catalog entry label. */
  name: string;
  position: { x: number; y: number };
  /** Node-kind-specific configuration. Mirrors backend node.config. */
  config: Record<string, unknown>;
}

export interface BuilderEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  version: string;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  /** User-provided default inputs (JSON string) for the first node. */
  defaultInputs?: string;
  createdAt: string;
  updatedAt: string;
}
