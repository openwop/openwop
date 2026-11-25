/**
 * RFC 0189 / 0190 / 0191 — the normative-home gate's own witnesses.
 *
 * Runs in the corpus gate (scripts/check-spec-coherence.mjs), never in a host
 * bundle: it spawns the root gate scripts and asserts their behaviour under
 * requirement ids, so evidence/corpus-ledger.json carries rows those RFCs'
 * falsifiability tables can name (RFC 0168 §D.1 — two products, two ledgers).
 *
 * Several rows below assert a REFUSAL rather than exit 0. A bare exit-0 wrapper
 * around a gate that is already green witnesses nothing — it passes equally if
 * the gate's predicate is deleted. Where an RFC's falsifiability row says the
 * gate rejects something, this sabotages the tree and asserts the rejection.
 *
 * @see RFCS/0189-normative-home.md · RFCS/0190-kernel-budget-denominator.md · RFCS/0191-normative-home-marker.md · RFCS/0266-v2-is-self-contained.md (§B.1 legs at the end)
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');

/**
 * Sabotage runs against a THROWAWAY COPY of the corpus, never the working tree.
 *
 * These tests prove a gate REFUSES something, which means mutating a tracked
 * file. Doing that in place races every other coherence test in the same vitest
 * run — v2-spec-artifacts-digest compares the packed tree against the corpus and
 * fails if it observes the tree mid-sabotage. The copy removes the race instead
 * of sequencing around it.
 */
function inScratchCorpus(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-sabotage-'));
  try {
    for (const p of ['scripts', 'spec', 'schemas', 'docs', 'evidence', 'RFCS']) {
      cpSync(join(root, p), join(dir, p), { recursive: true });
    }
    fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const HOME = 'check-v2-normative-home.mjs';
const BUDGET = 'check-core-budget.mjs';


const tail = (r: SpawnSyncReturns<string>): string =>
  (String(r.stderr ?? '') + String(r.stdout ?? '')).trim().split('\n').slice(-6).join(' | ');
// The WHOLE output. A leg that asserts only "refused" passes whichever rule refused,
// so each sabotage leg below also asserts the reason its own rule prints. Found by the
// RFC 0263 G3 backfill (2026-11-16): with the class, keyword, marker or deadline rule
// removed, those legs stayed green because another rule refused the same mutation.
const all = (r: SpawnSyncReturns<string>): string => String(r.stderr ?? '') + String(r.stdout ?? '');
const run = (script: string, args: string[] = [], env: Record<string, string> = {}, cwd: string = root) =>
  spawnSync('node', [join(cwd, 'scripts', script), ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } });

/** Declare a family in a scratch copy and run the gate there. */
function withDeclaration(mutate: (s: string) => string, fn: (cwd: string) => void): void {
  inScratchCorpus((dir) => {
    const decl = join(dir, 'spec', 'v2', 'declaration.json');
    writeFileSync(decl, mutate(readFileSync(decl, 'utf8')));
    fn(dir);
  });
}
// REPLACES any existing `normativeText`, never prepends a second one. The first
// version inserted after `"kind": "family",` — but an already-declared family
// carries `normativeText` at that exact position, so the mutation produced a
// DUPLICATE key and JSON.parse kept the later (original) one. The sabotage then
// silently tested nothing and the assertion failed for an unrelated-looking
// reason. A test whose mutation no-ops is worse than no test.
// Removes a family's declaration entirely — the post-EOS witnesses assert that
// the §D fallback NAMES an undeclared family, and as of 2.23.0 there are none
// left in the tree. The condition the test witnesses has to be created, not
// borrowed from a corpus that happens to be broken.
const undeclare = (key: string) => (s: string) => {
  // Position-independent: `normativeText` does not sit at a fixed offset in a
  // family object — families declared at different times carry it in different
  // places, and a regex that assumed one position silently matched nothing.
  // Re-serialising is safe because this only ever writes the scratch copy.
  const doc = JSON.parse(s) as { families: Array<Record<string, unknown>> };
  for (const f of doc.families) if (f['key'] === key) delete f['normativeText'];
  return `${JSON.stringify(doc, null, 2)}\n`;
};

/**
 * A probe document in the scratch corpus that passes every home rule except the one a
 * leg measures: it carries the "Normative home" marker for `key` under a Status banner
 * and names `key` in a paragraph, with or without an RFC 2119 obligation. Without it, a
 * fixture borrowed from the tree was refused by an EARLIER rule (no marker, no paragraph
 * naming the family), and the leg passed with its own rule removed.
 */
const probe = (dir: string, rel: string, key: string, obligation: boolean): void => {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, `# Probe\n\n> **Status: Experimental.**\n> **Normative home:** \`${key}\`.\n\n## ${key}\n\nThe \`${key}\` family ${obligation ? 'MUST serve' : 'serves'} the prompts a host stores.\n`);
};

