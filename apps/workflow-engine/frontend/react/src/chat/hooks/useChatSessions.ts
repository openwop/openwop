/**
 * Collection hook for the chat-session sidebar (Phase 2C.1).
 *
 * Holds the list of session HEADERS (id + title + counts + timestamps)
 * fetched from the sample-extension `/v1/host/sample/chat/sessions`
 * route family. The per-session MESSAGE thread lives in `useChatSession`;
 * this hook just owns the cross-session list.
 *
 * UX surfaces:
 *   - load() / refresh() — fetch + replace
 *   - createSession() — POST + prepend to local state
 *   - rename(id, title) — PATCH + update local copy
 *   - remove(id) — DELETE + drop from local state
 *
 * Sample-grade: no optimistic updates, no retry. Errors surface as
 * `error` state so the drawer can show a banner; the caller can retry
 * by calling `refresh()`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createChatSession,
  deleteChatSession,
  listChatSessions,
  renameChatSession,
  type ChatSessionHeader,
} from '../../client/chatSessionsClient.js';

/** Cross-tab message envelope. JSON-RPC-style discriminated union so we
 *  can extend with new event kinds (e.g., `session:message-appended`)
 *  without breaking older tabs. Older tabs ignore unknown kinds. */
type CrossTabEvent =
  | { kind: 'session:created'; sessionId: string }
  | { kind: 'session:renamed'; sessionId: string }
  | { kind: 'session:deleted'; sessionId: string };

const CHANNEL_NAME = 'openwop-sample-chat';

export interface UseChatSessionsResult {
  sessions: readonly ChatSessionHeader[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Create a new session on the BE; returns the persisted header.
   *  The new session is prepended to the local list. */
  createSession: (title?: string) => Promise<ChatSessionHeader>;
  rename: (sessionId: string, title: string) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
}

export function useChatSessions(): UseChatSessionsResult {
  const [sessions, setSessions] = useState<ChatSessionHeader[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Re-entrant load guard — if a second refresh fires while the first
  // is in flight (e.g., user clicks New + refresh near-simultaneously),
  // drop the duplicate to avoid trampling state.
  const inFlightRef = useRef(false);
  // BroadcastChannel for cross-tab session-list sync (Phase 2C.2).
  // Feature-detected — Safari + older Edge in private mode lack it; the
  // hook still works inside the originating tab, just doesn't propagate.
  const channelRef = useRef<BroadcastChannel | null>(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      const list = await listChatSessions();
      setSessions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  // Open the channel on mount; listen for events from other tabs and
  // re-fetch the headers on any mutation. Posting our own events is
  // best-effort — channel.postMessage NEVER fires on the originating
  // tab's own listener, so this is a clean fan-out.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = ch;
    ch.onmessage = (event: MessageEvent<CrossTabEvent>) => {
      const kind = event.data?.kind;
      if (kind === 'session:created' || kind === 'session:renamed' || kind === 'session:deleted') {
        void refresh();
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const broadcast = useCallback((event: CrossTabEvent) => {
    try {
      channelRef.current?.postMessage(event);
    } catch {
      /* channel closed mid-render; harmless */
    }
  }, []);

  const createSession = useCallback(async (title?: string) => {
    const created = await createChatSession(title !== undefined ? { title } : {});
    setSessions((s) => [created, ...s.filter((x) => x.sessionId !== created.sessionId)]);
    broadcast({ kind: 'session:created', sessionId: created.sessionId });
    return created;
  }, [broadcast]);

  const rename = useCallback(async (sessionId: string, title: string) => {
    const updated = await renameChatSession(sessionId, title);
    setSessions((s) => s.map((x) => (x.sessionId === sessionId ? updated : x)));
    broadcast({ kind: 'session:renamed', sessionId });
  }, [broadcast]);

  const remove = useCallback(async (sessionId: string) => {
    await deleteChatSession(sessionId);
    setSessions((s) => s.filter((x) => x.sessionId !== sessionId));
    broadcast({ kind: 'session:deleted', sessionId });
  }, [broadcast]);

  return { sessions, isLoading, error, refresh, createSession, rename, remove };
}
