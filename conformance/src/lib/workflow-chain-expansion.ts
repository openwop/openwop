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
  /** RFC 0133 §1. Child chains this chain composes at run time. A node
   *  references one via `config.subChainRef`; the host co-registers it as
   *  its own workflow and dispatches it as a child run. Optional — a chain
   *  with none behaves exactly as under RFC 0013. */
  subChains?: ReadonlyArray<SubChainRef>;
  /** RFC 0133 §2. Run-scoped values a node writes to the executor's variable
   *  bag and downstream nodes read via a `{ type:"variable" }` input binding.
   *  Distinct from author-time `parameters`; carry NO author-time value. */
  producedVariables?: ReadonlyArray<ProducedVariable>;
}

/** RFC 0133 §1.1. A reference to a child chain the parent composes. `ref` is
 *  EITHER a sibling `chainId` string (a chain in the SAME pack) OR an object
 *  naming an externally published chain (resolved + signature-verified like any
 *  pack dependency). */
export interface SubChainRef {
  ref: string | { packName: string; chainId: string; version: string };
}

/** RFC 0133 §2.2. A run-scoped variable a chain declares: written by one node
 *  (`producedBy`) and read by others by `name`. `type` is a JSON-Schema type
 *  token for validation/inspection. Run-scoped — no author-time value. */
