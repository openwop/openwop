/**
 * Host-internal SSE event-stream smoke for the Postgres reference host.
 *
 * Exercises GET /v1/runs/{runId}/events:
 *   1. Returns text/event-stream with Cache-Control: no-cache.
 *   2. Each event emits `id: <seq>\nevent: <type>\ndata: <json>\n\n`.
 *   3. Backlog is flushed before live subscription (run.completed
 *      arrives even when the consumer connects after the run already
 *      finished).
 *   4. Last-Event-ID header resumes from a specific seq — only events
 *      with seq > lastEventId replay.
 *   5. Stream closes after a terminal event (run.completed / run.failed
 *      / run.cancelled).
 *
 * @see spec/v1/stream-modes.md
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-sse-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

import { setQuerier, start } from '../src/server.js';
import type { Querier, QueryResult } from '../src/db.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

interface SseFrame {
  id?: string;
  event?: string;
  data?: string;
}

/**
 * Read the response body as an SSE stream. Each frame is delimited by
 * `\n\n`. Resolves with the full list of parsed frames when the server
 * closes the connection.
 */
async function readSseFrames(res: Response): Promise<SseFrame[]> {
  if (!res.body) throw new Error('response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const frames: SseFrame[] = [];

  const parseFrame = (block: string): SseFrame | null => {
    const frame: SseFrame = {};
    let nonEmpty = false;
    for (const line of block.split('\n')) {
      if (!line) continue;
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const field = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).replace(/^ /, '');
      if (field === 'id') frame.id = value;
      else if (field === 'event') frame.event = value;
      else if (field === 'data') frame.data = value;
      nonEmpty = true;
    }
    return nonEmpty ? frame : null;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const f = parseFrame(block);
        if (f) frames.push(f);
      }
    }
    if (done) break;
  }
  return frames;
}

try {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();

  try {
    const baseUrl = `http://127.0.0.1:${process.env.OPENWOP_PORT ?? '3839'}`;
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // 1. Create + poll for completion (backlog scenario).
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'conformance-noop' }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };

      // Wait for terminal so we know the SSE consumer will get a backlog
      // flush + a stream that closes immediately.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const r = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (r.ok) {
          const body = (await r.json()) as { status: string };
          if (body.status === 'completed') break;
        }
        await new Promise((res) => setTimeout(res, 30));
      }

      const sseRes = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
      });
      assert.equal(sseRes.status, 200, 'SSE stream MUST open with 200');
      assert.equal(
        sseRes.headers.get('content-type'),
        'text/event-stream',
        'Content-Type MUST be text/event-stream',
      );
      assert.ok(
        (sseRes.headers.get('cache-control') ?? '').includes('no-cache'),
        'Cache-Control MUST include no-cache',
      );

      const frames = await readSseFrames(sseRes);
      assert.ok(frames.length >= 4, `SSE backlog MUST include ≥4 events; got ${frames.length}`);
      const types = frames.map((f) => f.event ?? '');
      assert.ok(types.includes('run.started'), 'backlog MUST include run.started');
      assert.ok(types.includes('node.started'), 'backlog MUST include node.started');
      assert.ok(types.includes('node.completed'), 'backlog MUST include node.completed');
      assert.ok(types.includes('run.completed'), 'backlog MUST include run.completed');

      // Frame format: id field is the event seq (numeric).
      const seqs = frames.map((f) => Number(f.id ?? -1));
      for (let i = 1; i < seqs.length; i++) {
        assert.ok(
          seqs[i]! > seqs[i - 1]!,
          `SSE frames MUST be seq-ordered; got ${seqs.join(',')}`,
        );
      }
      console.log(`  ✓ backlog flush — ${frames.length} ordered SSE frames`);
    }

    // 2. Last-Event-ID resume.
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'conformance-noop' }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };

      // Wait for terminal.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const r = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (r.ok) {
          const body = (await r.json()) as { status: string };
          if (body.status === 'completed') break;
        }
        await new Promise((res) => setTimeout(res, 30));
      }

      // Resume from seq=1 — only events with seq > 1 should replay.
      const resume = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'text/event-stream',
          'Last-Event-ID': '1',
        },
      });
      const resumeFrames = await readSseFrames(resume);
      const resumeSeqs = resumeFrames.map((f) => Number(f.id ?? -1));
      assert.ok(
        resumeSeqs.every((s) => s > 1),
        `Last-Event-ID=1 MUST suppress seq ≤ 1; got seqs ${resumeSeqs.join(',')}`,
      );
      assert.ok(resumeFrames.length >= 1, 'resume MUST return at least one event');
      console.log(`  ✓ Last-Event-ID resume — ${resumeFrames.length} frames after seq=1`);
    }

    // 3. Live subscription (long delay, connect during, capture events
    //    as they happen).
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workflowId: 'conformance-delay',
          inputs: { delayMs: 500 },
        }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };

      const sseRes = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      assert.equal(sseRes.status, 200);
      const frames = await readSseFrames(sseRes);
      const types = frames.map((f) => f.event ?? '');
      assert.ok(
        types.includes('run.completed'),
        `live SSE MUST receive run.completed; got types: ${types.join(',')}`,
      );
      console.log(`  ✓ live subscription closes on run.completed`);
    }

    console.log('postgres-host sse test: PASS');
  } finally {
    await close();
    await db.close();
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
