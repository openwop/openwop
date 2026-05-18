/**
 * In-memory host implementation of workflow-chain pack expansion
 * (RFC 0013 Phase 3 — `workflow-chain-packs.md` §"Expansion semantics").
 *
 * Wraps the spec-authoritative `expandChain()` algorithm with the
 * host-specific I/O the spec deliberately leaves to implementers:
 *
 *   - Step 1: registry resolution (filesystem mirror, configured via
 *             OPENWOP_PACK_REGISTRY_DIR)
 *   - Step 2: signature verification (Ed25519 over canonical pack.json
 *             bytes, per `node-packs.md` §Signing — chain packs reuse
 *             the node-pack signing recipe verbatim per the
 *             workflow-chain-pack-signature-verification scenario)
 *   - Step 4: parameter validation (caller-side — the conformance
 *             scenarios pre-validate; this handler accepts pre-
 *             validated params and runs literal substitution only)
 *
 * The pure expansion logic (steps 3 + 5 + 6 + 8 of the algorithm) is
 * a verbatim copy of `conformance/src/lib/workflow-chain-expansion.ts`.
 * That conformance copy is spec-authoritative (the server-free
 * scenarios exercise it directly). This copy exists because the
 * in-memory host has a zero-runtime-deps policy and can't import
 * from the conformance package. The `workflow-chain-host-expansion`
 * conformance scenario asserts the two implementations stay in sync
 * by comparing the live-host's response against the conformance lib's
 * direct output for the same input.
 *
 * @see spec/v1/workflow-chain-packs.md §"Expansion semantics (normative)"
 * @see conformance/src/lib/workflow-chain-expansion.ts
 * @see RFCS/0013-workflow-chain-packs.md
 */

import { createVerify, createPublicKey, randomBytes } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

// ─── Wire types (mirror conformance/src/lib/workflow-chain-expansion.ts) ─

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

export interface FragmentEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface ExpansionContext {
  expansionId: string;
  params: Record<string, unknown>;
  isTypeIdResolvable: (typeId: string) => boolean;
}

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
  edges: ReadonlyArray<{ from: string; to: string; condition?: string }>;
  idMap: ReadonlyMap<string, string>;
}

// ─── Pure algorithm (verbatim from conformance/src/lib/) ───────────────

export class ChainUnresolvableTypeIdError extends Error {
  readonly code = 'chain_unresolvable_typeid';
  constructor(readonly typeId: string, readonly chainId: string) {
    super(`chain_unresolvable_typeid: '${typeId}' in chain '${chainId}'`);
    this.name = 'ChainUnresolvableTypeIdError';
  }
}

