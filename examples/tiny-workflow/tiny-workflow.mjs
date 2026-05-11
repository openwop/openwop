// Tiny workflow example — smallest possible openwop run lifecycle.
//
// 1. GET /.well-known/openwop  — discover the host's capabilities
// 2. POST /v1/runs         — start a run of the conformance-noop workflow
// 3. Poll GET /v1/runs/{runId} until terminal
//
// Runnable against any openwop-compatible host that has the
// `conformance-noop` fixture seeded (every reference host does).
//
// Configuration via env vars:
//   OPENWOP_BASE_URL  default http://127.0.0.1:3737  (the in-memory host)
//   OPENWOP_API_KEY   default openwop-inmem-dev-key      (the in-memory host's key)
//
// Zero external dependencies — just `fetch` from Node 20+.

const BASE_URL = process.env.OPENWOP_BASE_URL ?? 'http://127.0.0.1:3737';
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-inmem-dev-key';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

async function discover() {
  const res = await fetch(`${BASE_URL}/.well-known/openwop`);
  if (!res.ok) throw new Error(`Discovery failed: ${res.status}`);
  return res.json();
}

async function createRun(workflowId) {
  const res = await fetch(`${BASE_URL}/v1/runs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ workflowId }),
  });
  if (res.status !== 201) {
    throw new Error(`Run create failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function getRun(runId) {
  const res = await fetch(`${BASE_URL}/v1/runs/${encodeURIComponent(runId)}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
  return res.json();
}

async function pollUntilTerminal(runId, { intervalMs = 250, timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await getRun(runId);
    if (TERMINAL_STATUSES.has(snap.status)) return snap;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Run ${runId} did not terminate within ${timeoutMs}ms`);
}

async function main() {
  console.log(`→ Discovery: ${BASE_URL}/.well-known/openwop`);
  const caps = await discover();
  console.log(`  protocolVersion: ${caps.protocolVersion}`);
  console.log(`  implementation:  ${caps.implementation?.name ?? '<unknown>'}`);

  console.log(`→ POST /v1/runs { workflowId: "conformance-noop" }`);
  const created = await createRun('conformance-noop');
  console.log(`  runId:  ${created.runId}`);
  console.log(`  status: ${created.status}`);

  console.log(`→ Polling until terminal...`);
  const terminal = await pollUntilTerminal(created.runId);
  console.log(`  status: ${terminal.status}`);
  console.log(`  ended:  ${terminal.endedAt ?? '<not set>'}`);

  if (terminal.status !== 'completed') {
    console.error(`✗ Expected completed, got ${terminal.status}`);
    process.exit(1);
  }
  console.log(`✓ Run completed successfully`);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
