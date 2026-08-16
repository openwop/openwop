/**
 * RFC 0148 §A/§C — consumer-side verification of a certification bundle v2,
 * and the evidence scrubber the emitter runs before a bundle is written.
 *
 * `verifyBundle()` in `profiles.ts` reads bundle v1 (`results.passed` lists).
 * v2 replaced the lists with per-requirement dispositions, and a v2 consumer
 * MUST re-derive from those rows rather than trust `claimedProfiles` — RFC
 * 0089 §B still binds, and RFC 0148 adds what v1 could not say:
 *
 *   - a required row that is MISSING is an unwitnessed requirement — the bundle
 *     is REJECTED as evidence, not merely "not certified";
 *   - an `executed-pass` with `assertionCount: 0` (or with no count at all) is
 *     a witness of nothing — REJECTED;
 *   - two rows for one requirement is exactly-one-disposition-per-requirement
 *     broken — REJECTED;
 *   - totals that disagree with the rows they summarize are a tampered or
 *     hand-edited witness — REJECTED;
 *   - the conformance secret canary anywhere in the document is evidence that
 *     leaked a secret — REJECTED (`threat-model-secret-leakage.md` §SR-1);
 *   - a required row that is honestly `blocked` or `executed-fail` is VALID
 *     evidence of a claim that does NOT certify. That is the state of the
 *     host, not a defect in the bundle, and the two verdicts are kept apart.
 *
 * Server-free; no I/O.
 */

import { createHash } from 'node:crypto';
import {
  PROFILE_FLOOR_SCENARIOS,
  profileDerivable,
  type DiscoveryPayload,
} from './profiles.js';
import { CERTIFIABLE, DISPOSITIONS, type Disposition } from './requirement-ledger.js';
import { floorFilesFor, requirementIdForPrefix, requirementIdForScenario } from './requirement-registry.js';
import { UNCLASSIFIED_RETURN_DETAIL } from './soft-skip.js';

/**
 * The BYOK conformance canary (`fixtures.md` §conformance-secrets-roundtrip;
 * SR-1). Its raw value MUST NOT appear on any observable channel — variables,
 * events, debug bundles, logs — and a certification bundle is one more
 * observable channel. A verifier can check for THIS literal without knowing
 * any operator secret, which is why it is the one canary the verifier binds.
 */
export const CONFORMANCE_SECRET_CANARY = 'openwop-conformance-canary-secret';

/** Minimal v2 shape the verifier reads (schema validation is a separate step). */
export interface BundleV2Requirement {
  readonly requirementId: string;
  readonly scenarioId: string;
  readonly disposition: string;
  readonly assertionCount?: number;
  readonly detail?: string;
}
export interface BundleV2Like {
  readonly bundleVersion: string;
  readonly discovery: { readonly document: DiscoveryPayload; readonly sha256?: string; readonly url?: string };
  readonly claimedProfiles: readonly string[];
  readonly aliases?: readonly string[];
  readonly results: {
    readonly totals: {
      readonly executedPass: number;
      readonly executedFail: number;
      readonly skipped: number;
      readonly inapplicable: number;
      readonly blocked: number;
    };
    readonly requirements: readonly BundleV2Requirement[];
  };
}

export type BundleRejectionKind =
  | 'not-v2'
  | 'unknown-disposition'
  | 'duplicate-requirement'
  | 'totals-mismatch'
  | 'reason-missing'
  | 'secret-canary'
  | 'unwitnessed-requirement'
  | 'vacuous-pass';

export interface BundleRejection {
  readonly kind: BundleRejectionKind;
  /** The profile the rejection is scoped to, when it is (unwitnessed / vacuous). */
  readonly profile?: string;
  readonly requirementId?: string;
  readonly detail: string;
}

