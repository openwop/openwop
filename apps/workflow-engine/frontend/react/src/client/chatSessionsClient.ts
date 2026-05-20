/**
 * Frontend client for the sample-extension chat-session routes added
 * in Phase 2C.1. Wraps the seven `/v1/host/sample/chat/sessions/*`
 * endpoints with typed return shapes that mirror the BE's
 * `ChatSessionRecord` + `ChatMessageRecord`.
 *
 * Network errors and non-2xx responses surface as `Error` with the
 * server's `error` code in the message. The collection hook
 * (`useChatSessions`) is responsible for turning these into UI state.
 */

import { authedHeaders, config, fetchOpts } from './config.js';

export interface ChatSessionHeader {
  sessionId: string;
  tenantId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatMessagePersisted {
  messageId: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'workflow_run';
  /** Serialized FE ChatMessage payload — the caller parses. */
  content: string;
  meta: string | null;
  createdAt: string;
}

const PATH = '/v1/host/sample/chat/sessions';

async function http<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...fetchOpts(init),
    headers: { ...(init.headers ?? {}), ...authedHeaders({ 'content-type': 'application/json' }) },
  });
  if (res.status === 204) return undefined as unknown as T;
  const body = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const err = body as { error?: string; message?: string };
    throw new Error(`${err.error ?? 'http_error'}: ${err.message ?? `HTTP ${res.status}`}`);
  }
  return body as T;
}

export async function listChatSessions(): Promise<ChatSessionHeader[]> {
  const r = await http<{ sessions: ChatSessionHeader[] }>(PATH);
  return r.sessions;
}

export async function createChatSession(opts?: {
  title?: string;
  sessionId?: string;
}): Promise<ChatSessionHeader> {
  return http<ChatSessionHeader>(PATH, {
    method: 'POST',
    body: JSON.stringify(opts ?? {}),
  });
}

export async function getChatSession(sessionId: string): Promise<ChatSessionHeader> {
  return http<ChatSessionHeader>(`/v1/host/sample/chat/sessions/${encodeURIComponent(sessionId)}`);
}

export async function renameChatSession(sessionId: string, title: string): Promise<ChatSessionHeader> {
  return http<ChatSessionHeader>(
    `/v1/host/sample/chat/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    },
  );
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await http<void>(`/v1/host/sample/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export async function listChatSessionMessages(sessionId: string): Promise<ChatMessagePersisted[]> {
  const r = await http<{ messages: ChatMessagePersisted[] }>(
    `/v1/host/sample/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  return r.messages;
}

export async function appendChatMessage(
  sessionId: string,
  msg: { messageId: string; role: string; content: string; meta?: string },
): Promise<ChatMessagePersisted> {
  return http<ChatMessagePersisted>(
    `/v1/host/sample/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify(msg),
    },
  );
}
