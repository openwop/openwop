/**
 * RFC 0148 §A/§C — `certification-bundle-non-vacuous`: a bundle with any
 * unwitnessed required assertion is rejected (RFC 0147 program scenario;
 * RFC 0148 "missing witness and blocked floor reject").
 *
 * This is the CONSUMER half of what `--certify` enforces on emit (S6). A
 * bundle is a claim; a consumer re-derives it from the rows (RFC 0089 §B) and
 * the rows must be witnesses, not lists. `verifyBundleV2` is that
 * re-derivation, and these are its vectors — the shapes RFC 0148 names as
 * fixtures: valid-v2, early-return, missing-floor, duplicate-requirement,
 * tampered-witness — built inline against the LIVE `openwop-core-standard`
 * floor so a floor edit re-runs them against the real requirement ids.
 *
 * Two verdicts are kept apart on purpose:
 *   - `evidenceValid: false` — the document is not acceptable evidence
 *     (unwitnessed / vacuous / duplicate / tampered / canary);
 *   - `certified: false` with valid evidence — an honest `blocked` or
 *     `executed-fail` on a required row. That is the host's state, not the
 *     bundle's defect, and RFC 0148 §A says so.
 *
 * Server-free, always-on; MUST NOT capability-skip (RFC 0148 §Conformance).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { PROFILE_FLOOR_SCENARIOS } from '../lib/profiles.js';
import { requirementIdForScenario, requirementIdForPrefix } from '../lib/requirement-registry.js';
import {
  verifyBundleV2,
  type BundleV2Like,
  type BundleV2Requirement,
} from '../lib/certification-bundle-verify.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'server-free: verifies bundle documents built in-process; no host is contacted';

const HEX = 'a'.repeat(64);
const PROFILE = 'openwop-core-standard';

/** A discovery document from which `openwop-core-standard` derives (§B predicate). */
const CORE_STANDARD_DISCOVERY = {
  protocolVersion: '1.0',
  supportedEnvelopes: ['clarification.request'],
  supportedTransports: ['rest'],
  schemaVersions: { workflow: '1.0' },
  limits: { clarificationRounds: 3, schemaRounds: 3, envelopesPerTurn: 8 },
};

function floor(): { files: string[]; prefixes: string[] } {
  const f = PROFILE_FLOOR_SCENARIOS[PROFILE];
  if (f === undefined) throw new Error(`${PROFILE} has no floor — this scenario is bound to the live floor`);
  return { files: [...f.required], prefixes: [...(f.requiredAnyPrefix ?? [])] };
}

function witnessedRows(): BundleV2Requirement[] {
  const { files, prefixes } = floor();
  const rows: BundleV2Requirement[] = files.map((f) => ({
    requirementId: requirementIdForScenario(f),
    scenarioId: f,
    disposition: 'executed-pass',
    assertionCount: 7,
  }));
  for (const p of prefixes) {
    // one matching scenario row + the emitter's summary row
    rows.push({ requirementId: `openwop.scenario.${p}alpha`, scenarioId: `${p}alpha.test.ts`, disposition: 'executed-pass', assertionCount: 3 });
    rows.push({ requirementId: requirementIdForPrefix(p), scenarioId: `${p}*`, disposition: 'executed-pass', assertionCount: 3 });
  }
  return rows;
}

function totalsFor(rows: readonly BundleV2Requirement[]): BundleV2Like['results']['totals'] {
  const c = (d: string): number => rows.filter((r) => r.disposition === d).length;
  return { executedPass: c('executed-pass'), executedFail: c('executed-fail'), skipped: c('skipped'), inapplicable: c('inapplicable'), blocked: c('blocked') };
}

function bundle(rows: readonly BundleV2Requirement[], overrides: Partial<BundleV2Like> = {}): BundleV2Like & Record<string, unknown> {
  return {
    bundleVersion: '2',
    generatedAt: '2026-08-16T00:00:00.000Z',
    generator: { name: 'test', version: '0.0.0' },
    suite: { package: '@openwop/openwop-conformance', version: '1.114.0' },
    host: { name: 'vector-host', version: '0.0.0' },
    discovery: { url: 'https://example.invalid/.well-known/openwop', sha256: HEX, document: CORE_STANDARD_DISCOVERY },
    claimedProfiles: [PROFILE],
    results: { totals: totalsFor(rows), requirements: [...rows] },
    scenarioManifestSha256: HEX,
    targetConfigurationSha256: HEX,
    ...overrides,
  };
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'certification-bundle-v2.schema.json'), 'utf8')) as Record<string, unknown>;
const schemaValid = ajv.compile(schema);

