/**
 * Shared helpers for the RFC 0078 `toolCatalog` conformance scenarios.
 * Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/toolCatalog.js`.
 *
 * Two surfaces:
 *   - the NORMATIVE reads (`GET /v1/tools` + `GET /v1/tools/{toolId}`, RFC 0078
 *     §B), exercised black-box; and
 *   - the host-sample tool-session seam (`POST /v1/host/sample/tools/session-run`),
 *     used to drive the §D `tool.session.{opened,closed}` bracket over the RFC
 *     0064 call events so the ordering + content-free guarantees can be asserted
 *     against the test event-log seam. The seam is OPTIONAL — scenarios soft-skip
 *     on 404/405 (the reference session lifecycle is deferred per RFC 0078
 *     §Conformance).
 *
 * Gating uses the `toolCatalog.supported` (and `toolCatalog.sessionLifecycle`)
 * capability flags from the live discovery doc (root-first per RFC 0073).
 *
 * @see RFCS/0078-portable-tool-catalog-and-tool-session-contract.md
 * @see spec/v1/tool-catalog.md
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';
import { behaviorGate } from './behavior-gate.js';
import { targetMajor } from './seams.js';
import { familyAdvertised } from './v2.js';
import { softSkip } from './soft-skip.js';

/**
 * The catalog path for the major in play (RFC 0204 G3). `GET /tools` is the v2
 * spelling (`spec/v2/path-manifest.json`); the driver never rewrites a `/v1/`
 * address that is not a seam, so a hard-coded `/v1/tools` on a v2 host is a
 * suite 404 reported as a host defect.
 */
export const toolsPath = (suffix = ''): string => `${targetMajor() === 2 ? '' : '/v1'}/tools${suffix}`;

/** Reads `toolCatalog` from discovery (root-first per RFC 0073); null when
 *  unadvertised. At major 2 the record's presence is the claim (RFC 0169 §A.2). */
export async function readToolCatalogCap(): Promise<Record<string, unknown> | null> {
  if (targetMajor() === 2) return familyAdvertised('toolCatalog');
  const tc = await readCapabilityFamily<Record<string, unknown>>('toolCatalog');
  return tc && typeof tc === 'object' ? tc : null;
}

/**
 * The gate the three `tool-catalog-*` files share, major-aware (RFC 0204 G3).
 * Major 1: the v1 `supported` / sub-flag seat through `behaviorGate`, unchanged.
 * Major 2: there is no `supported` field — the record is the claim, a facet is
 * present or absent — and an unadvertised family is recorded `inapplicable`
 * rather than failed under strict mode, so promoting these files to both majors
 * de-certifies no v2 host that never advertised `toolCatalog`.
 * `facet` names the sub-flag (`compactView`) a leg needs, if any.
 */
export async function toolCatalogGate(profile: string, facet?: string): Promise<Record<string, unknown> | null> {
  const cap = await readToolCatalogCap();
  if (targetMajor() === 2) {
    if (cap === null) { softSkip('inapplicable', 'toolCatalog not advertised at major 2 — the host publishes no catalog'); return null; }
    if (facet !== undefined && cap[facet] !== true) { softSkip('inapplicable', `toolCatalog.${facet} not advertised at major 2`); return null; }
    return cap;
  }
  const on = facet === undefined ? cap?.supported === true : cap?.[facet] === true;
  return behaviorGate(profile, on) ? (cap ?? {}) : null;
}

export interface ToolDescriptor {
  toolId?: string;
  source?: string;
  safetyTier?: string;
  [k: string]: unknown;
}

/** GET the NORMATIVE tool catalog (RFC 0078 §B `GET /v1/tools`); null when the
 *  host doesn't serve it (404/405/501). */
export async function listTools(): Promise<ToolDescriptor[] | null> {
  const res = await driver.get(toolsPath());
  if (res.status === 404 || res.status === 405 || res.status === 501) return null;
  return (res.json as ToolDescriptor[] | undefined) ?? [];
}

/** GET one tool by id (RFC 0078 §B `GET /v1/tools/{toolId}`); returns
 *  `{ status, descriptor }` so a caller can distinguish a 404 (absent /
 *  unauthorized / unadvertised) from a served descriptor. */
export async function getTool(
  toolId: string,
): Promise<{ status: number; descriptor: ToolDescriptor | undefined }> {
  const res = await driver.get(toolsPath(`/${encodeURIComponent(toolId)}`));
  return { status: res.status, descriptor: res.json as ToolDescriptor | undefined };
}

export interface ToolSessionResult {
  runId?: string;
  sessionId?: string;
  toolId?: string;
}

/** Drive one tool-session interaction through the host-sample seam (RFC 0078
 *  §D). Persists `tool.session.opened` → RFC 0064 call events → `tool.session.closed`
 *  to the durable run-event log (read back via the run event-log read seam).
 *  Returns null when the seam is unwired (404/405). */
export async function driveToolSession(
  body: { toolId?: string } = {},
): Promise<ToolSessionResult | null> {
  const res = await driver.post('/v1/host/sample/tools/session-run', body);
  if (res.status === 404 || res.status === 405) return null;
  return (res.json as ToolSessionResult | undefined) ?? {};
}

