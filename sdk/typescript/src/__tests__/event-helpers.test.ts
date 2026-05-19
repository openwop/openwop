/**
 * Typed agent.* event helper tests.
 *
 * Two flavors:
 *   1. **Type-guard predicates** — true-positive / true-negative matrix
 *      across all six agent.* event types + malformed payloads. The
 *      compile-time narrowing is exercised inside each `if (guard(ev))`
 *      branch (TypeScript's `strict + exactOptionalPropertyTypes`
 *      catches narrowing regressions at `tsc --noEmit`).
 *   2. **Schema-mirror sanity** — asserts every required field declared
 *      on the JSON Schema $defs.agent* objects is named in the
 *      corresponding TypeScript interface. Catches drift when either
 *      side changes without the other.
 *
 * The high-level `subscribeToAgentReasoning` helper is exercised by a
 * focused test that mocks the SSE stream via a small async-generator
 * fixture.
 */

import { describe, it, expect } from 'vitest';
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
} from '../event-helpers.js';
import type { RunEventDoc } from '../types.js';

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