const PARAM_PATTERN = /\{\{params\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

function substitute(value: unknown, params: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(PARAM_PATTERN, (_match, name: string) => {
      const v = params[name];
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

function rewriteEdgeRef(ref: string, fragmentNodeIds: ReadonlySet<string>, prefix: string): string {
  const dotIdx = ref.indexOf('.');
  const nodeId = dotIdx === -1 ? ref : ref.slice(0, dotIdx);
  const portPart = dotIdx === -1 ? '' : ref.slice(dotIdx);
  return fragmentNodeIds.has(nodeId) ? `${prefix}${nodeId}${portPart}` : ref;
}

function computePrefix(chainId: string, expansionId: string): string {
  return `${chainId.replace(/\./g, '_')}_${expansionId}_`;
}

export function expandChain(chain: WorkflowChain, ctx: ExpansionContext): ExpandedFragment {
  for (const node of chain.dag.nodes) {
    if (!ctx.isTypeIdResolvable(node.typeId)) {
      throw new ChainUnresolvableTypeIdError(node.typeId, chain.chainId);
    }
  }
  const prefix = computePrefix(chain.chainId, ctx.expansionId);
  const fragmentNodeIds = new Set(chain.dag.nodes.map((n) => n.id));
  const idMap = new Map<string, string>();
  for (const id of fragmentNodeIds) idMap.set(id, `${prefix}${id}`);

  const expandedNodes = chain.dag.nodes.map((n) => {
    const out: ExpandedFragment['nodes'][number] = {
      id: `${prefix}${n.id}`,
      typeId: n.typeId,
    };
    if (n.name !== undefined) out.name = n.name;
    if (n.position !== undefined) out.position = n.position;
    if (n.config !== undefined) out.config = substitute(n.config, ctx.params) as Record<string, unknown>;
    if (n.inputs !== undefined) out.inputs = substitute(n.inputs, ctx.params) as Record<string, unknown>;
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
    return out;
  });

  return { nodes: expandedNodes, edges: expandedEdges, idMap };
}

// ─── Host-side I/O wrapper ──────────────────────────────────────────────

/**
 * Errors the host-side wrapper raises. Each carries a wire-level
 * `code` matching `workflow-chain-packs.md` §"Error codes" + node-packs
 * §"Registry HTTP API" so the JSON response body is self-explanatory.
 */
export class WorkflowChainExpansionError extends Error {
  constructor(
    public readonly code:
      | 'pack_not_found'
      | 'pack_manifest_invalid'
      | 'pack_kind_invalid'
      | 'pack_signature_invalid'
      | 'pack_signature_unverifiable'
      | 'chain_not_found'
      | 'chain_unresolvable_typeid'
      | 'invalid_request',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(`${code}: ${message}`);
    this.name = 'WorkflowChainExpansionError';
  }
}

interface PackManifest {
  name: string;
  version: string;
  kind?: 'node' | 'workflow-chain';
  chains?: WorkflowChain[];
  nodes?: unknown[];
}

interface PackSources {
  manifestBytes: Buffer;
  manifest: PackManifest;
  signatureBytes: Buffer | null;
  publicKeyPem: string | null;
}

/**
 * Locate a pack within the registry mirror by `manifest.name`. The
 * mirror's directory naming is free-form (e.g., the in-tree
 * `examples/packs/` uses short dirnames like `workflow-chain-sample`
 * while production registries publish under fully-qualified
 * `<scope>.<name>/` directories) — so this scan reads each top-level
 * `pack.json` to find one whose `name` field matches.
 */
async function findPackDir(registryDir: string, packName: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(registryDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = join(registryDir, entry);
    let isDir = false;
    try { isDir = (await stat(candidate)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    let manifestText: string;
    try {
      manifestText = (await readFile(join(candidate, 'pack.json'))).toString('utf8');
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(manifestText) as { name?: string };
      if (parsed.name === packName) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Load a pack manifest from the registry mirror. The pack's directory
 * is located by matching `manifest.name` (not directory name) — see
 * `findPackDir`. Optional sibling `pack.json.sig` + `pack.json.sig.pub`
 * carry the Ed25519 signature + public key for verification.
 *
 * The in-memory host treats packs without a `pack.json.sig` as
 * "local-trust" (a sample-host concession — production deployers MUST
 * require signatures per `node-packs.md §"Verification flow"`). The
 * conformance scenarios exercise both paths.
 */
async function loadPackSources(registryDir: string, packName: string): Promise<PackSources> {
  const packDir = await findPackDir(registryDir, packName);
  if (packDir === null) {
    throw new WorkflowChainExpansionError(
      'pack_not_found',
      `Pack '${packName}' not found under registry dir.`,
      { registryDir, packName },
    );
  }
  const manifestBytes = await readFile(join(packDir, 'pack.json'));
  let manifest: PackManifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8')) as PackManifest;
  } catch (err) {
    throw new WorkflowChainExpansionError(
      'pack_manifest_invalid',
      `pack.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { packName },
    );
  }

  // Optional signature side-files.
  let signatureBytes: Buffer | null = null;
  let publicKeyPem: string | null = null;
  try {
    signatureBytes = await readFile(join(packDir, 'pack.json.sig'));
    publicKeyPem = (await readFile(join(packDir, 'pack.json.sig.pub'))).toString('utf8');
  } catch {
    // No signature side-files — sample-host trust. Production hosts
    // would refuse here per node-packs.md §"Verification flow".
  }

  return { manifestBytes, manifest, signatureBytes, publicKeyPem };
}

/**
 * Verify an Ed25519 signature over the canonical pack.json bytes per
 * `node-packs.md §Signing`. Workflow-chain packs reuse this recipe
 * verbatim (per `workflow-chain-packs.md §"Expansion semantics"
 * step 2`). Throws `pack_signature_invalid` on mismatch.
 */
function verifyPackSignature(sources: PackSources): void {
  if (sources.signatureBytes === null || sources.publicKeyPem === null) return;
  try {
    const verify = createVerify('SHA512');
    verify.update(sources.manifestBytes);
    verify.end();
    const publicKey = createPublicKey(sources.publicKeyPem);
    const ok = verify.verify(publicKey, sources.signatureBytes);
    if (!ok) {
      throw new WorkflowChainExpansionError(
        'pack_signature_invalid',
        `Ed25519 signature verification failed for pack '${sources.manifest.name}'`,
      );
    }
  } catch (err) {
    if (err instanceof WorkflowChainExpansionError) throw err;
    throw new WorkflowChainExpansionError(
      'pack_signature_unverifiable',
      `Failed to verify signature: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface ExpandFromRegistryInput {
  registryDir: string;
  packName: string;
  version?: string;
  chainId: string;
  parameters: Record<string, unknown>;
  /** Predicate the caller controls. Defaults to allowing every typeId
   *  (the in-memory host's runtime is fixture-only, so cross-host typeId
   *  reachability is a separate concern). Production hosts SHOULD pass
   *  a predicate backed by their actual node registry. */
  isTypeIdResolvable?: (typeId: string) => boolean;
  /** Override the per-expansion id suffix (used by tests for stability;
   *  defaults to 4 random hex chars per the spec's "expansionId" note). */
  expansionId?: string;
}

export interface ExpandFromRegistryOutput {
  expansionId: string;
  chainId: string;
  packName: string;
  packVersion: string;
  nodes: ExpandedFragment['nodes'];
  edges: ExpandedFragment['edges'];
}

/**
 * The full host-side expansion flow: load, verify, locate, expand.
 *
 * Throws `WorkflowChainExpansionError` with a typed `code` for every
 * failure mode the spec enumerates. Callers (HTTP handlers, test
 * scaffolds) map the code to HTTP status (404 for *_not_found, 422
 * for *_invalid / unresolvable, 500 for unverifiable).
 */
export async function expandChainFromRegistry(
  input: ExpandFromRegistryInput,
): Promise<ExpandFromRegistryOutput> {
  const sources = await loadPackSources(input.registryDir, input.packName);

  if (sources.manifest.kind !== 'workflow-chain') {
    throw new WorkflowChainExpansionError(
      'pack_kind_invalid',
      `Pack '${input.packName}' has kind '${sources.manifest.kind ?? 'node'}', not 'workflow-chain'.`,
      { packName: input.packName, kind: sources.manifest.kind ?? 'node' },
    );
  }
  if (!Array.isArray(sources.manifest.chains) || sources.manifest.chains.length === 0) {
    throw new WorkflowChainExpansionError(
      'pack_manifest_invalid',
      `Pack '${input.packName}' has no chains[].`,
    );
  }
  if (input.version !== undefined && sources.manifest.version !== input.version) {
    throw new WorkflowChainExpansionError(
      'pack_manifest_invalid',
      `Pack version mismatch: requested '${input.version}', got '${sources.manifest.version}'.`,
      { requested: input.version, actual: sources.manifest.version },
    );
  }

  verifyPackSignature(sources);

  const chain = sources.manifest.chains.find((c) => c.chainId === input.chainId);
  if (!chain) {
    throw new WorkflowChainExpansionError(
      'chain_not_found',
      `Chain '${input.chainId}' not found in pack '${input.packName}@${sources.manifest.version}'.`,
      { availableChainIds: sources.manifest.chains.map((c) => c.chainId) },
    );
  }

  const expansionId = input.expansionId ?? randomBytes(2).toString('hex');
  const isTypeIdResolvable = input.isTypeIdResolvable ?? (() => true);
  const fragment = expandChain(chain, {
    expansionId,
    params: input.parameters,
    isTypeIdResolvable,
  });

  return {
    expansionId,
    chainId: input.chainId,
    packName: sources.manifest.name,
    packVersion: sources.manifest.version,
    nodes: fragment.nodes,
    edges: fragment.edges,
  };
}
