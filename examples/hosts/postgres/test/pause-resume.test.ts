/**
 * Host-internal pause/resume smoke for the Postgres reference host.
 *
 * Why this lives here and not in the conformance suite:
 *   The black-box `pause-resume.test.ts` scenario in conformance is
 *   capability-gated (skips when the pause endpoint returns 404) and
 *   currently passes inputs the executor's variable resolver doesn't
 *   pick up (delaySeconds vs delayMs). This file exercises the
 *   pause/resume wire surface against a known-good input that the
 *   executor actually honors, so we have a regression gate that's
 *   independent of the conformance fixture's input vocabulary.
 *
 * Scenario:
 *   1. Boot host against PGlite.
 *   2. Create a run on `conformance-delay` with inputs.delayMs = 5000.
 *   3. Wait until status = 'running'.
 *   4. POST :pause → expect 202 + status flips to 'paused' within 2s.
 *   5. POST :resume → expect 202 + status returns to 'running' then
 *      'completed' once the delay finishes.
 *   6. Verify event log contains run.paused + run.resumed + run.completed.
 *
 * @see spec/v1/rest-endpoints.md §pause/resume
 * @see src/server.ts handlePauseRun / handleResumeRun
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-pause-'));
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
): Promise<{ status: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) {
      const body = (await r.json()) as { status: string };
      if (body.status === expected) return body;
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`poll timeout: expected status=${expected}, timed out after ${timeoutMs}ms`);
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

    // 1. Create a long-delay run.
    const create = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workflowId: 'conformance-delay',
        inputs: { delayMs: 5000 },
      }),
    });
    assert.equal(create.status, 201, 'create MUST return 201');
    const { runId } = (await create.json()) as { runId: string };

    // 2. Wait until running.
    await pollUntilStatus(baseUrl, apiKey, runId, 'running', 5_000);

    // 3. Pause.
    const pause = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}:pause`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'smoke-test' }),
    });
    assert.equal(pause.status, 202, ':pause MUST return 202 on a pausable run');

    await pollUntilStatus(baseUrl, apiKey, runId, 'paused', 2_000);

    // 4. Idempotent second pause — MUST NOT 409.
    const secondPause = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}:pause`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.ok(
      secondPause.status === 200 || secondPause.status === 202,
      `:pause on already-paused MUST be idempotent (200/202), got ${secondPause.status}`,
    );

    // 5. Resume.
    const resume = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}:resume`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(resume.status, 202, ':resume MUST return 202 on a paused run');

    // The run should reach completed status after the remaining delay
    // (≤ 5s) elapses. The delay node re-executes from start on resume.
    await pollUntilStatus(baseUrl, apiKey, runId, 'completed', 10_000);

    // 6. Verify event log shape: run.started, run.paused, run.resumed,
    // node.cancelled (from pause-induced abort suppression — should NOT
    // be present because executeNode treats paused as a non-cancellation),
    // run.completed.
    const eventsRes = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const eventsBody = (await eventsRes.json()) as { events: Array<{ type: string }> };
    const types = eventsBody.events.map((e) => e.type);
    assert.ok(types.includes('run.started'), 'event log MUST contain run.started');
    assert.ok(types.includes('run.paused'), 'event log MUST contain run.paused');
    assert.ok(types.includes('run.resumed'), 'event log MUST contain run.resumed');
    assert.ok(types.includes('run.completed'), 'event log MUST contain run.completed');
    assert.ok(
      !types.includes('node.cancelled'),
      `node.cancelled MUST NOT be emitted for pause-induced abort; got events: ${types.join(', ')}`,
    );

    // 7. :pause on terminal run → 409.
    const pauseTerminal = await fetch(
      `${baseUrl}/v1/runs/${encodeURIComponent(runId)}:pause`,
      { method: 'POST', headers, body: '{}' },
    );
    assert.equal(pauseTerminal.status, 409, ':pause on terminal run MUST return 409');

    // 8. :resume on terminal (non-paused) run → 409.
    const resumeTerminal = await fetch(
      `${baseUrl}/v1/runs/${encodeURIComponent(runId)}:resume`,
      { method: 'POST', headers, body: '{}' },
    );
    assert.equal(resumeTerminal.status, 409, ':resume on terminal run MUST return 409');

    console.log('postgres-host pause-resume test: PASS');
  } finally {
    await close();
    await db.close();
  }
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
