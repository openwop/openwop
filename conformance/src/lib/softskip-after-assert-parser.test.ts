/**
 * softskip-after-assert-parser — self-test for `scripts/check-softskip-after-assert.mjs`.
 *
 * The gate finds soft-skips that follow an assertion inside one it() body.
 * Until 2026-09-27 it scanned raw text and miscounted in both directions:
 *
 *   - a `{` inside a string literal (`'{"valid":'` in a mock program)
 *     unbalanced its brace count, so an it() block ran on into the next one,
 *     and a skip that runs before any assertion was counted as following one
 *     (31 phantom sites; the merge also hid 9 real ones);
 *   - `softSkip('blocked')` quoted in a comment counted as a call.
 *
 * This self-test runs the gate over fixture scenarios (OPENWOP_SOFTSKIP_SCENARIOS_DIR)
 * and pins both shapes, plus a positive control, so the parser cannot drift
 * back into either miscount, and a fix that simply stopped counting anything
 * would fail too.
 *
 * @see scripts/check-softskip-after-assert.mjs
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// conformance/src/lib → repo root. A suite self-test: it runs only in the spec
// repo (vitest.selftest.config.ts), where the root gate script exists.
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const SCRIPT = join(root, 'scripts', 'check-softskip-after-assert.mjs');

// Line numbers matter: the gate reports `file:line`. Keep this fixture's layout
// in step with the expectations below.
const FIXTURE = [
  "it('a: asserts, then holds a string with an unbalanced brace', () => {", //  1
  '  expect(1).toBe(1);', //                                                     2
  "  const program = '{\"valid\":';", //                                         3
  '});', //                                                                      4
  "it('b: skips BEFORE its first assertion', () => {", //                        5
  "  if (x) return softSkip('inapplicable', 'not advertised');", //              6
  '  expect(2).toBe(2);', //                                                     7
  '});', //                                                                      8
  "it('c: quotes a skip in a comment after an assertion', () => {", //           9
  '  expect(3).toBe(3);', //                                                    10
  "  // a plain softSkip('blocked') here would record a partial-witness pass", // 11
  '});', //                                                                     12
  "it('d: positive control, a real skip after an assertion', () => {", //       13
  "  if (/[\"']/.test(s)) return;", //                                          14
  '  expect(4).toBe(4);', //                                                    15
  "  return softSkip('blocked', 'requirement unobserved');", //                 16
  '});', //                                                                     17
  "it('e: an annotated skip after an assertion', () => {", //                   18
  '  expect(5).toBe(5);', //                                                    19
  '  // partial-witness-ok: the requirement was observed above', //             20
  "  return softSkip('inapplicable', 'optional extra');", //                    21
  '});', //                                                                     22
].join('\n');

function listSites(): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-softskip-parser-'));
  writeFileSync(join(dir, 'parser-fixture.test.ts'), `${FIXTURE}\n`);
  const r = spawnSync('node', [SCRIPT, '--list'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, OPENWOP_SOFTSKIP_SCENARIOS_DIR: dir },
  });
  return String(r.stdout ?? '').split('\n').filter((l) => /^(NEW|ok) /.test(l)).map((l) => l.replace(/\s+/g, ' ').trim());
}

describe('softskip-after-assert-parser', () => {
  it('the gate counts real sites only: no phantom from a brace in a string or a skip quoted in a comment', () => {
    // Exactly the real site (d, line 16) and the annotated one (e, line 21). A '{'
    // inside a string must not merge it() a into b, so b's skip (line 6) is NOT
    // after an assertion; a softSkip( inside a comment (line 11) is not a call.
    expect(listSites()).toEqual(['NEW parser-fixture.test.ts:16 blocked', 'ok parser-fixture.test.ts:21 inapplicable']);
  }, 60_000);
});
