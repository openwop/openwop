/**
 * RFC 0026 cost-attribution end-to-end for the SQLite reference host.
 * Drives the bundled `openwop-smoke-cost-emit` fixture (typeId
 * `conformance.cost.emit`) and asserts:
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
 * The SQLite host's HTTP server auto-listens on import; we point it at a
 * temp DB + free port via env, then drive it over HTTP. No exported
 * teardown, so the script `process.exit()`s on completion.
 *
 * @see spec/v1/observability.md §"Cost attribution attributes"
 * @see RFCS/0026-provider-usage-event.md
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-sqlite-cost-'));
const PORT = '3849';
const API_KEY = 'openwop-sqlite-dev-key';
process.env.OPENWOP_SQLITE_PATH = join(workdir, 'host.sqlite');
process.env.OPENWOP_PORT = PORT;
process.env.OPENWOP_API_KEY = API_KEY;

const baseUrl = `http://127.0.0.1:${PORT}`;
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` };

async function poll<T>(fn: () => Promise<T | null>, ok: (v: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn().catch(() => null);
    if (v && ok(v)) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`poll timeout after ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  // Boot the host (server.listen runs on import).
  await import('../src/server.js');
  // Wait for the listener to accept connections.
  await poll(
    async () => {
      const r = await fetch(`${baseUrl}/.well-known/openwop`);
      return r.ok ? true : null;
    },
    (v) => v === true,
    5_000,
  );

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
        metrics?: { openwopCost?: { usd?: number; tokens?: { input?: number; output?: number }; provider?: string } };
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

  // (3) allowlist: no non-allowlisted / credential-shaped keys in the rollup.
  const serialized = JSON.stringify(cost);
  assert.ok(!serialized.includes('must-be-dropped'), 'non-allowlisted openwop.cost.evil MUST be dropped');
  assert.ok(!serialized.includes('sk-ant-CANARY'), 'credential-shaped canary MUST NOT leak into the rollup');

  console.log('sqlite cost-attribution.test: PASS');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
