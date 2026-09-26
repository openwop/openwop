/**
 * bundle-maturity-gate — RFC 0197 §C.7 and decisions log D1. The corpus wrapper
 * for `scripts/check-bundle-maturity.mjs`: the corpus declaration is the upper
 * bound on the maturity a host may advertise, the bound is a MUST from the
 * first suite release that ships this RFC, and an earlier bundle is REPORTED
 * rather than retro-failed.
 *
 * WHY THIS FILE DOES NOT MINT `maturity-not-overstated`. That id is the HOST
 * obligation, witnessed unaided by `v2-capability-maturity-bounded` against a
 * running host. `check-accepted-predicate` rule 4 accepts a host-tier id with
 * an executed-pass row in EITHER a committed bundle OR the corpus ledger — so
 * minting the host id from a corpus gate would discharge §C's evidence bar
 * without any host having done anything. The corpus leg gets its own id, and
 * the host leg stays owed.
 *
 * The legs, each a run:
 *   1. the committed corpus — green, and the gate states which suite makes
 *      §C.7 binding.
 *   2. MyndHyve's superseded 2.35.1 document, re-labelled with a suite version
 *      at or above the RFC's, FAILS with 38 — the sabotage the RFC names.
 *   3. flipping one family to `stable` in a fixture declaration drops the
 *      count to 37, so the number is derived from the comparison rather than
 *      from a constant somebody typed.
 *   4. the same document at its own suite is REPORTED, not failed, and the
 *      report names the families and the gap row. A "reported" disposition
 *      that printed nothing would be indistinguishable from a clean tree,
 *      which is how a backlog becomes invisible.
 *
 * WHY THE SUBJECT IS A FROZEN FIXTURE. Legs 2–4 need a document that really
 * overstates. Until 2026-09-26 that was the committed MyndHyve bundle; its
 * 2.39.5 re-cut advertises nothing above the declaration (G1 closed), so the
 * committed bundle can no longer be the sabotage subject. The 2.35.1 document
 * is kept byte-for-byte at `evidence/fixtures/0197-myndhyve-2.35.1-overstated.json`
 * — outside `evidence/v2-host-bundles/`, so no gate reads it as evidence.
 *
 * @see scripts/check-bundle-maturity.mjs
 * @see spec/v2/core/capabilities.md §8
 * @see RFCS/0197-v2-surfaces-retired-never-reshaped.md §C, Unresolved 1
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');
const SCRIPT = join(root, 'scripts', 'check-bundle-maturity.mjs');
const ID = 'openwop.requirement.0197.bundle-maturity-bound';
const DOC = 'spec/v2/core/capabilities.md §8 (RFC 0197 §C.7)';
const SOURCE = join(root, 'evidence', 'fixtures', '0197-myndhyve-2.35.1-overstated.json');

interface Run { status: number | null; out: string; overstated: number | null }

function parse(out: string, file: string): number | null {
  const m = new RegExp(`${file}: suite [^,]+, \\d+ family record\\(s\\), (\\d+) overstated`).exec(out);
  return m ? Number(m[1]) : null;
}

/** Re-label the committed bundle onto a fixture suite version and run the gate. */
function relabelled(suiteVersion: string, flipFamilyToStable?: string): Run {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-0197-maturity-'));
  const bundles = join(dir, 'bundles');
  mkdirSync(bundles, { recursive: true });
  const bundle = JSON.parse(readFileSync(SOURCE, 'utf8')) as { suite?: { version?: string } };
  bundle.suite = { ...(bundle.suite ?? {}), version: suiteVersion };
  writeFileSync(join(bundles, 'myndhyve.json'), JSON.stringify(bundle, null, 2));
  const env: Record<string, string> = { ...process.env as Record<string, string>, OPENWOP_V2_BUNDLES_DIR: bundles };
  if (flipFamilyToStable) {
    const decl = JSON.parse(readFileSync(join(root, 'spec', 'v2', 'declaration.json'), 'utf8')) as { families: Array<{ key: string; maturity?: { technical?: string } }> };
    for (const f of decl.families) if (f.key === flipFamilyToStable && f.maturity) f.maturity.technical = 'stable';
    const p = join(dir, 'declaration.json');
    writeFileSync(p, JSON.stringify(decl, null, 2));
    env['OPENWOP_V2_DECLARATION_FILE'] = p;
  }
  const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
  const out = String(r.stdout ?? '') + String(r.stderr ?? '');
  return { status: r.status, out, overstated: parse(out, 'myndhyve\\.json') };
}

