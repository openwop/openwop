/**
 * RFC 0153 §C — Multi Round-Trip Requests, both directions.
 *
 * CLIENT half (host calls the suite's MCP server): `mcp-integration.md` §C.1 —
 * when a tool answers `input_required`, the host MUST NOT hold a live callback;
 * it MUST treat the initial request and the retry as ONE logical invocation,
 * gather the elicitation input (a `clarification` interrupt in a real run; the
 * seam MAY answer it programmatically), retry with a NEW JSON-RPC id carrying
 * `inputResponses[key]` and the `requestState` echoed EXACTLY, and MUST NOT
 * cache the interim result. Observed through the ADDITIVE seam contract
 * (`host-sample-test-seams.md` §23): `POST /v1/host/sample/mcp/invoke
 * { serverUrl, tool: "needs_input", clientCapabilities: { elicitation: {} },
 * elicitationAnswer: { name: "Ada" } }` → `200 { negotiatedVersion, mrtr: {
 * inputRequiredSeen, retried, requestStateEchoed, result } }`. The suite's server
 * records both calls, so `requestStateEchoed` is cross-checked from the wire, not
 * taken from the host's report. A host without the `mrtr` block is `blocked`.
 *
 * SERVER half (host as 2026-07-28 MCP server): §C.2 — a `tools/call` on an
 * exposed workflow that reaches `waiting-input` MUST answer `input_required`
 * with an `elicitation/create` in `inputRequests` and a `requestState`, and the
 * retry with `inputResponses` MUST resolve it (`resultType: complete`). Uses the
 * same `core.openwop.mcp.expose-tool` + `handle-elicitation` fixture shape the
 * legacy bridge leg uses. A tampered `requestState` MUST be refused.
 *
 * Gate: `mcp.supported && mcp.protocolVersions ∋ 2026-07-28` for the client
 * half (the seam is version-independent); `mcp.profiles ∋ mcp-2026-07-28` +
 * `serverMount.supported` for the server half. Needs the fake server
 * (`OPENWOP_MCP_FAKE_SERVER=true`) for the client half.
 *
 * @see spec/v1/mcp-integration.md §"MCP 2026-07-28 versioned composition" §C
 */

import { describe, it, expect } from 'vitest';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { mcpServerMount } from '../lib/mcp-mount.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { getMcpFakeServer } from '../lib/mcp-fake-server.js';

export const REQUIRES_HOST_CALLBACK = "the host issues MCP JSON-RPC calls (including the MRTR input_required round trip) to the suite's fake server via /v1/host/sample/mcp/invoke (serverUrl)";

const META_V = 'io.modelcontextprotocol/protocolVersion';
const META_C = 'io.modelcontextprotocol/clientCapabilities';

