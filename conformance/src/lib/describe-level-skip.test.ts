/**
 * A describe-level skip must not leave a FLOOR requirement undispositioned
 * (openwop#1686; RFC 0148 §A).
 *
 * When every test in a file sits under `describe.skipIf(…)` / `describe.skip`
 * and the predicate holds, vitest runs NONE of the setup file's hooks for that
 * file — not `afterEach`, not `afterAll` — so `setup.ts` never records the
 * file's requirement. The runner then finds a floor row with no ledger entry,
 * counts it unclassified, and `rejectUnclassified` rejects the WHOLE
 * certification, not just the profile that floor belongs to. Measured on
 * openwop-app's 2026-09-28 major-1 cut through `byok-roundtrip` (#1708:
 * `certified: none`), and nine more floor files carried the same gate on a
 * fixture a host may honestly withhold.
 *
 * The fix is the `it`-level early return: `if (SKIP) return softSkip('blocked',
 * reason)`. The row then records `blocked` naming the fixture, which denies the
 * one profile and nothing else. `inapplicable` would be wrong: the host
 * advertises the capability the floor witnesses, so the requirement applies to
 * the captured discovery, and a withheld fixture is exactly §A's `blocked`.
 *
 * Two rules, both over the scenario sources (server-free):
 *
 *   1. No v1 floor file (`PROFILE_FLOOR_SCENARIOS`: `required` and every
 *      `conditional` branch) may have ALL its tests under a describe-level
 *      skip. The one exemption is a gate on the absence of a target
 *      (`!process.env.OPENWOP_BASE_URL`): with no host there is no bundle.
 *   2. No other scenario file may either (suite 2.45.1; it began as a ratchet
 *      at 56 in 2.44.9 and was driven to zero). A non-floor all-gated file
 *      records nothing when its gate holds, and the runner resolves it to a
 *      report-derived `blocked` that names no reason. Each such file now opens
 *      every test with `if (GATE) return softSkip(...GATE_WHY)`, where the tuple
 *      names the §A disposition: `inapplicable` for a capability the host does
 *      not advertise, `blocked` for a withheld fixture, and `skipped` for an
 *      operator opt-in that is not set.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROFILE_FLOOR_SCENARIOS } from './profiles.js';

const SCENARIOS = fileURLToPath(new URL('../scenarios/', import.meta.url));

interface GateScan { readonly file: string; readonly gated: number; readonly open: number; readonly predicates: readonly string[] }

function isGatedDescribe(n: ts.CallExpression): { predicate: string } | null {
  const e = n.expression;
  // describe.skipIf(x)(…) / describe.runIf(x)(…)
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression)
    && e.expression.expression.text === 'describe' && ['skipIf', 'runIf'].includes(e.expression.name.text)) {
    return { predicate: e.arguments[0]?.getText() ?? '' };
  }
  // describe.skip(…) / describe.todo(…)
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'describe' && ['skip', 'todo'].includes(e.name.text)) {
    return { predicate: 'true' };
  }
  return null;
}

function isTest(n: ts.CallExpression): boolean {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text === 'it' || e.text === 'test';
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && (e.expression.text === 'it' || e.expression.text === 'test');
}

export function scanDescribeGates(file: string, source: string): GateScan {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let gated = 0;
  let open = 0;
  const predicates: string[] = [];
  const walk = (n: ts.Node, inGate: boolean): void => {
    if (ts.isCallExpression(n)) {
      const gate = isGatedDescribe(n);
      if (gate !== null) {
        predicates.push(gate.predicate);
        for (const a of n.arguments) walk(a, true);
        return;
      }
      if (isTest(n)) {
        if (inGate) gated += 1; else open += 1;
      }
    }
    ts.forEachChild(n, (c) => walk(c, inGate));
  };
  walk(sf, false);
  return { file, gated, open, predicates };
}

/** True when the file can skip end to end: it has gated tests and none outside a gate. */
function allGated(s: GateScan): boolean {
  return s.gated > 0 && s.open === 0;
}

