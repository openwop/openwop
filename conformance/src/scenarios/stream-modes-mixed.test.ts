/**
 * Mixed-mode SSE scenarios (G2 / S4) — exercises comma-separated
 * `?streamMode=` against the existing `conformance-delay` fixture.
 *
 * Verifies:
 *   1. Server accepts `streamMode=updates,messages` (mixed subset).
 *   2. Server rejects `streamMode=values,updates` with 400 +
 *      `unsupported_stream_mode` error envelope (values is exclusive).
 *   3. Server rejects `streamMode=updates,bogus` (one bad mode → whole
 *      list fails).
 *   4. Mixed mode sees AT LEAST every event the corresponding single
 *      mode would see (union semantics).
 *
 * Spec references:
 *   - stream-modes.md §Mixed mode (closes S4)
 *   - spec gap G2
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { subscribe, type SseEvent } from '../lib/sse.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

const WORKFLOW_ID = 'conformance-delay';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

function eventTypes(events: readonly SseEvent[]): string[] {
  return events.map((e) => e.event);
}

describe.skipIf(SKIP_NO_FIXTURE)('stream-modes-mixed: comma-separated subsets', () => {
  it('accepts streamMode=updates,messages and emits a server-closed stream', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      inputs: { delayMs: 500 },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const result = await subscribe(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=updates,messages`,
      { timeoutMs: 15_000 },
    );

    expect(result.status, req('openwop.it.stream-modes-mixed.accepts-streammode-updates-messages-and-emits-a-server-closed-stream', 
      'stream-modes.md §Mixed mode',
      'streamMode=updates,messages MUST return 200',
    )).toBe(200);

    expect(result.closedBy, req('openwop.it.stream-modes-mixed.accepts-streammode-updates-messages-and-emits-a-server-closed-stream', 
      'stream-modes.md §Mixed mode + §updates',
      'server MUST close the stream on terminal run event',
    )).toBe('server');

    const types = eventTypes(result.events);
    expect(types, req('openwop.it.stream-modes-mixed.accepts-streammode-updates-messages-and-emits-a-server-closed-stream', 
      'stream-modes.md §Mixed mode (union semantics)',
      'mixed updates,messages MUST include run.completed (admitted by updates)',
    )).toContain('run.completed');
  });

  it('rejects streamMode=values,updates with 400 + unsupported_stream_mode', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      inputs: { delayMs: 100 },
    });
    const runId = (create.json as { runId: string }).runId;

    const res = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=values,updates`,
    );
    expect(res.status, req('openwop.it.stream-modes-mixed.rejects-streammode-values-updates-with-400-unsupported-stream-mode', 
      'stream-modes.md §Mixed mode',
      'values combined with another mode MUST return 400',
    )).toBe(400);

    const body = res.json as
      | { error?: string; message?: string; details?: { supported?: string[] } }
      | undefined;
    expect(body?.error, req('openwop.it.stream-modes-mixed.rejects-streammode-values-updates-with-400-unsupported-stream-mode', 
      'stream-modes.md §Mode selection error envelope + error-envelope.schema.json',
      'unsupported_stream_mode error envelope MUST carry an `error` string discriminator',
    )).toBe('unsupported_stream_mode');
    expect(typeof body?.message, req('openwop.it.stream-modes-mixed.rejects-streammode-values-updates-with-400-unsupported-stream-mode', 
      'error-envelope.schema.json',
      'error envelope MUST carry a human-readable `message` string',
    )).toBe('string');
    expect(Array.isArray(body?.details?.supported), req('openwop.it.stream-modes-mixed.rejects-streammode-values-updates-with-400-unsupported-stream-mode', 
      'stream-modes.md §Mode selection error envelope',
      'error body MUST carry `details.supported` array (NOT top-level — `details` is the canonical contextual-data slot per error-envelope.schema.json)',
    )).toBe(true);

    await pollUntilTerminal(runId);
  });

  it('rejects streamMode=updates,bogus (one bad mode fails the whole list)', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      inputs: { delayMs: 100 },
    });
    const runId = (create.json as { runId: string }).runId;

    const res = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events?streamMode=updates,bogus`,
    );
    expect(res.status, req('openwop.it.stream-modes-mixed.rejects-streammode-updates-bogus-one-bad-mode-fails-the-whole-list', 
      'stream-modes.md §Mixed mode + §Mode selection',
      'partial-unknown lists MUST return 400',
    )).toBe(400);

    await pollUntilTerminal(runId);
  });

  it('mixed mode union: updates,debug sees every event updates sees', async () => {
    // Run twice — once with updates only, once with updates,debug.
    // The mixed-mode response MUST be a superset of the updates-only
    // response (union semantics).
    const r1 = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      inputs: { delayMs: 500 },
    });
    const runId1 = (r1.json as { runId: string }).runId;
    const updatesOnly = await subscribe(
      `/v1/runs/${encodeURIComponent(runId1)}/events?streamMode=updates`,
      { timeoutMs: 15_000 },
    );

    const r2 = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      inputs: { delayMs: 500 },
    });
    const runId2 = (r2.json as { runId: string }).runId;
    const mixed = await subscribe(
      `/v1/runs/${encodeURIComponent(runId2)}/events?streamMode=updates,debug`,
      { timeoutMs: 15_000 },
    );

    const updatesTypes = new Set(eventTypes(updatesOnly.events));
    const mixedTypes = new Set(eventTypes(mixed.events));

    for (const t of updatesTypes) {
      expect(mixedTypes.has(t), req('openwop.it.stream-modes-mixed.mixed-mode-union-updates-debug-sees-every-event-updates-sees', 
        'stream-modes.md §Mixed mode (union)',
        `updates,debug MUST include every event type updates produces (missing: ${t})`,
      )).toBe(true);
    }
  });
});
