import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADVERTISED_BOUND_GRACE_MS, DEFAULT_RETRY_WAIT_CAP_MS, MAX_RETRY_WAIT_CAP_MS, MAX_RETRY_WAIT_MS, RETRY_WAIT_ENV, RETRY_WAIT_FLOOR_MS, advertisedMaxElapsedMs, pastAdvertisedBound, retryTestTimeoutMs, retryWaitCapMs, retryWaitFor, windowClosedNote } from './webhook-retry-window.js';

describe('the webhook retry window is operator-RAISABLE and never lowerable', () => {
  it('defaults to 90 s when unset, empty, or not a number', () => {
    expect(retryWaitCapMs({})).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: 'five minutes' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
  });
  it('is raised by a larger value — the 15/30/60/120 s, five-attempt host needs > 225 s and gets it', () => {
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '300000' })).toBe(300_000);
  });
  // The property that keeps this from being a way to hide a slow retry.
  it('IGNORES a smaller value: no operator can shrink the window', () => {
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '1000' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '0' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '-5' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
  });
  it('is bounded above, so a typo cannot hold a certification cut open for a day', () => {
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: '86400000' })).toBe(MAX_RETRY_WAIT_CAP_MS);
    expect(retryWaitCapMs({ [RETRY_WAIT_ENV]: 'Infinity' })).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
  });
  it('a host that advertises no policy, or backoff none, is measured at the 20 s floor whatever the cap', () => {
    expect(retryWaitFor(null, 300_000)).toBe(RETRY_WAIT_FLOOR_MS);
    expect(retryWaitFor({ backoff: 'none' }, 300_000)).toBe(RETRY_WAIT_FLOOR_MS);
    expect(retryWaitFor({}, 300_000)).toBe(RETRY_WAIT_FLOOR_MS);
    expect(retryWaitFor({ backoff: 'exponential' }, 300_000)).toBe(300_000);
    expect(retryWaitFor({ backoff: 'fixed' }, DEFAULT_RETRY_WAIT_CAP_MS)).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
  });
  it('the blocked note names the variable, the numbers the run used, and whether it was already raised', () => {
    const d = windowClosedNote(4, 5, 90_000, DEFAULT_RETRY_WAIT_CAP_MS);
    expect(d).toContain('4 of the advertised 5'); expect(d).toContain(RETRY_WAIT_ENV); expect(d).toContain('never lowered');
    expect(windowClosedNote(4, 5, 120_000, 120_000)).toContain('already raised to 120000ms');
  });
  // RFC 0225: an advertised maxElapsedMs sets the window, and only it lets a row convict.
  it('an advertised maxElapsedMs sets the wait to the bound plus the grace, never below the cap, never above the hour', () => {
    expect(retryWaitFor({ backoff: 'exponential', maxElapsedMs: 540_000 }, DEFAULT_RETRY_WAIT_CAP_MS)).toBe(540_000 + ADVERTISED_BOUND_GRACE_MS);
    expect(retryWaitFor({ backoff: 'none', maxElapsedMs: 10_000 }, DEFAULT_RETRY_WAIT_CAP_MS)).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
    expect(retryWaitFor({ backoff: 'exponential', maxElapsedMs: 540_000 }, 900_000)).toBe(900_000);
    expect(retryWaitFor({ backoff: 'fixed', maxElapsedMs: 7_200_000 }, DEFAULT_RETRY_WAIT_CAP_MS)).toBe(MAX_RETRY_WAIT_CAP_MS);
  });
  it('a malformed maxElapsedMs is ignored, so the host is measured as if it advertised none', () => {
    for (const v of [0, -1, 1.5, '540000', null]) expect(advertisedMaxElapsedMs({ maxElapsedMs: v })).toBeNull();
    expect(retryWaitFor({ backoff: 'exponential', maxElapsedMs: 0 }, DEFAULT_RETRY_WAIT_CAP_MS)).toBe(DEFAULT_RETRY_WAIT_CAP_MS);
  });
  it('a row may convict only past the advertised bound plus the grace', () => {
    expect(pastAdvertisedBound(null, 3_600_000)).toBe(false);
    expect(pastAdvertisedBound({ backoff: 'exponential' }, 3_600_000)).toBe(false);
    expect(pastAdvertisedBound({ maxElapsedMs: 60_000 }, 60_000 + ADVERTISED_BOUND_GRACE_MS - 1)).toBe(false);
    expect(pastAdvertisedBound({ maxElapsedMs: 60_000 }, 60_000 + ADVERTISED_BOUND_GRACE_MS)).toBe(true);
  });
});

/**
 * Suite 2.44.1: a test's timeout MUST cover the longest its retry waits can
 * run. vitest fixes the timeout at registration, before discovery is read, so
 * 2.44.0's cap-derived timeouts (210 s by default) killed the dead-letter leg
 * of a host advertising `maxElapsedMs: 600000` before its own wait elapsed.
 * The assertion is over the CALL SITES, because that is where the regression
 * would reappear.
 */
const SCENARIOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scenarios');

interface RetryTest { readonly file: string; readonly title: string; readonly waits: number; readonly timeout: string }

