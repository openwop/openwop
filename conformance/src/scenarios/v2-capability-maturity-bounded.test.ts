/**
 * v2 — `capability-maturity-bounded` (RFC 0197 §C.7;
 * `spec/v2/core/capabilities.md` §8, the `technical` row).
 *
 * Witness class: witnessable — unaided. `capabilities.md` §8 sourced the
 * technical maturity axis from "the record's `status`", which is the HOST's
 * claim about itself. `spec/v2/declaration.json` is the CORPUS's claim, and it
 * calls 82 of 87 families `experimental`. Nothing compared the two, so a host
 * could advertise `status: "stable"` for a family the protocol has not
 * committed to and every gate stayed green. RFC 0197 §C.7 makes the
 * declaration the upper bound: a host MUST NOT advertise `stable` for a family
 * whose declaration row is not `technical: "stable"`. Understating is
 * permitted — a host may call its own offer `experimental` under a `stable`
 * corpus row, because it is understating, and this row is deliberately
 * ONE-SIDED so that it never pushes a host to overclaim.
 *
 * The declaration is read from the corpus the suite ships with
 * (`@openwop/spec-artifacts` in the published layout, `spec/v2/` in a repo
 * checkout — `lib/paths.ts` `SPEC_V2_DIR`), so a consumer installing the
 * tarball measures against the same declaration a contributor does.
 *
 * A key with a record but no declaration row is NOT this row's concern —
 * `v2-capabilities-root-closed` fails an unregistered root key — but it is
 * counted and named rather than skipped in silence.
 *
 * This row CAN fail: run the driver against MyndHyve's committed discovery
 * document and 38 families fail. That run is the sabotage proof, recorded in
 * the RFC 0197 gates PR.
 *
 * @see spec/v2/core/capabilities.md §8
 * @see spec/v2/declaration.json
 * @see RFCS/0197-v2-surfaces-retired-never-reshaped.md §C
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { v2Discovery } from '../lib/v2.js';
import { SCHEMAS_DIR, SPEC_V2_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/capabilities.md §8';
const ID = 'openwop.requirement.0197.maturity-not-overstated';

interface DeclarationFamily { key: string; maturity?: { technical?: string } }

/** Root keys the generated capabilities schema declares as family records. */
function familyKeys(): Set<string> {
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'capabilities.schema.json'), 'utf8')) as { properties?: Record<string, { required?: string[] }> };
  const out = new Set<string>();
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (['status', 'since', 'witness'].every((r) => (prop.required ?? []).includes(r))) out.add(key);
  }
  return out;
}

function declarationTechnical(): Map<string, string> | null {
  if (SPEC_V2_DIR === null) return null;
  const path = join(SPEC_V2_DIR, 'declaration.json');
  if (!existsSync(path)) return null;
  const decl = JSON.parse(readFileSync(path, 'utf8')) as { families?: DeclarationFamily[] };
  const out = new Map<string, string>();
  for (const f of decl.families ?? []) if (f.maturity?.technical) out.set(f.key, f.maturity.technical);
  return out;
}

describe('v2 capability-maturity-bounded (RFC 0197 §C.7)', () => {
  it('no family record advertises `stable` above its corpus declaration row', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const technical = declarationTechnical();
    if (technical === null) return softSkip('blocked', 'spec/v2/declaration.json is not present in this layout — the corpus bound cannot be read, and a bound that cannot be read is not a pass');
    const keys = familyKeys();
    const records = Object.entries(doc).filter(([k, v]) => keys.has(k) && v !== null && typeof v === 'object' && !Array.isArray(v)) as Array<[string, Record<string, unknown>]>;
    // A row that cannot fail is not a witness: a host advertising no family
    // record reports `blocked`, never a zero-assertion pass.
    if (records.length === 0) return softSkip('blocked', 'the host advertises no family record at the v2 root, so this row would assert nothing — it is blocked, not passing');
    const undeclared: string[] = [];
    const overstated: string[] = [];
    for (const [key, rec] of records) {
      const corpus = technical.get(key);
      // A key with a record but no declaration row is not this row's concern —
      // `v2-capabilities-root-closed` owns an unregistered root key — but it is
      // named rather than skipped in silence.
      if (corpus === undefined) { undeclared.push(key); continue; }
      if (rec['status'] === 'stable' && corpus !== 'stable') overstated.push(`${key} (corpus: ${corpus})`);
    }
    // The SUMMARY assertion comes first on purpose. A per-record assertion that
    // failed first would abort the test at family one and report a single name,
    // when what the host operator needs is the whole list in one message.
    expect(
      overstated,
      req(ID, DOC, `${overstated.length} family record(s) advertise status "stable" above the corpus declaration row. RFC 0197 §C.7 makes the declaration the upper bound — re-cut each with status "experimental" and a future \`until\`, or promote the family by RFC (§C.9). Understating is always permitted, so this bound can never push a host to overclaim. Overstated: ${overstated.join(', ') || 'none'}`),
    ).toEqual([]);
    // Then one assertion per record, so the ledger's assertion count equals the
    // record count rather than one: a row that asserted once over 42 records
    // would look identical to a row that asserted over none.
    for (const [key, rec] of records) {
      const corpus = technical.get(key);
      expect(
        corpus === undefined || !(rec['status'] === 'stable' && corpus !== 'stable'),
        req(ID, DOC, `${key}: status ${JSON.stringify(rec['status'])} against corpus maturity ${corpus ?? '(not declared)'}`),
      ).toBe(true);
    }
    expect(records.length, req(ID, DOC, `the scenario asserted over ${records.length} family record(s)${undeclared.length > 0 ? `; ${undeclared.length} carry no declaration row and are left to v2-capabilities-root-closed: ${undeclared.join(', ')}` : ''}`)).toBeGreaterThan(0);
  });
});