export interface ProducedVariable {
  name: string;
  producedBy: string;
  type: string;
  description?: string;
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
/** A value that is EXACTLY a single `{{params.<name>}}` token (whole-value),
 *  distinct from a token embedded in a larger string. Under expansion-time
 *  substitution a whole-value token resolves to the RAW TYPED parameter value
 *  rather than a string coercion (WCP2 raw-typed rule); under deferred mode it
 *  is the only non-prompt position deferrable to a variable-sourced PortValue.
 *  An embedded non-prompt token has no runtime `{{}}` construct and MUST resolve
 *  at expansion time. */
const WHOLE_VALUE_PATTERN = /^\{\{params\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}$/;

/** Recursive substitution of `{{params.<name>}}` placeholders in any string
 *  field. Two cases per `workflow-chain-packs.md` §"Parameter substitution":
 *    - WHOLE-VALUE: a string that is exactly one `{{params.x}}` token resolves
 *      to the RAW typed parameter value (object / array / number / boolean
 *      survive as their JSON type instead of being stringified).
 *    - EMBEDDED: one or more tokens inside surrounding text do literal string
 *      substitution.
 *  Non-string values pass through unchanged; nested arrays/objects are walked. */
function substitute(value: unknown, params: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE_VALUE_PATTERN.exec(value);
    if (whole) {
      // Whole-value token — return the raw typed value so a param typed
      // `object` / `array` / `number` / `boolean` reaches the node config
      // intact. `undefined` (undeclared param) collapses to the empty string,
      // matching the embedded-token convention below.
      const v = params[whole[1] as string];
      return v === undefined ? '' : v;
    }
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

// ---------------------------------------------------------------------------
// RFC 0124 (WCP4) — Portable per-run parameter deferral.
//
// The DEFERRED expansion mode: instead of freezing `{{params.*}}` values into
// persisted `config`/`inputs` at drop time (the RFC 0013 default), the host
// materializes the chain's `parameters` into top-level workflow `variables[]`
// (author value → `defaultValue`) and rewrites each token into an already-spec'd
// RUNTIME binding — so the persisted fragment carries ZERO `{{params.*}}` tokens
// yet every parameter stays overridable per run via `configurable`. This is the
// spec-authoritative reference for `spec/v1/workflow-chain-packs.md`
// §"Deferred-parameter expansion (RFC 0124)".
// ---------------------------------------------------------------------------

/** The parameter JSON Schema fragment (`chain.parameters`), narrowed to the
 *  fields deferred expansion reads: each property's `type`, `description`, and
 *  the RFC 0124 `x-openwop-sensitive` extension key. */
export interface ParameterSchema {
  properties?: Record<
    string,
    { type?: string; description?: string; 'x-openwop-sensitive'?: boolean }
  >;
}

/** Host capability context deferred expansion needs (RFC 0124 §Capability
 *  gating). The prompt-bearing rewrite path requires `prompts.variableSources`
 *  to include `variable`; a `source:"secret"` sensitive lift requires
 *  `capabilities.secrets.supported`. */
export interface DeferredHostContext {
  /** `capabilities.prompts.variableSources` includes `"variable"`. */
  promptVariableSource: boolean;
  /** `capabilities.secrets.supported`. */
  secretsSupported: boolean;
}

export interface DeferredExpansionContext {
  expansionId: string;
  /** Author-supplied parameter values (already validated) → `defaultValue` seeds. */
  params: Record<string, unknown>;
  /** The chain's `parameters` JSON Schema (type + `x-openwop-sensitive` per property). */
  parameterSchema: ParameterSchema;
  isTypeIdResolvable: (typeId: string) => boolean;
  host: DeferredHostContext;
}

/** A materialized top-level `WorkflowVariable` (subset — the fields deferred
 *  expansion sets). A NON-sensitive parameter materializes here with its author
 *  value as `defaultValue`. A sensitive parameter does NOT (its value never
 *  lands in the run-scoped bag); it is bound as a `source:"secret"` prompt
 *  variable instead. */
export interface MaterializedVariable {
  name: string;
  type: string;
  description?: string;
  defaultValue?: unknown;
  sensitive?: boolean;
}

/** A rewritten prompt-template variable slot (RFC 0027). `source:"variable"`
 *  resolves from the run bag; `source:"secret"` resolves a BYOK secret at
 *  compose time, redacted in `prompt.composed` (RFC 0124 §Security). */
export interface PromptVariableBinding {
  name: string;
  source: 'variable' | 'secret';
}

export interface DeferredExpandedFragment {
  nodes: ExpandedFragment['nodes'];
  edges: ExpandedFragment['edges'];
  idMap: ReadonlyMap<string, string>;
  /** Materialized top-level `variables[]` (non-sensitive params only). */
  variables: ReadonlyArray<MaterializedVariable>;
  /** Prompt-site variable bindings introduced by the rewrite. */
  promptVariables: ReadonlyArray<PromptVariableBinding>;
  /** Auto-generated `configurableSchema` mapping the BARE param name (the
   *  normative override key) to its type, so a per-run `configurable` keyed on
   *  the bare name resolves (R6 cross-host key stability). */
  configurableSchema: { properties: Record<string, { type: string }> };
}

/** Thrown when a `x-openwop-sensitive` parameter cannot be securely deferred:
 *  it resolves to a non-prompt position (whole-value `node.inputs`, embedded
 *  non-prompt `config`), or the host lacks `secrets`/deferred support. Wire
 *  code `sensitive_param_not_deferrable` (HTTP 422) per
 *  `workflow-chain-packs.md` §"Error codes" (RFC 0124 §Security). */
export class SensitiveParamNotDeferrableError extends Error {
  readonly code = 'sensitive_param_not_deferrable';
  readonly httpStatus = 422;
  constructor(readonly param: string, readonly reason: string) {
    super(`sensitive_param_not_deferrable: '${param}' — ${reason}`);
    this.name = 'SensitiveParamNotDeferrableError';
  }
}

/** The prompt-bearing `config` fields a token in which is a "prompt position"
 *  (lifted to a PromptTemplate `{{varName}}` slot). Everything else in `config`
 *  is a non-prompt position. */
const PROMPT_CONFIG_FIELDS: ReadonlySet<string> = new Set(['systemPrompt', 'userPrompt']);

/**
 * Deferred-mode expansion (RFC 0124). Rewrites every `{{params.<name>}}` token
 * into a spec'd runtime binding and materializes non-sensitive parameters into
 * top-level `variables[]`, leaving ZERO `{{params.*}}` tokens in the persisted
 * fragment. Sensitive parameters (`x-openwop-sensitive`) are handled per
 * §Security: prompt-body → `source:"secret"`; anywhere else → fail closed.
 *
 * @throws SensitiveParamNotDeferrableError when a sensitive parameter is in a
 *   non-prompt position, or the host lacks `secrets` support.
 * @throws ChainUnresolvableTypeIdError when any node typeId fails resolution.
 */
export function expandChainDeferred(
  chain: WorkflowChain,
  ctx: DeferredExpansionContext,
): DeferredExpandedFragment {
  for (const node of chain.dag.nodes) {
    if (!ctx.isTypeIdResolvable(node.typeId)) {
      throw new ChainUnresolvableTypeIdError(node.typeId, chain.chainId);
    }
  }

  const props = ctx.parameterSchema.properties ?? {};
  const isSensitive = (name: string): boolean => props[name]?.['x-openwop-sensitive'] === true;
  const typeOf = (name: string): string => props[name]?.type ?? 'string';

  const prefix = computePrefix(chain.chainId, ctx.expansionId);
  const fragmentNodeIds = new Set(chain.dag.nodes.map((n) => n.id));
  const idMap = new Map<string, string>();
  for (const id of fragmentNodeIds) idMap.set(id, `${prefix}${id}`);

  const usedParams = new Set<string>();
  const promptVariables = new Map<string, PromptVariableBinding>();

  /** Rewrite a prompt-position string: each embedded `{{params.x}}` → a
   *  PromptTemplate `{{x}}` slot. A sensitive param binds `source:"secret"`
   *  (requires host secrets support), else `source:"variable"`. If the host
   *  does not advertise the `variable` prompt source at all, the deferred
   *  prompt path is unavailable — the caller falls back to expansion-time
   *  substitution (G5); we surface that by returning `null`. */
  function rewritePrompt(text: string): string | null {
    if (!ctx.host.promptVariableSource) return null; // G5 fallback → expansion-time
    return text.replace(PARAM_PATTERN, (_m, name: string) => {
      usedParams.add(name);
      if (isSensitive(name)) {
        if (!ctx.host.secretsSupported) {
          throw new SensitiveParamNotDeferrableError(name, 'host lacks capabilities.secrets support');
        }
        promptVariables.set(name, { name, source: 'secret' });
      } else {
        promptVariables.set(name, { name, source: 'variable' });
      }
      return `{{${name}}}`;
    });
  }

  /** Rewrite a config object: prompt fields → PromptTemplate slots; a token in
   *  any NON-prompt config field is embedded-non-prompt → sensitive fails
   *  closed, non-sensitive resolves at expansion time (author-trusted). */
  function rewriteConfig(config: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      if (typeof v === 'string' && PROMPT_CONFIG_FIELDS.has(k) && PARAM_PATTERN.test(v)) {
        PARAM_PATTERN.lastIndex = 0;
        const rewritten = rewritePrompt(v);
        out[k] = rewritten === null ? substitute(v, ctx.params) : rewritten;
        continue;
      }
      PARAM_PATTERN.lastIndex = 0;
      if (typeof v === 'string' && PARAM_PATTERN.test(v)) {
        // embedded non-prompt token
        PARAM_PATTERN.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = PARAM_PATTERN.exec(v)) !== null) {
          if (isSensitive(m[1])) {
            throw new SensitiveParamNotDeferrableError(m[1], `embedded non-prompt config field '${k}'`);
          }
        }
        out[k] = substitute(v, ctx.params); // author-trusted expansion-time resolution
      } else {
        out[k] = substitute(v, ctx.params);
      }
    }
    return out;
  }

