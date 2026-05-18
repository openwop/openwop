/**
 * Chat session state. Holds the message thread + per-turn run dispatch.
 *
 * Lifecycle of a turn:
 *   1. User submits → append a user Message + an in-flight assistant Message (isStreaming=true)
 *   2. POST /v1/runs with workflowId=sample.chat.turn + inputs.messages + configurable.credentialRefs
 *   3. Subscribe to SSE events; on each `node.message` event append the `delta` to the in-flight bubble
 *   4. On `run.completed`, flip `isStreaming=false` and capture final output / usage
 *   5. On `node.suspended`, surface an active interrupt for inline card rendering
 *   6. On `run.failed`, replace the bubble with an error state
 *
 * Sessions are persisted to localStorage (Phase 1). Each session has an
 * id + title + messages[] + createdAt. The current session is the most
 * recently used.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunEventDoc } from '@openwop/openwop';
import { cancelRun, createRun, getRun } from '../../client/runsClient.js';
import { subscribeToRun, type Subscription } from '../../client/streamsClient.js';
import { listOpenInterrupts, type OpenInterrupt } from '../../client/interruptsClient.js';
import type { BYOKActiveConfig } from '../../byok/lib/useBYOKConfig.js';
import { useApplyAnimation } from './useApplyAnimation.js';
import { getSavedWorkflow } from '../../builder/persistence/localStore.js';
import { serializeWorkflow } from '../../builder/schema/serialize.js';
import { registerWorkflow } from '../../builder/persistence/registerClient.js';
import type { WorkflowMentionEntry } from '../lib/workflowMentions.js';

/** A single piece of content within a message. Models that support
 *  multi-modal input (audio, image) accept multiple parts; a pure-text
 *  message has a single text part — equivalent to `content: string`. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'audio'; mimeType: string; dataBase64: string; durationSeconds?: number };

/** A normalized citation surfaced from a provider's web-search tool result. */
export interface Citation {
  title?: string;
  url: string;
  snippet?: string;
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
  /** Deduped node ids whose `node.failed` event has been seen. The
   *  executor may keep running other branches after a failure (error-
   *  routing trigger rules); the bubble surfaces failures via the
   *  terminal `run.failed` event but tracks per-node failures here for
   *  future UI use and progress-bar accuracy. */
  failedNodeIds: string[];
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
  /** When set, render an interrupt card inline beneath this bubble. */
  activeInterrupt?: OpenInterrupt | null;
  /** Final-turn metadata for the assistant bubble. */
  meta?: {
    runId?: string;
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    error?: { code: string; message: string };
    /** Citations from a web-search-enabled turn. */
    citations?: readonly Citation[];
  };
  /** Structured state for `role: 'workflow_run'` messages. */
  workflowRun?: WorkflowRunState;
  createdAt: string;
}

/** Helpers: extract the text portion (for cost calc / history history reconstruction). */
export function messageText(m: ChatMessage): string {
  if (typeof m.content === 'string') return m.content;
  return m.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join('');
}

/** Functional state-update helper for a single message in the session.
 *  Encapsulates the spread-map-spread dance so callers can express the
 *  diff in one line ("transform message m"). */
function updateMessage(
  setSession: React.Dispatch<React.SetStateAction<ChatSession>>,
  messageId: string,
  transform: (m: ChatMessage) => ChatMessage,
): void {
  setSession((s) => ({
    ...s,
    messages: s.messages.map((m) => (m.id === messageId ? transform(m) : m)),
  }));
}

/** Specialization of {@link updateMessage} for the `agentEvents` field.
 *  Takes a callback that receives the prior agent-event log (with empty
 *  defaults) and returns the next one. */
function updateAgentEvents(
  setSession: React.Dispatch<React.SetStateAction<ChatSession>>,
  messageId: string,
  appender: (prev: NonNullable<ChatMessage['agentEvents']>) => NonNullable<ChatMessage['agentEvents']>,
): void {
  updateMessage(setSession, messageId, (m) => ({
    ...m,
    agentEvents: appender(m.agentEvents ?? { toolCalls: [], handoffs: [], decisions: [] }),
  }));
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

const LS_KEY = 'openwop.sample.chat.session';
const SYSTEM_PROMPT =
  'You are a helpful AI assistant inside the OpenWOP workflow-engine sample. ' +
  'Keep responses concise. If the user asks about OpenWOP itself, explain what you know honestly.';

function loadSession(): ChatSession {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as ChatSession;
  } catch {
    /* fall through to fresh */
  }
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    messages: [],
    createdAt: new Date().toISOString(),
  };
}

