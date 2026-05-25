/**
 * Notification store — the FE single source of truth for the bell +
 * panel + /inbox surfaces. Modeled on myndhyve's store
 * (`src/features/notifications/notificationStore.ts`) but trimmed to
 * the openwop demo's scope:
 *
 *   - in-app channel only (no push / email / desktop yet)
 *   - no quiet hours / DND (defer until preferences UI lands)
 *   - openwop's BE is the system of record; this store mirrors a slice
 *
 * Lifecycle:
 *   - `connect()` runs once at app mount: hydrate via REST, then attach
 *     SSE for live deltas. Reconnect on visibilitychange.
 *   - `disconnect()` clears the SSE subscription.
 *   - Status mutations (read / archive / delete) update local state
 *     optimistically AND fire-and-forget the REST call; on failure,
 *     we roll back + surface an error.
 */

import { create } from 'zustand';
import {
  archiveNotification as archiveRemote,
  deleteNotification as deleteRemote,
  listNotifications,
  markAllNotificationsRead as markAllRemote,
  markNotificationRead as markReadRemote,
  markNotificationUnread as markUnreadRemote,
  subscribeToNotifications,
} from './notificationsClient.js';
import type { Notification, NotificationStatus } from './types.js';

interface NotificationStoreState {
  notifications: Notification[];
  unreadCount: number;
  panelOpen: boolean;
  loading: boolean;
  connected: boolean;
  error: string | null;
  /** Active SSE cleanup, if any. */
  _sseCleanup: (() => void) | null;
}

interface NotificationStoreActions {
  // Lifecycle
  connect: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;

  // UI
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  // Mutations
  markAsRead: (id: string) => Promise<void>;
  markAsUnread: (id: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;

  // Internal — called by SSE handler
  _ingest: (n: Notification) => void;
}

type NotificationStore = NotificationStoreState & NotificationStoreActions;

function recountUnread(list: Notification[]): number {
  return list.filter((n) => n.status === 'unread').length;
}

function applyStatus(list: Notification[], id: string, status: NotificationStatus, now: string): Notification[] {
  return list.map((n) => {
    if (n.notificationId !== id) return n;
    return {
      ...n,
      status,
      ...(status === 'read' && !n.readAt ? { readAt: now } : {}),
      ...(status === 'archived' && !n.archivedAt ? { archivedAt: now } : {}),
      ...(status === 'unread' ? { readAt: undefined } : {}),
    };
  });
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  panelOpen: false,
  loading: false,
  connected: false,
  error: null,
  _sseCleanup: null,

  async connect() {
    if (get().connected) return;
    set({ loading: true, error: null });
    try {
      const list = await listNotifications({ limit: 100 });
      set({
        notifications: [...list],
        unreadCount: recountUnread([...list]),
        loading: false,
        connected: true,
      });
      // Attach SSE after hydrate. Reconnect on reconnect.
      const cleanup = subscribeToNotifications((n) => get()._ingest(n));
      set({ _sseCleanup: cleanup });
    } catch (err) {
      set({
        loading: false,
        connected: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  disconnect() {
    const c = get()._sseCleanup;
    if (c) c();
    set({ _sseCleanup: null, connected: false });
  },

  async refresh() {
    try {
      const list = await listNotifications({ limit: 100 });
      set({
        notifications: [...list],
        unreadCount: recountUnread([...list]),
        error: null,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  openPanel() { set({ panelOpen: true }); },
  closePanel() { set({ panelOpen: false }); },
  togglePanel() { set((s) => ({ panelOpen: !s.panelOpen })); },

  async markAsRead(id) {
    const prev = get().notifications;
    const next = applyStatus(prev, id, 'read', new Date().toISOString());
    set({ notifications: next, unreadCount: recountUnread(next) });
    try { await markReadRemote(id); } catch (err) {
      set({ notifications: prev, unreadCount: recountUnread(prev),
            error: err instanceof Error ? err.message : String(err) });
    }
  },

  async markAsUnread(id) {
    const prev = get().notifications;
    const next = applyStatus(prev, id, 'unread', new Date().toISOString());
    set({ notifications: next, unreadCount: recountUnread(next) });
    try { await markUnreadRemote(id); } catch (err) {
      set({ notifications: prev, unreadCount: recountUnread(prev),
            error: err instanceof Error ? err.message : String(err) });
    }
  },

  async archive(id) {
    const prev = get().notifications;
    const next = applyStatus(prev, id, 'archived', new Date().toISOString());
    set({ notifications: next, unreadCount: recountUnread(next) });
    try { await archiveRemote(id); } catch (err) {
      set({ notifications: prev, unreadCount: recountUnread(prev),
            error: err instanceof Error ? err.message : String(err) });
    }
  },

  async delete(id) {
    const prev = get().notifications;
    const next = prev.filter((n) => n.notificationId !== id);
    set({ notifications: next, unreadCount: recountUnread(next) });
    try { await deleteRemote(id); } catch (err) {
      set({ notifications: prev, unreadCount: recountUnread(prev),
            error: err instanceof Error ? err.message : String(err) });
    }
  },

  async markAllRead() {
    const prev = get().notifications;
    const now = new Date().toISOString();
    const next = prev.map((n) => n.status === 'unread'
      ? { ...n, status: 'read' as NotificationStatus, readAt: n.readAt ?? now }
      : n);
    set({ notifications: next, unreadCount: 0 });
    try { await markAllRemote(); } catch (err) {
      set({ notifications: prev, unreadCount: recountUnread(prev),
            error: err instanceof Error ? err.message : String(err) });
    }
  },

  _ingest(n) {
    set((s) => {
      // De-dupe: SSE can re-deliver if the client reconnects. The BE
      // assigns a stable `notificationId`, so an existing row wins.
      if (s.notifications.some((x) => x.notificationId === n.notificationId)) return s;
      const next = [n, ...s.notifications];
      return { notifications: next, unreadCount: recountUnread(next) };
    });
  },
}));

/** Convenience hook for the bell badge. */
export function useUnreadCount(): number {
  return useNotificationStore((s) => s.unreadCount);
}
