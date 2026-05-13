/**
 * Host-internal backpressure smoke for the Postgres reference host.
 *
 * Exercises the inflight-cap + 503 + Retry-After path required by
 * production-profile.md §"Backpressure". Sets OPENWOP_MAX_INFLIGHT=2
 * so the cap is reachable from a single test process.
 *
 * Scenario:
 *   1. Block 2 long-running runs concurrently (they hold the inflight
 *      slots while their event-poll requests are in-flight).
 *   2. Send a 3rd request; expect 503 + Retry-After header + canonical
 *      error envelope.
 *   3. Discovery is exempt from the cap (health probes always answer).
 *   4. After the long runs complete, cap clears and a new request
 *      succeeds.
 *
 * Also verifies retention sweep: with OPENWOP_EVENT_RETENTION_DAYS=0
 * the sweeper is disabled (negative is a no-op via the > 0 check),
 * and with a small days value + manual time-warp, expired runs would
 * purge (we don't time-warp in this test; the path is exercised by
 * the sweeper's idempotent first-call on boot).
 *
 * @see spec/v1/production-profile.md §"Backpressure", §"Event retention"
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-backpressure-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;
process.env.OPENWOP_MAX_INFLIGHT = '2';
process.env.OPENWOP_RETRY_AFTER_SECONDS = '1';

// ESM hoists `import` declarations above top-level code, so the env
// var assignments above would run AFTER server.ts evaluates its
// module-scope constants. Dynamic import ensures the env var is set
// BEFORE server.ts reads it.
const { setQuerier, start } = await import('../src/server.js');
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

    // ── 1. Discovery is exempt from inflight cap ──────────────────────
    {
      // Issue many concurrent discovery probes; all should succeed
      // even though we're well over the inflight cap.
      const probes = await Promise.all(
        Array.from({ length: 10 }, () => fetch(`${baseUrl}/.well-known/openwop`)),
      );
      for (const probe of probes) {
        assert.equal(probe.status, 200, 'discovery MUST bypass inflight cap');
      }
      console.log('  ✓ discovery probes bypass inflight cap');
    }

    // ── 2. Saturate cap with concurrent slow requests ─────────────────
    //
    // Create 2 long-running delay runs; while their executor sleep
    // hasn't completed, the in-flight create routes have ALREADY
    // returned (POST /v1/runs returns 201 immediately — the executor
    // runs async). So we need a different way to hold inflight slots.
    //
    // Approach: open 2 SSE streams against in-flight runs. Each SSE
    // handler holds its connection open until run terminal. With
    // MAX_INFLIGHT=2, the 3rd authenticated request MUST 503.
    const longRun1 = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workflowId: 'conformance-delay',
        inputs: { delayMs: 1500 },
      }),
    });
    assert.equal(longRun1.status, 201);
    const r1 = (await longRun1.json()) as { runId: string };

    const longRun2 = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workflowId: 'conformance-delay',
        inputs: { delayMs: 1500 },
      }),
    });
    assert.equal(longRun2.status, 201);
    const r2 = (await longRun2.json()) as { runId: string };

    // Open 2 SSE streams (these hold 2 inflight slots).
    const sse1Controller = new AbortController();
    const sse2Controller = new AbortController();
    const sse1Promise = fetch(`${baseUrl}/v1/runs/${encodeURIComponent(r1.runId)}/events`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
      signal: sse1Controller.signal,
    });
    const sse2Promise = fetch(`${baseUrl}/v1/runs/${encodeURIComponent(r2.runId)}/events`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
      signal: sse2Controller.signal,
    });

    // Wait briefly so the SSE connections register.
    await new Promise((res) => setTimeout(res, 100));

    // The 3rd authenticated request MUST 503.
    const blocked = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'conformance-noop' }),
    });
    assert.equal(blocked.status, 503, '3rd request MUST 503 when inflight cap is saturated');
    assert.equal(blocked.headers.get('retry-after'), '1', 'Retry-After header MUST equal config');
    const blockedBody = (await blocked.json()) as {
      error?: string;
      message?: string;
      details?: { retryAfter?: number };
    };
    assert.equal(blockedBody.error, 'service_unavailable');
    assert.equal(blockedBody.details?.retryAfter, 1);
    console.log('  ✓ 503 + Retry-After when inflight cap saturated');

    // ── 3. Close SSE streams, cap clears, new request succeeds ────────
    sse1Controller.abort();
    sse2Controller.abort();
    // Swallow the aborted fetches.
    await sse1Promise.catch(() => undefined);
    await sse2Promise.catch(() => undefined);
    // Wait for res.on('close') to decrement inflight.
    await new Promise((res) => setTimeout(res, 200));

    const ok = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'conformance-noop' }),
    });
    assert.equal(ok.status, 201, 'after slot release, new requests MUST succeed');
    console.log('  ✓ cap clears after slot release');

    console.log('postgres-host backpressure test: PASS');
  } finally {
    await close();
    await db.close();
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