function persistSession(session: ChatSession): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(session));
  } catch {
    /* over-quota; silently drop */
  }
}

export interface UseChatSessionResult {
  session: ChatSession;
  /** True while a turn is in flight. */
  isSending: boolean;
  /** Last error from a turn dispatch. */
  error: string | null;
  /** Submit a user message and start a new turn. */
  send: (text: string, config: BYOKActiveConfig, opts?: SendOptions) => Promise<void>;
  /** Run a workflow directly via an `@mention`. Bypasses the LLM and
   *  dispatches POST /v1/runs immediately; surfaces progress + HITL
   *  interrupts inline in the chat feed as a `workflow_run` message. */
  runWorkflowMention: (entry: WorkflowMentionEntry) => Promise<void>;
  /** Cancel an in-flight workflow_run. No-op if the message is not a
   *  workflow_run, its run is not in flight, or its runId isn't set. */
  cancelWorkflowRun: (messageId: string) => Promise<void>;
  /** Cancel the in-flight turn (if any). No-op when nothing is streaming. */
  cancel: () => Promise<void>;
  /** Append a synthetic system-role message to the visible thread.
   *  Used by slash-command handlers (e.g., /help output, /cost summary). */
  emitSystem: (content: string) => void;
  /** Wipe the session and start fresh. */
  reset: () => void;
  /** Resolve an active interrupt belonging to the most recent assistant bubble. */
  resolveInterrupt: (messageId: string, value: unknown) => Promise<void>;
}

