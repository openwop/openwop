import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signBundleV3, verifyBundleV3, witnessDigest, type BundleV3, type BundleV3Requirement } from './certification-bundle-v3.js';
import { checkRungClaim, deriveRung, emittedByNewerSuite, parseRecoveryBounds, type RowEvidence } from './durability-evidence.js';

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const R = 'openwop.requirement.0158.';
const BOUNDS = [{ class: 'unleased', bound: 65_000, terms: [{ name: 'outbox.lease', ms: 60_000 }, { name: 'sweeper.poll', ms: 5_000 }] }, { class: 'leased', bound: 750_000, terms: [{ name: 'dispatch.lease', ms: 720_000 }, { name: 'orphan.sweep', ms: 30_000 }] }];

/** `evidence: undefined` in an override means DROP the evidence — spelled out because this repo compiles with exactOptionalPropertyTypes. */
type Over = Partial<Omit<BundleV3Requirement, 'evidence'>> & { evidence?: RowEvidence | undefined };
function rungRows(over: Partial<Record<string, Over>> = {}): BundleV3Requirement[] {
  const base: Record<string, BundleV3Requirement> = {
    'kill-after-accept': { id: R + 'kill-after-accept', scenario: 'v2-durability-recovery.test.ts', result: 'executed-pass', assertions: 1, evidence: { recovery: { class: 'unleased', boundMs: 65_000, observedMs: 11_700 } } },
    'kill-during-execution': { id: R + 'kill-during-execution', scenario: 'v2-durability-recovery.test.ts', result: 'executed-pass', assertions: 2, evidence: { recovery: { class: 'leased', boundMs: 750_000, observedMs: 726_800 } } },
    'duplicate-delivery': { id: R + 'duplicate-delivery', scenario: 'v2-durability-recovery.test.ts', result: 'executed-pass', assertions: 2 },
    'poison-exhaustion': { id: R + 'poison-exhaustion', scenario: 'v2-durability-recovery.test.ts', result: 'executed-pass', assertions: 3 },
    'bound-is-derived': { id: R + 'bound-is-derived', scenario: 'v2-durability-recovery.test.ts', result: 'executed-pass', assertions: 1, evidence: { recoveryBounds: BOUNDS } },
  };
  return Object.entries(base).map(([k, row]) => {
    const o = over[k];
    if (o === undefined) return row;
    const { evidence, ...rest } = { ...row, ...o };
    return ('evidence' in o && o.evidence === undefined ? rest : { ...rest, ...(evidence === undefined ? {} : { evidence }) }) as BundleV3Requirement;
  });
}

function bundle(rows: BundleV3Requirement[], rung?: string): BundleV3 {
  const nonPass = rows.filter((r) => r.result !== 'executed-pass').map((r) => ({ id: r.id, result: r.result, reason: r.detail ?? '' }));
  const unsigned: Omit<BundleV3, 'signature'> = {
    bundleVersion: '3', generatedAt: '2026-09-21T00:00:00Z',
    suite: { name: '@openwop/openwop-conformance', version: '2.34.0', targetMajor: 2, specArtifactsVersion: '2.34.0' },
    host: { name: 'fixture-host', version: '2.0.0', build: { kind: 'commit', id: 'deadbeef' }, signingKeyId: 'k1' },
    discovery: { url: 'https://fixture.invalid/.well-known/openwop', sha256: 'a'.repeat(64), protocolVersions: ['2.0'], preferredVersion: '2.0' },
    claimedProfiles: [],
    results: { totals: { executedPass: rows.filter((r) => r.result === 'executed-pass').length, executedFail: rows.filter((r) => r.result === 'executed-fail').length, skipped: 0, inapplicable: rows.filter((r) => r.result === 'inapplicable').length, blocked: 0 }, requirements: rows },
    witnessSha256: witnessDigest(rows),
    assertionCount: rows.reduce((n, r) => n + (r.assertions ?? 0), 0),
    ...(nonPass.length > 0 ? { detail: { nonPass } } : {}),
    ...(rung === undefined ? {} : { durability: { rung: rung as never } }),
  };
  return { ...unsigned, signature: signBundleV3(unsigned, pem, 'k1') };
}

