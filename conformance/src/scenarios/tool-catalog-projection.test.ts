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
 * MAJORS [1, 2] since suite 2.36.0 (RFC 0204 G3). `spec/v2/core/tool-catalog.md`
 * restates every v1 MUST this file checks, so the obligation holds at major 2
 * unchanged; what held the file at [1] was the instrument — a `supported` gate
 * (absent by construction at major 2) and hard-coded `/v1/tools` paths. Both now
 * resolve the major (`toolCatalogGate`, `toolsPath`), and the descriptor is
 * validated against `schemas/v2/tool-descriptor.schema.json` at major 2.
 *
 * Leg 5 (advisory, RFC 0204 §D.13 — a SHOULD, no certification row): two reads
 * of the list are identical and sorted by `toolId`. Met ⇒ `executed-pass`; not
 * met ⇒ recorded `inapplicable` with the reason, never failed.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/tool-catalog.md (§B/§F)
 *   - https://github.com/openwop/openwop/blob/main/spec/v2/core/tool-catalog.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0078-portable-tool-catalog-and-tool-session-contract.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { targetMajor } from '../lib/seams.js';
import { v2Validator } from '../lib/v2.js';
import {
  toolCatalogGate,
  toolsPath,
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

/** The ToolDescriptor validator for the major in play. */
function descriptorValidator(): (d: unknown) => { ok: boolean; errors: string } {
  if (targetMajor() === 2) return v2Validator('tool-descriptor');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema('tool-descriptor.schema.json'));
  return (d: unknown) => ({ ok: validate(d) as boolean, errors: ajv.errorsText(validate.errors) });
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
    if (!(await toolCatalogGate('openwop-tool-catalog'))) return;
    const validate = descriptorValidator();

    // ---- Leg 3: auth-gated (unauthenticated list MUST be 401) -------------
    const unauth = await driver.get(toolsPath(), { authenticated: false });
    expect(
      unauth.status === 401,
      req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'tool-catalog.md §B', `GET ${toolsPath()} MUST require authentication (401 unauthenticated)`),
    ).toBe(true);

    // ---- Leg 1: the list (§B) -------------------------------------------
    const tools = await listTools();
    if (tools === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `tools === null` returned early (host advertises the cap but doesn\'t serve the read — soft-skip the rest)'); // host advertises the cap but doesn't serve the read — soft-skip the rest

    for (const t of tools) {
      const v = validate(t);
      expect(
        v.ok,
        req('openwop.it.tool-catalog-projection.lists-schema-valid-tooldescriptors-serves-by-id-404s-is-auth-gated-and-never-dis', 'tool-descriptor.schema.json', `each ToolDescriptor MUST validate (${v.errors})`),
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

  it('advisory (SHOULD): an unchanged catalog reads identically, sorted by toolId', async () => {
    if (!(await toolCatalogGate('openwop-tool-catalog'))) return;
    const a = await listTools();
    const b = await listTools();
    if (a === null || b === null) return softSkip('inapplicable', 'the host advertises the catalog but does not serve the list read');
    const ids = (l: ReadonlyArray<{ toolId?: unknown }>) => l.map((t) => String(t.toolId));
    const first = ids(a); const second = ids(b);
    const sorted = [...first].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    const stable = JSON.stringify(first) === JSON.stringify(second);
    const ordered = JSON.stringify(first) === JSON.stringify(sorted);
    if (!stable || !ordered) {
      return softSkip('inapplicable', `advisory SHOULD not met (RFC 0204 §D.13, tool-catalog.md §The catalog): ${stable ? '' : 'two reads returned different orders; '}${ordered ? '' : 'tools are not sorted by toolId'} — recorded, never failed`);
    }
    expect(stable && ordered, req('openwop.it.tool-catalog-projection.advisory-should-an-unchanged-catalog-reads-identically-sorted-by-toolid', 'spec/v2/core/tool-catalog.md §The catalog (SHOULD)', 'two reads are identical and sorted by toolId')).toBe(true);
  });
});