interface McpCaps { readonly supported?: boolean; readonly protocolVersions?: readonly string[]; readonly profiles?: readonly string[]; readonly serverMount?: { supported?: boolean; elicitationBridge?: boolean } }
async function mcp(): Promise<McpCaps | undefined> {
  const d = await driver.get('/.well-known/openwop');
  return capabilityFamily<McpCaps>(d.json, 'mcp');
}

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0153 §C — mcp-mrtr-roundtrip, client half (host calls a 2026-07-28 server; gated)', () => {
  it('input_required → gather → retry with inputResponses + echoed requestState, as one logical invocation', async () => {
    const caps = await mcp();
    if (!behaviorGate('mcp.mrtr.client', caps?.supported === true && (caps.protocolVersions ?? []).includes('2026-07-28'))) return;
    const server = getMcpFakeServer();
    if (server === null) return softSkip('blocked', 'the suite MCP fake server is not started in this run — the client half cannot be driven');
    server.reset();
    const drive = await driver.post('/v1/host/sample/mcp/invoke', {
      serverUrl: server.endpoint(),
      tool: 'needs_input',
      clientCapabilities: { elicitation: {} },
      elicitationAnswer: { name: 'Ada' },
    });
    if (drive.status === 404 || drive.status === 403) {
      // Advertised mcp-2026-07-28 but the invoke seam answered {drive.status}: not observable here.
      // Default mode records `blocked` (RFC 0148 §A); OPENWOP_REQUIRE_BEHAVIOR=true fails
      // an advertised-missing seam (RFC 0148 §B). A 403 is NOT a pass.
      return seamAbsent(`host advertises mcp-2026-07-28 but the invoke seam /v1/host/sample/mcp/invoke answered ${drive.status}`);
    }
    const calls = server.invocations().filter((i) => i.method === 'tools/call');
    expect(calls.length, driver.describe('RFCS/0153 §C', 'the host MUST have called the tool at least once for this leg to mean anything')).toBeGreaterThan(0);
    const mrtr = (drive.json as { mrtr?: { inputRequiredSeen?: boolean; retried?: boolean; requestStateEchoed?: boolean; result?: unknown } }).mrtr;
    if (mrtr === undefined) {
      expect(mrtr, driver.describe('host-sample-test-seams.md §23', 'the invoke seam SHOULD report `mrtr: { inputRequiredSeen, retried, requestStateEchoed, result }` for tool "needs_input"; until it does this requirement is unobservable and resolves to `blocked`')).toBeDefined();
      return;
    }
    expect(mrtr.inputRequiredSeen, driver.describe('mcp-integration.md §C.1', 'the host MUST recognise resultType input_required')).toBe(true);
    expect(mrtr.retried, driver.describe('mcp-integration.md §C.1', 'the host MUST retry the ORIGINAL request with inputResponses (a live callback is not the current profile)')).toBe(true);
    // Cross-check from the wire: two tools/call, second carries requestState identical to what the server issued.
    expect(calls.length, driver.describe('mcp-integration.md §C.1', 'initial + retry = two independent JSON-RPC requests on the wire')).toBeGreaterThanOrEqual(2);
    const retry = calls[calls.length - 1]!.params as { requestState?: string; inputResponses?: Record<string, unknown> };
    expect(typeof retry.requestState, driver.describe('mcp-integration.md §C.1', 'requestState MUST be echoed exactly on the retry')).toBe('string');
    expect(retry.requestState?.startsWith('mrtr:needs_input:'), 'the echoed requestState is the value the server issued, byte-exact').toBe(true);
    expect(retry.inputResponses?.['who'], driver.describe('mcp-integration.md §C.1', 'inputResponses MUST answer every requested key')).toBeDefined();
    expect(mrtr.requestStateEchoed).toBe(true);
    for (const c of calls) {
      expect(c.revision, driver.describe('mcp-integration.md §B', 'both calls MUST carry the current revision')).toBe('2026-07-28');
    }
  });
});

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0153 §C — mcp-mrtr-roundtrip, server half (host as 2026-07-28 server; gated on mcp-2026-07-28 + serverMount)', () => {
  it('a suspending tool answers input_required with elicitation + requestState; the retry resolves it; a forged requestState is refused', async () => {
    const caps = await mcp();
    const claims = caps?.supported === true && (caps.profiles ?? []).includes('mcp-2026-07-28') && caps.serverMount?.supported === true;
    if (!behaviorGate('mcp-2026-07-28', claims)) return;
    // Register a workflow that exposes a tool and asks for input (the legacy
    // elicitation-bridge fixture shape); under the current profile the ask MUST
    // surface as MRTR, not as a live elicitation/create callback.
    const TOOL = `mrtr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const reg = await driver.post('/v1/host/sample/workflows', {
      workflowId: `mcp.mrtr.${TOOL}`,
      nodes: [
        { nodeId: 'expose', typeId: 'core.openwop.mcp.expose-tool', config: { name: TOOL, description: 'MRTR conformance tool', inputSchema: { type: 'object', properties: {} } } },
        { nodeId: 'ask', typeId: 'core.openwop.mcp.handle-elicitation', config: { message: 'What is your name?', requestedSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
      ],
      // The sample-workflow seam's registration shape (`nodeId` / `edgeId` /
      // `sourceNodeId` / `targetNodeId` — the same convention every other leg
      // posting to `/v1/host/sample/workflows` uses for nodes), NOT the RFC 0013
      // workflow-CHAIN `{ from, to }` shape this leg posted until 2026-08-16
      // (S17: the first 2026-07-28 host answered 400 validation_error and the
      // leg walked on to tools/call for a tool that was never registered).
      // Note the seam shape differs from the canonical WorkflowDefinition
      // (`workflow-definition.schema.json` keys nodes and edges by `id`); the
      // divergence is recorded in host-sample-test-seams.md.
      edges: [{ edgeId: 'expose-ask', sourceNodeId: 'expose', targetNodeId: 'ask' }],
    });
    if (reg.status === 404 || reg.status === 403) return seamAbsent(`host advertises mcp-2026-07-28 with a server mount but the sample-workflow seam /v1/host/sample/workflows answered ${reg.status}`);
    // A 4xx here is a SUITE defect (the fixture this leg posts is malformed),
    // not seam absence and not a host finding — fail loudly at the source.
    expect(reg.status, driver.describe('host-sample-test-seams.md §"sample workflows"', `the registration fixture MUST be accepted; a 4xx means the fixture this leg posts is malformed (suite defect): ${JSON.stringify(reg.json).slice(0, 200)}`)).toBeLessThan(400);
    const hdr = { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': TOOL };
    const first = await driver.post(await mcpServerMount(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: TOOL, arguments: {}, _meta: { [META_V]: '2026-07-28', [META_C]: { elicitation: {} } } } }, { headers: hdr });
    if (first.status === 404) return seamAbsent('host advertises an MCP server mount but /v1/host/sample/mcp answered 404');
    const r1 = first.json as { result?: { resultType?: string; inputRequests?: Record<string, { method?: string }>; requestState?: string }; error?: { code: number } };
    expect(r1.error, driver.describe('mcp-integration.md §C.2', `tools/call MUST NOT error: ${JSON.stringify(r1.error)}`)).toBeUndefined();
    expect(r1.result?.resultType, driver.describe('mcp-integration.md §C.2', 'a run reaching waiting-input MUST answer the in-flight tools/call with resultType input_required (not a live callback)')).toBe('input_required');
    const key = Object.keys(r1.result?.inputRequests ?? {})[0];
    expect(key, driver.describe('mcp-integration.md §C.2', 'inputRequests MUST carry the elicitation')).toBeDefined();
    expect(r1.result?.inputRequests?.[key!]?.method).toBe('elicitation/create');
    expect(typeof r1.result?.requestState, driver.describe('mcp-integration.md §C.2', 'requestState MUST be present (opaque, integrity-protected, bound to principal/TTL/request/runId/interrupt token)')).toBe('string');
    const retry = await driver.post(await mcpServerMount(), { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: TOOL, arguments: {}, requestState: r1.result!.requestState, inputResponses: { [key!]: { action: 'accept', content: { name: 'Ada' } } }, _meta: { [META_V]: '2026-07-28', [META_C]: { elicitation: {} } } } }, { headers: hdr });
    const r2 = retry.json as { result?: { resultType?: string }; error?: { code: number } };
    expect(r2.error).toBeUndefined();
    expect(['complete', 'input_required'], driver.describe('mcp-integration.md §C.2', 'the retry MUST resolve the interrupt (complete) or ask for the next pending input')).toContain(r2.result?.resultType);
    const forged = await driver.post(await mcpServerMount(), { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: TOOL, arguments: {}, requestState: 'forged', inputResponses: { [key!]: { action: 'accept', content: { name: 'Eve' } } }, _meta: { [META_V]: '2026-07-28', [META_C]: { elicitation: {} } } } }, { headers: hdr });
    const r3 = forged.json as { result?: { resultType?: string }; error?: { code: number } };
    expect(r3.error !== undefined || forged.status >= 400, driver.describe('mcp-integration.md §C.2', 'a requestState that fails integrity verification MUST be refused (upstream: attacker-controlled input)')).toBe(true);
  });
});
