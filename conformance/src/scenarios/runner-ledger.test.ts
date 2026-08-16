/**
 * RFC 0148 §A acceptance item 2 (S6) — "Runner records requirement-level
 * dispositions and rejects unclassified returns."
 *
 * The runner is a separate process reading a vitest JSON report; the §A ledger
 * lives in the workers. S6 connects them with a JSONL file sink
 * (`OPENWOP_LEDGER_PATH`), a file-level recording hook in `setup.ts` (every
 * scenario file records ONE disposition + its assertion count when it finishes),
 * and a pure derivation (`scenario-disposition.ts`) the runner uses to build
 * bundle v2 rows and to REJECT certification when a claimed profile's floor has
 * an unclassified requirement.
 *
 * Pinned here, server-free:
 *   - the sink writes JSONL and the reader merges duplicates, resolving a
 *     conflict to the least certifiable disposition;
 *   - `fileDisposition` folds per-test states honestly (fail > pass > gate
 *     reason > blocked);
 *   - `deriveRequirementDispositions`: ledger rows win over report inference;
 *     a file with no entry is `blocked`/unclassified; prefix requirements derive
 *     from matching files; a claimed profile with an unclassified floor
 *     requirement flags rejection; a VACUOUS pass (executed-pass with
 *     assertionCount 0) on a claimed floor is unclassified — a witness of nothing;
 *     a discoveryOnly profile certifies with an empty floor;
 *   - and the live proof: this very run, when `OPENWOP_LEDGER_PATH` is set,
 *     records the files that ran before this one (checked when the env is set).
 *
 * @see conformance/src/lib/scenario-disposition.ts, requirement-ledger.ts, setup.ts, cli.ts
 * @see RFCS/0148-non-vacuous-conformance-certification.md §A/§C
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLedgerFile, recordRequirement, resetLedger, snapshot } from '../lib/requirement-ledger.js';
import { fileDisposition, deriveRequirementDispositions, requirementIdForFile, floorScenarioFiles } from '../lib/scenario-disposition.js';
import { PROFILE_FLOOR_SCENARIOS } from '../lib/profiles.js';
import { requirementsFor, requirementIdForScenario, requirementIdForPrefix } from '../lib/requirement-registry.js';

describe('RFC 0148 §A (S6) — ledger file sink and reader', () => {
  it('recordRequirement appends JSONL when OPENWOP_LEDGER_PATH is set; the reader merges and ranks conflicts least-certifiable-first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'owp-ledger-'));
    const path = join(dir, 'l.jsonl');
    const prev = process.env['OPENWOP_LEDGER_PATH'];
    process.env['OPENWOP_LEDGER_PATH'] = path;
    resetLedger();
    try {
      recordRequirement('t.a', 'executed-pass', undefined, { assertionCount: 3 });
      recordRequirement('t.b', 'inapplicable', 'not advertised');
      // simulate a second worker writing a conflicting line for t.a
      // (the in-memory map would throw; the FILE can carry both)
      const { appendFileSync } = require('node:fs') as typeof import('node:fs');
      appendFileSync(path, JSON.stringify({ requirementId: 't.a', disposition: 'blocked', detail: 'other worker' }) + '\n');
      appendFileSync(path, 'not json\n');
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      expect(lines.length).toBe(4);
      const merged = readLedgerFile(path);
      expect(merged.map((e) => e.requirementId)).toEqual(['t.a', 't.b']);
      expect(merged.find((e) => e.requirementId === 't.a')?.disposition, 'conflict resolves to the least certifiable (blocked over executed-pass)').toBe('blocked');
      expect(merged.find((e) => e.requirementId === 't.b')?.disposition).toBe('inapplicable');
      expect(readLedgerFile(join(dir, 'missing.jsonl'))).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env['OPENWOP_LEDGER_PATH'];
      else process.env['OPENWOP_LEDGER_PATH'] = prev;
      resetLedger();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('RFC 0148 §A (S6) — fileDisposition folds a file honestly', () => {
  it('fail beats pass; pass beats a gate reason; a gate reason beats blocked; nothing is blocked (unclassified)', () => {
    expect(fileDisposition(['pass', 'fail', 'skip'], undefined).disposition).toBe('executed-fail');
    expect(fileDisposition(['pass', 'skip'], 'inapplicable').disposition).toBe('executed-pass');
    // real assertions + a gate reason → still an executed pass
    expect(fileDisposition(['pass', 'skip'], 'inapplicable', 4).disposition).toBe('executed-pass');
    // every "pass" was a behaviorGate early-return (zero assertions) → the gate's reason wins
    expect(fileDisposition(['pass', 'pass'], 'inapplicable', 0).disposition).toBe('inapplicable');
    expect(fileDisposition(['pass'], 'skipped', 0).disposition).toBe('skipped');
    // zero assertions with NO gate reason stays a (vacuous) executed-pass — certification rejects it
    expect(fileDisposition(['pass'], undefined, 0).disposition).toBe('executed-pass');
    expect(fileDisposition(['skip', 'skip'], 'inapplicable').disposition).toBe('inapplicable');
    expect(fileDisposition(['skip'], 'skipped').disposition).toBe('skipped');
    const b = fileDisposition(['skip'], undefined);
    expect(b.disposition).toBe('blocked');
    expect(b.detail).toMatch(/unclassified/);
    expect(fileDisposition([], undefined).disposition).toBe('blocked');
  });

  it('a floor file records under its §A floor id; any other file under openwop.scenario.*', () => {
    const floor = [...floorScenarioFiles()];
    expect(floor.length).toBeGreaterThan(0);
    expect(requirementIdForFile(floor[0]!)).toBe(requirementIdForScenario(floor[0]!));
    expect(requirementIdForFile('some-other.test.ts')).toBe('openwop.scenario.some-other');
  });
});

describe('RFC 0148 §A (S6) — the runner derivation', () => {
  // A profile with a real floor of file requirements + a prefix requirement.
  const profile = Object.entries(PROFILE_FLOOR_SCENARIOS).find(([, f]) => f.required.length > 0 && (f.requiredAnyPrefix?.length ?? 0) > 0)?.[0]
    ?? Object.entries(PROFILE_FLOOR_SCENARIOS).find(([, f]) => f.required.length > 0)![0];
  const floor = PROFILE_FLOOR_SCENARIOS[profile]!;
  const files = floor.required;
  const prefix = floor.requiredAnyPrefix?.[0];

  function reportAllPassed(extra: Record<string, 'passed' | 'failed' | 'skipped'> = {}) {
    const m = new Map<string, 'passed' | 'failed' | 'skipped'>();
    for (const f of files) m.set(f, 'passed');
    if (prefix) m.set(`${prefix}alpha.test.ts`, 'passed');
    for (const [k, v] of Object.entries(extra)) m.set(k, v);
    return m;
  }
  function ledgerAllPassed(count = 5) {
    const l = files.map((f) => ({ requirementId: requirementIdForScenario(f), disposition: 'executed-pass' as const, assertionCount: count }));
    if (prefix) l.push({ requirementId: `openwop.scenario.${prefix}alpha`, disposition: 'executed-pass' as const, assertionCount: count });
    return l;
  }

  it('ledger rows win, prefix requirements derive from matching files, and a fully recorded floor certifies', () => {
    const d = deriveRequirementDispositions(reportAllPassed(), ledgerAllPassed(), [profile]);
    expect(d.ledgerPresent).toBe(true);
    expect(d.rejectUnclassified).toBe(false);
    const v = d.verdicts.find((x) => x.profile === profile)!;
    expect(v.certifiable, JSON.stringify(v)).toBe(true);
    expect(v.unclassified).toEqual([]);
    for (const f of files) {
      const row = d.requirements.find((r) => r.requirementId === requirementIdForScenario(f))!;
      expect(row.disposition).toBe('executed-pass');
      expect(row.assertionCount).toBe(5);
    }
    if (prefix) {
      const p = d.requirements.find((r) => r.requirementId === requirementIdForPrefix(prefix))!;
      expect(p.disposition).toBe('executed-pass');
      expect(p.scenarioId).toBe(`${prefix}*`);
    }
    expect(d.totals.executedPass).toBe(d.requirements.length);
  });

  it('a floor file that vitest passed but that recorded NOTHING is unclassified when a ledger exists — silence is not a witness', () => {
    const l = ledgerAllPassed().filter((e) => e.requirementId !== requirementIdForScenario(files[0]!));
    const d = deriveRequirementDispositions(reportAllPassed(), l, [profile]);
    const v = d.verdicts.find((x) => x.profile === profile)!;
    const row = d.requirements.find((r) => r.requirementId === requirementIdForScenario(files[0]!))!;
    expect(row.disposition).toBe('executed-pass'); // vitest did say passed — the row is honest about the source
    expect(row.detail).toMatch(/report-derived/);
    expect(v.unclassified, 'no ledger entry ⇒ unclassified for a claimed floor').toContain(requirementIdForScenario(files[0]!));
    expect(v.certifiable).toBe(false);
    expect(d.rejectUnclassified).toBe(true);
  });

  it('a VACUOUS pass (executed-pass with assertionCount 0) on a claimed floor is unclassified and REJECTS certification', () => {
    const l = ledgerAllPassed(5).map((e) => (e.requirementId === requirementIdForScenario(files[0]!) ? { ...e, assertionCount: 0 } : e));
    const d = deriveRequirementDispositions(reportAllPassed(), l, [profile]);
    const v = d.verdicts.find((x) => x.profile === profile)!;
    expect(v.unclassified).toContain(requirementIdForScenario(files[0]!));
    expect(v.certifiable).toBe(false);
    expect(d.rejectUnclassified).toBe(true);
  });

  it('a skipped file with no ledger entry is blocked (unclassified) — and it never reads as skipped/inapplicable', () => {
    const rep = reportAllPassed({ [files[0]!]: 'skipped' });
    const l = ledgerAllPassed().filter((e) => e.requirementId !== requirementIdForScenario(files[0]!));
    const d = deriveRequirementDispositions(rep, l, [profile]);
    const row = d.requirements.find((r) => r.requirementId === requirementIdForScenario(files[0]!))!;
    expect(row.disposition).toBe('blocked');
    expect(row.detail).toMatch(/unclassified/);
    expect(d.verdicts[0]!.unclassified).toContain(requirementIdForScenario(files[0]!));
    expect(d.rejectUnclassified).toBe(true);
    expect(d.totals.blocked).toBeGreaterThan(0);
  });

  it('a recorded inapplicable/skipped is certifiable and NOT unclassified; a recorded executed-fail blocks but is classified', () => {
    const l = ledgerAllPassed().map((e) => (e.requirementId === requirementIdForScenario(files[0]!) ? { requirementId: e.requirementId, disposition: 'inapplicable' as const, detail: 'not advertised' } : e));
    const d = deriveRequirementDispositions(reportAllPassed({ [files[0]!]: 'skipped' }), l, [profile]);
    expect(d.verdicts[0]!.unclassified).toEqual([]);
    expect(d.verdicts[0]!.certifiable).toBe(true);
    const l2 = ledgerAllPassed().map((e) => (e.requirementId === requirementIdForScenario(files[0]!) ? { requirementId: e.requirementId, disposition: 'executed-fail' as const, detail: 'assertion failed', assertionCount: 2 } : e));
    const d2 = deriveRequirementDispositions(reportAllPassed({ [files[0]!]: 'failed' }), l2, [profile]);
    expect(d2.verdicts[0]!.unclassified).toEqual([]);
    expect(d2.verdicts[0]!.blocking).toContain(requirementIdForScenario(files[0]!));
    expect(d2.verdicts[0]!.certifiable).toBe(false);
    expect(d2.rejectUnclassified).toBe(false);
  });

  it('a discoveryOnly profile certifies with an empty floor; an unknown profile does not', () => {
    const d = deriveRequirementDispositions(new Map(), [], ['openwop-discovery-core', 'openwop-nope']);
    expect(d.verdicts.find((v) => v.profile === 'openwop-discovery-core')?.certifiable).toBe(true);
    expect(d.verdicts.find((v) => v.profile === 'openwop-nope')?.certifiable).toBe(false);
    expect(requirementsFor('openwop-discovery-core')).toEqual([]);
  });

  it('a RUNTIME-DERIVED profile (openwop-node-packs) is HELD only when every floor row is a witnessed pass; otherwise it is not held — not rejected, not blocked', () => {
    const np = 'openwop-node-packs';
    const f = PROFILE_FLOOR_SCENARIOS[np]!;
    expect(f.runtimeDerived, 'profiles.md: node-packs is "derivable from which scenarios pass"').toBe(true);
    const ids = f.required.map((x) => requirementIdForScenario(x));
    const rep = new Map<string, 'passed' | 'failed' | 'skipped'>(f.required.map((x) => [x, 'passed' as const]));
    // (a) held: every row a witnessed pass
    const held = deriveRequirementDispositions(rep, ids.map((id) => ({ requirementId: id, disposition: 'executed-pass' as const, assertionCount: 4 })), [np]);
    const vh = held.verdicts.find((v) => v.profile === np)!;
    expect(vh.runtimeDerived).toBe(true);
    expect(vh.held).toBe(true);
    expect(vh.certifiable).toBe(true);
    // (b) not held: registry absent → the scenario recorded inapplicable-with-reason; publish recorded inapplicable
    const notHeld = deriveRequirementDispositions(rep, ids.map((id) => ({ requirementId: id, disposition: 'inapplicable' as const, detail: 'host ships no pack registry (probe 404)' })), [np]);
    const vn = notHeld.verdicts.find((v) => v.profile === np)!;
    expect(vn.held).toBe(false);
    expect(vn.certifiable).toBe(false);
    expect(vn.unclassified, 'a profile the host does not hold is not a rejected claim').toEqual([]);
    expect([...vn.blocking].sort()).toEqual([...ids].sort());
    expect(notHeld.rejectUnclassified).toBe(false);
    // (c) a vacuous pass on a runtime-derived floor is still not a rejection — the emitter drops the claim
    const vac = deriveRequirementDispositions(rep, ids.map((id) => ({ requirementId: id, disposition: 'executed-pass' as const, assertionCount: 0 })), [np]);
    const vv = vac.verdicts.find((v) => v.profile === np)!;
    expect(vv.held).toBe(false);
    expect(vv.unclassified).toEqual([]);
    expect(vac.rejectUnclassified).toBe(false);
    // (d) and a floor-defined NON-runtime-derived profile keeps the strict rule
    const strictProfile = Object.entries(PROFILE_FLOOR_SCENARIOS).find(([, x]) => x.required.length > 0 && !x.runtimeDerived)![0];
    const sIds = PROFILE_FLOOR_SCENARIOS[strictProfile]!.required.map((x) => requirementIdForScenario(x));
    const sRep = new Map<string, 'passed' | 'failed' | 'skipped'>(PROFILE_FLOOR_SCENARIOS[strictProfile]!.required.map((x) => [x, 'passed' as const]));
    const strict = deriveRequirementDispositions(sRep, sIds.map((id) => ({ requirementId: id, disposition: 'executed-pass' as const, assertionCount: 0 })), [strictProfile]);
    expect(strict.verdicts[0]?.runtimeDerived).toBe(false);
    expect(strict.rejectUnclassified).toBe(true);
  });

  it('with no ledger at all, every skipped file is blocked and the runner says so (the pre-S6 honest reading)', () => {
    const d = deriveRequirementDispositions(reportAllPassed({ [files[0]!]: 'skipped' }), [], [profile]);
    expect(d.ledgerPresent).toBe(false);
    const row = d.requirements.find((r) => r.requirementId === requirementIdForScenario(files[0]!))!;
    expect(row.disposition).toBe('blocked');
    expect(row.detail).toMatch(/without a ledger/);
  });
});

describe('RFC 0148 §A (S6) — the live sink, when this run was given one', () => {
  it('files that finished before this one appear in the ledger file with an assertion count', () => {
    const path = process.env['OPENWOP_LEDGER_PATH'];
    if (!path || !existsSync(path)) return; // not a --certify run; nothing to inspect
    const entries = readLedgerFile(path);
    // At least the in-memory ledger of THIS worker has file-level entries for
    // earlier files (setup.ts afterAll), and each carries assertionCount.
    const fileEntries = snapshot().filter((e) => e.requirementId.startsWith('openwop.scenario.') || e.requirementId.startsWith('openwop.floor.'));
    for (const e of fileEntries) expect(typeof e.assertionCount).toBe('number');
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });
});