const declare = (key: string, home: string) => (s: string) => {
  const stripped = s.replace(new RegExp(`("key": "${key}",\\n\\s+"kind": "family",)(\\n\\s+"normativeText": \\[[^\\]]*\\],)`), '$1');
  return stripped.replace(new RegExp(`("key": "${key}",\\n(\\s+)"kind": "family",)`), (_m, head, pad) => `${head}\n${pad}"normativeText": ["${home}"],`);
};

describe('v2-normative-home-gate (RFC 0189 §A–§D, RFC 0190 §A–§C, RFC 0191 §A)', () => {
  it('a refused home class is refused by name', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    withDeclaration(declare('promptLibrary', 'RFCS/0189-normative-home.md'), (dir) => {
      const rfcHome = run(HOME, [], {}, dir);
      const refusedRfc = rfcHome.status !== 0 && /promptLibrary -> RFCS\/0189-normative-home\.md \(an RFC is history, not operative text/.test(all(rfcHome));
      let refusedExt = false;
      withDeclaration(declare('promptLibrary', 'spec/v2/ext/zz-probe/README.md'), (d2) => {
        probe(d2, 'spec/v2/ext/zz-probe/README.md', 'promptLibrary', true);
        const r = run(HOME, [], {}, d2);
        refusedExt = r.status !== 0 && /promptLibrary -> ext-only \(spec\/v2\/ext\/ is the unwitnessed tail/.test(all(r));
      });
      expect(refusedRfc && refusedExt,
        req('openwop.requirement.0189.home-class', 'RFC 0189 §A / RFC 0190 §B', `a refused class is refused: an RFC is history not operative text (${refusedRfc}), and spec/v2/ext/ is a co-pointer that may not stand alone (${refusedExt}) — ${tail(rfcHome)}`)).toBe(true);
    });
  }, 180_000);

  it('a home that names the family but carries no obligation is refused', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    withDeclaration(declare('promptLibrary', 'spec/v2/core/zz-probe.md'), (dir) => {
      probe(dir, 'spec/v2/core/zz-probe.md', 'promptLibrary', false);
      const r = run(HOME, [], {}, dir);
      expect(r.status !== 0 && /promptLibrary \(named, but no MUST\/SHOULD\/MAY in a paragraph that names it/.test(all(r)),
        req('openwop.requirement.0189.content-predicate', 'RFC 0189 §B', `a home that claims and names promptLibrary but carries no MUST/SHOULD/MAY is refused for exactly that — ${tail(r)}`)).toBe(true);
    });
  }, 180_000);

  it('the ratchets hold on the committed tree', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run(HOME);
    expect(r.status, req('openwop.requirement.0189.ratchet-monotone', 'RFC 0189 §C', `undeclared, undeclared+v1Dependent and facetsUncovered are all at or below baseline — ${tail(r)}`)).toBe(0);
  }, 180_000);

  it('the deadline can actually fire', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    withDeclaration(undeclare('replay'), (dir) => {
      // The ratchet would exit 1 on its own (undeclared rises above a baseline of 0),
      // so the baseline here admits the one undeclared family: the ratchets pass, and
      // only the deadline can fail the run. Without --deadline the same tree exits 0.
      const base = join(dir, 'docs', 'normative-home-baseline.json');
      const b = JSON.parse(readFileSync(base, 'utf8')) as Record<string, unknown>;
      writeFileSync(base, `${JSON.stringify({ ...b, undeclared: 1 }, null, 2)}\n`);
      const quiet = run(HOME, [], { OPENWOP_NORMATIVE_HOME_TODAY: '2026-12-05' }, dir);
      const r = run(HOME, ['--deadline'], { OPENWOP_NORMATIVE_HOME_TODAY: '2026-12-05' }, dir);
      expect([quiet.status, r.status, /end-of-support \(\d{4}-\d{2}-\d{2}\) has passed/.test(all(r))], req('openwop.requirement.0189.deadline-live', 'RFC 0189 §D', `past end-of-support with a family undeclared, the ratchets pass (exit ${quiet.status}) and the deadline alone exits 1 — ${tail(r)}`)).toEqual([0, 1, true]);
    });
  }, 180_000);

  it('the budget measures what the home gate accepts', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run(BUDGET);
    const out = tail(r);
    // RFC 0190 §A's set, computed here and not by the script: every .md under
    // spec/v2/core/ (recursive), plus each spec/v2/ext/ document a core family
    // declares as a home. The script prints one row per measured document.
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.md') ? [join(d, e.name)] : []);
    const v2 = join(root, 'spec', 'v2');
    const decl = JSON.parse(readFileSync(join(v2, 'declaration.json'), 'utf8')) as { families: Array<{ anchor?: string; normativeText?: string[] }> };
    const ext = [...new Set(decl.families.filter((f) => f.anchor === 'core').flatMap((f) => f.normativeText ?? []).filter((h) => h.startsWith('spec/v2/ext/')))];
    const want = [...walk(join(v2, 'core')).map((p) => relative(v2, p)), ...ext.map((h) => h.slice('spec/v2/'.length))].sort();
    const got = String(r.stdout ?? '').split('\n').map((l) => /^\s+\d+\s+(\S+\.md)$/.exec(l)?.[1]).filter((x): x is string => x !== undefined).sort();
    const counted = JSON.stringify(got) === JSON.stringify(want);
    expect(r.status === 0 && counted,
      req('openwop.requirement.0190.budget-denominator', 'RFC 0190 §A', `the measured set is spec/v2/core/** recursive plus any ext document a core family declares — where prose is FILED carries no budget consequence (measured ${got.length}, expected ${want.length}: only in the script [${got.filter((x) => !want.includes(x)).join(', ')}], only in §A [${want.filter((x) => !got.includes(x)).join(', ')}]) — ${out}`)).toBe(true);
  }, 180_000);

  it('the cap grows only as families are homed', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run(BUDGET);
    const m = /cap ([\d,]+) = 25,000 \+ 200 x \((\d+) homed - 9 at RFC 0190\)/.exec(tail(r));
    const ok = m !== null && Number(m[1].replace(/,/g, '')) === 25_000 + 200 * (Number(m[2]) - 9);
    expect(ok, req('openwop.requirement.0190.budget-cap', 'RFC 0190 §A', `the printed cap equals 25,000 + 200 x (resolved - 9); words arrive only when a family passes the §B predicate AND the facet ratchet — ${tail(r)}`)).toBe(true);
  }, 180_000);

  it('the end-of-support fallback is applied, not printed', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    let r = run(HOME), out = '';
    withDeclaration(undeclare('replay'), (dir) => {
      r = run(HOME, ['--deadline'], { OPENWOP_NORMATIVE_HOME_TODAY: '2026-12-05' }, dir);
      out = String(r.stderr ?? '') + String(r.stdout ?? '');
    });
    expect(r.status !== 0 && /fallback does NOT cover/.test(out) && /replay \(no declared home\)/.test(out),
      req('openwop.requirement.0190.fallback-applied', 'RFC 0190 §C', `past end-of-support the gate NAMES what the §D fallback fails to cover rather than printing the fallback and exiting 1 regardless — ${tail(r)}`)).toBe(true);
  }, 180_000);

  it('v1Carried matches the computed v1-dependent set', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run(HOME);
    expect(r.status, req('openwop.requirement.0190.v1carried-matches', 'RFC 0190 §C', `a v1-dependent family absent from v1Carried is what the §D fallback would fail to cover — ${tail(r)}`)).toBe(0);
  }, 180_000);

  it('a home that does not claim the family is refused', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    // `production` is undeclared and matches security-defaults.md only as an
    // English adjective ("a production credential"); the document's marker
    // claims `sandbox` and `compensation`, never `production`.
    withDeclaration(declare('production', 'spec/v2/core/security-defaults.md'), (dir) => {
      const r = run(HOME, [], {}, dir);
      expect(r.status !== 0 && /production -> spec\/v2\/core\/security-defaults\.md \(the document does not claim it/.test(all(r)),
        req('openwop.requirement.0191.home-marker', 'RFC 0191 §A', `security-defaults.md carries no "Normative home: production" marker, so it may not home the family however its prose reads — ${tail(r)}`)).toBe(true);
    });
  }, 180_000);
});

