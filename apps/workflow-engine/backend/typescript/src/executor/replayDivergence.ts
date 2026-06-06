/**
 * Replay divergence detection (replay.md §"Failure surfaces" + §C).
 *
 * `mode: "replay"` re-executes a run from `fromSeq` (default 0). For a
 * DETERMINISTIC workflow the re-executed observable event sequence MUST match
 * the original's; if it doesn't, the host emits a `replay.diverged` event so an
 * operator can audit what changed (a model's behavior shifted, a tool returned
 * different bytes, etc.). This is the contract that lets the host honestly
 * advertise `capabilities.replay.supported = true`.
 *
 * "Observable" here is the structural run/node/decision lifecycle — NOT the
 * recorded-fact or cost events (`memory.written`, `provider.usage`, …) whose
 * ids/timestamps are fixed history and re-emitted, not regenerated
 * (replay.md L112). Comparing those would false-positive on benign ordering.
 */

import type { EventRecord } from '../types.js';

/** The structural lifecycle events whose ordered sequence defines a run's
 *  observable behavior for replay-determinism purposes. */
const OBSERVABLE_TYPES: ReadonlySet<string> = new Set([
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'node.started',
  'node.completed',
  'node.failed',
  'node.skipped',
  'node.suspended',
  'node.resumed',
  'approval.requested',
  'approval.granted',
  'approval.rejected',
  'approval.overridden',
  'clarification.requested',
  'clarification.resolved',
  'interrupt.requested',
  'interrupt.resolved',
]);

export interface DivergenceResult {
  diverged: boolean;
  /** Index into the observable sequence where source + replay first differ. */
  index?: number;
  /** `type@nodeId` the source produced at `index` (undefined = source ran out). */
  expected?: string;
  /** `type@nodeId` the replay produced at `index` (undefined = replay ran out). */
  actual?: string;
  originalEventId?: string;
  replayEventId?: string;
}

function key(e: EventRecord): string {
  return `${e.type}@${e.nodeId ?? ''}`;
}

/**
 * Compare the observable (structural) event sequences of a source run and its
 * replay. Returns the first divergence, or `{ diverged: false }`.
 */
export function compareObservableSequences(
  source: readonly EventRecord[],
  replay: readonly EventRecord[],
): DivergenceResult {
  const so = source.filter((e) => OBSERVABLE_TYPES.has(e.type));
  const ro = replay.filter((e) => OBSERVABLE_TYPES.has(e.type));
  const n = Math.max(so.length, ro.length);
  for (let i = 0; i < n; i++) {
    const s = so[i];
    const r = ro[i];
    const sk = s ? key(s) : undefined;
    const rk = r ? key(r) : undefined;
    if (sk !== rk) {
      return {
        diverged: true,
        index: i,
        ...(sk !== undefined ? { expected: sk } : {}),
        ...(rk !== undefined ? { actual: rk } : {}),
        ...(s ? { originalEventId: s.eventId } : {}),
        ...(r ? { replayEventId: r.eventId } : {}),
      };
    }
  }
  return { diverged: false };
}

/** Minimal append surface (matches the executor event log). */
interface EventAppender {
  append(input: {
    runId: string;
    type: string;
    nodeId?: string;
    payload: unknown;
    causationId?: string;
  }): Promise<unknown>;
}

interface EventReader {
  listEvents(runId: string, opts?: { fromSeq?: number; limit?: number }): Promise<readonly EventRecord[]>;
}

/**
 * After a replay run completes, compare its observable sequence against the
 * source (from `fromSeq` onward) and emit `replay.diverged` on the replay run
 * if they differ. Returns the divergence result (informational; non-blocking
 * per replay.md §"Failure surfaces").
 */
export async function detectAndRecordReplayDivergence(
  reader: EventReader,
  appender: EventAppender,
  sourceRunId: string,
  replayRunId: string,
  fromSeq: number,
): Promise<DivergenceResult> {
  const source = await reader.listEvents(sourceRunId, { fromSeq });
  const replay = await reader.listEvents(replayRunId);
  const result = compareObservableSequences(source, replay);
  if (result.diverged) {
    await appender.append({
      runId: replayRunId,
      type: 'replay.diverged',
      payload: {
        originalEventId: result.originalEventId ?? null,
        replayEventId: result.replayEventId ?? null,
        divergencePoint: result.index ?? null,
        expected: result.expected ?? null,
        actual: result.actual ?? null,
      },
    });
  }
  return result;
}
