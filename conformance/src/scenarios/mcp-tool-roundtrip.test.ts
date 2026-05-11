/**
 * Track 6: MCP tool-call roundtrip conformance.
 *
 * Verifies that the host's MCP integration honors the documented trust
 * boundary from `spec/v1/mcp-integration.md` and
 * `SECURITY/threat-model-prompt-injection.md`:
 *
 *   1. The host can connect to an MCP server, list its tools, and call
 *      `tools/call` (basic protocol fidelity).
 *   2. Tool responses surface in the run's event log with the trust
 *      boundary intact — payloads are clearly attributable to the MCP
 *      server, never silently merged into trusted state.
 *
 * Two-level scenario:
 *
 *   - **Direct fake-server probe** (always runs when collector started):
 *     hits the in-process fake MCP server directly with initialize +
 *     tools/list + tools/call to verify its wire shape. Catches
 *     regressions in our own test fixture.
 *
 *   - **Host-mediated roundtrip** (runs when host advertises an MCP
 *     fixture or roundtrip capability): starts a workflow run, observes
 *     events, asserts tool-call envelope visibility. Skips otherwise.
 *
 * Operator contract:
 *   `OPENWOP_MCP_FAKE_SERVER=true` on the suite side; configure the host
 *   to use the printed fake-server URL as one of its MCP servers.
 *
 * @see spec/v1/mcp-integration.md
 * @see SECURITY/threat-model-prompt-injection.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { getMcpFakeServer } from '../lib/mcp-fake-server.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollUntilTerminal } from '../lib/polling.js';

const ROUNDTRIP_FIXTURE = 'conformance-mcp-tool-roundtrip';

async function postJsonRpc(
  endpoint: string,
  method: string,
  params: unknown,
  id: number,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${endpoint}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) as Record<string, unknown> };
}

describe('mcp-tool-roundtrip: fake-server wire shape', () => {
  it('initialize + tools/list + tools/call echo round-trip cleanly', async () => {
    const server = getMcpFakeServer();
    if (!server) {
      // eslint-disable-next-line no-console
      console.warn(
        '[mcp-tool-roundtrip] fake server not started; set OPENWOP_MCP_FAKE_SERVER=true',
      );
      return;
    }
    server.reset();

    const init = await postJsonRpc(server.endpoint(), 'initialize', {}, 1);
    expect(init.status).toBe(200);
    const initResult = (init.json.result ?? {}) as { protocolVersion?: string };
    expect(typeof initResult.protocolVersion).toBe('string');

    const list = await postJsonRpc(server.endpoint(), 'tools/list', {}, 2);
    expect(list.status).toBe(200);
    const listResult = (list.json.result ?? {}) as {
      tools?: ReadonlyArray<{ name?: string }>;
    };
    expect(listResult.tools?.some((t) => t.name === 'echo')).toBe(true);

    const call = await postJsonRpc(
      server.endpoint(),
      'tools/call',
      { name: 'echo', arguments: { text: 'hello-from-conformance' } },
      3,
    );
    expect(call.status).toBe(200);
    const callResult = (call.json.result ?? {}) as {
      content?: ReadonlyArray<{ type?: string; text?: string }>;
    };
    expect(callResult.content?.[0]?.type).toBe('text');
    expect(callResult.content?.[0]?.text).toBe('hello-from-conformance');

    // Invocation log captured.
    const invocations = server.invocations();
    const methods = invocations.map((i) => i.method);
    expect(methods).toEqual(['initialize', 'tools/list', 'tools/call']);
  });
});

describe('mcp-tool-roundtrip: host-mediated tool invocation', () => {
  it('host invokes the configured MCP server and surfaces the tool response in the event log', async () => {
    const server = getMcpFakeServer();
    if (!server) {
      // eslint-disable-next-line no-console
      console.warn('[mcp-tool-roundtrip] fake server not started; skipping host-mediated test');
      return;
    }
    if (!isFixtureAdvertised(ROUNDTRIP_FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp-tool-roundtrip] fixture ${ROUNDTRIP_FIXTURE} not advertised; skipping`,
      );
      return;
    }

    server.reset();

    const create = await driver.post('/v1/runs', {
      workflowId: ROUNDTRIP_FIXTURE,
      inputs: { text: 'roundtrip-probe' },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId, { timeoutMs: 30_000 });

    const invocations = server.invocations();
    const toolCalls = invocations.filter((i) => i.method === 'tools/call');
    expect(toolCalls.length, driver.describe(
      'mcp-integration.md §"Tool invocation"',
      'host MUST invoke `tools/call` on the configured MCP server during the fixture run',
    )).toBeGreaterThan(0);

    // Trust-boundary assertion: the tool-call envelope MUST appear in the
    // run's event log so observers can attribute its content to the
    // MCP server (not to trusted user input). See threat-model-prompt-injection.md
    // §"UNTRUSTED marker" — hosts MAY surface this via a dedicated event
    // type (e.g., `agent.toolReturned`, `mcp.tool.called`) or a marked
    // field on a node-completed payload. This scenario asserts SOME event
    // mentions the tool name to confirm visibility.
    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; payload?: unknown }> }).events ?? [];
    const haystack = JSON.stringify(list).toLowerCase();
    expect(haystack.includes('echo'), driver.describe(
      'mcp-integration.md + threat-model-prompt-injection.md §"UNTRUSTED marker"',
      'host event log MUST surface the MCP tool invocation so observers can audit the trust boundary',
    )).toBe(true);
  });
});