// ─────────────────────────────────────────────────────────────────────
// RFC 0266 §B.1 — the self-contained gate's witnesses (same family: a v2 rule
// whose home is frozen v1). scripts/check-v2-self-contained.mjs lists every v1
// reference in spec/v2, schemas/v2 and api/v2 and fails on one its allow-list
// (scripts/v2-self-contained-allowlist.json) does not name, on a stale row, and,
// with --require-zero-rehome, on any to-rehome row. Each sabotage runs on a
// scratch copy of the gate's inputs and asserts the reason the gate prints.
// Sabotages run 2026-11-24 (each turned its leg red, then was reverted):
// `evaluate` skipped unlisted findings, so a planted spec/v1/ citation passed;
// `evaluate` dropped the stale-row check, so a row with no reference passed.
// @see RFCS/0266-v2-is-self-contained.md

const s266Absent = (): boolean => V1_DIR === null;
const S266_ABSENT = 'corpus not present in this layout (published package) — the gate scripts ship only in the spec repo';
const S266_SPEC = 'RFC 0266 §B.1 · scripts/check-v2-self-contained.mjs';
const S266_ID = 'openwop.requirement.0266.no-v1-rule-citation';
const S266_GATE = 'check-v2-self-contained.mjs';
const S266_ALLOW = 'v2-self-contained-allowlist.json';

