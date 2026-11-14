/**
 * v2-core-adoption-derived — RFC 0264 (corpus gate; never reaches a host bundle).
 *
 * A core family's `maturity.adoption` is a count of witnessing hosts, derived
 * from committed bundles by `scripts/derive-core-adoption.mjs`; a family the
 * script finds at `none` carries a dated review row whose renewal must say
 * something new. These legs run that script, the code `openwop:check` runs, on
 * synthetic fixture trees built in a temp dir — a declaration, a few tiny
 * bundles, host tiers, a precomputed witness-coverage JSON (so no TypeScript is
 * needed), a release and a corrections file.
 *
 * The base tree derives: `alpha` multi-witness (h1, h2), `beta` single-witness
 * (h1 — h2 carries the record and passes one gating scenario but fails the
 * other), `gamma` none. `gamma`'s near-misses are each one exclusion the
 * script must apply: an OLDER h1 bundle that passes it (only the newest bundle
 * per host counts), a colocated companion that passes it (RFC 0216 §C), a host
 * whose origin `host-tiers.json` does not list, an h2 pass on a gating
 * scenario while h2's discovery carries no gamma record, and an h1 pass on a
 * scenario that only CITES gamma (a citation is not a gate). Each sabotage
 * changes ONE input from that base; the base passing is asserted in the same leg.
 *
 * Sabotages run 2026-11-13 against a copy of the script (each turned at least
 * one leg red): drop the companion skip; pick any bundle per host instead of
 * the newest; count an origin host-tiers.json does not list; count a `cite`
 * signal as a gate; ignore an executed-fail; drop the discovery-record check;
 * never derive `independent`; drop the stale, overdue, missing-row, §B.3 and
 * §B.4 correction checks.
 *
 * The live tree is checked inside the §A.1 leg only when
 * OPENWOP_0264_COVERAGE_JSON names a precomputed `report-v2-witness-coverage.mjs
 * --json` (that report needs typescript from conformance/node_modules; the gate
 * runs the script itself in step 10).
 *
 * @see RFCS/0264-core-adoption-derived.md
 * @see scripts/derive-core-adoption.mjs
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');
const corpusAbsent = (): boolean => V1_DIR === null;
const ABSENT = 'corpus not present in this layout (published package) — the gate scripts ship only in the spec repo';
const SPEC = 'RFC 0264 · scripts/derive-core-adoption.mjs';

const ID_DERIVED = 'openwop.requirement.0264.adoption-derived';
const ID_REVIEW = 'openwop.requirement.0264.review-row-present';
const ID_RENEWAL = 'openwop.requirement.0264.renewal-not-date-only';

type Json = Record<string, unknown>;
interface ReviewRow { family: string; reviewBy: string; decision: string; reason: string; plan: string; correction?: string }

const DIGEST = 'a'.repeat(64);
const PROFILES = [{ id: 'openwop-core-standard', certified: true }];
const family = (key: string, adoption: string, anchor = 'core'): Json => ({ key, kind: 'family', anchor, maturity: { technical: 'experimental', adoption } });
const row = (scenario: string, result: string): Json => ({ id: `openwop.scenario.${scenario}`, scenario, result });
function bundle(name: string, origin: string, at: string, carries: string[], rows: Json[], over: Json = {}): Json {
  return {
    generatedAt: at, host: { name }, claimedProfiles: PROFILES, witnessSha256: DIGEST,
    discovery: { url: `${origin}/.well-known/openwop`, document: Object.fromEntries(carries.map((k) => [k, { advertised: true }])) },
    results: { requirements: rows }, ...over,
  };
}

const BASE_FAMILIES = (): Json[] => [family('alpha', 'multi-witness'), family('beta', 'single-witness'), family('gamma', 'none'), family('extx', 'none', 'ext')];
const BASE_BUNDLES = (): Record<string, Json> => ({
  // named so that, sorted, the OLDER h1 bundle comes last: picking any but the newest picks it
  'h1-a-new.json': bundle('h1', 'https://h1.example', '2026-11-01T00:00:00Z', ['alpha', 'beta', 'gamma'], [row('s-alpha.test.ts', 'executed-pass'), row('s-beta.test.ts', 'executed-pass'), row('s-cite.test.ts', 'executed-pass')]),
  'h1-b-old.json': bundle('h1', 'https://h1.example', '2026-10-01T00:00:00Z', ['alpha', 'beta', 'gamma'], [row('s-gamma.test.ts', 'executed-pass')]),
  'h1-companion.json': bundle('h1', 'https://h1.example', '2026-11-02T00:00:00Z', ['gamma'], [row('s-gamma.test.ts', 'executed-pass')], { host: { name: 'h1', deployment: 'colocated-companion' } }),
  'h2.json': bundle('h2', 'https://h2.example', '2026-11-01T00:00:00Z', ['alpha', 'beta'], [row('s-alpha.test.ts', 'executed-pass'), row('s-beta.test.ts', 'executed-pass'), row('s-beta2.test.ts', 'executed-fail'), row('s-gamma.test.ts', 'executed-pass')]),
  'h9.json': bundle('h9', 'https://h9.example', '2026-11-01T00:00:00Z', ['gamma'], [row('s-gamma.test.ts', 'executed-pass')]),
});
const TIERS = (): Json => ({ hosts: [
  { name: 'h1', origins: ['https://h1.example'], tier: 1 },
  { name: 'h2', origins: ['https://h2.example'], tier: 2 },
  { name: 'h3', origins: ['https://h3.example'], tier: 3 },
] });
const COVERAGE: Json = { families: [
  { key: 'alpha', v2Scenarios: [{ file: 's-alpha.test.ts', signals: ['gate'] }] },
  { key: 'beta', v2Scenarios: [{ file: 's-beta.test.ts', signals: ['gate', 'cite'] }, { file: 's-beta2.test.ts', signals: ['gate'] }] },
  { key: 'gamma', v2Scenarios: [{ file: 's-gamma.test.ts', signals: ['gate'] }, { file: 's-cite.test.ts', signals: ['cite', 'rfc'] }] },
] };
const GAMMA = (over: Partial<ReviewRow> = {}): ReviewRow => ({ family: 'gamma', reviewBy: '2.50', decision: 'keep', reason: 'new in the fixture corpus', plan: 'h2 serves it next minor', ...over });

interface Tree { families?: Json[]; bundles?: Record<string, Json>; review?: ReviewRow[] | null; baseline?: ReviewRow[] | null }
interface Run { status: number | null; out: string; declaration: string }

/** Build one fixture tree and run the script on it. `review: null` omits the file; `baseline: null` means no baseline. */
function run(tree: Tree = {}, flag = '--check', reuse?: string): Run {
  const dir = reuse ?? mkdtempSync(join(tmpdir(), 'owp-0264-'));
  const f = (n: string): string => join(dir, n);
  if (!reuse) {
    mkdirSync(f('bundles'));
    for (const [name, doc] of Object.entries(tree.bundles ?? BASE_BUNDLES())) writeFileSync(join(f('bundles'), name), JSON.stringify(doc));
    writeFileSync(f('declaration.json'), `${JSON.stringify({ families: tree.families ?? BASE_FAMILIES() }, null, 2)}\n`);
    writeFileSync(f('tiers.json'), JSON.stringify(TIERS()));
    writeFileSync(f('coverage.json'), JSON.stringify(COVERAGE));
    writeFileSync(f('release.json'), JSON.stringify({ version: '2.47.0' }));
    writeFileSync(f('corrections.json'), JSON.stringify({ rows: [{ id: 'openwop.correction.v2.9' }] }));
    if (tree.review !== null) writeFileSync(f('review.json'), JSON.stringify({ rows: tree.review ?? [GAMMA()] }));
    if (tree.baseline) writeFileSync(f('baseline.json'), JSON.stringify({ rows: tree.baseline }));
  }
  const r = spawnSync('node', [join(root, 'scripts', 'derive-core-adoption.mjs'), flag], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENWOP_V2_BUNDLES_DIR: f('bundles'), OPENWOP_V2_DECLARATION_FILE: f('declaration.json'), OPENWOP_HOST_TIERS_FILE: f('tiers.json'),
      OPENWOP_0264_REVIEW_FILE: f('review.json'), OPENWOP_V2_RELEASE_FILE: f('release.json'), OPENWOP_V2_CORRECTIONS_FILE: f('corrections.json'),
      OPENWOP_0264_COVERAGE_JSON: f('coverage.json'), OPENWOP_0264_REVIEW_BASELINE: tree.baseline ? f('baseline.json') : 'none',
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, declaration: f('declaration.json') };
}