describe('row evidence is inside the witness digest, and absent evidence changes nothing', () => {
  // The backward-compatibility claim, held against REAL bundles: every bundle
  // cut before 2.34.0 carries no `evidence`, so its digest must be what it
  // always was. A digest that moved would un-verify every committed bundle.
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'evidence', 'v2-host-bundles');
  it.skipIf(!existsSync(dir))('every committed host bundle still digests to the witnessSha256 it was signed with', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const b = JSON.parse(readFileSync(join(dir, f), 'utf8')) as BundleV3;
      expect(witnessDigest(b.results.requirements), f).toBe(b.witnessSha256);
    }
  });

  it('evidence enters the digest: editing a bound or an observed interval after signing breaks the witness', () => {
    const b = bundle(rungRows(), 'durable-single-instance');
    expect(verifyBundleV3(b).rejections.map((r) => r.kind)).toEqual([]);
    const tampered = JSON.parse(JSON.stringify(b)) as BundleV3;
    const kill = tampered.results.requirements.find((r) => r.id === R + 'kill-during-execution') as { evidence: { recovery: { observedMs: number } } };
    kill.evidence.recovery.observedMs = 5_000; // a flattering number
    expect(verifyBundleV3(tampered).rejections.map((r) => r.kind)).toContain('witness-digest');
    const stripped = JSON.parse(JSON.stringify(b)) as BundleV3;
    delete (stripped.results.requirements.find((r) => r.id === R + 'bound-is-derived') as { evidence?: unknown }).evidence;
    expect(verifyBundleV3(stripped).rejections.map((r) => r.kind)).toContain('witness-digest');
  });
});

describe('deriveRung — the rung is what the signed rows support, never what is claimed', () => {
  it('derives durable-single-instance when all five pass and each kill row names a declared class it resumed inside', () => {
    expect(deriveRung(rungRows()).rung).toBe('durable-single-instance');
  });
  it('no rung when a rung row is not executed-pass — inapplicable is not a witness', () => {
    const d = deriveRung(rungRows({ 'duplicate-delivery': { result: 'inapplicable', detail: 'no seam' } }));
    expect(d.rung).toBeNull(); expect(d.why).toContain('duplicate-delivery');
  });
  it('no rung when a kill row passed but recorded no class — the exercise cannot be bound to a declared bound', () => {
    const d = deriveRung(rungRows({ 'kill-after-accept': { evidence: undefined } }));
    expect(d.rung).toBeNull(); expect(d.why).toContain('no evidence.recovery');
  });
  it('no rung when a kill row is judged against a bound its named class does not declare', () => {
    const d = deriveRung(rungRows({ 'kill-during-execution': { evidence: { recovery: { class: 'unleased', boundMs: 750_000, observedMs: 11_600 } } } }));
    expect(d.rung).toBeNull(); expect(d.why).toContain('labelled with a bound that does not govern it');
  });
  // THE LIMIT, pinned so nobody reads more into class-binding than it does. A
  // tier-1 host shipped this: its seam killed BEFORE the execution claim was
  // held, the 65 s lane rescued the run in 11.6 s, and the exercise was labelled
  // `leased` / 750 s. That names a DECLARED class with its CORRECT bound and an
  // interval INSIDE it — arithmetic cannot refuse it, and this derives a rung.
  // What the evidence changes is that the mislabel is now VISIBLE: a reader sees
  // 11.6 s recorded against a class whose own terms say 720 s of lease. Killing
  // only once the claim is held remains the HOST's obligation (RFC 0158 §E).
  it('a WRONG-but-declared class with an interval inside it IS derivable — visible to a reader, not refusable by arithmetic', () => {
    const d = deriveRung(rungRows({ 'kill-during-execution': { evidence: { recovery: { class: 'leased', boundMs: 750_000, observedMs: 11_600 } } } }));
    expect(d.rung).toBe('durable-single-instance');
  });
  it('no rung when a kill row names a class the host never declared', () => {
    const d = deriveRung(rungRows({ 'kill-after-accept': { evidence: { recovery: { class: 'mystery', boundMs: 65_000, observedMs: 1 } } } }));
    expect(d.rung).toBeNull(); expect(d.why).toContain('does not declare');
  });
  it('no rung when resumption was observed OUTSIDE the declared bound', () => {
    const d = deriveRung(rungRows({ 'kill-after-accept': { evidence: { recovery: { class: 'unleased', boundMs: 65_000, observedMs: 65_001 } } } }));
    expect(d.rung).toBeNull(); expect(d.why).toContain('outside');
  });
});

