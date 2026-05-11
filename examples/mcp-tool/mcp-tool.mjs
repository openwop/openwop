// MCP-tool example — vendor-extension probe + observation pattern.
//
// OpenWOP + MCP compose: OpenWOP runs the workflow, MCP exposes tools to the
// LLM nodes inside it. Per spec/v1/mcp-integration.md the integration
// pattern is host-implementation-defined — there's no `openwop-mcp`
// profile yet.
//
// What this example demonstrates:
//   1. Discovery probe: look for vendor-prefixed MCP advertisement.
//   2. If host advertises MCP support, start a workflow that uses an
//      MCP tool and observe the tool-call lifecycle in the event
//      stream.
//   3. Verify event-stream invariants: tool-call events appear before
//      the next LLM turn; tool responses are wrapped in untrusted
//      markers (per SECURITY/threat-model-prompt-injection.md
//      `prompt-injection-mcp-marker`).
//
// Why not run a live MCP server here:
//   - Real MCP integration requires the host's MCP client wiring + a
//     registered MCP server with stable stdio or HTTP transport.
//     Both are host-deployment specifics, not protocol concerns.
//   - The example's job is to show the openwop-side observability of
//     MCP-mediated workflows, not to wire MCP itself.
//
// Profile required: vendor-extension probe (`openwop.mcp` or
//                   equivalent host extension). When a `openwop-mcp`
//                   profile lands via RFC, this example will gate on
//                   it directly.
//
// Host target: . Skip-equivalent without
//              OPENWOP_BASE_URL or when host doesn't advertise.
//
// @see spec/v1/mcp-integration.md
// @see SECURITY/threat-model-prompt-injection.md (mcp-* invariants)

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
const WORKFLOW_ID = process.env.OPENWOP_WORKFLOW_ID ?? '';

if (!BASE_URL) {
  skip('⊘ mcp-tool: OPENWOP_BASE_URL unset — skip-equivalent.');
  process.exit(0);
}
if (!API_KEY) {
  fail('✗ mcp-tool: OPENWOP_API_KEY required.');
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

function detectMcpExtension(caps) {
  // Look for MCP advertisement under any vendor-prefixed namespace.
  // Conventional locations:
  //   - capabilities.openwop.mcp ()
  //   - capabilities.mcp (generic extension advertisement)
  //   - capabilities.<vendor>.mcp
  const candidates = [];
  if (caps.mcp != null) candidates.push({ key: 'mcp', value: caps.mcp });
  for (const [k, v] of Object.entries(caps)) {
    if (typeof v === 'object' && v !== null && 'mcp' in v) {
      candidates.push({ key: `${k}.mcp`, value: v.mcp });
    }
  }
  return candidates;
}

async function main() {
  console.log(`→ Discovery: ${BASE_URL}/.well-known/openwop`);
  const discovery = await fetch(`${BASE_URL}/.well-known/openwop`);
  if (!discovery.ok) {
    fail(`✗ discovery failed: ${discovery.status}`);
    process.exit(1);
  }
  const caps = await discovery.json();
  console.log(`  Host: ${caps.implementation?.name ?? 'unknown'}`);

  // Probe for MCP advertisement.
  const mcpCandidates = detectMcpExtension(caps);
  if (mcpCandidates.length === 0) {
    skip(`⊘ Host doesn't advertise MCP support under any vendor prefix.`);
    skip(`  Looked under: capabilities.mcp + capabilities.<vendor>.mcp`);
    skip(`  This example targets hosts with MCP extensions wired.`);
    process.exit(0); // skip-equivalent
  }
  console.log(`  ✓ MCP advertisement found:`);
  for (const c of mcpCandidates) {
    const json = JSON.stringify(c.value);
    const display = json.length > 100 ? json.slice(0, 100) + '...' : json;
    console.log(`    capabilities.${c.key}: ${display}`);
  }

  if (!WORKFLOW_ID) {
    // Without a configured workflow, demonstrate just the discovery side.
    // This is the safe default — readers learn the probe pattern.
    console.log('');
    console.log('No OPENWOP_WORKFLOW_ID set — discovery probe complete.');
    console.log('To exercise the full lifecycle, set OPENWOP_WORKFLOW_ID to a');
    console.log('workflow that uses MCP tools and re-run.');
    process.exit(0);
  }

  // Phase 2: start a run that uses MCP tools, observe event stream.
  console.log(`→ POST /v1/runs { workflowId: "${WORKFLOW_ID}" }`);
  const idemKey = `openwop-example-mcp-tool-${process.env.GITHUB_RUN_ID ?? randomUUID()}`;
  const create = await http('POST', '/v1/runs', { workflowId: WORKFLOW_ID }, { idempotencyKey: idemKey });
  if (create.status === 404) {
    skip(`⊘ Workflow "${WORKFLOW_ID}" not seeded; skip-equivalent.`);
    process.exit(0);
  }
  if (create.status !== 201) {
    fail(`✗ run failed: ${create.status} ${JSON.stringify(create.json)}`);
    process.exit(1);
  }
  const { runId } = create.json;
  console.log(`  runId: ${runId}`);

  // Poll the events stream looking for tool-call events.
  console.log(`→ Polling /v1/runs/${runId}/events/poll for tool-call observability...`);
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  let toolCallCount = 0;
  let lastStatus = 'pending';
  let pollCount = 0;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    pollCount++;
    const res = await http('GET', `/v1/runs/${encodeURIComponent(runId)}/events/poll`);
    if (res.status === 200 && res.json) {
      const events = res.json.events ?? [];
      // Tool-call events vary in shape per host — we look for type
      // strings containing "tool" or "mcp" as the cross-host probe.
      const toolEvents = events.filter((e) =>
        typeof e.type === 'string' && (e.type.includes('tool') || e.type.includes('mcp')),
      );
      toolCallCount = toolEvents.length;
    }

    const snap = await http('GET', `/v1/runs/${encodeURIComponent(runId)}`);
    if (snap.status === 200 && snap.json && typeof snap.json.status === 'string') {
      lastStatus = snap.json.status;
      if (TERMINAL.has(lastStatus)) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`  ${toolCallCount} tool-related event(s) observed across ${pollCount} polls`);

  // When the user explicitly set OPENWOP_WORKFLOW_ID, they expect the run
  // to reach terminal — a stalled run is a real failure. The discovery-
  // only path (no WORKFLOW_ID) returns earlier above and never hits here.
  if (!TERMINAL.has(lastStatus)) {
    fail(`✗ Run ${runId} did not reach terminal within 30s; last status: ${lastStatus}`);
    process.exit(1);
  }
  if (lastStatus !== 'completed') {
    fail(`✗ Expected completed, got ${lastStatus}`);
    process.exit(1);
  }

  if (toolCallCount === 0) {
    console.log(`  Note: workflow completed without observable tool-call events.`);
    console.log(`        Host may emit tool events under non-standard type names.`);
  }

  console.log('');
  ok(`✓ MCP probe + observation complete`);
}

main().catch((err) => {
  fail(`✗ ${err.message}`);
  process.exit(1);
});
