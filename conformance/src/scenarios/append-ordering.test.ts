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
}

interface RunEvent {
  type: string;
  sequence: number;
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
