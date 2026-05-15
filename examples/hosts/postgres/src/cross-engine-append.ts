/**
 * Cross-engine append-reducer ordering per
 * `spec/v1/channels-and-reducers.md` §"Append ordering" §"Across
 * engines".
 *
 * When a sub-workflow or cross-canvas invoke runs on a different
 * engine instance than the parent, its writes to an `append`-reducer
 * channel arrive at the parent as inbound `channel.written` events
 * carrying `sourceEngineId` + `sourceRunId` + the source engine's
 * per-run `sequence`. The owner engine MUST:
 *
 *   1. Assign each inbound write a NEW owner-run `sequence` value at
 *      the moment it is appended to the owning run's event log.
 *   2. Project the folded channel array in owner-`sequence` order —
 *      NOT in source-`sequence` order. Consumers MUST NOT rely on
 *      `sourceEngineId`'s `sequence` for ordering.
 *   3. Break ties when two owner-`sequence` values collide (e.g.,
 *      during split-brain claim handoff recovery) using `eventId` as
 *      the secondary sort key. `eventId` is opaque but globally
 *      unique, so `(sequence, eventId)` is a total order.
 *   4. Re-fold the channel from the event log on replay and produce
 *      the IDENTICAL array contents AND ORDERING as the original
 *      execution.
 *
 * **Why this is a standalone module.** Per the annex, the projection
 * rule is normative — every host that supports cross-engine
 * append writes MUST produce the same projected channel state given
 * the same event log. Factoring the projection algorithm out of the
 * request path lets us prove that property against synthetic event
 * logs in tests without needing to boot two real engines.
 *
 * The Postgres reference host does not yet implement cross-engine
 * writes (no inbound `appendCrossEngine` API surface in v1.x), so
 * this resolver ships as canonical reference code for future hosts
 * that adopt the surface. The companion smoke verifies the four
 * properties above against synthetic inputs.
 *
 * @see spec/v1/channels-and-reducers.md §"Append ordering"
 * @see schemas/channel-written-payload.schema.json
 */

/**
 * One entry in the owner-engine's event log for an append-reducer
 * channel. Mirrors the canonical `channel.written` event shape per
 * `channel-written-payload.schema.json`.
 *
 * `sourceEngineId` / `sourceRunId` are absent for owner-engine
 * writes and set for inbound cross-engine writes. `sourceSequence`
 * is the source engine's per-run sequence at write time — recorded
 * for audit but NEVER used for projection ordering.
 */
export interface ChannelWrittenEvent {
  /** Event id — opaque but globally unique. Tie-break key. */
  readonly eventId: string;
  /**
   * Owner-engine-assigned per-run sequence at the moment of append.
   * Monotonic per run; primary sort key for the projection.
   */
  readonly sequence: number;
  /** Channel name this write targets. */
  readonly channel: string;
  /** Append-reducer entry value. Anything JSON-serializable. */
  readonly value: unknown;
  /**
   * When present, identifies the non-owner engine that originated
   * this write. Absent for owner-engine writes.
   */
  readonly sourceEngineId?: string;
  /**
   * When present, runId on the source engine. Pairs with
   * `sourceEngineId`.
   */
  readonly sourceRunId?: string;
  /**
   * When present, source engine's per-run sequence at write time.
   * Recorded for audit; MUST NOT influence projection order.
   */
  readonly sourceSequence?: number;
}

/**
 * Project the canonical channel state for an `append`-reducer
 * channel by folding the event log per `channels-and-reducers.md`
 * §"Append ordering".
 *
 * **Pure function.** Given the same event log it produces the same
 * projection regardless of caller, wall clock, or input order — the
 * `(sequence, eventId)` composite total order is fully deterministic.
 *
 * Filters to events whose `channel` matches `channelName`; sorts by
 * `(sequence asc, eventId asc)`; returns the entries' `value` field
 * in that order.
 */
export function projectAppendChannel(
  events: ReadonlyArray<ChannelWrittenEvent>,
  channelName: string,
): unknown[] {
  const filtered = events.filter((e) => e.channel === channelName);
  const sorted = [...filtered].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    if (a.eventId < b.eventId) return -1;
    if (a.eventId > b.eventId) return 1;
    return 0;
  });
  return sorted.map((e) => e.value);
}

/**
 * Validate that an event log respects the per-run sequence
 * monotonicity invariant: for any pair of events from the SAME
 * owner-run, sequences are strictly increasing in the order they
 * appear in the event log. This is the host-side check that
 * `appendAtomic` actually assigned monotonic owner sequences.
 *
 * Returns `null` when the invariant holds, or a string describing
 * the violation when it does not. Callers in test contexts can use
 * the return value for clear failure messages.
 */
export function checkOwnerSequenceMonotonic(
  events: ReadonlyArray<ChannelWrittenEvent>,
): string | null {
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const cur = events[i]!;
    if (cur.sequence <= prev.sequence) {
      return (
        `owner sequence MUST be strictly monotonic in event-log order; ` +
        `event #${i - 1} has sequence=${prev.sequence}, event #${i} has sequence=${cur.sequence}`
      );
    }
  }
  return null;
}

/**
 * Recovery hook for split-brain claim handoff — when two engines
 * briefly both believed they owned a run and each appended events
 * with overlapping `sequence` values, the resolver MUST be able to
 * deterministically order them. Given a list of events with possibly
 * colliding sequences, returns the canonical projection per
 * `channels-and-reducers.md` §"Tie-breaking when sequences collide".
 *
 * Same as `projectAppendChannel` but exposes the tie-break behavior
 * as a named operation so callers can opt into it explicitly during
 * the recovery code path. Production hosts SHOULD log a warning
 * when this fires — it indicates split-brain happened at the claim
 * layer.
 */
export function projectAppendChannelWithTieBreak(
  events: ReadonlyArray<ChannelWrittenEvent>,
  channelName: string,
): { values: unknown[]; collisions: number } {
  const filtered = events.filter((e) => e.channel === channelName);
  const seqCounts = new Map<number, number>();
  for (const e of filtered) {
    seqCounts.set(e.sequence, (seqCounts.get(e.sequence) ?? 0) + 1);
  }
  let collisions = 0;
  for (const count of seqCounts.values()) {
    if (count > 1) collisions += count;
  }
  return { values: projectAppendChannel(filtered, channelName), collisions };
}
