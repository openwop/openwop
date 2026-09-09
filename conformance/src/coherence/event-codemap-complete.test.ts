/**
 * event-codemap-complete — corpus coherence for `spec/v1/event-codemap.json`
 * (v2 charter C.4 / C.9, Phase 1 item 9).
 *
 * The codemap is the v1→v2 event-type translation AS DATA: one row per
 * `RunEventType`, its payload `$def`, and a proposed v2 name. This scenario
 * reads `spec/v1/` and asserts nothing about a host — it is a
 * SPEC_COHERENCE_SCENARIO, gates on `V1_DIR`, and does not ship in the tarball.
 * What it holds: every enum member has exactly one row, every row's type is in
 * the enum, every payload $def exists, every v2 name is unique and matches the
 * charter's grammar (`domain.verb-ed`, kebab, two segments), and no v2 name
 * uses the reserved `core.` prefix the vendor regex bans.
 *
 * @see spec/v1/event-codemap.json
 * @see scripts/generate-event-codemap.mjs
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

interface Row {
  v1: string;
  v2: string;
  payloadDef: string | null;
  status: string;
  review: boolean;
}
interface Codemap {
  grammar: string;
  rows: Row[];
}

const CODEMAP = V1_DIR === null ? null : join(V1_DIR, 'event-codemap.json');

describe.skipIf(CODEMAP === null || !existsSync(CODEMAP))('event-codemap-complete: spec/v1/event-codemap.json ↔ run-event.schema.json (corpus coherence)', () => {
  const map = JSON.parse(readFileSync(CODEMAP as string, 'utf8')) as Codemap;
  const enumTypes = (JSON.parse(readFileSync(join(SCHEMAS_DIR, 'run-event.schema.json'), 'utf8')) as { $defs: { RunEventType: { enum: string[] } } }).$defs.RunEventType.enum;
  const defs = (JSON.parse(readFileSync(join(SCHEMAS_DIR, 'run-event-payloads.schema.json'), 'utf8')) as { $defs: Record<string, unknown> }).$defs;
  const grammar = new RegExp(map.grammar);

  it('every RunEventType enum member has exactly one row, and every row names an enum member', () => {
    const rowsByV1 = new Map<string, number>();
    for (const r of map.rows) rowsByV1.set(r.v1, (rowsByV1.get(r.v1) ?? 0) + 1);
    for (const t of enumTypes) expect(rowsByV1.get(t), req('openwop.it.event-codemap-complete.every-runeventtype-enum-member-has-exactly-one-row-and-every-row-names-an-enum-m', 'event-codemap-complete.test.ts (no spec citation in file)', `enum member ${t} MUST have exactly one codemap row`)).toBe(1);
    for (const r of map.rows) expect(enumTypes, req('openwop.it.event-codemap-complete.every-runeventtype-enum-member-has-exactly-one-row-and-every-row-names-an-enum-m', 'event-codemap-complete.test.ts (no spec citation in file)', `codemap row ${r.v1} MUST be an enum member`)).toContain(r.v1);
    expect(map.rows.length).toBe(enumTypes.length);
  });

  it('every payloadDef exists in run-event-payloads.schema.json $defs', () => {
    for (const r of map.rows) {
      expect(r.payloadDef, req('openwop.it.event-codemap-complete.every-payloaddef-exists-in-run-event-payloads-schema-json-defs', 'event-codemap-complete.test.ts (no spec citation in file)', `${r.v1} MUST be keyed to a payload $def`)).not.toBeNull();
      expect(defs[r.payloadDef as string], req('openwop.it.event-codemap-complete.every-payloaddef-exists-in-run-event-payloads-schema-json-defs', 'event-codemap-complete.test.ts (no spec citation in file)', `${r.v1}: $defs.${r.payloadDef} MUST exist`)).toBeDefined();
    }
  });

  it('every proposed v2 name is unique, grammatical, two segments, and never under the reserved `core.` prefix', () => {
    const seen = new Set<string>();
    for (const r of map.rows) {
      expect(grammar.test(r.v2), req('openwop.it.event-codemap-complete.every-proposed-v2-name-is-unique-grammatical-two-segments-and-never-under-the-re', 'event-codemap-complete.test.ts (no spec citation in file)', `${r.v1} → ${r.v2} MUST match the v2 naming grammar`)).toBe(true);
      expect(r.v2.split('.').length, req('openwop.it.event-codemap-complete.every-proposed-v2-name-is-unique-grammatical-two-segments-and-never-under-the-re', 'event-codemap-complete.test.ts (no spec citation in file)', `${r.v2} MUST have exactly two segments`)).toBe(2);
      expect(r.v2.startsWith('core.'), req('openwop.it.event-codemap-complete.every-proposed-v2-name-is-unique-grammatical-two-segments-and-never-under-the-re', 'event-codemap-complete.test.ts (no spec citation in file)', `${r.v2} MUST NOT use the reserved core. prefix`)).toBe(false);
      expect(seen.has(r.v2), req('openwop.it.event-codemap-complete.every-proposed-v2-name-is-unique-grammatical-two-segments-and-never-under-the-re', 'event-codemap-complete.test.ts (no spec citation in file)', `${r.v2} is proposed for two different v1 types`)).toBe(false);
      seen.add(r.v2);
    }
  });
});
