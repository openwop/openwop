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
import { listOpenInterrupts, resolveByRun, type OpenInterrupt } from '../../client/interruptsClient.js';
import {
  appendChatMessage,
  createChatSession,
  listChatSessionMessages,
} from '../../client/chatSessionsClient.js';
import type { BYOKActiveConfig } from '../../byok/lib/useBYOKConfig.js';
import { useApplyAnimation } from './useApplyAnimation.js';
import { useActiveAgents, type UseActiveAgentsResult } from '../activeAgents/useActiveAgents.js';
import { isRecord } from '../lib/typeGuards.js';
import { brand } from '../../brand/brand.js';
import { getSavedWorkflow } from '../../builder/persistence/localStore.js';
import { serializeWorkflow } from '../../builder/schema/serialize.js';
import { registerWorkflow } from '../../builder/persistence/registerClient.js';
import type { WorkflowMentionEntry } from '../lib/workflowMentions.js';
import {
  LS_CURRENT_SESSION_KEY as LS_KEY,
  LS_SESSION_INDEX_KEY as LS_INDEX_KEY,
  LS_SESSION_INDEX_VERSION,
} from '../lib/storageKeys.js';

// Phase 2D — types extracted to `../types.js` so this hook can focus
// on lifecycle. Re-exported here for back-compat with existing callers
// (MessageBubble, MessageRenderer, etc. import these from this module).
export type {
  AgentDecision,
  AgentHandoff,
  AgentToolCall,
  ChatMessage,
  ChatMessageThoughts,
  ChatSession,
  Citation,
  ContentPart,
  SendOptions,
  WorkflowRunState,
} from '../types.js';
export { messageText } from '../types.js';

import type {
  ChatMessage,
  ChatMessageThoughts,
  ChatSession,
  Citation,
  ContentPart,
  SendOptions,
  WorkflowRunState,
} from '../types.js';
import { messageText } from '../types.js';

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

const EMPTY_ENVELOPE_EVENTS: NonNullable<ChatMessage['envelopeEvents']> = {
  retries: [],
  retriesExhausted: [],
  refusals: [],
  truncations: [],
  nlCoercions: [],
  recoveries: [],
  capabilitySubstitutions: [],
  capabilitiesInsufficient: [],
};

/** Specialization of {@link updateMessage} for the `envelopeEvents` field.
 *  Surfaces RFC 0030 / 0031 / 0032 / 0033 events grouped per assistant
 *  turn for the EnvelopeEventsTimeline chat card. */
function updateEnvelopeEvents(
  setSession: React.Dispatch<React.SetStateAction<ChatSession>>,
  messageId: string,
  appender: (prev: NonNullable<ChatMessage['envelopeEvents']>) => NonNullable<ChatMessage['envelopeEvents']>,
): void {
  updateMessage(setSession, messageId, (m) => ({
    ...m,
    envelopeEvents: appender(m.envelopeEvents ?? EMPTY_ENVELOPE_EVENTS),
  }));
}

// `ChatSession` + `SendOptions` now live in `../types.js`; see the
// re-export above. Inlined imports are sufficient for the rest of this
// file.

const SYSTEM_PROMPT =
  `You are a helpful AI assistant inside the ${brand.assistantName} workflow-engine sample. ` +
  `Keep responses concise. If the user asks about ${brand.assistantName} itself, explain what you know honestly.`;

// LocalStorage session index — list of session HEADERS the drawer can
// fall back to when the BE write-through is in a cold-start / 401 state
// and `listChatSessions()` returns empty. Mirrors the BE
// `ChatSessionHeader` shape; one entry per session id.
//
// Versioning: the on-disk envelope is `{ v: number, items: [...] }`.
// `useChatSessions` (reader) only consumes entries when v matches the
// current `LS_SESSION_INDEX_VERSION`; mismatched payloads are dropped.
// Bump the version constant in `../lib/storageKeys.ts` when the
// `LocalSessionHeader` shape changes.
//
// Bounded at 50 entries — the oldest are evicted silently to keep
// localStorage size under control on long-lived sample-app installs.
// Concurrent tab writes can race (no locking); the BroadcastChannel
// sync in `useChatSessions` repairs the drawer view on every BE-side
// mutation but the local-only case carries this caveat.

