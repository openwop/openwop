/**
 * In-process network recorder for the sample app.
 *
 * Wraps `window.fetch` once at app boot and captures every backend
 * call (REST + SSE) into a bounded in-memory ring buffer. The
 * NetworkPanel component subscribes to the recorder and renders a
 * Chrome-DevTools-style list scoped to OpenWOP traffic — give users
 * a way to see the wire-shape behind the AI chat / builder / keys
 * pages without opening DevTools.
 *
 * Scope notes:
 * - Only captures requests routed through `fetch`. In **bearer-mode**,
 *   `subscribeToRun` routes through the SDK's `streamEvents()` which is
 *   fetch + ReadableStream, so the initial subscribe is captured (the
 *   long-lived stream's individual events are not surfaced through the
 *   fetch hook — they're observable separately via a `subscribeToRun`
 *   callback if a downstream component wires that in). In **cookie-mode**,
 *   the same `subscribeToRun` falls back to native `EventSource` (since
 *   the SDK's `streamEvents` doesn't expose a fetch-credentials option to
 *   carry `openwop.session`), and EventSource subscribes are NOT captured
 *   by this recorder — they bypass fetch entirely.
 * - Request bodies are recorded only when JSON-ish (avoids logging
 *   binary uploads). Response bodies are truncated to 16KB to keep
 *   localStorage / memory bounded.
 * - The buffer survives reload: the last `PERSIST_MAX` entries are
 *   mirrored to `sessionStorage` (throttled, quota-safe, response bodies
 *   re-truncated to `PERSIST_RESPONSE_BYTES`) and rehydrated on boot, so a
 *   hot-reload or accidental refresh doesn't wipe the record. It stays
 *   tab-scoped (sessionStorage, not localStorage) so it doesn't outlive the
 *   session or leak across tabs.
 *
 * Disable in production builds via VITE_DISABLE_NETWORK_RECORDER=1.
 */

import { recordLastSuccess } from './lastSuccess.js';
import { config as backendConfig } from '../client/config.js';

const MAX_ENTRIES = 200;
const MAX_RESPONSE_BYTES = 16 * 1024;
const STORAGE_KEY = 'openwop.networkRecorder.v1';
const PERSIST_MAX = 50;
const PERSIST_RESPONSE_BYTES = 4 * 1024;

export type NetworkEntryKind = 'rest' | 'sse';

export interface NetworkEntry {
  id: string;
  method: string;
  url: string;
  /** Origin-relative path for tighter UI rendering. */
  path: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  status?: number;
  ok?: boolean;
  kind: NetworkEntryKind;
  requestBody?: string;
  responseBody?: string;
  responseTruncated?: boolean;
  error?: string;
  /** For SSE entries, captured event deltas appear here in order. */
  sseEvents?: Array<{ at: number; data: string }>;
}

type Listener = (entries: readonly NetworkEntry[]) => void;

const entries: NetworkEntry[] = [];
const listeners = new Set<Listener>();
let installed = false;

let persistScheduled = false;

function canPersist(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.sessionStorage;
  } catch {
    return false; // access can throw under strict privacy settings
  }
}

/** Mirror the tail of the buffer to sessionStorage, coalescing the burst of
 *  push+update calls in one tick into a single write. Quota-safe: on failure
 *  it drops the persisted copy rather than throwing into the fetch hook. */
function schedulePersist(): void {
  if (persistScheduled || !canPersist()) return;
  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;
    try {
      const trimmed = entries.slice(-PERSIST_MAX).map((e) =>
        e.responseBody && e.responseBody.length > PERSIST_RESPONSE_BYTES
          ? { ...e, responseBody: e.responseBody.slice(0, PERSIST_RESPONSE_BYTES), responseTruncated: true }
          : e,
      );
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // QuotaExceededError / serialization failure — discard the persisted
      // mirror; the in-memory buffer is the source of truth and is unaffected.
      try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, 0);
}

/** Rehydrate the buffer from sessionStorage on boot. No-op if the buffer
 *  already has entries (don't clobber a live session) or the persisted state
 *  is absent/corrupt. */
function hydrateFromStorage(): void {
  if (!canPersist() || entries.length > 0) return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const e of parsed as NetworkEntry[]) {
      if (e && typeof e.id === 'string' && typeof e.url === 'string') entries.push(e);
    }
  } catch {
    /* corrupt persisted state — ignore and start fresh */
  }
}

function notify(): void {
  const snapshot = entries.slice();
  for (const l of listeners) {
    try { l(snapshot); } catch { /* ignore listener errors */ }
  }
  schedulePersist();
}

function push(entry: NetworkEntry): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  notify();
}

function update(id: string, patch: Partial<NetworkEntry>): void {
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return;
  entries[idx] = { ...entries[idx]!, ...patch };
  notify();
}

