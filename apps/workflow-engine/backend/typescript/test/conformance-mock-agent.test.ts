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
}

function makeCtx(overrides?: {
  config?: Record<string, unknown>;
  configurable?: Record<string, unknown>;
  nodeId?: string;
}): { ctx: NodeContext; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  const ctx: NodeContext = {
    runId: 'run-mock',
    nodeId: overrides?.nodeId ?? 'mock-1',
    tenantId: 'tenant-test',
    inputs: {},
    config: overrides?.config ?? {},
    configurable: overrides?.configurable ?? {},
    attempt: 1,
    secrets: {},
    async emit(type, payload) {
      events.push({ type, payload });
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
    it('boolean true → emits agent.reasoned with stub summary', async () => {
      const { ctx, events } = makeCtx({
        config: { mockReasoning: true, agentId: 'agent-foo' },
      });
      await mockAgentNode.execute(ctx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent.reasoned');
      const payload = events[0].payload as { agentId: string; summary: string };
      expect(payload.agentId).toBe('agent-foo');
      expect(payload.summary.length).toBeGreaterThan(0);
    });

    it('object → projects fields onto agent.reasoned payload', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockReasoning: { summary: 'considered options', tokenCount: 42, trace: 'thoughts...' },
          agentId: 'agent-foo',
        },
      });
      await mockAgentNode.execute(ctx);
      const payload = events[0].payload as {
        agentId: string;
        summary: string;
        tokenCount: number;
        trace: string;
      };
      expect(payload.summary).toBe('considered options');
      expect(payload.tokenCount).toBe(42);
      expect(payload.trace).toBe('thoughts...');
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
      expect((events[0].payload as { toolId: string }).toolId).toBe('first');
      expect((events[2].payload as { toolId: string }).toolId).toBe('second');
    });

    it('pairs toolCalled/toolReturned via callId; returned event causationId equals called callId', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockToolCalls: [{ toolId: 't', arguments: {}, result: {} }],
          agentId: 'agent-foo',
        },
      });
      await mockAgentNode.execute(ctx);
      const called = events[0].payload as { callId: string };
      const returned = events[1].payload as { callId: string; causationId: string };
      expect(returned.callId).toBe(called.callId);
      expect(returned.causationId).toBe(called.callId);
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
    it('emits agent.handoff with from = nodes[].agent and to.agentId = toAgentId', async () => {
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
        from: { agentId: string };
        to: { agentId: string };
        reason: string;
      };
      expect(payload.agentId).toBe('agent-foo');
      expect(payload.from.agentId).toBe('agent-foo');
      expect(payload.to.agentId).toBe('next-agent');
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
    it('falls back to nodes[].agent.agentId shadow when config.agentId missing', async () => {
      const { ctx, events } = makeCtx({
        config: {
          mockReasoning: true,
          agent: { agentId: 'agent-from-pin' },
        },
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
