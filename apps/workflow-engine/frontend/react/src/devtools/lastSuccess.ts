/**
 * Tracks when we last got a successful response from the openwop
 * backend. The chat-tab cold-start card reads this to decide
 * whether to open with "warm" copy (recent success → assume the
 * Cloud Run container is still alive) or "cold" copy (no recent
 * success → assume the container was evicted and we're cold-starting).
 *
 * Persisted to localStorage so the prediction survives a tab close.
 *
 * The network recorder calls `recordLastSuccess()` on every 2xx
 * response that hits the OpenWOP backend; the card reads
 * `getLastSuccessAt()` on mount to choose its initial phase.
 *
 * Cloud Run evicts cpu=1 containers after ~15 minutes of no traffic
 * (with `min-instances=0`), so the "warm" window we trust is ~5
 * minutes — generous enough to cover quick tab-switches, tight
 * enough to bias toward the honest cold-start copy when the user
 * comes back from a long break.
 */

const LS_KEY = 'openwop.sample.lastSuccessAt';
/** Window (ms) inside which we trust the BE is still warm. */
export const WARM_WINDOW_MS = 5 * 60 * 1000;

export function recordLastSuccess(now: number = Date.now()): void {
  try {
    localStorage.setItem(LS_KEY, String(now));
  } catch {
    /* over-quota / private mode — silently degrade to "no signal" */
  }
}

/** Returns the recorded epoch ms or null if never recorded / unreadable. */
export function getLastSuccessAt(): number | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** True when a successful call landed within the warm window. */
export function predictWarm(now: number = Date.now()): boolean {
  const last = getLastSuccessAt();
  if (last === null) return false;
  return now - last < WARM_WINDOW_MS;
}