  /** Rewrite an inputs object: a WHOLE-VALUE `{{params.x}}` → a variable-sourced
   *  PortValue (WCP2 raw-typed); a sensitive whole-value fails closed (no
   *  plaintext-bag path for a secret). Embedded input tokens follow the same
   *  non-prompt rule as config. */
  function rewriteInputs(inputs: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inputs)) {
      const whole = typeof v === 'string' ? WHOLE_VALUE_PATTERN.exec(v) : null;
      if (whole) {
        const name = whole[1];
        if (isSensitive(name)) {
          throw new SensitiveParamNotDeferrableError(name, `whole-value node input '${k}'`);
        }
        usedParams.add(name);
        out[k] = { source: 'variable', variable: name }; // variable-sourced PortValue
        continue;
      }
      PARAM_PATTERN.lastIndex = 0;
      if (typeof v === 'string' && PARAM_PATTERN.test(v)) {
        PARAM_PATTERN.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = PARAM_PATTERN.exec(v)) !== null) {
          if (isSensitive(m[1])) {
            throw new SensitiveParamNotDeferrableError(m[1], `embedded non-prompt input '${k}'`);
          }
        }
        out[k] = substitute(v, ctx.params);
      } else {
        out[k] = substitute(v, ctx.params);
      }
    }
    return out;
  }

  const expandedNodes = chain.dag.nodes.map((n) => {
    const out: ExpandedFragment['nodes'][number] = { id: `${prefix}${n.id}`, typeId: n.typeId };
    if (n.name !== undefined) out.name = n.name;
    if (n.position !== undefined) out.position = n.position;
    if (n.config !== undefined) out.config = rewriteConfig(n.config);
    if (n.inputs !== undefined) out.inputs = rewriteInputs(n.inputs);
    if (chain.capabilities && chain.capabilities.length > 0) out.capabilities = [...chain.capabilities];
    return out;
  });

  const expandedEdges = (chain.dag.edges ?? []).map((e) => {
    const out: ExpandedFragment['edges'][number] = {
      from: rewriteEdgeRef(e.from, fragmentNodeIds, prefix),
      to: rewriteEdgeRef(e.to, fragmentNodeIds, prefix),
    };
    if (e.condition !== undefined) out.condition = e.condition;
    if (e.triggerRule !== undefined) out.triggerRule = e.triggerRule;
    return out;
  });

  // Materialize NON-sensitive used params into top-level variables[]; build the
  // bare-param → type configurableSchema for the override key.
  const variables: MaterializedVariable[] = [];
  const configurableSchema: { properties: Record<string, { type: string }> } = { properties: {} };
  for (const name of usedParams) {
    configurableSchema.properties[name] = { type: typeOf(name) };
    if (isSensitive(name)) continue; // sensitive value never lands in the bag
    const v: MaterializedVariable = { name, type: typeOf(name) };
    if (props[name]?.description !== undefined) v.description = props[name]!.description;
    if (name in ctx.params) v.defaultValue = ctx.params[name];
    variables.push(v);
  }

  return {
    nodes: expandedNodes,
    edges: expandedEdges,
    idMap,
    variables,
    promptVariables: [...promptVariables.values()],
    configurableSchema,
  };
}

