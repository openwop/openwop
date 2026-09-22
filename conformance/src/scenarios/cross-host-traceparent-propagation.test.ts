/**
 * cross-host-traceparent-propagation — RFC 0040 §B, carriers named by RFC 0207
 * (major 1; supplementary, non-gating — the gating home of the same ids is
 * `v2-interop-trace-context.test.ts`).
 *
 * `spec/v1/multi-agent-execution.md` §"W3C tracecontext across MCP + A2A
 * composition": a host that dispatches MCP tool calls AND advertises
 * `multiAgent.executionModel.version >= 3` MUST inject the parent run's W3C
 * trace context into every outbound MCP request — in `params._meta.traceparent`
 * or, on Streamable HTTP, in the HTTP `traceparent` header (SHOULD `_meta`) —
 * and outbound A2A messages MUST carry it in
 * `Message.metadata.openwop.traceparent` or the HTTP header (SHOULD the
 * metadata).
 *
 * Until suite 2.36.0 this file was two `it.skip` placeholders that read the
 * carrier as an HTTP header only and waited on a peer harness. The harness is
 * the suite's own fake MCP server and fake A2A peer, which record every
 * request's params, body and headers; the run is started with the suite's own
 * `traceparent` (a fresh trace id) on `POST /v1/runs`, so the request the host
 * sends the fake is where the carrier is read. The verdict is the D4 rule
 * (`../lib/trace-context.ts`): neither carrier ⇒ fail; a different trace id ⇒
 * fail; the header alone ⇒ PASS (logged `header-only`).
 *
 * Gates: `version >= 3`; the fixture (`conformance-mcp-tool-roundtrip` /
 * `conformance-a2a-task-roundtrip`) advertised; the fake server / peer started
 * (`OPENWOP_MCP_FAKE_SERVER=true` / `OPENWOP_A2A_FAKE_PEER=true`), else
 * `blocked`, never a pass.
 *
 * @see RFCS/0040-multi-agent-cross-host-causation.md §B
 * @see RFCS/0207-trace-context-across-mcp-and-a2a.md §A, §B
 * @see spec/v1/multi-agent-execution.md §"W3C tracecontext across MCP + A2A composition"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { getMcpFakeServer } from '../lib/mcp-fake-server.js';
import { getA2AFakePeer } from '../lib/a2a-fake-peer.js';
import { makeTraceparent, classifyCarriers, mcpMetaTraceparent, a2aMetadataTraceparent } from '../lib/trace-context.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = "the host's MCP / A2A client calls the suite's fake MCP server / fake A2A peer";

const DOC = 'multi-agent-execution.md §"W3C tracecontext across MCP + A2A composition" (RFC 0040 §B, RFC 0207)';
const MCP_FIXTURE = 'conformance-mcp-tool-roundtrip';
const A2A_FIXTURE = 'conformance-a2a-task-roundtrip';

async function executionModelVersion(): Promise<number> {
  try {
    const res = await driver.get('/.well-known/openwop');
    const caps = discoveryFamilies(res.json) as { multiAgent?: { executionModel?: { version?: unknown } } };
    const v = caps.multiAgent?.executionModel?.version;
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

const MCP_CARRIED = 'openwop.requirement.0207.mcp-traceparent-carried';
const A2A_CARRIED = 'openwop.requirement.0207.a2a-traceparent-carried';

function carried(leg: string, inMessage: unknown, header: string | undefined, traceId: string, inMessageName: string): { ok: boolean; message: string } {
  const v = classifyCarriers(inMessage, header, traceId, { inMessage: inMessageName });
  // eslint-disable-next-line no-console
  console.info(`[cross-host-traceparent-propagation] ${leg}: carrier ${v.ok ? v.detail : 'none'}`);
  return { ok: v.ok, message: v.ok ? `the outbound request carries the parent run's trace (carrier: ${v.detail})` : v.reason };
}

describe('cross-host-traceparent-propagation (RFC 0040 §B, RFC 0207 carriers)', () => {
  it('a version >= 3 host carries the parent run\'s trace into its outbound MCP tools/call', async () => {
    if ((await executionModelVersion()) < 3) return softSkip('inapplicable', 'multiAgent.executionModel.version < 3 — RFC 0040 §B binds only Phase 3 hosts');
    if (!isFixtureAdvertised(MCP_FIXTURE)) return softSkip('inapplicable', `fixture ${MCP_FIXTURE} not advertised — the host does not consume MCP through the conformance node`);
    const server = getMcpFakeServer();
    if (!server) return softSkip('blocked', 'the suite fake MCP server is not started (OPENWOP_MCP_FAKE_SERVER=true)');
    server.reset();
    const tp = makeTraceparent();
    const create = await driver.post('/v1/runs', { workflowId: MCP_FIXTURE, inputs: { text: 'traceparent-probe' } }, { headers: { traceparent: tp.header } });
    if (create.status !== 201) return softSkip('blocked', `POST /v1/runs answered ${create.status} — the fixture run was refused`);
    await pollUntilTerminal((create.json as { runId: string }).runId, { timeoutMs: 30_000 });
    const call = server.invocations().find((i) => i.method === 'tools/call');
    if (!call) return softSkip('blocked', 'the fixture run made no tools/call to the suite fake server — the host\'s MCP binding does not reach it');
    const v = carried('tools/call', mcpMetaTraceparent(call.params), call.headers['traceparent'], tp.traceId, 'params._meta.traceparent');
    expect(v.ok, req(MCP_CARRIED, DOC, v.message)).toBe(true);
  });

  it('a version >= 3 host carries the parent run\'s trace into its outbound A2A message', async () => {
    if ((await executionModelVersion()) < 3) return softSkip('inapplicable', 'multiAgent.executionModel.version < 3 — RFC 0040 §B binds only Phase 3 hosts');
    if (!isFixtureAdvertised(A2A_FIXTURE)) return softSkip('inapplicable', `fixture ${A2A_FIXTURE} not advertised — the host does not consume A2A peers`);
    const peer = getA2AFakePeer();
    if (!peer) return softSkip('blocked', 'the suite fake A2A peer is not started (OPENWOP_A2A_FAKE_PEER=true)');
    peer.reset();
    peer.setNextState('REJECTED');
    const tp = makeTraceparent();
    const create = await driver.post('/v1/runs', { workflowId: A2A_FIXTURE, inputs: { driftScenario: 'rejected' } }, { headers: { traceparent: tp.header } });
    if (create.status !== 201) return softSkip('blocked', `POST /v1/runs answered ${create.status} — the fixture run was refused`);
    await pollUntilTerminal((create.json as { runId: string }).runId, { timeoutMs: 15_000 });
    const sent = peer.invocations().find((i) => i.rpcMethod === 'SendMessage' || i.rpcMethod === 'message/send');
    if (!sent) return softSkip('blocked', 'the fixture run sent no message to the suite fake peer — the host\'s A2A binding does not reach it');
    const v = carried('SendMessage', a2aMetadataTraceparent(sent.body), sent.headers['traceparent'], tp.traceId, 'params.message.metadata.openwop.traceparent');
    expect(v.ok, req(A2A_CARRIED, DOC, v.message)).toBe(true);
  });
});
