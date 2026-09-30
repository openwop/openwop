/**
 * RFC 0229 §E — the any-of floor group (`requiredAnyOf`), pinned at every
 * floor site that reads it: the runner derivation (the summary row and the
 * claimed-profile verdict), the bundle-v2 verifier, and the v1 bundle
 * verifier. `openwop-secrets` is certified by a witnessed pass of
 * `byok-roundtrip` OR `secrets-run-witness`; never by an `inapplicable` member,
 * and never while a member fails.
 */

import { describe, it, expect } from 'vitest';
import { deriveRequirementDispositions } from './scenario-disposition.js';
import { requirementIdForAnyOf, requirementIdForScenario, requirementsFor } from './requirement-registry.js';
import { PROFILE_FLOOR_SCENARIOS, verifyBundleProfile } from './profiles.js';
import { verifyBundleV2 } from './certification-bundle-verify.js';
import type { Disposition, LedgerEntry } from './requirement-ledger.js';

const PROFILE = 'openwop-secrets';
const BYOK = 'byok-roundtrip.test.ts';
const WITNESS = 'secrets-run-witness.test.ts';
const GROUP = requirementIdForAnyOf([BYOK, WITNESS]);

function entry(file: string, disposition: Disposition, assertionCount = disposition === 'executed-pass' ? 4 : 0): LedgerEntry {
  return { requirementId: requirementIdForScenario(file), disposition, assertionCount, ...(disposition === 'executed-pass' ? {} : { detail: `${file} ${disposition}` }) } as LedgerEntry;
}

function derive(byok: Disposition, witness: Disposition) {
  const rep = new Map<string, 'passed' | 'failed' | 'skipped'>([[BYOK, 'passed'], [WITNESS, 'passed']]);
  const d = deriveRequirementDispositions(rep, [entry(BYOK, byok), entry(WITNESS, witness)], [PROFILE], {});
  return { row: d.requirements.find((r) => r.requirementId === GROUP), verdict: d.verdicts.find((v) => v.profile === PROFILE)! };
}

describe('RFC 0229 §E — the any-of floor group', () => {
  it('openwop-secrets is one any-of requirement over the canary and the run-witness', () => {
    expect(PROFILE_FLOOR_SCENARIOS[PROFILE]?.requiredAnyOf).toEqual([[BYOK, WITNESS]]);
    expect(requirementsFor(PROFILE)).toEqual([GROUP]);
    expect(GROUP).toBe('openwop.floor.anyof.byok-roundtrip+secrets-run-witness');
  });

  it('the runner certifies on a witnessed pass of either member', () => {
    for (const [byok, witness] of [['executed-pass', 'inapplicable'], ['blocked', 'executed-pass'], ['inapplicable', 'executed-pass']] as const) {
      const { row, verdict } = derive(byok, witness);
      expect(row?.disposition, `${byok}/${witness}`).toBe('executed-pass');
      expect(verdict.certifiable, `${byok}/${witness}`).toBe(true);
    }
  });

  it('the runner never certifies on inapplicable members, a blocked canary alone, or a failing member', () => {
    for (const [byok, witness, want] of [['blocked', 'inapplicable', 'blocked'], ['inapplicable', 'skipped', 'blocked'], ['executed-pass', 'executed-fail', 'executed-fail'], ['executed-fail', 'executed-pass', 'executed-fail']] as const) {
      const { row, verdict } = derive(byok, witness);
      expect(row?.disposition, `${byok}/${witness}`).toBe(want);
      expect(verdict.certifiable, `${byok}/${witness}`).toBe(false);
    }
  });

  it('a vacuous member pass (zero assertions) does not satisfy the group', () => {
    const rep = new Map<string, 'passed' | 'failed' | 'skipped'>([[BYOK, 'passed'], [WITNESS, 'passed']]);
    const d = deriveRequirementDispositions(rep, [entry(BYOK, 'executed-pass', 0), entry(WITNESS, 'inapplicable')], [PROFILE], {});
    expect(d.requirements.find((r) => r.requirementId === GROUP)?.disposition).toBe('blocked');
    expect(d.verdicts.find((v) => v.profile === PROFILE)?.certifiable).toBe(false);
  });

  it('the bundle-v2 verifier reads the group the same way', () => {
    const doc = { protocolVersion: '1.0', supportedEnvelopes: [], schemaVersions: {}, limits: {}, secrets: { supported: true, scopes: ['user', 'run'], resolution: 'host-managed' } };
    const bundle = (rows: Array<{ requirementId: string; disposition: Disposition; assertionCount?: number }>) => ({
      bundleVersion: '2', claimedProfiles: [PROFILE], discovery: { document: doc },
      results: { requirements: rows.map((r) => ({ scenarioId: 'x.test.ts', ...r, ...(r.disposition === 'executed-pass' ? {} : { detail: 'd' }) })) },
    });
    const pass = verifyBundleV2(bundle([{ requirementId: requirementIdForScenario(BYOK), disposition: 'blocked' }, { requirementId: requirementIdForScenario(WITNESS), disposition: 'executed-pass', assertionCount: 3 }]) as never);
    expect(pass.profiles[0]?.notCertifiable).toEqual([]);
    const none = verifyBundleV2(bundle([{ requirementId: requirementIdForScenario(BYOK), disposition: 'blocked' }, { requirementId: requirementIdForScenario(WITNESS), disposition: 'inapplicable' }]) as never);
    expect(none.profiles[0]?.notCertifiable).toEqual([GROUP]);
    const fail = verifyBundleV2(bundle([{ requirementId: requirementIdForScenario(BYOK), disposition: 'executed-pass', assertionCount: 2 }, { requirementId: requirementIdForScenario(WITNESS), disposition: 'executed-fail' }]) as never);
    expect(fail.profiles[0]?.notCertifiable).toEqual([GROUP]);
  });

  it('the v1 bundle verifier proves the floor when either member passed', () => {
    const doc = { protocolVersion: '1.0', secrets: { supported: true, scopes: ['user', 'run'], resolution: 'host-managed' } };
    const v = (passed: string[]) => verifyBundleProfile({ discovery: { document: doc as never }, claimedProfiles: [PROFILE], results: { passed } }, PROFILE);
    expect(v([WITNESS]).floorProven).toBe(true);
    expect(v([BYOK]).floorProven).toBe(true);
    expect(v([]).floorProven).toBe(false);
    expect(v([]).missingFloor).toEqual([`${BYOK} | ${WITNESS}`]);
  });
});