// ---------------------------------------------------------------------------
// RFC 0133 — Workflow-chain composition: sub-chains + produced variables.
//
// Two additive extensions to the RFC 0013 model, each usable alone:
//
//   §1 SUB-CHAINS — a chain declares child chains it composes (`subChains[]`)
//      and references them from a runtime dispatch node via `config.subChainRef`.
//      Unlike RFC 0013's author-time inline splice, a referenced sub-chain is
//      CO-INSTANTIATED as its own registered workflow and dispatched by the
//      parent at run time (the parent genuinely holds the child). Expansion
//      mints a DETERMINISTIC, TENANT-SCOPED child id from (tenantId, childChainId, version) so
//      a repeat instantiation converges and a shared child registers once, then
//      rewrites the referencing node's `config.subChainRef` → `config.workflowId`
//      (the field the runtime already reads). Recursion is bounded by a cycle
//      check + `maxSubChainDepth` (DoS guard — SECURITY `sub-chain-expansion-bounded`).
//
//   §2 PRODUCED VARIABLES — a chain declares run-scoped values a node writes to
//      the executor's variable bag (`producedVariables[]`), emitted on expansion
//      into `WorkflowDefinition.variables[]`. Any `{ type:"variable" }` input
//      read is validated closed-world against the declared set (+ materialized
//      params); an undeclared read is a `variable_undeclared` manifest error.
//
// @see spec/v1/workflow-chain-packs.md §"Sub-chain composition (RFC 0133)"
//   + §"Produced (run-scoped) variables (RFC 0133)"
// @see RFCS/0133-workflow-chain-composition.md
// ---------------------------------------------------------------------------

/** RECOMMENDED default recursion bound for sub-chain co-expansion (RFC 0133
 *  §1.3 — confirms UQ3). A host MAY advertise a different `maxDepth` via
 *  `capabilities.workflowChainPacks.subChains.maxDepth`. */
export const DEFAULT_MAX_SUB_CHAIN_DEPTH = 8;

/** Thrown when a `config.subChainRef` (or a `subChains[].ref`) names a sibling
 *  chainId that is not present in the same pack, or an external ref that fails
 *  resolution/verification. Wire code `sub_chain_unresolved` (HTTP 400) per
 *  `workflow-chain-packs.md` §"Error codes" (RFC 0133). */
