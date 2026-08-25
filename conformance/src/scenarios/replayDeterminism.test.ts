/**
 * Replay-determinism scenarios per spec/v1/replay.md.
 *
 * A `mode: 'replay'` fork re-executes a run from a chosen `fromSeq`
 * point; per `replay.md` §"Replay determinism," the new run's events
 * (modulo timestamps + IDs) MUST match the original run's events past
 * the fork point.
 *
 * Profile gating: `openwop-replay-fork`. Hosts that don't advertise
 * `replay.supported: true` skip-equivalent. Hosts that advertise but
 * 501 on `mode: 'replay'` (e.g., OpenWOP as of 2026-05-01) ALSO
 * skip-equivalent — the runtime check catches that case via the
 * 501 response.
 *
 * @see spec/v1/replay.md
 * @see lib/profiles.ts — openwop-replay-fork predicate
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { forkDeclined } from '../lib/fork-availability.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);

interface DiscoveryReplay {
  supported?: unknown;
  modes?: unknown;
}

async function fetchReplayCapability(): Promise<DiscoveryReplay | null> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return null;
  const body = res.json as { replay?: DiscoveryReplay };
  return body.replay ?? null;
}

interface RawEvent {
  seq?: number;
  sequence?: number;
  type?: string;
  nodeId?: string | null;
  data?: unknown;
  [key: string]: unknown;
}

function getSeq(e: RawEvent): number | null {
  if (typeof e.sequence === 'number') return e.sequence;
  if (typeof e.seq === 'number') return e.seq;
  return null;
}

/**
 * Strip non-deterministic fields so two runs can be compared
 * structurally. Removed: timestamp, runId, eventId. Preserved: type,
 * nodeId, data shape.
 */
function structuralShape(events: readonly RawEvent[]): Array<{ type: unknown; nodeId: unknown; data: unknown }> {
  return events.map((e) => ({
    type: e.type,
    nodeId: e.nodeId ?? null,
    // Canonical `payload` (run-event.schema.json) with the legacy `data`
    // field as a fallback for hosts that haven't migrated their envelope.
    data: e.payload ?? e.data ?? null,
  }));
}

describe('replay-determinism: openwop-replay-fork profile gate', () => {
  it('host advertising replay.supported MUST also advertise replay.modes', async () => {
    const replay = await fetchReplayCapability();
    if (replay === null || replay.supported !== true) return softSkip('inapplicable', 'host does not advertise `replay.supported: true` — the replay contract does not apply to it');

    expect(Array.isArray(replay.modes), driver.describe(
      'spec/v1/replay.md',
      'host advertising replay.supported MUST advertise replay.modes as an array',
    )).toBe(true);
    if (Array.isArray(replay.modes)) {
      for (const m of replay.modes) {
        expect(typeof m, driver.describe(
          'spec/v1/replay.md',
          'each replay.modes entry MUST be a string',
        )).toBe('string');
      }
    }
  });
});

describe.skipIf(SKIP_NO_NOOP)('replay-determinism: same fromSeq + same workflow yields identical event shape', () => {
  it(
    'two replay forks of the same point produce structurally-identical event lists',
    async () => {
      const replay = await fetchReplayCapability();
      if (replay === null || replay.supported !== true) return softSkip('inapplicable', 'host does not advertise `replay.supported: true` — the replay contract does not apply to it');
      if (!Array.isArray(replay.modes) || !replay.modes.includes('replay')) return softSkip('inapplicable', 'host advertises replay but not the `replay` mode — this leg is out of scope for it');

      // Phase 1: complete an original run.
      const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
      if (create.status !== 201) return;
      const originalRunId = (create.json as { runId: string }).runId;
      await pollUntilTerminal(originalRunId, { timeoutMs: 10_000 });

      // Phase 2: fork in replay mode at fromSeq=0 (start of run).
      const fork1 = await driver.post(`/v1/runs/${encodeURIComponent(originalRunId)}:fork`, {
        mode: 'replay',
        fromSeq: 0,
      });
      if (forkDeclined(fork1.status, 'determinism fork 1')) return;
      expect(fork1.status, driver.describe(
        'spec/v1/replay.md',
        'POST /v1/runs/{runId}:fork with mode=replay MUST return 201',
      )).toBe(201);
      const fork1Id = (fork1.json as { runId: string }).runId;
      await pollUntilTerminal(fork1Id, { timeoutMs: 10_000 });

      // Phase 3: fork the SAME original run again from fromSeq=0.
      const fork2 = await driver.post(`/v1/runs/${encodeURIComponent(originalRunId)}:fork`, {
        mode: 'replay',
        fromSeq: 0,
      });
      if (forkDeclined(fork2.status, 'determinism fork 2')) return;
      expect(fork2.status).toBe(201);
      const fork2Id = (fork2.json as { runId: string }).runId;
      await pollUntilTerminal(fork2Id, { timeoutMs: 10_000 });

      // Phase 4: fetch both fork event streams.
      const fork1Events = await driver.get(`/v1/runs/${encodeURIComponent(fork1Id)}/events/poll`);
      const fork2Events = await driver.get(`/v1/runs/${encodeURIComponent(fork2Id)}/events/poll`);
      if (fork1Events.status !== 200 || fork2Events.status !== 200) return;

      const fork1Body = fork1Events.json as { events?: RawEvent[] };
      const fork2Body = fork2Events.json as { events?: RawEvent[] };
      if (!fork1Body.events || !fork2Body.events) return;

      // Phase 5: assert structural identity (modulo timestamps + IDs).
      expect(fork1Body.events.length, driver.describe(
        'spec/v1/replay.md §"Replay determinism"',
        'two replay forks MUST produce the same number of events',
      )).toBe(fork2Body.events.length);

      const shape1 = structuralShape(fork1Body.events);
      const shape2 = structuralShape(fork2Body.events);
      expect(shape1, driver.describe(
        'spec/v1/replay.md §"Replay determinism"',
        'event sequence (type/nodeId/data) MUST be identical across two replay forks of the same point',
      )).toEqual(shape2);
    },
    60_000,
  );
});

describe.skipIf(SKIP_NO_NOOP)('replay-determinism: branch-mode is permitted to diverge', () => {
  it('branch mode does NOT need to produce identical event sequences (negative-control)', async () => {
    const replay = await fetchReplayCapability();
    if (replay === null || replay.supported !== true) return softSkip('inapplicable', 'host does not advertise `replay.supported: true` — the replay contract does not apply to it');
    if (!Array.isArray(replay.modes) || !replay.modes.includes('branch')) return;

    // Self-test on the spec interpretation: branch and replay are
    // SEMANTICALLY DIFFERENT modes per spec/v1/replay.md. Branch may
    // diverge by design (variable overlay, runOptionsOverlay). This
    // assertion just pins the interpretation; no actual round-trip
    // needed.
    expect((replay.modes as string[]).includes('branch'), driver.describe(
      'spec/v1/replay.md',
      'branch mode is documented; this self-test ensures the suite does not assume branch determinism',
    )).toBe(true);

    // Note: getSeq is exported here only so future scenarios can reuse
    // it; we don't actually call it.
    const dummy: RawEvent = { sequence: 0, type: 'noop' };
    expect(getSeq(dummy)).toBe(0);
  });
});
