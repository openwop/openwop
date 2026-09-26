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
 * The second describe is RFC 0197 §A.3's emission leg,
 * `openwop.requirement.0197.retired-not-emitted`. Its Falsifiability verdict
 * is "unwitnessable until the first persisted-class retirement row exists", so
 * the leg is CONDITIONAL, never vacuous. It reads the deprecations register
 * the suite ships, and while that has no due `v2-minor` row with
 * `retirement.persistence: "persisted"`, it records `inapplicable` with the
 * RFC's own reason. It must record a reason: rule 4 of
 * `check-accepted-predicate` accepts a declared non-executable row only when a
 * bundle row gives one. Once such a row is due, the leg drives a run and fails
 * on any event that carries a member the v2 schema annotates
 * `x-openwop-retired-in`. It never records `executed-pass` without scanning
 * events. The branches the host leg cannot reach today are self-tested in
 * `lib/v2-retired-members.test.ts`.
 *
 * @see spec/v2/core/capabilities.md §8
 * @see spec/v2/declaration.json
 * @see RFCS/0197-v2-surfaces-retired-never-reshaped.md §A.3, §C
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { v2Discovery } from '../lib/v2.js';
import { driver } from '../lib/driver.js';
import { persistedRetirements, retiredMembers, findRetiredEmissions } from '../lib/v2-retired-members.js';
import { SCHEMAS_DIR, SPEC_V2_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/capabilities.md §8';
const ID = 'openwop.requirement.0197.maturity-not-overstated';
const RETIRED_ID = 'openwop.requirement.0197.retired-not-emitted';
const RETIRED_DOC = 'RFC 0197 §A.3';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

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

describe('v2 retired-not-emitted (RFC 0197 §A.3) — conditional on a due persisted-class retirement', () => {
  it('no run emits a persisted member the release has retired', async () => {
    if (SPEC_V2_DIR === null) return softSkip('blocked', 'spec/v2/ is not present in this layout — the retirement register cannot be read, and a register that cannot be read is not an absence');
    const deprecations = readJson(join(SPEC_V2_DIR, '..', 'v1', 'deprecations.json'));
    const migrations = readJson(join(SPEC_V2_DIR, 'migrations.json')) as { rows?: unknown[] } | null;
    const release = (readJson(join(SPEC_V2_DIR, 'release.json')) as { version?: unknown } | null)?.version;
    if (deprecations === null || typeof release !== 'string') return softSkip('blocked', 'spec/v1/deprecations.json or spec/v2/release.json is missing from the shipped corpus — the retirement register cannot be read');
    const rows = persistedRetirements(deprecations, release);
    const due = rows.filter((r) => r.due);
    const census = `corpus ${release}: ${rows.length} persisted-class v2-minor retirement row(s), ${(migrations?.rows ?? []).length} v2→v2 migration row(s)`;
    if (due.length === 0) {
      return softSkip('inapplicable', `unwitnessable until the first persisted-class retirement row is due (RFC 0197 §A.3 Falsifiability): ${census}${rows.length > 0 ? `, none due yet (${rows.map((r) => `${r.id} removeIn ${r.removeIn}`).join(', ')})` : ''} — no retired member exists for a post-2.N event to carry. Before one does, a scenario would be vacuous, and a row that cannot fail is not a witness. This leg asserts the moment such a row falls due.`);
    }
    const contractRoot = join(SPEC_V2_DIR, '..', '..');
    const members = due.flatMap((r) => retiredMembers(r, (file) => readJson(join(contractRoot, file))));
    const unlocated = due.filter((r) => !members.some((m) => m.rowId === r.id));
    if (unlocated.length > 0) return softSkip('blocked', `due persisted-class retirement row(s) whose member carries no x-openwop-retired-in annotation the suite can read: ${unlocated.map((r) => `${r.id} (${r.schemaFiles.join(', ') || 'no schemas/v2 source'})`).join('; ')}. Without the member there is nothing to scan for, and scanning for nothing is not a pass (check-removal-dates owns the missing annotation)`);
    const create = await driver.post('/runs', { workflowId: 'conformance-noop' });
    const runId = String((create.json as { runId?: unknown } | null)?.runId ?? '');
    if (create.status !== 201 || runId === '') return softSkip('blocked', `POST /runs {workflowId: conformance-noop} answered ${create.status} — no post-${due[0]!.removeIn} run to read events from`);
    const deadline = Date.now() + 20_000;
    for (;;) {
      const res = await driver.get(`/runs/${encodeURIComponent(runId)}`);
      if (res.status === 200 && TERMINAL.has(String((res.json as { status?: unknown } | null)?.status ?? ''))) break;
      if (Date.now() > deadline) return softSkip('blocked', `conformance-noop run ${runId} did not reach a terminal status within 20 s`);
      await new Promise((r) => setTimeout(r, 200));
    }
    const poll = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
    const events = (poll.json as { events?: unknown } | null)?.events;
    if (poll.status !== 200 || !Array.isArray(events) || events.length === 0) return softSkip('blocked', `the event poll for run ${runId} answered ${poll.status} with no events — there is nothing emitted to scan`);
    const hits = findRetiredEmissions(events, members);
    expect(
      hits.map((h) => `${h.member} (${h.rowId}, retired in ${members.find((m) => m.rowId === h.rowId)?.removeIn}) in ${h.eventType} at ${h.path}`),
      req(RETIRED_ID, RETIRED_DOC, `a host MUST NOT emit a persisted member after the minor that retired it; scanned ${events.length} event(s) for ${members.length} retired member(s): ${members.map((m) => `${m.kind} ${m.name}`).join(', ')}`),
    ).toEqual([]);
  });
});