export class SubChainUnresolvedError extends Error {
  readonly code = 'sub_chain_unresolved';
  readonly httpStatus = 400;
  constructor(readonly ref: string, readonly chainId: string) {
    super(`sub_chain_unresolved: '${ref}' referenced from chain '${chainId}'`);
    this.name = 'SubChainUnresolvedError';
  }
}

/** Thrown when a chain transitively composes itself (a cycle in the compose
 *  graph). Wire code `sub_chain_cycle` (HTTP 400) per `workflow-chain-packs.md`
 *  §"Error codes" (RFC 0133). Together with `SubChainDepthExceededError` it is a
 *  public test for SECURITY invariant `sub-chain-expansion-bounded`. */
export class SubChainCycleError extends Error {
  readonly code = 'sub_chain_cycle';
  readonly httpStatus = 400;
  constructor(readonly chainId: string, readonly detail: string) {
    super(`sub_chain_cycle: chain '${chainId}' — ${detail}`);
    this.name = 'SubChainCycleError';
  }
}

/** Thrown when co-expansion nesting exceeds `maxSubChainDepth` — the DoS depth
 *  backstop, DISTINCT from an actual cycle so an operator sees WHICH bound fired.
 *  Wire code `sub_chain_max_depth_exceeded` (HTTP 400) per `workflow-chain-packs.md`
 *  §"Error codes" (RFC 0133). A public test for `sub-chain-expansion-bounded`. */
export class SubChainDepthExceededError extends Error {
  readonly code = 'sub_chain_max_depth_exceeded';
  readonly httpStatus = 400;
  constructor(readonly chainId: string, readonly maxDepth: number) {
    super(`sub_chain_max_depth_exceeded: chain '${chainId}' exceeds maxSubChainDepth ${maxDepth}`);
    this.name = 'SubChainDepthExceededError';
  }
}

/** Thrown when a node input binding `{ type:"variable", variableName }` reads a
 *  name that is neither a declared `producedVariables[].name` nor a materialized
 *  parameter — the closed-world guard that closes the "reads a value nothing
 *  produces" hole. Wire code `variable_undeclared` (HTTP 400) per
 *  `workflow-chain-packs.md` §"Error codes" (RFC 0133). */
export class VariableUndeclaredError extends Error {
  readonly code = 'variable_undeclared';
  readonly httpStatus = 400;
  constructor(readonly variableName: string, readonly chainId: string) {
    super(`variable_undeclared: '${variableName}' read in chain '${chainId}'`);
    this.name = 'VariableUndeclaredError';
  }
}

/** The canonical `subChains[].ref` chainId — a string ref is the sibling
 *  chainId; an object ref's `chainId` is the external chain's id. */
function refChainId(ref: SubChainRef['ref']): string {
  return typeof ref === 'string' ? ref : ref.chainId;
}

/** Deterministic child workflow id minted from **(tenantId, childChainId, version)**
 *  per RFC 0133 §1.3 step 2. TENANT-SCOPED by construction: the `registerWorkflow`
 *  registry is global by-id, so a tenant-less id would let two tenants instantiating
 *  the same parent→child COLLIDE on one global workflow (a cross-tenant isolation
 *  break — SECURITY `sub-chain-child-tenant-scoped`). Keying on `tenantId` also makes
 *  the dedup correct ACROSS PARENTS within a tenant: a child chain composed by two
 *  different parents in the same tenant registers exactly once (a repeat instantiation
 *  converges). `version` distinguishes `lesson-batch@1` from `lesson-batch@2`. Dots +
 *  unsafe chars are slugged (storage-key safety). */
export function mintChildWorkflowId(tenantId: string, childChainId: string, version: string): string {
  const slug = (s: string): string => s.replace(/[^0-9A-Za-z._-]/g, '_').replace(/\./g, '_');
  return `wfc_${slug(tenantId)}__${slug(childChainId)}__${slug(version)}`;
}

