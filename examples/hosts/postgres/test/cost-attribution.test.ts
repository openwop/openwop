/**
 * RFC 0026 cost-attribution end-to-end for the Postgres reference host
 * (PGlite-backed). Drives the bundled `openwop-smoke-cost-emit` fixture
 * (typeId `conformance.cost.emit`) and asserts:
 *
 *   1. The cost-emit node completes (exactly one `node.completed` for
 *      nodeId `emit-cost`) — i.e. the typeId is wired, not `default`-ed
 *      to `unsupported_node_type`.
 *   2. The run snapshot surfaces `metrics.openwopCost` with the
 *      allowlisted rollup (usd / tokens / provider) per
 *      `run-snapshot.schema.json §metrics.openwopCost`.
 *   3. The rollup carries ONLY allowlisted fields — the non-allowlisted
 *      `openwop.cost.evil` + credential-shaped `openwop.cost.leaked_token`
 *      are dropped (the `cost-attribution-allowlist-redaction` invariant).
 *
 * Closes the RFC 0026 gap recorded in docs/CONFORMANCE-RUNS-2026-05.md.
 *
 * @see spec/v1/observability.md §"Cost attribution attributes"
 * @see RFCS/0026-provider-usage-event.md
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-cost-'));
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

    const create = await fetch(`${baseUrl}/v1/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workflowId: 'openwop-smoke-cost-emit' }),
    });
    assert.equal(create.status, 201, 'POST /v1/runs (cost-emit) MUST return 201');
    const { runId } = (await create.json()) as { runId: string };

    const snap = await poll(
      async () => {
        const r = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, { headers });
        if (!r.ok) return null;
        return (await r.json()) as {
          status: string;
          metrics?: { openwopCost?: { usd?: number; tokens?: { input?: number; output?: number }; provider?: string; [k: string]: unknown } };
        };
      },
      (v) => ['completed', 'failed', 'cancelled'].includes(v.status),
      10_000,
    );
    assert.equal(snap.status, 'completed', 'cost-emit run MUST complete (typeId wired, not unsupported_node_type)');

    // (1) node.completed for emit-cost.
    const events = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`, { headers });
    const body = (await events.json()) as { events: Array<{ type: string; nodeId?: string }> };
    const completed = body.events.filter((e) => e.type === 'node.completed' && e.nodeId === 'emit-cost');
    assert.equal(completed.length, 1, 'cost-emit node MUST emit exactly one node.completed');

    // (2) metrics.openwopCost surfaces the rollup.
    const cost = snap.metrics?.openwopCost;
    assert.ok(cost, 'metrics.openwopCost MUST be populated after conformance.cost.emit');
    assert.equal(cost.usd, 0.00123, 'usd MUST fold from the fixture');
    assert.equal(cost.tokens?.input, 100, 'tokens.input MUST fold');
    assert.equal(cost.tokens?.output, 50, 'tokens.output MUST fold');
    assert.equal(cost.provider, 'anthropic', 'provider MUST fold');

    // (3) allowlist: no non-allowlisted / credential-shaped keys leaked into the rollup.
    const serialized = JSON.stringify(cost);
    assert.ok(!serialized.includes('must-be-dropped'), 'non-allowlisted openwop.cost.evil MUST be dropped');
    assert.ok(!serialized.includes('sk-ant-CANARY'), 'credential-shaped canary MUST NOT leak into the rollup');

    console.log('cost-attribution.test: PASS');
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
