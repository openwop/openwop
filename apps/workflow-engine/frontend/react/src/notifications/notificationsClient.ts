/**
 * Thin HTTP client for the notification routes registered in
 * `apps/workflow-engine/backend/typescript/src/routes/notifications.ts`.
 *
 * Mirrors the conventions of `runsClient.ts` / `interruptsClient.ts`:
 *   - re-uses `authedHeaders()` + `fetchOpts()` from config so all auth
 *     modes (bearer / cookie) flip via the same env knob
 *   - throws on non-2xx so callers can surface errors via React state
 */

import { authedHeaders, config, fetchOpts } from '../client/config.js';
import type { Notification, NotificationStatus } from './types.js';

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, fetchOpts({
    ...init,
    headers: { ...authedHeaders(), ...(init?.headers ?? {}) },
  }));
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface ListNotificationsParams {
  status?: NotificationStatus | readonly NotificationStatus[];
  includeArchived?: boolean;
  limit?: number;
}

export async function listNotifications(
  params: ListNotificationsParams = {},
): Promise<readonly Notification[]> {
  const q = new URLSearchParams();
  if (params.status) {
    const s = Array.isArray(params.status) ? params.status.join(',') : (params.status as string);
    q.set('status', s);
  }
  if (params.includeArchived) q.set('includeArchived', 'true');
  if (params.limit != null) q.set('limit', String(params.limit));
  const qs = q.toString();
  const body = await jsonFetch<{ notifications: Notification[] }>(
    `/v1/notifications${qs ? `?${qs}` : ''}`,
  );
  return body.notifications;
}

export async function markNotificationRead(notificationId: string): Promise<Notification> {
  return jsonFetch<Notification>(
    `/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'POST' },
  );
}

export async function markNotificationUnread(notificationId: string): Promise<Notification> {
  return jsonFetch<Notification>(
    `/v1/notifications/${encodeURIComponent(notificationId)}/unread`,
    { method: 'POST' },
  );
}

export async function archiveNotification(notificationId: string): Promise<Notification> {
  return jsonFetch<Notification>(
    `/v1/notifications/${encodeURIComponent(notificationId)}/archive`,
    { method: 'POST' },
  );
}

export async function deleteNotification(notificationId: string): Promise<void> {
  const res = await fetch(
    `${config.baseUrl}/v1/notifications/${encodeURIComponent(notificationId)}`,
    fetchOpts({ method: 'DELETE', headers: authedHeaders() }),
  );
  if (!res.ok) throw new Error(`delete returned ${res.status}`);
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return jsonFetch<{ updated: number }>(
    `/v1/notifications:mark-all-read`,
    { method: 'POST' },
  );
}

/** Subscribe to live notification events via SSE. Returns a cleanup. */
export function subscribeToNotifications(
  onNotification: (n: Notification) => void,
): () => void {
  // Use the dedicated SSE base URL when set — same rationale as the
  // run-event stream: the Firebase Hosting proxy on the prod deploy
  // buffers SSE responses, so we hit Cloud Run directly.
  const url = `${config.sseBaseUrl}/v1/notifications/stream`;
  // EventSource doesn't carry custom headers in browsers, so this
  // works for cookie-auth mode out of the box. Bearer-auth mode (local
  // dev + the conformance harness) falls back to polling — the panel
  // already does a refresh on focus + every 60s.
  let es: EventSource | null = null;
  try {
    es = new EventSource(url, { withCredentials: config.authMode === 'cookie' });
  } catch {
    return () => { /* never connected */ };
  }
  const handler = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as Notification;
      onNotification(data);
    } catch {
      /* skip malformed frame */
    }
  };
  es.addEventListener('notification', handler);
  return () => {
    if (!es) return;
    es.removeEventListener('notification', handler);
    es.close();
  };
}
