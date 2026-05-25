/**
 * SSE stream client.
 *
 * Dual-path subscription:
 *
 *   - **Bearer-mode** (`config.authMode === 'bearer'`) → routes through the
 *     published SDK's `streamEvents()` (fetch + ReadableStream — `sse.ts`).
 *     The SDK sets `Authorization: Bearer ${apiKey}` as a real header, which
 *     kills the prior `?apiKey=<key>` URL query-param security smell
 *     (URL-borne credentials leak to browser history, server logs, and
 *     shared screenshots). Reconnect-with-Last-Event-ID is implemented in
 *     this wrapper since the SDK's generator is single-shot.
 *
 *   - **Cookie-mode** (`config.authMode === 'cookie'`) → stays on native
 *     `EventSource` with `withCredentials: true`. The SDK's `streamEvents()`
 *     uses raw `fetch()` without exposing a `credentials: 'include'` option,
 *     so it can't carry the `openwop.session` cookie cross-origin. A future
 *     SDK enhancement that adds either a fetch-credentials option or a
 *     custom-fetch hook to `streamEvents()` would let this path migrate
 *     too; tracked in the comments below.
 *
 * Both paths preserve the same public API (`subscribeToRun`, `Subscription`,
 * dual idle/absolute timeouts) so the 5 consumer surfaces don't need to know
 * which transport they got.
 */

import { streamEvents, type RunEventDoc, type StreamMode } from '@openwop/openwop';
import { config } from './config.js';

export interface SubscribeOptions {
  modes?: readonly StreamMode[];
  onEvent: (event: RunEventDoc) => void;
  onError?: (err: Event) => void;
  onClose?: () => void;
  /** Dual-layer timeouts. Idle resets on each event arrival; absolute
   *  is a hard deadline that never resets. Either firing closes the
   *  subscription and invokes onTimeout. */
  idleTimeoutMs?: number;
  absoluteTimeoutMs?: number;
  onTimeout?: (kind: 'idle' | 'absolute') => void;
}

export interface Subscription {
  close(): void;
}

/** Maximum reconnect attempts the bearer-mode path makes before giving up.
 *  Each attempt re-sends `Last-Event-ID` so the server can resume from where
 *  the prior connection dropped (per the SSE spec). EventSource's native
 *  reconnect (used by cookie-mode) is unbounded; bounding bearer-mode keeps
 *  failed-network scenarios from looping forever. */
const MAX_RECONNECTS = 5;

export function subscribeToRun(runId: string, opts: SubscribeOptions): Subscription {
  // Dual-layer timeouts shared by both transports.
  const idleMs = opts.idleTimeoutMs ?? 30_000;
  const absoluteMs = opts.absoluteTimeoutMs ?? 120_000;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let absoluteTimer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  let manuallyClosed = false;

  function clearTimers(): void {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (absoluteTimer) { clearTimeout(absoluteTimer); absoluteTimer = null; }
  }

  function fireTimeout(kind: 'idle' | 'absolute', onAbort: () => void): void {
    if (timedOut) return;
    timedOut = true;
    clearTimers();
    onAbort();
    opts.onTimeout?.(kind);
  }

  function resetIdle(onAbort: () => void): void {
    if (timedOut) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fireTimeout('idle', onAbort), idleMs);
  }

  if (config.authMode === 'bearer') {
    return subscribeBearer(runId, opts, {
      idleMs, absoluteMs,
      onTimedOut: () => timedOut,
      onManuallyClosed: () => manuallyClosed,
      setManuallyClosed: (v) => { manuallyClosed = v; },
      clearTimers,
      resetIdle,
      armAbsolute: (onAbort) => {
        absoluteTimer = setTimeout(() => fireTimeout('absolute', onAbort), absoluteMs);
      },
    });
  }

  // Cookie-mode path — native EventSource with withCredentials.
  return subscribeCookie(runId, opts, {
    onTimedOut: () => timedOut,
    onManuallyClosed: () => manuallyClosed,
    setManuallyClosed: (v) => { manuallyClosed = v; },
    clearTimers,
    resetIdle,
    armAbsolute: (onAbort) => {
      absoluteTimer = setTimeout(() => fireTimeout('absolute', onAbort), absoluteMs);
    },
  });
}

/** Shared timer wiring passed from `subscribeToRun` to the transport-specific
 *  subscribe implementations. Keeps both paths honest about idle/absolute
 *  behavior without duplicating the timer state. */
interface TimerHooks {
  onTimedOut: () => boolean;
  onManuallyClosed: () => boolean;
  setManuallyClosed: (v: boolean) => void;
  clearTimers: () => void;
  resetIdle: (onAbort: () => void) => void;
  armAbsolute: (onAbort: () => void) => void;
}

/** Bearer-mode subscribe — uses the SDK's fetch-based `streamEvents()`.
 *  Reconnects with `Last-Event-ID` on transient errors up to MAX_RECONNECTS;
 *  surface fatal errors via `opts.onError`. */
