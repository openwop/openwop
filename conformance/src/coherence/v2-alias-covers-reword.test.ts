/**
 * v2-alias-covers-reword — RFC 0168 §A.1 (corpus wrapper).
 *
 * Ids are minted in `conformance/requirements.json`; a title reword without a
 * `requirement-aliases.json` row fails CI because the generator diffs ids
 * against the last published set. This wrapper runs that diff (`--check`) with
 * cwd `conformance`, exactly as the merge gate does.
 *
 * Runs in the spec repo's corpus gate (scripts/check-spec-coherence.mjs), never
 * in a host bundle: it spawns the root gate script and asserts exit 0 under the
 * requirement id `openwop.requirement.0168.alias-covers-reword`, so the corpus ledger carries a
 * row for the RFC's falsifiability entry. Gates on a spec checkout (V1_DIR).
 *
 * RFC 0255 §D adds tombstones beside aliases. The generator also reads the
 * registry at the last published tag (`--write` used to rewrite the committed
 * file first, after which `--check` compared the tree with itself), and a
 * published id the sources no longer mint needs an alias or a tombstone naming
 * the `steward-deletion` row that deleted its surface. The second describe
 * drives that through the OPENWOP_PUBLISHED_REQUIREMENTS_FILE seam, carrying
 * one fabricated id the sources do not mint.
 *
 * @see RFCS/0168-v2-evidence-and-conformance.md §A.1
 * @see RFCS/0255-delete-the-ai-envelope.md §D
 * @see conformance/scripts/generate-requirement-registry.mjs
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');

function tail(r: SpawnSyncReturns<string>): string {
  return (String(r.stderr ?? '') + String(r.stdout ?? '')).trim().split('\n').slice(-6).join(' | ');
}

describe('v2-alias-covers-reword (RFC 0168 §A.1)', () => {
  it('the corpus gate script exits 0', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r0 = spawnSync('node', [join(root, 'conformance', 'scripts', 'generate-requirement-registry.mjs'), '--check'], { cwd: join(root, 'conformance'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r0.status, req('openwop.requirement.0168.alias-covers-reword', 'RFC 0168 §A.1', `the requirement registry is current and every reworded title has a requirement-aliases.json row — a reword that orphans a published id fails the generator diff (generate-requirement-registry.mjs --check exit 0) — ${tail(r0)}`)).toBe(0);
  }, 180_000);
});

const GENERATOR = join(root, 'conformance', 'scripts', 'generate-requirement-registry.mjs');
const REGISTRY = join(root, 'conformance', 'requirements.json');
const ID = 'openwop.requirement.0255.requirement-tombstone';
const DOC = 'COMPATIBILITY.md §3a (RFC 0255 §D)';
const GONE = 'openwop.requirement.0255.fixture-deleted';
const ROW = 'openwop.correction.v2.90';

function drive(opts: { tombstone?: Record<string, string>; rowClass?: string; mode?: '--check' | '--write' }): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-0255-tomb-'));
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as { records: unknown[] };
  registry.records.push({ id: GONE, file: 'v2-fixture-deleted.test.ts', line: 1, title: 'fixture', explicitId: GONE, citations: [] });
  const published = join(dir, 'published.json');
  writeFileSync(published, JSON.stringify(registry));
  const aliasFile = JSON.parse(readFileSync(join(root, 'conformance', 'requirement-aliases.json'), 'utf8')) as Record<string, unknown>;
  if (opts.tombstone) aliasFile['tombstones'] = opts.tombstone;
  const aliases = join(dir, 'aliases.json');
  writeFileSync(aliases, JSON.stringify(aliasFile));
  const corrections = join(dir, 'corrections.json');
  writeFileSync(corrections, JSON.stringify({ version: 1, updated: '2026-10-30', rows: [{ id: ROW, class: opts.rowClass ?? 'steward-deletion' }] }));
  const r = spawnSync('node', [GENERATOR, opts.mode ?? '--check'], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, OPENWOP_PUBLISHED_REQUIREMENTS_FILE: published, OPENWOP_REQUIREMENT_ALIASES_FILE: aliases, OPENWOP_V2_CORRECTIONS_FILE: corrections },
  });
  return { status: r.status, out: String(r.stdout ?? '') + String(r.stderr ?? '') };
}

const digest = (): string => createHash('sha256').update(readFileSync(REGISTRY)).digest('hex');

describe('v2-requirement-tombstones (RFC 0255 §D)', () => {
  it('a published id the sources no longer mint, with no alias or tombstone, fails --check and --write refuses without writing', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = drive({});
    expect(r.status, req(ID, DOC, `a dropped id orphans every bundle that cited it — it exited ${r.status}: ${r.out.slice(-600)}`)).not.toBe(0);
    expect(r.out, req(ID, DOC, 'the failure must name the id and the remedy')).toMatch(new RegExp(`id ${GONE.replace(/\./g, '\\.')} was published .* tombstone`));
    const before = digest();
    const w = drive({ mode: '--write' });
    expect(w.status, req(ID, DOC, `--write MUST refuse rather than launder the drop — it exited ${w.status}`)).not.toBe(0);
    expect(w.out, req(ID, DOC, 'the refusal must say nothing was written')).toMatch(/--write REFUSED .* not written/);
    expect(digest(), req(ID, DOC, 'conformance/requirements.json must be byte-identical after a refused --write')).toBe(before);
  }, 180_000);

  it('POSITIVE CONTROL — a tombstone naming a steward-deletion row retires the id', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = drive({ tombstone: { [GONE]: ROW } });
    expect(r.status, req(ID, DOC, `a tombstone is the licence for a dropped id — it exited ${r.status}: ${r.out.slice(-600)}`)).toBe(0);
  }, 180_000);

  it('a tombstone naming a non-steward row, or a live id, is REFUSED', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const wrongClass = drive({ tombstone: { [GONE]: ROW }, rowClass: 'w3c-class-3' });
    expect(wrongClass.status, req(ID, DOC, `an id retires only with the surface a steward deletion removed — it exited ${wrongClass.status}`)).not.toBe(0);
    expect(wrongClass.out, req(ID, DOC, 'the refusal must say the row is not a steward deletion')).toMatch(/not a steward-deletion row/);
    const live = 'openwop.requirement.0197.retirement-predicate';
    const liveTomb = drive({ tombstone: { [GONE]: ROW, [live]: ROW } });
    expect(liveTomb.status, req(ID, DOC, `a live requirement cannot be tombstoned — it exited ${liveTomb.status}`)).not.toBe(0);
    expect(liveTomb.out, req(ID, DOC, 'the refusal must name the live id')).toMatch(/tombstone openwop\.requirement\.0197\.retirement-predicate: the sources still mint this id/);
  }, 180_000);
});
