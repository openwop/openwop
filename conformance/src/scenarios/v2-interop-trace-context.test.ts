/**
 * RFC 0207 — trace context across MCP and A2A (suite 2.36.0, target major 2).
 *
 * `spec/v2/core/interop.md` §"Trace context": a host that propagates W3C Trace
 * Context into an MCP request MUST carry it in `params._meta.traceparent`
 * (unprefixed) or in the HTTP `traceparent` header, and SHOULD use `_meta`; into
 * an A2A message, in `Message.metadata.openwop.traceparent` or the HTTP header,
 * SHOULD the metadata. A receiver prefers the in-message value, ignores a
 * malformed one, and never derives authority from either.
 *
 * Every request that drives an outbound call carries the suite's own freshly
 * minted `traceparent` (trace T). The host honours it (`observability.md`
 * §"Trace context propagation", v1-carried text at major 2) and trace context
 * propagates across the MCP and A2A boundaries (`observability.md` §"Trace
 * context across interop boundaries"), so the request the host sends to the
 * suite's own peer is where the carrier is read. The verdict is the D4 rule
 * (`../lib/trace-context.ts` `classifyCarriers`):
 *
 *   - NEITHER carrier present            → fail;
 *   - a carrier with a trace id ≠ T      → fail (the host started a new trace);
 *   - a malformed carrier                → fail;
 *   - the header alone                   → PASS (it conforms; the assertion
 *     message and the log line say `header-only`, so the SHOULD stays visible).
 *
 * Legs, each its own id:
 *
 *   mcp-traceparent-carried   the host's MCP client → the suite's fake MCP
 *                             server, driven two ways: the production run path
 *                             (`POST /runs` of `conformance-mcp-client` with the
 *                             header, gated on `mcp.client`) and the §23 invoke
 *                             seam (gated on the seams profile);
 *   a2a-traceparent-carried   the host's A2A client → a suite-owned A2A peer,
 *                             through the §22 invoke seam;
 *   mcp-server-adopts-meta    the host as MCP server: `tools/call` on its mount
 *                             with `_meta.traceparent` = T and a DIFFERENT header
 *                             H. Observed without OTLP when the mount serves
 *                             `conformance-mcp-client` as a tool: the run it
 *                             starts calls the suite's fake server, and that
 *                             call must carry T, never H. Otherwise read from the
 *                             suite's OTLP collector; neither path ⇒ inapplicable;
 *   mcp-malformed-ignored     `_meta.traceparent: "garbage"` (and a garbage
 *                             header) on the mount is a normal result, never a
 *                             JSON-RPC error;
 *   a2a-malformed-ignored     the same on the host's A2A interface (`SendMessage`);
 *   a2a-inbound-adopts        `SendMessage` with `metadata.openwop.traceparent` =
 *                             T and header H: the host's exported spans carry T
 *                             (OTLP only — `inapplicable` when no span arrives).
 *
 * Sabotage (run once against the v2 reference host before citing): send
 * neither carrier → both carrier rows fail; mint a fresh trace → both fail;
 * put the value under a prefixed `_meta` key only → the MCP row fails; the
 * mount adopts the header over `_meta` → adopts-meta fails; answer a malformed
 * value with an error → the malformed rows fail. Header-only is the positive
 * control: it passes.
 *
 * Callback-shaped (the host calls the suite's peers): unwitnessable when the
 * host is in a separate network namespace — `../lib/host-callback.ts`.
 *
 * @see spec/v2/core/interop.md §"Trace context"
 * @see RFCS/0207-trace-context-across-mcp-and-a2a.md §A, §B, Falsifiability
 */

