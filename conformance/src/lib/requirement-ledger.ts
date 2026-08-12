/**
 * RFC 0148 §A — the requirement execution ledger.
 *
 * The program exists because a green bundle could overstate behavior that never
 * ran. Every instance found so far shares one shape: **something absent was
 * treated as something proven.** `verifyBundleProfile()` derived `floorProven`
 * from `[].every(...)` over an undefined floor. A gated subtest 404'd and
 * soft-skipped. A scenario early-returned and the file still counted as passed.
 *
 * So the ledger inverts the default. A requirement has **no** disposition until
 * a scenario explicitly records one, and a requirement with no recorded
 * disposition resolves to `blocked` — never to `executed-pass`. Silence is
 * evidence of nothing, and the data structure now says so rather than relying on
 * each author to remember it.
 *
 * That is the whole mechanism. Everything else here is bookkeeping.
 */

/** RFC 0148 §A. Exactly one of these per requirement, per run. */
export type Disposition =
  /** The assertion executed against the target and passed. */
  | 'executed-pass'
  /** The assertion executed and failed. */
  | 'executed-fail'
  /** The operator explicitly excluded an optional, unadvertised profile. */
  | 'skipped'
  /** The requirement does not apply to the captured discovery/profile set. */
  | 'inapplicable'
  /** Advertised behavior could not be exercised — seam, fixture, credential, or dependency missing. */
  | 'blocked';

export const DISPOSITIONS: readonly Disposition[] = [
  'executed-pass',
  'executed-fail',
  'skipped',
  'inapplicable',
  'blocked',
] as const;

/**
 * Dispositions that permit a profile to certify. `blocked` is deliberately NOT
 * here: RFC 0148 §A says a blocked requirement in a claimed profile invalidates
 * that profile's certification, because "we could not check" and "we checked and
 * it holds" are the two states this program exists to stop conflating.
 */
export const CERTIFIABLE: readonly Disposition[] = [
  'executed-pass',
  'skipped',
  'inapplicable',
] as const;

export interface LedgerEntry {
  readonly requirementId: string;
  readonly disposition: Disposition;
  /** Why — required for every disposition except `executed-pass`. */
  readonly detail?: string;
}

const ledger = new Map<string, LedgerEntry>();

/**
 * Record a requirement's outcome. Recording the same id twice with different
 * dispositions throws: RFC 0148 §A says **exactly one** disposition per
 * requirement, and a silent last-write-wins would let a later soft-skip
 * overwrite an earlier real failure — the failure mode in reverse.
 */
export function recordRequirement(
  requirementId: string,
  disposition: Disposition,
  detail?: string,
): void {
  const prior = ledger.get(requirementId);
  if (prior !== undefined && prior.disposition !== disposition) {
    throw new Error(
      `RFC 0148 §A: ${requirementId} already recorded as '${prior.disposition}', now '${disposition}'. ` +
        'Exactly one disposition per requirement per run.',
    );
  }
  if (disposition !== 'executed-pass' && (detail === undefined || detail.trim() === '')) {
    throw new Error(
      `RFC 0148 §A: ${requirementId} recorded as '${disposition}' without a reason. ` +
        'Anything other than executed-pass MUST say why, or the ledger records an outcome nobody can act on.',
    );
  }
  ledger.set(requirementId, detail === undefined ? { requirementId, disposition } : { requirementId, disposition, detail });
}

/**
 * The disposition for a requirement. **Absent resolves to `blocked`, never to a
 * pass.** This is the inversion the whole section turns on: a scenario that
 * returned early, threw and swallowed, or was never written leaves no entry, and
 * the honest reading of no entry is "this was not exercised".
 */
export function dispositionOf(requirementId: string): Disposition {
  return ledger.get(requirementId)?.disposition ?? 'blocked';
}

export function entryOf(requirementId: string): LedgerEntry {
  return (
    ledger.get(requirementId) ?? {
      requirementId,
      disposition: 'blocked',
      detail: 'no disposition recorded — the requirement was not exercised',
    }
  );
}

export function snapshot(): readonly LedgerEntry[] {
  return [...ledger.values()].sort((a, b) => a.requirementId.localeCompare(b.requirementId));
}

/** Test-support only. Production runs record once and read once. */
export function resetLedger(): void {
  ledger.clear();
}

export interface ProfileVerdict {
  readonly profile: string;
  readonly certifiable: boolean;
  readonly blocking: readonly LedgerEntry[];
}

/**
 * Whether a profile's requirements permit certification. A profile with **no**
 * requirements is NOT certifiable by this function — an empty requirement set
 * is the `[].every(...)` shape that started all of this, and callers must
 * distinguish "no floor by design" (`discoveryOnly`) from "no floor written yet"
 * before reaching here.
 */
export function verifyProfileRequirements(
  profile: string,
  requirementIds: readonly string[],
): ProfileVerdict {
  const blocking = requirementIds
    .map(entryOf)
    .filter((e) => !CERTIFIABLE.includes(e.disposition));
  return { profile, certifiable: requirementIds.length > 0 && blocking.length === 0, blocking };
}
