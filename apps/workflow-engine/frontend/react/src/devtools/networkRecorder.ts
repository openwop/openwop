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
 * - Only captures requests routed through `fetch`. SSE streams via
 *   `subscribeToRun` use fetch + ReadableStream so they're captured
 *   too (we record the initial fetch; SSE events themselves stream
 *   through a separate hook below).
 * - Request bodies are recorded only when JSON-ish (avoids logging
 *   binary uploads). Response bodies are truncated to 16KB to keep
 *   localStorage / memory bounded.
 * - The buffer is in-memory only (lost on reload). A future commit
 *   could persist the last N to sessionStorage if the user wants a
 *   record across hot-reloads.
 *
 * Disable in production builds via VITE_DISABLE_NETWORK_RECORDER=1.
 */

import { recordLastSuccess } from './lastSuccess.js';
import { config as backendConfig } from '../client/config.js';

const MAX_ENTRIES = 200;
const MAX_RESPONSE_BYTES = 16 * 1024;

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

function notify(): void {
  const snapshot = entries.slice();
  for (const l of listeners) {
    try { l(snapshot); } catch { /* ignore listener errors */ }
  }
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