describe('RFC 0264 — core adoption is derived, and an unwitnessed family is reviewed', () => {
  it('§A.1 a core row\'s adoption equals the value the bundles derive', () => {
    if (corpusAbsent()) return softSkip('inapplicable', ABSENT);
    const base = run();
    expect(base.status, req(ID_DERIVED, SPEC, `the derived base tree MUST pass: ${base.out}`)).toBe(0);
    expect(base.out, req(ID_DERIVED, SPEC, 'the base MUST derive one multi-witness, one single-witness and one none family')).toContain('none 1, single-witness 1, multi-witness 1, independent 0');

    const edited = run({ families: [family('alpha', 'multi-witness'), family('beta', 'multi-witness'), family('gamma', 'none'), family('extx', 'none', 'ext')] });
    expect(edited.status, req(ID_DERIVED, SPEC, 'a hand-edited adoption value MUST fail')).toBe(1);
    expect(edited.out, req(ID_DERIVED, SPEC, 'the refusal MUST name the family and the derived value')).toContain('§A.1 beta: declaration says adoption "multi-witness", the bundles derive "single-witness"');

    const promoted = run({ families: [family('alpha', 'multi-witness'), family('beta', 'single-witness'), family('gamma', 'single-witness'), family('extx', 'none', 'ext')], review: [] });
    expect(promoted.status, req(ID_DERIVED, SPEC, 'claiming a witness the exclusions remove (old bundle, companion, unlisted origin, no record, citation) MUST fail')).toBe(1);
    expect(promoted.out, req(ID_DERIVED, SPEC, 'gamma MUST derive none')).toContain('§A.1 gamma: declaration says adoption "single-witness", the bundles derive "none"');

    const tier3 = run({ bundles: { ...BASE_BUNDLES(), 'h3.json': bundle('h3', 'https://h3.example', '2026-11-01T00:00:00Z', ['beta'], [row('s-beta.test.ts', 'executed-pass')]) } });
    expect(tier3.status, req(ID_DERIVED, SPEC, 'a tier-3 witness MUST make the row independent')).toBe(1);
    expect(tier3.out, req(ID_DERIVED, SPEC, 'the refusal MUST name independent')).toContain('§A.1 beta: declaration says adoption "single-witness", the bundles derive "independent"');

    const write = run({ families: [family('alpha', 'none'), family('beta', 'none'), family('gamma', 'none'), family('extx', 'single-witness', 'ext')] }, '--write');
    expect(write.status, req(ID_DERIVED, SPEC, '--write MUST succeed')).toBe(0);
    const written = JSON.parse(readFileSync(write.declaration, 'utf8')) as { families: { key: string; maturity: { adoption: string } }[] };
    expect(written.families.map((x) => `${x.key}=${x.maturity.adoption}`), req(ID_DERIVED, SPEC, '--write MUST set the core rows and leave the ext row')).toEqual(['alpha=multi-witness', 'beta=single-witness', 'gamma=none', 'extx=single-witness']);
    expect(run({}, '--check', join(write.declaration, '..')).status, req(ID_DERIVED, SPEC, 'the tree --write produced MUST pass --check')).toBe(0);

    const precomputed = process.env.OPENWOP_0264_COVERAGE_JSON;
    if (precomputed) {
      const live = spawnSync('node', [join(root, 'scripts', 'derive-core-adoption.mjs')], { encoding: 'utf8' });
      expect(live.status, req(ID_DERIVED, SPEC, `the live tree MUST pass: ${live.stderr}`)).toBe(0);
    }
  });

  it('§B.2 a family at none has a current review row, and no other family has one', () => {
    if (corpusAbsent()) return softSkip('inapplicable', ABSENT);
    expect(run().status, req(ID_REVIEW, SPEC, 'the base tree with one keep row for gamma MUST pass')).toBe(0);

    const missing = run({ review: [] });
    expect(missing.status, req(ID_REVIEW, SPEC, 'a none family with no row MUST fail')).toBe(1);
    expect(missing.out, req(ID_REVIEW, SPEC, 'the refusal MUST name the family')).toContain('§B.1 gamma: derived adoption is none');
    expect(run({ review: null }).status, req(ID_REVIEW, SPEC, 'a missing review file MUST fail while a family is at none')).toBe(1);

    const stale = run({ review: [GAMMA(), GAMMA({ family: 'alpha' })] });
    expect(stale.status, req(ID_REVIEW, SPEC, 'a row for a witnessed family MUST fail')).toBe(1);
    expect(stale.out, req(ID_REVIEW, SPEC, 'the refusal MUST call it stale')).toContain('stale — derived adoption is multi-witness');

    const overdue = run({ review: [GAMMA({ reviewBy: '2.46' })] });
    expect(overdue.status, req(ID_REVIEW, SPEC, 'a keep row below the release minor MUST fail')).toBe(1);
    expect(overdue.out, req(ID_REVIEW, SPEC, 'the refusal MUST call it overdue')).toContain('overdue — reviewBy 2.46 is below the release minor 2.47');
    expect(run({ review: [GAMMA({ reviewBy: '2.47' })] }).status, req(ID_REVIEW, SPEC, 'a keep row due this minor is not yet overdue')).toBe(0);

    expect(run({ review: [GAMMA({ reason: 'TODO' })] }).status, req(ID_REVIEW, SPEC, 'an unfilled skeleton row MUST fail')).toBe(1);
    const retire = run({ review: [GAMMA({ decision: 'retire', reviewBy: '2.40' })] });
    expect(retire.status, req(ID_REVIEW, SPEC, 'a retire row without a correction MUST fail')).toBe(1);
    expect(retire.out, req(ID_REVIEW, SPEC, 'the refusal MUST name §B.4')).toContain('§B.4');
    expect(run({ review: [GAMMA({ decision: 'retire', correction: 'openwop.correction.v2.404' })] }).status, req(ID_REVIEW, SPEC, 'a retire row naming an unknown correction MUST fail')).toBe(1);
    expect(run({ review: [GAMMA({ decision: 'retire', reviewBy: '2.40', correction: 'openwop.correction.v2.9' })] }).status, req(ID_REVIEW, SPEC, 'a retire row naming a correction row MUST pass, past its reviewBy too')).toBe(0);
  });

  it('§B.3 renewing a keep row changes its reason or plan, not only its date', () => {
    if (corpusAbsent()) return softSkip('inapplicable', ABSENT);
    const before = [GAMMA({ reviewBy: '2.48' })];
    expect(run({ baseline: before, review: before }).status, req(ID_RENEWAL, SPEC, 'an unchanged row MUST pass')).toBe(0);
    const dateOnly = run({ baseline: before, review: [GAMMA({ reviewBy: '2.51' })] });
    expect(dateOnly.status, req(ID_RENEWAL, SPEC, 'a renewal that changes only reviewBy MUST fail')).toBe(1);
    expect(dateOnly.out, req(ID_RENEWAL, SPEC, 'the refusal MUST name §B.3')).toContain('§B.3 row 0 (gamma): renewed 2.48 → 2.51 with reason and plan unchanged');
    expect(run({ baseline: before, review: [GAMMA({ reviewBy: '2.51', reason: 'the host feature slipped a minor' })] }).status, req(ID_RENEWAL, SPEC, 'a renewal with a new reason MUST pass')).toBe(0);
    expect(run({ baseline: before, review: [GAMMA({ reviewBy: '2.51', plan: 'the reference host serves it instead' })] }).status, req(ID_RENEWAL, SPEC, 'a renewal with a new plan MUST pass')).toBe(0);
    expect(run({ baseline: [GAMMA({ family: 'delta', reviewBy: '2.48' })], review: [GAMMA({ reviewBy: '2.51' })] }).status, req(ID_RENEWAL, SPEC, 'a row with no baseline row is new, not a renewal')).toBe(0);
  });
});
