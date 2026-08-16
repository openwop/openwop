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
import { softSkip } from '../lib/soft-skip.js';
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
 * Volatile field names that differ legitimately between an original run and
 * its replay: freshly-minted event ids/ULIDs, the run id, and per-region
 * clock fields (RFC 0036 §E carve-out). Stripped wherever they appear —
 * including NESTED inside payloads — so the byte-equivalence comparison
 * tolerates only these carve-outs and flags any other divergence.
 */
const VOLATILE_KEYS = new Set([
  'eventId',
  'runId',
  'observedAt',
  'timestamp',
  'occurredAt',
  'emittedAt',
  'id',
]);

/**
 * Recursively strip {@link VOLATILE_KEYS} from an event so two runs of the
 * same workflow are comparable. Recurses into nested objects + arrays (a
 * host that buries a clock or ULID inside a payload is normalized too),
 * leaving every non-volatile field intact for the equivalence assertion.
 */
function stripVolatile(ev: RunEventDoc): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (VOLATILE_KEYS.has(k)) continue;
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(JSON.parse(JSON.stringify(ev)));
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
      if (!(await gateOnPhase4(ctx))) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await gateOnPhase4(ctx))` returned early');

      const sourceRunId = await startFixtureRun(ctx);
      if (sourceRunId === null) return softSkip('blocked', 'precondition not met — `sourceRunId === null` returned early (seam, prior step, or fixture unavailable)');
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
      if (!(await gateOnPhase4(ctx))) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await gateOnPhase4(ctx))` returned early');

      const sourceRunId = await startFixtureRun(ctx);
      if (sourceRunId === null) return softSkip('blocked', 'precondition not met — `sourceRunId === null` returned early (seam, prior step, or fixture unavailable)');
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
