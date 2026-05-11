/**
 * Run-lifecycle smoke for the Postgres reference host using PGlite
 * (Postgres-compiled-to-WASM, in-process — no Docker, no installed
 * Postgres). This test:
 *
 *   1. Constructs a PGlite in-memory instance.
 *   2. Wraps it in our `Querier` shape (the field shapes match closely
 *      enough that this is a thin shim).
 *   3. Injects the Querier into the host via `setQuerier`.
 *   4. Starts the HTTP server.
 *   5. Hits POST /v1/runs with `conformance-noop`, polls until terminal,
 *      verifies status === 'completed' and events poll returns the run
 *      lifecycle events.
 *   6. Tears down.
 *
 * This is the regression gate for the Postgres host's wire surface.
 * The conformance suite itself can be pointed at the running host with
 * `OPENWOP_BASE_URL=http://127.0.0.1:3839` for broader coverage; this
 * test covers the smallest end-to-end loop.
 *
 * @see spec/v1/rest-endpoints.md — POST /v1/runs + GET /v1/runs/{id} +
 *   POST /v1/runs/{id}/cancel + GET /v1/runs/{id}/events/poll
 * @see spec/v1/idempotency.md — Idempotency-Key replay semantics
 *   (asserted in step 5: same key returns same runId + Idempotent-
 *   Replay: true)
 * @see spec/v1/run-events.md — run.started / node.started /
 *   node.completed / run.completed event ordering
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// Isolate audit signing keys per test run so we don't leak artifacts
// into examples/hosts/postgres/data/ (the production default location).
const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-lifecycle-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

import { setQuerier, start } from '../src/server.js';
import type { Querier, QueryResult } from '../src/db.js';

// Adapter from PGlite's `query()` shape to our `Querier` interface.
// PGlite returns { rows, fields, affectedRows, ... }; we use rows.
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

async function poll<T>(
  fn: () => Promise<T | null>,
  predicate: (v: T) => boolean,
  opts: { timeoutMs: number; intervalMs?: number },
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  const interval = opts.intervalMs ?? 50;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v && predicate(v)) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`poll timeout after ${opts.timeoutMs}ms`);
}

async function main(): Promise<void> {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();

  try {
    const port = process.env.OPENWOP_PORT ?? '3839';
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // 1. Discovery.
    const disco = await fetch(`${baseUrl}/.well-known/openwop`);
    assert.equal(disco.status, 200, 'discovery MUST return 200');
    const discoBody = (await disco.json()) as {
      protocolVersion?: string;
      fixtures?: string[];
    };
    assert.equal(discoBody.protocolVersion, '1.0');
    assert.ok(
      discoBody.fixtures && discoBody.fixtures.length > 0,
      'host MUST advertise at least one fixture',
    );

    // 2. Create a noop run.
    const create = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'conformance-noop' }),
    });
    assert.equal(create.status, 201, 'POST /v1/runs MUST return 201');
    const createBody = (await create.json()) as {
      runId: string;
      status: string;
      eventsUrl: string;
      statusUrl: string;
    };
    assert.match(createBody.runId, /^run-/);
    assert.equal(createBody.status, 'pending');
    assert.ok(createBody.eventsUrl, 'eventsUrl MUST be present per OpenAPI required schema');
    assert.ok(createBody.statusUrl, 'statusUrl MUST be present');

    // 3. Poll until terminal.
    const terminal = await poll(
      async () => {
        const r = await fetch(
          `${baseUrl}/v1/runs/${encodeURIComponent(createBody.runId)}`,
          { headers },
        );
        if (!r.ok) return null;
        return (await r.json()) as { status: string };
      },
      (v) => v.status === 'completed' || v.status === 'failed' || v.status === 'cancelled',
      { timeoutMs: 10_000 },
    );
    assert.equal(terminal.status, 'completed', 'noop run MUST complete');

    // 4. Events poll returns the expected lifecycle.
    const eventsRes = await fetch(
      `${baseUrl}/v1/runs/${encodeURIComponent(createBody.runId)}/events/poll`,
      { headers },
    );
    assert.equal(eventsRes.status, 200);
    const eventsBody = (await eventsRes.json()) as {
      events: Array<{ type: string }>;
      isComplete: boolean;
    };
    assert.equal(eventsBody.isComplete, true);
    const types = eventsBody.events.map((e) => e.type);
    assert.ok(types.includes('run.started'), 'run.started MUST be emitted');
    assert.ok(types.includes('node.started'), 'node.started MUST be emitted');
    assert.ok(types.includes('node.completed'), 'node.completed MUST be emitted');
    assert.ok(types.includes('run.completed'), 'run.completed MUST be emitted');

    // 5. Idempotency.
    const idemHeaders = { ...headers, 'Idempotency-Key': 'lifecycle-test-1' };
    const first = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers: idemHeaders,
      body: JSON.stringify({ workflowId: 'conformance-noop' }),
    });
    assert.equal(first.status, 201);
    const firstBody = (await first.json()) as { runId: string };

    const replay = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers: idemHeaders,
      body: JSON.stringify({ workflowId: 'conformance-noop' }),
    });
    assert.equal(replay.headers.get('openwop-Idempotent-Replay'), 'true');
    const replayBody = (await replay.json()) as { runId: string };
    assert.equal(replayBody.runId, firstBody.runId, 'replay MUST return the same runId');

    // 6. Cancellation.
    const create2 = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'conformance-noop' }),
    });
    assert.equal(create2.status, 201);
    const create2Body = (await create2.json()) as { runId: string };

    // Race: noop completes fast, but cancel after-terminal still returns 200.
    await poll(
      async () => {
        const r = await fetch(
          `${baseUrl}/v1/runs/${encodeURIComponent(create2Body.runId)}`,
          { headers },
        );
        if (!r.ok) return null;
        return (await r.json()) as { status: string };
      },
      (v) => v.status === 'completed',
      { timeoutMs: 5_000 },
    );
    const cancel = await fetch(
      `${baseUrl}/v1/runs/${encodeURIComponent(create2Body.runId)}/cancel`,
      { method: 'POST', headers, body: '{}' },
    );
    assert.equal(cancel.status, 200);
    const cancelBody = (await cancel.json()) as { alreadyTerminal?: boolean };
    assert.equal(
      cancelBody.alreadyTerminal,
      true,
      'cancel on terminal run MUST return alreadyTerminal: true',
    );

    console.log('postgres-host lifecycle test: PASS');
  } finally {
    await close();
    await db.close();
  }
}

main()
  .catch((err) => {
    console.error('postgres-host lifecycle test: FAIL');
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    rmSync(workdir, { recursive: true, force: true });
  });
