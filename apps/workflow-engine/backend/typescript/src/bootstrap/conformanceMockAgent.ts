/**
 * `core.conformance.mock-agent` — reference-host implementation of the
 * conformance-only typeId defined in RFC 0023.
 *
 * **Purpose.** Carries the test-time agent-event emission hooks that were
 * previously layered implicitly on `core.identity` via undocumented
 * `config.emitReasoningTrace` / `config.mockConfidence` keys. The RFC
 * 0023 amendment moves them to a clearly conformance-scoped typeId so
 * production primitives (passthrough nodes, the supervisor) don't have
 * to carry test-mode config.
 *
 * **Spec contract.** Per RFC 0023 §B emission order:
 *
 *   1. If `config.mockReasoning` set → emit `agent.reasoned`
 *   2. For each entry in `config.mockToolCalls` → emit `agent.toolCalled`
 *      then `agent.toolReturned`, paired by host-minted `callId`
 *      (returned event's `causationId` MUST equal the called event's
 *      `eventId`)
 *   3. If `config.mockHandoff` set → emit `agent.handoff`
 *   4. If `config.mockDecision` set (or `config.mockConfidence` set
 *      without `mockDecision`) → emit `agent.decided`. When confidence
 *      < threshold (default 0.7, run-overridable via
 *      `RunOptions.configurable.escalationThreshold`), follow with
 *      `node.suspended { reason: 'low-confidence', agentId, threshold,
 *      observed }` and return `status: 'suspended'` per CP-1
 *      (`spec/v1/interrupt.md:278`).
 *
 *   Outputs are `{}` — consumers of this typeId rely on the event
 *   stream, not on variable projection.
 *
 * **AgentId resolution** (order): `config.agentId` → `nodes[].agent.agentId`
 * (read from `ctx.config?.agent?.agentId` if the host surfaces the pin
 * here — TODO confirm with `nodes[].agent` exposure in NodeContext) →
 * host-minted synthetic `host:mock-agent:${nodeId}`.
 *
 * **Hard limit (RFC 0023 §B.1).** This typeId is conformance-only.
 * `ensureMockAgentRegistered()` registers it unconditionally for the
 * reference host (which is intended for conformance use); production
 * deployments of this same codebase SHOULD remove the registration call
 * AND advertise `capabilities.conformance.mockAgent: true` only when
 * the typeId is genuinely available.
 *
 * @module openwop/apps/workflow-engine/backend/typescript/src/bootstrap/conformanceMockAgent
 * @see RFCS/0023-conformance-agent-event-emitters.md
 * @see schemas/core-conformance-mock-agent-config.schema.json
 */

import { randomUUID } from 'node:crypto';
import { getNodeRegistry } from '../executor/nodeRegistry.js';
import type { NodeContext, NodeModule, NodeOutcome } from '../executor/types.js';

const DEFAULT_ESCALATION_THRESHOLD = 0.7;
const SYNTHETIC_AGENT_ID_PREFIX = 'host:mock-agent:';

interface MockReasoningObject {
  summary: string;
  trace?: string;
  tokenCount?: number;
}

interface MockToolCall {
  toolId: string;
  arguments?: unknown;
  result?: unknown;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  durationMs?: number;
}

interface MockHandoff {
  toAgentId: string;
  reason?: string;
  context?: unknown;
}

interface MockDecision {
  decision: unknown;
  confidence?: number;
  reasoning?: string;
}

interface MockAgentConfig {
  agentId?: string;
  mockReasoning?: boolean | MockReasoningObject;
  mockToolCalls?: ReadonlyArray<MockToolCall>;
  mockHandoff?: MockHandoff;
  mockDecision?: MockDecision;
  mockConfidence?: number;
}

function resolveAgentId(ctx: NodeContext, config: MockAgentConfig): string {
  if (typeof config.agentId === 'string' && config.agentId.length > 0) {
    return config.agentId;
  }
  // The `nodes[].agent` pin is exposed by the engine on context — try a
  // best-effort lookup via the (untyped) `config.agent` shadow. Hosts
  // that surface the pin on a different field can adapt this.
  const agentShadow = (ctx.config as { agent?: { agentId?: string } } | undefined)?.agent;
  if (agentShadow && typeof agentShadow.agentId === 'string' && agentShadow.agentId.length > 0) {
    return agentShadow.agentId;
  }
  return `${SYNTHETIC_AGENT_ID_PREFIX}${ctx.nodeId}`;
}

function resolveEscalationThreshold(ctx: NodeContext): number {
  const fromRun = ctx.configurable?.escalationThreshold;
  if (typeof fromRun === 'number' && fromRun >= 0 && fromRun <= 1) return fromRun;
  return DEFAULT_ESCALATION_THRESHOLD;
}

function buildReasoningPayload(
  agentId: string,
  spec: boolean | MockReasoningObject,
): Record<string, unknown> {
  if (spec === true) {
    return {
      agentId,
      summary: 'mock-agent reasoning trace (boolean spec)',
      tokenCount: 0,
    };
  }
  const obj = spec as MockReasoningObject;
  return {
    agentId,
    summary: obj.summary,
    ...(obj.trace !== undefined && { trace: obj.trace }),
    ...(obj.tokenCount !== undefined && { tokenCount: obj.tokenCount }),
  };
}

