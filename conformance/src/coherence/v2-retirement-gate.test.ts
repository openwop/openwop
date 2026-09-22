/**
 * v2-retirement-gate — RFC 0197 §A.2 and §A.4. The corpus wrapper that proves
 * `scripts/check-v2-retirement.mjs` evaluates SIX independent predicates and
 * that each of them can, on its own, hold a removal back.
 *
 * The discipline this file exists to enforce: **a fixture that fails for the
 * wrong predicate is a defect in the fixture, not a pass.** So every sabotage
 * changes exactly ONE input away from a base fixture that the gate calls
 * `retirable`, and the assertion is on the gate's verdict line — `held:R3`,
 * not merely "it went red". A gate that always failed would satisfy a
 * red-means-red test and prove nothing about which rule did the work.
 *
 * The base fixture is the retirement RFC 0197 says it enables first:
 * connection-pack `transport: "sse"`, replaced by `streamable-http` two minors
 * earlier, on the `connections` family, which the declaration calls
 * `experimental`.
 *
 * Fixtures are built in a tmpdir, not committed under `conformance/fixtures/`:
 * they only ever feed a spawned gate, are never sent to a host, and would
 * otherwise ship to npm consumers who cannot use them (each needing an
 * allowlist row in check-npm-pack-contents). Same pattern as
 * `v2-eos-clock.test.ts`.
 *
 * @see scripts/check-v2-retirement.mjs
 * @see spec/v2/core/overview.md §0a
 * @see RFCS/0197-v2-surfaces-retired-never-reshaped.md §A.2, §A.4
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');
const SCRIPT = join(root, 'scripts', 'check-v2-retirement.mjs');
const ID = 'openwop.requirement.0197.retirement-predicate';
const CORRECTION_ID = 'openwop.requirement.0197.correction-unevidenced';
const DOC = 'spec/v2/core/overview.md §0a (RFC 0197 §A.2)';
const CORRECTION_DOC = 'COMPATIBILITY.md §3a (RFC 0197 §A.4)';

const ROW = 'openwop.deprecation.rfc-0197-sse-fixture';
const TRANSPORT = 'schemas/v2/connection-pack-manifest.schema.json#/provider/reach/mcp/server/transport';

interface Sabotage {
  addedIn?: string;
  bundleCarries?: boolean;
  censusNull?: boolean;
  censusCount?: number;
  class?: string;
  declarationStable?: boolean;
  firstCommit?: string;
  minorAtCommit?: string;
  tier?: string;
  matrixTier?: string;
  corrections?: unknown[];
}

function build(o: Sabotage): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-0197-ret-'));
  const write = (name: string, value: unknown): string => { const f = join(dir, name); writeFileSync(f, JSON.stringify(value, null, 2)); return f; };

  const bundles = join(dir, 'bundles');
  mkdirSync(bundles, { recursive: true });
  writeFileSync(join(bundles, 'fixture-host.json'), JSON.stringify({
    suite: { version: '2.35.0' },
    discovery: { document: { protocolVersions: ['2.0'], connections: { status: 'experimental', since: '2.0', witness: 'witnessable-unaided', until: '2.99', ...(o.bundleCarries ? { transports: ['http', 'sse'] } : {}) } } },
  }, null, 2));

  const deprecations = write('deprecations.json', {
    $schema: './deprecations.schema.json', version: 1, updated: '2026-09-22',
    entries: [{
      id: ROW, status: 'deprecated', surface: 'connection-pack transport "sse"', kind: 'schema-field',
      deprecatedIn: '2.10', authority: 'RFC 0197 coherence fixture', removeIn: '2.30',
      replacement: 'streamable-http', codemod: null, removalTrigger: ['v2-minor'],
      retirement: {
        class: o.class ?? 'enum-member', family: 'connections', deprecatedInMinor: '2.10',
        discovery: { path: 'connections.transports', value: 'sse' },
        manifest: { kinds: ['connection-pack'], path: 'provider.reach.mcp.server.transport', value: 'sse' },
      },
      sources: [{ file: 'schemas/v2/connection-pack-manifest.schema.json', token: '"sse"' }],
    }],
  });
  const migrations = write('migrations.json', {
    $schema: './migrations.schema.json', version: 1, updated: '2026-09-22',
    rows: [{
      id: 'openwop.migration.v2.1', rfc: '0197', kind: 'replace',
      from: { surface: 'sse', path: TRANSPORT },
      to: { surface: 'streamable-http', path: TRANSPORT, addedIn: o.addedIn ?? '2.20' },
      deprecationId: ROW, codemod: null, persistedData: 'not-persisted', requirementIds: [],
    }],
  });
  const corrections = write('corrections.json', { $schema: './corrections.schema.json', version: 1, updated: '2026-09-22', rows: o.corrections ?? [] });
  const today = new Date().toISOString().slice(0, 10);
  const census = o.censusNull
    ? { [ROW]: { count: null, manifestsScanned: null, registryCommit: null, registryCommitDate: null } }
    : { [ROW]: { count: o.censusCount ?? 0, manifestsScanned: 9, registryCommit: 'fixture', registryCommitDate: today } };
  const crossRepo = write('cross-repo.json', { registryManifestCensus: census });
  const clock = write('clock.json', { hosts: [{ name: 'fixture-host', latest: { evidenceTiers: [o.tier ?? 'self'] } }] });
  const history = write('history.json', { [ROW]: { firstCommit: o.firstCommit ?? '2026-01-01T00:00:00Z', minorAtCommit: o.minorAtCommit ?? '2.10' } });
  const matrix = join(dir, 'matrix.md');
  writeFileSync(matrix, `# fixture\n\n## v2 — fixture table\n\n| Host | Evidence tier |\n| --- | --- |\n| fixture-host | ${o.matrixTier ?? 'self'} |\n\n## Hosts\n`);

  let declaration = join(root, 'spec', 'v2', 'declaration.json');
  if (o.declarationStable) {
    const d = JSON.parse(readFileSync(declaration, 'utf8')) as { families: Array<{ key: string; maturity?: { technical?: string } }> };
    for (const f of d.families) if (f.key === 'connections' && f.maturity) f.maturity.technical = 'stable';
    declaration = write('declaration.json', d);
  }

  return {
    OPENWOP_DEPRECATIONS_FILE: deprecations,
    OPENWOP_V2_MIGRATIONS_FILE: migrations,
    OPENWOP_V2_CORRECTIONS_FILE: corrections,
    OPENWOP_V2_DECLARATION_FILE: declaration,
    OPENWOP_V2_BUNDLES_DIR: bundles,
    OPENWOP_CROSS_REPO_FILE: crossRepo,
    OPENWOP_EOS_CLOCK_FILE: clock,
    OPENWOP_INTEROP_MATRIX_FILE: matrix,
    OPENWOP_V2_ROW_HISTORY_FILE: history,
  };
}

function run(o: Sabotage): { status: number | null; out: string; held: string[] } {
  const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', env: { ...process.env, ...build(o) }, maxBuffer: 32 * 1024 * 1024 });
  const out = String(r.stdout ?? '') + String(r.stderr ?? '');
  const verdict = /— (retirable|held:([^\n]*))/.exec(out);
  return { status: r.status, out, held: verdict && verdict[2] ? [...new Set(verdict[2].split(','))] : [] };
}

/** Each row: the one input changed, and the ONLY predicate that may hold. */
const SABOTAGES: Array<[string, string, Sabotage]> = [
  ['R1', 'the replacement ships in the SAME minor as the removal, so nobody ever had a minor in which both existed', { addedIn: '2.30' }],
  ['R2', 'the row was committed five days and one minor before the removal, not 30 days and two minors', { firstCommit: new Date(Date.now() - 5 * 86_400_000).toISOString(), minorAtCommit: '2.29' }],
  ['R3', 'a committed v2 host bundle carries the value — this is P1, the 2.8.2 defect, reproduced', { bundleCarries: true }],
  ['R3', 'the registry census is null: nobody looked, and "we did not look" must not read like "nobody has it"', { censusNull: true }],
  ['R3', 'the registry census counts published manifests still carrying it', { censusCount: 4 }],
  ['R4', 'the surface is a REQUIRED property, whose absence the 2.0 contract never defined', { class: 'required-property' }],
  ['R5', 'the advertising family is `stable` in the declaration, so §C.9 sends the removal to 3.0', { declarationStable: true }],
  ['R6', 'an independent (tier-3) host is in the end-of-support clock', { tier: 'independent' }],
  ['R6', 'an independent (tier-3) host is in the INTEROP-MATRIX v2 table', { matrixTier: 'independent' }],
];

