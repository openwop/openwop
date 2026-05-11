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
 *   - **Direct probe** (always runs when an MCP endpoint is configured):
 *     hits the configured MCP server directly with initialize +
 *     tools/list + tools/call to verify its wire shape. Catches
 *     regressions in our own test fixture; doubles as the shape check
 *     against real reference servers when `OPENWOP_MCP_REAL_SERVER_URL`
 *     points at one.
 *
 *   - **Host-mediated roundtrip** (runs when host advertises an MCP
 *     fixture or roundtrip capability): starts a workflow run, observes
 *     events, asserts tool-call envelope visibility. Skips otherwise.
 *
 * Operator contract:
 *   - `OPENWOP_MCP_FAKE_SERVER=true` — boots the in-process synthetic
 *     server at suite init. The direct probe asserts the echo tool's
 *     deterministic shape.
 *   - `OPENWOP_MCP_REAL_SERVER_URL=<base-url>` — points the direct
 *     probe at a real MCP server. **Important wire-shape constraint:**
 *     the probe POSTs JSON-RPC and reads a single-JSON response. This
 *     matches MCP's `streamable-http` transport in single-response mode
 *     (no SSE streaming). The probe does NOT support:
 *       - stdio transport (the default for `modelcontextprotocol/servers`
 *         reference servers — they speak JSON-RPC over stdin/stdout, not
 *         HTTP).
 *       - streamable-http transport in SSE-stream mode (where a single
 *         POST returns multiple JSON-RPC frames over `Content-Type:
 *         text/event-stream`).
 *     To collect real-impl interop evidence today, the operator runs a
 *     custom MCP server using a `StreamableHTTPServerTransport`-style
 *     adapter that returns a single JSON body per request. Adding
 *     SSE-frame parsing to support the streaming case is a follow-up;
 *     see `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 6.
 *     Assertions relax to shape-only: tools/list returns ≥1 tool, a
 *     tools/call returns valid MCP content (a `result.content` array,
 *     possibly `isError: true` — both are spec-conformant).
 *
 *   When both env vars are set, the real-server URL wins (it's the more
 *   meaningful evidence). When neither is set, the scenario soft-skips.
 *
 * @see spec/v1/mcp-integration.md
 * @see SECURITY/threat-model-prompt-injection.md
 * @see docs/PROTOCOL-GAP-CLOSURE-PLAN.md Phase 3 T3.4
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
  // POST to `endpoint` verbatim — the trailing-slash decision is the
  // caller's. `probeEndpoint` strips trailing slashes from env-supplied
  // URLs; the fake server accepts any POST path. A real MCP server
  // mounted at e.g. `http://host:port/mcp` would receive a POST to
  // `/mcp` (not `/mcp/`).
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) as Record<string, unknown> };
}

/** Resolve the MCP endpoint to probe: real-server env wins; otherwise the in-process fake. */
function probeEndpoint(): { url: string; isReal: boolean } | null {
  const real = process.env.OPENWOP_MCP_REAL_SERVER_URL;
  if (real && real.length > 0) return { url: real.replace(/\/$/, ''), isReal: true };
  const fake = getMcpFakeServer();
  if (fake) return { url: fake.endpoint(), isReal: false };
  return null;
}

describe('mcp-tool-roundtrip: server wire shape', () => {
  it('initialize + tools/list + tools/call round-trip per MCP JSON-RPC contract', async () => {
    const probe = probeEndpoint();
    if (!probe) {
      // eslint-disable-next-line no-console
      console.warn(
        '[mcp-tool-roundtrip] no MCP endpoint configured; set OPENWOP_MCP_FAKE_SERVER=true ' +
          'or OPENWOP_MCP_REAL_SERVER_URL=<base-url>',
      );
      return;
    }
    if (!probe.isReal) getMcpFakeServer()!.reset();

    const init = await postJsonRpc(probe.url, 'initialize', {}, 1);
    expect(init.status).toBe(200);
    const initResult = (init.json.result ?? {}) as { protocolVersion?: string };
    expect(typeof initResult.protocolVersion).toBe('string');

    const list = await postJsonRpc(probe.url, 'tools/list', {}, 2);
    expect(list.status).toBe(200);
    const listResult = (list.json.result ?? {}) as {
      tools?: ReadonlyArray<{ name?: string }>;
    };
    expect(Array.isArray(listResult.tools)).toBe(true);
    expect((listResult.tools ?? []).length).toBeGreaterThan(0);

    if (probe.isReal) {
      // Real-server interop evidence (Phase 3 T3.4). We can't assume a
      // deterministic echo tool exists on every reference server, so the
      // assertions stay shape-only:
      //   - tools/list returns ≥1 tool ✓ (above)
      //   - the first tool has a name + an input-schema-compatible shape
      //   - tools/call against that tool returns valid MCP content (array
      //     of {type, ...}). A failed call (e.g., bad arguments) still
      //     returns 200 with an `isError: true` content marker — both
      //     paths are spec-conformant; we assert SOME response.
      const first = listResult.tools?.[0];
      expect(typeof first?.name).toBe('string');
      const callRes = await postJsonRpc(
        probe.url,
        'tools/call',
        { name: first!.name, arguments: {} },
        3,
      );
      expect(callRes.status).toBe(200);
      const callResult = (callRes.json.result ?? {}) as {
        content?: ReadonlyArray<{ type?: string }>;
        isError?: boolean;
      };
      // Either valid content[] OR isError-marked content[] is acceptable.
      expect(Array.isArray(callResult.content)).toBe(true);
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp-tool-roundtrip] real-server interop OK against ${probe.url} ` +
          `(tool=${first?.name}, isError=${callResult.isError === true})`,
      );
    } else {
      // Fake-server path: deterministic echo tool, assert verbatim.
      expect(listResult.tools?.some((t) => t.name === 'echo')).toBe(true);

      const call = await postJsonRpc(
        probe.url,
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

      const fake = getMcpFakeServer()!;
      const methods = fake.invocations().map((i) => i.method);
      expect(methods).toEqual(['initialize', 'tools/list', 'tools/call']);
    }
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
