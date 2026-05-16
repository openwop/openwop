/**
 * SSE stream client.
 *
 * Uses native EventSource with auto Last-Event-ID resume on reconnect
 * (built into the spec). The browser's EventSource object reconnects
 * automatically on transport failure and replays Last-Event-ID for us.
 *
 * EventSource doesn't support custom headers — auth via query param or
 * a token-in-cookie pattern. The sample uses query-param auth via
 * `?token=` for simplicity. Real deployers wire a session cookie.
 */

import type { RunEventDoc, StreamMode } from '@openwop/openwop';
import { config } from './config.js';

export interface SubscribeOptions {
  modes?: readonly StreamMode[];
  onEvent: (event: RunEventDoc) => void;
  onError?: (err: Event) => void;
  onClose?: () => void;
}

export interface Subscription {
  close(): void;
}

export function subscribeToRun(runId: string, opts: SubscribeOptions): Subscription {
  const url = new URL(`${config.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`);
  if (opts.modes && opts.modes.length > 0) {
    url.searchParams.set('mode', opts.modes.join(','));
  }
  // Sample auth via query string. The BE's auth middleware reads the
  // Authorization header for normal routes; for SSE we bypass that here
  // and rely on the route exemption pattern used by EventSource.
  url.searchParams.set('apiKey', config.apiKey);

  const es = new EventSource(url.toString());

  // Generic listener catches every typed event the BE emits via SSE
  // `event:` field. EventSource fires named events on `addEventListener`
  // and falls back to `onmessage` for unnamed events; the BE sends
  // every line with an `event:` field so addEventListener('*' won't
  // catch them. We listen to a hard-coded set of canonical openwop
  // event types.
  const eventTypes = [
    'run.started',
    'run.resumed',
    'run.completed',
    'run.failed',
    'run.cancelled',
    'node.started',
    'node.completed',
    'node.failed',
    'node.suspended',
    'node.interrupt.resolved',
    'node.message',
  ];
  const handler = (raw: MessageEvent) => {
    try {
      const parsed = JSON.parse(raw.data) as RunEventDoc;
      opts.onEvent(parsed);
    } catch {
      /* swallow malformed event */
    }
  };
  for (const type of eventTypes) {
    es.addEventListener(type, handler as EventListener);
  }

  // Default unnamed-event handler too, in case the BE drops the event: field.
  es.onmessage = handler;

  // EventSource fires `onerror` on every connection close — including
  // the totally-expected close after a terminal event AND React
  // StrictMode's effect-cleanup-then-remount double-dispatch in dev.
  // Only treat OPEN-state errors as user-visible failures. CLOSED means
  // the server hung up cleanly (we've already received the terminal
  // event, or we deliberately closed the subscription). CONNECTING
  // means transient — the browser will auto-reconnect with Last-Event-ID.
  let manuallyClosed = false;
  es.onerror = () => {
    if (manuallyClosed) return;
    if (es.readyState === EventSource.CLOSED) {
      // Stop the auto-reconnect loop on a clean server close.
      es.close();
      opts.onClose?.();
      return;
    }
    // readyState === CONNECTING (0) → transient; browser handles reconnect.
    // readyState === OPEN (1) → genuine mid-stream error worth surfacing.
    if (es.readyState === EventSource.OPEN && opts.onError) {
      const dummyEvent = new Event('error');
      opts.onError(dummyEvent);
    }
  };

  return {
    close() {
      manuallyClosed = true;
      es.close();
      opts.onClose?.();
    },
  };
}
