/**
 * CF-8 — Cross-engine append-reducer ordering smoke.
 *
 * Verifies the canonical projection algorithm in
 * `src/cross-engine-append.ts` against the four normative
 * properties from `channels-and-reducers.md` §"Append ordering"
 * §"Across engines":
 *
 *   1. Folded array MUST reflect owner-assigned sequence order,
 *      NOT source-engine sequence order.
 *   2. Tie-breaking when sequences collide uses `(sequence,
 *      eventId)` as the composite total order.
 *   3. Replay determinism: same input → same output, regardless of
 *      caller order.
 *   4. Mixed own-engine + cross-engine writes interleave by owner
 *      sequence (sourceEngineId absent for own writes).
 *
 * The existing `multi-node-ordering.test.ts` conformance scenario
 * covers the intra-engine total-order rule. This smoke is the
 * corresponding cross-engine check — and the resolver is canonical
 * reference code that future hosts implementing cross-engine
 * channels can adopt.
 *
 * @see plans/openwop-protocol-gap-closure-plan.md Workstream 2 CF-8
 * @see examples/hosts/postgres/src/cross-engine-append.ts
 * @see spec/v1/channels-and-reducers.md §"Append ordering"
 */

import assert from 'node:assert/strict';

import {
  checkOwnerSequenceMonotonic,
  projectAppendChannel,
  projectAppendChannelWithTieBreak,
  type ChannelWrittenEvent,
} from '../src/cross-engine-append.js';

const OWNER_ENGINE = 'engine-owner';
const CHILD_ENGINE_A = 'engine-child-a';
const CHILD_ENGINE_B = 'engine-child-b';
const CHANNEL = 'childVotes';

function ev(
  eventId: string,
  sequence: number,
  value: unknown,
  source?: { engineId: string; runId: string; sourceSequence: number },
): ChannelWrittenEvent {
  return {
    eventId,
    sequence,
    channel: CHANNEL,
    value,
    ...(source !== undefined && {
      sourceEngineId: source.engineId,
      sourceRunId: source.runId,
      sourceSequence: source.sourceSequence,
    }),
  };
}

