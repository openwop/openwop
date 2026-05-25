/**
 * RFC 0031 §B step 4 + §D — model-capability-insufficient refusal, end-to-end
 * on the Postgres reference host (PGlite). Drives the bundled
 * `conformance-model-capability-insufficient` fixture (typeId
 * `conformance.modelCapability.insufficient`, which declares
 * `requiredModelCapabilities: ['nonexistent-capability-9b3f']`) and asserts:
 *
 *   1. The run fails with `error.code = "capability_not_provided"`.
 *   2. `model.capability.insufficient` appears in the event log BEFORE
 *      `node.failed` (cause precedes effect, RFC 0031 §D).
 *   3. The node never executed — no `node.completed` / `provider.usage`.
 *
 * Closes the RFC 0031 gap recorded in docs/CONFORMANCE-RUNS-2026-05.md.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B + §D
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-mcap-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;

import { setQuerier, start } from '../src/server.js';
import type { Querier, QueryResult } from '../src/db.js';

function pgliteQuerier(db: PGlite): Querier {
  return {
    async query<T>(sql: string, params: ReadonlyArray<unknown> = []): Promise<QueryResult<T>> {
      const res = await db.query<T>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: res.affectedRows };
    },
  };
}

async function poll<T>(fn: () => Promise<T | null>, ok: (v: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v && ok(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`poll timeout after ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const db = new PGlite('memory://');
  setQuerier(pgliteQuerier(db));
  const { close } = await start();
  try {
    const port = process.env.OPENWOP_PORT ?? '3839';
    const apiKey = process.env.OPENWOP_API_KEY ?? 'openwop-postgres-dev-key';
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

    // Discovery advertises the capability honestly.
    const disco = await (await fetch(`${baseUrl}/.well-known/openwop`)).json() as {
      capabilities?: { modelCapabilities?: { supported?: boolean } };
    };
    assert.equal(disco.capabilities?.modelCapabilities?.supported, true, 'host MUST advertise modelCapabilities.supported');

    const create = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'conformance-model-capability-insufficient' }),
    });
    assert.equal(create.status, 201, 'POST /v1/runs MUST return 201');
    const { runId } = (await create.json()) as { runId: string };

    const snap = await poll(
      async () => {
        const r = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, { headers });
        if (!r.ok) return null;
        return (await r.json()) as { status: string; error?: { code?: string } };
      },
      (v) => ['completed', 'failed', 'cancelled'].includes(v.status),
      10_000,
    );
    // (1) failed with capability_not_provided.
    assert.equal(snap.status, 'failed', 'capability-insufficient run MUST fail');
    assert.equal(snap.error?.code, 'capability_not_provided', 'error.code MUST be capability_not_provided');

    // (2) + (3) event ordering + no node execution.
    const eventsRes = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`, { headers });
    const events = ((await eventsRes.json()) as { events: Array<{ type: string }> }).events;
    const types = events.map((e) => e.type);
    const insufficientIdx = types.indexOf('model.capability.insufficient');
    const failedIdx = types.indexOf('node.failed');
    assert.ok(insufficientIdx >= 0, 'model.capability.insufficient MUST be emitted');
    assert.ok(failedIdx >= 0, 'node.failed MUST be emitted');
    assert.ok(insufficientIdx < failedIdx, 'model.capability.insufficient MUST precede node.failed (RFC 0031 §D)');
    assert.ok(!types.includes('node.completed'), 'refused node MUST NOT complete');
    assert.ok(!types.includes('provider.usage'), 'refused node MUST NOT dispatch (no provider.usage)');

    console.log('model-capability-insufficient.test: PASS');
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