/** Every `it` in `src` that awaits a retry window, with how many and the timeout expression it registers. */
function retryWaitTests(file: string, src: string): RetryTest[] {
  // A retry window is `retryWaitMs(...)`, or a local bound from `retryWaitFor(...)`.
  const idents = [...src.matchAll(/const (\w+) = retryWaitFor\(/g)].map((m) => m[1]!);
  const windowArg = `(?:retryWaitMs\\([^()]*\\)${idents.map((i) => `|${i}`).join('')})`;
  const waitCall = new RegExp(`,\\s*${windowArg}\\s*\\);`, 'g');
  const out: RetryTest[] = [];
  for (const m of src.matchAll(/\n( *)it\((['"`])(.*?)\2, *async \([^)]*\) *=> *\{/g)) {
    const indent = m[1]!;
    const start = m.index! + m[0].length;
    const close = new RegExp(`\\n${indent}\\}(?:, *([^\\n]+?))?\\);`, 'g');
    close.lastIndex = start;
    const end = close.exec(src);
    if (!end) throw new Error(`${file}: cannot find the end of it(${JSON.stringify(m[3])})`);
    const waits = (src.slice(start, end.index).match(waitCall) ?? []).length;
    if (waits > 0) out.push({ file, title: m[3]!, waits, timeout: (end[1] ?? '').trim() });
  }
  return out;
}

/** The number of waits a timeout expression covers: `retryTestTimeoutMs(N, …)`, directly or through a file-level const. 0 when it covers none. */
function coveredWaits(src: string, expr: string): number {
  const viaConst = /^[A-Z_][A-Z0-9_]*$/.test(expr) ? new RegExp(`const ${expr} = ([^;]+);`).exec(src)?.[1] ?? '' : expr;
  const m = /^retryTestTimeoutMs\((\d+),/.exec(viaConst.trim());
  return m ? Number(m[1]) : 0;
}

describe('a test that awaits a retry window has a timeout that covers it (suite 2.44.1)', () => {
  it('retryWaitFor never exceeds MAX_RETRY_WAIT_MS, whatever the advert or the operator cap', () => {
    for (const cap of [retryWaitCapMs({}), retryWaitCapMs({ [RETRY_WAIT_ENV]: '86400000' }), 10 * MAX_RETRY_WAIT_CAP_MS]) {
      for (const policy of [null, {}, { backoff: 'none' }, { backoff: 'exponential' }, { backoff: 'fixed' }, { maxElapsedMs: 600_000 }, { maxElapsedMs: 86_400_000 }]) {
        expect(retryWaitFor(policy, cap)).toBeLessThanOrEqual(MAX_RETRY_WAIT_MS);
      }
    }
  });
  it('a host advertising maxElapsedMs 600000 waits 630 s, and a one- or two-wait timeout outlasts it', () => {
    const wait = retryWaitFor({ backoff: 'exponential', maxElapsedMs: 600_000 }, DEFAULT_RETRY_WAIT_CAP_MS);
    expect(wait).toBe(630_000);
    expect(retryTestTimeoutMs(1, 30_000)).toBeGreaterThan(wait);
    expect(retryTestTimeoutMs(2, 30_000)).toBeGreaterThan(2 * wait);
    expect(retryTestTimeoutMs(2, 30_000)).toBe(2 * MAX_RETRY_WAIT_MS + 30_000);
  });
  it('the scanner reads a cap-derived timeout as covering nothing, and a derived one as covering its waits', () => {
    const sabotaged = "const T = CAP * 2 + 1;\ndescribe('x', () => {\n  it('a', async () => {\n    await waitFor(() => true, retryWaitMs(doc));\n  }, T);\n});\n";
    const [t] = retryWaitTests('sabotaged.ts', sabotaged);
    expect(t?.waits).toBe(1);
    expect(coveredWaits(sabotaged, t!.timeout)).toBe(0);
    const fixed = sabotaged.replace('CAP * 2 + 1', 'retryTestTimeoutMs(1, 1)');
    expect(coveredWaits(fixed, retryWaitTests('fixed.ts', fixed)[0]!.timeout)).toBe(1);
  });
  it('every scenario test that awaits a retry window registers a timeout covering each wait', () => {
    const found: RetryTest[] = [];
    const users: string[] = [];
    for (const f of readdirSync(SCENARIOS).filter((n) => n.endsWith('.test.ts')).sort()) {
      const src = readFileSync(join(SCENARIOS, f), 'utf8');
      if (!/\bretryWaitFor\(/.test(src)) continue;
      users.push(f);
      found.push(...retryWaitTests(f, src));
    }
    // The scanner must see a wait in every file that computes one, or a
    // silent parse miss would pass everything.
    expect(new Set(found.map((t) => t.file))).toEqual(new Set(users));
    const short = found.filter((t) => coveredWaits(readFileSync(join(SCENARIOS, t.file), 'utf8'), t.timeout) < t.waits);
    expect(short.map((t) => `${t.file} it(${JSON.stringify(t.title)}): ${t.waits} retry wait(s) under timeout \`${t.timeout || 'the harness default'}\``)).toEqual([]);
  });
});