export function useChatSession(): UseChatSessionResult {
  const [session, setSession] = useState<ChatSession>(loadSession);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subRef = useRef<Subscription | null>(null);
  /** Run id of the in-flight turn. Used by cancel(). */
  const inFlightRunIdRef = useRef<string | null>(null);
  /** Assistant message id of the in-flight bubble. Used by cancel(). */
  const inFlightAssistantIdRef = useRef<string | null>(null);
  /** SSE subscriptions for live workflow_run messages, keyed by the
   *  workflow_run chat-message id. Bare-mention dispatches are
   *  long-lived and independent of the chat-turn lifecycle — they
   *  can run concurrently and outlive any single chat turn, so they
   *  need their own ref. Cleared on terminal events + unmount. */
  const workflowSubsRef = useRef<Map<string, Subscription>>(new Map());

  // Apply-animation: batches token deltas into ~one update per
  // animation frame. The flush callback appends the accumulated tail
  // to whichever in-flight assistant bubble exists.
  const animation = useApplyAnimation({
    frameBudgetMs: 16,
    onFlush: (tail) => {
      const assistantId = inFlightAssistantIdRef.current;
      if (!assistantId) return;
      setSession((s) => ({
        ...s,
        // Assistant streams are always string content (LLMs stream text).
        // The ContentPart[] path is for user multi-modal messages.
        messages: s.messages.map((m) =>
          m.id === assistantId
            ? { ...m, content: (typeof m.content === 'string' ? m.content : '') + tail }
            : m,
        ),
      }));
    },
  });

  useEffect(() => {
    persistSession(session);
  }, [session]);

  useEffect(() => () => {
    subRef.current?.close();
    for (const sub of workflowSubsRef.current.values()) sub.close();
    workflowSubsRef.current.clear();
  }, []);

  // Hydration poll: any persisted workflow_run with status='running' is
  // stale (the SSE subscription died on the previous tab/reload). Fetch
  // a one-shot snapshot per stuck run and reconcile to a terminal state.
  // Missed mid-run interrupts can't be reconstructed from a snapshot;
  // the user can resolve them from /runs/:runId if needed. The ref guard
  // ensures we only walk the initial session — subsequent session
  // changes drive their own SSE and don't need re-reconciliation.
  const didHydrateRef = useRef(false);
  useEffect(() => {
    if (didHydrateRef.current) return;
    didHydrateRef.current = true;
    let cancelled = false;
    void (async () => {
      const stuck = session.messages.filter(
        (m): m is ChatMessage & { workflowRun: WorkflowRunState } =>
          m.role === 'workflow_run'
          && m.workflowRun?.status === 'running'
          && typeof m.workflowRun?.runId === 'string',
      );
      for (const m of stuck) {
        const runId = m.workflowRun.runId;
        if (!runId) continue;
        try {
          const snap = await getRun(runId);
          if (cancelled) return;
          const next: WorkflowRunState['status'] | null = (() => {
            switch (snap.status) {
              case 'completed': return 'completed';
              case 'failed':    return 'failed';
              case 'cancelled': return 'cancelled';
              default: return null;
            }
          })();
          if (!next) continue;
          setSession((s) => ({
            ...s,
            messages: s.messages.map((mm) => mm.id === m.id && mm.workflowRun ? {
              ...mm,
              workflowRun: {
                ...mm.workflowRun,
                status: next,
                ...(next === 'failed' ? { error: { code: 'reconciled', message: 'Run failed; details in /runs.' } } : {}),
              },
            } : mm),
          }));
        } catch {
          /* network error — leave the bubble as-is; user can refresh later */
        }
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const send = useCallback(async (text: string, config: BYOKActiveConfig, opts?: SendOptions) => {
    setIsSending(true);
    setError(null);

    const attachments = opts?.attachments ?? [];
    const userContent: string | readonly ContentPart[] = attachments.length === 0
      ? text
      : [
          // Audio first so the model "hears" before the text caption.
          ...attachments,
          ...(text.trim().length > 0 ? [{ type: 'text' as const, text }] : []),
        ];
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
      createdAt: new Date().toISOString(),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      createdAt: new Date().toISOString(),
    };

    // Compose the provider message history from the existing thread +
    // the new user turn. Past messages with multi-modal content pass
    // their ContentPart[] through; text-only messages stay as strings.
    // (Dispatchers convert per-provider on the BE.)
    const providerMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...session.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .filter((m) => {
          if (m.isStreaming) return false;
          if (typeof m.content === 'string') return m.content.length > 0;
          return m.content.length > 0;
        })
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ];

    setSession((s) => ({
      ...s,
      title: s.messages.length === 0 ? text.slice(0, 60) : s.title,
      messages: [...s.messages, userMsg, assistantMsg],
    }));

    inFlightAssistantIdRef.current = assistantId;
    let runId: string;
    try {
      const created = await createRun(
        {
          workflowId: 'sample.chat.turn',
          // Omit body.tenantId so the BE infers from the authenticated
          // session/bearer (req.tenantId): `anon:<sid>` for cookie-anon
          // callers, `user:<hash>` for Firebase-signed-in callers. A
          // hardcoded 'demo' here is rejected by principalAuthorizer
          // for any non-bearer-with-demo-allowlist principal.
          inputs: {
            provider: config.provider,
            model: config.model,
            credentialRef: config.credentialRef,
            messages: providerMessages,
            webSearch: opts?.webSearch === true,
            ...(opts?.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
          },
          configurable: {
            credentialRefs: [config.credentialRef],
          },
          metadata: { chatSessionId: session.id, chatMessageId: assistantId },
        },
        // Per spec/v1/idempotency.md Layer 1: stable key per user intent.
        // `assistantId` is generated once per `send()` call, so retries
        // of the same intent collapse server-side instead of creating
        // duplicate runs.
        { idempotencyKey: assistantId },
      );
      runId = created.runId;
      inFlightRunIdRef.current = runId;
      // Stamp the bubble with the runId immediately so any mid-stream
      // interrupt has a valid run to resolve against — the rest of
      // `meta` (provider/model/tokens/citations) populates on
      // `node.completed` below.
      setSession((s) => ({
        ...s,
        messages: s.messages.map((m) => m.id === assistantId
          ? { ...m, meta: { ...(m.meta ?? {}), runId } }
          : m,
        ),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSession((s) => ({
        ...s,
        messages: s.messages.map((m) => m.id === assistantId
          ? { ...m, isStreaming: false, content: '', meta: { error: { code: 'dispatch_failed', message: msg } } }
          : m,
        ),
      }));
      setError(msg);
      setIsSending(false);
      return;
    }

    // Subscribe to SSE; route token deltas through apply-animation so a
    // fast stream doesn't thrash React with per-token re-renders.
    subRef.current?.close();
    animation.reset();
    let accumulated = '';
    subRef.current = subscribeToRun(runId, {
      modes: ['updates'],
      onEvent: async (ev: RunEventDoc) => {
        const payload = (ev.payload as Record<string, unknown>) ?? {};
        if (ev.type === 'node.message' && typeof payload.delta === 'string') {
          accumulated += payload.delta;
          animation.push(payload.delta);
        } else if (ev.type === 'agent.reasoning.delta' && typeof payload.delta === 'string') {
          // Phase 2 streaming reasoning. Incremental chunks arrive
          // before the final agent.reasoned; the disclosure renders
          // them live with a typewriter cursor.
          const delta = payload.delta;
          const verbosity = payload.verbosity as ChatMessageThoughts['verbosity'];
          const agentId = typeof payload.agentId === 'string' ? payload.agentId : undefined;
          const now = new Date().toISOString();
          updateMessage(setSession, assistantId, (m) => {
            const prev = m.thoughts;
            return {
              ...m,
              thoughts: {
                content: (prev?.content ?? '') + delta,
                startedAt: prev?.startedAt ?? now,
                ...(prev?.finishedAt ? { finishedAt: prev.finishedAt } : {}),
                ...(prev?.durationMs != null ? { durationMs: prev.durationMs } : {}),
                ...(verbosity ? { verbosity } : prev?.verbosity ? { verbosity: prev.verbosity } : {}),
                ...(agentId ? { agentId } : prev?.agentId ? { agentId: prev.agentId } : {}),
              },
            };
          });
        } else if (ev.type === 'agent.toolCalled' && typeof payload.callId === 'string' && typeof payload.toolName === 'string') {
          const callId = payload.callId;
          const toolName = payload.toolName;
          const agentIdRaw = typeof payload.agentId === 'string' ? payload.agentId : '';
          const inputs = payload.inputs;
          const now = new Date().toISOString();
          updateAgentEvents(setSession, assistantId, (prev) => ({
            ...prev,
            toolCalls: [...prev.toolCalls, { callId, toolName, agentId: agentIdRaw, inputs, startedAt: now }],
          }));
        } else if (ev.type === 'agent.toolReturned' && typeof payload.callId === 'string') {
          const callId = payload.callId;
          const errorPayload = payload.error;
          const error = errorPayload && typeof errorPayload === 'object' && 'code' in errorPayload && 'message' in errorPayload
            ? { code: String((errorPayload as Record<string, unknown>).code), message: String((errorPayload as Record<string, unknown>).message) }
            : undefined;
          const outcome = payload.outcome;
          const now = new Date().toISOString();
          updateAgentEvents(setSession, assistantId, (prev) => ({
            ...prev,
            toolCalls: prev.toolCalls.map((tc) =>
              tc.callId === callId
                ? { ...tc, finishedAt: now, outcome, ...(error ? { error } : {}) }
                : tc,
            ),
          }));
        } else if (ev.type === 'agent.handoff' && typeof payload.fromAgentId === 'string' && typeof payload.toAgentId === 'string') {
          const fromAgentId = payload.fromAgentId;
          const toAgentId = payload.toAgentId;
          const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
          const now = new Date().toISOString();
          updateAgentEvents(setSession, assistantId, (prev) => ({
            ...prev,
            handoffs: [...prev.handoffs, { fromAgentId, toAgentId, at: now, ...(reason ? { reason } : {}) }],
          }));
        } else if (ev.type === 'agent.decided' && typeof payload.agentId === 'string') {
          const agentIdRaw = payload.agentId;
          const confidence = typeof payload.confidence === 'number' ? payload.confidence : undefined;
          const decision = payload.decision;
          const now = new Date().toISOString();
          updateAgentEvents(setSession, assistantId, (prev) => ({
            ...prev,
            decisions: [
              ...prev.decisions,
              { agentId: agentIdRaw, decision, at: now, ...(confidence != null ? { confidence } : {}) },
            ],
          }));
        } else if (ev.type === 'agent.reasoned' && typeof payload.reasoning === 'string') {
          // Phase 1 path: full block delivered in one event after
          // </think>. Also acts as the "finalize" for any Phase 2
          // streaming deltas that preceded it.
          const reasoning = payload.reasoning;
          const verbosity = payload.verbosity as ChatMessageThoughts['verbosity'];
          const agentId = typeof payload.agentId === 'string' ? payload.agentId : undefined;
          const now = new Date().toISOString();
          updateMessage(setSession, assistantId, (m) => {
            const startedAt = m.thoughts?.startedAt ?? now;
            const durationMs = Date.parse(now) - Date.parse(startedAt);
            return {
              ...m,
              thoughts: {
                content: reasoning,
                startedAt,
                finishedAt: now,
                durationMs: Number.isFinite(durationMs) ? durationMs : 0,
                ...(verbosity ? { verbosity } : {}),
                ...(agentId ? { agentId } : {}),
              },
            };
          });
        } else if (ev.type === 'node.completed') {
          // Flush any buffered animation tail so the bubble has the
          // full streamed content before we overwrite with the final
          // outputs.completion (which is authoritative).
          animation.flush();
          const outputs = (payload.outputs as Record<string, unknown>) ?? {};
          const completion = typeof outputs.completion === 'string' ? outputs.completion : accumulated;
          const usage = outputs.usage as Record<string, number> | undefined;
          const citations = Array.isArray(outputs.citations) ? outputs.citations as Citation[] : undefined;
          setSession((s) => ({
            ...s,
            messages: s.messages.map((m) => m.id === assistantId ? {
              ...m,
              isStreaming: false,
              content: completion,
              meta: {
                runId,
                provider: outputs.provider as string | undefined,
                model: outputs.model as string | undefined,
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
                ...(citations && citations.length > 0 ? { citations } : {}),
              },
            } : m),
          }));
        } else if (ev.type === 'node.suspended') {
          // An interrupt fired mid-turn — fetch the open interrupts and
          // attach the latest to the assistant bubble so the card host
          // can render an inline approval / clarification / etc. card.
          try {
            const open = await listOpenInterrupts(runId);
            const active = open[open.length - 1] ?? null;
            setSession((s) => ({
              ...s,
              messages: s.messages.map((m) => m.id === assistantId ? { ...m, activeInterrupt: active } : m),
            }));
          } catch {
            /* swallow; interrupt UI just stays absent */
          }
        } else if (ev.type === 'node.interrupt.resolved') {
          setSession((s) => ({
            ...s,
            messages: s.messages.map((m) => m.id === assistantId ? { ...m, activeInterrupt: null } : m),
          }));
        } else if (ev.type === 'run.failed') {
          animation.flush();
          const err = (payload.error as Record<string, string>) ?? { code: 'unknown', message: 'unknown failure' };
          setSession((s) => ({
            ...s,
            messages: s.messages.map((m) => m.id === assistantId ? {
              ...m,
              isStreaming: false,
              content: accumulated,
              meta: { runId, error: { code: err.code ?? 'unknown', message: err.message ?? 'unknown' } },
            } : m),
          }));
          setIsSending(false);
          inFlightRunIdRef.current = null;
          inFlightAssistantIdRef.current = null;
          // Close the SSE subscription explicitly so the idle timer
          // doesn't fire 30s later and overwrite the bubble with a
          // spurious stream_timeout error. The BE already closed its
          // side via res.end(); browser EventSource auto-reconnect
          // would otherwise keep our timer alive.
          subRef.current?.close();
          subRef.current = null;
        } else if (ev.type === 'run.cancelled') {
          // User-initiated stop. Mark the in-flight bubble as cancelled
          // with whatever content we accumulated so far.
          animation.flush();
          setSession((s) => ({
            ...s,
            messages: s.messages.map((m) => m.id === assistantId ? {
              ...m,
              isStreaming: false,
              content: accumulated || '',
              meta: { runId, error: { code: 'cancelled', message: 'Stopped by user.' } },
            } : m),
          }));
          setIsSending(false);
          inFlightRunIdRef.current = null;
          inFlightAssistantIdRef.current = null;
          subRef.current?.close();
          subRef.current = null;
        } else if (ev.type === 'run.completed') {
          setIsSending(false);
          inFlightRunIdRef.current = null;
          inFlightAssistantIdRef.current = null;
          subRef.current?.close();
          subRef.current = null;
        }
      },
      onError: () => {
        setError('SSE stream lost; the bubble may be incomplete.');
      },
      onTimeout: (kind) => {
        animation.flush();
        setSession((s) => ({
          ...s,
          messages: s.messages.map((m) => m.id === assistantId ? {
            ...m,
            isStreaming: false,
            content: accumulated,
            meta: {
              runId,
              error: {
                code: 'stream_timeout',
                message: kind === 'idle'
                  ? 'No tokens received for 30s — the stream appears stuck. The bubble shows whatever arrived before the timeout.'
                  : 'Stream exceeded the absolute deadline (120s). The bubble shows whatever arrived before the timeout.',
              },
            },
          } : m),
        }));
        setIsSending(false);
        inFlightRunIdRef.current = null;
        inFlightAssistantIdRef.current = null;
      },
    });
  }, [session.id, session.messages]);

  const cancel = useCallback(async () => {
    const runId = inFlightRunIdRef.current;
    if (!runId) return;
    // Close the SSE subscription immediately so further deltas don't
    // arrive after the user clicked Stop. Flush any buffered animation
    // tail first so it lands in the bubble. The BE's cancelRun call
    // races in parallel — whichever finishes first wins.
    animation.flush();
    subRef.current?.close();
    subRef.current = null;
    try {
      await cancelRun(runId, 'cancelled by user from chat');
    } catch (err) {
      // Cancel failed (run already terminal, network blip, etc.) —
      // still surface a friendly cancellation in the bubble.
      setError(err instanceof Error ? err.message : String(err));
    }
    const assistantId = inFlightAssistantIdRef.current;
    if (assistantId) {
      setSession((s) => ({
        ...s,
        messages: s.messages.map((m) => m.id === assistantId ? {
          ...m,
          isStreaming: false,
          meta: { ...(m.meta ?? {}), error: { code: 'cancelled', message: 'Stopped by user.' }, runId: runId },
        } : m),
      }));
    }
    inFlightRunIdRef.current = null;
    inFlightAssistantIdRef.current = null;
    setIsSending(false);
  }, []);

  const emitSystem = useCallback((content: string) => {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content,
      createdAt: new Date().toISOString(),
    };
    setSession((s) => ({ ...s, messages: [...s.messages, msg] }));
  }, []);

  const reset = useCallback(() => {
    subRef.current?.close();
    const fresh: ChatSession = {
      id: crypto.randomUUID(),
      title: 'New chat',
      messages: [],
      createdAt: new Date().toISOString(),
    };
    persistSession(fresh);
    setSession(fresh);
    setError(null);
    setIsSending(false);
  }, []);

  const resolveInterrupt = useCallback(async (messageId: string, _value: unknown) => {
    // Optimistically clear the active interrupt on the bubble; the SSE
    // event will reconcile shortly.
    setSession((s) => ({
      ...s,
      messages: s.messages.map((m) => m.id === messageId ? { ...m, activeInterrupt: null } : m),
    }));
  }, []);

  /** Update a single `workflow_run` message's `workflowRun` state. */
  const updateWorkflowRun = useCallback((
    messageId: string,
    patch: (prev: WorkflowRunState) => WorkflowRunState,
  ): void => {
    setSession((s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== messageId || !m.workflowRun) return m;
        return { ...m, workflowRun: patch(m.workflowRun) };
      }),
    }));
  }, []);

  /** Close + remove a workflow_run's SSE subscription. Safe to call
   *  even if the entry is missing (no-op). */
  function closeWorkflowSub(messageId: string): void {
    const sub = workflowSubsRef.current.get(messageId);
    if (!sub) return;
    sub.close();
    workflowSubsRef.current.delete(messageId);
  }

  /** Built-in fallback inputs for hardcoded sample.* workflows that
   *  ship without a SavedWorkflow defaultInputs blob. Keeps `@uppercase`
   *  from dispatching with an empty `inputs.text` and silently emitting
   *  an empty string. */
  const SAMPLE_DEFAULT_INPUTS: Record<string, Record<string, unknown>> = {
    'sample.demo.uppercase': { text: 'hello world' },
  };

  const runWorkflowMention = useCallback(async (entry: WorkflowMentionEntry) => {
    setError(null);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: `@${entry.slug}`,
      createdAt: new Date().toISOString(),
    };
    const runMsgId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // Builder-saved workflows live in localStorage and need to be
    // registered with the backend's in-memory catalog before /v1/runs
    // resolves them. Hardcoded `sample.*` workflows are already in the
    // catalog — skip registration and node-name population.
    const isBuilderWorkflow = entry.workflowId.startsWith('wf_');
    const saved = isBuilderWorkflow ? getSavedWorkflow(entry.workflowId) : undefined;
    if (isBuilderWorkflow && !saved) {
      // The mention pointed to a workflow that's no longer in localStorage.
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Workflow "${entry.displayName}" was deleted. Pick another from the dashboard or remove the mention.`,
        createdAt: new Date().toISOString(),
      };
      setSession((s) => ({ ...s, messages: [...s.messages, userMsg, msg] }));
      return;
    }

    // Build nodeId → friendly-name map for "running step N of M — <name>".
    // Mirrors serialize.ts:174 nodeId pattern: `${sanitizedKind}_${index}`.
    const nodeNames: Record<string, string> = {};
    let totalNodes = 0;
    let inputs: Record<string, unknown> = SAMPLE_DEFAULT_INPUTS[entry.workflowId] ?? {};
    if (saved) {
      totalNodes = saved.nodes.length;
      saved.nodes.forEach((n, i) => {
        const safeKind = n.kind.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
        nodeNames[`${safeKind}_${i}`] = n.name;
      });
      const raw = saved.defaultInputs?.trim();
      if (raw) {
        try { inputs = JSON.parse(raw) as Record<string, unknown>; } catch { /* empty */ }
      }
    }

    const initial: WorkflowRunState = {
      slug: entry.slug,
      workflowName: entry.displayName,
      workflowId: entry.workflowId,
      runId: null,
      status: 'pending',
      totalNodes,
      completedNodeIds: [],
      failedNodeIds: [],
      currentNodeName: null,
      nodeNames,
      startedAt,
    };
    const runMsg: ChatMessage = {
      id: runMsgId,
      role: 'workflow_run',
      content: `@${entry.slug} — starting…`,
      createdAt: startedAt,
      workflowRun: initial,
    };
    setSession((s) => ({ ...s, messages: [...s.messages, userMsg, runMsg] }));

    let runId: string;
    try {
      if (saved) {
        const def = serializeWorkflow(saved);
        await registerWorkflow(def);
      }
      const created = await createRun(
        {
          workflowId: entry.workflowId,
          // Same as the chat-turn createRun above: omit body.tenantId
          // so the BE infers from the authenticated session.
          inputs,
          metadata: { chatSessionId: session.id, chatMessageId: runMsgId, mentionSlug: entry.slug },
        },
        // Per spec/v1/idempotency.md Layer 1: `runMsgId` is generated
        // once per `runWorkflowMention()` invocation and persisted on
        // the workflow_run message. A page refresh or SDK retry that
        // re-submits with this key will collapse onto the original
        // run server-side instead of creating a duplicate.
        { idempotencyKey: runMsgId },
      );
      runId = created.runId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateWorkflowRun(runMsgId, (prev) => ({
        ...prev,
        status: 'failed',
        error: { code: 'dispatch_failed', message: msg },
      }));
      setError(msg);
      return;
    }

    updateWorkflowRun(runMsgId, (prev) => ({ ...prev, runId, status: 'running' }));

    const sub = subscribeToRun(runId, {
      modes: ['updates'],
      onEvent: async (ev: RunEventDoc) => {
        const payload = (ev.payload as Record<string, unknown>) ?? {};
        const nodeId = ev.nodeId ?? (typeof payload.nodeId === 'string' ? payload.nodeId : undefined);

        if (ev.type === 'node.started' && nodeId) {
          updateWorkflowRun(runMsgId, (prev) => ({
            ...prev,
            currentNodeName: prev.nodeNames[nodeId] ?? nodeId,
          }));
        } else if (ev.type === 'node.completed' && nodeId) {
          updateWorkflowRun(runMsgId, (prev) => (
            prev.completedNodeIds.includes(nodeId)
              ? prev
              : { ...prev, completedNodeIds: [...prev.completedNodeIds, nodeId] }
          ));
        } else if (ev.type === 'node.failed' && nodeId) {
          // The executor may keep running other branches on failure
          // (error-routing trigger rules). Track failed nodes so the
          // progress bar accounts for them and clear `currentNodeName`
          // so the UI doesn't claim a failed node is still "running".
          updateWorkflowRun(runMsgId, (prev) => (
            prev.failedNodeIds.includes(nodeId)
              ? prev
              : {
                  ...prev,
                  failedNodeIds: [...prev.failedNodeIds, nodeId],
                  currentNodeName: prev.currentNodeName === (prev.nodeNames[nodeId] ?? nodeId)
                    ? null
                    : prev.currentNodeName,
                }
          ));
        } else if (ev.type === 'node.suspended') {
          try {
            const open = await listOpenInterrupts(runId);
            const active = open[open.length - 1] ?? null;
            setSession((s) => ({
              ...s,
              messages: s.messages.map((m) => m.id === runMsgId ? { ...m, activeInterrupt: active } : m),
            }));
          } catch { /* swallow */ }
        } else if (ev.type === 'node.interrupt.resolved') {
          setSession((s) => ({
            ...s,
            messages: s.messages.map((m) => m.id === runMsgId ? { ...m, activeInterrupt: null } : m),
          }));
        } else if (ev.type === 'run.completed') {
          const outputs = (payload.outputs as Record<string, unknown>) ?? undefined;
          updateWorkflowRun(runMsgId, (prev) => ({
            ...prev,
            status: 'completed',
            ...(outputs ? { outputs } : {}),
          }));
          closeWorkflowSub(runMsgId);
        } else if (ev.type === 'run.failed') {
          const err = (payload.error as Record<string, string>) ?? { code: 'unknown', message: 'unknown failure' };
          updateWorkflowRun(runMsgId, (prev) => ({
            ...prev,
            status: 'failed',
            error: { code: err.code ?? 'unknown', message: err.message ?? 'unknown failure' },
          }));
          closeWorkflowSub(runMsgId);
        } else if (ev.type === 'run.cancelled') {
          updateWorkflowRun(runMsgId, (prev) => ({ ...prev, status: 'cancelled' }));
          closeWorkflowSub(runMsgId);
        }
      },
      onError: () => { /* SSE drops don't tear down the bubble */ },
      onTimeout: () => { /* idle timeout — leave bubble as-is */ },
    });
    workflowSubsRef.current.set(runMsgId, sub);
  }, [session.id, updateWorkflowRun]);

  const cancelWorkflowRun = useCallback(async (messageId: string) => {
    const msg = session.messages.find((m) => m.id === messageId);
    const runId = msg?.workflowRun?.runId;
    if (!runId || msg?.workflowRun?.status !== 'running') return;
    try {
      await cancelRun(runId, 'User cancelled from chat.');
      // The backend's run.cancelled event will flip the status + close
      // the SSE subscription via the existing terminal-event handler.
      // Optimistic UI: nothing to do here — the bubble updates on the
      // event arriving.
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      updateWorkflowRun(messageId, (prev) => ({
        ...prev,
        status: 'failed',
        error: { code: 'cancel_failed', message: m },
      }));
      closeWorkflowSub(messageId);
    }
  }, [session.messages, updateWorkflowRun]);

  return {
    session,
    isSending,
    error,
    send,
    cancel,
    emitSystem,
    reset,
    resolveInterrupt,
    runWorkflowMention,
    cancelWorkflowRun,
  };
}
