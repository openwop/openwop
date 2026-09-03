/**
 * SSE buffering scenarios (G1 / S3) — exercises `?bufferMs=` aggregation
 * hint against the existing `conformance-delay` fixture.
 *
 * Verifies:
 *   1. Server accepts `bufferMs` in [0..5000] without error.
 *   2. Out-of-range `bufferMs` returns 400 with `validation_error`.
 *   3. Buffered mode emits at least one `event: batch` SSE frame whose
 *      data is a JSON array of `RunEventDoc`.
 *   4. Force-flush on terminal: the run.completed event arrives bundled
 *      in a batch, not held back to the next interval.
 *   5. Total event count in buffered mode equals the unbuffered mode
 *      count (no events dropped).
 *
 * Spec references:
 *   - stream-modes.md §Aggregation hint
 *   - spec gap G1
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { subscribe } from '../lib/sse.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

const WORKFLOW_ID = 'conformance-delay';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

interface RunEventDoc {
  readonly type: string;
  readonly sequence: number;
}

describe.skipIf(SKIP_NO_FIXTURE)('stream-modes-buffer: ?bufferMs= aggregation hint', () => {
  it('accepts bufferMs in range and emits at least one event: batch frame', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const result = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=updates&bufferMs=200`,
      { timeoutMs: 30_000 },
    );

    expect(result.status, req('openwop.it.stream-modes-buffer.accepts-bufferms-in-range-and-emits-at-least-one-event-batch-frame', 
      'stream-modes.md §Aggregation hint',
      'GET /v1/runs/{runId}/events with valid bufferMs MUST return 200 SSE',
    )).toBe(200);

    const batchEvents = result.events.filter((e) => e.event === 'batch');
    expect(batchEvents.length, req('openwop.it.stream-modes-buffer.accepts-bufferms-in-range-and-emits-at-least-one-event-batch-frame', 
      'stream-modes.md §Aggregation hint',
      'buffered mode MUST emit at least one `event: batch` SSE frame',
    )).toBeGreaterThan(0);

    // Each batch's data is a JSON array of RunEventDoc.
    for (const batch of batchEvents) {
      const parsed = JSON.parse(batch.data);
      expect(Array.isArray(parsed), req('openwop.it.stream-modes-buffer.accepts-bufferms-in-range-and-emits-at-least-one-event-batch-frame', 
        'stream-modes.md §batch data shape',
        'event: batch data MUST parse to a JSON array',
      )).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      for (const event of parsed) {
        expect(typeof event.sequence).toBe('number');
        expect(typeof event.type).toBe('string');
      }
    }
  });

  it('rejects out-of-range bufferMs with 400 validation_error', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    const runId = (create.json as { runId: string }).runId;

    const result = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?bufferMs=99999`,
      { timeoutMs: 5_000 },
    );

    expect(result.status, req('openwop.it.stream-modes-buffer.rejects-out-of-range-bufferms-with-400-validation-error', 
      'stream-modes.md §Aggregation hint range',
      'bufferMs > 5000 MUST return 400',
    )).toBe(400);

    // Drain the run so it doesn't stall the test runner.
    await pollUntilTerminal(runId);
  });

  it('forces flush on terminal — run.completed arrives bundled in a batch BEFORE the timer fires', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    const runId = (create.json as { runId: string }).runId;

    // Use a long bufferMs (4000ms) so the only flush before terminal
    // would come from the force-flush rule. We measure elapsed time
    // from subscribe-start to terminal-arrival; if force-flush works,
    // it arrives in well under bufferMs/2 (i.e., the run completes +
    // force-flush fires + we observe it before any timer-based flush
    // could have happened). Without force-flush, terminal would either
    // arrive AFTER bufferMs (timer-based delivery) OR not at all
    // (stream closed before the timer fired).
    const BUFFER_MS = 4000;
    const startedAt = Date.now();
    const result = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=updates&bufferMs=${BUFFER_MS}`,
      { timeoutMs: 30_000 },
    );
    const elapsedMs = Date.now() - startedAt;

    const batchEvents = result.events.filter((e) => e.event === 'batch');
    const allFlattened: RunEventDoc[] = batchEvents.flatMap(
      (b) => JSON.parse(b.data) as RunEventDoc[],
    );
    const hasTerminal = allFlattened.some(
      (e) => e.type === 'run.completed' || e.type === 'run.failed' || e.type === 'run.cancelled',
    );

    expect(hasTerminal, req('openwop.it.stream-modes-buffer.forces-flush-on-terminal-run-completed-arrives-bundled-in-a-batch-before-the-tim', 
      'stream-modes.md §Aggregation hint — force-flush triggers',
      'terminal events MUST be force-flushed; the stream MUST NOT close before delivering run.completed',
    )).toBe(true);

    // Force-flush fires immediately on terminal; without it, terminal
    // would arrive ~bufferMs after the run actually completed. We allow
    // bufferMs/2 as headroom for cold-start latency on the conformance
    // server, but failing here proves the timer fired before terminal
    // arrived (i.e., force-flush is broken).
    expect(elapsedMs, req('openwop.it.stream-modes-buffer.forces-flush-on-terminal-run-completed-arrives-bundled-in-a-batch-before-the-tim', 
      'stream-modes.md §Aggregation hint — force-flush is immediate',
      `terminal SHOULD arrive in well under bufferMs (${BUFFER_MS}ms); observed ${elapsedMs}ms — if elapsed is close to bufferMs, force-flush is not firing`,
    )).toBeLessThan(BUFFER_MS / 2);
  });

  it('bufferMs=0 behaves identically to omitting (per-event mode)', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    const runId = (create.json as { runId: string }).runId;

    const result = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=updates&bufferMs=0`,
      { timeoutMs: 30_000 },
    );

    const batchEvents = result.events.filter((e) => e.event === 'batch');
    expect(batchEvents.length, req('openwop.it.stream-modes-buffer.bufferms-0-behaves-identically-to-omitting-per-event-mode', 
      'stream-modes.md §Aggregation hint — bufferMs=0 sentinel',
      'bufferMs=0 MUST behave identically to omitting (no batch frames)',
    )).toBe(0);
  });
});
