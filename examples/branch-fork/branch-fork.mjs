// Branch-fork example — diverge a run's execution from a chosen sequence.
//
// Branch mode (mode: 'branch') re-executes from `fromSeq` with optional
// runOptionsOverlay applied; downstream events MAY diverge by design.
// This is DIFFERENT from replay mode (mode: 'replay') which guarantees
// deterministic re-execution for time-travel debugging. Hosts may advertise
// branch, replay, or both in `replay.modes`.
//
// 1. Discover the host's openwop-replay-fork advertisement.
// 2. Create a parent run that completes.
// 3. POST /v1/runs/{runId}:fork with mode=branch.
// 4. Poll fork until terminal.
// 5. Verify the fork reaches a terminal status.
//
// Profile required: openwop-replay-fork (replay.supported: true and
//                   'branch' in replay.modes).
//
// Host target: any conformant host. Skip-equivalent without OPENWOP_BASE_URL.
//
// @see spec/v1/replay.md
// @see spec/v1/profiles.md §openwop-replay-fork

import { randomUUID } from 'node:crypto';

// Tiny ANSI helpers — colors when stdout is a TTY, no-op when piped/CI.
const _tty = process.stdout.isTTY;
const _c = _tty
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' }
  : { dim: '', red: '', green: '', reset: '' };
const skip = (msg) => console.log(`${_c.dim}${msg}${_c.reset}`);
const fail = (msg) => console.error(`${_c.red}${msg}${_c.reset}`);
const ok = (msg) => console.log(`${_c.green}${msg}${_c.reset}`);

const BASE_URL = process.env.OPENWOP_BASE_URL ?? '';
const API_KEY = process.env.OPENWOP_API_KEY ?? '';
const WORKFLOW_ID = process.env.OPENWOP_WORKFLOW_ID ?? 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

if (!BASE_URL) {
  skip('⊘ branch-fork: OPENWOP_BASE_URL unset — skip-equivalent.');
  process.exit(0);
}
if (!API_KEY) {
  fail('✗ branch-fork: OPENWOP_API_KEY required.');
  process.exit(1);
}

async function http(method, path, body, opts = {}) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function pollUntil(runId, predicate, { timeoutMs = 30000, intervalMs = 250 } = {}) {
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
  const discoveryRes = await fetch(`${BASE_URL}/.well-known/openwop`);
  if (!discoveryRes.ok) {
    fail(`✗ discovery failed: ${discoveryRes.status}`);
    process.exit(1);
  }
  const caps = await discoveryRes.json();
  const replay = caps.replay ?? {};
  if (replay.supported !== true) {
    skip(`⊘ Host doesn't claim openwop-replay-fork (replay.supported is ${replay.supported}).`);
    skip(`  This example requires a host claiming the profile.`);
    process.exit(0); // skip-equivalent
  }
  const modes = Array.isArray(replay.modes) ? replay.modes : [];
  if (!modes.includes('branch')) {
    skip(`⊘ Host doesn't advertise 'branch' mode (advertises: [${modes.join(', ')}]).`);
    process.exit(0);
  }
  console.log(`  ✓ Host claims openwop-replay-fork; modes: [${modes.join(', ')}]`);

  // Phase 1 — parent run.
  const idemKey = `openwop-example-branch-fork-${process.env.GITHUB_RUN_ID ?? randomUUID()}`;
  console.log(`→ POST /v1/runs (parent) — workflowId: "${WORKFLOW_ID}"`);
  const parent = await http('POST', '/v1/runs', { workflowId: WORKFLOW_ID }, { idempotencyKey: idemKey });
  if (parent.status === 404) {
    skip(`⊘ Workflow "${WORKFLOW_ID}" not seeded on host; skip-equivalent.`);
    process.exit(0);
  }
  if (parent.status !== 201) {
    fail(`✗ parent run failed: ${parent.status}`);
    process.exit(1);
  }
  const parentRunId = parent.json.runId;
  console.log(`  parentRunId: ${parentRunId}`);

  await pollUntil(parentRunId, (s) => TERMINAL.has(s.status));
  console.log(`  ✓ parent reached terminal`);

  // Phase 2 — branch-mode fork from sequence 0.
  console.log(`→ POST /v1/runs/${parentRunId}:fork { mode: 'branch', fromSeq: 0 }`);
  const fork = await http(
    'POST',
    `/v1/runs/${encodeURIComponent(parentRunId)}:fork`,
    { mode: 'branch', fromSeq: 0 },
    { idempotencyKey: `${idemKey}-fork` },
  );
  if (fork.status === 501) {
    skip(`⊘ Fork mode=branch returned 501 — host has the route stubbed; skip-equivalent.`);
    process.exit(0);
  }
  if (![200, 201].includes(fork.status)) {
    fail(`✗ fork failed: ${fork.status} ${JSON.stringify(fork.json)}`);
    process.exit(1);
  }
  const forkRunId = fork.json.runId;
  console.log(`  forkRunId: ${forkRunId}`);

  // Phase 3 — verify fork is a distinct run that reaches terminal.
  if (forkRunId === parentRunId) {
    fail(`✗ fork returned same runId as parent — fork MUST mint a new runId`);
    process.exit(1);
  }
  const forkSnap = await pollUntil(forkRunId, (s) => TERMINAL.has(s.status));
  console.log(`  ✓ fork reached terminal: ${forkSnap.status}`);
  if (forkSnap.status !== 'completed') {
    fail(`✗ Expected fork to complete, got ${forkSnap.status}`);
    process.exit(1);
  }
  console.log('');
  ok(`✓ Branch fork lifecycle complete`);
  console.log('');
  console.log('Note: branch mode permits divergent execution by design.');
  console.log('For deterministic replay, see spec/v1/replay.md mode=replay');
  console.log('and the conformance scenario replayDeterminism.test.ts.');
}

main().catch((err) => {
  fail(`✗ ${err.message}`);
  process.exit(1);
});