import { describe, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { loadEnv } from '../lib/env.js';
import { A2AFakePeer } from '../lib/a2a-fake-peer.js';
import { McpFakeServer, getMcpFakeServer, type McpInvocation } from '../lib/mcp-fake-server.js';
import { getCollector } from '../lib/otel-collector.js';
import { makeTraceparent, classifyCarriers, mcpMetaTraceparent, a2aMetadataTraceparent, parseTraceparent } from '../lib/trace-context.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = "the host's MCP / A2A client calls a suite-owned peer that records the trace-context carriers it receives";

const DOC = 'spec/v2/core/interop.md §"Trace context" (RFC 0207)';
// Top-level string consts, used as req()'s first argument inside each `it`
// body: generate-requirement-registry resolves exactly that form, so a leg that
// soft-skips is still recorded under its requirement id.
const MCP_CARRIED = 'openwop.requirement.0207.mcp-traceparent-carried';
const A2A_CARRIED = 'openwop.requirement.0207.a2a-traceparent-carried';
const ADOPTS_META = 'openwop.requirement.0207.mcp-server-adopts-meta';
const MCP_MALFORMED = 'openwop.requirement.0207.mcp-malformed-ignored';
const A2A_MALFORMED = 'openwop.requirement.0207.a2a-malformed-ignored';
const A2A_INBOUND = 'openwop.requirement.0207.a2a-inbound-adopts';
const MCP_FIXTURE = 'conformance-mcp-client';
const NOOP = 'conformance-noop';
const REV = '2026-07-28';
const META_V = 'io.modelcontextprotocol/protocolVersion';
const META_C = 'io.modelcontextprotocol/clientCapabilities';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const MCP_NAMES = { inMessage: 'params._meta.traceparent' };
const A2A_NAMES = { inMessage: 'params.message.metadata.openwop.traceparent' };

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function logCarrier(leg: string, detail: string): void {
  // eslint-disable-next-line no-console
  console.info(`[v2-interop-trace-context] ${leg}: carrier ${detail}${detail === 'header-only' ? ' (conforms; the in-message carrier is SHOULD — RFC 0207 D4)' : ''}`);
}

/** The D4 verdict on one recorded outbound request, as the assertion message and the log line. */
function carried(leg: string, inMessage: unknown, header: string | undefined, traceId: string, names: { inMessage: string }): { ok: boolean; message: string } {
  const v = classifyCarriers(inMessage, header, traceId, names);
  logCarrier(leg, v.ok ? v.detail : 'none');
  return { ok: v.ok, message: v.ok ? `${leg}: the outbound request carries the suite's trace (carrier: ${v.detail})` : `${leg}: ${v.reason}` };
}

/** Find a recorded tools/call whose structured-echo nonce is ours. */
function callWithNonce(invocations: readonly McpInvocation[], nonce: string): McpInvocation | undefined {
  return invocations.find((i) => i.method === 'tools/call' && ((i.params as { arguments?: { nonce?: unknown } } | null)?.arguments?.nonce === nonce));
}

async function waitFor<T>(probe: () => T | undefined, ms: number): Promise<T | undefined> {
  const t0 = Date.now();
  for (;;) { const v = probe(); if (v !== undefined || Date.now() - t0 > ms) return v; await sleep(150); }
}

// ── the host's MCP mount and A2A interface (host as server) ───────────────

type Target = { ok: true; url: string } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };

async function mcpMount(): Promise<Target> {
  if (!(await v2Discovery().catch(() => null))) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const facet = await familyAdvertised('mcp');
  if (!facet) return { ok: false, kind: 'inapplicable', reason: 'mcp not advertised at major 2' };
  if (facet['serverMount'] === undefined) return { ok: false, kind: 'inapplicable', reason: 'mcp is advertised without serverMount — the host serves no MCP mount to hold to the receiver rule' };
  const urls = Array.isArray(facet['serverUrls']) ? (facet['serverUrls'] as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
  if (urls.length === 0) return { ok: false, kind: 'blocked', reason: 'mcp.serverMount is advertised with no mcp.serverUrls[0] — the mount is unaddressable' };
  const u = urls[0]!;
  return { ok: true, url: /^https?:\/\//i.test(u) ? u : `${loadEnv().baseUrl}${u.startsWith('/') ? '' : '/'}${u}` };
}

interface RpcError { code: number; message?: string }
interface Rpc { status: number; result?: Record<string, unknown> | undefined; error?: RpcError | undefined }

async function mcpCall(url: string, method: string, params: Record<string, unknown>, extraMeta: Record<string, unknown>, headers: Record<string, string>): Promise<Rpc> {
  const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', 'MCP-Protocol-Version': REV, 'Mcp-Method': method, ...headers };
  if (method === 'tools/call' && typeof params['name'] === 'string') h['Mcp-Name'] = params['name'];
  const key = loadEnv().apiKey; if (key) h['authorization'] = `Bearer ${key}`;
  const res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: randomBytes(4).readUInt32BE(0), method, params: { ...params, _meta: { [META_V]: REV, [META_C]: {}, ...extraMeta } } }) });
  const text = await res.text();
  // A mount may answer a blocking call as one SSE message.
  const json = text.startsWith('event:') || text.startsWith('data:') ? (text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? '{}') : text;
  const body = (() => { try { return JSON.parse(json) as { result?: Record<string, unknown>; error?: RpcError }; } catch { return {}; } })();
  return { status: res.status, ...body };
}

