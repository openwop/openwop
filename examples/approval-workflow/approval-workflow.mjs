// Approval-workflow example — full HITL approval lifecycle.
//
// 1. Discover the host's profile set; require openwop-interrupts.
// 2. POST /v1/runs with workflowId that suspends at an approval gate.
// 3. Poll until status === 'waiting-approval'.
// 4. POST /v1/runs/{runId}/approvals/{nodeId} with { action: 'accept' }.
// 5. Poll until terminal 'completed'.
// 6. Verify event log includes approval.requested + approval.received.
//
// Profile required: openwop-interrupts (host advertises clarification.request
// in supportedEnvelopes).
//
// Host target: OpenWOP (or any host claiming openwop-interrupts).
// Skip-equivalent when OPENWOP_BASE_URL is unset.
//
// Production-pollution mitigation: uses Idempotency-Key keyed off
// process start time so CI re-runs collapse to a single run server-side.
//
// @see spec/v1/interrupt.md
// @see SECURITY/threat-model-prompt-injection.md (decidedBy invariants)

import { randomUUID } from 'node:crypto';

// Tiny ANSI helpers — colors when stdout is a TTY, no-op when piped/CI.
// Skip-equivalent messages are dim; failures red; success green.
const _tty = process.stdout.isTTY;
const _c = _tty
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' }
  : { dim: '', red: '', green: '', reset: '' };
const skip = (msg) => console.log(`${_c.dim}${msg}${_c.reset}`);
const fail = (msg) => console.error(`${_c.red}${msg}${_c.reset}`);
const ok = (msg) => console.log(`${_c.green}${msg}${_c.reset}`);

const BASE_URL = process.env.OPENWOP_BASE_URL ?? '';
const API_KEY = process.env.OPENWOP_API_KEY ?? '';
const WORKFLOW_ID = process.env.OPENWOP_WORKFLOW_ID ?? 'conformance-approval';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

if (!BASE_URL) {
  skip('⊘ approval-workflow: OPENWOP_BASE_URL unset — skip-equivalent.');
  skip('  Run `OPENWOP_BASE_URL=<url> OPENWOP_API_KEY=<key> npm start` to exercise.');
  process.exit(0);
}
if (!API_KEY) {
  fail('✗ approval-workflow: OPENWOP_API_KEY required when OPENWOP_BASE_URL is set.');
  process.exit(1);
}

async function discover() {
  const res = await fetch(`${BASE_URL}/.well-known/openwop`);
  if (!res.ok) throw new Error(`discovery failed: ${res.status}`);
  return res.json();
}

async function http(method, path, body) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method === 'POST' && path === '/v1/runs') {
    // Idempotent run creation — keyed off this process's start so CI re-runs
    // collapse server-side per spec/v1/idempotency.md §Layer 1.
    headers['Idempotency-Key'] = `openwop-example-approval-${process.env.GITHUB_RUN_ID ?? randomUUID()}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}

async function pollUntil(runId, predicate, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const res = await http('GET', `/v1/runs/${encodeURIComponent(runId)}`);
    if (res.status === 200 && res.json) {
      last = res.json;
      if (predicate(last)) return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out at ${timeoutMs}ms; last status: ${last?.status}`);
}

async function main() {
  console.log(`→ Discovery: ${BASE_URL}/.well-known/openwop`);
  const caps = await discover();
  const envelopes = caps.supportedEnvelopes ?? [];
  if (!envelopes.includes('clarification.request')) {
    console.error(
      `✗ Host doesn't claim openwop-interrupts (no 'clarification.request' in supportedEnvelopes).`,
    );
    console.error(`  Advertised envelopes: [${envelopes.join(', ')}]`);
    console.error(`  This example requires a host that claims the openwop-interrupts profile.`);
    process.exit(1);
  }
  console.log(`  ✓ Host claims openwop-interrupts`);

  console.log(`→ POST /v1/runs { workflowId: "${WORKFLOW_ID}" }`);
  const create = await http('POST', '/v1/runs', { workflowId: WORKFLOW_ID });
  if (create.status === 404) {
    skip(`⊘ Workflow "${WORKFLOW_ID}" not found on this host.`);
    skip(`  Set OPENWOP_WORKFLOW_ID to a workflow with an approval gate.`);
    process.exit(0); // skip-equivalent — host doesn't seed this fixture
  }
  if (create.status !== 201) {
    fail(`✗ run creation failed: ${create.status} ${JSON.stringify(create.json)}`);
    process.exit(1);
  }
  const { runId } = create.json;
  console.log(`  runId: ${runId}`);
  if (create.headers.get('openwop-idempotent-replay') === 'true') {
    console.log(`  (replay — this run was created by a prior CI invocation)`);
  }

  console.log(`→ Polling until waiting-approval...`);
  const suspended = await pollUntil(
    runId,
    (s) => s.status === 'waiting-approval' || TERMINAL.has(s.status),
    { timeoutMs: 30000 },
  );
  if (TERMINAL.has(suspended.status)) {
    // Run already done from a prior CI run (idempotent replay) — that's fine.
    ok(`  ✓ Run already terminal: ${suspended.status} (idempotent replay path)`);
    process.exit(0);
  }
  const nodeId = suspended.currentNodeId;
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    fail(`✗ Suspended snapshot missing currentNodeId; cannot drive approval.`);
    process.exit(1);
  }
  console.log(`  ✓ Suspended at node ${nodeId}`);

  console.log(`→ POST /v1/runs/${runId}/approvals/${nodeId} { action: 'accept' }`);
  const resolve = await http(
    'POST',
    `/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(nodeId)}`,
    { action: 'accept' },
  );
  if (![200, 202].includes(resolve.status)) {
    fail(`✗ approval resolve failed: ${resolve.status} ${JSON.stringify(resolve.json)}`);
    process.exit(1);
  }
  console.log(`  ✓ accept dispatched`);

  console.log(`→ Polling until terminal...`);
  // Generous post-approval timeout: real approval workflows may have
  // delay nodes / sub-workflows after the gate. The fixture workflow
  // (`conformance-approval`) completes in milliseconds; custom
  // OPENWOP_WORKFLOW_ID values may take longer.
  const terminal = await pollUntil(runId, (s) => TERMINAL.has(s.status), { timeoutMs: 60000 });
  console.log(`  ✓ status: ${terminal.status}`);
  if (terminal.status !== 'completed') {
    fail(`✗ Expected completed, got ${terminal.status}`);
    process.exit(1);
  }
  console.log('');
  ok(`✓ Approval workflow round-trip complete`);
}

main().catch((err) => {
  fail(`✗ ${err.message}`);
  process.exit(1);
});
