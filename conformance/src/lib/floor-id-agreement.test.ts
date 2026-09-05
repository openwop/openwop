/**
 * The runner and the worker MUST agree on the id a floor file records under
 * (rc.55).
 *
 * The worker (vitest child, `OPENWOP_TARGET_MAJOR=2` in its env) records a v2
 * floor file under `openwop.floor.<stem>` with its assertion count. Until rc.55
 * the `--certify` runner installed the v2 floor map but read `targetMajor()`
 * from ITS OWN process.env, which `--target-major 2` never set — so
 * `requirementIdForFile()` in the runner answered `openwop.scenario.<stem>`,
 * the ledger lookup missed, the row came out report-derived (`executed-pass`,
 * no assertion count) and `verifyBundleV3` rejected the whole bundle as a
 * `vacuous-pass` emitter defect: exit 2, nothing written. A tier-1 host's rc.54
 * origin bundle died this way on 2026-09-05 with six "vacuous" floor files —
 * exactly the floor files vitest had marked `passed`.
 *
 * These tests run with the env UNSET on purpose: that is the runner's state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveRequirementDispositions, requirementIdForFile } from './scenario-disposition.js';
import { requirementIdForScenario, setV2ProfileFloors, v2ProfileFloorFiles } from './requirement-registry.js';
import type { LedgerEntry } from './requirement-ledger.js';

const CONFORMANCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = 'openwop-core-standard';
const FLOOR_FILE = 'v2-era-key.test.ts';

describe('runner ↔ worker floor-id agreement (rc.55)', () => {
  const saved = process.env['OPENWOP_TARGET_MAJOR'];
  let floors: Record<string, readonly string[]>;
  beforeEach(() => {
    // The runner's state: the v2 floor map is installed, the env is NOT set.
    delete process.env['OPENWOP_TARGET_MAJOR'];
    floors = v2ProfileFloorFiles(CONFORMANCE_ROOT);
    setV2ProfileFloors(floors);
  });
  afterEach(() => {
    setV2ProfileFloors(null);
    if (saved === undefined) delete process.env['OPENWOP_TARGET_MAJOR']; else process.env['OPENWOP_TARGET_MAJOR'] = saved;
  });

  it('the fixture is a v2 floor file (or this test proves nothing)', () => {
    expect(floors[CORE], `${CORE} floor`).toContain(FLOOR_FILE);
  });

  it('with the v2 floors installed and the env unset, a floor file maps to its floor id — the id the worker records under', () => {
    expect(requirementIdForFile(FLOOR_FILE)).toBe(requirementIdForScenario(FLOOR_FILE));
    expect(requirementIdForFile(FLOOR_FILE)).toMatch(/^openwop\.floor\./);
  });

  it('a non-floor file still maps to its scenario id', () => {
    expect(requirementIdForFile('v2-run-cancel.test.ts')).toBe('openwop.scenario.v2-run-cancel');
  });

  it("the runner finds the worker's floor row: the bundle row carries the assertion count, not a report-derived pass", () => {
    const ledger: LedgerEntry[] = [{ requirementId: requirementIdForScenario(FLOOR_FILE), disposition: 'executed-pass', assertionCount: 5, scenarioFile: FLOOR_FILE }];
    const states = new Map<string, 'passed' | 'failed' | 'skipped'>([[FLOOR_FILE, 'passed']]);
    const d = deriveRequirementDispositions(states, ledger, [CORE]);
    const row = d.requirements.find((r) => r.scenarioId === FLOOR_FILE && r.requirementId === requirementIdForScenario(FLOOR_FILE));
    expect(row, 'the file row is keyed by the floor id').toBeDefined();
    expect(row?.disposition).toBe('executed-pass');
    expect(row?.assertionCount, 'the count the worker recorded').toBe(5);
    expect(row?.detail ?? '', 'not a report-derived row').not.toMatch(/report-derived/);
    // No second, count-less row for the same file under the scenario id.
    expect(d.requirements.filter((r) => r.scenarioId === FLOOR_FILE && r.disposition === 'executed-pass' && r.assertionCount === undefined)).toEqual([]);
  });
});
