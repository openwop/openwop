/**
 * Arbitrary-event fork coverage — exercises `POST /v1/runs/{runId}:fork`
 * at mid-range `fromSeq` values, not just `fromSeq=0`.
 *
 * Closes the Track 5 (Replay & Determinism) gap from
 * `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`: the existing `replay-fork.test.ts`
 * + `replayDeterminism.test.ts` files only fork from `fromSeq=0` (full
 * replay from start). Real-world replay forks pick a mid-run sequence
 * to skip past expensive nodes or branch from a known-good state, and
 * `replay.md` §"Replay determinism" guarantees apply per-event — not
 * just at the start. This file exercises the arbitrary-fromSeq path.
 *
 * Strategy: use the `conformance-multi-node` fixture (3 noop nodes
 * a → b → c, producing roughly 7-9 events). Start a source run, wait
 * for terminal, read the event log, then pick a fromSeq that lands
 * between node boundaries (after node b's completion event) and fork
 * from there.
 *
 * Gating:
 *   - Outer: `conformance-multi-node` fixture advertised (else the
 *     source run can't be created).
 *   - Inner: `capabilities.replay.modes` includes the mode under test
 *     (`'replay'` or `'branch'`); ctx.skip() when not advertised.
 *   - Inner: 501 response → ctx.skip() (mode advertised but not
 *     implemented; matches the existing scenarios' tolerance).
 *
 * @see spec/v1/replay.md §"Replay-from-event-log internals"
 * @see docs/PROTOCOL-GAP-CLOSURE-PLAN.md Track 5
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const MULTI_NODE_WORKFLOW_ID = 'conformance-multi-node';
const SKIP_NO_MULTI = !isFixtureAdvertised(MULTI_NODE_WORKFLOW_ID);

interface RawEvent {
  readonly eventId?: string;
  readonly seq?: number;
  readonly sequence?: number;
  readonly type?: string;
  readonly nodeId?: string | null;
  readonly data?: unknown;
  [key: string]: unknown;
}

function getSeq(e: RawEvent): number | null {
  if (typeof e.sequence === 'number') return e.sequence;
  if (typeof e.seq === 'number') return e.seq;
  return null;
}

interface ReplayCapability {
  supported?: unknown;
  modes?: unknown;
}

async function fetchReplayCapability(): Promise<ReplayCapability | null> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return null;
  return (res.json as { replay?: ReplayCapability })?.replay ?? null;
}

async function startAndFinishMultiNode(): Promise<string> {
  const create = await driver.post('/v1/runs', { workflowId: MULTI_NODE_WORKFLOW_ID });
  if (create.status !== 201) {
    throw new Error(`Failed to start ${MULTI_NODE_WORKFLOW_ID}: ${create.status}`);
  }
  const runId = (create.json as { runId: string }).runId;
  await pollUntilTerminal(runId, { timeoutMs: 15_000 });
  return runId;
}

async function readEvents(runId: string): Promise<readonly RawEvent[]> {
  const res = await driver.get(
    `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
  );
  if (res.status !== 200) {
    throw new Error(`Failed to read events for ${runId}: ${res.status}`);
  }
  return (res.json as { events?: RawEvent[] })?.events ?? [];
}

/**
 * Pick a mid-range `fromSeq` corresponding to "after node B completes."
 * In the conformance-multi-node fixture (a → b → c), forking here means
 * a + b are inherited as fixed history and only c is re-executed.
 *
 * Returns `null` if the event log doesn't contain a recognisable
 * `node.completed` event for node b — caller treats that as
 * "skip arbitrary-fromSeq tests, the fixture's wire shape is host-
 * specific in a way this scenario doesn't yet handle." Better than
 * a false negative against a perfectly-conformant but unusual host.
 */
function pickMidRangeFromSeq(events: readonly RawEvent[]): number | null {
  const bCompleted = events.find(
    (e) => e.type === 'node.completed' && e.nodeId === 'b',
  );
  if (!bCompleted) return null;
  const seq = getSeq(bCompleted);
  if (seq === null) return null;
  return seq + 1;
}

