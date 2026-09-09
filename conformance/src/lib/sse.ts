/**
 * Minimal SSE client for the conformance suite.
 *
 * Why hand-rolled rather than `eventsource` npm package: keeping the
 * conformance suite zero-dependency on third-party SSE libs makes it
 * easier to audit and to port to other ecosystems. Native fetch +
 * ReadableStream parsing is enough for our scope.
 *
 * Scope:
 *   - parses the `event:` / `data:` / `id:` lines per RFC 8895
 *   - fires a callback for each parsed event
 *   - resolves the connection promise when the server closes the stream
 *   - bounded by an absolute timeout (no infinite hangs in CI)
 *
 * NOT supported (not needed for the v1 stream-mode scenarios):
 *   - automatic reconnect with Last-Event-ID
 *   - retry intervals from `retry:` lines
 *   - keep-alive comment handling beyond ignoring lines that start with ':'
 */

import { loadEnv } from './env.js';

export interface SseEvent {
  readonly event: string; // event type; defaults to 'message' if absent
  readonly data: string; // raw data lines joined with \n
  readonly id: string | null; // last `id:` line in the event, if any
}

export interface SseSubscribeOptions {
  /** Absolute timeout — connection is aborted after this regardless of state. Default 30s. */
  readonly timeoutMs?: number;
  /** Optional `Last-Event-ID` request header for resumption. */
  readonly lastEventId?: string;
  /** Optional fetch-level abort. Useful for cancellation in long tests. */
  readonly signal?: AbortSignal;
  /**
   * Extra request headers. A major-2 caller MUST pass `OpenWOP-Version: 2.0`:
   * this helper sends none by itself, and a header-less request on an
   * unversioned path is served the host's `preferredVersion` major
   * (versioning.md §1.3) — 1.x through the overlap.
   */
  readonly extraHeaders?: Record<string, string>;
}

export interface SseSubscribeResult {
  readonly events: readonly SseEvent[];
  readonly status: number;
  readonly closedBy: 'server' | 'timeout' | 'caller';
}

/**
 * Subscribe to an SSE endpoint, collect every event until the server
 * closes the connection (or timeout/caller abort fires), and return the
 * full event list. Use when the test expects a bounded stream.
 */
export async function subscribe(
  pathWithQuery: string,
  opts: SseSubscribeOptions = {},
): Promise<SseSubscribeResult> {
  const env = loadEnv();
  const url = `${env.baseUrl}${pathWithQuery}`;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    Authorization: `Bearer ${env.apiKey}`,
    'Cache-Control': 'no-cache',
  };
  if (opts.lastEventId) {
    headers['Last-Event-ID'] = opts.lastEventId;
  }
  for (const [k, v] of Object.entries(opts.extraHeaders ?? {})) headers[k] = v;

  const internalAbort = new AbortController();
  const timeoutHandle = setTimeout(() => internalAbort.abort(), timeoutMs);
  const externalSignal = opts.signal;
  if (externalSignal) {
    if (externalSignal.aborted) internalAbort.abort();
    else externalSignal.addEventListener('abort', () => internalAbort.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers, signal: internalAbort.signal });
  } catch (err) {
    clearTimeout(timeoutHandle);
    throw err;
  }

  if (!res.ok || res.body === null) {
    clearTimeout(timeoutHandle);
    return { events: [], status: res.status, closedBy: 'server' };
  }

  const events: SseEvent[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let pendingEvent = 'message';
  let pendingData: string[] = [];
  let pendingId: string | null = null;
  let closedBy: SseSubscribeResult['closedBy'] = 'server';

  const flushEvent = (): void => {
    if (pendingData.length === 0) {
      pendingEvent = 'message';
      pendingId = null;
      return;
    }
    events.push({
      event: pendingEvent,
      data: pendingData.join('\n'),
      id: pendingId,
    });
    pendingEvent = 'message';
    pendingData = [];
    pendingId = null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx: number;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, nlIdx).replace(/\r$/, '');
        buffer = buffer.slice(nlIdx + 1);

        if (rawLine === '') {
          flushEvent();
          continue;
        }
        if (rawLine.startsWith(':')) {
          // Comment / keep-alive — ignore.
          continue;
        }
        const colon = rawLine.indexOf(':');
        const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
        const valueRaw = colon === -1 ? '' : rawLine.slice(colon + 1);
        const fieldValue = valueRaw.startsWith(' ') ? valueRaw.slice(1) : valueRaw;

        switch (field) {
          case 'event':
            pendingEvent = fieldValue;
            break;
          case 'data':
            pendingData.push(fieldValue);
            break;
          case 'id':
            pendingId = fieldValue;
            break;
          default:
            // unknown field — ignore per RFC
            break;
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      closedBy = externalSignal?.aborted ? 'caller' : 'timeout';
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timeoutHandle);
    try {
      reader.releaseLock();
    } catch {
      // best-effort
    }
  }

  // Flush a pending event that wasn't terminated by a blank line (some
  // servers drop the trailing \n\n on close).
  flushEvent();

  return { events, status: res.status, closedBy };
}
