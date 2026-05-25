/**
 * Chat domain types — extracted from `hooks/useChatSession.ts` so the
 * hook file stays focused on the lifecycle. Imported by MessageBubble,
 * MessageRenderer, MessageFeed, ErrorCard, ChatHeader, etc.
 *
 * Phase 2D preventative split per `plans/openwop-sample-chat-improvements-plan.md`
 * §"Hook decomposition". Keeps `useChatSession.ts` under ~1000 LOC by
 * pulling out ~150 LOC of pure type declarations.
 */

import type { OpenInterrupt } from '../client/interruptsClient.js';

/** A single piece of content within a message. Models that support
 *  multi-modal input (audio, image) accept multiple parts; a pure-text
 *  message has a single text part — equivalent to `content: string`. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'audio'; mimeType: string; dataBase64: string; durationSeconds?: number }
  // RFC 0055 media.* — host-served `url` preferred; inline `dataBase64`
  // permitted under the host's maxInlineMediaBytes cap. `alt` carries
  // meta.rendering.alt for accessibility (§A7 / §B1).
  | { type: 'image'; mimeType: string; url?: string; dataBase64?: string; alt?: string }
  | { type: 'file'; mimeType: string; url?: string; dataBase64?: string; name?: string };

/** A normalized citation surfaced from a provider's web-search tool result. */
export interface Citation {
  title?: string;
  url: string;
  snippet?: string;
}

/** Open + resolved interrupt history for a workflow run. Captured
 *  by the SSE event handler so the post-resolution decision card can
 *  derive what the human chose without a separate fetch. Both states
 *  live in one record so the FE can render either inline.
 *
 *  Persisted alongside the workflow_run message via localStorage +
 *  the chat_sessions table — survives reload as long as the chat
 *  session does. The BE event log remains the source of truth; this
 *  is a render-time index.
 */
export interface InterruptHistoryEntry {
  /** Stable BE-side id; re-renders keep React keys stable. */
  interruptId: string;
  /** Node where the interrupt opened. */
  nodeId: string;
  /** Resume kind per `interrupt-profiles.md` (RFC 0005). Defaults to
   *  `'approval'` when the kind isn't observable (e.g., reload arrives
   *  with the interrupt already resolved and `listOpenInterrupts`
   *  omits resolved rows). */
  kind: 'approval' | 'clarification' | 'refinement' | 'cancellation' | 'external-event' | string;
  /** ISO timestamp of when the interrupt opened. */
  openedAt: string;
  /** ISO timestamp of when the interrupt resolved. Absent while open. */
  resolvedAt?: string;
  /** The user's resume payload. Shape varies by kind; the decision
   *  card renders it defensively via type-guards rather than asserting. */
  resumeValue?: unknown;
}

/** State attached to a `workflow_run` chat message. Tracks the
 *  workflow execution lifecycle for direct `@mention` dispatch
 *  (bypassing the LLM tool-calling path). */
export interface WorkflowRunState {
  slug: string;
  workflowName: string;
  workflowId: string;
  /** Null while POST /v1/runs is in flight, then set. */
  runId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  totalNodes: number;
  /** Deduped node ids whose `node.completed` event has been seen. */
  completedNodeIds: string[];
  /** Per-node outputs captured from each `node.completed` event's
   *  `payload.outputs` field. Keyed by nodeId. Lets the bubble surface
   *  the critic summaries / extract results / etc. that the user needs
   *  context for before making an HITL approval decision. Without this
   *  the approval card sits naked ("approve which?") because the
   *  upstream nodes' outputs are discarded. */
  nodeOutputs: Record<string, unknown>;
  /** Deduped node ids whose `node.failed` event has been seen. The
   *  executor may keep running other branches after a failure (error-
   *  routing trigger rules); the bubble surfaces failures via the
   *  terminal `run.failed` event but tracks per-node failures here for
   *  future UI use and progress-bar accuracy. */
  failedNodeIds: string[];
  /** Resolved + currently-open interrupts in the order they appeared.
   *  Feeds the persistent `HitlDecisionCard` rendered inline once the
   *  user has resolved an interrupt — without this, the FE forgets
   *  what the human chose as soon as `activeInterrupt` flips to null. */
  interruptHistory?: InterruptHistoryEntry[];
  /** Friendly name of the most recently started node. */
  currentNodeName: string | null;
  /** Map of backend nodeId → friendly name from the builder graph.
   *  Empty for sample workflows where we don't have the SavedWorkflow. */
  nodeNames: Record<string, string>;
  startedAt: string;
  outputs?: Record<string, unknown>;
  error?: { code: string; message: string };
}