describe('RFC 0148 §A/§C — certification-bundle-non-vacuous (consumer re-derivation)', () => {
  it('valid-v2: every required row witnessed → evidence valid AND certified (and the vector is schema-valid)', () => {
    const b = bundle(witnessedRows());
    expect(schemaValid(b), JSON.stringify(schemaValid.errors)).toBe(true);
    const v = verifyBundleV2(b);
    expect(v.rejections).toEqual([]);
    expect(v.evidenceValid).toBe(true);
    expect(v.certified).toBe(true);
    const p = v.profiles.find((x) => x.profile === PROFILE);
    expect(p?.derivable).toBe(true);
    expect(p?.required.length).toBeGreaterThan(5);
  });

  it('early-return: a required row that is executed-pass with assertionCount 0 REJECTS the evidence', () => {
    const rows = witnessedRows();
    rows[0] = { ...(rows[0] as BundleV2Requirement), assertionCount: 0 };
    const v = verifyBundleV2(bundle(rows));
    expect(v.evidenceValid).toBe(false);
    expect(v.certified).toBe(false);
    const p = v.profiles[0];
    expect(p?.rejections.map((r) => r.kind)).toEqual(['vacuous-pass']);
    expect(p?.rejections[0]?.requirementId).toBe(rows[0]?.requirementId);
  });

  it('early-return (no count at all): an executed-pass with NO assertionCount is unwitnessed and REJECTS', () => {
    const rows = witnessedRows();
    const { assertionCount: _drop, ...noCount } = rows[1] as BundleV2Requirement & { assertionCount: number };
    rows[1] = noCount;
    const v = verifyBundleV2(bundle(rows));
    expect(v.evidenceValid).toBe(false);
    expect(v.profiles[0]?.rejections[0]?.kind).toBe('vacuous-pass');
  });

  it('missing-floor: a required requirement with no row at all REJECTS (unwitnessed), never "not certified"', () => {
    const rows = witnessedRows().slice(1); // drop the first floor row
    const dropped = requirementIdForScenario(floor().files[0] as string);
    const v = verifyBundleV2(bundle(rows));
    expect(v.evidenceValid).toBe(false);
    const rej = v.profiles[0]?.rejections ?? [];
    expect(rej.map((r) => r.kind)).toEqual(['unwitnessed-requirement']);
    expect(rej[0]?.requirementId).toBe(dropped);
    // and the row is NOT reported as merely not-certifiable
    expect(v.profiles[0]?.notCertifiable).not.toContain(dropped);
  });

  it('missing prefix witness: no `interrupt-*` scenario row and no summary row REJECTS the prefix requirement', () => {
    const { prefixes } = floor();
    if (prefixes.length === 0) return; // floor without a prefix requirement — nothing to assert here
    const rows = witnessedRows().filter((r) => !prefixes.some((p) => r.scenarioId.startsWith(p)));
    const v = verifyBundleV2(bundle(rows));
    expect(v.evidenceValid).toBe(false);
    expect(v.profiles[0]?.rejections.some((r) => r.kind === 'unwitnessed-requirement' && r.requirementId === requirementIdForPrefix(prefixes[0] as string))).toBe(true);
  });

  it('duplicate-requirement: two rows for one requirement REJECTS (exactly one disposition per requirement)', () => {
    const rows = witnessedRows();
    rows.push({ ...(rows[0] as BundleV2Requirement) });
    const v = verifyBundleV2(bundle(rows));
    expect(v.evidenceValid).toBe(false);
    expect(v.rejections.map((r) => r.kind)).toContain('duplicate-requirement');
  });

  it('tampered-witness: totals that disagree with the rows REJECT — a hand-edited count is not a witness', () => {
    const rows = witnessedRows();
    const b = bundle(rows);
    const tampered = { ...b, results: { ...b.results, totals: { ...b.results.totals, blocked: 0, executedPass: b.results.totals.executedPass + 1 } } };
    const v = verifyBundleV2(tampered);
    expect(v.evidenceValid).toBe(false);
    expect(v.rejections.map((r) => r.kind)).toEqual(['totals-mismatch']);
  });

  it('tampered-witness: an invented disposition name REJECTS', () => {
    const rows = witnessedRows();
    rows[0] = { ...(rows[0] as BundleV2Requirement), disposition: 'passed' };
    const v = verifyBundleV2(bundle(rows));
    expect(v.rejections.some((r) => r.kind === 'unknown-disposition')).toBe(true);
    expect(v.evidenceValid).toBe(false);
  });

  it('a non-pass without a reason REJECTS (RFC 0148 §A: anything other than executed-pass says why)', () => {
    const rows = witnessedRows();
    rows[0] = { requirementId: (rows[0] as BundleV2Requirement).requirementId, scenarioId: (rows[0] as BundleV2Requirement).scenarioId, disposition: 'blocked' };
    const v = verifyBundleV2(bundle(rows));
    expect(v.rejections.map((r) => r.kind)).toContain('reason-missing');
  });

  it('blocked-floor: an HONEST blocked row on a required requirement is VALID evidence that does NOT certify', () => {
    const rows = witnessedRows();
    rows[0] = { ...(rows[0] as BundleV2Requirement), disposition: 'blocked', detail: 'seam unreachable from this runner (host-callback)' };
    delete (rows[0] as { assertionCount?: number }).assertionCount;
    const v = verifyBundleV2(bundle(rows));
    expect(v.rejections).toEqual([]);
    expect(v.evidenceValid).toBe(true);
    expect(v.certified).toBe(false);
    expect(v.profiles[0]?.notCertifiable).toEqual([(rows[0] as BundleV2Requirement).requirementId]);
  });

  it('executed-fail on a required row: valid evidence, not certified', () => {
    const rows = witnessedRows();
    rows[2] = { ...(rows[2] as BundleV2Requirement), disposition: 'executed-fail', detail: 'assertion failed against target', assertionCount: 4 };
    const v = verifyBundleV2(bundle(rows));
    expect(v.evidenceValid).toBe(true);
    expect(v.certified).toBe(false);
  });

  it('inapplicable / skipped with a reason on a required row certifies (RFC 0148 §A CERTIFIABLE set)', () => {
    const rows = witnessedRows();
    rows[0] = { requirementId: (rows[0] as BundleV2Requirement).requirementId, scenarioId: (rows[0] as BundleV2Requirement).scenarioId, disposition: 'inapplicable', detail: 'profile not advertised in the captured discovery set', assertionCount: 0 };
    rows[1] = { requirementId: (rows[1] as BundleV2Requirement).requirementId, scenarioId: (rows[1] as BundleV2Requirement).scenarioId, disposition: 'skipped', detail: 'operator opted the profile out (OPENWOP_OPTED_OUT_PROFILES)' };
    const v = verifyBundleV2(bundle(rows));
    expect(v.evidenceValid).toBe(true);
    expect(v.certified).toBe(true);
  });

  it('a claim the discovery document does not derive is not certified even with perfect rows (RFC 0089 §B(1))', () => {
    const b = bundle(witnessedRows(), { discovery: { document: { protocolVersion: '1.0' } } });
    const v = verifyBundleV2(b);
    expect(v.evidenceValid).toBe(true);
    expect(v.profiles[0]?.derivable).toBe(false);
    expect(v.certified).toBe(false);
  });

  it('a claimed profile with NO defined floor is unprovable — floorUnspecified, never certified (G6)', () => {
    const b = bundle(witnessedRows(), { claimedProfiles: ['openwop-not-a-profile'] });
    const v = verifyBundleV2(b);
    expect(v.profiles[0]?.floorUnspecified).toBe(true);
    expect(v.certified).toBe(false);
  });

  it('a discovery-only profile certifies on derivation alone (RFC 0155 §A: openwop-discovery-core)', () => {
    const b = bundle(witnessedRows(), { claimedProfiles: ['openwop-discovery-core'] });
    const v = verifyBundleV2(b);
    expect(v.certified).toBe(true);
  });

  it('a v1 document handed to the v2 verifier is rejected as not-v2 rather than silently read', () => {
    const b = bundle(witnessedRows(), { bundleVersion: '1' });
    const v = verifyBundleV2(b);
    expect(v.rejections.map((r) => r.kind)).toContain('not-v2');
  });
});
