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
import { createRun } from '../../client/runsClient.js';
import { subscribeToRun, type Subscription } from '../../client/streamsClient.js';
import { listOpenInterrupts, type OpenInterrupt } from '../../client/interruptsClient.js';
import type { BYOKActiveConfig } from '../../byok/lib/useBYOKConfig.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** When true, the bubble is receiving streaming deltas. */
  isStreaming?: boolean;
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
  };
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
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
  send: (text: string, config: BYOKActiveConfig) => Promise<void>;
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

  useEffect(() => {
    persistSession(session);
  }, [session]);

  useEffect(() => () => {
    subRef.current?.close();
  }, []);

  const send = useCallback(async (text: string, config: BYOKActiveConfig) => {
    setIsSending(true);
    setError(null);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
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

    // Compose the provider message history from the existing thread + the new user turn.
    const providerMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...session.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .filter((m) => !m.isStreaming && m.content.length > 0)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];

    setSession((s) => ({
      ...s,
      title: s.messages.length === 0 ? text.slice(0, 60) : s.title,
      messages: [...s.messages, userMsg, assistantMsg],
    }));

    let runId: string;
    try {
      const created = await createRun({
        workflowId: 'sample.chat.turn',
        tenantId: 'demo',
        inputs: {
          provider: config.provider,
          model: config.model,
          credentialRef: config.credentialRef,
          messages: providerMessages,
        },
        configurable: {
          credentialRefs: [config.credentialRef],
        },
        metadata: { chatSessionId: session.id, chatMessageId: assistantId },
      });
      runId = created.runId;
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

    // Subscribe to SSE; append deltas to the in-flight bubble.
    subRef.current?.close();
    let accumulated = '';
    subRef.current = subscribeToRun(runId, {
      modes: ['updates'],
      onEvent: async (ev: RunEventDoc) => {
        const payload = (ev.payload as Record<string, unknown>) ?? {};
        if (ev.type === 'node.message' && typeof payload.delta === 'string') {
          accumulated += payload.delta;
          const snapshot = accumulated;
          setSession((s) => ({
            ...s,
            messages: s.messages.map((m) => m.id === assistantId ? { ...m, content: snapshot } : m),
          }));
        } else if (ev.type === 'node.completed') {
          const outputs = (payload.outputs as Record<string, unknown>) ?? {};
          const completion = typeof outputs.completion === 'string' ? outputs.completion : accumulated;
          const usage = outputs.usage as Record<string, number> | undefined;
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
        } else if (ev.type === 'run.completed' || ev.type === 'run.cancelled') {
          setIsSending(false);
        }
      },
      onError: () => {
        setError('SSE stream lost; the bubble may be incomplete.');
      },
    });
  }, [session.id, session.messages]);

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

  return { session, isSending, error, send, reset, resolveInterrupt };
}
