/**
 * v2-eos-clock — `spec/v2/core/overview.md` §v1 end-of-support (RFC 0174 §B.4;
 * charter Phase 5). Corpus wrapper.
 *
 * "Phase 5 computes the date from the matrix; nothing else MAY set it." Three
 * legs, each a spawned gate script:
 *   1. `generate-v1-eos-clock.mjs --check` exits 0 — the checked-in clock file
 *      equals what the matrix and the public history derive;
 *   2. `check-removal-dates.mjs` FAILS under a synthetic clock whose date has
 *      passed — the arming is real, not a green that cannot go red;
 *   3. the same script PASSES under that clock with a synthetic "today" before
 *      the date — the failure is the date, not the file.
 *
 * Legs 2 and 3 are the evidence gate for arming a check whose real trigger is a
 * future date: a gate green because the clock is unset prints the same nothing
 * as one green because the date is far away, so this file drives it both ways
 * and the script prints its clock state on every run. Gates on a spec checkout
 * (V1_DIR).
 *
 * @see spec/v2/core/overview.md §v1 end-of-support
 * @see scripts/generate-v1-eos-clock.mjs
 * @see scripts/check-removal-dates.mjs
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');
const ID = 'openwop.requirement.0174.v1-eos-clock';
const DOC = 'spec/v2/core/overview.md §v1 end-of-support';

function tail(r: SpawnSyncReturns<string>): string {
  return (String(r.stderr ?? '') + String(r.stdout ?? '')).trim().split('\n').slice(-6).join(' | ');
}

describe('v2-eos-clock (overview.md §v1 end-of-support)', () => {
  it('the clock file is current with the matrix and the public history', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = spawnSync('node', [join(root, 'scripts', 'generate-v1-eos-clock.mjs'), '--check'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r.status, req(ID, DOC, `evidence/v1-end-of-support.json MUST equal what generate-v1-eos-clock derives from the INTEROP-MATRIX v2 table and the git history of evidence/v2-host-bundles/ — nothing else MAY set the date — ${tail(r)}`)).toBe(0);
  }, 120_000);

  it('check-removal-dates FAILS the v1-tree sources of v1-end-of-support rows once the clock has passed', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const dir = mkdtempSync(join(tmpdir(), 'openwop-eos-'));
    const clock = join(dir, 'clock.json');
    writeFileSync(clock, JSON.stringify({ endOfSupportNotBefore: '2000-01-01', state: 'synthetic: passed' }));
    const r = spawnSync('node', [join(root, 'scripts', 'check-removal-dates.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENWOP_EOS_CLOCK_FILE: clock }, maxBuffer: 32 * 1024 * 1024 });
    expect(r.status, req(ID, DOC, `with a clock whose date has passed, check-removal-dates MUST exit non-zero on a v1-end-of-support row whose v1-tree source is still present — it exited ${r.status}: ${tail(r)}`)).not.toBe(0);
    expect(String(r.stderr ?? '') + String(r.stdout ?? ''), req(ID, DOC, 'the failure MUST name the row and the source it found')).toMatch(/v1 end-of-support 2000-01-01 has passed/);
  }, 120_000);

  it('check-removal-dates PASSES under the same clock when today is before the date, and prints the clock state', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const dir = mkdtempSync(join(tmpdir(), 'openwop-eos-'));
    const clock = join(dir, 'clock.json');
    writeFileSync(clock, JSON.stringify({ endOfSupportNotBefore: '2000-01-01', state: 'synthetic: not yet' }));
    const r = spawnSync('node', [join(root, 'scripts', 'check-removal-dates.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENWOP_EOS_CLOCK_FILE: clock, OPENWOP_TODAY: '1999-12-31' }, maxBuffer: 32 * 1024 * 1024 });
    expect(r.status, req(ID, DOC, `before the date the same rows are not due — exited ${r.status}: ${tail(r)}`)).toBe(0);
    expect(String(r.stdout ?? ''), req(ID, DOC, 'the script MUST print the clock state on a green run — "not anchored" and "far away" must not print the same nothing')).toMatch(/check-removal-dates clock: .*not due/);
  }, 120_000);

  it('RFC 0234: a frozen old-major tree satisfies a passed date; a marker naming another date does not', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const dir = mkdtempSync(join(tmpdir(), 'openwop-eos-'));
    const clock = join(dir, 'clock.json');
    writeFileSync(clock, JSON.stringify({ endOfSupportNotBefore: '2000-01-01', state: 'synthetic: passed' }));
    const good = join(dir, 'marker-good.json');
    writeFileSync(good, JSON.stringify({ frozenAt: '2000-01-01', rfc: '0234' }));
    const ok = spawnSync('node', [join(root, 'scripts', 'check-removal-dates.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENWOP_EOS_CLOCK_FILE: clock, OPENWOP_V1_EOS_MARKER: good }, maxBuffer: 32 * 1024 * 1024 });
    expect(ok.status, req(ID, DOC, `a passed date with the tree frozen at that date MUST pass — exited ${ok.status}: ${tail(ok)}`)).toBe(0);
    expect(String(ok.stdout ?? ''), req(ID, DOC, 'the frozen state MUST be printed')).toMatch(/FROZEN/);
    const wrong = join(dir, 'marker-wrong.json');
    writeFileSync(wrong, JSON.stringify({ frozenAt: '1999-01-01', rfc: '0234' }));
    const bad = spawnSync('node', [join(root, 'scripts', 'check-removal-dates.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENWOP_EOS_CLOCK_FILE: clock, OPENWOP_V1_EOS_MARKER: wrong }, maxBuffer: 32 * 1024 * 1024 });
    expect(bad.status, req(ID, DOC, `a marker naming a different date MUST NOT freeze the tree — exited ${bad.status}: ${tail(bad)}`)).not.toBe(0);
  }, 120_000);

  it('RFC 0234: an RFC file is history, never a failing old-major source', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const dir = mkdtempSync(join(tmpdir(), 'openwop-eos-'));
    const clock = join(dir, 'clock.json');
    writeFileSync(clock, JSON.stringify({ endOfSupportNotBefore: '2000-01-01', state: 'synthetic: passed' }));
    const r = spawnSync('node', [join(root, 'scripts', 'check-removal-dates.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENWOP_EOS_CLOCK_FILE: clock, OPENWOP_V1_EOS_MARKER: join(dir, 'absent.json') }, maxBuffer: 32 * 1024 * 1024 });
    expect(String(r.stderr ?? ''), req(ID, DOC, 'no failure may name an RFCS/ file — an Accepted RFC is not edited at end-of-support')).not.toMatch(/and RFCS\//);
  }, 120_000);

  it('RFC 0234: an override that does not meet (c) is refused, never silently ignored', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const dir = mkdtempSync(join(tmpdir(), 'openwop-eos-'));
    const cases: Array<[string, Record<string, unknown>]> = [
      ['an RFC that is not Accepted', { date: '2026-01-01', rfc: '0038', trafficEvidence: [{ host: 'x' }] }],
      ['a date that is not earlier', { date: '2999-01-01', rfc: '0230', trafficEvidence: [{ host: 'x' }] }],
      ['no traffic evidence', { date: '2026-01-01', rfc: '0230', trafficEvidence: [] }],
    ];
    for (const [what, body] of cases) {
      const f = join(dir, `override-${what.replace(/\W+/g, '-')}.json`);
      writeFileSync(f, JSON.stringify(body));
      const r = spawnSync('node', [join(root, 'scripts', 'generate-v1-eos-clock.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENWOP_EOS_OVERRIDE_FILE: f }, maxBuffer: 32 * 1024 * 1024 });
      expect(r.status, req(ID, DOC, `${what} MUST be refused — exited ${r.status}: ${tail(r)}`)).not.toBe(0);
      expect(String(r.stderr ?? ''), req(ID, DOC, `${what}: the refusal MUST say why`)).toMatch(/not honourable/);
    }
  }, 120_000);
});
