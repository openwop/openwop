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
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const WORKFLOW_ID = 'conformance-delay';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);
const NO_FIXTURE_REASON = `precondition not met — \`${WORKFLOW_ID}\` is not advertised, so this host cannot witness the stream-modes floor. RFC 0148 §A: \`blocked\`, naming the fixture (#1686: a describe-level skip recorded no disposition, and an unrecorded floor rejected the whole certification)`;

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

describe('stream-modes: updates (default) closes on terminal event', () => {
  it('emits at least run.started + run.completed and server closes the stream', async () => {
    if (SKIP_NO_FIXTURE) return softSkip('blocked', NO_FIXTURE_REASON);
    const runId = await startDelayRun(1_000);
    const { events, closedBy } = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=updates`,
      { timeoutMs: 15_000 },
    );

    expect(closedBy, req('openwop.it.stream-modes.emits-at-least-run-started-run-completed-and-server-closes-the-stream', 
      'stream-modes.md §updates',
      'server MUST close the connection on terminal run event',
    )).toBe('server');

    const types = eventTypes(events);
    expect(types, req('openwop.it.stream-modes.emits-at-least-run-started-run-completed-and-server-closes-the-stream', 
      'stream-modes.md §updates',
      'updates stream MUST include run.started',
    )).toContain('run.started');
    expect(types, req('openwop.it.stream-modes.emits-at-least-run-started-run-completed-and-server-closes-the-stream', 
      'stream-modes.md §updates',
      'updates stream MUST include run.completed for a successful run',
    )).toContain('run.completed');
  });
});

describe('stream-modes: invalid streamMode is rejected', () => {
  it('returns 400 and a structured error body', async () => {
    if (SKIP_NO_FIXTURE) return softSkip('blocked', NO_FIXTURE_REASON);
    const runId = await startDelayRun(1_000);
    const res = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=does-not-exist`,
    );

    expect(res.status, req('openwop.it.stream-modes.returns-400-and-a-structured-error-body', 
      'stream-modes.md §Mode selection',
      'unsupported streamMode MUST return 400',
    )).toBe(400);

    const body = res.json as
      | { error?: unknown; message?: unknown; details?: { supported?: unknown } }
      | undefined;
    expect(typeof body?.error, req('openwop.it.stream-modes.returns-400-and-a-structured-error-body', 
      'stream-modes.md §Mode selection + error-envelope.schema.json',
      'unsupported_stream_mode error body MUST include `error` string discriminator',
    )).toBe('string');
    expect(typeof body?.message, req('openwop.it.stream-modes.returns-400-and-a-structured-error-body', 
      'error-envelope.schema.json',
      'error envelope MUST include a human-readable `message` string',
    )).toBe('string');
    expect(Array.isArray(body?.details?.supported), req('openwop.it.stream-modes.returns-400-and-a-structured-error-body', 
      'stream-modes.md §Mode selection',
      'error body MUST include `details.supported` array of mode names (under `details` per error-envelope.schema.json)',
    )).toBe(true);
  });
});

describe('stream-modes: values mode is reachable + closes on terminal', () => {
  it('returns 200 + emits at least one event + server-closes per stream-modes.md §values', async () => {
    if (SKIP_NO_FIXTURE) return softSkip('blocked', NO_FIXTURE_REASON);
    const runId = await startDelayRun(1_000);
    const result = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=values`,
      { timeoutMs: 15_000 },
    );

    // The state.snapshot payload schema is implementation-shaped per
    // spec gap S1, so we don't assert payload shape here. What's
    // canonical: the connection MUST be reachable, MUST emit at least
    // one event before terminal, AND the server MUST close on terminal.
    expect(result.closedBy, req('openwop.it.stream-modes.returns-200-emits-at-least-one-event-server-closes-per-stream-modes-md-values', 
      'stream-modes.md §values',
      'server MUST close the connection on terminal run event',
    )).toBe('server');

    expect(result.events.length, req('openwop.it.stream-modes.returns-200-emits-at-least-one-event-server-closes-per-stream-modes-md-values', 
      'stream-modes.md §values',
      'values mode MUST emit at least one event before terminal',
    )).toBeGreaterThan(0);
  });
});

describe('stream-modes: debug emits at least as many events as updates', () => {
  it('debug stream is a superset of updates per stream-modes.md mode-mapping', async () => {
    if (SKIP_NO_FIXTURE) return softSkip('blocked', NO_FIXTURE_REASON);
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
    expect(debugResult.events.length, req('openwop.it.stream-modes.debug-stream-is-a-superset-of-updates-per-stream-modes-md-mode-mapping', 
      'stream-modes.md mode-to-event mapping',
      'debug stream event count MUST be >= updates stream event count',
    )).toBeGreaterThanOrEqual(updatesResult.events.length);

    // unfailable-leg audit wave 2, 2026-09-27: superset-by-COUNT alone passed a
    // host whose debug stream dropped canonical types (e.g. no run.completed)
    // as long as it padded the count with other frames (log.appended,
    // keep-alive-ish events). The mapping table is per TYPE: every type the
    // updates stream carried MUST appear in debug, and debug MUST carry
    // node.started (✅ debug / — updates) — the conformance-delay fixture has
    // one node (`wait`), so a debug stream without node.started is filtering.
    const typeOf = (e: SseEvent): string => {
      if (e.event !== 'message') return e.event;
      try {
        const t = (JSON.parse(e.data) as { type?: unknown }).type;
        return typeof t === 'string' ? t : e.event;
      } catch {
        return e.event;
      }
    };
    const debugTypes = new Set(debugResult.events.map(typeOf));
    const missingFromDebug = [...new Set(updatesResult.events.map(typeOf))].filter((t) => !debugTypes.has(t));
    expect(missingFromDebug, req('openwop.it.stream-modes.debug-stream-is-a-superset-of-updates-per-stream-modes-md-mode-mapping', 
      'stream-modes.md §Mode-to-event mapping',
      'every event type emitted in updates mode is also ✅ in debug mode — debug MUST carry each of them',
    )).toEqual([]);
    expect([...debugTypes], req('openwop.it.stream-modes.debug-stream-is-a-superset-of-updates-per-stream-modes-md-mode-mapping', 
      'stream-modes.md §Mode-to-event mapping',
      'debug mode MUST emit node.started (✅ debug) for the fixture\'s node',
    )).toContain('node.started');

    expect(debugResult.closedBy, req('openwop.it.stream-modes.debug-stream-is-a-superset-of-updates-per-stream-modes-md-mode-mapping', 
      'stream-modes.md §debug',
      'debug stream MUST close on terminal event',
    )).toBe('server');
  });
});
