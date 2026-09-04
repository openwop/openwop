/**
 * v2-security-defaults-table — RFC 0173 §A.1 (corpus wrapper, inline).
 *
 * In v2 a security-load-bearing behavior is an obligation of the surface that
 * needs it; the table in `spec/v2/core/security-defaults.md` lists each
 * obligation, the surface that binds it, the invariant, and the witness class.
 * A row with `witness: unwitnessable` may not be in `core/`. This wrapper parses
 * the first table of that document (the obligation table), requires a
 * `Witness` column, and fails when any row's witness cell says unwitnessable.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle, under `openwop.requirement.0173.security-defaults-table`.
 *
 * @see RFCS/0173-v2-security-defaults.md §A.1
 * @see spec/v2/core/security-defaults.md
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ID = 'openwop.requirement.0173.security-defaults-table';
const SECTION = 'RFC 0173 §A.1';

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

describe('v2-security-defaults-table (RFC 0173 §A.1)', () => {
  it('the obligation table has a Witness column and no row is unwitnessable', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const path = join(SCHEMAS_DIR, '..', 'spec', 'v2', 'core', 'security-defaults.md');
    expect(existsSync(path), req(ID, SECTION, 'spec/v2/core/security-defaults.md MUST exist — it is the obligation table RFC 0173 §A.1 names')).toBe(true);
    const lines = readFileSync(path, 'utf8').split('\n');
    const headerIdx = lines.findIndex((l) => l.trim().startsWith('|') && /\|\s*Witness\s*\|/i.test(l) && /obligation/i.test(l));
    expect(headerIdx, req(ID, SECTION, 'the obligation table MUST have a `Witness` column (surface · obligation · witness · invariant)')).toBeGreaterThanOrEqual(0);
    const header = cells(lines[headerIdx] as string);
    const witnessCol = header.findIndex((h) => /^witness$/i.test(h));
    const rows: string[][] = [];
    for (let i = headerIdx + 2; i < lines.length; i += 1) {
      const l = lines[i] as string;
      if (!l.trim().startsWith('|')) break;
      rows.push(cells(l));
    }
    expect(rows.length, req(ID, SECTION, 'the obligation table MUST list at least one obligation row')).toBeGreaterThan(0);
    for (const r of rows) {
      const witness = r[witnessCol] ?? '';
      expect(witness.length, req(ID, SECTION, `obligation row \`${r[0]}\` MUST name a witness class`)).toBeGreaterThan(0);
      expect(/unwitnessable/i.test(witness), req(ID, SECTION, `obligation row \`${r[0]}\` says unwitnessable — a \`witness: unwitnessable\` row may not be in core/ (RFC 0167 Axiom 1)`)).toBe(false);
    }
  });
});