export const mockAgentNode: NodeModule = {
  typeId: 'core.conformance.mock-agent',
  version: '1.0.0',
  async execute(ctx: NodeContext): Promise<NodeOutcome> {
    const config = (ctx.config ?? {}) as MockAgentConfig;
    const agentId = resolveAgentId(ctx, config);

    // 1. agent.reasoned
    if (config.mockReasoning !== undefined && config.mockReasoning !== false) {
      await ctx.emit('agent.reasoned', buildReasoningPayload(agentId, config.mockReasoning));
    }

    // 2. agent.toolCalled / agent.toolReturned pairs, in array order.
    // Strict causationId pairing per RFC 0002 §B: `agent.toolReturned.causationId`
    // MUST equal the eventId of the corresponding `agent.toolCalled`. The
    // host-minted `callId` is application-level pairing; the executor's
    // eventId is the wire-level pairing. Both are surfaced for downstream
    // consumers (event-log replay reconstructs deterministic chains via
    // causationId; UI/debug surfaces reconstruct call→return via callId).
    if (Array.isArray(config.mockToolCalls)) {
      for (const call of config.mockToolCalls) {
        const callId = randomUUID();
        const calledRecord = await ctx.emit('agent.toolCalled', {
          agentId,
          callId,
          toolId: call.toolId,
          arguments: call.arguments ?? null,
        });
        const returnedPayload: Record<string, unknown> = {
          agentId,
          callId,
          // RFC 0002 §B: MUST equal corresponding agent.toolCalled.eventId.
          causationId: calledRecord.eventId,
          toolId: call.toolId,
          ...(call.result !== undefined && { result: call.result }),
          ...(call.error !== undefined && { error: call.error }),
          ...(call.durationMs !== undefined && { durationMs: call.durationMs }),
        };
        await ctx.emit('agent.toolReturned', returnedPayload);
      }
    }

    // 3. agent.handoff
    if (config.mockHandoff && typeof config.mockHandoff === 'object') {
      const ho = config.mockHandoff;
      await ctx.emit('agent.handoff', {
        agentId,
        from: { agentId },
        to: { agentId: ho.toAgentId },
        ...(ho.reason !== undefined && { reason: ho.reason }),
        ...(ho.context !== undefined && { context: ho.context }),
      });
    }

    // 4. agent.decided + optional low-confidence suspend
    const decision = config.mockDecision;
    const flatConfidence = typeof config.mockConfidence === 'number' ? config.mockConfidence : undefined;
    const hasDecisionTrigger = decision !== undefined || flatConfidence !== undefined;

    if (hasDecisionTrigger) {
      const observed =
        decision?.confidence !== undefined ? decision.confidence : flatConfidence;
      const decidedPayload: Record<string, unknown> = {
        agentId,
        decision: decision?.decision ?? { kind: 'mock-synthetic', reason: 'mockConfidence-shorthand' },
        ...(observed !== undefined && { confidence: observed }),
        ...(decision?.reasoning !== undefined && { reasoning: decision.reasoning }),
      };
      await ctx.emit('agent.decided', decidedPayload);

      if (typeof observed === 'number') {
        const threshold = resolveEscalationThreshold(ctx);
        if (observed < threshold) {
          // CP-1: emit the rich node.suspended event the conformance
          // suite asserts on, then return suspended-status NodeOutcome
          // so the executor's own thin node.suspended event also fires
          // (suite asserts on the existence of the reason field, not on
          // exclusivity of the event).
          await ctx.emit('node.suspended', {
            reason: 'low-confidence',
            agentId,
            threshold,
            observed,
          });
          return {
            status: 'suspended',
            interrupt: {
              // 'approval' is the closest existing interrupt kind for
              // CP-1 operator-ratification semantics. If the executor's
              // NodeOutcome union later adds a 'low-confidence' kind
              // (per RFC 0023 acceptance discussion), switch here.
              kind: 'approval',
              data: {
                reason: 'low-confidence',
                agentId,
                threshold,
                observed,
                prompt: `Agent ${agentId} confidence ${observed} fell below threshold ${threshold}. Ratify, override, or reject.`,
              },
              resumeSchema: {
                oneOf: [
                  { type: 'object', properties: { ratified: { const: true } }, required: ['ratified'] },
                  { type: 'object', properties: { decision: {} }, required: ['decision'] },
                  { type: 'object', properties: { rejected: { const: true } }, required: ['rejected'] },
                ],
              },
            },
          };
        }
      }
    }

    // Per RFC 0023 §B: outputs are {} — consumers rely on the event
    // stream, not on variable projection.
    return { status: 'success', outputs: {} };
  },
};

let registered = false;

/**
 * Register `core.conformance.mock-agent` on the global node registry.
 * Idempotent. Reference-host bootstrap calls this from
 * `ensureNodesRegistered`; production deployments of this codebase
 * SHOULD remove the call AND drop the `capabilities.conformance.mockAgent`
 * advertisement.
 */
export function registerMockAgentNode(): void {
  if (registered) return;
  getNodeRegistry().register(mockAgentNode);
  registered = true;
}
