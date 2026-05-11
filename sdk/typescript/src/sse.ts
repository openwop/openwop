/**
 * SSE consumer for `GET /v1/runs/{runId}/events`. Async-iterable shape so
 * consumers can write `for await (const event of client.runs.events(...))`.
 *
 * Implementation parses event:/data:/id: lines per RFC 8895. Native fetch +
 * ReadableStream — zero third-party deps.
 *
 * Designed to be cancellable: pass an AbortSignal via options, or break out
 * of the for-await loop and the underlying connection is torn down on the
 * next tick.
 */

import type { RunEventDoc, StreamMode } from './types.js';

export interface EventsStreamOptions {
  /**
   * Single mode (e.g., 'updates') OR array of modes (S4 mixed-mode,
   * e.g., ['updates', 'messages']). Arrays serialize to a comma-
   * separated `?streamMode=updates,messages` query.
   */
  readonly streamMode?: StreamMode | readonly StreamMode[];
  readonly lastEventId?: string;
  readonly signal?: AbortSignal;
  /**
   * S3 batching hint. When set, server batches events for up to N ms;
   * the SDK transparently flattens batched arrays back into individual
   * RunEventDoc yields, so consumers see the same per-event surface as
   * unbuffered streams. Range 0..5000.
   */
  readonly bufferMs?: number;
}

export interface EventsStreamContext {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export async function* streamEvents(
  ctx: EventsStreamContext,
  runId: string,
  opts: EventsStreamOptions = {},
): AsyncGenerator<RunEventDoc, void, void> {
  const params = new URLSearchParams();
  if (opts.streamMode) {
    const modeParam: string =
      typeof opts.streamMode === 'string' ? opts.streamMode : opts.streamMode.join(',');
    params.set('streamMode', modeParam);
  }
  if (opts.bufferMs !== undefined) {
    params.set('bufferMs', String(opts.bufferMs));
  }
  const qs = params.toString();
  const url = `${ctx.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events${qs ? `?${qs}` : ''}`;

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    Authorization: `Bearer ${ctx.apiKey}`,
    'Cache-Control': 'no-cache',
  };
  if (opts.lastEventId) {
    headers['Last-Event-ID'] = opts.lastEventId;
  }

  const internalAbort = new AbortController();
  const externalSignal = opts.signal;
  if (externalSignal) {
    if (externalSignal.aborted) internalAbort.abort();
    else externalSignal.addEventListener('abort', () => internalAbort.abort(), { once: true });
  }

  const res = await fetch(url, { method: 'GET', headers, signal: internalAbort.signal });
  if (!res.ok || res.body === null) {
    throw new Error(`SSE subscribe failed: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let pendingEvent = 'message';
  let pendingData: string[] = [];
  let pendingId: string | null = null;

  /**
   * Flush the buffered event. Returns an array of RunEventDoc:
   *   - 0 elements when the buffer is empty or non-JSON (skip).
   *   - 1 element for a normal `event: <type>` event.
   *   - N elements when the server batched per S3 — `event: batch` with
   *     `data:` as a JSON array of RunEventDoc.
   */
  const flushAndYield = (): RunEventDoc[] => {
    if (pendingData.length === 0) {
      pendingEvent = 'message';
      pendingId = null;
      return [];
    }
    const dataStr = pendingData.join('\n');
    const eventType = pendingEvent;
    pendingEvent = 'message';
    pendingData = [];
    pendingId = null;
    try {
      const parsed = JSON.parse(dataStr) as unknown;
      // S3 batched envelope — `event: batch` carries an array of events.
      if (eventType === 'batch' && Array.isArray(parsed)) {
        return parsed as RunEventDoc[];
      }
      // Normal single-event payload.
      return [parsed as RunEventDoc];
    } catch {
      // Skip non-JSON events (keep-alive payloads, vendor extensions).
      return [];
    }
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
          for (const event of flushAndYield()) yield event;
          continue;
        }
        if (rawLine.startsWith(':')) continue; // keep-alive comment

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
            break;
        }
      }
    }
    // Flush any final unterminated event.
    for (const final of flushAndYield()) yield final;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // best-effort
    }
    if (!internalAbort.signal.aborted) internalAbort.abort();
  }

  // Reference pendingEvent/pendingId so the linter doesn't flag them as
  // unused; they're consumed via flushAndYield's closure but TS can't see
  // that across a generator boundary.
  void pendingEvent;
  void pendingId;
}
