/**
 * Stream-mode scenarios — exercises `GET /v1/runs/{runId}/events` SSE
 * with different `streamMode` query parameters per stream-modes.md.
 *
 * Uses the `conformance-delay` fixture with a short delay (1s) so the
 * stream has well-defined start + completion bounds without making
 * tests slow.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { subscribe, type SseEvent } from '../lib/sse.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const WORKFLOW_ID = 'conformance-delay';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

async function startDelayRun(delayMs: number): Promise<string> {
  const create = await driver.post('/v1/runs', {
    workflowId: WORKFLOW_ID,
    inputs: { delayMs },
  });
  if (create.status !== 201) {
    throw new Error(`Failed to start ${WORKFLOW_ID} run: ${create.status} ${create.text}`);
  }
  return (create.json as { runId: string }).runId;
}

function eventTypes(events: readonly SseEvent[]): string[] {
  return events.map((e) => e.event);
}

describe.skipIf(SKIP_NO_FIXTURE)('stream-modes: updates (default) closes on terminal event', () => {
  it('emits at least run.started + run.completed and server closes the stream', async () => {
    const runId = await startDelayRun(1_000);
    const { events, closedBy } = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=updates`,
      { timeoutMs: 15_000 },
    );

    expect(closedBy, driver.describe(
      'stream-modes.md §updates',
      'server MUST close the connection on terminal run event',
    )).toBe('server');

    const types = eventTypes(events);
    expect(types, driver.describe(
      'stream-modes.md §updates',
      'updates stream MUST include run.started',
    )).toContain('run.started');
    expect(types, driver.describe(
      'stream-modes.md §updates',
      'updates stream MUST include run.completed for a successful run',
    )).toContain('run.completed');
  });
});

describe.skipIf(SKIP_NO_FIXTURE)('stream-modes: invalid streamMode is rejected', () => {
  it('returns 400 and a structured error body', async () => {
    const runId = await startDelayRun(1_000);
    const res = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=does-not-exist`,
    );

    expect(res.status, driver.describe(
      'stream-modes.md §Mode selection',
      'unsupported streamMode MUST return 400',
    )).toBe(400);

    const body = res.json as
      | { error?: unknown; message?: unknown; details?: { supported?: unknown } }
      | undefined;
    expect(typeof body?.error, driver.describe(
      'stream-modes.md §Mode selection + error-envelope.schema.json',
      'unsupported_stream_mode error body MUST include `error` string discriminator',
    )).toBe('string');
    expect(typeof body?.message, driver.describe(
      'error-envelope.schema.json',
      'error envelope MUST include a human-readable `message` string',
    )).toBe('string');
    expect(Array.isArray(body?.details?.supported), driver.describe(
      'stream-modes.md §Mode selection',
      'error body MUST include `details.supported` array of mode names (under `details` per error-envelope.schema.json)',
    )).toBe(true);
  });
});

describe.skipIf(SKIP_NO_FIXTURE)('stream-modes: values mode is reachable + closes on terminal', () => {
  it('returns 200 + emits at least one event + server-closes per stream-modes.md §values', async () => {
    const runId = await startDelayRun(1_000);
    const result = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=values`,
      { timeoutMs: 15_000 },
    );

    // The state.snapshot payload schema is implementation-shaped per
    // spec gap S1, so we don't assert payload shape here. What's
    // canonical: the connection MUST be reachable, MUST emit at least
    // one event before terminal, AND the server MUST close on terminal.
    expect(result.closedBy, driver.describe(
      'stream-modes.md §values',
      'server MUST close the connection on terminal run event',
    )).toBe('server');

    expect(result.events.length, driver.describe(
      'stream-modes.md §values',
      'values mode MUST emit at least one event before terminal',
    )).toBeGreaterThan(0);
  });
});

describe.skipIf(SKIP_NO_FIXTURE)('stream-modes: debug emits at least as many events as updates', () => {
  it('debug stream is a superset of updates per stream-modes.md mode-mapping', async () => {
    const runIdUpdates = await startDelayRun(1_000);
    const updatesResult = await subscribe(
      `/v1/runs/${encodeURIComponent(runIdUpdates)}/events?streamMode=updates`,
      { timeoutMs: 15_000 },
    );

    const runIdDebug = await startDelayRun(1_000);
    const debugResult = await subscribe(
      `/v1/runs/${encodeURIComponent(runIdDebug)}/events?streamMode=debug`,
      { timeoutMs: 15_000 },
    );

    // Both runs are conformance-delay with the same input, so updates
    // events (run.started, node.started not in updates per spec, node.completed,
    // run.completed) should be a subset of debug events.
    expect(debugResult.events.length, driver.describe(
      'stream-modes.md mode-to-event mapping',
      'debug stream event count MUST be >= updates stream event count',
    )).toBeGreaterThanOrEqual(updatesResult.events.length);

    expect(debugResult.closedBy, driver.describe(
      'stream-modes.md §debug',
      'debug stream MUST close on terminal event',
    )).toBe('server');
  });
});
