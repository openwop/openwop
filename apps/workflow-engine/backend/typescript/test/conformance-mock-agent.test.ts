/**
 * Tests for the `core.conformance.mock-agent` typeId implementation
 * (RFC 0023). Exercises each emission hook via direct execute()
 * invocation — the executor + suspend manager are tested end-to-end in
 * other suites; here we focus on the node's contract.
 *
 * @see src/bootstrap/conformanceMockAgent.ts
 * @see RFCS/0023-conformance-agent-event-emitters.md
 */

import { describe, it, expect } from 'vitest';
import { mockAgentNode } from '../src/bootstrap/conformanceMockAgent.js';
import type { NodeContext, NodeOutcome } from '../src/executor/types.js';

interface CapturedEvent {
  type: string;
  payload: unknown;
  eventId: string;
  sequence: number;
}

function makeCtx(overrides?: {
  config?: Record<string, unknown>;
  configurable?: Record<string, unknown>;
  nodeId?: string;
  nodeAgent?: { agentId: string };
}): { ctx: NodeContext; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  let nextSeq = 1;
  const ctx: NodeContext = {
    runId: 'run-mock',
    nodeId: overrides?.nodeId ?? 'mock-1',
    tenantId: 'tenant-test',
    inputs: {},
    config: overrides?.config ?? {},
    ...(overrides?.nodeAgent ? { nodeAgent: overrides.nodeAgent } : {}),
    configurable: overrides?.configurable ?? {},
    attempt: 1,
    secrets: {},
    async emit(type, payload) {
      const eventId = `evt-${nextSeq.toString().padStart(8, '0')}`;
      const sequence = nextSeq++;
      events.push({ type, payload, eventId, sequence });
      return { eventId, sequence };
    },
  };
  return { ctx, events };
}

