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
 *     probe at a real MCP server. Auto-detects the transport from the
 *     server's `Content-Type` response header:
 *       - `application/json` → single-JSON response, parsed as one
 *         JSON-RPC frame. Verified end-to-end against
 *         `@modelcontextprotocol/sdk@1.29.0` `enableJsonResponse: true`
 *         streamable-http servers (2026-05-12).
 *       - `text/event-stream` → streamable-http+SSE; the probe reads
 *         SSE frames until it finds one whose `data:` payload matches
 *         the JSON-RPC `id` we sent, then returns that frame. Verified
 *         end-to-end against `@modelcontextprotocol/sdk@1.29.0`
 *         streamable-http servers WITHOUT `enableJsonResponse`
 *         (2026-05-13).
 *     The stdio transport (default for `modelcontextprotocol/servers`
 *     reference servers) is HTTP-incompatible by design — those run
 *     as a child process speaking JSON-RPC over stdin/stdout, no HTTP
 *     endpoint. Operators collecting interop evidence against stdio
 *     servers run them under the documented HTTP-to-stdio bridge at
 *     `examples/mcp-stdio-bridge/` (verified end-to-end 2026-05-13;
 *     probe + bridge + `echo-stdio-server.mjs` round-trip passes 2/2).
 *     Assertions stay shape-only: tools/list returns ≥1 tool, a
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
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { getMcpFakeServer } from '../lib/mcp-fake-server.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollUntilTerminal } from '../lib/polling.js';

/**
 * Callback-shaped: the host issues MCP JSON-RPC calls to the suite's fake server.
 *
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance; no route.
 */
export const REQUIRES_HOST_CALLBACK = "the host issues MCP JSON-RPC calls to the suite's fake server";

// The fixture's node is the conformance-RESERVED `core.conformance.mcp-invoke`
// (S33, 2026-08-17 — was `core.ai.callPrompt` + `config.mcp`, a vendor pack-tier
// node that never read that config): a host that consumes MCP maps it to its own
// bridge; one that does not MUST NOT advertise the fixture.
const ROUNDTRIP_FIXTURE = 'conformance-mcp-tool-roundtrip';

/**
 * Read an SSE `text/event-stream` body until a frame's `data:` payload
 * is a JSON-RPC response with `id === wantId`, then return that frame's
 * parsed payload. Honors the MCP streamable-http transport's "single
 * POST may return one OR many SSE frames; correlate by id" pattern.
 */
async function readSseUntilId(
  res: Response,
  wantId: number,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  if (!res.body) throw new Error('SSE response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let sepIndex: number;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      let dataLines: string[] = [];
      for (const line of block.split('\n')) {
        // SSE permits multi-line data via repeated `data:` lines, joined by \n.
        if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      if (dataLines.length === 0) continue;
      try {
        const parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
        if (parsed.id === wantId) {
          // Drop the reader; the server may keep the stream open for
          // unrelated notifications.
          void reader.cancel().catch(() => undefined);
          return parsed;
        }
      } catch {
        // Skip malformed frames.
      }
    }
    if (done) break;
  }
  throw new Error(`SSE stream closed before frame with id=${wantId} arrived`);
}

async function postJsonRpc(
  endpoint: string,
  method: string,
  params: unknown,
  id: number,
  sessionId?: string,
): Promise<{ status: number; json: Record<string, unknown>; sessionId: string | null }> {
  // POST to `endpoint` verbatim — the trailing-slash decision is the
  // caller's. The probe accepts both response shapes per MCP's
  // streamable-http spec: a single JSON body OR an SSE stream that
  // emits one-or-many JSON-RPC frames. Transport is auto-detected
  // from Content-Type.
  //
  // Session-id threading: real MCP servers built on the official SDK
  // assign a session id at `initialize` and require it on every
  // subsequent call via `mcp-session-id`. The in-process fake doesn't
  // enforce that, but real impls do — so the probe always echoes back
  // any session header it receives from initialize.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // MCP streamable-http servers SHOULD return `application/json`
    // by default but MAY upgrade to SSE; advertise both as
    // acceptable.
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const returnedSessionId = res.headers.get('mcp-session-id');
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const json = await readSseUntilId(res, id);
    return { status: res.status, json, sessionId: returnedSessionId };
  }
  const text = await res.text();
  return {
    status: res.status,
    json: JSON.parse(text) as Record<string, unknown>,
    sessionId: returnedSessionId,
  };
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
      return softSkip('blocked', 'precondition not met — `!probe` returned early (seam, prior step, or fixture unavailable)');
    }
    if (!probe.isReal) getMcpFakeServer()!.reset();

    // Per MCP `initialize` spec, params MUST carry protocolVersion +
    // capabilities + clientInfo. The in-process fake accepts empty
    // params; real reference servers built on @modelcontextprotocol/sdk
    // reject them with 400. Sending the canonical shape keeps the probe
    // valid against both.
    const init = await postJsonRpc(
      probe.url,
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'openwop-conformance-probe', version: '1.0.0' },
      },
      1,
    );
    expect(init.status).toBe(200);
    const initResult = (init.json.result ?? {}) as { protocolVersion?: string };
    expect(typeof initResult.protocolVersion).toBe('string');
    // Capture session id from initialize so real SDK-based servers can
    // bind subsequent calls; fakes that don't set the header pass null
    // through and the calls still succeed.
    const sid = init.sessionId ?? undefined;

    const list = await postJsonRpc(probe.url, 'tools/list', {}, 2, sid);
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
        sid,
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
      return softSkip('blocked', '[mcp-tool-roundtrip] fake server not started; skipping host-mediated test');
    }
    if (!isFixtureAdvertised(ROUNDTRIP_FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp-tool-roundtrip] fixture ${ROUNDTRIP_FIXTURE} not advertised; skipping`,
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(ROUNDTRIP_FIXTURE)` returned early');
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