interface S266Row { disposition: string; [k: string]: unknown }

/** Copy the gate's inputs to a scratch dir, let `mutate` change it, run the gate there. */
function s266Scratch(mutate: (dir: string) => void, args: string[] = []): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'owp-0266-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    for (const f of [S266_GATE, S266_ALLOW]) cpSync(join(root, 'scripts', f), join(dir, 'scripts', f));
    for (const p of ['spec/v1', 'spec/v2', 'schemas/v2', 'api/v2']) cpSync(join(root, p), join(dir, p), { recursive: true });
    mutate(dir);
    const r = spawnSync('node', [join(dir, 'scripts', S266_GATE), ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const s266EditAllow = (dir: string, fn: (rows: S266Row[]) => S266Row[]): void => {
  const p = join(dir, 'scripts', S266_ALLOW);
  const doc = JSON.parse(readFileSync(p, 'utf8')) as { rows: S266Row[] };
  writeFileSync(p, JSON.stringify({ ...doc, rows: fn(doc.rows) }, null, 2));
};

describe('RFC 0266 §B.1 — no v2 file cites v1 as a rule', () => {
  it('§B.1 the live tree passes and the gate self-test passes', () => {
    if (s266Absent()) return softSkip('inapplicable', S266_ABSENT);
    const live = spawnSync('node', [join(root, 'scripts', S266_GATE)], { encoding: 'utf8' });
    expect(live.status, req(S266_ID, S266_SPEC, `every v1 reference in the live tree MUST be allow-listed: ${live.stderr}`)).toBe(0);
    const self = spawnSync('node', [join(root, 'scripts', S266_GATE), '--self-test'], { encoding: 'utf8' });
    expect(self.status, req(S266_ID, S266_SPEC, `the gate's self-test MUST pass: ${self.stderr}`)).toBe(0);
  });

  it('§B.1 a new spec/v1/ citation in a v2 document fails the gate', () => {
    if (s266Absent()) return softSkip('inapplicable', S266_ABSENT);
    const planted = s266Scratch((dir) => appendFileSync(join(dir, 'spec/v2/core/runs.md'), '\nA run option MUST follow `spec/v1/run-options.md`.\n'));
    expect(planted.status, req(S266_ID, S266_SPEC, 'an unlisted spec/v1/ citation MUST fail the gate')).toBe(1);
    expect(planted.out, req(S266_ID, S266_SPEC, 'the refusal MUST name the unlisted reference')).toContain('unlisted v1 reference (RFC 0266 §B.1): spec/v2/core/runs.md');
    const bare = s266Scratch((dir) => appendFileSync(join(dir, 'spec/v2/core/events.md'), '\nA reducer MUST behave as channels-and-reducers.md says.\n'));
    expect(bare.status, req(S266_ID, S266_SPEC, 'an unlisted bare v1-only document name MUST fail the gate')).toBe(1);
    expect(bare.out, req(S266_ID, S266_SPEC, 'the refusal MUST name the v1 document')).toContain('v1-doc → channels-and-reducers.md');
  });

  it('§B.1 an allow-list row the tree no longer carries fails the gate', () => {
    if (s266Absent()) return softSkip('inapplicable', S266_ABSENT);
    const stale = s266Scratch((dir) => s266EditAllow(dir, (rows) => [...rows, { ...rows[0]!, fingerprint: '000000000000' }]));
    expect(stale.status, req(S266_ID, S266_SPEC, 'a stale allow-list row MUST fail the gate')).toBe(1);
    expect(stale.out, req(S266_ID, S266_SPEC, 'the refusal MUST name the stale row')).toContain('stale allow-list row');
  });

  it('§B.1 --require-zero-rehome fails while a to-rehome row remains', () => {
    if (s266Absent()) return softSkip('inapplicable', S266_ABSENT);
    const allHistory = (rows: S266Row[]): S266Row[] => rows.map((r) => ({ ...r, disposition: 'history' }));
    expect(s266Scratch((dir) => s266EditAllow(dir, allHistory), ['--require-zero-rehome']).status, req(S266_ID, S266_SPEC, 'with no to-rehome row --require-zero-rehome MUST pass')).toBe(0);
    const one = s266Scratch((dir) => s266EditAllow(dir, (rows) => allHistory(rows).map((r, i) => (i === 0 ? { ...r, disposition: 'to-rehome' } : r))), ['--require-zero-rehome']);
    expect(one.status, req(S266_ID, S266_SPEC, 'one to-rehome row MUST fail --require-zero-rehome')).toBe(1);
    expect(one.out, req(S266_ID, S266_SPEC, 'the refusal MUST count the to-rehome rows')).toContain('1 `to-rehome` row(s) remain');
  });
});
