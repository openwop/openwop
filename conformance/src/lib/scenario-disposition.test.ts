/**
 * `deriveRequirementDispositions` at target major 2 — the profile verdict is
 * the certification (rc.45).
 *
 * Until rc.45 a v2 profile with an EMPTY floor produced `certifiable: false`
 * while the emitter's `certified` flag never read the verdict; a floor whose
 * every row was `inapplicable` or `skipped` was certifiable because both are
 * in CERTIFIABLE; and `discoveryOnly` / `runtimeDerived` came from the v1 hand
 * table at major 2, so `openwop-discovery-core` was certifiable whatever its
 * v2 floor file said. Each case below is proven in both directions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRequirementDispositions } from './scenario-disposition.js';
import { requirementIdForScenario, setV2ProfileFloors, v2ProfileFloorFiles } from './requirement-registry.js';
import type { LedgerEntry } from './requirement-ledger.js';

const CONFORMANCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = 'openwop-core-standard';
const DISCOVERY = 'openwop-discovery-core';

type State = 'passed' | 'failed' | 'skipped';

/** A ledger + report for `files`, each with the given disposition. */
function scenario(rows: ReadonlyArray<{ file: string; disposition: LedgerEntry['disposition']; assertionCount?: number }>): { states: Map<string, State>; ledger: LedgerEntry[] } {
  const states = new Map<string, State>();
  const ledger: LedgerEntry[] = [];
  for (const r of rows) {
    const state: State = r.disposition === 'executed-pass' ? 'passed' : r.disposition === 'executed-fail' ? 'failed' : 'skipped';
    states.set(r.file, state);
    ledger.push({
      requirementId: requirementIdForScenario(r.file),
      disposition: r.disposition,
      ...(r.disposition === 'executed-pass' ? { assertionCount: r.assertionCount ?? 3 } : { detail: `test: ${r.disposition} with a reason` }),
      scenarioFile: r.file,
    });
  }
  return { states, ledger };
}

describe('deriveRequirementDispositions at target major 2 (rc.45)', () => {
  const saved = process.env['OPENWOP_TARGET_MAJOR'];
  let floors: Record<string, readonly string[]>;
  beforeEach(() => {
    process.env['OPENWOP_TARGET_MAJOR'] = '2';
    floors = v2ProfileFloorFiles(CONFORMANCE_ROOT);
    setV2ProfileFloors(floors);
  });
  afterEach(() => {
    setV2ProfileFloors(null);
    if (saved === undefined) delete process.env['OPENWOP_TARGET_MAJOR']; else process.env['OPENWOP_TARGET_MAJOR'] = saved;
  });

  it('the declaration mints a non-empty floor for every v2 profile', () => {
    for (const p of [DISCOVERY, CORE, 'openwop-conformance-seams-v2']) expect(floors[p]?.length ?? 0, `${p} floor`).toBeGreaterThan(0);
  });

  it('an empty floor is NOT certifiable (the rc.44 vacuous certification)', () => {
    setV2ProfileFloors({ ...floors, [CORE]: [] });
    const d = deriveRequirementDispositions(new Map(), [], [CORE]);
    const v = d.verdicts.find((x) => x.profile === CORE);
    expect(v?.certifiable).toBe(false);
    expect(v?.witnessedPasses).toBe(0);
    expect(d.totals.blocked).toBe(0); // the old flag would have said certified here
  });

  it('a floor that is inapplicable end to end witnesses nothing and is not certifiable', () => {
    const files = floors[CORE]!;
    const { states, ledger } = scenario(files.map((file) => ({ file, disposition: 'inapplicable' as const })));
    const v = deriveRequirementDispositions(states, ledger, [CORE]).verdicts.find((x) => x.profile === CORE);
    expect(v?.blocking).toEqual([]);
    expect(v?.unclassified).toEqual([]);
    expect(v?.witnessedPasses).toBe(0);
    expect(v?.certifiable).toBe(false);
  });

  it('one witnessed pass beside honest inapplicable rows certifies, and witnessedPasses counts it', () => {
    const files = floors[CORE]!;
    const { states, ledger } = scenario(files.map((file, i) => ({ file, disposition: i === 0 ? ('executed-pass' as const) : ('inapplicable' as const), assertionCount: 4 })));
    const v = deriveRequirementDispositions(states, ledger, [CORE]).verdicts.find((x) => x.profile === CORE);
    expect(v?.certifiable).toBe(true);
    expect(v?.witnessedPasses).toBe(1);
  });

  it('a `skipped` floor row (an opt-in withheld) blocks at major 2', () => {
    const files = floors[CORE]!;
    const { states, ledger } = scenario(files.map((file, i) => ({ file, disposition: i === 1 ? ('skipped' as const) : ('executed-pass' as const) })));
    const v = deriveRequirementDispositions(states, ledger, [CORE]).verdicts.find((x) => x.profile === CORE);
    expect(v?.blocking).toEqual([requirementIdForScenario(files[1]!)]);
    expect(v?.certifiable).toBe(false);
    expect(v?.witnessedPasses).toBe(files.length - 1);
  });

  it('a vacuous pass (assertionCount 0) on a floor row is unclassified and rejects', () => {
    const files = floors[CORE]!;
    const { states, ledger } = scenario(files.map((file, i) => ({ file, disposition: 'executed-pass' as const, assertionCount: i === 0 ? 0 : 2 })));
    const d = deriveRequirementDispositions(states, ledger, [CORE]);
    expect(d.rejectUnclassified).toBe(true);
    expect(d.verdicts.find((x) => x.profile === CORE)?.certifiable).toBe(false);
  });

  it('discovery-core is NOT discoveryOnly at major 2: a failed floor file is not certifiable', () => {
    const files = floors[DISCOVERY]!;
    const { states, ledger } = scenario(files.map((file, i) => ({ file, disposition: i === 0 ? ('executed-fail' as const) : ('executed-pass' as const) })));
    const v = deriveRequirementDispositions(states, ledger, [DISCOVERY]).verdicts.find((x) => x.profile === DISCOVERY);
    expect(v?.certifiable).toBe(false);
    expect(v?.blocking).toEqual([requirementIdForScenario(files[0]!)]);
  });

  it('discovery-core certifies at major 2 when its floor files all pass with assertions', () => {
    const files = floors[DISCOVERY]!;
    const { states, ledger } = scenario(files.map((file) => ({ file, disposition: 'executed-pass' as const })));
    const v = deriveRequirementDispositions(states, ledger, [DISCOVERY]).verdicts.find((x) => x.profile === DISCOVERY);
    expect(v?.certifiable).toBe(true);
    expect(v?.witnessedPasses).toBe(files.length);
  });

  it('at major 1 the v1 hand table still governs: discovery-core is discoveryOnly and certifies with no floor rows', () => {
    setV2ProfileFloors(null);
    delete process.env['OPENWOP_TARGET_MAJOR'];
    const v = deriveRequirementDispositions(new Map(), [], [DISCOVERY]).verdicts.find((x) => x.profile === DISCOVERY);
    expect(v?.certifiable).toBe(true);
  });
});