function subscribeBearer(
  runId: string,
  opts: SubscribeOptions,
  hooks: Pick<TimerHooks, 'onTimedOut' | 'onManuallyClosed' | 'setManuallyClosed' | 'clearTimers' | 'resetIdle' | 'armAbsolute'> & { idleMs: number; absoluteMs: number },
): Subscription {
  const abort = new AbortController();
  let lastEventId: string | undefined;
  let attempt = 0;

  const onAbort = (): void => abort.abort();
  hooks.armAbsolute(onAbort);
  hooks.resetIdle(onAbort);

  void (async () => {
    while (!hooks.onTimedOut() && !hooks.onManuallyClosed() && attempt <= MAX_RECONNECTS) {
      try {
        const modeOpt: StreamMode | readonly StreamMode[] | undefined =
          opts.modes && opts.modes.length > 0
            ? (opts.modes.length === 1 ? opts.modes[0]! : opts.modes)
            : undefined;
        // The SDK takes a single ctx + opts; pass the SSE-specific baseUrl
        // (`sseBaseUrl` bypasses the Firebase Hosting `/api/**` proxy which
        // buffers and breaks long-lived streams — see `config.ts`).
        const generator = streamEvents(
          { baseUrl: config.sseBaseUrl, apiKey: config.apiKey },
          runId,
          {
            ...(modeOpt !== undefined ? { streamMode: modeOpt } : {}),
            ...(lastEventId !== undefined ? { lastEventId } : {}),
            signal: abort.signal,
          },
        );
        for await (const ev of generator) {
          if (hooks.onTimedOut() || hooks.onManuallyClosed()) return;
          hooks.resetIdle(onAbort);
          // SDK doesn't surface the raw `id:` field on each yield, so we
          // can't update Last-Event-ID precisely between events for the
          // reconnect path. Fall back to the event's sequence — every
          // openwop RunEventDoc carries `sequence` which the BE accepts
          // as a Last-Event-ID equivalent for resume.
          if (typeof ev.sequence === 'number') {
            lastEventId = String(ev.sequence);
          }
          opts.onEvent(ev);
        }
        // Generator exhausted cleanly (server FIN after terminal event).
        hooks.clearTimers();
        if (!hooks.onManuallyClosed()) opts.onClose?.();
        return;
      } catch (err) {
        if (hooks.onManuallyClosed() || hooks.onTimedOut()) {
          hooks.clearTimers();
          return;
        }
        attempt += 1;
        if (attempt > MAX_RECONNECTS) {
          hooks.clearTimers();
          if (opts.onError) {
            const ev = new Event('error');
            opts.onError(ev);
          }
          return;
        }
        // Linear backoff: 500ms × attempt. Keeps reconnect tight while not
        // hammering the server during sustained outages.
        await new Promise((r) => setTimeout(r, 500 * attempt));
        // Loop and re-subscribe with the recorded Last-Event-ID. The SDK
        // generator can't be re-entered, so we construct a fresh one each
        // iteration.
        void err;
      }
    }
  })();

  return {
    close() {
      hooks.setManuallyClosed(true);
      hooks.clearTimers();
      abort.abort();
      opts.onClose?.();
    },
  };
}

/** Cookie-mode subscribe — preserves the EventSource implementation that
 *  relied on `withCredentials` to carry the openwop.session cookie.
 *  Re-tooled to share the timer hooks with the bearer path but otherwise
 *  unchanged from the pre-migration behavior. */
function subscribeCookie(
  runId: string,
  opts: SubscribeOptions,
  hooks: Pick<TimerHooks, 'onTimedOut' | 'onManuallyClosed' | 'setManuallyClosed' | 'clearTimers' | 'resetIdle' | 'armAbsolute'>,
): Subscription {
  // `new URL()` requires an absolute URL OR a relative URL with a base.
  // In prod `config.baseUrl` is `/api` (relative, served via Firebase
  // Hosting rewrite) — without a base, the constructor throws
  // "Invalid URL". Pass `window.location.origin` as the base: it's
  // ignored when baseUrl is absolute (e.g. http://localhost:8080 in
  // dev) and used when relative, so this works in both modes.
  // SSE-specific base URL. Bypasses the Firebase Hosting `/api/**`
  // proxy which buffers responses and breaks long-lived SSE streams.
  // See `config.ts > sseBaseUrl` for the rationale.
  const url = new URL(
    `${config.sseBaseUrl}/v1/runs/${encodeURIComponent(runId)}/events`,
    window.location.origin,
  );
  if (opts.modes && opts.modes.length > 0) {
    url.searchParams.set('mode', opts.modes.join(','));
  }

  const es = new EventSource(url.toString(), { withCredentials: true });
  const onAbort = (): void => es.close();
  hooks.armAbsolute(onAbort);
  hooks.resetIdle(onAbort);

  // Generic listener catches every typed event the BE emits via SSE
  // `event:` field. EventSource fires named events on `addEventListener`
  // and falls back to `onmessage` for unnamed events; the BE sends
  // every line with an `event:` field so addEventListener('*' won't
  // catch them. We listen to a hard-coded set of canonical openwop
  // event types — including the `agent.*`, `provider.usage`, and
  // `core.workflowChain.*` families so the run-detail reasoning, cost,
  // and handoff panels update live (not just on a post-run REST poll).
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
    'node.dispatched',
    'agent.reasoned',
    'agent.reasoning.delta',
    'agent.toolCalled',
    'agent.toolReturned',
    'agent.handoff',
    'agent.decided',
    'provider.usage',
    'runOrchestrator.decided',
    'core.workflowChain.event',
    'core.workflowChain.confidence-escalated',
  ];

  const handler = (raw: MessageEvent) => {
    hooks.resetIdle(onAbort);
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
  es.onerror = () => {
    if (hooks.onManuallyClosed() || hooks.onTimedOut()) return;
    if (es.readyState === EventSource.CLOSED) {
      // Stop the auto-reconnect loop on a clean server close.
      hooks.clearTimers();
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
      hooks.setManuallyClosed(true);
      hooks.clearTimers();
      es.close();
      opts.onClose?.();
    },
  };
}
