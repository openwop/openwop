/**
 * tool-descriptor-annotations — RFC 0204 §D.12 (corpus coherence).
 *
 * `schemas/v2/tool-descriptor.schema.json` carries the MCP `ToolAnnotations`
 * projection table as eight `if`/`then` clauses, so a descriptor whose
 * `annotations` disagree with its own `safetyTier` / `replayPolicy` / `egress`
 * fails validation, not only the behavioural scenario. This walks the whole
 * input space — 4 tiers × 4 replay postures (absent + 3) × 5 egress postures
 * (absent + 4) = 80 descriptors — and for each one:
 *
 *   - the descriptor with the table's annotations validates;
 *   - flipping any single hint is refused (4 negatives each);
 *   - omitting any single hint is refused (so no consumer falls through to an
 *     MCP default: `destructiveHint` and `openWorldHint` default to `true`);
 *   - `annotations.title` is refused (the closed object; `title` is the
 *     descriptor's own display name).
 *
 * and a descriptor with no `annotations` still validates (the field is
 * optional; §D.12 binds only a host that publishes it).
 *
 * Runs in the corpus gate (scripts/check-spec-coherence.mjs), never in a host
 * bundle; `evidence/corpus-ledger.json` carries
 * `openwop.requirement.0204.annotations-schema`.
 *
 * Sabotage, each run once when this file landed: delete any one of the eight
 * clauses; drop `required` on `annotations`; open `additionalProperties` — each
 * turns the row red.
 *
 * @see RFCS/0204-host-mcp-client-returns-mcp-results.md §D.12
 * @see spec/v2/core/tool-catalog.md §The descriptor
 */

import { describe, it, expect } from 'vitest';
import { v2Validator } from '../lib/v2.js';
import { expectedAnnotations, type ToolDescriptor } from '../lib/toolCatalog.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0204.annotations-schema';
const SECTION = 'RFC 0204 §D.12; schemas/v2/tool-descriptor.schema.json allOf';
const TIERS = ['pure', 'read', 'write', 'exec'] as const;
const REPLAY = [undefined, 'deterministic', 'idempotent', 'non-deterministic'] as const;
const EGRESS = [undefined, 'none', 'safe-fetch', 'host-mediated', 'host-owned'] as const;
const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

function descriptors(): ToolDescriptor[] {
  const out: ToolDescriptor[] = [];
  for (const safetyTier of TIERS) for (const replayPolicy of REPLAY) for (const egress of EGRESS) {
    const d: ToolDescriptor = { toolId: `x-host-conformance.t-${safetyTier}-${replayPolicy ?? 'none'}-${egress ?? 'none'}`, source: safetyTier === 'exec' ? 'host-extension' : 'mcp', safetyTier };
    if (replayPolicy !== undefined) d['replayPolicy'] = replayPolicy;
    if (egress !== undefined) d['egress'] = egress;
    out.push(d);
  }
  return out;
}

describe('RFC 0204 §D.12 — the annotation table is enforced by the descriptor schema', () => {
  const validate = v2Validator('tool-descriptor');

  it('accepts exactly the derived annotations over the whole input space and refuses every deviation', () => {
    const all = descriptors();
    expect(all.length).toBe(80);
    for (const d of all) {
      const bare = validate(d);
      expect(bare.ok, req(ID, SECTION, `a descriptor without annotations MUST still validate (${String(d.toolId)}: ${bare.errors})`)).toBe(true);
      const want = expectedAnnotations(d);
      const good = validate({ ...d, annotations: want });
      expect(good.ok, req(ID, SECTION, `${String(d.toolId)}: the table's annotations ${JSON.stringify(want)} MUST validate (${good.errors})`)).toBe(true);
      for (const h of HINTS) {
        expect(validate({ ...d, annotations: { ...want, [h]: !want[h] } }).ok, req(ID, SECTION, `${String(d.toolId)}: ${h}: ${String(!want[h])} contradicts the table and MUST be refused`)).toBe(false);
        const missing: Record<string, boolean> = { ...want }; delete missing[h];
        expect(validate({ ...d, annotations: missing }).ok, req(ID, SECTION, `${String(d.toolId)}: annotations without ${h} MUST be refused (all four are REQUIRED; no MCP default may fill it)`)).toBe(false);
      }
      expect(validate({ ...d, annotations: { ...want, title: 'x' } }).ok, req(ID, SECTION, `${String(d.toolId)}: annotations.title MUST be refused (closed object)`)).toBe(false);
    }
  });

  it('the negative example the RFC names is refused: a write tool claiming readOnlyHint', () => {
    const d = { toolId: 'mcp:conformance/readonly-claim', source: 'mcp', safetyTier: 'write', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true } };
    expect(validate(d).ok, req(ID, SECTION, 'a write descriptor carrying readOnlyHint: true MUST fail validation (RFC 0204 negative example)')).toBe(false);
  });
});
