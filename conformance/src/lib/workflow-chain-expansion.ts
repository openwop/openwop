/**
 * Workflow-chain pack expansion — reference implementation of the
 * 9-step host-editor expansion semantics from
 * `spec/v1/workflow-chain-packs.md` §"Expansion semantics (normative)".
 *
 * Pure function. Zero I/O, zero crypto. Hosts implementing chain
 * expansion in their workflow editors MAY import this directly OR
 * adapt the algorithm into their language of choice — the contract
 * this code encodes is the spec, not the code itself.
 *
 * What this implements:
 *   - Step 3: validate referenced typeIds resolve (delegated to caller via
 *     `isTypeIdResolvable` predicate)
 *   - Step 5: `{{params.<name>}}` literal substitution (recursive into
 *     nested string fields inside `config` / `inputs`)
 *   - Step 6: per-expansion node-id rewrite with a chainId-derived prefix
 *     for collision-free splice into the parent workflow
 *   - Step 8: capability propagation (chain.capabilities[] → every
 *     expanded WorkflowNode.capabilities[])
 *   - Edge endpoint rewriting (`from`/`to` ids that reference fragment
 *     nodes get the same prefix)
 *
 * What this deliberately DOESN'T implement (host-specific concerns):
 *   - Step 1: registry resolution (network/storage path is host-specific)
 *   - Step 2: signature verification (use `node:crypto`'s Ed25519 path —
 *     see workflow-chain-pack-signature-verification.test.ts)
 *   - Step 4: parameter-form prompting (host-UI concern)
 *   - Step 7: splice into parent workflow (host-editor concern; this
 *     function returns the rewritten fragment ready to be appended)
 *   - Step 9: persistence (host-storage concern)
 *
 * @see spec/v1/workflow-chain-packs.md §"Expansion semantics (normative)"
 * @see RFCS/0013-workflow-chain-packs.md
 */

/** A workflow-chain entry as it appears in a pack manifest. */
export interface WorkflowChain {
  chainId: string;
  version: string;
  label: string;
  description: string;
  parameters: object;
  dag: { nodes: ReadonlyArray<FragmentNode>; edges?: ReadonlyArray<FragmentEdge> };
  outputs?: Record<string, { type: string; description: string }>;
  capabilities?: ReadonlyArray<'streamable' | 'cacheable' | 'side-effectful' | 'mcp-exportable'>;
}

export interface FragmentNode {
  id: string;
  typeId: string;
  name?: string;
  position?: { x: number; y: number };
  config?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
}

/** A fan-in / error-routing rule mirrored from `WorkflowEdge.triggerRule`
 *  (workflow-definition.schema.json). RFC 0125. */
export type TriggerRule =
  | 'all_success'
  | 'any_success'
  | 'all_complete'
  | 'none_failed'
  | 'any_failed';

export interface FragmentEdge {
  from: string;
  to: string;
  /** Edge condition — an `EdgeCondition` object (RFC 0013 amendment #818).
   *  Carried through expansion opaquely; typed `unknown` since the lib does
   *  not evaluate it. */
  condition?: unknown;
  /** Fan-in / error-routing rule (RFC 0125). Carried through expansion onto
   *  the resulting WorkflowEdge so the scheduler honors it. */
  triggerRule?: TriggerRule;
}

/** Per-expansion context the caller supplies. */
export interface ExpansionContext {
  /** Caller-supplied unique tag for this expansion (e.g., 4-hex random).
   *  Combined with the chainId slug to namespace expanded node ids so
   *  the same chain can be expanded multiple times within one parent
   *  workflow without id collisions. */
  expansionId: string;
  /** Author-supplied parameter values, ALREADY VALIDATED against the
   *  chain's `parameters` JSON Schema. This function does NOT re-validate
   *  — the caller MUST ajv-compile `chain.parameters` and reject invalid
   *  input with `chain_parameter_invalid` BEFORE calling. */
  params: Record<string, unknown>;
  /** Predicate the caller supplies for typeId resolution (step 3). Should
   *  return `true` if the typeId is registered with the destination host
   *  (either reserved `core.*` or published via a known node pack). */
  isTypeIdResolvable: (typeId: string) => boolean;
}

/** Result of expansion — ready to be spliced into a parent workflow's
 *  `nodes[]` / `edges[]`. */
export interface ExpandedFragment {
  nodes: ReadonlyArray<{
    id: string;
    typeId: string;
    name?: string;
    position?: { x: number; y: number };
    config?: Record<string, unknown>;
    inputs?: Record<string, unknown>;
    capabilities?: ReadonlyArray<string>;
  }>;
  edges: ReadonlyArray<{ from: string; to: string; condition?: unknown; triggerRule?: TriggerRule }>;
  /** Map of original-fragment-id → rewritten-id, so the caller can
   *  wire the parent workflow's adjacent edges into the expansion. */
  idMap: ReadonlyMap<string, string>;
}

