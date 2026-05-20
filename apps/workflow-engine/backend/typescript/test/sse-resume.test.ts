/**
 * Phase 2B.4 regression — SSE `Last-Event-ID` resume.
 *
 * Per `plans/openwop-sample-chat-improvements-plan.md` §2B.4, the FE
 * relies on the EventSource standard's auto-reconnect-with-Last-Event-ID
 * behavior to recover from a transient disconnect without dropping any
 * events. This test pins the BE half of that contract — `routes/streams.ts`
 * parses the header, converts to `fromSeq`, and replays only events with
 * sequence > the header value.
 *
 * Three assertions:
 *   1. Without the header, the SSE stream replays every event 0..N.
 *   2. With `Last-Event-ID: K`, the stream replays only events K+1..N
 *      (strictly-greater semantics).
 *   3. Malformed header → HTTP 400 with `invalid_request` so a buggy
 *      client doesn't silently get every event each reconnect.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18484;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'test',
    serviceVersion: '0.0.1',
    enableConsoleTracer: false,
  });
  await new Promise<void>((res) => {
    server = app.listen(PORT, res);
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

interface SseFrame {
  event: string;
  data: string;
}

/** Read SSE frames from a server response until the connection closes.
 *  Returns the parsed `{event, data}` records. The stream terminates
 *  on its own when the run is already-complete + buffered events have
 *  been flushed (the route closes the response after replaying the
 *  terminal event for already-terminated runs). */
async function readSseUntilClose(res: Response): Promise<SseFrame[]> {
  if (!res.body) throw new Error('no response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const frames: SseFrame[] = [];
  // The stream stays open for live events; cap the read window so a
  // misbehaving server can't hang the test forever. The completed-run
  // case flushes everything in well under 500ms in practice.
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const frame = parseSseBlock(block);
      if (frame) frames.push(frame);
      idx = buf.indexOf('\n\n');
    }
  }
  try { await reader.cancel(); } catch { /* */ }
  return frames;
}

function parseSseBlock(block: string): SseFrame | null {
  const lines = block.split('\n').filter((l) => l.length > 0 && !l.startsWith(':'));
  if (lines.length === 0) return null;
  let event = 'message';
  const dataParts: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataParts.push(line.slice(5).trim());
  }
  if (dataParts.length === 0) return null;
  return { event, data: dataParts.join('\n') };
}

async function createSampleRun(): Promise<string> {
  const res = await fetch(`${BASE}/v1/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      workflowId: 'sample.demo.uppercase',
      tenantId: 'demo',
      inputs: { text: 'hello' },
    }),
  });
  const body = (await res.json()) as { runId: string };
  return body.runId;
}

async function waitForTerminal(runId: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const snap = await fetch(`${BASE}/v1/runs/${runId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = (await snap.json()) as { status: string };
    if (['completed', 'failed', 'cancelled'].includes(body.status)) return;
  }
  throw new Error('run did not reach terminal status');
}

describe('SSE Last-Event-ID resume — chat-improvements §2B.4', () => {
  let runId: string;
  let allEvents: SseFrame[];

  beforeAll(async () => {
    runId = await createSampleRun();
    await waitForTerminal(runId);

    // Baseline: subscribe with no Last-Event-ID, capture every event.
    const res = await fetch(`${BASE}/v1/runs/${runId}/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    allEvents = await readSseUntilClose(res);
    expect(allEvents.length, 'baseline replay must include at least 4 events').toBeGreaterThanOrEqual(4);
  });

  it('without Last-Event-ID replays every event 0..N', () => {
    // Every event carries an id: <sequence>; the baseline has them in
    // monotonically-increasing order starting from 0 (the run.created
    // event the executor emits first).
    const sequences = allEvents
      .map((f) => {
        try {
          const obj = JSON.parse(f.data) as { sequence?: number };
          return typeof obj.sequence === 'number' ? obj.sequence : null;
        } catch {
          return null;
        }
      })
      .filter((s): s is number => s !== null);
    expect(sequences.length).toBeGreaterThan(0);
    // Strictly-increasing — Last-Event-ID resume depends on this.
    for (let i = 1; i < sequences.length; i++) {
      const prev = sequences[i - 1]!;
      const curr = sequences[i]!;
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it('with Last-Event-ID set to a midpoint replays only events > midpoint', async () => {
    // Pick the middle sequence number from the baseline.
    const sequences = allEvents
      .map((f) => JSON.parse(f.data) as { sequence?: number })
      .map((o) => o.sequence)
      .filter((s): s is number => typeof s === 'number');
    const mid = sequences[Math.floor(sequences.length / 2)]!;

    const res = await fetch(`${BASE}/v1/runs/${runId}/events`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'last-event-id': String(mid),
      },
    });
    expect(res.status).toBe(200);
    const resumed = await readSseUntilClose(res);
    const resumedSequences = resumed
      .map((f) => JSON.parse(f.data) as { sequence?: number })
      .map((o) => o.sequence)
      .filter((s): s is number => typeof s === 'number');

    expect(resumedSequences.length, 'resumed stream replays SOMETHING when mid < final').toBeGreaterThan(0);
    for (const seq of resumedSequences) {
      expect(
        seq > mid,
        `every replayed event MUST have sequence > Last-Event-ID (${mid}); got ${seq}`,
      ).toBe(true);
    }
  });

  it('malformed Last-Event-ID returns 400 invalid_request', async () => {
    const res = await fetch(`${BASE}/v1/runs/${runId}/events`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'last-event-id': 'not-a-number',
      },
    });
    expect(res.status).toBe(400);
    // Canonical openwop error envelope: `{error, message, details?}` per
    // OpenwopError.toEnvelope() in `src/types.ts`.
    const body = (await res.json()) as { error?: string; details?: { header?: string } };
    expect(body.error).toBe('invalid_request');
    expect(body.details?.header).toBe('Last-Event-ID');
  });
});