function relativePath(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname + (u.search || '');
  } catch {
    return url;
  }
}

function bodyToString(body: BodyInit | null | undefined): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body.slice(0, 8 * 1024);
  // FormData / Blob / URLSearchParams / ReadableStream: skip; the
  // recorder is intentionally JSON-leaning for the sample.
  return undefined;
}

export function installNetworkRecorder(): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  // Allow opt-out via Vite env (set VITE_DISABLE_NETWORK_RECORDER=1).
  // Useful if a downstream embedding needs the unmodified fetch.
  if (
    typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_DISABLE_NETWORK_RECORDER === '1'
  ) {
    return;
  }
  installed = true;
  // Restore the prior session's tail so a reload/hot-reload keeps the record.
  hydrateFromStorage();
  if (entries.length > 0) notify();
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    // Only record traffic to OUR backend. The path filter alone
    // wasn't enough — third-party APIs (Firebase Auth's
    // identitytoolkit.googleapis.com/v1/accounts:lookup, etc.) share
    // the `/v1/` prefix and were being captured. Constrain by ORIGIN
    // first: same-origin OR the configured backend baseUrl.
    const path = relativePath(url);
    const isOpenwopOrigin = (() => {
      try {
        const u = new URL(url, window.location.origin);
        if (u.origin === window.location.origin) return true;
        if (backendConfig.baseUrl) {
          try {
            const b = new URL(backendConfig.baseUrl);
            if (u.origin === b.origin) return true;
          } catch { /* malformed baseUrl */ }
        }
        return false;
      } catch {
        return false;
      }
    })();
    const isApiPath = path.startsWith('/v1/') || path.startsWith('/.well-known/openwop') || path.startsWith('/api/');
    if (!isOpenwopOrigin || !isApiPath) {
      return nativeFetch(input, init);
    }

    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const requestBody = bodyToString(init?.body);
    const isSse = (init?.headers && new Headers(init.headers).get('accept')?.includes('text/event-stream')) === true
      || path.includes('/events') || path.includes(':stream');

    const entry: NetworkEntry = {
      id,
      method,
      url,
      path,
      startedAt,
      kind: isSse ? 'sse' : 'rest',
      ...(requestBody !== undefined ? { requestBody } : {}),
    };
    push(entry);

    try {
      const res = await nativeFetch(input, init);
      const finishedAt = Date.now();
      // Clone the response to read the body without consuming it for
      // the caller. SSE responses are streams — don't clone-read those
      // (it'd block until the stream ends).
      let responseBody: string | undefined;
      let responseTruncated = false;
      if (!isSse) {
        try {
          const clone = res.clone();
          const text = await clone.text();
          responseTruncated = text.length > MAX_RESPONSE_BYTES;
          responseBody = responseTruncated ? text.slice(0, MAX_RESPONSE_BYTES) : text;
        } catch {
          /* ignore read errors — the original response is unaffected */
        }
      }
      update(id, {
        finishedAt,
        durationMs: finishedAt - startedAt,
        status: res.status,
        ok: res.ok,
        ...(responseBody !== undefined ? { responseBody } : {}),
        ...(responseTruncated ? { responseTruncated } : {}),
      });
      // Mark the BE as alive for the cold-start-card warm-window
      // prediction. A 2xx anywhere on the OpenWOP API surface is
      // sufficient evidence the container is up. 401/403 still count
      // as "container alive" (auth refused, but server responded).
      if (res.status > 0 && res.status < 500) {
        recordLastSuccess(finishedAt);
      }
      return res;
    } catch (err) {
      const finishedAt = Date.now();
      update(id, {
        finishedAt,
        durationMs: finishedAt - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

export function listNetworkEntries(): readonly NetworkEntry[] {
  return entries;
}

export function clearNetworkEntries(): void {
  entries.length = 0;
  notify();
}

export function subscribeNetworkEntries(listener: Listener): () => void {
  listeners.add(listener);
  // Immediate snapshot so the consumer renders without waiting for
  // the next event.
  listener(entries.slice());
  return () => { listeners.delete(listener); };
}

/** Append an SSE event onto an in-flight entry. Used by the streams
 *  client wrapper so the network panel can show the event timeline
 *  inside the SSE row's detail view. */
export function appendSseEvent(requestUrl: string, data: string): void {
  // Find the most-recently-started SSE entry whose URL matches.
  // (We don't have a direct id link from the streams client; the
  // url-match heuristic is fine for the bounded buffer.)
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind !== 'sse' || e.url !== requestUrl) continue;
    if (e.finishedAt !== undefined) break; // closed; stop scanning
    const events = e.sseEvents ? [...e.sseEvents] : [];
    events.push({ at: Date.now(), data });
    entries[i] = { ...e, sseEvents: events };
    notify();
    break;
  }
}
