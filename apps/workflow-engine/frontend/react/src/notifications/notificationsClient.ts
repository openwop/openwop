/**
 * Thin HTTP client for the notification routes at
 * `/v1/host/sample/notifications/*`.
 *
 * Mirrors the conventions of `runsClient.ts` / `interruptsClient.ts`:
 *   - re-uses `authedHeaders()` + `fetchOpts()` from config so all auth
 *     modes (bearer / cookie) flip via the same env knob
 *   - throws on non-2xx so callers can surface errors via React state
 *
 * Response shapes are validated at the boundary via `isNotification` —
 * a hand-written type guard rather than a runtime-validation library,
 * so the FE stays zero-dep on `zod` / `valibot`. The guard rejects
 * malformed BE payloads instead of casting blindly, so downstream
 * UI code can assume the shape it claims.
 */

import { authedHeaders, config, fetchOpts } from '../client/config.js';
import type { Notification, NotificationPriority, NotificationStatus } from './types.js';

const VALID_STATUSES: readonly NotificationStatus[] = ['unread', 'read', 'archived'];
const VALID_PRIORITIES: readonly NotificationPriority[] = ['low', 'normal', 'high', 'urgent'];

/** Runtime type guard for a Notification wire object. Rejects payloads
 *  with the wrong shape, unknown status/priority, or missing required
 *  fields. Used at every REST + SSE boundary. */
export function isNotification(x: unknown): x is Notification {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  if (typeof r.notificationId !== 'string') return false;
  if (typeof r.type !== 'string') return false;
  if (typeof r.title !== 'string') return false;
  if (typeof r.message !== 'string') return false;
  if (typeof r.createdAt !== 'string') return false;
  if (typeof r.status !== 'string' || !(VALID_STATUSES as readonly string[]).includes(r.status)) return false;
  if (typeof r.priority !== 'string' || !(VALID_PRIORITIES as readonly string[]).includes(r.priority)) return false;
  return true;
}

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
  const body = await jsonFetch<{ notifications: unknown }>(
    `/v1/host/sample/notifications${qs ? `?${qs}` : ''}`,
  );
  if (!Array.isArray(body.notifications)) return [];
  // Drop any rows the BE returned in an unexpected shape (forward-
  // compatibility — a new BE that adds a status the FE doesn't yet
  // recognize just hides the row instead of crashing the panel).
  return body.notifications.filter(isNotification);
}

async function mutateAndValidate(path: string, method: 'POST' | 'DELETE' = 'POST'): Promise<Notification> {
  const body = await jsonFetch<unknown>(path, { method });
  if (!isNotification(body)) {
    throw new Error(`${path} returned a malformed notification payload`);
  }
  return body;
}

export async function markNotificationRead(notificationId: string): Promise<Notification> {
  return mutateAndValidate(
    `/v1/host/sample/notifications/${encodeURIComponent(notificationId)}/read`,
  );
}

export async function markNotificationUnread(notificationId: string): Promise<Notification> {
  return mutateAndValidate(
    `/v1/host/sample/notifications/${encodeURIComponent(notificationId)}/unread`,
  );
}

export async function archiveNotification(notificationId: string): Promise<Notification> {
  return mutateAndValidate(
    `/v1/host/sample/notifications/${encodeURIComponent(notificationId)}/archive`,
  );
}

export async function deleteNotification(notificationId: string): Promise<void> {
  const res = await fetch(
    `${config.baseUrl}/v1/host/sample/notifications/${encodeURIComponent(notificationId)}`,
    fetchOpts({ method: 'DELETE', headers: authedHeaders() }),
  );
  if (!res.ok) throw new Error(`delete returned ${res.status}`);
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return jsonFetch<{ updated: number }>(
    `/v1/host/sample/notifications:mark-all-read`,
    { method: 'POST' },
  );
}

/**
 * Subscribe to live notification events via SSE. Returns a cleanup.
 *
 * `onError` fires on EventSource error events (network drop, BE 5xx,
 * proxy hangup) — the store uses this to surface a "stale feed" state
 * so the UI can show a reconnect chip rather than silently going dark.
 * EventSource auto-reconnects, so onError doubles as a "we're trying"
 * signal rather than a terminal failure.
 */
export function subscribeToNotifications(
  onNotification: (n: Notification) => void,
  onError?: () => void,
): () => void {
  // Use the dedicated SSE base URL when set — same rationale as the
  // run-event stream: the Firebase Hosting proxy on the prod deploy
  // buffers SSE responses, so we hit Cloud Run directly.
  const url = `${config.sseBaseUrl}/v1/host/sample/notifications/stream`;
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
  const messageHandler = (e: MessageEvent) => {
    try {
      const data: unknown = JSON.parse(e.data);
      if (isNotification(data)) onNotification(data);
      // Silently drop malformed frames — a forward-compat row the FE
      // doesn't recognize shouldn't crash the SSE consumer.
    } catch {
      /* skip malformed frame */
    }
  };
  const errorHandler = () => {
    if (onError) onError();
  };
  es.addEventListener('notification', messageHandler);
  es.addEventListener('error', errorHandler);
  return () => {
    if (!es) return;
    es.removeEventListener('notification', messageHandler);
    es.removeEventListener('error', errorHandler);
    es.close();
  };
}
