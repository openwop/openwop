/**
 * Notification preferences — loading, persistence, and the
 * "should this notification fire a desktop toast?" predicate.
 *
 * Storage: localStorage under `openwop:notification-prefs:v1`. No BE
 * round-trip — the app is a single-tab demo today; preferences live
 * with the FE session. If a future multi-device story arrives, fold
 * this into a BE endpoint backed by the existing notifications table.
 *
 * Predicate composition (in order):
 *   1. globalMute → suppress everything
 *   2. per-type muted → suppress this type
 *   3. per-type desktop=false → suppress OS toast (in-app still fires)
 *   4. quiet hours active → suppress unless `allowUrgent` + urgent
 */

import { defaultPreferences, type Notification, type NotificationPreferences } from './types.js';

const STORAGE_KEY = 'openwop:notification-prefs:v1';

/** Load preferences from localStorage, or return defaults if absent /
 *  malformed. Defensive parse — a corrupted blob shouldn't crash boot. */
export function loadPreferences(): NotificationPreferences {
  if (typeof window === 'undefined') return defaultPreferences();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPreferences();
    const parsed: unknown = JSON.parse(raw);
    if (!isPreferences(parsed)) return defaultPreferences();
    return parsed;
  } catch {
    return defaultPreferences();
  }
}

/** Persist preferences. Best-effort — quota errors swallowed since the
 *  in-memory store is the authoritative copy for the session. */
export function savePreferences(prefs: NotificationPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage full or disabled — preferences won't survive reload */
  }
}

/** Should this notification fire an OS-level desktop toast?
 *
 *  Returns true only if all four gates pass: not globalMuted, type-
 *  specific not muted, type-specific desktop=true, not in quiet hours
 *  (unless allowUrgent + urgent). Called from `notificationStore`
 *  `_ingest` before `fireDesktopNotification`.
 */
export function shouldFireDesktop(
  notification: Notification,
  prefs: NotificationPreferences,
  now: Date = new Date(),
): boolean {
  if (prefs.globalMute) return false;
  const typePref = prefs.types.find((t) => t.type === notification.type);
  if (typePref?.muted) return false;
  if (typePref && !typePref.desktop) return false;
  if (isInQuietHours(prefs.quietHours, now)) {
    if (notification.priority === 'urgent' && prefs.quietHours.allowUrgent) {
      return true;
    }
    return false;
  }
  return true;
}

/** Should this notification count toward the unread badge?
 *  Muted types still SHOW in the panel (so the user can find them
 *  later) but don't bump the badge. Mirrors the myndhyve pattern. */
export function shouldCountUnread(
  notification: Notification,
  prefs: NotificationPreferences,
): boolean {
  if (prefs.globalMute) return false;
  const typePref = prefs.types.find((t) => t.type === notification.type);
  if (typePref?.muted) return false;
  return true;
}

/** True when `now` falls inside the configured quiet-hours window. */
export function isInQuietHours(q: NotificationPreferences['quietHours'], now: Date): boolean {
  if (!q.enabled) return false;
  const day = now.getDay();
  if (!q.days.includes(day)) return false;
  const [startH, startM] = q.start.split(':').map((s) => Number(s));
  const [endH, endM] = q.end.split(':').map((s) => Number(s));
  if ([startH, startM, endH, endM].some((n) => Number.isNaN(n))) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = (startH ?? 0) * 60 + (startM ?? 0);
  const endMin = (endH ?? 0) * 60 + (endM ?? 0);
  // Overnight window (e.g., 22:00 → 08:00 next day)
  if (startMin > endMin) {
    return nowMin >= startMin || nowMin < endMin;
  }
  return nowMin >= startMin && nowMin < endMin;
}

// ─── runtime type guards ───────────────────────────────────────────

function isPreferences(v: unknown): v is NotificationPreferences {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (r.version !== 1) return false;
  if (typeof r.globalMute !== 'boolean') return false;
  if (!Array.isArray(r.types)) return false;
  if (!isQuietHours(r.quietHours)) return false;
  return r.types.every(isTypePref);
}

function isTypePref(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.type === 'string' && typeof r.muted === 'boolean' && typeof r.desktop === 'boolean';
}

function isQuietHours(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.enabled === 'boolean'
    && typeof r.start === 'string'
    && typeof r.end === 'string'
    && Array.isArray(r.days)
    && typeof r.allowUrgent === 'boolean';
}