describe('core.conformance.mock-agent', () => {
  describe('emission: no hooks set', () => {
    it('returns success with empty outputs and emits no events', async () => {
      const { ctx, events } = makeCtx();
      const out = await mockAgentNode.execute(ctx);
      expect(out).toEqual({ status: 'success', outputs: {} });
      expect(events).toEqual([]);
    });
  });

  describe('mockReasoning', () => {
    it('boolean true → emits agent.reasoned with schema-compliant `reasoning` field', async () => {
      // Per `schemas/run-event-payloads.schema.json` §`agentReasoned`,
      // the payload field is `reasoning` (string). The earlier
      // RFC-0002-prose `{summary, trace, tokenCount}` shape was
      // aligned to the schema in the 2026-05-18 editorial cleanup.
      const { ctx, events } = makeCtx({
        config: { mockReasoning: true, agentId: 'agent-foo' },
      });
      await mockAgentNode.execute(ctx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent.reasoned');
      const payload = events[0].payload as { agentId: string; reasoning: string };
      expect(payload.agentId).toBe('agent-foo');
      expect(payload.reasoning.length).toBeGreaterThan(0);
    });

    it('object → projects summary onto agent.reasoned.reasoning per schema', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockReasoning: { summary: 'considered options', tokenCount: 42, trace: 'thoughts...' },
          agentId: 'agent-foo',
        },
      });
      await mockAgentNode.execute(ctx);
      const payload = events[0].payload as {
        agentId: string;
        reasoning: string;
        verbosity: string;
      };
      expect(payload.reasoning).toBe('considered options');
      expect(payload.verbosity).toBe('summary');
    });

    it('RFC 0024 streamChunks → emits N agent.reasoning.delta + closing agent.reasoned', async () => {
      const chunks = ['Let me think. ', 'First, the user. ', 'Therefore, X.'];
      const { ctx, events } = makeCtx({
        config: {
          mockReasoning: { summary: chunks.join(''), streamChunks: chunks },
          agentId: 'agent-foo',
        },
      });
      await mockAgentNode.execute(ctx);
      // N delta events with sequence 0..N-1, then 1 closing event.
      expect(events).toHaveLength(chunks.length + 1);
      for (let i = 0; i < chunks.length; i++) {
        expect(events[i].type).toBe('agent.reasoning.delta');
        const p = events[i].payload as { agentId: string; delta: string; sequence: number };
        expect(p.agentId).toBe('agent-foo');
        expect(p.delta).toBe(chunks[i]);
        expect(p.sequence).toBe(i);
      }
      expect(events[chunks.length].type).toBe('agent.reasoned');
      const closing = events[chunks.length].payload as { agentId: string; reasoning: string };
      expect(closing.agentId).toBe('agent-foo');
      expect(closing.reasoning).toBe(chunks.join(''));
    });

    it('verbosity "off" suppresses both delta and closing events', async () => {
      const chunks = ['a', 'b', 'c'];
      const { ctx, events } = makeCtx({
        config: {
          mockReasoning: { summary: 'x', streamChunks: chunks },
          agentId: 'agent-foo',
        },
        configurable: { reasoningVerbosity: 'off' },
      });
      await mockAgentNode.execute(ctx);
      expect(events.some((e) => e.type === 'agent.reasoning.delta')).toBe(false);
      expect(events.some((e) => e.type === 'agent.reasoned')).toBe(false);
    });

    it('false → no event emitted', async () => {
      const { ctx, events } = makeCtx({
        config: { mockReasoning: false, agentId: 'agent-foo' },
      });
      await mockAgentNode.execute(ctx);
      expect(events).toEqual([]);
    });
  });

  describe('mockToolCalls', () => {
    it('emits agent.toolCalled + agent.toolReturned pair per entry, in order', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockToolCalls: [
            { toolId: 'first', arguments: { x: 1 }, result: { ok: 1 } },
            { toolId: 'second', arguments: { x: 2 }, result: { ok: 2 } },
          ],
          agentId: 'agent-foo',
        },
      });
      await mockAgentNode.execute(ctx);
      expect(events).toHaveLength(4);
      expect(events[0].type).toBe('agent.toolCalled');
      expect(events[1].type).toBe('agent.toolReturned');
      expect(events[2].type).toBe('agent.toolCalled');
      expect(events[3].type).toBe('agent.toolReturned');
      expect((events[0].payload as { toolName: string }).toolName).toBe('first');
      expect((events[2].payload as { toolName: string }).toolName).toBe('second');
    });

    it('pairs toolCalled/toolReturned: returned.causationId === called.eventId (RFC 0002 §B strict)', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockToolCalls: [{ toolId: 't', arguments: {}, result: {} }],
          agentId: 'agent-foo',
        },
      });
      await mockAgentNode.execute(ctx);
      const calledEvent = events[0];
      const returnedPayload = events[1].payload as { callId: string; causationId: string };
      // Wire-level pairing: causationId === eventId of the corresponding toolCalled.
      expect(returnedPayload.causationId).toBe(calledEvent.eventId);
      // Application-level pairing: callId surfaces for UI/debug reconstruction.
      const calledPayload = calledEvent.payload as { callId: string };
      expect(returnedPayload.callId).toBe(calledPayload.callId);
    });

    it('passes through error envelope when present (no result)', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockToolCalls: [{ toolId: 't', error: { code: 'TOOL_FAILED', message: 'oops' } }],
          agentId: 'agent-foo',
        },
      });
      await mockAgentNode.execute(ctx);
      const returned = events[1].payload as { error?: { code: string } };
      expect(returned.error?.code).toBe('TOOL_FAILED');
    });
  });

  describe('mockHandoff', () => {
    it('emits agent.handoff with canonical fromAgentId/toAgentId strings (schema §agentHandoff)', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockHandoff: { toAgentId: 'next-agent', reason: 'demo' },
          agentId: 'agent-foo',
        },
      });
      await mockAgentNode.execute(ctx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent.handoff');
      const payload = events[0].payload as {
        agentId: string;
        fromAgentId: string;
        toAgentId: string;
        reason: string;
      };
      expect(payload.agentId).toBe('agent-foo');
      expect(payload.fromAgentId).toBe('agent-foo');
      expect(payload.toAgentId).toBe('next-agent');
      expect(payload.reason).toBe('demo');
    });
  });

  describe('mockDecision / mockConfidence', () => {
    it('mockDecision above threshold → emits agent.decided WITHOUT suspending', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockDecision: { decision: { kind: 'go' }, confidence: 0.9 },
          agentId: 'agent-foo',
        },
      });
      const out = await mockAgentNode.execute(ctx);
      expect(out.status).toBe('success');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent.decided');
      const payload = events[0].payload as { confidence: number; decision: unknown };
      expect(payload.confidence).toBe(0.9);
      expect(payload.decision).toEqual({ kind: 'go' });
    });

    it('mockDecision below threshold → emits agent.decided + node.suspended + returns suspended', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockDecision: { decision: { kind: 'stub-low-conf' }, confidence: 0.5 },
          agentId: 'agent-foo',
        },
      });
      const out: NodeOutcome = await mockAgentNode.execute(ctx);
      expect(out.status).toBe('suspended');
      if (out.status !== 'suspended') return;
      expect(out.interrupt.kind).toBe('approval');
      const data = out.interrupt.data as { reason: string; threshold: number; observed: number };
      expect(data.reason).toBe('low-confidence');
      expect(data.threshold).toBe(0.7);
      expect(data.observed).toBe(0.5);

      // 2 events: agent.decided + node.suspended (the rich one with reason)
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('agent.decided');
      expect(events[1].type).toBe('node.suspended');
      const susPayload = events[1].payload as {
        reason: string;
        agentId: string;
        threshold: number;
        observed: number;
      };
      expect(susPayload.reason).toBe('low-confidence');
      expect(susPayload.agentId).toBe('agent-foo');
      expect(susPayload.threshold).toBe(0.7);
      expect(susPayload.observed).toBe(0.5);
    });

    it('mockConfidence shorthand (no mockDecision) → emits synthetic decision + suspends below threshold', async () => {
      const { ctx, events } = makeCtx({
        config: { mockConfidence: 0.3, agentId: 'agent-foo' },
      });
      const out: NodeOutcome = await mockAgentNode.execute(ctx);
      expect(out.status).toBe('suspended');
      expect(events).toHaveLength(2);
      const decided = events[0].payload as { decision: unknown; confidence: number };
      expect(decided.confidence).toBe(0.3);
      expect(decided.decision).toBeDefined(); // synthetic
    });

    it('honors run-level escalationThreshold override', async () => {
      const { ctx, events } = makeCtx({
        config: { mockDecision: { decision: {}, confidence: 0.5 }, agentId: 'agent-foo' },
        configurable: { escalationThreshold: 0.4 }, // 0.5 ABOVE this → no suspend
      });
      const out = await mockAgentNode.execute(ctx);
      expect(out.status).toBe('success');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent.decided');
    });

    it('edge: confidence === threshold (0.7) does NOT suspend (strict <)', async () => {
      const { ctx, events } = makeCtx({
        config: { mockDecision: { decision: {}, confidence: 0.7 }, agentId: 'agent-foo' },
      });
      const out = await mockAgentNode.execute(ctx);
      expect(out.status).toBe('success');
      expect(events).toHaveLength(1);
    });
  });

  describe('agentId resolution', () => {
    it('falls back to nodes[].agent.agentId pin (ctx.nodeAgent) when config.agentId missing', async () => {
      const { ctx, events } = makeCtx({
        config: { mockReasoning: true },
        nodeAgent: { agentId: 'agent-from-pin' },
      });
      await mockAgentNode.execute(ctx);
      expect((events[0].payload as { agentId: string }).agentId).toBe('agent-from-pin');
    });

    it('falls back to synthetic host-minted id when no agentId source', async () => {
      const { ctx, events } = makeCtx({
        config: { mockReasoning: true },
        nodeId: 'no-agent-node',
      });
      await mockAgentNode.execute(ctx);
      expect((events[0].payload as { agentId: string }).agentId).toBe('host:mock-agent:no-agent-node');
    });
  });

  describe('emission order (RFC 0023 §B)', () => {
    it('reasoning → toolCalls → handoff → decided', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockReasoning: true,
          mockToolCalls: [{ toolId: 't', arguments: {}, result: {} }],
          mockHandoff: { toAgentId: 'next' },
          mockDecision: { decision: {}, confidence: 0.9 },
          agentId: 'agent-foo',
        },
      });
      await mockAgentNode.execute(ctx);
      const types = events.map((e) => e.type);
      expect(types).toEqual([
        'agent.reasoned',
        'agent.toolCalled',
        'agent.toolReturned',
        'agent.handoff',
        'agent.decided',
      ]);
    });
  });

  describe('typeId identity', () => {
    it('exposes the canonical conformance typeId', () => {
      expect(mockAgentNode.typeId).toBe('core.conformance.mock-agent');
      expect(mockAgentNode.version).toBe('1.0.0');
    });
  });
});
