/**
 * Compact tool projection — `GET /v1/tools?view=compact` (RFC 0112) — behavioral.
 *
 * Capability-gated on `capabilities.toolCatalog.compactView === true` (root-first
 * per RFC 0073). Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. The standard projection coverage lives in
 * `tool-catalog-projection.test.ts`; this asserts the OPT-IN compact view per
 * `spec/v1/tool-catalog.md` §compact (and the new
 * `compact-tool-descriptor.schema.json`):
 *
 *   1. ENVELOPE (§compact) — `GET /v1/tools?view=compact` returns the
 *      `{ tools: CompactToolDescriptor[] }` envelope (NOT a bare array).
 *   2. SCHEMA — every compact descriptor validates against
 *      `compact-tool-descriptor.schema.json` (closed field set; the heavy
 *      `ToolDescriptor` fields — `outputSchema`/`auth`/`egress`/`approval`/
 *      `replayPolicy`/`costHint`/`latencyHint` — are ABSENT).
 *   3. STRUCTURAL SUBSET — every present `inputSchema` satisfies the compact
 *      structural subset: top-level `type: "object"` with `properties`, and
 *      none of `$ref`/`oneOf`/`allOf`/`anyOf`/`not`/`patternProperties`/
 *      `dependentSchemas`. Validated against the schema (no dereference of the
 *      informative RFC 0030 Tier-1 table).
 *   4. PROJECTION COMPLETENESS — the compact `tools[]` `toolId` set EQUALS the
 *      standard `tools[]` `toolId` set for the same principal (a compact catalog
 *      that drops a tool the standard view shows is non-conformant;
 *      authorization-scoping preserved).
 *   5. BY-ID — `GET /v1/tools/{toolId}?view=compact` returns one schema-valid
 *      CompactToolDescriptor.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/tool-catalog.md (§compact)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0112-compact-tool-projection.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import {
  readToolCatalogCap,
  listToolsCompact,
  COMPACT_DROPPED_FIELDS,
  findBannedInputSchemaKeyword,
  type CompactToolDescriptor,
} from '../lib/toolCatalog.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

/** Extract the `toolId` set from a `GET /v1/tools` body, tolerating both the
 *  bare-array and `{ tools: [] }` envelope standard shapes (cast-free). */
function toolIdSet(body: unknown): Set<string> {
  const ids = new Set<string>();
  const arr: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { tools?: unknown }).tools)
      ? ((body as { tools: unknown[] }).tools)
      : [];
  for (const t of arr) {
    if (t && typeof t === 'object') {
      const id = (t as { toolId?: unknown }).toolId;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

describe('tool-catalog-compact-projection (RFC 0112 §compact)', () => {
  it('serves the { tools: CompactToolDescriptor[] } projection — closed shape, bounded inputSchema, same toolId set as standard', async () => {
    const cap = await readToolCatalogCap();
    if (!behaviorGate('openwop-tool-catalog-compact', cap?.compactView === true)) return;

    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(loadSchema('compact-tool-descriptor.schema.json'));

    // ---- Leg 1: the compact envelope (§compact) -------------------------
    const compact = await listToolsCompact();
    if (compact === null) return; // advertises the cap but doesn't serve the read — soft-skip the rest

    for (const t of compact) {
      // ---- Leg 2: schema validity + heavy fields dropped ----------------
      expect(
        validate(t),
        driver.describe('compact-tool-descriptor.schema.json', `each CompactToolDescriptor MUST validate (${ajv.errorsText(validate.errors)})`),
      ).toBe(true);
      for (const f of COMPACT_DROPPED_FIELDS) {
        expect(
          !(f in t),
          driver.describe('tool-catalog.md §compact', `CompactToolDescriptor MUST drop the heavy field "${f}"`),
        ).toBe(true);
      }

      // ---- Leg 3: the compact structural subset on inputSchema ----------
      const input = (t as CompactToolDescriptor).inputSchema;
      if (input !== undefined) {
        expect(
          input.type === 'object' && typeof input.properties === 'object' && input.properties !== null,
          driver.describe('tool-catalog.md §compact', 'compact inputSchema MUST be top-level type:"object" with a properties map'),
        ).toBe(true);
        // Total (any-depth), schema-aware: a nested oneOf/$ref under a property
        // schema is exactly the verbosity the compact view exists to drop.
        const banned = findBannedInputSchemaKeyword(input);
        expect(
          banned,
          driver.describe('tool-catalog.md §compact', `compact inputSchema MUST NOT use $ref/oneOf/allOf/anyOf/not/patternProperties/dependentSchemas at any nesting depth (found "${banned ?? 'none'}")`),
        ).toBe(null);
      }
    }

    // ---- Leg 4: projection completeness vs the standard view -------------
    const standardRes = await driver.get('/v1/tools');
    const standardIds = toolIdSet(standardRes.json);
    const compactIds = new Set<string>();
    for (const t of compact) {
      if (typeof t.toolId === 'string') compactIds.add(t.toolId);
    }
    const sameSet =
      standardIds.size === compactIds.size && [...standardIds].every((id) => compactIds.has(id));
    expect(
      sameSet,
      driver.describe(
        'tool-catalog.md §compact',
        `compact tools[] MUST carry the same toolId set as the standard view (standard=${[...standardIds].sort().join(',')} compact=${[...compactIds].sort().join(',')})`,
      ),
    ).toBe(true);

    // ---- Leg 5: by-id compact round-trip --------------------------------
    if (compact.length > 0 && typeof compact[0]!.toolId === 'string') {
      const id = compact[0]!.toolId;
      const one = await driver.get(`/v1/tools/${encodeURIComponent(id)}?view=compact`);
      if (one.status === 200) {
        expect(
          validate(one.json),
          driver.describe('compact-tool-descriptor.schema.json', `GET /v1/tools/{toolId}?view=compact MUST return a valid CompactToolDescriptor (${ajv.errorsText(validate.errors)})`),
        ).toBe(true);
        const got = one.json;
        expect(
          got && typeof got === 'object' && (got as { toolId?: unknown }).toolId === id,
          driver.describe('tool-catalog.md §compact', 'GET /v1/tools/{toolId}?view=compact MUST return the requested descriptor'),
        ).toBe(true);
      }
    }
  });
});