/** A tool the assistant agent invoked during this turn — built from a
 *  `agent.toolCalled` + matching `agent.toolReturned` pair (RFC 0002 §B).
 *  Rendered as an inline card under the assistant bubble. */
export interface AgentToolCall {
  callId: string;
  toolName: string;
  agentId: string;
  inputs?: unknown;
  outcome?: unknown;
  error?: { code: string; message: string };
  startedAt: string;
  /** When set, the toolReturned event has arrived. Card collapses from
   *  "Running…" to a duration badge. */
  finishedAt?: string;
}

/** Control transfer between agents within this turn (RFC 0002 §B,
 *  `agent.handoff`). Rendered as a chevron-separated chip under the
 *  bubble owned by the receiving agent. */
export interface AgentHandoff {
  fromAgentId: string;
  toAgentId: string;
  reason?: string;
  at: string;
}

/** Typed decision the agent produced (RFC 0002 §B, `agent.decided`). */
export interface AgentDecision {
  agentId: string;
  decision: unknown;
  confidence?: number;
  at: string;
}

/** Reasoning trace surfaced from `agent.reasoned` events (RFC 0002).
 *  Rendered above the assistant bubble as a collapsible "Thoughts"
 *  disclosure — Claude.ai / o1 style. The reasoning content is
 *  authoritative once `finishedAt` is set; before that, the disclosure
 *  shows a "Thinking…" pulse. */
export interface ChatMessageThoughts {
  /** Accumulated reasoning text. For Phase 1, set once on
   *  `agent.reasoned`. For Phase 2 streaming, grows incrementally via
   *  `agent.reasoning.delta`. */
  content: string;
  /** Verbosity mode this reasoning was produced under. */
  verbosity?: 'summary' | 'full' | 'off';
  /** AgentRef.agentId of the reasoning agent. */
  agentId?: string;
  /** Wall-clock when the first reasoning chunk arrived. */
  startedAt: string;
  /** Wall-clock when the reasoning block closed. Unset while
   *  in-flight; the disclosure shows a pulsing "Thinking…" state. */
  finishedAt?: string;
  /** Convenience: elapsed time in ms, computed on finalize. */
  durationMs?: number;
}

/** Envelope-reliability + capability-substitution event records, grouped per
 *  assistant turn. Surfaces RFC 0030 / 0031 / 0032 / 0033 events as inline
 *  chips in the assistant bubble. Each row preserves the minimum payload
 *  the corresponding card needs to render; the underlying RunEventDoc is
 *  still available via the live event stream for power users. */