/** A compact descriptor (RFC 0112) — the lossy `?view=compact` projection.
 *  Closed field set: `toolId`/`source`/`safetyTier` (+ optional
 *  `title`/`description`/`inputSchema`). The index signature lets a scenario
 *  assert the heavy fields are ABSENT without a cast. */
export interface CompactToolDescriptor {
  toolId?: string;
  source?: string;
  safetyTier?: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  [k: string]: unknown;
}

/** GET the compact tool catalog (RFC 0112 `GET /v1/tools?view=compact`).
 *  Returns the `{ tools: CompactToolDescriptor[] }` envelope's `tools` array;
 *  null when the host doesn't serve the read (404/405/501) or the body isn't
 *  the expected envelope shape. */
export async function listToolsCompact(): Promise<CompactToolDescriptor[] | null> {
  const res = await driver.get(toolsPath('?view=compact'));
  if (res.status === 404 || res.status === 405 || res.status === 501) return null;
  const body = res.json;
  if (!body || typeof body !== 'object') return null;
  const tools = (body as { tools?: unknown }).tools;
  return Array.isArray(tools) ? (tools as CompactToolDescriptor[]) : null;
}

/** Heavy `ToolDescriptor` fields that a `CompactToolDescriptor` MUST drop
 *  (RFC 0112). */
export const COMPACT_DROPPED_FIELDS = [
  'outputSchema',
  'auth',
  'egress',
  'approval',
  'replayPolicy',
  'costHint',
  'latencyHint',
];

/** JSON-Schema keywords a compact `inputSchema` MUST NOT use (RFC 0112 compact
 *  structural subset). */
export const COMPACT_INPUT_SCHEMA_BANNED = [
  '$ref',
  'oneOf',
  'allOf',
  'anyOf',
  'not',
  'patternProperties',
  'dependentSchemas',
];

/** Schema-bearing keywords whose VALUES are subschemas the compact subset still
 *  permits (object/array nesting). We recurse into these — but NOT into property
 *  *names* — so a tool field literally named `oneOf` is not a false positive. */
const COMPACT_SUBSCHEMA_KEYWORDS = ['items', 'additionalProperties', 'contains', 'propertyNames'];

/** Recursively searches a compact `inputSchema` for any banned keyword in SCHEMA
 *  position at ANY nesting depth (RFC 0112's structural subset is total, not just
 *  top-level — a nested `oneOf`/`$ref` is exactly the verbosity the compact view
 *  exists to drop). Schema-aware: it checks keywords in schema position and
 *  recurses only into subschema-bearing positions (`properties` values, `items`,
 *  `additionalProperties`, `prefixItems`, …), never treating a property NAME as a
 *  keyword. Returns the first offending keyword, or null when clean. */
export function findBannedInputSchemaKeyword(schema: unknown): string | null {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
  const obj = schema as Record<string, unknown>;
  for (const kw of COMPACT_INPUT_SCHEMA_BANNED) {
    if (kw in obj) return kw;
  }
  const props = obj.properties;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const sub of Object.values(props as Record<string, unknown>)) {
      const hit = findBannedInputSchemaKeyword(sub);
      if (hit) return hit;
    }
  }
  for (const key of COMPACT_SUBSCHEMA_KEYWORDS) {
    const hit = findBannedInputSchemaKeyword(obj[key]);
    if (hit) return hit;
  }
  if (Array.isArray(obj.prefixItems)) {
    for (const sub of obj.prefixItems) {
      const hit = findBannedInputSchemaKeyword(sub);
      if (hit) return hit;
    }
  }
  return null;
}

/** The closed tool-source vocabulary (RFC 0078 §C). */
export const TOOL_SOURCES = ['node-pack', 'workflow', 'mcp', 'connector', 'host-extension'];
/** The closed safety-tier vocabulary (RFC 0078 §C). */
export const SAFETY_TIERS = ['pure', 'read', 'write', 'exec'];
/** Content keys a `ToolDescriptor` / `tool.session.*` MUST NEVER carry (SR-1):
 *  no credential/secret material. */
export const TOOL_CONTENT_FORBIDDEN = ['secret', 'credential', 'credentials', 'token', 'apiKey', 'password'];

/**
 * RFC 0204 §D.12 (`spec/v2/core/tool-catalog.md` §The descriptor): the four MCP
 * hints as a function of the descriptor's OWN host-assigned fields — never of
 * MCP's defaults (`destructiveHint` and `openWorldHint` default to `true`
 * upstream) and never of anything a server said.
 */
export function expectedAnnotations(d: ToolDescriptor): Record<'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint', boolean> {
  const tier = d.safetyTier;
  const rp = d['replayPolicy'];
  return {
    readOnlyHint: tier === 'pure' || tier === 'read',
    destructiveHint: tier === 'write' || tier === 'exec',
    idempotentHint: rp === 'deterministic' || rp === 'idempotent',
    openWorldHint: d['egress'] !== 'none',
  };
}