export interface BundleV2ProfileVerdict {
  readonly profile: string;
  /** §B(1): derivable from the captured discovery document. */
  readonly derivable: boolean;
  /** No floor is defined for this profile — the claim is unprovable (RFC 0148 §C G6). */
  readonly floorUnspecified: boolean;
  /** Required requirement ids for this profile (floor files + satisfied prefixes). */
  readonly required: readonly string[];
  /** Rows for required ids that are missing, or `executed-pass` with no witness. */
  readonly rejections: readonly BundleRejection[];
  /** Required rows recorded honestly but not in the CERTIFIABLE set (`blocked`, `executed-fail`). */
  readonly notCertifiable: readonly string[];
  /** The evidence for this profile is well-formed (no rejections). */
  readonly evidenceValid: boolean;
  /** derivable ∧ evidenceValid ∧ every required row certifiable. */
  readonly certified: boolean;
}

export interface BundleV2Verdict {
  /** The document is acceptable evidence: no rejection of any kind. */
  readonly evidenceValid: boolean;
  /** Every claimed profile is certified. Implies `evidenceValid`. */
  readonly certified: boolean;
  /** Bundle-wide rejections (shape, duplicates, totals, canary). */
  readonly rejections: readonly BundleRejection[];
  readonly profiles: readonly BundleV2ProfileVerdict[];
}

const scenarioBasename = (id: string): string => id.split('/').pop() ?? id;

/** Walk every string in a JSON value. */
function* strings(value: unknown, path = '$'): Generator<{ path: string; value: string }> {
  if (typeof value === 'string') {
    yield { path, value };
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) yield* strings(value[i], `${path}[${i}]`);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      yield { path: `${path}.${k}`, value: k };
      yield* strings(v, `${path}.${k}`);
    }
  }
}

/** Where (JSON paths) a literal appears anywhere in the value — keys included. */
export function findLiteral(value: unknown, literal: string): string[] {
  const hits: string[] = [];
  if (literal === '') return hits;
  for (const s of strings(value)) if (s.value.includes(literal)) hits.push(s.path);
  return hits;
}

/**
 * Required requirement ids for a claimed profile, derived from the SAME floor
 * map the emitter uses. For a `requiredAnyPrefix` entry the requirement is
 * satisfied by any row whose scenario matches the prefix; the id recorded for
 * it is the prefix requirement id, and the rows that satisfy it are the
 * matching scenario rows.
 */
function requiredFor(profile: string, document: Readonly<Record<string, unknown>>): { files: string[]; prefixes: string[]; discoveryOnly: boolean } | null {
  const floor = PROFILE_FLOOR_SCENARIOS[profile];
  if (floor === undefined) return null;
  // Discovery-conditional floors (G7) are evaluated against the bundle's own
  // captured document — the same evidence the claim was derived from.
  const files = floorFilesFor(profile, document);
  if (files === null) return null;
  return {
    files: [...files],
    prefixes: [...(floor.requiredAnyPrefix ?? [])],
    discoveryOnly: floor.discoveryOnly === true,
  };
}

function isWitnessedPass(row: BundleV2Requirement): boolean {
  return row.disposition === 'executed-pass' && typeof row.assertionCount === 'number' && row.assertionCount > 0;
}

/**
 * The emitter's own RFC 0148 §A resolution of a zero-assertion file that noted
 * no reason: recorded `blocked` with a fixed marker detail. Honest as a row;
 * for a REQUIRED requirement it is still an unclassified return, and a claim
 * carrying it is rejected exactly as a vacuous pass would be.
 */
function isUnclassifiedReturn(row: BundleV2Requirement): boolean {
  return row.disposition === 'blocked' && row.detail === UNCLASSIFIED_RETURN_DETAIL;
}

/**
 * Verify a v2 bundle. Pure; the caller validates against
 * `certification-bundle-v2.schema.json` separately (this function tolerates a
 * schema-invalid document and reports what it can).
 */
