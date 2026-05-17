/**
 * Builder-side workflow types.
 *
 * The backend executor is a DAG scheduler (see
 * `backend/.../executor/scheduler.ts`). The builder stores a graph
 * (nodes + edges) for the visual editor; the serializer emits the
 * canonical `{ workflowId, nodes, edges }` shape per `spec/v1/
 * workflow-definition.schema.json`. Branching, fan-in, conditional
 * routing, and parallel paths are all supported. Cycles still reject.
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

/** When a target node has multiple incoming edges, this rule controls
 *  when the target fires. Matches `WorkflowEdge.triggerRule` in
 *  spec/v1/workflow-definition.schema.json. */
export type EdgeTriggerRule =
  | 'all_success'   // wait for every upstream to complete successfully (default)
  | 'any_success'   // fire on the first upstream success
  | 'all_complete'  // wait for every upstream to terminate regardless of outcome
  | 'none_failed'   // fire only if every upstream succeeded (no failures)
  | 'any_failed';   // fire only on an upstream failure (error-routing)

export interface EdgeCondition {
  /** Dotted path into the source's output. */
  path: string;
  op: 'eq' | 'neq' | 'truthy' | 'falsy' | 'exists' | 'contains';
  /** Comparison value (omitted for `truthy`/`falsy`/`exists`). */
  value?: unknown;
}

export interface BuilderEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
  /** Fan-in semantics for the target node. Default `all_success`. */
  triggerRule?: EdgeTriggerRule;
  /** Optional condition predicate. When set, the edge fires only when
   *  the predicate matches the source's output. */
  condition?: EdgeCondition;
  /** Optional human-readable label rendered on the edge. */
  label?: string;
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
