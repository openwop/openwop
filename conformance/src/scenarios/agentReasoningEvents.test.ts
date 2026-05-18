/**
 * Multi-Agent Shift Phase 1 — agent.* reasoning event family.
 *
 * Verifies that hosts emit the canonical `agent.*` event types per
 * `run-event.schema.json` + per-event payload contract in
 * `run-event-payloads.schema.json` §`agentReasoned` / `agentToolCalled` /
 * `agentToolReturned` / `agentHandoff` / `agentDecided`.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.supported: true` OR when reasoning verbosity
 * is `'off'` (no `agent.reasoned` events expected).
 *
 * @see schemas/run-event-payloads.schema.json
 * @see spec/v1/capabilities.md §`agents.reasoning`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import {
  isAgentSupported,
  getReasoningVerbosity,
} from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-reasoning';
const SKIP =
  !isAgentSupported() ||
  getReasoningVerbosity() === 'off' ||
  !isFixtureAdvertised(FIXTURE);

const REASONING_EVENT_TYPES = new Set([
  'agent.reasoned',
  'agent.toolCalled',
  'agent.toolReturned',
  'agent.handoff',
  'agent.decided',
]);

describe.skipIf(SKIP)('agentReasoningEvents: agent.* event family emission', () => {
  it('host emits at least one canonical agent.* event during a reasoning-fixture run', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    expect(events.status).toBe(200);
    const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown> }> })
      .events ?? [];

    const agentEvents = list.filter((e) => REASONING_EVENT_TYPES.has(e.type));
    expect(agentEvents.length).toBeGreaterThan(0);

    // Every agent.* event payload MUST identify the agent. Per
    // `run-event-payloads.schema.json` §`agent*` shapes, four of the
    // five events (`reasoned`, `toolCalled`, `toolReturned`, `decided`)
    // carry `agentId`; `agent.handoff` carries `fromAgentId` + `toAgentId`
    // instead. Allow either shape.
    for (const ev of agentEvents) {
      const p = (ev.payload ?? {}) as Record<string, unknown>;
      if (ev.type === 'agent.handoff') {
        expect(typeof p.fromAgentId).toBe('string');
        expect(typeof p.toAgentId).toBe('string');
        expect((p.fromAgentId as string).length).toBeGreaterThanOrEqual(3);
        expect((p.toAgentId as string).length).toBeGreaterThanOrEqual(3);
      } else {
        expect(typeof p.agentId).toBe('string');
        expect((p.agentId as string).length).toBeGreaterThanOrEqual(3);
      }
    }

    // agent.toolCalled / agent.toolReturned MUST share a `callId` correlation.
    const calls = agentEvents.filter((e) => e.type === 'agent.toolCalled');
    const returns = agentEvents.filter((e) => e.type === 'agent.toolReturned');
    for (const ret of returns) {
      const callId = ret.payload?.callId as string | undefined;
      if (callId === undefined) continue;
      const matched = calls.find((c) => c.payload?.callId === callId);
      expect(matched, `agent.toolReturned.callId=${callId} MUST pair with a prior agent.toolCalled`).toBeDefined();
    }
  });
});