async function mountTools(url: string): Promise<string[]> {
  const r = await mcpCall(url, 'tools/list', {}, {}, {}).catch(() => null);
  const tools = (r?.result?.['tools'] ?? []) as Array<{ name?: unknown }>;
  return tools.map((t) => String(t.name ?? ''));
}

async function a2aInterface(): Promise<Target> {
  if (!(await v2Discovery().catch(() => null))) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const a2a = await familyAdvertised('a2a');
  if (!a2a) return { ok: false, kind: 'inapplicable', reason: 'a2a not advertised at major 2' };
  const profiles = Array.isArray(a2a['profiles']) ? (a2a['profiles'] as unknown[]) : [];
  if (!profiles.includes('a2a-1.0')) return { ok: false, kind: 'inapplicable', reason: 'a2a is advertised without profile a2a-1.0 — the host serves no A2A interface (client path only)' };
  const cardUrl = a2a['agentCardUrl'];
  if (typeof cardUrl !== 'string') return { ok: false, kind: 'blocked', reason: 'a2a-1.0 is claimed with no a2a.agentCardUrl (v2-a2a-operation-map owns that failure)' };
  const res = await fetch(cardUrl, { headers: { accept: 'application/json', 'A2A-Version': '1.0' } }).catch(() => null);
  const card = (await res?.json().catch(() => ({}))) as { supportedInterfaces?: Array<{ url?: string; protocolBinding?: string; protocolVersion?: string }> } | undefined;
  const iface = (card?.supportedInterfaces ?? []).find((i) => i.protocolBinding === 'JSONRPC' && i.protocolVersion === '1.0');
  if (typeof iface?.url !== 'string') return { ok: false, kind: 'blocked', reason: 'the card lists no JSONRPC interface at 1.0 (v2-a2a-operation-map owns that failure)' };
  return { ok: true, url: iface.url };
}

async function a2aCall(url: string, method: string, params: unknown, headers: Record<string, string>): Promise<Rpc> {
  const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', 'A2A-Version': '1.0', ...headers };
  const key = loadEnv().apiKey; if (key) h['authorization'] = `Bearer ${key}`;
  const res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: randomBytes(4).readUInt32BE(0), method, params }) });
  const body = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown>; error?: RpcError };
  return { status: res.status, ...body };
}

const a2aMessage = (metadata: Record<string, unknown>): Record<string, unknown> => ({ message: { messageId: randomUUID(), role: 'ROLE_USER', parts: [{ text: 'rfc 0207 trace context' }], metadata } });

/** Best-effort cleanup of a task an A2A leg started (the approval fixture waits forever otherwise). */
async function cancelTask(url: string, r: Rpc): Promise<void> {
  const res = r.result ?? {};
  const id = ((res['task'] as { id?: unknown } | undefined)?.id ?? res['id']) as unknown;
  if (typeof id === 'string') await a2aCall(url, 'CancelTask', { id }, {}).catch(() => undefined);
}

/** Spans the suite collector received for trace `traceId` within `ms`. */
async function spansFor(traceId: string, ms: number): Promise<number> {
  const c = getCollector(); if (!c) return 0;
  const t0 = Date.now();
  for (;;) {
    const n = c.spans().filter((s) => s.traceId.toLowerCase() === traceId).length;
    if (n > 0 || Date.now() - t0 > ms) return n;
    await sleep(200);
  }
}