/** A child chain co-registered as its own workflow during parent expansion. */
export interface CoRegisteredChild {
  /** Deterministic minted id (see `mintChildWorkflowId`). */
  childWorkflowId: string;
  /** The composed chain's `chainId`. */
  chainId: string;
  /** The child's own expanded fragment (registered as a standalone workflow). */
  fragment: ExpandedFragment;
}

export interface ChainTreeExpansion {
  /** The parent fragment — every `config.subChainRef` rewritten to the minted
   *  child `config.workflowId`. */
  parent: ExpandedFragment;
  /** Every co-registered child, deduplicated by `childWorkflowId` (a child
   *  referenced twice registers once). */
  children: ReadonlyArray<CoRegisteredChild>;
}

export interface CoExpansionContext {
  /** Unique tag for this parent instantiation — seeds the parent node-id prefix
   *  (per-drop node-id uniqueness). Does NOT seed the child workflow id (that is
   *  tenant-scoped — see `tenantId`). */
  parentExpansionId: string;
  /** The instantiating tenant. The deterministic CHILD workflow id is scoped to
   *  this tenant so two tenants never collide on the global by-id registry
   *  (SECURITY `sub-chain-child-tenant-scoped`) and a child shared across parents
   *  within the tenant dedups to one registration. */
  tenantId: string;
  params: Record<string, unknown>;
  isTypeIdResolvable: (typeId: string) => boolean;
  /** Sibling chains available in the SAME pack, keyed by `chainId`. External
   *  refs (object form) are resolved host-side and supplied here too when the
   *  host wants them co-expanded in-process; a ref absent from this map is
   *  `sub_chain_unresolved`. */
  siblingChains: ReadonlyMap<string, WorkflowChain>;
  /** Recursion bound (default `DEFAULT_MAX_SUB_CHAIN_DEPTH`). */
  maxDepth?: number;
}

/** Collect every distinct `config.subChainRef` reachable from a chain's nodes. */
function subChainRefsInNodes(chain: WorkflowChain): string[] {
  const refs: string[] = [];
  for (const n of chain.dag.nodes) {
    const r = n.config?.['subChainRef'];
    if (typeof r === 'string' && !refs.includes(r)) refs.push(r);
  }
  return refs;
}

/**
 * Co-expand a parent chain and every sub-chain it composes (RFC 0133 §1.3).
 * Resolves each `config.subChainRef` to a sibling chain, recursively co-expands
 * it, mints a deterministic child workflow id, and rewrites the referencing
 * node's `config.subChainRef` → `config.workflowId`. Bounded by a cycle check
 * and `maxDepth`.
 *
 * @throws SubChainUnresolvedError when a ref names no sibling chain.
 * @throws SubChainCycleError on a compose cycle or a depth-bound breach.
 * @throws ChainUnresolvableTypeIdError when any node typeId fails resolution.
 */
