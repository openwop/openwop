/**
 * An informational note for the CURRENT `it`'s row (suite 2.44.3, RFC 0225).
 *
 * `setup.ts` attaches it to the row's `detail` in `afterEach`, whatever the
 * disposition, so a PASSING row can say what it observed. The bundle writer
 * already carries `detail` on every row and the witness digest covers it, so the
 * note is signed with the row. It is prefixed `observed: `, never
 * `partial-witness: `: it describes how a witness was obtained and does not
 * qualify it (`check-accepted-predicate` counts a pass as partial only on that
 * prefix). Same shape as `noteEvidence` (lib/durability-evidence.ts).
 */
export const OBSERVATION_PREFIX = 'observed: ';

let pending: string | null = null;

/** Note what this `it` observed. A second note in the same `it` is appended. */
export function noteObservation(text: string): void {
  const t = text.trim();
  if (t === '') return;
  pending = pending === null ? t : `${pending} · ${t}`;
}

/** Take (and clear) the pending note. */
export function takeNotedObservation(): string | null {
  const n = pending;
  pending = null;
  return n;
}

/**
 * The detail a row carries once an observation is attached. A row with no
 * detail gets `observed: …`; a row that already has one (a non-pass reason, or
 * a partial-witness marker) keeps it FIRST and gains `· observed: …`, so no
 * prefix a reader filters on ever moves.
 */
export function attachObservation(detail: string | undefined, observation: string | null): string | undefined {
  if (observation === null || observation.trim() === '') return detail;
  if (detail === undefined || detail.trim() === '') return `${OBSERVATION_PREFIX}${observation}`;
  return `${detail} · ${OBSERVATION_PREFIX}${observation}`;
}
