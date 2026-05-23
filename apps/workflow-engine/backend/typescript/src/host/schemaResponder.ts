/**
 * Schema-request responder. When the LLM emits a `schema.request`
 * envelope asking for one or more node-type schemas by name, this
 * module looks them up against the in-process NodeRegistry and
 * builds a matching `schema.response` envelope.
 *
 * Mirrors myndhyve's `SchemaLibraryService.getPack()` pattern — when
 * the registry has more node types than fit comfortably in a system
 * prompt, the LLM asks for what it needs; the host answers with
 * structured schemas; the next turn injects the response so the LLM
 * can continue with the schemas in context.
 *
 * Pure function. The chat executor (sampleChatResponderNode) detects
 * a `schema.request` in the LLM's completion text, calls this
 * builder, and emits both envelopes as `agent.envelope` events so
 * the FE EnvelopeInspector can render the round-trip inline.
 *
 * Schema library source: the backend's NodeRegistry (`getNodeRegistry().listTypeIds()`)
 * — same source as `GET /v1/host/sample/node-catalog`, which is the
 * canonical machine-readable inventory of node types this host knows.
 */

import { createHash } from 'node:crypto';
import { getNodeRegistry } from '../executor/nodeRegistry.js';

export interface SchemaRequestPayload {
  /** Node-type names the LLM is asking for. Canonicalized to array by
   *  the envelopeNormalizers registry before this responder runs. */
  names: string[];
  /** Optional context the LLM supplies so the host can rank fuzzy
   *  matches when an exact match isn't found. Free-form. */
  context?: string;
}

export interface NodeTypeSchemaSummary {
  typeId: string;
  /** Canonical kind name (the catalog-level identifier, e.g. "mock-ai",
   *  "approval"). May equal the trailing segment of typeId. */
  kind: string;
  /** Input port descriptors. Shape: { name: string, type: string }. */
  inputs: Array<{ name: string; type: string }>;
  /** Output port descriptors. */
  outputs: Array<{ name: string; type: string }>;
  /** When the node has a configSchema declared in its NodeModule,
   *  reproduced here so the LLM can compose a valid config. Omitted
   *  when no config surface is declared. */
  configSchema?: Record<string, unknown>;
}

export interface SchemaResponsePayload {
  /** Schemas the host could resolve. */
  schemas: NodeTypeSchemaSummary[];
  /** Names the host could NOT resolve. The LLM should treat these as
   *  "not available on this host" and either pick from `schemas` or
   *  emit a clarification.request. */
  notFound: string[];
  /** Optional bundle version so the LLM can cache responses across
   *  turns when the same names are requested. Sample uses the
   *  registry's listed typeIds.length as a coarse fingerprint. */
  bundleVersion: string;
}

/** Build a schema.response payload for the given request. Looks up
 *  each requested name in the in-process NodeRegistry; falls back to
 *  case-insensitive + trailing-segment matching to absorb common LLM
 *  drift (e.g., the model asks for "MockAi" instead of "mock-ai"). */
export function buildSchemaResponse(req: SchemaRequestPayload): SchemaResponsePayload {
  const registry = getNodeRegistry();
  const allTypeIds = registry.listTypeIds();
  const allKinds = new Set<string>(allTypeIds.map(tailSegment));

  const schemas: NodeTypeSchemaSummary[] = [];
  const notFound: string[] = [];

  for (const requestedName of req.names) {
    if (typeof requestedName !== 'string' || requestedName.length === 0) {
      continue;
    }
    const resolved = resolveTypeId(requestedName, allTypeIds, allKinds);
    if (!resolved) {
      notFound.push(requestedName);
      continue;
    }
    const node = registry.get(resolved);
    if (!node) {
      // Registry listed the typeId but couldn't materialize the module
      // (pack-resolver dependency missing) — surface as notFound so
      // the LLM doesn't waste a turn pretending it has the schema.
      notFound.push(requestedName);
      continue;
    }
    schemas.push({
      typeId: resolved,
      kind: tailSegment(resolved),
      inputs: extractPorts(node, 'inputs'),
      outputs: extractPorts(node, 'outputs'),
      ...(extractConfigSchema(node) ? { configSchema: extractConfigSchema(node) as Record<string, unknown> } : {}),
    });
  }

  // Bundle version: 8-char prefix of sha256(sorted typeIds joined by
  // newline). Identifies the exact set of types this host knows, not
  // just the count — two registries with the same length but different
  // members yield distinct bundleVersions so caches can't accidentally
  // serve stale schemas.
  return {
    schemas,
    notFound,
    bundleVersion: hashTypeIds(allTypeIds),
  };
}

function hashTypeIds(typeIds: readonly string[]): string {
  const joined = [...typeIds].sort().join('\n');
  return `registry-${createHash('sha256').update(joined).digest('hex').slice(0, 12)}`;
}

/** Resolve a user-supplied name to a canonical typeId. Tries exact
 *  match first, then trailing-segment match (e.g., "mock-ai" matches
 *  "local.sample.demo.mock-ai"), then case-insensitive. */
function resolveTypeId(
  name: string,
  allTypeIds: readonly string[],
  allKinds: ReadonlySet<string>,
): string | null {
  if (allTypeIds.includes(name)) return name;
  // Trailing-segment match: "mock-ai" → "local.sample.demo.mock-ai"
  if (allKinds.has(name)) {
    const match = allTypeIds.find((id) => tailSegment(id) === name);
    if (match) return match;
  }
  // Case-insensitive trailing-segment match (absorbs "MockAi", "mock_ai", etc.)
  const lower = name.toLowerCase().replace(/[-_]/g, '');
  const ciMatch = allTypeIds.find((id) => tailSegment(id).toLowerCase().replace(/[-_]/g, '') === lower);
  return ciMatch ?? null;
}

function tailSegment(typeId: string): string {
  const idx = typeId.lastIndexOf('.');
  return idx >= 0 ? typeId.slice(idx + 1) : typeId;
}

// The NodeModule type carries ports + configSchema in different
// shapes depending on the pack manifest version. Both extractors are
// defensive — they tolerate the canonical shape AND legacy shapes
// without throwing.

function extractPorts(node: unknown, key: 'inputs' | 'outputs'): Array<{ name: string; type: string }> {
  const rec = node as Record<string, unknown>;
  const raw = rec[key];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is { name?: unknown; type?: unknown } => !!p && typeof p === 'object')
    .map((p) => ({
      name: typeof p.name === 'string' ? p.name : 'in',
      type: typeof p.type === 'string' ? p.type : 'any',
    }));
}

function extractConfigSchema(node: unknown): Record<string, unknown> | null {
  const rec = node as Record<string, unknown>;
  const raw = rec.configSchema;
  if (!raw || typeof raw !== 'object') return null;
  return raw as Record<string, unknown>;
}
