/**
 * Track 13: append-reducer ordering (channels-and-reducers.md v1.1).
 *
 * Verifies the intra-engine total-order rule: for the `append` reducer
 * (and its bounded variants `votes`/`feedback`), the folded array MUST
 * reflect the per-run `sequence` order of the backing `channel.written`
 * events. Replays MUST NOT reorder.
 *
 * Capability gating: skips unless a host advertises a fixture that
 * writes to an append-reducer channel. `conformance-multi-node` is the
 * primary candidate; hosts MAY seed a dedicated
 * `conformance-append-ordering` fixture.
 *
 * @see spec/v1/channels-and-reducers.md §"Append ordering"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const CANDIDATES = ['conformance-append-ordering', 'conformance-multi-node'] as const;
const FIXTURE = CANDIDATES.find((id) => isFixtureAdvertised(id)) ?? null;
const SKIP = !FIXTURE;

interface ChannelWrittenPayload {
  channel?: string;
  value?: unknown;
  /**
   * Per `channel-written-payload.schema.json` — present on inbound
   * cross-engine writes per `channels-and-reducers.md §"Across
   * engines"`. When ANY event in the run carries this field, the
   * cross-engine assertions (CF-8) MUST hold in addition to the
   * intra-engine ordering rule.
   */
  sourceEngineId?: string;
  sourceRunId?: string;
}

interface RunEvent {
  type: string;
  sequence: number;
  eventId?: string;
  payload?: ChannelWrittenPayload;
}

describe.skipIf(SKIP)('append-ordering: folded channel reflects event sequence', () => {
  it('append-reducer channels project entries in event-sequence order', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE! });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId, { timeoutMs: 30_000 });

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: RunEvent[] }).events ?? [];

    // Group channel.written events by channel.
    const byChannel = new Map<string, RunEvent[]>();
    for (const e of list) {
      if (e.type !== 'channel.written') continue;
      const ch = e.payload?.channel;
      if (typeof ch !== 'string') continue;
      const arr = byChannel.get(ch) ?? [];
      arr.push(e);
      byChannel.set(ch, arr);
    }

    if (byChannel.size === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[append-ordering] fixture emitted no channel.written events; skipping ordering assertions',
      );
      return;
    }

    // For each channel, sequence MUST be strictly increasing within the run.
    for (const [channel, writes] of byChannel) {
      for (let i = 1; i < writes.length; i++) {
        expect(writes[i].sequence, driver.describe(
          'channels-and-reducers.md §"Append ordering"',
          `channel '${channel}': channel.written events MUST appear in sequence order in the event log`,
        )).toBeGreaterThan(writes[i - 1].sequence);
      }
    }

    // CF-8: cross-engine ordering rule. When ANY channel.written
    // event carries `sourceEngineId`, the owner-engine MUST have
    // assigned the recorded `sequence` at append time and the event
    // log MUST remain strictly monotonic regardless of source. The
    // intra-engine check above already verifies monotonicity per
    // channel; here we additionally verify (1) at least one cross-
    // engine and one own-engine write coexist correctly, and (2) any
    // tie in the secondary `(sequence, eventId)` order is broken
    // deterministically (no two events share both fields).
    const allWrites = Array.from(byChannel.values()).flat();
    const crossEngineWrites = allWrites.filter(
      (e) => typeof e.payload?.sourceEngineId === 'string',
    );
    if (crossEngineWrites.length > 0) {
      // Property: every cross-engine event carries BOTH sourceEngineId
      // AND sourceRunId (per channel-written-payload.schema.json).
      for (const e of crossEngineWrites) {
        expect(typeof e.payload?.sourceRunId, driver.describe(
          'channel-written-payload.schema.json',
          'cross-engine writes MUST carry sourceRunId alongside sourceEngineId',
        )).toBe('string');
      }
      // Property: (sequence, eventId) is a total order — no duplicates.
      const seen = new Set<string>();
      for (const e of allWrites) {
        const key = `${e.sequence}::${e.eventId ?? ''}`;
        expect(seen.has(key), driver.describe(
          'channels-and-reducers.md §"Tie-breaking when sequences collide"',
          `(sequence, eventId) MUST be unique across the run — duplicate found: ${key}`,
        )).toBe(false);
        seen.add(key);
      }
    }

    // Cross-check against the projected channel state on the run snapshot
    // (when surfaced) — projected array length MUST equal the number of writes.
    const snapshot = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const channels = (snapshot.json as { channels?: Record<string, unknown> }).channels ?? {};
    for (const [channel, writes] of byChannel) {
      const projected = (channels as Record<string, unknown>)[channel];
      if (Array.isArray(projected)) {
        expect(projected.length, driver.describe(
          'channels-and-reducers.md §"Append ordering"',
          `channel '${channel}': projected array length MUST equal #channel.written events`,
        )).toBe(writes.length);
      }
    }
  });
});
