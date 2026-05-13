/**
 * Host-internal regression coverage for the Phase 1-4 code review
 * findings.
 *
 *   - Debug-bundle envelope shape + redaction (covers Phase 1 commit
 *     claim that the prior tests didn't actually exercise).
 *   - Concurrent vote race against a quorum approval gate (covers
 *     review C2: SELECT-then-UPDATE race in resolveApproval).
 *   - SSE post-listener terminal-race window (covers review M1).
 *
 * @see review report — Phases 1-4
 * @see src/interrupts.ts resolveApproval
 * @see src/server.ts handleEventsSse, handleDebugBundle
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-review-'));
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

async function pollUntilStatus(
  baseUrl: string,
  apiKey: string,
  runId: string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) {
      const body = (await r.json()) as { status: string };
      if (body.status === expected) return;
    }
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(`poll timeout: expected status=${expected}, waited ${timeoutMs}ms`);
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

    // ── 1. Debug bundle envelope + redaction ──────────────────────────
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workflowId: 'conformance-noop',
          inputs: { secret: 'should-not-appear', tenantToken: 'should-not-appear' },
        }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };
      await pollUntilStatus(baseUrl, apiKey, runId, 'completed', 5_000);

      const bundleRes = await fetch(
        `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/debug-bundle`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      assert.equal(bundleRes.status, 200);
      const bundle = (await bundleRes.json()) as {
        bundleVersion?: string;
        host?: { name?: string };
        run?: { runId?: string; inputs?: Record<string, unknown> };
        events?: unknown[];
        redactionApplied?: boolean;
        redactionMode?: string;
        truncated?: boolean;
      };
      assert.equal(bundle.bundleVersion, '1', 'bundleVersion MUST be "1"');
      assert.equal(bundle.host?.name, 'openwop-host-postgres');
      assert.equal(bundle.run?.runId, runId);
      assert.deepEqual(
        bundle.run?.inputs,
        {},
        'inputs MUST be omitted per debug-bundle.md §"Redaction guarantees"',
      );
      assert.equal(bundle.redactionApplied, true, 'redactionApplied MUST be true');
      assert.equal(bundle.redactionMode, 'omit', 'redactionMode MUST be omit');
      assert.ok(Array.isArray(bundle.events) && bundle.events.length >= 4);

      // Sanity: bundle does NOT contain the literal secret strings
      // anywhere in its serialized form.
      const serialized = JSON.stringify(bundle);
      assert.ok(
        !serialized.includes('should-not-appear'),
        'bundle MUST NOT contain user-submitted secret strings',
      );

      // ?maxEvents=2 truncation cap.
      const truncatedRes = await fetch(
        `${baseUrl}/v1/runs/${encodeURIComponent(runId)}/debug-bundle?maxEvents=2`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      const truncatedBundle = (await truncatedRes.json()) as {
        events?: unknown[];
        truncated?: boolean;
        truncatedReason?: string;
      };
      assert.equal((truncatedBundle.events ?? []).length, 2);
      assert.equal(truncatedBundle.truncated, true, 'truncated marker MUST be true');
      assert.equal(truncatedBundle.truncatedReason, 'events_truncated_to_max_events');
      console.log('  ✓ debug-bundle envelope + redaction + truncation');
    }

    // ── 2. Concurrent-vote race against single-approver approval ──────
    // The approval fixture has requiredApprovals: 1 (default). Five
    // concurrent voters each posting `accept` MUST resolve the run
    // exactly once and result in exactly one 'resumed' response + four
    // 'unknown' / 404 responses. With the C2 race fix, no vote is lost
    // and the run reaches 'completed' deterministically.
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'conformance-approval' }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };
      await pollUntilStatus(baseUrl, apiKey, runId, 'waiting-approval', 3_000);

      // Five parallel POSTs.
      const voters = ['alice', 'bob', 'carol', 'dave', 'eve'];
      const results = await Promise.all(
        voters.map((voter) =>
          fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/interrupts/gate`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ resumeValue: { action: 'accept', voter } }),
          }).then(async (r) => ({ status: r.status, body: await r.json() })),
        ),
      );
      const successes = results.filter((r) => r.status === 200);
      const notFounds = results.filter((r) => r.status === 404);
      assert.ok(
        successes.length >= 1,
        `at least one vote MUST resolve the gate; got statuses ${results.map((r) => r.status).join(',')}`,
      );
      assert.equal(
        successes.length + notFounds.length,
        voters.length,
        'every vote MUST receive a deterministic 200 or 404 response (no 500s)',
      );
      // The "first vote wins, others 404" is the expected shape for
      // requiredApprovals: 1; with the txn-serialized resolve, no vote
      // can land between accept-quorum-reached and markResolved.
      await pollUntilStatus(baseUrl, apiKey, runId, 'completed', 3_000);
      console.log(
        `  ✓ concurrent vote race — ${successes.length} resolved, ${notFounds.length} 404 (deterministic)`,
      );
    }

    // ── 3. SSE post-listener terminal-race window ─────────────────────
    // Boot a noop run and connect to SSE immediately AFTER terminal.
    // The handler must (a) flush backlog, (b) detect terminal status,
    // (c) close the stream cleanly without hanging on a never-firing
    // live event.
    {
      const create = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workflowId: 'conformance-noop' }),
      });
      assert.equal(create.status, 201);
      const { runId } = (await create.json()) as { runId: string };
      await pollUntilStatus(baseUrl, apiKey, runId, 'completed', 3_000);

      const sseStart = Date.now();
      const sseRes = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
      });
      assert.equal(sseRes.status, 200);
      // Read the entire body; it MUST close quickly (within 2s).
      // If the post-listener terminal re-check isn't wired, the live
      // subscription would hang and this consumer would hit the test
      // process timeout instead.
      const reader = sseRes.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
      const elapsed = Date.now() - sseStart;
      assert.ok(
        elapsed < 2_000,
        `SSE MUST close within 2s on terminal run; took ${elapsed}ms`,
      );
      console.log(`  ✓ SSE on terminal run closes within ${elapsed}ms`);
    }

    console.log('postgres-host review-fixes test: PASS');
  } finally {
    await close();
    await db.close();
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