function structuralShape(
  events: readonly RawEvent[],
): Array<{ type: unknown; nodeId: unknown; data: unknown }> {
  return events.map((e) => ({
    type: e.type,
    nodeId: e.nodeId ?? null,
    // Canonical `payload` (run-event.schema.json) with the legacy `data`
    // field as a fallback for hosts that haven't migrated their envelope.
    data: e.payload ?? e.data ?? null,
  }));
}

describe.skipIf(SKIP_NO_MULTI)(
  'replay-fork-arbitrary: fork from mid-range fromSeq in replay mode reaches terminal',
  () => {
    it('mid-fromSeq replay fork produces a new run that reaches `completed`', async (ctx) => {
      const replay = await fetchReplayCapability();
      if (replay?.supported !== true) {
        ctx.skip();
        return;
      }
      const modes = Array.isArray(replay.modes)
        ? replay.modes.filter((m): m is string => typeof m === 'string')
        : [];
      if (!modes.includes('replay')) {
        ctx.skip();
        return;
      }

      const sourceRunId = await startAndFinishMultiNode();
      const sourceEvents = await readEvents(sourceRunId);
      const fromSeq = pickMidRangeFromSeq(sourceEvents);
      if (fromSeq === null) {
        // Fixture's wire shape doesn't expose node.completed(b) with a
        // numeric sequence — skip rather than fail. Conformant hosts
        // with the standard event shape will hit the assertions below.
        ctx.skip();
        return;
      }

      const fork = await driver.post(
        `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
        { fromSeq, mode: 'replay' },
      );

      if (fork.status === 501) {
        ctx.skip();
        return;
      }
      expect(
        fork.status,
        driver.describe(
          'spec/v1/replay.md §"Replay-from-event-log internals"',
          `mid-range fromSeq=${fromSeq} replay fork MUST return 201`,
        ),
      ).toBe(201);

      const body = fork.json as {
        runId?: unknown;
        sourceRunId?: unknown;
        mode?: unknown;
      };
      expect(typeof body.runId, 'fork response MUST include a new runId').toBe(
        'string',
      );
      expect(
        body.runId,
        'forked runId MUST differ from source',
      ).not.toBe(sourceRunId);
      expect(body.sourceRunId, 'fork response MUST echo sourceRunId').toBe(
        sourceRunId,
      );
      expect(body.mode, 'fork response MUST echo mode').toBe('replay');

      const newRunId = body.runId as string;
      const terminal = await pollUntilTerminal(newRunId, { timeoutMs: 15_000 });
      expect(
        terminal.status,
        driver.describe(
          'spec/v1/replay.md §"Replay determinism"',
          `replay fork from mid-range fromSeq=${fromSeq} MUST reach the same terminal status as the source`,
        ),
      ).toBe('completed');
    }, 60_000);
  },
);

describe.skipIf(SKIP_NO_MULTI)(
  'replay-fork-arbitrary: two replay forks at the same mid-range fromSeq yield identical event shape',
  () => {
    it(
      'mid-fromSeq determinism — same source + same fromSeq → identical post-fork events (modulo IDs + timestamps)',
      async (ctx) => {
        const replay = await fetchReplayCapability();
        if (replay?.supported !== true) {
          ctx.skip();
          return;
        }
        const modes = Array.isArray(replay.modes)
          ? replay.modes.filter((m): m is string => typeof m === 'string')
          : [];
        if (!modes.includes('replay')) {
          ctx.skip();
          return;
        }

        const sourceRunId = await startAndFinishMultiNode();
        const sourceEvents = await readEvents(sourceRunId);
        const fromSeq = pickMidRangeFromSeq(sourceEvents);
        if (fromSeq === null) {
          ctx.skip();
          return;
        }

        // Fork twice at the same mid-range point. Per replay.md, both
        // re-executions of the same source past the same fromSeq MUST
        // produce structurally-identical event tails (modulo
        // timestamps, eventIds, runIds — handled by structuralShape).
        const fork1 = await driver.post(
          `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
          { fromSeq, mode: 'replay' },
        );
        if (fork1.status === 501) {
          ctx.skip();
          return;
        }
        expect(fork1.status).toBe(201);
        const fork1Id = (fork1.json as { runId: string }).runId;
        await pollUntilTerminal(fork1Id, { timeoutMs: 15_000 });

        const fork2 = await driver.post(
          `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
          { fromSeq, mode: 'replay' },
        );
        if (fork2.status === 501) {
          ctx.skip();
          return;
        }
        expect(fork2.status).toBe(201);
        const fork2Id = (fork2.json as { runId: string }).runId;
        await pollUntilTerminal(fork2Id, { timeoutMs: 15_000 });

        const fork1Events = await readEvents(fork1Id);
        const fork2Events = await readEvents(fork2Id);

        // Filter to events emitted AFTER the inherited prefix. Per
        // replay.md, events at sequence < fromSeq are fixed history
        // (inherited verbatim from source); events at sequence >=
        // fromSeq are re-executed and MUST be deterministic across
        // identical-input replays of the same source point.
        //
        // Because the fork inherits the prefix wholesale, both forks
        // share IDENTICAL events for seq < fromSeq. The interesting
        // determinism property is on the re-executed tail.
        const tail1 = fork1Events.filter((e) => {
          const s = getSeq(e);
          return s !== null && s >= fromSeq;
        });
        const tail2 = fork2Events.filter((e) => {
          const s = getSeq(e);
          return s !== null && s >= fromSeq;
        });

        expect(
          tail1.length,
          driver.describe(
            'spec/v1/replay.md §"Replay determinism"',
            `two replay forks at fromSeq=${fromSeq} MUST produce the same number of re-executed events`,
          ),
        ).toBe(tail2.length);

        expect(
          structuralShape(tail1),
          driver.describe(
            'spec/v1/replay.md §"Replay determinism"',
            `event sequence (type/nodeId/data) post-fromSeq=${fromSeq} MUST be identical across two replay forks`,
          ),
        ).toEqual(structuralShape(tail2));
      },
      90_000,
    );
  },
);

describe.skipIf(SKIP_NO_MULTI)(
  'replay-fork-arbitrary: fork from mid-range fromSeq in branch mode reaches terminal with overlay',
  () => {
    it('mid-fromSeq branch fork with empty overlay produces a new run that reaches `completed`', async (ctx) => {
      const replay = await fetchReplayCapability();
      if (replay?.supported !== true) {
        ctx.skip();
        return;
      }
      const modes = Array.isArray(replay.modes)
        ? replay.modes.filter((m): m is string => typeof m === 'string')
        : [];
      if (!modes.includes('branch')) {
        ctx.skip();
        return;
      }

      const sourceRunId = await startAndFinishMultiNode();
      const sourceEvents = await readEvents(sourceRunId);
      const fromSeq = pickMidRangeFromSeq(sourceEvents);
      if (fromSeq === null) {
        ctx.skip();
        return;
      }

      // Branch mode with an empty overlay is the boundary case: the
      // overlay is documented as branch-only, and an empty overlay
      // exercises the schema gate while leaving runtime behavior
      // semantically equivalent to a replay (no input change). The
      // run still MUST reach terminal `completed`.
      const fork = await driver.post(
        `/v1/runs/${encodeURIComponent(sourceRunId)}:fork`,
        { fromSeq, mode: 'branch', runOptionsOverlay: {} },
      );

      if (fork.status === 501) {
        ctx.skip();
        return;
      }
      expect(
        fork.status,
        driver.describe(
          'spec/v1/replay.md §"branch mode"',
          `mid-range fromSeq=${fromSeq} branch fork with empty overlay MUST return 201`,
        ),
      ).toBe(201);

      const newRunId = (fork.json as { runId: string }).runId;
      const terminal = await pollUntilTerminal(newRunId, { timeoutMs: 15_000 });
      expect(
        terminal.status,
        driver.describe(
          'spec/v1/replay.md',
          `branch fork from mid-range fromSeq=${fromSeq} MUST reach terminal status`,
        ),
      ).toBe('completed');
    }, 60_000);
  },
);