/** A gate on having no target at all — no host, so no bundle and no floor to leave unrecorded. */
function noTargetGate(source: string, predicates: readonly string[]): boolean {
  return predicates.length > 0 && predicates.every((p) => {
    if (p === '!process.env.OPENWOP_BASE_URL') return true;
    const decl = new RegExp(`^const ${p.replace(/[^A-Za-z0-9_]/g, '')} = (.+);$`, 'm').exec(source);
    return decl !== null && /^[A-Z_]+$/.test(p) && decl[1].trim() === '!process.env.OPENWOP_BASE_URL';
  });
}

function floorFiles(): Set<string> {
  const out = new Set<string>();
  for (const floor of Object.values(PROFILE_FLOOR_SCENARIOS)) {
    for (const f of floor.required) out.add(f);
    for (const c of floor.conditional ?? []) for (const f of c.required) out.add(f);
  }
  return out;
}

describe('describe-level skips leave no floor requirement undispositioned (openwop#1686, RFC 0148 §A)', () => {
  const files = readdirSync(SCENARIOS).filter((f) => f.endsWith('.test.ts')).sort();
  const scans = files.map((f) => ({ scan: scanDescribeGates(f, readFileSync(`${SCENARIOS}${f}`, 'utf8')), source: readFileSync(`${SCENARIOS}${f}`, 'utf8') }));
  const floors = floorFiles();

  it('the scanner sees an all-gated file, a mixed file, and a nested test', () => {
    expect(allGated(scanDescribeGates('a.test.ts', "describe.skipIf(X)('d', () => { it('a', () => {}); describe('n', () => { it('b', () => {}); }); });"))).toBe(true);
    expect(allGated(scanDescribeGates('b.test.ts', "describe.skipIf(X)('d', () => { it('a', () => {}); }); it('open', () => {});"))).toBe(false);
    expect(allGated(scanDescribeGates('c.test.ts', "describe.skip('d', () => { it('a', () => {}); });"))).toBe(true);
    expect(allGated(scanDescribeGates('d.test.ts', "describe('d', () => { it('a', () => { if (X) return softSkip('blocked', 'r'); }); });"))).toBe(false);
  });

  it('every floor file the scan must cover exists on disk', () => {
    const missing = [...floors].filter((f) => !files.includes(f));
    expect(missing, `PROFILE_FLOOR_SCENARIOS names files that are not in src/scenarios/: ${missing.join(', ')}`).toEqual([]);
  });

  it('no floor file can skip every test at describe level (an unrecorded floor rejects the whole certification)', () => {
    const offenders = scans
      .filter(({ scan, source }) => floors.has(scan.file) && allGated(scan) && !noTargetGate(source, scan.predicates))
      .map(({ scan }) => `${scan.file} (${scan.gated} test(s) under describe-level ${scan.predicates.join(' / ')})`);
    expect(
      offenders,
      'a floor file whose every test sits under describe.skipIf/describe.skip records NO disposition when the gate holds — vitest runs no setup hook for it — '
        + 'and the runner rejects the whole certification (openwop#1686). Gate each test instead: `if (SKIP) return softSkip(\'blocked\', reason)` naming the withheld fixture. '
        + `Offenders: ${offenders.join('; ')}`,
    ).toEqual([]);
  });

  it('no other scenario file can skip every test at describe level either (each test records why it did not run)', () => {
    const offenders = scans
      .filter(({ scan, source }) => !floors.has(scan.file) && allGated(scan) && !noTargetGate(source, scan.predicates))
      .map(({ scan }) => `${scan.file} (${scan.gated} test(s) under describe-level ${scan.predicates.join(' / ')})`);
    expect(
      offenders,
      'a scenario file whose every test sits under describe.skipIf/describe.skip records NO disposition when the gate holds, so its row names no reason. '
        + 'Gate each test instead: `if (GATE) return softSkip(kind, reason)`, with the RFC 0148 §A kind (inapplicable: capability not advertised; blocked: fixture withheld; skipped: operator opt-in unset). '
        + `Offenders: ${offenders.join('; ')}`,
    ).toEqual([]);
  });
});
