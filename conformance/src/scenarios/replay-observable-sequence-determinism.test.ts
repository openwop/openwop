/**
 * replay-observable-sequence-determinism — RFC 0041 §C behavioral.
 *
 * Status: ACTIVE (capability-gated behavioral). Gated on
 * `capabilities.multiAgent.executionModel.version >= 4` AND
 * `capabilities.multiAgent.executionModel.replayDeterminism.supported: true`.
 *
 * Asserts (behavioral, when a host advertises `version: 4` + the contract):
 *
 *   1. A `mode: replay` fork from event-log index `fromSeq` produces an
 *      observable event-log prefix `[0, fromSeq]` that is byte-equivalent
 *      to the original run's prefix (modulo volatile per-event fields:
 *      eventId/ULID entropy, per-region `observedAt` clocks per RFC 0036
 *      §E, and the run id itself).
 *
 *   2. (Crucially per §C.) The replay reproduces the OBSERVABLE RESULT of
 *      a nondeterministic tool node EVEN WHEN a fresh call would produce
 *      different bytes. The `conformance-phase4-nondet-tool` fixture's
 *      first node declares `config.nondeterministic: true`; a `version: 4`
 *      host MUST replay the original event-log entries for that node
 *      (cache the observable result) rather than re-executing it, so the
 *      node's terminal payload is identical across original + replay.
 *
 * The `conformance-phase4-nondet-tool` fixture ships in the suite (added
 * via the RFC 0041 Phase 4 fixtures commit). These assertions are now
 * runnable capability-gated `it()` bodies — consistent with the sibling
 * `replay-divergence-at-refusal.test.ts`, which is likewise active and
 * soft-skips on the same gate. They light up the moment a host advertises
 * the `version: 4` replay-determinism contract; against hosts that don't
 * (incl. the reference workflow-engine, which has not yet wired the
 * pure-replay observable-cache path), they soft-skip honestly.
 *
 * RFC 0042 §B note: RFC 0041 §C is `Active` (not yet `Accepted`), so its
 * wire shape MAY shift compatibly within v1.x — a host wiring this before
 * RFC 0041 graduates SHOULD advertise `multiAgent.executionModel.tier:
 * 'experimental'` + `experimentalUntil` per RFC 0042 §A.
 *
 * @see RFCS/0041-multi-agent-replay-under-nondeterminism.md §C
 * @see spec/v1/replay.md §"Observable-output-sequence determinism vs bit-equivalent execution (MAE-9 closure)"
 * @see spec/v1/multi-agent-execution.md §"Replay determinism under nondeterminism (RFC 0041)"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const FIXTURE = 'conformance-phase4-nondet-tool';
const NONDET_NODE_ID = 'nondet-tool';

interface ExecutionModelCaps {
  version?: unknown;
  replayDeterminism?: { supported?: unknown };
}
interface DiscoveryDoc {
  capabilities?: {
    multiAgent?: { executionModel?: ExecutionModelCaps };
  };
}

interface RunSnapshot {
  status?: string;
}
interface RunEventDoc {
  type: string;
  nodeId?: string;
  sequence?: number;
  payload?: Record<string, unknown>;
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

/** Soft-skip unless the host advertises the RFC 0041 §C version-4 contract. */
async function gateOnPhase4(ctx: { skip: () => void }): Promise<boolean> {
  const d = await readDiscovery();
  const em = capabilityFamily<{ executionModel?: ExecutionModelCaps }>(d, 'multiAgent')?.executionModel;
  const version = typeof em?.version === 'number' ? em.version : 0;
  if (em?.replayDeterminism?.supported !== true || version < 4) {
    ctx.skip();
    return false;
  }
  return true;
}

async function pollUntilTerminal(runId: string): Promise<RunSnapshot> {
  for (let i = 0; i < 50; i++) {
    const r = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const snap = r.json as RunSnapshot;
    if (snap.status === 'completed' || snap.status === 'failed' || snap.status === 'cancelled') {
      return snap;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`run ${runId} did not reach terminal within 5s`);
}

async function readEvents(runId: string): Promise<RunEventDoc[]> {
  const r = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
  const body = r.json as { events?: RunEventDoc[] };
  return body.events ?? [];
}

/**
 * Strip volatile per-event fields so two runs of the same workflow are
 * comparable. Removes the run id, freshly-minted event ids/ULIDs, and the
 * per-region observed-at clock (RFC 0036 §E carve-out) wherever they
 * appear at the event top level.
 */
function stripVolatile(ev: RunEventDoc): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(ev)) as Record<string, unknown>;
  for (const k of ['eventId', 'runId', 'observedAt', 'timestamp', 'occurredAt', 'emittedAt', 'id']) {
    delete clone[k];
  }
  return clone;
}

