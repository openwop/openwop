/**
 * No scenario forks at a sequence it computed past a recorded one.
 *
 * `spec/v2/core/runs.md` §Fork: "A `fromSeq` not in the source log MUST be
 * rejected with `422 fork_point_invalid`." A leg that forks at
 * `sequence + 1` after recording the LAST event of a suspended run names no
 * event, so a conforming host is required to refuse it and the leg can never
 * pass. `v2-a2ui-v09-surface` shipped exactly that in both of its §C.11 legs
 * (corrected in suite 2.37.2): the fix records one more event and forks at the
 * sequence the host REPORTED for it.
 *
 * The rule is mechanical: a `fromSeq` value in a scenario is never arithmetic
 * on another sequence (`fromSeq: x + 1`). Use a sequence read from the log or
 * from a recording response.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SCENARIOS = new URL('../scenarios/', import.meta.url).pathname;

/** `fromSeq: seq + 1`, `fromSeq: (last.sequence) + 2`, `"fromSeq": n+1` … */
const ARITHMETIC_FORK_POINT = /['"]?fromSeq['"]?\s*:\s*[^,}\n]*\+\s*\d/;

function offenders(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(SCENARIOS)) {
    if (!f.endsWith('.test.ts')) continue;
    readFileSync(join(SCENARIOS, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (ARITHMETIC_FORK_POINT.test(line)) out.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe('a fork point is a recorded sequence, never one computed past it', () => {
  it('the detector catches the shipped defect and passes a reported sequence', () => {
    for (const bad of [
      "const fork = await driver.post(`/runs/${id}:fork`, { mode: 'replay', fromSeq: sequence + 1 });",
      '{ "fromSeq": last.sequence + 2 }',
    ]) expect(ARITHMETIC_FORK_POINT.test(bad), bad).toBe(true);
    for (const ok of [
      "const fork = await driver.post(`/runs/${id}:fork`, { mode: 'replay', fromSeq });",
      "{ mode: 'branch', fromSeq: completedSeq, runOptionsOverlay: {} }",
    ]) expect(ARITHMETIC_FORK_POINT.test(ok), ok).toBe(false);
  });

  it('no scenario forks at `<sequence> + N`', () => {
    expect(offenders()).toEqual([]);
  });
});