interface LocalSessionHeader {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface LocalSessionIndexEnvelope {
  v: number;
  items: LocalSessionHeader[];
}

function readSessionIndex(): LocalSessionHeader[] {
  try {
    const raw = localStorage.getItem(LS_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<LocalSessionIndexEnvelope>;
    // Drop payloads from a different version — shape may have drifted.
    if (parsed.v !== LS_SESSION_INDEX_VERSION) return [];
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items;
  } catch {
    /* corrupt; treat as empty */
  }
  return [];
}

function writeSessionIndex(items: readonly LocalSessionHeader[]): void {
  try {
    const envelope: LocalSessionIndexEnvelope = {
      v: LS_SESSION_INDEX_VERSION,
      items: [...items],
    };
    localStorage.setItem(LS_INDEX_KEY, JSON.stringify(envelope));
  } catch {
    /* over-quota; silently drop */
  }
}

/** Upsert a session header into the local index. The drawer reads this
 *  as a fallback when the BE session list is unavailable. */
function upsertSessionIndex(session: ChatSession): void {
  const items = readSessionIndex();
  const idx = items.findIndex((it) => it.sessionId === session.id);
  const header: LocalSessionHeader = {
    sessionId: session.id,
    title: session.title || 'New chat',
    createdAt: session.createdAt,
    updatedAt: new Date().toISOString(),
    messageCount: session.messages.filter((m) => m.role !== 'system').length,
  };
  if (idx >= 0) items[idx] = header;
  else items.unshift(header);
  // Keep the most recent 50 — bounded for localStorage size.
  writeSessionIndex(items.slice(0, 50));
}

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
  // Mirror into the local session index so the drawer has a fallback
  // when the BE list is empty. Skip empty (no-messages) sessions so we
  // don't show "New chat" placeholders.
  if (session.messages.some((m) => m.role !== 'system')) {
    upsertSessionIndex(session);
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
  runWorkflowMention: (entry: WorkflowMentionEntry, trailing?: string) => Promise<void>;
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
  /** Drop the assistant bubble at `messageId` and re-send the preceding
   *  user message. No-op if the message is not an assistant turn, has
   *  no preceding user message, or a turn is already in flight. The
   *  prior user turn's text is replayed; attachments / web-search /
   *  tool flags are not preserved (caller passes the current config). */
  regenerate: (messageId: string, config: BYOKActiveConfig) => Promise<void>;
  /** Toggle 👍/👎 feedback on an assistant bubble. Pass `null` to clear. */
  setFeedback: (messageId: string, feedback: 'positive' | 'negative' | null) => void;
  /** Switch the active chat to a persisted session — cancels the in-flight
   *  subscription, loads messages from the BE, replaces local state. */
  loadSessionFromBackend: (sessionId: string) => Promise<void>;
  /** Active-agents lineup + mutation handlers (phase D1+). The UI
   *  consumes this through the `<ActiveAgentsPanel>`; the chat
   *  dispatcher (phase D2) reads `currentAgentId` to route turns; the
   *  `@`-mention submit path (phase D3) calls `activate`. */
  activeAgents: UseActiveAgentsResult;
}

/** Built-in fallback inputs for hardcoded sample.* workflows that ship without
 *  a SavedWorkflow defaultInputs blob. Module-scoped (static data) so it has a
 *  stable identity and never needs to appear in a hook dependency array. */
const SAMPLE_DEFAULT_INPUTS: Record<string, Record<string, unknown>> = {
  'sample.demo.uppercase': { text: 'hello world' },
};

export function useChatSession(): UseChatSessionResult {
  const [session, setSession] = useState<ChatSession>(loadSession);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mirror `session` in a ref so stable callbacks (resolveInterrupt,
  // etc.) can read the latest state without putting `session` in their
  // dep array (which would invalidate every dependent callback on
  // every message tick). Updated synchronously after every commit via
  // the useEffect below.
  const sessionRef = useRef<ChatSession>(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
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
  /** Session-ids known to exist in the BE. Populated by
   *  `ensureSessionInBackend()` (lazy POST on first persist), by
   *  `reset()` (eager POST), and by `loadSessionFromBackend()` (mark
   *  loaded). Sample-grade: lives for the hook's lifetime; a page
   *  reload re-discovers via the idempotent create-or-409 path. */
  const backendSessionsRef = useRef<Set<string>>(new Set());
  /** Message-ids already persisted to BE. Prevents double-persist when
   *  React re-fires terminal handlers (e.g., StrictMode dev double-
   *  invoke) and when the SSE stream emits a stale terminal event on
   *  reconnect. */
  const persistedIdsRef = useRef<Set<string>>(new Set());

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

  /** Lazily create a session in the BE if we haven't already. Idempotent
   *  against 409 conflicts so a page reload that re-uses a previously-
   *  created sessionId silently no-ops. Errors are logged but never
   *  surface to the UI — write-through is best-effort. */
  const ensureSessionInBackend = useCallback(async (sessionId: string, title: string): Promise<void> => {
    if (backendSessionsRef.current.has(sessionId)) return;
    try {
      await createChatSession({ sessionId, title });
      backendSessionsRef.current.add(sessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      // 409 = the session already exists (e.g., we created it on a
      // previous page load). Treat as success for the dedup cache so
      // subsequent persists don't retry the create.
      if (msg.includes('idempotency_key_conflict')) {
        backendSessionsRef.current.add(sessionId);
      } else {
        // Network down or BE unreachable — leave dedup empty; we'll
        // retry on the next persist. The UI continues to work via
        // localStorage; the drawer just won't reflect this session
        // until connectivity returns.
        console.warn('chat-session BE create failed (write-through degraded)', err);
      }
    }
  }, []);

  /** Fire-and-forget persist a finalized chat message to BE. Calling
   *  again with the same `msg.id` is a no-op (dedup via
   *  `persistedIdsRef`). Ensures the parent session exists first. */
  const persistMessage = useCallback(async (sessionId: string, title: string, msg: ChatMessage): Promise<void> => {
    if (persistedIdsRef.current.has(msg.id)) return;
    persistedIdsRef.current.add(msg.id); // claim immediately to dedup concurrent calls
    try {
      await ensureSessionInBackend(sessionId, title);
      const { id: _id, meta, ...rest } = msg;
      const contentJson = JSON.stringify(rest);
      const args: Parameters<typeof appendChatMessage>[1] = {
        messageId: msg.id,
        role: msg.role,
        content: contentJson,
      };
      if (meta) args.meta = JSON.stringify(meta);
      await appendChatMessage(sessionId, args);
    } catch (err) {
      // Roll back the dedup claim so a future retry has a chance.
      // The user's session keeps streaming through localStorage; the
      // drawer just won't show this message until the next persist
      // succeeds.
      persistedIdsRef.current.delete(msg.id);
      console.warn('chat-message BE persist failed (write-through degraded)', err);
    }
  }, [ensureSessionInBackend]);

  useEffect(() => () => {
    subRef.current?.close();
    for (const sub of workflowSubsRef.current.values()) sub.close();
    workflowSubsRef.current.clear();
  }, []);

  // Hydration poll: any persisted workflow_run with status='running' is
  // stale (the SSE subscription died on the previous tab/reload). Fetch
  // a one-shot snapshot + open-interrupts list per stuck run so we can
  // either reconcile to a terminal state OR re-surface a missed
  // approval card inline. The ref guard ensures we only walk the
  // initial session — subsequent session changes drive their own SSE.
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
          if (next) {
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
            continue;
          }
          // Not terminal — check for open interrupts so the approval
          // card resurfaces if SSE delivery missed the `node.suspended`
          // event (page reload, dropped connection, etc.).
          try {
            const open = await listOpenInterrupts(runId);
            if (cancelled) return;
            const active = open[open.length - 1] ?? null;
            if (active) {
              setSession((s) => ({
                ...s,
                messages: s.messages.map((mm) => mm.id === m.id ? { ...mm, activeInterrupt: active } : mm),
              }));
            }
          } catch (e) {
            // Best-effort resurfacing, but no longer silent (GAP-ANALYSIS E6):
            // a failed listOpenInterrupts left a run stuck with a phantom
            // spinner and no signal. Surface it for diagnosis.
            console.warn('[chat] could not resurface open interrupts for run', runId, e);
          }
        } catch (err) {
          // Distinguish 404 (run record gone — account-deleted, retention
          // sweep, fresh DB) from transient errors (5xx, network drop).
          // Only 404 flips the `runUnavailable` flag permanently; other
          // errors leave the bubble as-is so the next reload can recover.
          if (err instanceof Error && /\b404\b/.test(err.message)) {
            setSession((s) => ({
              ...s,
              messages: s.messages.map((mm) => mm.id === m.id && mm.workflowRun ? {
                ...mm,
                workflowRun: { ...mm.workflowRun, runUnavailable: true },
              } : mm),
            }));
          }
          /* other errors: leave the bubble as-is; user can refresh later */
        }
      }

      // Second pass — probe terminal-status workflow_run messages that
      // haven't been validated yet. They render fine from local persisted
      // state, but action links ("Open run", "View") would 404 if the
      // BE no longer has the row. One probe per message per session-load.
      const terminal = session.messages.filter(
        (m): m is ChatMessage & { workflowRun: WorkflowRunState } =>
          m.role === 'workflow_run'
          && m.workflowRun?.runId != null
          && m.workflowRun.runUnavailable === undefined
          && (m.workflowRun.status === 'completed'
              || m.workflowRun.status === 'failed'
              || m.workflowRun.status === 'cancelled'),
      );
      for (const m of terminal) {
        const runId = m.workflowRun.runId;
        if (!runId) continue;
        try {
          await getRun(runId);
          if (cancelled) return;
          // Mark as confirmed-available so we don't re-probe next reload.
          setSession((s) => ({
            ...s,
            messages: s.messages.map((mm) => mm.id === m.id && mm.workflowRun ? {
              ...mm,
              workflowRun: { ...mm.workflowRun, runUnavailable: false },
            } : mm),
          }));
        } catch (err) {
          if (cancelled) return;
          if (err instanceof Error && /\b404\b/.test(err.message)) {
            setSession((s) => ({
              ...s,
              messages: s.messages.map((mm) => mm.id === m.id && mm.workflowRun ? {
                ...mm,
                workflowRun: { ...mm.workflowRun, runUnavailable: true },
              } : mm),
            }));
          }
          /* transient errors: leave undefined so the next reload re-probes */
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

    // Snapshot the next title before setSession so the BE-write-through
    // sees the same value the local state lands on. Avoids reading the
    // stale closure-captured `session.title` inside the persist call.
    const nextTitle = session.messages.length === 0 ? text.slice(0, 60) : session.title;
    setSession((s) => ({
      ...s,
      title: s.messages.length === 0 ? text.slice(0, 60) : s.title,
      messages: [...s.messages, userMsg, assistantMsg],
    }));

    // Write-through: persist the user message NOW (it's complete at
    // append time). The assistant message persists later, at terminal.
    // Fire-and-forget — the SSE turn doesn't block on the round-trip.
    void persistMessage(session.id, nextTitle, userMsg);

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
            // Active-agent routing (phase D2). When set, the
            // chat-responder resolves the agent's systemPrompt from
            // the registry and uses it as the system message. The
            // FE's caller (ChatSidebar) maps the active-agents panel
            // state to this id and omits it for the default
            // OpenWOP Assistant.
            ...(opts?.activeAgentId ? { agentId: opts.activeAgentId } : {}),
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
      const finalized: ChatMessage = {
        ...assistantMsg,
        isStreaming: false,
        content: '',
        meta: { error: { code: 'dispatch_failed', message: msg } },
      };
      setSession((s) => ({
        ...s,
        messages: s.messages.map((m) => m.id === assistantId ? finalized : m),
      }));
      void persistMessage(session.id, nextTitle, finalized);
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
        } else if (ev.type === 'envelope.retry.attempted' && typeof payload.nodeId === 'string') {
          const nodeId = payload.nodeId;
          const attempt = typeof payload.attempt === 'number' ? payload.attempt : 0;
          const reason = typeof payload.reason === 'string' ? payload.reason : 'unknown';
          const previousError = typeof payload.previousError === 'string' ? payload.previousError : undefined;
          const now = new Date().toISOString();
          updateEnvelopeEvents(setSession, assistantId, (prev) => ({
            ...prev,
            retries: [...prev.retries, { nodeId, attempt, reason, at: now, ...(previousError ? { previousError } : {}) }],
          }));
        } else if (ev.type === 'envelope.retry.exhausted' && typeof payload.nodeId === 'string') {
          const nodeId = payload.nodeId;
          const totalAttempts = typeof payload.totalAttempts === 'number' ? payload.totalAttempts : 0;
          const finalReason = typeof payload.finalReason === 'string' ? payload.finalReason : 'unknown';
          const finalError = typeof payload.finalError === 'string' ? payload.finalError : undefined;
          const now = new Date().toISOString();
          updateEnvelopeEvents(setSession, assistantId, (prev) => ({
            ...prev,
            retriesExhausted: [...prev.retriesExhausted, { nodeId, totalAttempts, finalReason, at: now, ...(finalError ? { finalError } : {}) }],
          }));
        } else if (ev.type === 'envelope.refusal' && typeof payload.nodeId === 'string') {
          const nodeId = payload.nodeId;
          const provider = String(payload.provider ?? '');
          const model = String(payload.model ?? '');
          const refusalText = typeof payload.refusalText === 'string' ? payload.refusalText : undefined;
          const safetyCategory = typeof payload.safetyCategory === 'string' ? payload.safetyCategory : undefined;
          const now = new Date().toISOString();
          updateEnvelopeEvents(setSession, assistantId, (prev) => ({
            ...prev,
            refusals: [...prev.refusals, {
              nodeId, provider, model, at: now,
              ...(refusalText ? { refusalText } : {}),
              ...(safetyCategory ? { safetyCategory } : {}),
            }],
          }));
        } else if (ev.type === 'envelope.truncated' && typeof payload.nodeId === 'string') {
          const nodeId = payload.nodeId;
          const provider = String(payload.provider ?? '');
          const model = String(payload.model ?? '');
          const stopReason = typeof payload.stopReason === 'string' ? payload.stopReason : 'unknown';
          const partialPayloadAvailable = typeof payload.partialPayloadAvailable === 'boolean' ? payload.partialPayloadAvailable : undefined;
          const outputTokenCount = typeof payload.outputTokenCount === 'number' ? payload.outputTokenCount : undefined;
          const now = new Date().toISOString();
          updateEnvelopeEvents(setSession, assistantId, (prev) => ({
            ...prev,
            truncations: [...prev.truncations, {
              nodeId, provider, model, stopReason, at: now,
              ...(partialPayloadAvailable !== undefined ? { partialPayloadAvailable } : {}),
              ...(outputTokenCount !== undefined ? { outputTokenCount } : {}),
            }],
          }));
        } else if (ev.type === 'envelope.nlToFormat.engaged' && typeof payload.nodeId === 'string') {
          const nodeId = payload.nodeId;
          const originalEnvelopeType = typeof payload.originalEnvelopeType === 'string' ? payload.originalEnvelopeType : '';
          const fallbackCalls = typeof payload.fallbackCalls === 'number' ? payload.fallbackCalls : undefined;
          const now = new Date().toISOString();
          updateEnvelopeEvents(setSession, assistantId, (prev) => ({
            ...prev,
            nlCoercions: [...prev.nlCoercions, { nodeId, originalEnvelopeType, at: now, ...(fallbackCalls !== undefined ? { fallbackCalls } : {}) }],
          }));
        } else if (ev.type === 'envelope.recovery.applied' && typeof payload.nodeId === 'string') {
          const nodeId = payload.nodeId;
          const path = typeof payload.path === 'string' ? payload.path : '';
          const byteOffset = typeof payload.byteOffset === 'number' ? payload.byteOffset : undefined;
          const now = new Date().toISOString();
          updateEnvelopeEvents(setSession, assistantId, (prev) => ({
            ...prev,
            recoveries: [...prev.recoveries, { nodeId, path, at: now, ...(byteOffset !== undefined ? { byteOffset } : {}) }],
          }));
        } else if (ev.type === 'model.capability.substituted' && typeof payload.nodeId === 'string') {
          const nodeId = payload.nodeId;
          const originalProvider = String(payload.originalProvider ?? '');
          const originalModel = String(payload.originalModel ?? '');
          const fallbackProvider = String(payload.fallbackProvider ?? '');
          const fallbackModel = String(payload.fallbackModel ?? '');
          const missingCapabilities = Array.isArray(payload.missingCapabilities)
            ? (payload.missingCapabilities as unknown[]).filter((c): c is string => typeof c === 'string')
            : [];
          const now = new Date().toISOString();
          updateEnvelopeEvents(setSession, assistantId, (prev) => ({
            ...prev,
            capabilitySubstitutions: [...prev.capabilitySubstitutions, {
              nodeId, originalProvider, originalModel, fallbackProvider, fallbackModel, missingCapabilities, at: now,
            }],
          }));
        } else if (ev.type === 'model.capability.insufficient' && typeof payload.nodeId === 'string') {
          const nodeId = payload.nodeId;
          const provider = String(payload.provider ?? '');
          const model = String(payload.model ?? '');
          const missingCapabilities = Array.isArray(payload.missingCapabilities)
            ? (payload.missingCapabilities as unknown[]).filter((c): c is string => typeof c === 'string')
            : [];
          const fallbackAttempted = typeof payload.fallbackAttempted === 'boolean' ? payload.fallbackAttempted : undefined;
          const now = new Date().toISOString();
          updateEnvelopeEvents(setSession, assistantId, (prev) => ({
            ...prev,
            capabilitiesInsufficient: [...prev.capabilitiesInsufficient, {
              nodeId, provider, model, missingCapabilities, at: now,
              ...(fallbackAttempted !== undefined ? { fallbackAttempted } : {}),
            }],
          }));
        } else if (ev.type === 'node.completed') {
          // Flush any buffered animation tail so the bubble has the
          // full streamed content before we overwrite with the final
          // outputs.completion (which is authoritative).
          animation.flush();
          const outputs = (payload.outputs as Record<string, unknown>) ?? {};
          const completion = typeof outputs.completion === 'string' ? outputs.completion : accumulated;
          const usage = outputs.usage as Record<string, number> | undefined;
          const citations = Array.isArray(outputs.citations) ? outputs.citations as Citation[] : undefined;
          // RFC 0030 §A — the `reasoning` string is OPTIONAL on three
          // universal envelope kinds (clarification.request, schema.request,
          // error). A standard chat completion is none of those, so this
          // capture only fires when the assistant turn happens to surface
          // a universal-kind envelope (e.g., a node that requested
          // clarification or returned a typed error). For the typical
          // happy-path completion the capture returns undefined and
          // ReasoningDisclosure renders nothing. Probes both the outputs
          // root and the nested envelope.payload shape so hosts can lift
          // reasoning either way without breaking the FE.
          const envelopeReasoning = (() => {
            if (typeof outputs.reasoning === 'string' && outputs.reasoning.length > 0) return outputs.reasoning;
            const envelope = outputs.envelope as Record<string, unknown> | undefined;
            if (!envelope) return undefined;
            const payloadField = envelope.payload as Record<string, unknown> | undefined;
            if (payloadField && typeof payloadField.reasoning === 'string' && payloadField.reasoning.length > 0) {
              return payloadField.reasoning;
            }
            return undefined;
          })();
          // RFC 0055 §B: lift the optional `meta.rendering` hint if the
          // turn surfaced an AI envelope carrying one (envelope.meta.rendering),
          // or the host lifted it to the outputs root. Validated against the
          // closed `display` vocabulary; anything else is dropped (the
          // renderer falls back to default text rendering anyway).
          const envelopeRendering = ((): NonNullable<ChatMessage['meta']>['rendering'] => {
            const DISPLAYS = ['markdown', 'code', 'card', 'image', 'audio', 'file'] as const;
            const envelope = outputs.envelope as Record<string, unknown> | undefined;
            const envMeta = envelope?.meta as Record<string, unknown> | undefined;
            const raw = (envMeta?.rendering ?? outputs.rendering) as Record<string, unknown> | undefined;
            if (!raw || typeof raw !== 'object') return undefined;
            const display = raw.display;
            if (typeof display !== 'string' || !(DISPLAYS as readonly string[]).includes(display)) return undefined;
            const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
            return {
              display: display as (typeof DISPLAYS)[number],
              ...(str(raw.mimeType) ? { mimeType: str(raw.mimeType)! } : {}),
              ...(str(raw.lang) ? { lang: str(raw.lang)! } : {}),
              ...(str(raw.alt) ? { alt: str(raw.alt)! } : {}),
              ...(str(raw.title) ? { title: str(raw.title)! } : {}),
            };
          })();
          let finalized: ChatMessage | null = null;
          setSession((s) => {
            const next = s.messages.map((m) => {
              if (m.id !== assistantId) return m;
              const updated: ChatMessage = {
                ...m,
                isStreaming: false,
                content: completion,
                ...(envelopeReasoning ? { reasoning: envelopeReasoning } : {}),
                meta: {
                  runId,
                  provider: outputs.provider as string | undefined,
                  model: outputs.model as string | undefined,
                  inputTokens: usage?.inputTokens,
                  outputTokens: usage?.outputTokens,
                  ...(citations && citations.length > 0 ? { citations } : {}),
                  ...(envelopeRendering ? { rendering: envelopeRendering } : {}),
                },
              };
              finalized = updated;
              return updated;
            });
            return { ...s, messages: next };
          });
          if (finalized) void persistMessage(session.id, session.title, finalized);
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
          } catch (e) {
            // No longer silent (GAP-ANALYSIS E6): a dropped interrupt fetch
            // previously left the approval card absent with no trace.
            console.warn('[chat] could not load open interrupt for run', runId, e);
          }
        } else if (ev.type === 'node.interrupt.resolved') {
          setSession((s) => ({
            ...s,
            messages: s.messages.map((m) => m.id === assistantId ? { ...m, activeInterrupt: null } : m),
          }));
        } else if (ev.type === 'run.failed') {
          animation.flush();
          const err = (payload.error as Record<string, string>) ?? { code: 'unknown', message: 'unknown failure' };
          let finalized: ChatMessage | null = null;
          setSession((s) => {
            const next = s.messages.map((m) => {
              if (m.id !== assistantId) return m;
              const updated: ChatMessage = {
                ...m,
                isStreaming: false,
                content: accumulated,
                meta: { runId, error: { code: err.code ?? 'unknown', message: err.message ?? 'unknown' } },
              };
              finalized = updated;
              return updated;
            });
            return { ...s, messages: next };
          });
          if (finalized) void persistMessage(session.id, session.title, finalized);
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
          let finalized: ChatMessage | null = null;
          setSession((s) => {
            const next = s.messages.map((m) => {
              if (m.id !== assistantId) return m;
              const updated: ChatMessage = {
                ...m,
                isStreaming: false,
                content: accumulated || '',
                meta: { runId, error: { code: 'cancelled', message: 'Stopped by user.' } },
              };
              finalized = updated;
              return updated;
            });
            return { ...s, messages: next };
          });
          if (finalized) void persistMessage(session.id, session.title, finalized);
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
        let finalized: ChatMessage | null = null;
        setSession((s) => {
          const next = s.messages.map((m) => {
            if (m.id !== assistantId) return m;
            const updated: ChatMessage = {
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
            };
            finalized = updated;
            return updated;
          });
          return { ...s, messages: next };
        });
        if (finalized) void persistMessage(session.id, session.title, finalized);
        setIsSending(false);
        inFlightRunIdRef.current = null;
        inFlightAssistantIdRef.current = null;
      },
    });
    // session.title added so a persist after a rename uses the current title.
    // animation (ref-backed, stable methods) and persistMessage (useCallback)
    // are intentionally omitted — their object identity churns each render and
    // adding them would needlessly recreate `send` (used widely downstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.messages, session.title]);

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
    // animation's methods are ref-backed useCallbacks (stable); cancel reads
    // only refs + setIsSending. No reactive deps. (GAP-ANALYSIS code-review)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Clear write-through dedup state. The fresh sessionId has no
    // messages persisted yet; the new title belongs to a session that
    // doesn't exist in BE yet (ensureSessionInBackend will create it
    // on the first send).
    persistedIdsRef.current = new Set();
    persistSession(fresh);
    setSession(fresh);
    setError(null);
    setIsSending(false);
    // Eagerly create the session in BE so it appears in the drawer
    // even before the user sends anything. Idempotent against 409s.
    void ensureSessionInBackend(fresh.id, fresh.title);
  }, [ensureSessionInBackend]);

  const resolveInterrupt = useCallback(async (messageId: string, value: unknown) => {
    // Read latest session from the ref so this stable callback
    // doesn't need to depend on `session` (which would invalidate it
    // on every message tick + force every consumer to re-bind).
    const msg = sessionRef.current.messages.find((m) => m.id === messageId);
    const activeInterrupt = msg?.activeInterrupt ?? null;
    const runId = msg?.workflowRun?.runId ?? msg?.meta?.runId ?? null;
    if (!activeInterrupt || !runId) {
      // Nothing to resolve. Clear local state anyway so the card
      // disappears if it was somehow rendered without a runId.
      setSession((s) => ({
        ...s,
        messages: s.messages.map((m) => m.id === messageId ? { ...m, activeInterrupt: null } : m),
      }));
      return;
    }
    // Optimistically clear the card so the user gets immediate
    // feedback; the BE call + SSE reconcile happen below.
    setSession((s) => ({
      ...s,
      messages: s.messages.map((m) => m.id === messageId ? { ...m, activeInterrupt: null } : m),
    }));
    try {
      await resolveByRun(runId, activeInterrupt.nodeId, value);
      // The BE emits `node.interrupt.resolved` + the downstream
      // node.started/completed events over SSE; the existing handler
      // (line ~1300) updates the bubble's status as those land.
    } catch (err) {
      // Resume failed — restore the interrupt so the user can retry,
      // and surface the error inline. Restore via setSession's
      // functional update so any concurrent SSE write to other fields
      // on the same message is preserved (we only flip activeInterrupt).
      const message = err instanceof Error ? err.message : String(err);
      setSession((s) => ({
        ...s,
        messages: s.messages.map((m) => m.id === messageId
          ? { ...m, activeInterrupt }
          : m),
      }));
      setError(`Could not resolve interrupt: ${message}`);
    }
  }, []);

  const loadSessionFromBackend = useCallback(async (sessionId: string) => {
    // Cancel anything in flight on the current session before switching.
    subRef.current?.close();
    subRef.current = null;
    inFlightRunIdRef.current = null;
    inFlightAssistantIdRef.current = null;
    setIsSending(false);
    setError(null);
    try {
      const persisted = await listChatSessionMessages(sessionId);
      // Each persisted row carries a JSON-encoded ChatMessage minus
      // the id (the id is the row's messageId) — round-trip via the
      // same envelope shape that `send` writes through.
      const messages: ChatMessage[] = persisted
        .map((p): ChatMessage | null => {
          try {
            const stripped = JSON.parse(p.content) as Omit<ChatMessage, 'id'>;
            return { ...stripped, id: p.messageId };
          } catch {
            return null;
          }
        })
        .filter((m): m is ChatMessage => m !== null);
      const next: ChatSession = {
        id: sessionId,
        // The drawer holds the authoritative title; on reload we use a
        // placeholder until the next persistSession() picks it up.
        title: 'Saved chat',
        messages,
        createdAt: persisted[0]?.createdAt ?? new Date().toISOString(),
        // `activeAgents` deliberately omitted — the BE chat_sessions
        // table doesn't store the active-agents lineup (the column
        // would need a v17 migration + a round-trip through
        // `appendChatMessage` / list-messages). On a cross-device
        // load the user starts with just the default assistant in
        // the side panel; the panel footer surfaces this limitation
        // to the user. Same-device same-browser reloads of the
        // current session DO survive via `persistSession` →
        // localStorage. Track this in the `[[activeAgents
        // persistence]]` follow-up.
      };
      // Mark every loaded id as already-persisted so subsequent appends
      // dedup correctly. The session itself is known to exist in BE
      // since we just listed its messages.
      persistedIdsRef.current = new Set(messages.map((m) => m.id));
      backendSessionsRef.current.add(sessionId);
      persistSession(next);
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const setFeedback = useCallback((messageId: string, feedback: 'positive' | 'negative' | null) => {
    setSession((s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        if (feedback === null) {
          const { feedback: _drop, ...rest } = m;
          return rest;
        }
        return { ...m, feedback };
      }),
    }));
  }, []);

  // `send` is declared above but referenced in the regenerate closure;
  // keep this useCallback inside the hook so it picks up the latest
  // `session`/`send` bindings on each render.
  const regenerate = useCallback(async (messageId: string, config: BYOKActiveConfig) => {
    if (isSending) return; // a turn is already in flight
    const idx = session.messages.findIndex((m) => m.id === messageId);
    if (idx < 1) return;
    const assistant = session.messages[idx];
    const prior = session.messages[idx - 1];
    if (!assistant || assistant.role !== 'assistant') return;
    if (!prior || prior.role !== 'user') return;
    const priorText = messageText(prior);
    if (!priorText) return;
    // Drop the assistant bubble (and the user message we're about to
    // re-emit through send()) so the regenerated turn appears in the
    // same conversational slot rather than after the original.
    setSession((s) => ({ ...s, messages: s.messages.slice(0, idx - 1) }));
    await send(priorText, config);
  }, [isSending, session.messages, send]);

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
  const runWorkflowMention = useCallback(async (entry: WorkflowMentionEntry, trailing?: string) => {
    setError(null);
    // Preserve what the user actually typed so the chat history shows
    // `/hello-uppercase hello` (their intent) and not just the slug.
    //
    // Symbol: `/` post-2026-05-28 mention-symbol swap. `@` now opens
    // the agents picker and goes through the agent-activation path
    // (phase D3), not the workflow dispatch path. Old persisted chat
    // history keeps showing `@slug` for workflows dispatched before
    // the swap — acceptable historical artifact; the wire content is
    // opaque to the BE.
    const trimmedTrailing = trailing?.trim() ?? '';
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedTrailing.length > 0 ? `/${entry.slug} ${trimmedTrailing}` : `/${entry.slug}`,
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
      // Title-on-first-message + write-through, mirroring `send()` at
      // line 562-572 — without this, an @mention is the only chat
      // entry-point that leaves the session unpersisted, so the
      // history drawer keeps showing "New chat — 0 messages" forever
      // even after the workflow completes.
      const userText = typeof userMsg.content === 'string' ? userMsg.content : `@${entry.slug}`;
      const deletedTitle = session.messages.length === 0 ? userText.slice(0, 60) : session.title;
      setSession((s) => ({
        ...s,
        title: s.messages.length === 0 ? userText.slice(0, 60) : s.title,
        messages: [...s.messages, userMsg, msg],
      }));
      void persistMessage(session.id, deletedTitle, userMsg);
      void persistMessage(session.id, deletedTitle, msg);
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
    // User typed `/<slug> some text` — override the first key of the
    // resolved inputs object with that text. Keeps the workflow's
    // remaining defaults (e.g., a `tone` knob, a `length` cap) so the
    // user gets to swap the obvious "what do I send" field without
    // having to re-author the whole inputs JSON.
    //
    // If the workflow has no defaultInputs we synthesize `{ text: ... }`
    // since the two ports a sample workflow commonly accepts are
    // `text` (uppercase, etl-extractor) and `prompt` (mock-ai).
    if (trimmedTrailing.length > 0) {
      const keys = Object.keys(inputs);
      if (keys.length > 0) {
        const firstKey = keys[0]!;
        inputs = { ...inputs, [firstKey]: trimmedTrailing };
      } else {
        inputs = { text: trimmedTrailing };
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
      nodeOutputs: {},
      currentNodeName: null,
      nodeNames,
      startedAt,
    };
    const runMsg: ChatMessage = {
      id: runMsgId,
      role: 'workflow_run',
      content: `/${entry.slug} — starting…`,
      createdAt: startedAt,
      workflowRun: initial,
    };
    // Title-on-first-message + write-through, mirroring `send()` at
    // line 562-572. Without this, the @mention chat path is the only
    // entry-point that never persists, so the history drawer always
    // shows "New chat — 0 messages" for chats that only contain
    // workflow runs.
    //
    // We compute `nextTitle` synchronously from the same closure-time
    // `session` that `setSession` will read, so the persist call sees
    // the same value the local state lands on. `userMsg.content` is
    // always a plain string for @mentions (no attachments are
    // composed into a mention dispatch), but the `ChatMessage.content`
    // union is `string | ContentPart[]` — narrow it explicitly so the
    // `title: string` field stays typed.
    const userText = typeof userMsg.content === 'string' ? userMsg.content : `@${entry.slug}`;
    const nextTitle = session.messages.length === 0 ? userText.slice(0, 60) : session.title;
    setSession((s) => ({
      ...s,
      title: s.messages.length === 0 ? userText.slice(0, 60) : s.title,
      messages: [...s.messages, userMsg, runMsg],
    }));
    void persistMessage(session.id, nextTitle, userMsg);
    // The workflow_run message persists at terminal (run.completed /
    // failed / cancelled) below — its `workflowRun` state grows
    // throughout the run, so we want the final shape on disk, not the
    // empty "starting…" snapshot.

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
      let finalizedFailed: ChatMessage | null = null;
      setSession((s) => {
        const next = s.messages.map((m) => {
          if (m.id !== runMsgId || !m.workflowRun) return m;
          const updated: ChatMessage = {
            ...m,
            workflowRun: {
              ...m.workflowRun,
              status: 'failed',
              error: { code: 'dispatch_failed', message: msg },
            },
          };
          finalizedFailed = updated;
          return updated;
        });
        return { ...s, messages: next };
      });
      // Persist the dispatch-failed run-bubble so the drawer shows
      // *something* even when /v1/runs never produced a runId.
      if (finalizedFailed) void persistMessage(session.id, nextTitle, finalizedFailed);
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
          updateWorkflowRun(runMsgId, (prev) => {
            const running = prev.runningNodeIds ?? [];
            return {
              ...prev,
              currentNodeName: prev.nodeNames[nodeId] ?? nodeId,
              runningNodeIds: running.includes(nodeId) ? running : [...running, nodeId],
            };
          });
        } else if (ev.type === 'node.completed' && nodeId) {
          // Capture the node's outputs so the bubble can render them
          // inline. The arbiter approval card needs to see what the
          // three upstream critics produced; without this they'd be
          // discarded.
          const outputs = (payload.outputs && typeof payload.outputs === 'object')
            ? payload.outputs
            : undefined;
          updateWorkflowRun(runMsgId, (prev) => {
            if (prev.completedNodeIds.includes(nodeId)) return prev;
            const running = (prev.runningNodeIds ?? []).filter((id) => id !== nodeId);
            return {
              ...prev,
              completedNodeIds: [...prev.completedNodeIds, nodeId],
              runningNodeIds: running,
              ...(outputs ? { nodeOutputs: { ...prev.nodeOutputs, [nodeId]: outputs } } : {}),
            };
          });
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
                  runningNodeIds: (prev.runningNodeIds ?? []).filter((id) => id !== nodeId),
                  currentNodeName: prev.currentNodeName === (prev.nodeNames[nodeId] ?? nodeId)
                    ? null
                    : prev.currentNodeName,
                }
          ));
        } else if (ev.type === 'node.suspended') {
          // Best-effort fetch with one retry — the event emission and
          // interrupt-row commit are sequential server-side but the
          // FE's GET sometimes lands before the row is visible to the
          // read path under load. Without the retry the approval card
          // silently never appears.
          let active: OpenInterrupt | null = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const open = await listOpenInterrupts(runId);
              active = open[open.length - 1] ?? null;
              if (active) break;
            } catch { /* try again */ }
            if (attempt === 0) await new Promise((r) => setTimeout(r, 250));
          }
          setSession((s) => ({
            ...s,
            messages: s.messages.map((m) => m.id === runMsgId ? { ...m, activeInterrupt: active } : m),
          }));
          // Track in WorkflowRunState.interruptHistory so the persistent
          // decision card has the `kind` + opened-at after resolution —
          // `activeInterrupt` flips to null at resolve time and would
          // otherwise lose the history.
          // Drop the suspended node from the "actively running" set so
          // its row renders the ⏸ paused chip instead of a spinner —
          // the StepList already special-cases suspended via
          // `activeInterrupt.nodeId`, but `runningNodeIds` needs to
          // agree or both states fight each other on the same row.
          if (nodeId) {
            updateWorkflowRun(runMsgId, (prev) => {
              const running = prev.runningNodeIds ?? [];
              if (!running.includes(nodeId)) return prev;
              return { ...prev, runningNodeIds: running.filter((id) => id !== nodeId) };
            });
          }
          if (active && nodeId) {
            const openedAt = active.createdAt;
            const kind = active.kind;
            const interruptId = active.interruptId;
            updateWorkflowRun(runMsgId, (prev) => {
              const history = prev.interruptHistory ?? [];
              if (history.some((h) => h.interruptId === interruptId)) return prev;
              return {
                ...prev,
                interruptHistory: [...history, { interruptId, nodeId, kind, openedAt }],
              };
            });
          }
        } else if (ev.type === 'node.interrupt.resolved') {
          setSession((s) => ({
            ...s,
            messages: s.messages.map((m) => m.id === runMsgId ? { ...m, activeInterrupt: null } : m),
          }));
          // Close out the matching entry in interruptHistory.
          // resumeValue lands in nodeOutputs via the `node.completed`
          // event that fires alongside this one (see executor.ts:780);
          // pick it up so the decision card renders the chosen option.
          const resolvedNode = nodeId;
          const resolvedAt = ev.timestamp ?? new Date().toISOString();
          if (resolvedNode) {
            updateWorkflowRun(runMsgId, (prev) => {
              const history = prev.interruptHistory ?? [];
              const idx = history.findIndex(
                (h) => h.nodeId === resolvedNode && !h.resolvedAt,
              );
              if (idx === -1) return prev;
              // The executor wraps the user's resumeValue as
              // `{output: <resumeValue>}` when writing the node.completed
              // event (see executor.ts:780). Unwrap it back so the
              // HitlDecisionCard sees the raw shape the ApprovalCard
              // emitted (`{action, content, selectedKey, comment}`).
              const nodeOutput = prev.nodeOutputs[resolvedNode];
              const resumeValue = isRecord(nodeOutput) && 'output' in nodeOutput
                ? nodeOutput.output
                : nodeOutput;
              const next = history.slice();
              next[idx] = { ...next[idx]!, resolvedAt, resumeValue };
              return { ...prev, interruptHistory: next };
            });
          }
        } else if (ev.type === 'run.completed') {
          const outputs = (payload.outputs as Record<string, unknown>) ?? undefined;
          // Inline setSession (rather than updateWorkflowRun) so we
          // can capture the finalized message and write it through to
          // the BE in the same step — without this, an @mention chat
          // session is never persisted and the history drawer keeps
          // showing "New chat — 0 messages" even after completion.
          let finalized: ChatMessage | null = null;
          setSession((s) => {
            const next = s.messages.map((m) => {
              if (m.id !== runMsgId || !m.workflowRun) return m;
              const updated: ChatMessage = {
                ...m,
                workflowRun: {
                  ...m.workflowRun,
                  status: 'completed',
                  ...(outputs ? { outputs } : {}),
                },
              };
              finalized = updated;
              return updated;
            });
            return { ...s, messages: next };
          });
          if (finalized) void persistMessage(session.id, nextTitle, finalized);
          closeWorkflowSub(runMsgId);
        } else if (ev.type === 'run.failed') {
          const err = (payload.error as Record<string, string>) ?? { code: 'unknown', message: 'unknown failure' };
          let finalized: ChatMessage | null = null;
          setSession((s) => {
            const next = s.messages.map((m) => {
              if (m.id !== runMsgId || !m.workflowRun) return m;
              const updated: ChatMessage = {
                ...m,
                workflowRun: {
                  ...m.workflowRun,
                  status: 'failed',
                  error: { code: err.code ?? 'unknown', message: err.message ?? 'unknown failure' },
                },
              };
              finalized = updated;
              return updated;
            });
            return { ...s, messages: next };
          });
          if (finalized) void persistMessage(session.id, nextTitle, finalized);
          closeWorkflowSub(runMsgId);
        } else if (ev.type === 'run.cancelled') {
          let finalized: ChatMessage | null = null;
          setSession((s) => {
            const next = s.messages.map((m) => {
              if (m.id !== runMsgId || !m.workflowRun) return m;
              const updated: ChatMessage = {
                ...m,
                workflowRun: { ...m.workflowRun, status: 'cancelled' },
              };
              finalized = updated;
              return updated;
            });
            return { ...s, messages: next };
          });
          if (finalized) void persistMessage(session.id, nextTitle, finalized);
          closeWorkflowSub(runMsgId);
        }
      },
      onError: () => { /* SSE drops don't tear down the bubble */ },
      onTimeout: () => { /* idle timeout — leave bubble as-is */ },
    });
    workflowSubsRef.current.set(runMsgId, sub);
  }, [session.id, session.title, session.messages.length, updateWorkflowRun, persistMessage]);

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

  // The useActiveAgents call is unconditional, so rule-of-hooks holds.
  // Placement here (vs at the top of the function) keeps the active-agents
  // API logically grouped with the chat-session result it's exposed on.
  const activeAgents = useActiveAgents(session, setSession);

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
    regenerate,
    setFeedback,
    loadSessionFromBackend,
    activeAgents,
  };
}