describe('v2-retirement-gate (RFC 0197 §A.2 — R1–R6, one sabotage each)', () => {
  it('the committed corpus passes, and the gate prints its inputs rather than a silent zero', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const out = String(r.stdout ?? '') + String(r.stderr ?? '');
    expect(r.status, req(ID, DOC, `check-v2-retirement MUST be green on the committed corpus — ${out.slice(-600)}`)).toBe(0);
    expect(out, req(ID, DOC, 'a gate with zero rows must print WHAT it read; otherwise green-because-empty and green-because-checked are the same output')).toMatch(/check-v2-retirement inputs: release \d+\.\d+\.\d+; \d+ v2-minor deprecation row\(s\)/);
  }, 120_000);

  it('the base fixture — a full, honest retirement — is reported `retirable` and the gate exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run({});
    expect(r.status, req(ID, DOC, `the positive control: with R1–R6 all satisfied the gate MUST admit the removal, or the sabotages below prove only that it always fails — it exited ${r.status}: ${r.out.slice(-800)}`)).toBe(0);
    expect(r.held, req(ID, DOC, `the base fixture must hold on NO predicate; it held on ${r.held.join(',') || 'none'}`)).toEqual([]);
    expect(r.out, req(ID, DOC, 'the verdict line must say `retirable` in as many words')).toContain('retirable');
  }, 120_000);

  for (const [predicate, why, sabotage] of SABOTAGES) {
    it(`${predicate} — ${why}`, () => {
      if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
      const r = run(sabotage);
      expect(r.status, req(ID, DOC, `${predicate}: the gate MUST refuse a DUE row when ${why} — it exited ${r.status}: ${r.out.slice(-800)}`)).not.toBe(0);
      expect(r.held, req(ID, DOC, `${predicate}: the row must be held by ${predicate} and by NOTHING else — a fixture that reddens the gate through another predicate proves nothing about ${predicate}. Held: ${r.held.join(',') || 'none'}`)).toEqual([predicate]);
      expect(r.out, req(ID, DOC, `${predicate}: the failure must tell the contributor the disposition — reschedule removeIn to 3.0`)).toMatch(/reschedule removeIn to 3\.0/);
    }, 120_000);
  }

  it('§A.4 — a corrections row whose prior shape a committed bundle carried is REFUSED', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const carried = {
      id: 'openwop.correction.v2.99', date: '2026-09-22', class: 'w3c-class-3',
      pointers: ['schemas/v2/fixture.schema.json#/x'],
      compatibilityEntry: 'the v2 bare pack-manifest `signing` block and `FragmentNode.config`',
      priorShapeCensus: { bundles: 1, manifests: 0, manifestsScanned: 190, note: 'fixture: a bundle carried it (P1)' },
    };
    const r = run({ corrections: [carried] });
    expect(r.status, req(CORRECTION_ID, CORRECTION_DOC, `§A.4's second condition is R3 for the PRIOR shape; a row admitting a bundle carried it MUST be refused — it exited ${r.status}: ${r.out.slice(-600)}`)).not.toBe(0);
    expect(r.out, req(CORRECTION_ID, CORRECTION_DOC, 'the failure must name P1 as the thing §A.4 refuses')).toMatch(/this is P1, and P1 is exactly what .A\.4 refuses/);
  }, 120_000);

  it('§A.4 — a corrections row with a NULL manifest census is REFUSED, and a drifted COMPATIBILITY entry too', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const nullCensus = {
      id: 'openwop.correction.v2.98', date: '2026-09-22', class: 'w3c-class-3',
      pointers: ['schemas/v2/fixture.schema.json#/x'],
      compatibilityEntry: 'the v2 bare pack-manifest `signing` block and `FragmentNode.config`',
      priorShapeCensus: { bundles: 0, manifests: null, manifestsScanned: null, note: 'fixture: nobody censused' },
    };
    const a = run({ corrections: [nullCensus] });
    expect(a.status, req(CORRECTION_ID, CORRECTION_DOC, `a missing census is a failure, not a zero — it exited ${a.status}: ${a.out.slice(-400)}`)).not.toBe(0);
    expect(a.out, req(CORRECTION_ID, CORRECTION_DOC, 'the failure must say a missing census is not a zero')).toMatch(/no census was run/);

    const drifted = { ...nullCensus, id: 'openwop.correction.v2.97', priorShapeCensus: { bundles: 0, manifests: 0, manifestsScanned: 190, note: 'fixture' }, compatibilityEntry: 'a sentence COMPATIBILITY.md has never contained' };
    const b = run({ corrections: [drifted] });
    expect(b.status, req(CORRECTION_ID, CORRECTION_DOC, `a register row whose prose entry has been reworded away is an unrecorded shape change — it exited ${b.status}: ${b.out.slice(-400)}`)).not.toBe(0);
    expect(b.out, req(CORRECTION_ID, CORRECTION_DOC, 'the failure must name the drifted COMPATIBILITY.md entry')).toMatch(/COMPATIBILITY\.md no longer contains/);
  }, 120_000);
});
