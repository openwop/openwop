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
import {
  LS_SESSION_INDEX_KEY,
  LS_SESSION_INDEX_VERSION,
} from '../lib/storageKeys.js';

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
      // BE-first: if the backend returns chat sessions, use them.
      // If the BE list is empty (Cloud Run cold start, 401 between
      // deploys, fresh tenant), fall back to the local session index
      // populated by `persistSession` in useChatSession. This is what
      // keeps the History drawer from being permanently empty on the
      // public demo when write-through is degraded.
      if (list.length > 0) {
        setSessions(list);
      } else {
        const local = readLocalSessionIndex();
        setSessions(local);
      }
    } catch (err) {
      // BE errored — fall back to local index. The user still sees
      // their chats; we just can't sync across tabs/devices.
      const local = readLocalSessionIndex();
      if (local.length > 0) {
        setSessions(local);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  /** Read the localStorage session index written by `persistSession`
   *  in `useChatSession`. Mirrors the BE `ChatSessionHeader` shape so
   *  the drawer doesn't need to know which source provided each row.
   *  `tenantId` is synthetic ('local'); the drawer doesn't gate on it.
   *
   *  On-disk envelope is `{ v: LS_SESSION_INDEX_VERSION, items: [...] }`.
   *  Mismatched-version payloads are dropped to prevent rendering with
   *  a stale shape (see lib/storageKeys.ts for the bump protocol). */
  function readLocalSessionIndex(): ChatSessionHeader[] {
    try {
      const raw = localStorage.getItem(LS_SESSION_INDEX_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { v?: number; items?: unknown };
      if (parsed.v !== LS_SESSION_INDEX_VERSION) return [];
      if (!Array.isArray(parsed.items)) return [];
      return parsed.items.map((raw) => {
        const it = raw as Record<string, unknown>;
        return {
          sessionId: String(it.sessionId),
          tenantId: 'local',
          title: String(it.title ?? 'Untitled'),
          createdAt: String(it.createdAt ?? new Date().toISOString()),
          updatedAt: String(it.updatedAt ?? it.createdAt ?? new Date().toISOString()),
          messageCount: Number(it.messageCount ?? 0),
        };
      });
    } catch {
      return [];
    }
  }

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