/** What the mount adopted, read from one observation path; null when the path cannot see it. */
interface Adopted { readonly path: string; readonly traces: readonly string[]; readonly error: RpcError | undefined }

/**
 * Path 1 — black-box, no OTLP: call `conformance-mcp-client` as a tool; the run
 * it starts calls the suite's fake server, and the trace on THAT call is the
 * parent the host adopted.
 */
async function viaOutboundCall(url: string, tools: readonly string[], metaTp: string, headerTp: string): Promise<Adopted | null> {
  const fake = getMcpFakeServer();
  if (!tools.includes(MCP_FIXTURE) || fake === null || (await familyAdvertised('mcp'))?.['client'] !== true) return null;
  const nonce = randomUUID();
  const r = await mcpCall(url, 'tools/call', { name: MCP_FIXTURE, arguments: { method: 'callTool', serverId: 'conformance', name: 'structured-echo', arguments: { nonce } } }, { traceparent: metaTp }, { traceparent: headerTp });
  const sent = await waitFor(() => callWithNonce(fake.invocations(), nonce), 5_000);
  if (sent === undefined) return null;
  const traces = [mcpMetaTraceparent(sent.params), sent.headers['traceparent']].map((v) => parseTraceparent(v)?.traceId).filter((t): t is string => t !== undefined);
  return traces.length > 0 ? { path: 'the outbound call of the run the mount started', traces, error: r.error } : null;
}

/** Path 2 — the suite's OTLP collector: spans for a noop call on trace T or H. */
async function viaCollector(url: string, tools: readonly string[], t: string, h: string, metaTp: string, headerTp: string): Promise<Adopted | null> {
  const c = getCollector();
  if (c === null || !tools.includes(NOOP)) return null;
  c.reset();
  const r = await mcpCall(url, 'tools/call', { name: NOOP, arguments: {} }, { traceparent: metaTp }, { traceparent: headerTp });
  const onT = await spansFor(t, 5_000);
  const onH = await spansFor(h, 500);
  if (onT + onH === 0) return null;
  return { path: 'the spans exported to the suite collector', traces: [...(onT > 0 ? [t] : []), ...(onH > 0 ? [h] : [])], error: r.error };
}