export function verifyBundleV2(bundle: BundleV2Like): BundleV2Verdict {
  const rejections: BundleRejection[] = [];
  if (bundle.bundleVersion !== '2') {
    rejections.push({ kind: 'not-v2', detail: `bundleVersion is ${JSON.stringify(bundle.bundleVersion)}, expected "2"` });
  }

  const rows = bundle.results?.requirements ?? [];
  const byId = new Map<string, BundleV2Requirement[]>();
  for (const r of rows) {
    if (!(DISPOSITIONS as readonly string[]).includes(r.disposition)) {
      rejections.push({ kind: 'unknown-disposition', requirementId: r.requirementId, detail: `${r.requirementId}: disposition ${JSON.stringify(r.disposition)} is not one of the five RFC 0148 §A names` });
    }
    if (r.disposition !== 'executed-pass' && (r.detail === undefined || r.detail.trim() === '')) {
      rejections.push({ kind: 'reason-missing', requirementId: r.requirementId, detail: `${r.requirementId}: '${r.disposition}' recorded without a reason (RFC 0148 §A)` });
    }
    const arr = byId.get(r.requirementId) ?? [];
    arr.push(r);
    byId.set(r.requirementId, arr);
  }
  for (const [id, arr] of byId) {
    if (arr.length > 1) rejections.push({ kind: 'duplicate-requirement', requirementId: id, detail: `${id}: ${arr.length} rows — exactly one disposition per requirement per run (RFC 0148 §A)` });
  }

  // Totals MUST summarize the rows. A hand-edited total is a tampered witness.
  const count = (d: Disposition): number => rows.filter((r) => r.disposition === d).length;
  const t = bundle.results?.totals;
  if (t !== undefined) {
    const expected = { executedPass: count('executed-pass'), executedFail: count('executed-fail'), skipped: count('skipped'), inapplicable: count('inapplicable'), blocked: count('blocked') };
    for (const k of Object.keys(expected) as (keyof typeof expected)[]) {
      if (t[k] !== expected[k]) rejections.push({ kind: 'totals-mismatch', detail: `totals.${k} is ${String(t[k])} but the rows count ${expected[k]}` });
    }
  }

  // The canary MUST NOT be anywhere in evidence — keys included.
  for (const p of findLiteral(bundle, CONFORMANCE_SECRET_CANARY)) {
    rejections.push({ kind: 'secret-canary', detail: `conformance secret canary present at ${p} — evidence leaked a secret (SR-1)` });
  }

  const profiles: BundleV2ProfileVerdict[] = (bundle.claimedProfiles ?? []).map((profile) => {
    const derivable = profileDerivable(bundle.discovery?.document ?? {}, profile);
    const req = requiredFor(profile, (bundle.discovery?.document ?? {}) as Readonly<Record<string, unknown>>);
    if (req === null) {
      return { profile, derivable, floorUnspecified: true, required: [], rejections: [], notCertifiable: [], evidenceValid: true, certified: false };
    }
    const required: string[] = [];
    const profileRejections: BundleRejection[] = [];
    const notCertifiable: string[] = [];

    for (const file of req.files) {
      const id = requirementIdForScenario(scenarioBasename(file));
      required.push(id);
      const arr = byId.get(id) ?? [];
      const row = arr[0];
      if (row === undefined) {
        profileRejections.push({ kind: 'unwitnessed-requirement', profile, requirementId: id, detail: `${id}: no row — an unwitnessed floor requirement (RFC 0148 §A resolves it to blocked; a claim carrying it is rejected)` });
        continue;
      }
      if (row.disposition === 'executed-pass' && !isWitnessedPass(row)) {
        profileRejections.push({ kind: 'vacuous-pass', profile, requirementId: id, detail: `${id}: executed-pass with assertionCount ${String(row.assertionCount)} — a witness of nothing` });
        continue;
      }
      if (isUnclassifiedReturn(row)) {
        profileRejections.push({ kind: 'unwitnessed-requirement', profile, requirementId: id, detail: `${id}: every test returned early with zero assertions and no recorded reason — an unclassified return the emitter resolved to blocked (RFC 0148 §A); a claim carrying it is rejected` });
        continue;
      }
      if (!(CERTIFIABLE as readonly string[]).includes(row.disposition)) notCertifiable.push(id);
    }
    for (const prefix of req.prefixes) {
      const id = requirementIdForPrefix(prefix);
      required.push(id);
      // Satisfied by the rows of matching scenarios; the emitter also writes a
      // summary row under the prefix id. Either form is accepted; the rule is
      // the same — every matching row witnessed, at least one present.
      const matching = rows.filter((r) => scenarioBasename(r.scenarioId).startsWith(prefix) && r.requirementId !== id);
      const summary = byId.get(id)?.[0];
      if (matching.length === 0 && summary === undefined) {
        profileRejections.push({ kind: 'unwitnessed-requirement', profile, requirementId: id, detail: `${id}: no scenario matching '${prefix}' recorded a row` });
        continue;
      }
      const considered = matching.length > 0 ? matching : [summary as BundleV2Requirement];
      const vacuous = considered.filter((r) => (r.disposition === 'executed-pass' && !isWitnessedPass(r)) || isUnclassifiedReturn(r));
      if (vacuous.length > 0) {
        profileRejections.push({ kind: 'vacuous-pass', profile, requirementId: id, detail: `${id}: ${vacuous.map((r) => r.scenarioId).join(', ')} executed-pass with no witnessed assertion` });
        continue;
      }
      // `requiredAnyPrefix`: ANY witnessed pass among the matching scenarios
      // satisfies the requirement (the emitter's summary row says the same).
      if (!considered.some((r) => isWitnessedPass(r))) notCertifiable.push(id);
    }

    const evidenceValid = profileRejections.length === 0;
    const certified = derivable && evidenceValid && notCertifiable.length === 0 && (req.discoveryOnly || required.length > 0);
    return { profile, derivable, floorUnspecified: false, required, rejections: profileRejections, notCertifiable, evidenceValid, certified };
  });

  const evidenceValid = rejections.length === 0 && profiles.every((p) => p.evidenceValid);
  const certified = evidenceValid && profiles.length > 0 && profiles.every((p) => p.certified);
  return { evidenceValid, certified, rejections, profiles };
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Replacement for a scrubbed secret: a stable, non-reversible marker that
 * still lets two occurrences of the same secret be recognized as the same.
 */
export function redactionMarker(secret: string): string {
  return `«redacted:${createHash('sha256').update(secret).digest('hex').slice(0, 12)}»`;
}

export interface ScrubResult<T> {
  readonly value: T;
  /** JSON paths at which a secret was replaced. */
  readonly redactedAt: readonly string[];
}

/**
 * Replace every occurrence of every secret in every string of `value` (keys
 * included) with `redactionMarker(secret)`. Empty / whitespace-only secrets
 * are ignored — scrubbing "" would blank every string. The emitter runs this
 * over the finished bundle with the credentials it was given plus the
 * conformance canary; RFC 0148 §C says secret canaries never enter evidence,
 * and the only way to make that true regardless of what a scenario put in a
 * `detail` string is to scrub the document, not to trust the scenarios.
 */
export function scrubEvidence<T>(value: T, secrets: readonly string[]): ScrubResult<T> {
  const live = [...new Set(secrets.filter((s) => typeof s === 'string' && s.trim() !== ''))].sort((a, b) => b.length - a.length);
  const redactedAt: string[] = [];
  if (live.length === 0) return { value, redactedAt };
  const scrubString = (s: string, path: string): string => {
    let out = s;
    let hit = false;
    for (const secret of live) {
      if (out.includes(secret)) {
        out = out.split(secret).join(redactionMarker(secret));
        hit = true;
      }
    }
    if (hit) redactedAt.push(path);
    return out;
  };
  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === 'string') return scrubString(v, path);
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        out[scrubString(k, `${path}.${k}`)] = walk(x, `${path}.${k}`);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value, '$') as T, redactedAt };
}

/**
 * The secrets a `--certify` run must keep out of its own evidence: the
 * credential it was handed, plus every `OPENWOP_*` environment value that
 * names a key/token/secret/password, plus the conformance canary.
 */
export function evidenceSecretsFromEnv(env: NodeJS.ProcessEnv, extra: readonly (string | undefined)[] = []): string[] {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('OPENWOP_')) continue;
    if (!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/.test(k)) continue;
    if (v !== undefined && v.trim() !== '') out.add(v);
  }
  for (const s of extra) if (s !== undefined && s.trim() !== '') out.add(s);
  out.add(CONFORMANCE_SECRET_CANARY);
  return [...out];
}
