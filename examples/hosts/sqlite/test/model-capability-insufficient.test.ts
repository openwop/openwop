/**
 * RFC 0031 §B step 4 + §D — model-capability-insufficient refusal, end-to-end
 * on the SQLite reference host. Drives the bundled
 * `conformance-model-capability-insufficient` fixture (typeId
 * `conformance.modelCapability.insufficient`) and asserts:
 *
 *   1. The run fails with `error.code = "capability_not_provided"`.
 *   2. `model.capability.insufficient` appears BEFORE `node.failed` (§D).
 *   3. The node never executed — no `node.completed` / `provider.usage`.
 *
 * The SQLite host's HTTP server auto-listens on import; we point it at a
 * temp DB + free port via env. No exported teardown, so the script
 * `process.exit()`s on completion.
 *
 * @see RFCS/0031-envelope-variants-and-model-capabilities.md §B + §D
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-sqlite-mcap-'));
const PORT = '3851';
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
  await import('../src/server.js');
  await poll(async () => (await fetch(`${baseUrl}/.well-known/openwop`)).ok ? true : null, (v) => v === true, 5_000);

  // Discovery advertises the capability honestly (advertised: []).
  const disco = (await (await fetch(`${baseUrl}/.well-known/openwop`)).json()) as {
    capabilities?: { modelCapabilities?: { supported?: boolean; advertised?: unknown[] } };
  };
  assert.equal(disco.capabilities?.modelCapabilities?.supported, true, 'host MUST advertise modelCapabilities.supported');
  assert.deepEqual(disco.capabilities?.modelCapabilities?.advertised, [], 'SQLite host routes no AI → advertised MUST be []');

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
  assert.equal(snap.status, 'failed', 'capability-insufficient run MUST fail');
  assert.equal(snap.error?.code, 'capability_not_provided', 'error.code MUST be capability_not_provided');

  const events = ((await (await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events/poll`, { headers })).json()) as { events: Array<{ type: string }> }).events;
  const types = events.map((e) => e.type);
  const insufficientIdx = types.indexOf('model.capability.insufficient');
  const failedIdx = types.indexOf('node.failed');
  assert.ok(insufficientIdx >= 0, 'model.capability.insufficient MUST be emitted');
  assert.ok(failedIdx >= 0, 'node.failed MUST be emitted');
  assert.ok(insufficientIdx < failedIdx, 'model.capability.insufficient MUST precede node.failed (RFC 0031 §D)');
  assert.ok(!types.includes('node.completed'), 'refused node MUST NOT complete');
  assert.ok(!types.includes('provider.usage'), 'refused node MUST NOT dispatch');

  console.log('sqlite model-capability-insufficient.test: PASS');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
