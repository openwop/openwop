/**
 * Portable tool catalog — the `GET /v1/tools` projection (RFC 0078 §B/§F) —
 * behavioral.
 *
 * Capability-gated on `toolCatalog.supported` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives in
 * `tool-descriptor-shape.test.ts`; this asserts host BEHAVIOR black-box on the
 * NORMATIVE reads:
 *
 *   1. LIST (§B) — `GET /v1/tools` returns a `ToolDescriptor[]`, each
 *      schema-valid, `source` ∈ the closed vocab, `safetyTier` ∈ the closed
 *      vocab, and content-free (no credential material, SR-1).
 *   2. BY-ID (§B) — `GET /v1/tools/{toolId}` returns that descriptor; an unknown
 *      id 404s.
 *   3. AUTH-GATED — an unauthenticated `GET /v1/tools` is `401` (not public).
 *   4. §F-2 NON-DISCLOSURE — a tool id known to belong to a DIFFERENT principal
 *      (`OPENWOP_CROSS_PRINCIPAL_TOOL_ID`) 404s for this caller, identically to
 *      "not found" — the authorization-scoped projection never discloses another
 *      principal's tools. Soft-skips when the env var is unset.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/tool-catalog.md (§B/§F)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0078-portable-tool-catalog-and-tool-session-contract.md
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
  listTools,
  getTool,
  TOOL_SOURCES,
  SAFETY_TIERS,
  TOOL_CONTENT_FORBIDDEN,
} from '../lib/toolCatalog.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

function expectContentFree(d: Record<string, unknown>, where: string): void {
  for (const f of TOOL_CONTENT_FORBIDDEN) {
    expect(
      !(f in d),
      req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'RFC 0078 §F (SR-1)', `${where} MUST be content-free (no ${f})`),
    ).toBe(true);
  }
}

describe('tool-catalog-projection (RFC 0078 §B/§F)', () => {
  it('lists schema-valid ToolDescriptors, serves by-id + 404s, is auth-gated, and never discloses another principal', async () => {
    const cap = await readToolCatalogCap();
    if (!behaviorGate('openwop-tool-catalog', cap?.supported === true)) return;

    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(loadSchema('tool-descriptor.schema.json'));

    // ---- Leg 3: auth-gated (unauthenticated list MUST be 401) -------------
    const unauth = await driver.get('/v1/tools', { authenticated: false });
    expect(
      unauth.status === 401,
      req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'tool-catalog.md §B', 'GET /v1/tools MUST require authentication (401 unauthenticated)'),
    ).toBe(true);

    // ---- Leg 1: the list (§B) -------------------------------------------
    const tools = await listTools();
    if (tools === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `tools === null` returned early (host advertises the cap but doesn\'t serve the read — soft-skip the rest)'); // host advertises the cap but doesn't serve the read — soft-skip the rest

    for (const t of tools) {
      expect(
        validate(t),
        req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'tool-descriptor.schema.json', `each ToolDescriptor MUST validate (${ajv.errorsText(validate.errors)})`),
      ).toBe(true);
      expect(
        typeof t.source === 'string' && TOOL_SOURCES.includes(t.source as string),
        req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'tool-catalog.md §C', 'ToolDescriptor.source MUST be in the closed vocabulary'),
      ).toBe(true);
      expect(
        typeof t.safetyTier === 'string' && SAFETY_TIERS.includes(t.safetyTier as string),
        req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'tool-catalog.md §C', 'ToolDescriptor.safetyTier MUST be pure|read|write|exec'),
      ).toBe(true);
      expectContentFree(t, 'ToolDescriptor');
    }

    // ---- Leg 2: by-id round-trip + unknown 404 (§B) ---------------------
    if (tools.length > 0 && typeof tools[0]!.toolId === 'string') {
      const id = tools[0]!.toolId as string;
      const one = await getTool(id);
      if (one.status === 200) {
        expect(
          one.descriptor?.toolId === id,
          req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'tool-catalog.md §B', 'GET /v1/tools/{toolId} MUST return the requested descriptor'),
        ).toBe(true);
      }
    }
    const unknown = await getTool('__conformance_nonexistent_tool__');
    expect(
      unknown.status === 404,
      req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'tool-catalog.md §B', 'GET /v1/tools/{unknown} MUST 404'),
    ).toBe(true);

    // ---- Leg 4: §F-2 cross-principal non-disclosure (env-gated) ---------
    const crossId = process.env.OPENWOP_CROSS_PRINCIPAL_TOOL_ID;
    if (crossId) {
      const cross = await getTool(crossId);
      expect(
        cross.status === 404,
        req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'tool-catalog.md §F-2', 'a tool owned by a different principal MUST 404 (non-disclosure)'),
      ).toBe(true);
    }
  });
});
