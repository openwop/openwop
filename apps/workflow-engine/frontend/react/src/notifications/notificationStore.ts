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

/**
 * Live SSE connection status, surfaced to the UI so the bell / panel
 * can show a "reconnecting" chip when the stream drops. EventSource
 * auto-reconnects in browsers, so `error` is transient — a fresh
 * `notification` event flips us back to `connected`.
 */
export type NotificationConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Browser-side desktop notification permission, mirroring the Web
 * Notifications API's `Notification.permission` value. We track this
 * in the store so the UI can show an "Enable desktop alerts" button
 * when `'default'`, a "Blocked by browser" hint when `'denied'`, and
 * hide the affordance when `'granted'`.
 *
 * `'unsupported'` is the SSR / non-browser path — older Safari + any
 * environment where `window.Notification` is undefined.
 */
export type DesktopPermission = 'default' | 'granted' | 'denied' | 'unsupported';

interface NotificationStoreState {
  notifications: Notification[];
  unreadCount: number;
  panelOpen: boolean;
  loading: boolean;
  connectionStatus: NotificationConnectionStatus;
  desktopPermission: DesktopPermission;
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

  // Desktop notifications (Web Notifications API)
  /** Prompt the browser for desktop-notification permission. MUST be
   *  called inside a user gesture (click handler) — browsers reject
   *  programmatic permission requests outside that context. Returns
   *  the resulting permission state. */
  requestDesktopPermission: () => Promise<DesktopPermission>;
  /** Refresh `desktopPermission` from `window.Notification.permission`.
   *  Used at mount so the store reflects the browser's persisted state
   *  (the user may have granted in a prior session). */
  syncDesktopPermission: () => void;

  // Internal — called by SSE handler
  _ingest: (n: Notification) => void;
}

type NotificationStore = NotificationStoreState & NotificationStoreActions;

function recountUnread(list: Notification[]): number {
  return list.filter((n) => n.status === 'unread').length;
}

/**
 * Read the current desktop-notification permission from the browser,
 * normalized to our `DesktopPermission` union. Returns `'unsupported'`
 * when `window.Notification` is missing (SSR, very-old Safari, headless
 * test envs).
 */
function readDesktopPermission(): DesktopPermission {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    return 'unsupported';
  }
  // `Notification.permission` is exactly the three values we want.
  const p = window.Notification.permission;
  if (p === 'granted' || p === 'denied') return p;
  return 'default';
}

/**
 * Fire an OS-level desktop toast for an in-app notification.
 *
 * Uses the Web Notifications API — gated on `permission === 'granted'`.
 * `tag` is set to the notificationId so the same row arriving twice
 * (SSE reconnect + REST refresh racing) only surfaces one OS toast.
 * Click-through navigates the focused window to `actionUrl` so users
 * can resume an approval flow without hunting through the panel.
 *
 * Best-effort: any browser API failure (some Chromium variants reject
 * notifications in cross-origin frames) is swallowed — the in-app
 * surface still works regardless.
 */
function fireDesktopNotification(n: Notification): void {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return;
  if (window.Notification.permission !== 'granted') return;
  try {
    const desktop = new window.Notification(n.title, {
      body: n.message,
      tag: n.notificationId,
      icon: '/OpenWOP.svg',
      // Urgent rows keep the toast on screen until the user dismisses.
      // Browsers ignore this for non-urgent — fine, the default 5s
      // auto-dismiss is the right behavior for low-priority rows.
      requireInteraction: n.priority === 'urgent',
    });
    desktop.onclick = () => {
      window.focus();
      if (n.actionUrl) {
        // History API navigation rather than location.href so we don't
        // do a full page reload when the SPA is already loaded.
        try { window.history.pushState({}, '', n.actionUrl); }
        catch { window.location.href = n.actionUrl; }
      }
      desktop.close();
    };
  } catch {
    /* defense-in-depth — browser API rejection shouldn't break the feed */
  }
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
  connectionStatus: 'disconnected',
  desktopPermission: readDesktopPermission(),
  error: null,
  _sseCleanup: null,

  async connect() {
    if (get().connectionStatus === 'connected' || get().connectionStatus === 'connecting') return;
    set({ loading: true, connectionStatus: 'connecting', error: null });
    try {
      const list = await listNotifications({ limit: 100 });
      set({
        notifications: [...list],
        unreadCount: recountUnread([...list]),
        loading: false,
        connectionStatus: 'connected',
      });
      // Attach SSE after hydrate. EventSource auto-reconnects on
      // network blips, so a transient `error` flip doesn't mean the
      // feed is dead — fresh frames will roll the status back to
      // `connected` via _ingest.
      const cleanup = subscribeToNotifications(
        (n) => {
          get()._ingest(n);
          if (get().connectionStatus !== 'connected') {
            set({ connectionStatus: 'connected' });
          }
        },
        () => set({ connectionStatus: 'error' }),
      );
      set({ _sseCleanup: cleanup });
    } catch (err) {
      set({
        loading: false,
        connectionStatus: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  disconnect() {
    const c = get()._sseCleanup;
    if (c) c();
    set({ _sseCleanup: null, connectionStatus: 'disconnected' });
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
    const next: Notification[] = prev.map((n) => n.status === 'unread'
      ? { ...n, status: 'read', readAt: n.readAt ?? now }
      : n);
    set({ notifications: next, unreadCount: 0 });
    try { await markAllRemote(); } catch (err) {
      set({ notifications: prev, unreadCount: recountUnread(prev),
            error: err instanceof Error ? err.message : String(err) });
    }
  },

  async requestDesktopPermission() {
    // The browser permission prompt MUST be called inside a user
    // gesture (click handler). Calling this from a `useEffect` on
    // mount will return 'denied' permanently on most browsers — the
    // panel's "Enable desktop alerts" button is the supported path.
    if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
      set({ desktopPermission: 'unsupported' });
      return 'unsupported';
    }
    try {
      const result = await window.Notification.requestPermission();
      const normalized: DesktopPermission =
        result === 'granted' || result === 'denied' ? result : 'default';
      set({ desktopPermission: normalized });
      return normalized;
    } catch {
      // Some browsers throw if called outside a gesture; treat as denied.
      set({ desktopPermission: 'denied' });
      return 'denied';
    }
  },

  syncDesktopPermission() {
    set({ desktopPermission: readDesktopPermission() });
  },

  _ingest(n) {
    let isNew = false;
    set((s) => {
      // De-dupe: SSE can re-deliver if the client reconnects. The BE
      // assigns a stable `notificationId`, so an existing row wins.
      if (s.notifications.some((x) => x.notificationId === n.notificationId)) return s;
      isNew = true;
      const next = [n, ...s.notifications];
      return { notifications: next, unreadCount: recountUnread(next) };
    });
    // Fire the OS toast only for genuinely-new unread rows. Skip
    // already-read rows (they shouldn't usually arrive via SSE, but
    // the BE could replay) and dupes. Permission gating happens
    // inside `fireDesktopNotification` so this stays a single call
    // site regardless of permission state.
    if (isNew && n.status === 'unread') {
      fireDesktopNotification(n);
    }
  },
}));

/** Convenience hook for the bell badge. */
export function useUnreadCount(): number {
  return useNotificationStore((s) => s.unreadCount);
}