async function main(): Promise<void> {
  // ── Property 1 ────────────────────────────────────────────────
  // Folded array reflects OWNER-assigned sequence, not source
  // sequence. Construct a log where two child engines wrote in
  // sourceSequence order (1, 2, 3) but the owner assigned them
  // owner sequences in a DIFFERENT order (the network reordered
  // the inbound deliveries). Projection MUST follow owner order.
  const ownerVsSourceLog: ChannelWrittenEvent[] = [
    ev('ev-001', 10, 'child-a-vote-1', { engineId: CHILD_ENGINE_A, runId: 'run-a', sourceSequence: 3 }),
    ev('ev-002', 11, 'child-b-vote-1', { engineId: CHILD_ENGINE_B, runId: 'run-b', sourceSequence: 1 }),
    ev('ev-003', 12, 'child-a-vote-2', { engineId: CHILD_ENGINE_A, runId: 'run-a', sourceSequence: 2 }),
  ];
  const ownerOrderProjection = projectAppendChannel(ownerVsSourceLog, CHANNEL);
  assert.deepEqual(
    ownerOrderProjection,
    ['child-a-vote-1', 'child-b-vote-1', 'child-a-vote-2'],
    'projection MUST follow owner-assigned sequence, NOT sourceSequence',
  );

  // ── Property 2 ────────────────────────────────────────────────
  // Tie-breaking: two events with identical owner sequence (split-
  // brain recovery scenario) MUST be ordered by eventId lex-asc.
  // The `WithTieBreak` variant additionally reports the collision
  // count so operators can alert.
  const splitBrainLog: ChannelWrittenEvent[] = [
    ev('ev-zzz', 20, 'value-z'),
    ev('ev-aaa', 20, 'value-a'),
    ev('ev-mmm', 20, 'value-m'),
  ];
  const splitBrain = projectAppendChannelWithTieBreak(splitBrainLog, CHANNEL);
  assert.deepEqual(
    splitBrain.values,
    ['value-a', 'value-m', 'value-z'],
    'tie-break MUST use eventId lex-asc when sequences collide',
  );
  assert.equal(splitBrain.collisions, 3, 'three events share sequence=20 → all flagged');

  // ── Property 3 ────────────────────────────────────────────────
  // Replay determinism: same event log produces same projection
  // regardless of input order. Shuffle the canonical log into
  // multiple orderings; every projection MUST match.
  const canonicalLog: ChannelWrittenEvent[] = [
    ev('ev-101', 1, 'first'),
    ev('ev-102', 2, 'second', { engineId: CHILD_ENGINE_A, runId: 'run-a', sourceSequence: 50 }),
    ev('ev-103', 3, 'third'),
    ev('ev-104', 4, 'fourth', { engineId: CHILD_ENGINE_B, runId: 'run-b', sourceSequence: 1 }),
    ev('ev-105', 5, 'fifth'),
  ];
  const canonicalProjection = projectAppendChannel(canonicalLog, CHANNEL);
  const reversedProjection = projectAppendChannel([...canonicalLog].reverse(), CHANNEL);
  const shuffledProjection = projectAppendChannel(
    [canonicalLog[2]!, canonicalLog[0]!, canonicalLog[4]!, canonicalLog[1]!, canonicalLog[3]!],
    CHANNEL,
  );
  assert.deepEqual(reversedProjection, canonicalProjection, 'replay must be input-order independent');
  assert.deepEqual(shuffledProjection, canonicalProjection, 'replay must be input-order independent');
  assert.deepEqual(
    canonicalProjection,
    ['first', 'second', 'third', 'fourth', 'fifth'],
    'canonical projection content',
  );

  // ── Property 4 ────────────────────────────────────────────────
  // Mixed own-engine + cross-engine writes interleave by owner
  // sequence; sourceEngineId absent for own writes.
  const mixedLog: ChannelWrittenEvent[] = [
    ev('ev-201', 100, 'own-1'),
    ev('ev-202', 101, 'child-a-1', { engineId: CHILD_ENGINE_A, runId: 'run-a', sourceSequence: 1 }),
    ev('ev-203', 102, 'own-2'),
    ev('ev-204', 103, 'child-b-1', { engineId: CHILD_ENGINE_B, runId: 'run-b', sourceSequence: 1 }),
    ev('ev-205', 104, 'own-3'),
  ];
  const mixed = projectAppendChannel(mixedLog, CHANNEL);
  assert.deepEqual(
    mixed,
    ['own-1', 'child-a-1', 'own-2', 'child-b-1', 'own-3'],
    'mixed own/cross-engine writes interleave by owner sequence',
  );

  // ── Owner-sequence monotonicity check ──────────────────────────
  // The helper that validates `appendAtomic` actually assigned
  // monotonic sequences — used by hosts as a self-check before
  // accepting an inbound write.
  assert.equal(checkOwnerSequenceMonotonic(canonicalLog), null,
    'canonical log is monotonic in event-log order');

  const bogusLog: ChannelWrittenEvent[] = [
    ev('ev-bad-001', 5, 'a'),
    ev('ev-bad-002', 3, 'b'), // regression!
  ];
  const violation = checkOwnerSequenceMonotonic(bogusLog);
  assert.ok(violation !== null, 'non-monotonic log MUST be flagged');
  assert.ok(violation.includes('sequence'), 'violation message MUST cite sequence');

  // ── Channel filter ─────────────────────────────────────────────
  // Events for OTHER channels MUST NOT contribute to this
  // channel's projection.
  const multiChannelLog: ChannelWrittenEvent[] = [
    { eventId: 'ev-301', sequence: 1, channel: 'childVotes', value: 'a' },
    { eventId: 'ev-302', sequence: 2, channel: 'otherChannel', value: 'IGNORE' },
    { eventId: 'ev-303', sequence: 3, channel: 'childVotes', value: 'b' },
  ];
  assert.deepEqual(
    projectAppendChannel(multiChannelLog, 'childVotes'),
    ['a', 'b'],
    'projection MUST filter to target channel only',
  );

  // ── Empty log ──────────────────────────────────────────────────
  assert.deepEqual(projectAppendChannel([], CHANNEL), [], 'empty log → empty projection');

  // eslint-disable-next-line no-console
  console.log(
    'ok cross-engine-append — 4 normative properties + monotonicity + channel-filter + empty verified\n' +
      `  owner-vs-source: projection=${JSON.stringify(ownerOrderProjection)}\n` +
      `  split-brain tie-break: collisions=${splitBrain.collisions}, sorted=${JSON.stringify(splitBrain.values)}\n` +
      `  replay-determinism: 3 input orderings → identical projection\n` +
      `  mixed own/cross: ${JSON.stringify(mixed)}`,
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