export interface EnvelopeRetryAttempt {
  nodeId: string;
  attempt: number;
  reason: 'schema-violation' | 'truncation' | 'refusal' | string;
  previousError?: string;
  at: string;
}
export interface EnvelopeRetryExhausted {
  nodeId: string;
  totalAttempts: number;
  finalReason: string;
  finalError?: string;
  at: string;
}
export interface EnvelopeRefusal {
  nodeId: string;
  provider: string;
  model: string;
  refusalText?: string;
  safetyCategory?: string;
  at: string;
}
export interface EnvelopeTruncation {
  nodeId: string;
  provider: string;
  model: string;
  stopReason: 'max_tokens' | 'length' | 'stop_sequence' | 'unknown' | string;
  partialPayloadAvailable?: boolean;
  outputTokenCount?: number;
  at: string;
}
export interface EnvelopeNLCoercion {
  nodeId: string;
  originalEnvelopeType: string;
  fallbackCalls?: number;
  at: string;
}
export interface EnvelopeRecovery {
  nodeId: string;
  path: string;
  byteOffset?: number;
  at: string;
}
export interface ModelCapabilitySubstitution {
  nodeId: string;
  originalProvider: string;
  originalModel: string;
  fallbackProvider: string;
  fallbackModel: string;
  missingCapabilities: string[];
  at: string;
}
export interface ModelCapabilityInsufficient {
  nodeId: string;
  provider: string;
  model: string;
  missingCapabilities: string[];
  fallbackAttempted?: boolean;
  at: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'workflow_run';
  /** Message content. `string` is the common case for text-only.
   *  `ContentPart[]` is for multi-modal user turns (audio + text)
   *  or future assistant turns that include non-text artifacts.
   *  For role `workflow_run` this carries a short status summary
   *  ("@slug — running step N of M"); the structured state lives
   *  in `workflowRun` below. */
  content: string | readonly ContentPart[];
  /** When true, the bubble is receiving streaming deltas. */
  isStreaming?: boolean;
  /** Optional reasoning trace from `agent.reasoned` / Phase 2
   *  streaming deltas. Rendered as a collapsible Thoughts disclosure
   *  above the assistant bubble. */
  thoughts?: ChatMessageThoughts;
  /** Optional agent-event timeline for this turn — tool calls, handoffs,
   *  decisions surfaced from the `agent.*` event family (RFC 0002 §B).
   *  Rendered as a sequence of inline cards below the message content. */
  agentEvents?: {
    toolCalls: AgentToolCall[];
    handoffs: AgentHandoff[];
    decisions: AgentDecision[];
  };
  /** Envelope-reliability + capability-substitution events grouped per turn.
   *  RFC 0030 / 0031 / 0032 / 0033. Rendered by EnvelopeEventsTimeline as
   *  a stack of inline chips between the answer and the agent-events block.
   *  Optional carryReasoning is the RFC 0030 §A reasoning string when the
   *  assistant turn ships one; surfaced as a separate "Why" disclosure. */
  envelopeEvents?: {
    retries: EnvelopeRetryAttempt[];
    retriesExhausted: EnvelopeRetryExhausted[];
    refusals: EnvelopeRefusal[];
    truncations: EnvelopeTruncation[];
    nlCoercions: EnvelopeNLCoercion[];
    recoveries: EnvelopeRecovery[];
    capabilitySubstitutions: ModelCapabilitySubstitution[];
    capabilitiesInsufficient: ModelCapabilityInsufficient[];
  };
  /** RFC 0030 §A envelope.payload.reasoning — a post-hoc explanation the
   *  model ships *with* its structured answer. Distinct from `thoughts`,
   *  which is the thinking-token stream. */
  reasoning?: string;
  /** When set, render an interrupt card inline beneath this bubble. */
  activeInterrupt?: OpenInterrupt | null;
  /** Final-turn metadata for the assistant bubble. */
  meta?: {
    runId?: string;
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    /** Error envelope. The required `code` + `message` pair matches
     *  the BE's serialized error shape; the optional `category` /
     *  `action` / `userMessage` fields mirror the BE's
     *  `classifyDispatchError()` output and are populated when the BE
     *  attaches its classifier result to the error envelope or
     *  run-event payload. When absent, `ErrorCard` falls back to
     *  `chat/lib/errorClassify.ts:classifyChatError()`. See the
     *  cross-reference in `errorClassify.ts` for the FE/BE drift
     *  discipline. */
    error?: {
      code: string;
      message: string;
      category?: 'network' | 'auth' | 'rate_limit' | 'quota' | 'timeout' | 'safety' | 'config' | 'unknown';
      action?: 'retry' | 'regenerate' | 'reconfigure' | 'abort' | 'wait';
      userMessage?: string;
      retryAfterMs?: number;
    };
    /** Citations from a web-search-enabled turn. */
    citations?: readonly Citation[];
    /** RFC 0055 §B rendering hint — how the producer suggests this turn's
     *  text payload be rendered. Advisory; unknown values fall back to the
     *  default text/markdown rendering. */
    rendering?: {
      display: 'markdown' | 'code' | 'card' | 'image' | 'audio' | 'file';
      mimeType?: string;
      lang?: string;
      alt?: string;
      title?: string;
    };
  };
  /** Structured state for `role: 'workflow_run'` messages. */
  workflowRun?: WorkflowRunState;
  /** User thumbs-up / thumbs-down feedback recorded via the message-actions
   *  toolbar. Persisted to localStorage with the rest of the session; no
   *  backend wiring yet (signal-only). Absent = no rating given. */
  feedback?: 'positive' | 'negative';
  createdAt: string;
}

/** Extract the plain-text portion of a message — used by cost calc,
 *  copy-to-clipboard, and persistence-envelope round-trips. */
export function messageText(m: ChatMessage): string {
  if (typeof m.content === 'string') return m.content;
  return m.content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}

/** Per-turn options for send(). */
export interface SendOptions {
  /** Audio / image / file attachments. Bundled into the user message as
   *  ContentPart[]; provider dispatchers convert per-provider. */
  attachments?: readonly ContentPart[];
  /** Enable provider-native web search for this turn (anthropic / openai
   *  / google all support; gated per-model via providers.json `webSearch`). */
  webSearch?: boolean;
  /** Workflow-bound tools the chat node can dispatch via the Anthropic
   *  tools API (anthropic provider only — gated upstream). Each entry
   *  is { workflowId, name, description }; the chat responder node
   *  turns these into Anthropic tool definitions and dispatches the
   *  named workflow on tool_use. */
  tools?: ReadonlyArray<{ workflowId: string; name: string; description: string }>;
}
