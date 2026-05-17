// Branching-workflow example — DAG executor proof.
//
// 1. Discovery: confirm the host supports DAG execution (capabilities.fs is
//    irrelevant — we just need the run-lifecycle endpoints).
// 2. POST /v1/host/sample/workflows to register the branching workflow.
// 3. POST /v1/runs with inputs.message → run starts.
// 4. Poll until terminal.
// 5. Pull the event log and assert that both branchA and branchB emitted
//    node.started BEFORE either branchA or branchB emitted node.completed.
//    That's the witness that the two branches ran concurrently and not
//    serially.
//
// Profile required: none (uses default core.openwop.flow + local sample
// nodes shipped by the workflow-engine sample).
// Host target: any DAG-capable openwop host.
// Skip-equivalent when OPENWOP_BASE_URL is unset.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = join(__dirname, 'workflow.json');

const tty = process.stdout.isTTY;
const c = tty
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', reset: '\x1b[0m' }
  : { dim: '', red: '', green: '', cyan: '', reset: '' };
const skip = (m) => console.log(`${c.dim}${m}${c.reset}`);
const fail = (m) => console.error(`${c.red}${m}${c.reset}`);
const ok = (m) => console.log(`${c.green}${m}${c.reset}`);
const info = (m) => console.log(`${c.cyan}${m}${c.reset}`);

const BASE = process.env.OPENWOP_BASE_URL ?? '';
const KEY = process.env.OPENWOP_API_KEY ?? '';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

if (!BASE) {
  skip('⊘ branching-workflow: OPENWOP_BASE_URL unset — skip-equivalent.');
  skip('  Run `OPENWOP_BASE_URL=http://localhost:8080 OPENWOP_API_KEY=sample-token npm start`');
  process.exit(0);
}
if (!KEY) {
  fail('✗ branching-workflow: OPENWOP_API_KEY required when OPENWOP_BASE_URL is set.');
  process.exit(1);
}

async function http(method, path, body, extraHeaders = {}) {
  const headers = {
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

async function pollUntilTerminal(runId, { timeoutMs = 30000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const res = await http('GET', `/v1/runs/${encodeURIComponent(runId)}`);
    if (res.status === 200 && res.json) {
      last = res.json;
      if (TERMINAL.has(last.status)) return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`run did not reach terminal within ${timeoutMs}ms; last status: ${last?.status ?? 'unknown'}`);
}

async function fetchEvents(runId) {
  const res = await http('GET', `/v1/runs/${encodeURIComponent(runId)}/events?fromSequence=0&limit=1000`);
  if (res.status !== 200) throw new Error(`events fetch failed: ${res.status}`);
  return res.json?.events ?? [];
}

function assertConcurrentBranches(events) {
  // Find the sequence numbers of node.started + node.completed for both branches.
  const sigs = {};
  for (const e of events) {
    if (e.type === 'node.started' && (e.nodeId === 'branchA' || e.nodeId === 'branchB')) {
      sigs[`${e.nodeId}:started`] = e.sequence;
    }
    if (e.type === 'node.completed' && (e.nodeId === 'branchA' || e.nodeId === 'branchB')) {
      sigs[`${e.nodeId}:completed`] = e.sequence;
    }
  }
  const aStarted = sigs['branchA:started'];
  const bStarted = sigs['branchB:started'];
  const aCompleted = sigs['branchA:completed'];
  const bCompleted = sigs['branchB:completed'];
  if (aStarted === undefined || bStarted === undefined) {
    throw new Error(`missing node.started for one branch (sigs=${JSON.stringify(sigs)})`);
  }
  if (aCompleted === undefined || bCompleted === undefined) {
    throw new Error(`missing node.completed for one branch (sigs=${JSON.stringify(sigs)})`);
  }
  // Witness: both started BEFORE either completed.
  const lastStarted = Math.max(aStarted, bStarted);
  const firstCompleted = Math.min(aCompleted, bCompleted);
  if (lastStarted >= firstCompleted) {
    throw new Error(
      `branches ran serially, not concurrently. ` +
        `lastStarted=${lastStarted} firstCompleted=${firstCompleted}. ` +
        `Either the host's executor is linear, or OPENWOP_MAX_CONCURRENT_NODES=1.`,
    );
  }
  return { aStarted, bStarted, aCompleted, bCompleted };
}

async function main() {
  info(`→ Discovery: ${BASE}/.well-known/openwop`);
  const discoRes = await http('GET', '/.well-known/openwop');
  if (discoRes.status !== 200) {
    fail(`✗ discovery failed: HTTP ${discoRes.status}`);
    process.exit(1);
  }
  ok(`  ✓ Host reachable (protocolVersion=${discoRes.json?.protocolVersion ?? 'unknown'})`);

  info(`→ Registering workflow: branching-demo`);
  const definition = JSON.parse(readFileSync(WORKFLOW_PATH, 'utf8'));
  const regRes = await http('POST', '/v1/host/sample/workflows', { definition });
  if (regRes.status === 404) {
    skip('  ⊘ host does not expose /v1/host/sample/workflows — skipping register step.');
    skip('  (this endpoint is sample-specific; other hosts MAY register at submit time)');
  } else if (regRes.status >= 400) {
    fail(`✗ workflow register failed: HTTP ${regRes.status} ${JSON.stringify(regRes.json)}`);
    process.exit(1);
  } else {
    ok(`  ✓ Workflow registered`);
  }

  info(`→ POST /v1/runs { workflowId: "branching-demo" }`);
  const idemKey = `openwop-example-branching-${process.env.GITHUB_RUN_ID ?? randomUUID()}`;
  const startRes = await http(
    'POST',
    '/v1/runs',
    { workflowId: 'branching-demo', inputs: { message: 'hello' } },
    { 'Idempotency-Key': idemKey },
  );
  if (startRes.status >= 400) {
    fail(`✗ run start failed: HTTP ${startRes.status} ${JSON.stringify(startRes.json)}`);
    if (startRes.json?.error?.code === 'workflow_invalid') {
      fail('  This host rejected the branching workflow. Likely linear-only.');
    }
    process.exit(1);
  }
  const runId = startRes.json?.runId;
  ok(`  ✓ Run started: ${runId}`);

  info(`→ Polling for terminal state…`);
  const t0 = Date.now();
  const terminal = await pollUntilTerminal(runId);
  const durationMs = Date.now() - t0;
  if (terminal.status !== 'completed') {
    fail(`✗ run terminal: ${terminal.status}`);
    if (terminal.error) fail(`  error: ${JSON.stringify(terminal.error)}`);
    process.exit(1);
  }
  ok(`  ✓ Run completed in ${durationMs}ms`);

  info(`→ Event log:`);
  const events = await fetchEvents(runId);
  for (const e of events) {
    const tag = e.type.replace('node.', '').replace('run.', '').padEnd(12);
    const nid = (e.nodeId ?? '').padEnd(10);
    console.log(`    seq=${String(e.sequence).padStart(2)}  ${tag}  ${nid}`);
  }

  info(`→ Concurrency witness:`);
  const witness = assertConcurrentBranches(events);
  ok(`  ✓ Both branches emitted node.started (sequences ${witness.aStarted}, ${witness.bStarted})`);
  ok(`  ✓ before either emitted node.completed (sequences ${witness.aCompleted}, ${witness.bCompleted})`);
  ok('');
  ok(`✓ branching-workflow PASSED — DAG executor ran branches concurrently.`);
}

main().catch((err) => {
  fail(`✗ branching-workflow FAILED: ${err.message}`);
  process.exit(1);
});