/** Thrown when expansion encounters a chain that references a typeId the
 *  destination host can't resolve. Carries both the offending `typeId`
 *  and the `chainId` for diagnostic reporting. The error message uses
 *  the wire-level error code `chain_unresolvable_typeid` per
 *  `workflow-chain-packs.md` §"Error codes". */
export class ChainUnresolvableTypeIdError extends Error {
  readonly code = 'chain_unresolvable_typeid';
  constructor(readonly typeId: string, readonly chainId: string) {
    super(`chain_unresolvable_typeid: '${typeId}' in chain '${chainId}'`);
    this.name = 'ChainUnresolvableTypeIdError';
  }
}

const PARAM_PATTERN = /\{\{params\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/** Recursive literal substitution of `{{params.<name>}}` placeholders in
 *  any string field. Non-string values pass through unchanged; nested
 *  arrays/objects are walked. */
function substitute(value: unknown, params: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(PARAM_PATTERN, (_match, name: string) => {
      const v = params[name];
      // Per the spec, parameter values are validated against the chain's
      // parameters schema BEFORE expansion, so `v === undefined` here
      // means the chain author referenced an undeclared parameter — the
      // safest substitution is the empty string (matching the standard
      // {{...}} convention in n8n/Handlebars).
      return v === undefined ? '' : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, params));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, params);
    return out;
  }
  return value;
}

/** Rewrite an edge endpoint ref. `ref` is either `<nodeId>` or
 *  `<nodeId>.<portName>`. Only the nodeId portion is rewritten; the
 *  portName (if present) is preserved verbatim. Refs that don't match
 *  a fragment node id pass through unchanged (lets edges to/from
 *  parent-workflow nodes work via post-splice wiring). */
function rewriteEdgeRef(
  ref: string,
  fragmentNodeIds: ReadonlySet<string>,
  prefix: string,
): string {
  const dotIdx = ref.indexOf('.');
  const nodeId = dotIdx === -1 ? ref : ref.slice(0, dotIdx);
  const portPart = dotIdx === -1 ? '' : ref.slice(dotIdx);
  return fragmentNodeIds.has(nodeId) ? `${prefix}${nodeId}${portPart}` : ref;
}

/** Compute the per-expansion node-id prefix from the chainId + expansionId.
 *  The chainId's dots are replaced with underscores so the resulting ids
 *  remain valid in storage backends that reserve `.` for hierarchical
 *  keys. */
function computePrefix(chainId: string, expansionId: string): string {
  return `${chainId.replace(/\./g, '_')}_${expansionId}_`;
}

/**
 * Expand a workflow-chain into a concrete fragment ready to splice into a
 * parent workflow. Implements steps 3 + 5 + 6 + 8 of the normative
 * `workflow-chain-packs.md` §"Expansion semantics" flow.
 *
 * @throws ChainUnresolvableTypeIdError when any `dag.nodes[].typeId`
 *   fails the caller's `isTypeIdResolvable` predicate.
 */
export function expandChain(chain: WorkflowChain, ctx: ExpansionContext): ExpandedFragment {
  // Step 3: validate every typeId resolves.
  for (const node of chain.dag.nodes) {
    if (!ctx.isTypeIdResolvable(node.typeId)) {
      throw new ChainUnresolvableTypeIdError(node.typeId, chain.chainId);
    }
  }

  const prefix = computePrefix(chain.chainId, ctx.expansionId);
  const fragmentNodeIds = new Set(chain.dag.nodes.map((n) => n.id));
  const idMap = new Map<string, string>();
  for (const id of fragmentNodeIds) idMap.set(id, `${prefix}${id}`);

  // Steps 5 + 6 + 8: substitute placeholders, rewrite ids, propagate capabilities.
  const expandedNodes = chain.dag.nodes.map((n) => {
    const out: ExpandedFragment['nodes'][number] = {
      id: `${prefix}${n.id}`,
      typeId: n.typeId,
    };
    if (n.name !== undefined) out.name = n.name;
    if (n.position !== undefined) out.position = n.position;
    if (n.config !== undefined) {
      out.config = substitute(n.config, ctx.params) as Record<string, unknown>;
    }
    if (n.inputs !== undefined) {
      out.inputs = substitute(n.inputs, ctx.params) as Record<string, unknown>;
    }
    if (chain.capabilities && chain.capabilities.length > 0) {
      out.capabilities = [...chain.capabilities];
    }
    return out;
  });

  const expandedEdges = (chain.dag.edges ?? []).map((e) => {
    const out: ExpandedFragment['edges'][number] = {
      from: rewriteEdgeRef(e.from, fragmentNodeIds, prefix),
      to: rewriteEdgeRef(e.to, fragmentNodeIds, prefix),
    };
    if (e.condition !== undefined) out.condition = e.condition;
    // RFC 0125: carry the fan-in/error-routing rule onto the expanded
    // WorkflowEdge so the scheduler honors it (mirrors the `condition`
    // pass-through; without this the field is silently dropped at expansion).
    if (e.triggerRule !== undefined) out.triggerRule = e.triggerRule;
    return out;
  });

  return { nodes: expandedNodes, edges: expandedEdges, idMap };
}
