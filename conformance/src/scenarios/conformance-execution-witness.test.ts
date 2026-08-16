/**
 * RFC 0148 §A / RFC 0147 program scenario — `conformance-execution-witness`:
 * an early return cannot become a pass.
 *
 * The runner's file-level record (`resolveFileRecord`, applied by `setup.ts`
 * `afterAll`) is the mechanism that turned every "test returned before its
 * first expect → vitest pass" into a disposition RFC 0148 §A can act on:
 *
 *   - a failed test        ⇒ executed-fail
 *   - a witnessed pass     ⇒ executed-pass (assertionCount > 0)
 *   - a zero-assertion pass with a noted reason (softSkip / seamAbsent /
 *     behaviorGate) ⇒ inapplicable | skipped | blocked, with that reason
 *   - a zero-assertion pass with NO reason ⇒ blocked + the marker detail,
 *     which certification still treats as an UNCLASSIFIED return
 *
 * and the certification layer refuses a claim carrying an unwitnessed row.
 * These legs pin the rule at each layer — runner record, emitter derivation,
 * consumer verifier — with sabotage vectors, so the guarantee is a property
 * the suite defends rather than a property it happens to have.
 *
 * Server-free, always-on; MUST NOT capability-skip (RFC 0148 §Conformance).
 */

import { describe, it, expect } from 'vitest';
import { resolveFileRecord, deriveRequirementDispositions } from '../lib/scenario-disposition.js';
import { UNCLASSIFIED_RETURN_DETAIL } from '../lib/soft-skip.js';
import { PROFILE_FLOOR_SCENARIOS } from '../lib/profiles.js';
import { requirementIdForScenario, requirementsFor } from '../lib/requirement-registry.js';
import { verifyBundleV2, type BundleV2Requirement } from '../lib/certification-bundle-verify.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'server-free: pins the runner/emitter/verifier rule that an early return is never a pass';

const HEX = 'c'.repeat(64);

describe('RFC 0148 §A — conformance-execution-witness: the runner record', () => {
  it('a witnessed pass is executed-pass; a failed test is executed-fail regardless of count', () => {
    expect(resolveFileRecord(['pass', 'pass'], undefined, 7, null).disposition).toBe('executed-pass');
    expect(resolveFileRecord(['pass', 'fail'], undefined, 7, null).disposition).toBe('executed-fail');
    expect(resolveFileRecord(['fail'], undefined, 0, null).disposition).toBe('executed-fail');
  });

  it('a zero-assertion pass with NO reason is BLOCKED with the marker — never a pass', () => {
    const r = resolveFileRecord(['pass', 'pass'], undefined, 0, null);
    expect(r.disposition).toBe('blocked');
    expect(r.detail).toBe(UNCLASSIFIED_RETURN_DETAIL);
  });

  it('a zero-assertion pass takes the noted reason (softSkip / seamAbsent) — inapplicable, skipped, or blocked with the text', () => {
    expect(resolveFileRecord(['pass'], undefined, 0, { kind: 'inapplicable', reason: 'host does not advertise X' })).toEqual({ disposition: 'inapplicable', detail: 'host does not advertise X' });
    expect(resolveFileRecord(['pass'], undefined, 0, { kind: 'blocked', reason: 'seam answered 404' })).toEqual({ disposition: 'blocked', detail: 'seam answered 404' });
    expect(resolveFileRecord(['pass'], undefined, 0, { kind: 'skipped', reason: 'operator opt-out' })).toEqual({ disposition: 'skipped', detail: 'operator opt-out' });
  });

  it('every test ctx.skip()ped takes the noted reason when one was written before the skip, else stays the blocked marker', () => {
    // `ctx.skip()` throws — a `softSkip(...)` AFTER it is dead code. Seven files
    // carried exactly that dead note and reported as unclassified for a suite minor.
    expect(resolveFileRecord(['skip', 'skip'], undefined, 0, { kind: 'inapplicable', reason: 'sandbox not advertised' })).toEqual({ disposition: 'inapplicable', detail: 'sandbox not advertised' });
    expect(resolveFileRecord(['skip'], undefined, 0, { kind: 'blocked', reason: 'simulator seam 404' })).toEqual({ disposition: 'blocked', detail: 'simulator seam 404' });
    const bare = resolveFileRecord(['skip', 'skip'], undefined, 0, null);
    expect(bare.disposition).toBe('blocked');
    expect(bare.detail).toMatch(/every test skipped with no recorded reason/);
    // A behaviorGate reason still wins over a note — the gate is the more specific record.
    expect(resolveFileRecord(['skip'], 'inapplicable', 0, { kind: 'blocked', reason: 'x' }).disposition).toBe('inapplicable');
  });

  it('a behaviorGate reason resolves a zero-assertion pass to inapplicable/skipped; a note outranks nothing but never a witnessed pass', () => {
    expect(resolveFileRecord(['pass'], 'inapplicable', 0, null).disposition).toBe('inapplicable');
    expect(resolveFileRecord(['pass'], 'skipped', 0, null).disposition).toBe('skipped');
    // real assertions ran: the note is irrelevant, the file passed
    expect(resolveFileRecord(['pass'], undefined, 3, { kind: 'blocked', reason: 'irrelevant' }).disposition).toBe('executed-pass');
  });
});

