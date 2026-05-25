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

interface MockReasoningObjectWithStreaming extends MockReasoningObject {
  /** RFC 0024 — when present, emit one `agent.reasoning.delta` event
   *  per chunk (sequence 0..N-1) BEFORE the closing `agent.reasoned`.
   *  The closing event's `reasoning` field equals the concatenation. */
  streamChunks?: ReadonlyArray<string>;
}

interface MockAgentConfig {
  agentId?: string;
  mockReasoning?: boolean | MockReasoningObjectWithStreaming;
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

function resolveReasoningVerbosity(ctx: NodeContext): 'summary' | 'full' | 'off' {
  const req = ctx.configurable?.reasoningVerbosity;
  return req === 'off' || req === 'full' || req === 'summary' ? req : 'summary';
}

/** Build the closing `agent.reasoned` payload per
 *  `schemas/run-event-payloads.schema.json` §`agentReasoned`:
 *  `{ agentId, reasoning, verbosity? }` — using the SCHEMA field
 *  names, not the RFC-0002-prose `{summary, trace, tokenCount}`
 *  pre-finalize names (the prose was aligned to the schema in
 *  the RFC 0002 editorial cleanup, 2026-05-18). */
function buildReasoningPayload(
  agentId: string,
  spec: true | MockReasoningObjectWithStreaming,
  verbosity: 'summary' | 'full' | 'off',
): Record<string, unknown> {
  if (spec === true) {
    return {
      agentId,
      reasoning: 'mock-agent reasoning trace (boolean spec)',
      verbosity,
    };
  }
  const reasoning = Array.isArray(spec.streamChunks) && spec.streamChunks.length > 0
    ? spec.streamChunks.join('')
    : spec.summary;
  return {
    agentId,
    reasoning,
    verbosity,
  };
}

export const mockAgentNode: NodeModule = {
  typeId: 'core.conformance.mock-agent',
  version: '1.0.0',
  async execute(ctx: NodeContext): Promise<NodeOutcome> {
    const config = (ctx.config ?? {}) as MockAgentConfig;
    const agentId = resolveAgentId(ctx, config);

    // 1. agent.reasoned (+ optional `agent.reasoning.delta` deltas per
    //    RFC 0024 when `mockReasoning.streamChunks` is provided).
    //    Verbosity-gated per `capabilities.md` §`agents.reasoning`:
    //    'off' suppresses both delta and closing events.
    if (config.mockReasoning !== undefined && config.mockReasoning !== false) {
      const verbosity = resolveReasoningVerbosity(ctx);
      if (verbosity !== 'off') {
        const spec = config.mockReasoning;
        const streamChunks =
          typeof spec === 'object' && Array.isArray(spec.streamChunks)
            ? spec.streamChunks.filter((c): c is string => typeof c === 'string')
            : [];
        for (let i = 0; i < streamChunks.length; i++) {
          await ctx.emit('agent.reasoning.delta', {
            agentId,
            delta: streamChunks[i],
            sequence: i,
            verbosity,
          });
        }
        await ctx.emit('agent.reasoned', buildReasoningPayload(agentId, spec, verbosity));
      }
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
        // Emit the spec-canonical payload field names per
        // `run-event-payloads.schema.json` §agentToolCalled/agentToolReturned
        // (`toolName` / `inputs` / `outcome`) — not the legacy `toolId` /
        // `arguments` / `result`. The mock's CONFIG keys stay as-is; only
        // the emitted wire shape is normalized so it matches the schema,
        // the SDK/clients, and the agentReasoningEvents conformance assertions.
        const calledRecord = await ctx.emit('agent.toolCalled', {
          agentId,
          callId,
          toolName: call.toolId,
          inputs: call.arguments ?? null,
        });
        const returnedPayload: Record<string, unknown> = {
          agentId,
          callId,
          // RFC 0002 §B: MUST equal corresponding agent.toolCalled.eventId.
          causationId: calledRecord.eventId,
          toolName: call.toolId,
          ...(call.result !== undefined && { outcome: call.result }),
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
        // Canonical per schema §agentHandoff: fromAgentId / toAgentId are
        // STRINGS (not `from`/`to` objects). The agentReasoningEvents
        // conformance scenario asserts `typeof fromAgentId === 'string'`.
        fromAgentId: agentId,
        toAgentId: ho.toAgentId,
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