export function expandChainTree(
  root: WorkflowChain,
  ctx: CoExpansionContext,
): ChainTreeExpansion {
  const maxDepth = ctx.maxDepth ?? DEFAULT_MAX_SUB_CHAIN_DEPTH;
  const children = new Map<string, CoRegisteredChild>();

  // DFS over the compose graph with an on-stack set for cycle detection.
  const onStack = new Set<string>();

  const expandOne = (chain: WorkflowChain, depth: number): ExpandedFragment => {
    if (depth > maxDepth) {
      throw new SubChainDepthExceededError(chain.chainId, maxDepth);
    }
    if (onStack.has(chain.chainId)) {
      throw new SubChainCycleError(chain.chainId, 'chain transitively composes itself');
    }
    onStack.add(chain.chainId);

    // Validate declared subChains[] resolve, and recurse into each referenced
    // sibling BEFORE rewriting the parent so child ids exist to splice in.
    const declared = new Set((chain.subChains ?? []).map((s) => refChainId(s.ref)));
    for (const ref of subChainRefsInNodes(chain)) {
      // A node ref MUST be a declared subChains[] entry (RFC 0133 §1.2).
      if (!declared.has(ref)) throw new SubChainUnresolvedError(ref, chain.chainId);
      const sibling = ctx.siblingChains.get(ref);
      if (!sibling) throw new SubChainUnresolvedError(ref, chain.chainId);
      // Tenant-scoped, version-pinned deterministic child id (§1.3 step 2).
      const childId = mintChildWorkflowId(ctx.tenantId, ref, sibling.version);
      if (!children.has(childId)) {
        // Recurse first; the child fragment is registered under the minted id.
        const childFragment = expandOne(sibling, depth + 1);
        children.set(childId, { childWorkflowId: childId, chainId: ref, fragment: childFragment });
      }
    }

    // Expand this chain's own fragment (reuses the RFC 0013 algorithm), then
    // rewrite each subChainRef node: `config.subChainRef` → `config.workflowId`
    // (the minted child id the runtime dispatches).
    const expansionId = chain.chainId === root.chainId
      ? ctx.parentExpansionId
      : `${ctx.parentExpansionId}_${chain.chainId.replace(/\./g, '_')}`;
    const fragment = expandChain(chain, {
      expansionId,
      params: ctx.params,
      isTypeIdResolvable: ctx.isTypeIdResolvable,
    });
    const rewrittenNodes = fragment.nodes.map((n) => {
      const ref = (n.config as Record<string, unknown> | undefined)?.['subChainRef'];
      if (typeof ref !== 'string') return n;
      const refVersion = ctx.siblingChains.get(ref)?.version ?? '0.0.0';
      const { subChainRef: _drop, ...restConfig } = n.config as Record<string, unknown>;
      return { ...n, config: { ...restConfig, workflowId: mintChildWorkflowId(ctx.tenantId, ref, refVersion) } };
    });

    onStack.delete(chain.chainId);
    return { nodes: rewrittenNodes, edges: fragment.edges, idMap: fragment.idMap };
  };

  const parent = expandOne(root, 0);
  return { parent, children: [...children.values()] };
}

/** Emit a chain's declared `producedVariables[]` as run-scoped `variables[]`
 *  entries (name + type, NO value) for the expanded `WorkflowDefinition`
 *  (RFC 0133 §2.3). The executor's existing variable bag carries them exactly
 *  as in a hand-authored workflow — no new runtime surface. */
export function emitProducedVariables(
  chain: WorkflowChain,
): ReadonlyArray<{ name: string; type: string }> {
  return (chain.producedVariables ?? []).map((p) => ({ name: p.name, type: p.type }));
}

/** Walk a value for `{ type:"variable", variableName }` input bindings, collecting
 *  every referenced variable name. */
function collectVariableReads(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectVariableReads(v, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj['type'] === 'variable' && typeof obj['variableName'] === 'string') {
      out.add(obj['variableName']);
    }
    for (const v of Object.values(obj)) collectVariableReads(v, out);
  }
}

/**
 * Closed-world validation of a chain's run-variable reads (RFC 0133 §2.2). Every
 * `{ type:"variable", variableName }` binding in any node's `inputs` MUST reference
 * a declared `producedVariables[].name` OR a materialized parameter name. An
 * undeclared read throws `VariableUndeclaredError` — closing the "reads a value
 * nothing produces" hole.
 *
 * @param materializedParams parameter names the host materialized as variables
 *   (deferred mode, RFC 0124); empty for expansion-time substitution.
 * @throws VariableUndeclaredError on the first undeclared variable read.
 */
export function validateVariableReads(
  chain: WorkflowChain,
  materializedParams: ReadonlySet<string> = new Set(),
): void {
  // Disjointness (RFC 0133 §2.2): a producedVariables name MUST NOT collide with a
  // `parameters` property name — the author-time and run-scoped channels are disjoint.
  const paramNames = new Set<string>(materializedParams);
  const paramProps = (chain.parameters as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (paramProps) for (const k of Object.keys(paramProps)) paramNames.add(k);
  for (const p of chain.producedVariables ?? []) {
    if (paramNames.has(p.name)) throw new VariableUndeclaredError(p.name, chain.chainId);
  }

  const declared = new Set<string>(materializedParams);
  for (const p of chain.producedVariables ?? []) declared.add(p.name);
  const reads = new Set<string>();
  for (const n of chain.dag.nodes) {
    if (n.inputs !== undefined) collectVariableReads(n.inputs, reads);
    if (n.config !== undefined) collectVariableReads(n.config, reads);
  }
  for (const name of reads) {
    if (!declared.has(name)) throw new VariableUndeclaredError(name, chain.chainId);
  }
}