describe('RFC 0207 — outbound carriers (host as MCP / A2A client)', () => {
  it('MCP: the run path carries the suite trace into the tools/call it makes (ctx.mcp)', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const facet = await familyAdvertised('mcp');
    if (!facet || facet['client'] !== true) return softSkip('inapplicable', 'mcp.client not advertised — no run path makes an outbound MCP call (the §23 seam leg covers the client)');
    if (!isFixtureAdvertised(MCP_FIXTURE)) return softSkip('blocked', `mcp.client is advertised without the ${MCP_FIXTURE} fixture — the run path cannot be driven`);
    const fake = getMcpFakeServer();
    if (fake === null) return softSkip('blocked', 'the suite MCP fake server (OPENWOP_MCP_FAKE_SERVER=true) is not started in this run');
    const tp = makeTraceparent();
    const nonce = randomUUID();
    const created = await http(() => driver.post('/runs', { workflowId: MCP_FIXTURE, inputs: { method: 'callTool', serverId: 'conformance', name: 'structured-echo', arguments: { nonce } } }, { headers: { traceparent: tp.header } }));
    const runId = (created?.json as { runId?: unknown } | null)?.runId;
    if (created?.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs answered ${created?.status ?? 'nothing'} — the ${MCP_FIXTURE} run was refused`);
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000) {
      const snap = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
      if (TERMINAL.has(String((snap?.json as { status?: unknown } | null)?.status ?? ''))) break;
      await sleep(200);
    }
    const sent = await waitFor(() => callWithNonce(fake.invocations(), nonce), 2_000);
    if (!sent) return softSkip('blocked', 'the suite fake server received no structured-echo call carrying this run\'s nonce — the host\'s "conformance" binding does not reach this suite\'s server');
    const v = carried('run path (ctx.mcp.callTool)', mcpMetaTraceparent(sent.params), sent.headers['traceparent'], tp.traceId, MCP_NAMES);
      expect(v.ok, req(MCP_CARRIED, DOC, v.message)).toBe(true);
  });

  it('MCP: the §23 invoke seam carries the suite trace into tools/call', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await familyAdvertised('mcp'))) return softSkip('inapplicable', 'mcp not advertised at major 2 — no MCP client to hold');
    if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'the client leg is driven through the §23 invoke seam — conformance.seamsProfile is not openwop-conformance-seams-v2');
    const server = new McpFakeServer({ protocolVersions: ['2026-07-28'] });
    await server.start();
    try {
      const tp = makeTraceparent();
      const nonce = randomUUID();
      const res = await http(() => driver.post(`${SEAMS_PREFIX}/sample/mcp/invoke`, { serverUrl: server.hostFacingEndpoint(), tool: 'structured-echo', arguments: { nonce } }, { headers: { traceparent: tp.header } }));
      if (res === null) return softSkip('blocked', `${SEAMS_PREFIX}/sample/mcp/invoke unreachable (fetch failed)`);
      if (res.status === 404 || res.status === 403 || res.status === 405) return seamAbsent(`host advertises mcp but ${SEAMS_PREFIX}/sample/mcp/invoke answered ${res.status} (host-sample-test-seams.md §23)`);
      const sent = callWithNonce(server.invocations(), nonce);
      if (!sent) return softSkip('blocked', `the seam answered ${res.status} and the suite server received no tools/call carrying the nonce — the host's MCP client never reached it`);
      const v = carried('§23 seam (tools/call)', mcpMetaTraceparent(sent.params), sent.headers['traceparent'], tp.traceId, MCP_NAMES);
      expect(v.ok, req(MCP_CARRIED, DOC, v.message)).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('A2A: the §22 invoke seam carries the suite trace into SendMessage', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await familyAdvertised('a2a'))) return softSkip('inapplicable', 'a2a not advertised at major 2 — no A2A client to hold');
    if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'the client leg is driven through the §22 invoke seam — conformance.seamsProfile is not openwop-conformance-seams-v2');
    const peer = new A2AFakePeer({ protocolVersions: ['1.0'] });
    await peer.start();
    try {
      const tp = makeTraceparent();
      const res = await http(() => driver.post(`${SEAMS_PREFIX}/sample/a2a/invoke`, { peerUrl: peer.hostFacingEndpoint() }, { headers: { traceparent: tp.header } }));
      if (res === null) return softSkip('blocked', `${SEAMS_PREFIX}/sample/a2a/invoke unreachable (fetch failed)`);
      if (res.status === 404 || res.status === 403 || res.status === 405) return seamAbsent(`host advertises a2a but ${SEAMS_PREFIX}/sample/a2a/invoke answered ${res.status} (host-sample-test-seams.md §22)`);
      const sent = peer.invocations().find((i) => i.rpcMethod === 'SendMessage' || i.rpcMethod === 'message/send');
      if (!sent) return softSkip('blocked', `the seam answered ${res.status} and the suite peer received no SendMessage — the host's A2A client never reached it`);
      const v = carried('§22 seam (SendMessage)', a2aMetadataTraceparent(sent.body), sent.headers['traceparent'], tp.traceId, A2A_NAMES);
      expect(v.ok, req(A2A_CARRIED, DOC, v.message)).toBe(true);
    } finally {
      await peer.stop();
    }
  });
});

