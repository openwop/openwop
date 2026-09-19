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
 * @see RFCS/0189-normative-home.md · RFCS/0190-kernel-budget-denominator.md · RFCS/0191-normative-home-marker.md
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    for (const p of ['scripts', 'spec', 'schemas', 'docs', 'evidence']) {
      cpSync(join(root, p), join(dir, p), { recursive: true });
    }
    fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const HOME = 'check-v2-normative-home.mjs';
const BUDGET = 'check-core-budget.mjs';


const tail = (r: SpawnSyncReturns<string>): string =>
  (String(r.stderr ?? '') + String(r.stdout ?? '')).trim().split('\n').slice(-6).join(' | ');
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
const declare = (key: string, home: string) => (s: string) =>
  s.replace(new RegExp(`("key": "${key}",\\n(\\s+)"kind": "family",)`), (_m, head, pad) => `${head}\n${pad}"normativeText": ["${home}"],`);

describe('v2-normative-home-gate (RFC 0189 §A–§D, RFC 0190 §A–§C, RFC 0191 §A)', () => {
  it('a refused home class is refused by name', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    withDeclaration(declare('promptLibrary', 'RFCS/0189-normative-home.md'), (dir) => {
      const rfcHome = run(HOME, [], {}, dir);
      const refusedRfc = rfcHome.status !== 0 && /promptLibrary/.test(tail(rfcHome));
      let refusedExt = false;
      withDeclaration(declare('promptLibrary', 'spec/v2/ext/README.md'), (d2) => { refusedExt = run(HOME, [], {}, d2).status !== 0; });
      expect(refusedRfc && refusedExt,
        req('openwop.requirement.0189.home-class', 'RFC 0189 §A / RFC 0190 §B', `a refused class is refused: an RFC is history not operative text (${refusedRfc}), and spec/v2/ext/ is a co-pointer that may not stand alone (${refusedExt}) — ${tail(rfcHome)}`)).toBe(true);
    });
  }, 180_000);

  it('a home that names the family but carries no obligation is refused', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    withDeclaration(declare('promptLibrary', 'spec/v1/host-capabilities.md'), (dir) => {
      const r = run(HOME, [], {}, dir);
      expect(r.status !== 0 && /promptLibrary/.test(tail(r)),
        req('openwop.requirement.0189.content-predicate', 'RFC 0189 §B', `§host.promptLibrary is titled for the family and carries zero MUSTs — refused — ${tail(r)}`)).toBe(true);
    });
  }, 180_000);

  it('the ratchets hold on the committed tree', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run(HOME);
    expect(r.status, req('openwop.requirement.0189.ratchet-monotone', 'RFC 0189 §C', `undeclared, undeclared+v1Dependent and facetsUncovered are all at or below baseline — ${tail(r)}`)).toBe(0);
  }, 180_000);

  it('the deadline can actually fire', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run(HOME, ['--deadline'], { OPENWOP_NORMATIVE_HOME_TODAY: '2026-12-05' });
    expect(r.status, req('openwop.requirement.0189.deadline-live', 'RFC 0189 §D', `past end-of-support with families still undeclared the gate exits 1 — ${tail(r)}`)).toBe(1);
  }, 180_000);

  it('the budget measures what the home gate accepts', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = run(BUDGET);
    const out = tail(r);
    const counted = /\(incl\. \d+ ext home\(s\) cited by a core family\)|words across \d+ document\(s\)/.test(out);
    expect(r.status === 0 && counted,
      req('openwop.requirement.0190.budget-denominator', 'RFC 0190 §A', `the measured set is spec/v2/core/** recursive plus any ext document a core family declares — where prose is FILED carries no budget consequence — ${out}`)).toBe(true);
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
    const r = run(HOME, ['--deadline'], { OPENWOP_NORMATIVE_HOME_TODAY: '2026-12-05' });
    const out = (String(r.stderr ?? '') + String(r.stdout ?? ''));
    expect(r.status !== 0 && /fallback does NOT cover/.test(out) && /no declared home/.test(out),
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
      expect(r.status !== 0 && /production/.test(tail(r)),
        req('openwop.requirement.0191.home-marker', 'RFC 0191 §A', `security-defaults.md carries no "Normative home: production" marker, so it may not home the family however its prose reads — ${tail(r)}`)).toBe(true);
    });
  }, 180_000);
});