describe('bundle-maturity-gate (RFC 0197 §C.7 / D1)', () => {
  it('the committed corpus is green, and the gate states when §C.7 binds', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const out = String(r.stdout ?? '') + String(r.stderr ?? '');
    expect(r.status, req(ID, DOC, `D1: a bundle cut before the first suite release shipping this RFC stays a valid measurement at its own suite, so the committed corpus MUST be green — it exited ${r.status}: ${out.slice(-600)}`)).toBe(0);
    expect(out, req(ID, DOC, 'the gate MUST state which suite version makes §C.7 binding, so "reported" has a visible end date')).toMatch(/binds bundles cut on suite \d+\.\d+\.\d+ or later/);
  }, 120_000);

  it('the superseded MyndHyve bundle re-labelled onto the RFC’s suite FAILS, naming every overstated family', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    if (!existsSync(SOURCE)) return softSkip('blocked', 'evidence/fixtures/0197-myndhyve-2.35.1-overstated.json is absent, so the sabotage has no subject');
    const r = relabelled('2.36.0');
    expect(r.status, req(ID, DOC, `§C.7 is a MUST for a bundle cut on the first suite release that ships this RFC; the ONLY difference from the green run is the suite label — it exited ${r.status}: ${r.out.slice(-600)}`)).not.toBe(0);
    expect(r.overstated, req(ID, DOC, `the count must be the real one measured from the real document (38), not a constant — it read ${r.overstated}`)).toBe(38);
    expect(r.out, req(ID, DOC, 'the failure must tell the host what to do: re-cut as experimental with a future `until`, or promote the family by RFC')).toMatch(/Re-cut with `status: "experimental"`.*or promote the family by RFC/s);
  }, 120_000);

  it('the count is DERIVED — promoting one family in the declaration drops 38 to 37', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    if (!existsSync(SOURCE)) return softSkip('blocked', 'evidence/fixtures/0197-myndhyve-2.35.1-overstated.json is absent, so the sabotage has no subject');
    const r = relabelled('2.36.0', 'packs');
    expect(r.overstated, req(ID, DOC, `with \`packs\` promoted to stable in the declaration the count MUST fall by exactly one; a gate reading a hard-coded 38 would not move. It read ${r.overstated}`)).toBe(37);
    expect(r.out, req(ID, DOC, 'the promoted family must no longer be named in the overstated list')).not.toMatch(/packs\(corpus:experimental\)/);
  }, 120_000);

  it('a bundle whose suite is BELOW the RFC’s is reported, not failed, even with the same 38', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    if (!existsSync(SOURCE)) return softSkip('blocked', 'evidence/fixtures/0197-myndhyve-2.35.1-overstated.json is absent, so the sabotage has no subject');
    const r = relabelled('2.35.1');
    expect(r.status, req(ID, DOC, `the positive control for D1: identical content, an earlier suite label, and the gate MUST NOT fail — otherwise "reported" is a fiction. It exited ${r.status}: ${r.out.slice(-400)}`)).toBe(0);
    expect(r.overstated, req(ID, DOC, 'the same 38 are still counted and printed; reported is not the same as unmeasured')).toBe(38);
    expect(r.out, req(ID, DOC, 'the reported row must cite COMPATIBILITY.md §2.3 — an old pass stays a measurement at the suite that measured it')).toMatch(/stays a valid measurement at its own suite/);
    expect(r.out, req(ID, DOC, 'a "reported" disposition that printed nothing would be indistinguishable from a clean tree; the report MUST name the gap row that owes the re-cut')).toMatch(/openwop\.gap\.0197\.1 \(G1\)/);
    expect(r.out, req(ID, DOC, 'the report MUST name the families by key, not just count them — a number nobody can act on is not a report')).toMatch(/packs\(corpus:experimental\)/);
  }, 120_000);
});