describe('parseRecoveryBounds — arithmetic a reader can recompute, per class, nothing else', () => {
  it('accepts per-class bounds whose terms sum exactly', () => { expect(parseRecoveryBounds(BOUNDS).ok).toBe(true); });
  it('refuses a bound its terms do not produce (RFC 0158 §B.5)', () => {
    const r = parseRecoveryBounds([{ class: 'leased', bound: 600_000, terms: [{ name: 'dispatch.lease', ms: 720_000 }] }]);
    expect(r.ok).toBe(false); expect(r.ok ? '' : r.why).toContain('sum to 720000');
  });
  it('refuses a total with no terms, a duplicate class, free-text names, and non-integer ms', () => {
    expect(parseRecoveryBounds([{ class: 'a', bound: 5, terms: [] }]).ok).toBe(false);
    expect(parseRecoveryBounds([BOUNDS[0], BOUNDS[0]]).ok).toBe(false);
    expect(parseRecoveryBounds([{ class: 'the leased class (see runbook)', bound: 5, terms: [{ name: 't', ms: 5 }] }]).ok).toBe(false);
    expect(parseRecoveryBounds([{ class: 'a', bound: 5, terms: [{ name: 'OPERATOR — free text with a secret: hunter2', ms: 5 }] }]).ok).toBe(false);
    expect(parseRecoveryBounds([{ class: 'a', bound: 1.5, terms: [{ name: 't', ms: 1.5 }] }]).ok).toBe(false);
    expect(parseRecoveryBounds(undefined).ok).toBe(false);
  });
});

describe('the rung CLAIM is outside the signature, so the verifier re-derives it', () => {
  it('a derivable claim verifies; no claim is always fine', () => {
    expect(verifyBundleV3(bundle(rungRows(), 'durable-single-instance')).rejections).toEqual([]);
    expect(verifyBundleV3(bundle(rungRows())).rejections).toEqual([]);
    expect(checkRungClaim(undefined, []).ok).toBe(true);
  });
  it('a claim the signed rows do not support is REJECTED — it cannot be added to a bundle after the fact', () => {
    const noEvidence = rungRows({ 'kill-after-accept': { evidence: undefined }, 'kill-during-execution': { evidence: undefined }, 'bound-is-derived': { evidence: undefined } });
    const v = verifyBundleV3(bundle(noEvidence, 'durable-single-instance'));
    expect(v.rejections.map((r) => r.kind)).toEqual(['rung-not-derivable']);
  });
  it('a HIGHER rung than the rows support is refused, not assumed — peer-resume evidence is not carried yet', () => {
    const v = verifyBundleV3(bundle(rungRows(), 'durable-multi-instance'));
    expect(v.rejections.map((r) => r.kind)).toEqual(['rung-not-derivable']);
    expect(v.rejections[0]?.detail).toContain('support only durable-single-instance');
  });
  it('an unknown rung name is rejected', () => {
    expect(checkRungClaim('durable-ish', rungRows() as never).ok).toBe(false);
  });
});

describe('emittedByNewerSuite — advice for a verifier older than the bundle it reads', () => {
  it('is true only when the bundle is strictly newer, compared numerically', () => {
    expect(emittedByNewerSuite('2.34.0', '2.33.2')).toBe(true);
    expect(emittedByNewerSuite('2.100.0', '2.34.0')).toBe(true); // not a string compare
    expect(emittedByNewerSuite('2.34.0', '2.34.0')).toBe(false);
    expect(emittedByNewerSuite('2.33.2', '2.34.0')).toBe(false);
    expect(emittedByNewerSuite(undefined, '2.34.0')).toBe(false);
    expect(emittedByNewerSuite('not-a-version', '2.34.0')).toBe(false);
  });
});