/** Create the fixture run; returns null (with a skip) if it isn't advertised. */
async function startFixtureRun(ctx: { skip: () => void }): Promise<string | null> {
  const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
  if (create.status === 404 || create.status === 422) {
    ctx.skip(); // fixture not advertised by this host
    return null;
  }
  expect(create.status).toBe(201);
  return (create.json as { runId: string }).runId;
}

describe.skipIf(HTTP_SKIP)(
  'replay-observable-sequence-determinism: prefix byte-equivalence (RFC 0041 §C)',
  () => {
    it('original and replay event-log prefixes MUST be byte-equivalent (modulo per-event clock + ULID entropy)', async (ctx) => {
      if (!(await gateOnPhase4(ctx))) return;

      const sourceRunId = await startFixtureRun(ctx);
      if (sourceRunId === null) return;
      const sourceTerminal = await pollUntilTerminal(sourceRunId);
      expect(sourceTerminal.status).toBe('completed');
      const sourceEvents = await readEvents(sourceRunId);

      const forkRes = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
        fromSeq: 0,
        mode: 'replay',
      });
      expect(forkRes.status).toBe(201);
      const replayRunId = (forkRes.json as { runId: string }).runId;
      await pollUntilTerminal(replayRunId);
      const replayEvents = await readEvents(replayRunId);

      const sourceNorm = sourceEvents.map(stripVolatile);
      const replayNorm = replayEvents.map(stripVolatile);
      expect(
        replayNorm,
        driver.describe(
          'RFCS/0041-multi-agent-replay-under-nondeterminism.md §C',
          'a mode:replay fork MUST reproduce the original observable event-log sequence byte-for-byte modulo volatile per-event fields (eventId/ULID entropy, per-region observedAt clock)',
        ),
      ).toEqual(sourceNorm);
    });
  },
);

describe.skipIf(HTTP_SKIP)(
  'replay-observable-sequence-determinism: observable-result caching (RFC 0041 §C)',
  () => {
    it('replay of a nondeterministic tool node reproduces the ORIGINAL observable result, NOT a fresh call', async (ctx) => {
      if (!(await gateOnPhase4(ctx))) return;

      const sourceRunId = await startFixtureRun(ctx);
      if (sourceRunId === null) return;
      expect((await pollUntilTerminal(sourceRunId)).status).toBe('completed');
      const sourceEvents = await readEvents(sourceRunId);

      // The terminal event(s) for the nondeterministic node carry its
      // observable result. Capture every event scoped to that node.
      const sourceNodeEvents = sourceEvents.filter((e) => e.nodeId === NONDET_NODE_ID).map(stripVolatile);
      expect(
        sourceNodeEvents.length,
        driver.describe(
          'RFCS/0041-multi-agent-replay-under-nondeterminism.md §C',
          `the fixture's nondeterministic node \`${NONDET_NODE_ID}\` MUST emit at least one observable event`,
        ),
      ).toBeGreaterThan(0);

      const forkRes = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, {
        fromSeq: 0,
        mode: 'replay',
      });
      expect(forkRes.status).toBe(201);
      const replayRunId = (forkRes.json as { runId: string }).runId;
      await pollUntilTerminal(replayRunId);
      const replayEvents = await readEvents(replayRunId);
      const replayNodeEvents = replayEvents.filter((e) => e.nodeId === NONDET_NODE_ID).map(stripVolatile);

      expect(
        replayNodeEvents,
        driver.describe(
          'RFCS/0041-multi-agent-replay-under-nondeterminism.md §C',
          'the nondeterministic tool node MUST replay its ORIGINAL observable result (cached event-log entry) rather than re-executing — bit-equivalent re-execution would require unbounded caching, rejected per RFC 0041 §"Alternatives considered" #2',
        ),
      ).toEqual(sourceNodeEvents);
    });
  },
);
