/**
 * Which rows of a replay fork's effect ledger record an attempt the PARENT
 * never made, i.e. a re-fire (RFC 0173 §C.2; replay.md §Suppression rule 1)?
 *
 * `v2-effect-seam-no-refire` used to assert `fork count ≤ parent count`. The
 * seam fires ONE attempt on the source run, so a host that re-fires on replay
 * records one row on the fork and reads 1 ≤ 1: the leg passed over exactly the
 * defect it exists for. Measured: openwop-app with `sideEffecting` dropped
 * still passed (suite 2.42.2 correction).
 *
 * A fork's projection may legitimately carry nothing (a host that keys the
 * ledger per run: its fork's own ledger is empty when nothing re-fired) or the
 * parent's rows as fixed history (a host that projects inherited attempts). So
 * the witness is not a count. It is whether any fork row records an attempt
 * that is not one of the parent's: an inherited row repeats a parent attempt's
 * `(nodeId, attempt, at)`, while a re-fire is a new attempt with a new `at`.
 * The multiset match means N inherited rows cover at most N parent rows.
 */

export interface EffectRow { readonly nodeId?: unknown; readonly attempt?: unknown; readonly at?: unknown }

const key = (r: EffectRow): string => `${String(r.nodeId)}|${String(r.attempt)}|${String(r.at)}`;

export function refiredAttempts(parent: readonly EffectRow[], fork: readonly EffectRow[]): EffectRow[] {
  const available = new Map<string, number>();
  for (const r of parent) available.set(key(r), (available.get(key(r)) ?? 0) + 1);
  const out: EffectRow[] = [];
  for (const r of fork) {
    const n = available.get(key(r)) ?? 0;
    if (n > 0) available.set(key(r), n - 1);
    else out.push(r);
  }
  return out;
}