describe('RFC 0207 — the receiver rule (host as MCP server / A2A server)', () => {
  it('MCP mount: params._meta.traceparent is the parent, not the transport header', async () => {
    const m = await mcpMount(); if (!m.ok) return softSkip(m.kind, m.reason);
    const T = makeTraceparent(); const H = makeTraceparent();
    const tools = await mountTools(m.url);
    const seen = (await viaOutboundCall(m.url, tools, T.header, H.header)) ?? (await viaCollector(m.url, tools, T.traceId, H.traceId, T.header, H.header));
    if (seen === null) return softSkip('inapplicable', 'no observation path reached the suite: the mount serves no MCP-client tool whose outbound call carries a trace, and no span for the call arrived at the suite OTLP collector (REQUIRES_HOST_CALLBACK)');
    expect(seen.error, req(ADOPTS_META, DOC, `the mount call MUST succeed (observed through ${seen.path})`)).toBeUndefined();
    expect(seen.traces.includes(H.traceId), req(ADOPTS_META, DOC, `the host parented its work on the transport header's trace (${H.traceId}) although params._meta.traceparent (${T.traceId}) was present — the receiver MUST prefer the in-message value (observed through ${seen.path})`)).toBe(false);
    expect(seen.traces.every((t) => t === T.traceId), req(ADOPTS_META, DOC, `the work the call started MUST continue the params._meta trace ${T.traceId}; observed [${seen.traces.join(', ')}] through ${seen.path}`)).toBe(true);
  });

  it('MCP mount: a malformed params._meta.traceparent is ignored, never an error', async () => {
    const m = await mcpMount(); if (!m.ok) return softSkip(m.kind, m.reason);
    if (!(await mountTools(m.url)).includes(NOOP)) return softSkip('blocked', `the mount does not serve ${NOOP} as a tool (conformance/fixtures.md) — the malformed-value leg has nothing to call`);
    const r = await mcpCall(m.url, 'tools/call', { name: NOOP, arguments: {} }, { traceparent: 'garbage', tracestate: '=,=' }, { traceparent: 'garbage' });
    expect(r.error, req(MCP_MALFORMED, DOC, `a malformed traceparent MUST be ignored (a new trace starts), never a request failure — the mount answered JSON-RPC error ${JSON.stringify(r.error)}`)).toBeUndefined();
    expect(r.result, req(MCP_MALFORMED, DOC, 'the call MUST answer a normal result')).toBeDefined();
    expect(r.result?.['isError'] === true, req(MCP_MALFORMED, DOC, 'the noop tool MUST complete normally despite the malformed value')).toBe(false);
  });

  it('A2A interface: a malformed metadata.openwop.traceparent is ignored, never an error', async () => {
    const t = await a2aInterface(); if (!t.ok) return softSkip(t.kind, t.reason);
    const r = await a2aCall(t.url, 'SendMessage', a2aMessage({ openwop: { traceparent: 'garbage' } }), { traceparent: 'garbage' });
    try {
      expect(r.error, req(A2A_MALFORMED, DOC, `a malformed traceparent MUST be ignored, never a request failure — SendMessage answered error ${JSON.stringify(r.error)}`)).toBeUndefined();
      expect(r.result, req(A2A_MALFORMED, DOC, 'SendMessage MUST answer a normal result')).toBeDefined();
    } finally {
      await cancelTask(t.url, r);
    }
  });

  it('A2A interface: metadata.openwop.traceparent is the parent, not the transport header', async () => {
    const t = await a2aInterface(); if (!t.ok) return softSkip(t.kind, t.reason);
    if (getCollector() === null) return softSkip('inapplicable', 'the suite OTLP collector is not started — the inbound A2A adopt rule is observable only through exported spans (REQUIRES_HOST_CALLBACK)');
    getCollector()!.reset();
    const T = makeTraceparent(); const H = makeTraceparent();
    const r = await a2aCall(t.url, 'SendMessage', a2aMessage({ openwop: { traceparent: T.header } }), { traceparent: H.header });
    try {
      const onT = await spansFor(T.traceId, 5_000);
      const onH = await spansFor(H.traceId, 500);
      if (onT + onH === 0) return softSkip('inapplicable', 'no span for the SendMessage arrived at the suite OTLP collector — the host exports no OTLP to this suite (REQUIRES_HOST_CALLBACK)');
      expect(onH, req(A2A_INBOUND, DOC, `the host exported ${onH} span(s) on the transport header's trace although Message.metadata.openwop.traceparent was present — the receiver MUST prefer the metadata value`)).toBe(0);
      expect(onT, req(A2A_INBOUND, DOC, 'the run the message started MUST carry the metadata trace')).toBeGreaterThan(0);
    } finally {
      await cancelTask(t.url, r);
    }
  });
});
