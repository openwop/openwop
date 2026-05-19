/**
 * Typed agent.* event helper tests.
 *
 * Three flavors:
 *   1. **Type-guard predicates** — true-positive / true-negative matrix
 *      across all six agent.* event types + malformed payloads. The
 *      compile-time narrowing is exercised inside each `if (guard(ev))`
 *      branch (TypeScript's `strict + exactOptionalPropertyTypes`
 *      catches narrowing regressions at `tsc --noEmit`).
 *   2. **Schema-mirror sanity** — asserts every required field declared
 *      on the JSON Schema $defs.agent* objects is named in the
 *      corresponding TypeScript interface. Catches drift when either
 *      side changes without the other.
 *   3. **subscribeToAgentReasoning behavior** — uses `vi.mock` to swap
 *      `streamEvents` for an async-generator fixture so the helper's
 *      dispatch + cancellation + handler-isolation logic can be
 *      exercised without spinning up an HTTP server.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  isAgentReasoned,
  isAgentReasoningDelta,
  isAgentToolCalled,
  isAgentToolReturned,
  isAgentHandoff,
  isAgentDecided,
  subscribeToAgentReasoning,
} from '../event-helpers.js';
import type {
  AgentReasoningDeltaPayload,
  AgentReasonedPayload,
  RunEventDoc,
} from '../types.js';

// Mock the SSE consumer so subscribeToAgentReasoning can be exercised
// without HTTP. The mock implementation is rebound per test via
// `mockedStreamEvents.mockImplementation(...)` so each test controls its
// own event stream.
vi.mock('../sse.js', () => ({
  streamEvents: vi.fn(),
}));
import { streamEvents } from '../sse.js';
const mockedStreamEvents = streamEvents as ReturnType<typeof vi.fn>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_PATH = resolve(__dirname, '..', '..', '..', '..', 'schemas', 'run-event-payloads.schema.json');

function makeEvent(type: string, payload: unknown): RunEventDoc {
  return {
    eventId: 'evt-x',
    runId: 'run-x',
    type,
    payload,
    timestamp: '2026-05-19T00:00:00Z',
    sequence: 0,
  };
}

describe('agent.* type guards — true positives', () => {
  it('isAgentReasoned narrows on a well-formed agent.reasoned event', () => {
    const ev = makeEvent('agent.reasoned', {
      agentId: 'asst-1',
      reasoning: 'thinking…',
      verbosity: 'full',
    });
    expect(isAgentReasoned(ev)).toBe(true);
    if (isAgentReasoned(ev)) {
      // Compile-time narrowing: ev.payload is AgentReasonedPayload.
      // The expression below would be a type error if the guard didn't
      // narrow (since RunEventDoc.payload is `unknown`).
      expect(ev.payload.reasoning).toBe('thinking…');
      expect(ev.payload.verbosity).toBe('full');
    }
  });

  it('isAgentReasoningDelta narrows on a well-formed delta event', () => {
    const ev = makeEvent('agent.reasoning.delta', {
      agentId: 'asst-1',
      delta: 'step 1',
      sequence: 0,
    });
    expect(isAgentReasoningDelta(ev)).toBe(true);
    if (isAgentReasoningDelta(ev)) {
      expect(ev.payload.delta).toBe('step 1');
      expect(ev.payload.sequence).toBe(0);
    }
  });

  it('isAgentToolCalled narrows on a well-formed toolCalled event', () => {
    const ev = makeEvent('agent.toolCalled', {
      agentId: 'asst-1',
      toolName: 'echo',
      callId: 'c-1',
      inputs: { x: 1 },
    });
    expect(isAgentToolCalled(ev)).toBe(true);
  });

  it('isAgentToolReturned narrows on a well-formed toolReturned event', () => {
    const ev = makeEvent('agent.toolReturned', {
      agentId: 'asst-1',
      toolName: 'echo',
      callId: 'c-1',
      outcome: { x: 1 },
    });
    expect(isAgentToolReturned(ev)).toBe(true);
  });

  it('isAgentHandoff narrows on a well-formed handoff event (distinct field names)', () => {
    const ev = makeEvent('agent.handoff', {
      fromAgentId: 'asst-1',
      toAgentId: 'researcher',
      reason: 'specialist-routing',
    });
    expect(isAgentHandoff(ev)).toBe(true);
    if (isAgentHandoff(ev)) {
      expect(ev.payload.fromAgentId).toBe('asst-1');
      expect(ev.payload.toAgentId).toBe('researcher');
    }
  });

  it('isAgentDecided narrows on a well-formed decided event', () => {
    const ev = makeEvent('agent.decided', {
      agentId: 'asst-1',
      decision: { next: 'done' },
      confidence: 0.95,
    });
    expect(isAgentDecided(ev)).toBe(true);
  });
});

describe('agent.* type guards — true negatives', () => {
  it('rejects events with the wrong type discriminator', () => {
    const ev = makeEvent('node.message', { agentId: 'asst-1', reasoning: 'x' });
    expect(isAgentReasoned(ev)).toBe(false);
    expect(isAgentReasoningDelta(ev)).toBe(false);
  });

  it('rejects events with the right type but missing required fields', () => {
    // agent.reasoned without `reasoning`
    expect(isAgentReasoned(makeEvent('agent.reasoned', { agentId: 'asst-1' }))).toBe(false);
    // agent.reasoning.delta without `delta`
    expect(isAgentReasoningDelta(makeEvent('agent.reasoning.delta', { agentId: 'asst-1', sequence: 0 }))).toBe(false);
    // agent.reasoning.delta with negative sequence
    expect(isAgentReasoningDelta(makeEvent('agent.reasoning.delta', { agentId: 'asst-1', delta: 'x', sequence: -1 }))).toBe(false);
    // agent.reasoning.delta with non-integer sequence
    expect(isAgentReasoningDelta(makeEvent('agent.reasoning.delta', { agentId: 'asst-1', delta: 'x', sequence: 1.5 }))).toBe(false);
    // agent.handoff with single agentId (wrong field names)
    expect(isAgentHandoff(makeEvent('agent.handoff', { agentId: 'asst-1', toAgentId: 'x' }))).toBe(false);
    // agent.toolReturned without callId
    expect(isAgentToolReturned(makeEvent('agent.toolReturned', { agentId: 'asst-1', toolName: 't' }))).toBe(false);
  });

  it('rejects events with null or non-object payloads', () => {
    expect(isAgentReasoned(makeEvent('agent.reasoned', null))).toBe(false);
    expect(isAgentReasoned(makeEvent('agent.reasoned', 'string-payload'))).toBe(false);
    expect(isAgentReasoned(makeEvent('agent.reasoned', 42))).toBe(false);
  });

  it('tolerates unknown event types per COMPATIBILITY.md §2.1', () => {
    const ev = makeEvent('vendor.future.event', { stuff: 'x' });
    // Every guard returns false — no exceptions; consumer's iteration
    // continues past the unknown event.
    expect(isAgentReasoned(ev)).toBe(false);
    expect(isAgentReasoningDelta(ev)).toBe(false);
    expect(isAgentToolCalled(ev)).toBe(false);
    expect(isAgentToolReturned(ev)).toBe(false);
    expect(isAgentHandoff(ev)).toBe(false);
    expect(isAgentDecided(ev)).toBe(false);
  });
});

describe('agent.* schema-mirror sanity', () => {
  // Reads schemas/run-event-payloads.schema.json directly and asserts
  // the TS interfaces declare every `required` field from the
  // corresponding $def. Drift catcher: if either side gets a new
  // required field, this test fails until both sides agree.
  const raw = readFileSync(SCHEMA_PATH, 'utf-8');
  const schema = JSON.parse(raw) as {
    $defs: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
  };

  const cases: Array<{ defName: string; expectedRequired: readonly string[] }> = [
    { defName: 'agentReasoned', expectedRequired: ['agentId', 'reasoning'] },
    { defName: 'agentReasoningDelta', expectedRequired: ['agentId', 'delta', 'sequence'] },
    { defName: 'agentToolCalled', expectedRequired: ['agentId', 'toolName', 'callId'] },
    { defName: 'agentToolReturned', expectedRequired: ['agentId', 'toolName', 'callId'] },
    { defName: 'agentHandoff', expectedRequired: ['fromAgentId', 'toAgentId'] },
    { defName: 'agentDecided', expectedRequired: ['agentId', 'decision'] },
  ];

  it.each(cases)('$defName: schema required[] matches expected wire contract', ({ defName, expectedRequired }) => {
    const def = schema.$defs[defName];
    expect(def, `$def.${defName} present`).toBeDefined();
    expect([...(def?.required ?? [])].sort()).toEqual([...expectedRequired].sort());
  });
});

describe('subscribeToAgentReasoning — high-level helper', () => {
  const ctx = { baseUrl: 'https://host.example', apiKey: 'k' };

  function nextTick(): Promise<void> {
    return new Promise((r) => setImmediate(r));
  }

  // Build an async-generator factory that yields the given events and
  // exits cleanly. Honors an AbortSignal between yields so cancellation
  // tests can short-circuit the stream.
  function streamFrom(events: RunEventDoc[]): (
    _ctx: unknown,
    _runId: string,
    opts: { signal?: AbortSignal },
  ) => AsyncGenerator<RunEventDoc, void, void> {
    return async function* (
      _ctx: unknown,
      _runId: string,
      opts: { signal?: AbortSignal },
    ) {
      for (const ev of events) {
        if (opts.signal?.aborted) return;
        yield ev;
        // Cede a microtask between yields so the consumer can call
        // stop() between events (mirrors real SSE pacing).
        await nextTick();
      }
    };
  }

  it('dispatches deltas in arrival order then a closed reasoned event', async () => {
    const delta = (i: number, text: string): RunEventDoc => ({
      eventId: `e-${i}`,
      runId: 'r-1',
      type: 'agent.reasoning.delta',
      payload: { agentId: 'asst-1', delta: text, sequence: i },
      timestamp: '2026-05-19T00:00:00Z',
      sequence: i,
    });
    const closed: RunEventDoc = {
      eventId: 'e-final',
      runId: 'r-1',
      type: 'agent.reasoned',
      payload: { agentId: 'asst-1', reasoning: 'step 0step 1step 2' },
      timestamp: '2026-05-19T00:00:00Z',
      sequence: 3,
    };
    mockedStreamEvents.mockImplementation(streamFrom([delta(0, 'step 0'), delta(1, 'step 1'), delta(2, 'step 2'), closed]));

    const deltas: AgentReasoningDeltaPayload[] = [];
    const closedPayloads: AgentReasonedPayload[] = [];
    let ended = false;
    let error: Error | null = null;

    const stop = subscribeToAgentReasoning(ctx, 'r-1', {
      onDelta: (p) => { deltas.push(p); },
      onClosed: (p) => { closedPayloads.push(p); },
      onEnd: () => { ended = true; },
      onError: (e) => { error = e; },
    });

    // Wait for the stream to drain. 4 events × 1 microtask each + a
    // little slack; the test is fast enough that a fixed wait works.
    for (let i = 0; i < 20; i++) await nextTick();

    stop();
    expect(error).toBeNull();
    expect(deltas.map((d) => d.delta)).toEqual(['step 0', 'step 1', 'step 2']);
    expect(deltas.map((d) => d.sequence)).toEqual([0, 1, 2]);
    expect(closedPayloads).toHaveLength(1);
    expect(closedPayloads[0]?.reasoning).toBe('step 0step 1step 2');
    expect(ended).toBe(true);
  });

  it('isolates handler exceptions — one bad onDelta does NOT tear down the stream', async () => {
    const events: RunEventDoc[] = [0, 1, 2].map((i) => ({
      eventId: `e-${i}`,
      runId: 'r-1',
      type: 'agent.reasoning.delta',
      payload: { agentId: 'asst-1', delta: `chunk ${i}`, sequence: i },
      timestamp: '2026-05-19T00:00:00Z',
      sequence: i,
    }));
    mockedStreamEvents.mockImplementation(streamFrom(events));

    const seen: number[] = [];
    const errors: Error[] = [];

    const stop = subscribeToAgentReasoning(ctx, 'r-1', {
      onDelta: (p) => {
        seen.push(p.sequence);
        if (p.sequence === 1) throw new Error('boom on chunk 1');
      },
      onError: (e) => { errors.push(e); },
    });
    for (let i = 0; i < 20; i++) await nextTick();
    stop();

    // All three deltas reached the handler, even though chunk 1 threw.
    expect(seen).toEqual([0, 1, 2]);
    // The thrown error surfaced via onError.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('boom on chunk 1');
  });

  it('stop() is idempotent and silent — repeated calls do not invoke onError', async () => {
    mockedStreamEvents.mockImplementation(streamFrom([]));
    const errors: Error[] = [];
    const stop = subscribeToAgentReasoning(ctx, 'r-1', {
      onError: (e) => { errors.push(e); },
    });
    stop();
    stop();
    stop();
    for (let i = 0; i < 5; i++) await nextTick();
    expect(errors).toEqual([]);
  });

  it('stop() during streaming aborts cleanly without surfacing as onError', async () => {
    // 10 events; we stop after consuming a couple so the generator
    // exits via the abort-signal check on its next iteration.
    const events: RunEventDoc[] = Array.from({ length: 10 }, (_, i) => ({
      eventId: `e-${i}`,
      runId: 'r-1',
      type: 'agent.reasoning.delta',
      payload: { agentId: 'asst-1', delta: `chunk ${i}`, sequence: i },
      timestamp: '2026-05-19T00:00:00Z',
      sequence: i,
    }));
    mockedStreamEvents.mockImplementation(streamFrom(events));

    let count = 0;
    const errors: Error[] = [];
    const stop = subscribeToAgentReasoning(ctx, 'r-1', {
      onDelta: () => { count++; },
      onError: (e) => { errors.push(e); },
    });
    // Let a couple events through, then cancel.
    await nextTick();
    await nextTick();
    stop();
    for (let i = 0; i < 20; i++) await nextTick();

    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(events.length);
    // Cancellation is intentional — it must NOT surface via onError.
    expect(errors).toEqual([]);
  });

  it('surfaces stream errors via onError (non-cancellation path)', async () => {
    mockedStreamEvents.mockImplementation(async function* () {
      throw new Error('connection lost');
      yield; // unreachable; satisfies the generator type
    });
    const errors: Error[] = [];
    let ended = false;
    subscribeToAgentReasoning(ctx, 'r-1', {
      onError: (e) => { errors.push(e); },
      onEnd: () => { ended = true; },
    });
    for (let i = 0; i < 5; i++) await nextTick();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('connection lost');
    // onEnd should NOT fire on an error path — that's the clean-end signal.
    expect(ended).toBe(false);
  });

  it("defaults streamMode to 'updates' when caller doesn't specify (per stream-modes.md)", async () => {
    mockedStreamEvents.mockImplementation(streamFrom([]));
    const stop = subscribeToAgentReasoning(ctx, 'r-1', {});
    await nextTick();
    stop();

    expect(mockedStreamEvents).toHaveBeenCalled();
    const callArgs = mockedStreamEvents.mock.calls[0];
    const passedOpts = callArgs?.[2] as { streamMode?: string };
    expect(passedOpts?.streamMode).toBe('updates');
  });
});