describe('RFC 0148 §A — conformance-execution-witness: emitter and verifier refuse an unwitnessed floor row', () => {
  const profile = 'openwop-core-standard';
  const files = PROFILE_FLOOR_SCENARIOS[profile]!.required;
  const ids = requirementsFor(profile, {}) ?? [];

  it('the emitter derivation marks a marker-blocked floor row unclassified and rejects the claim', () => {
    const rep = new Map<string, 'passed' | 'failed' | 'skipped'>(files.map((f) => [f, 'passed' as const]));
    const ledger = files.map((f) => ({ requirementId: requirementIdForScenario(f), disposition: 'executed-pass' as const, assertionCount: 3 }));
    // sabotage: one floor file returned early with no reason
    ledger[0] = { requirementId: requirementIdForScenario(files[0]!), disposition: 'blocked' as unknown as 'executed-pass', assertionCount: 0, ...( { detail: UNCLASSIFIED_RETURN_DETAIL } as object) } as typeof ledger[number];
    // add the prefix witness so only the sabotaged row is unclassified
    ledger.push({ requirementId: 'openwop.scenario.interrupt-alpha', disposition: 'executed-pass' as const, assertionCount: 2 });
    rep.set('interrupt-alpha.test.ts', 'passed');
    const d = deriveRequirementDispositions(rep, ledger, [profile], {});
    const v = d.verdicts.find((x) => x.profile === profile)!;
    expect(v.unclassified).toEqual([requirementIdForScenario(files[0]!)]);
    expect(d.rejectUnclassified).toBe(true);
    // and the same file with a witnessed pass certifies
    ledger[0] = { requirementId: requirementIdForScenario(files[0]!), disposition: 'executed-pass' as const, assertionCount: 3 };
    const d2 = deriveRequirementDispositions(rep, ledger, [profile], {});
    expect(d2.verdicts.find((x) => x.profile === profile)!.certifiable).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('the consumer verifier rejects a bundle whose required row is a vacuous pass or the runner marker, and accepts the witnessed twin', () => {
    const doc = { protocolVersion: '1.0', supportedEnvelopes: ['clarification.request'], supportedTransports: ['rest'], schemaVersions: { workflow: '1.0' }, limits: { clarificationRounds: 1, schemaRounds: 1, envelopesPerTurn: 1 } };
    const rows: BundleV2Requirement[] = files.map((f) => ({ requirementId: requirementIdForScenario(f), scenarioId: f, disposition: 'executed-pass', assertionCount: 3 }));
    rows.push({ requirementId: 'openwop.scenario.interrupt-alpha', scenarioId: 'interrupt-alpha.test.ts', disposition: 'executed-pass', assertionCount: 2 });
    const bundle = (rs: BundleV2Requirement[]) => ({
      bundleVersion: '2', suite: { package: '@openwop/openwop-conformance', version: '1.123.0' }, host: { name: 'v', version: '0' },
      discovery: { url: 'https://example.invalid/.well-known/openwop', sha256: HEX, document: doc }, claimedProfiles: [profile],
      results: { totals: { executedPass: rs.filter((r) => r.disposition === 'executed-pass').length, executedFail: 0, skipped: 0, inapplicable: 0, blocked: rs.filter((r) => r.disposition === 'blocked').length }, requirements: rs },
      scenarioManifestSha256: HEX, targetConfigurationSha256: HEX,
    });
    expect(verifyBundleV2(bundle(rows)).certified).toBe(true);
    const vacuous = rows.map((r, i) => (i === 0 ? { ...r, assertionCount: 0 } : r));
    expect(verifyBundleV2(bundle(vacuous)).evidenceValid).toBe(false);
    const marker = rows.map((r, i) => (i === 0 ? { requirementId: r.requirementId, scenarioId: r.scenarioId, disposition: 'blocked', detail: UNCLASSIFIED_RETURN_DETAIL, assertionCount: 0 } : r));
    const v = verifyBundleV2(bundle(marker));
    expect(v.evidenceValid).toBe(false);
    expect(v.profiles[0]?.rejections[0]?.kind).toBe('unwitnessed-requirement');
  });
});
