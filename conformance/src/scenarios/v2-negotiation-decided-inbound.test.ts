/**
 * RFC 0242 §B — an inbound negotiation is recorded as a durable host event
 * (suite 2.46.0, target major 2; gated on an inbound a2a/mcp surface).
 *
 * `spec/v2/core/interop.md` §The audit event: every negotiation outcome MUST
 * emit a `negotiation.decided` record — on its run's log, or, with no run, as
 * the caller's durable host event (`schemas/v2/host-event.schema.json`,
 * `payload` = `run-event-payloads.schema.json#/$defs/negotiationDecided`). A
 * host serving either protocol inbound (`a2a.agentCardUrl`, `mcp.serverUrls`,
 * `mcp.serverMount`) MUST list the type as durable in `hostEvents.types[]`,
 * and `requested` MUST carry the version the caller named.
 *
 * How it is witnessed, with no seam: the suite reads discovery for §B.3, then
 * acts as an authenticated inbound client. With `/host/events` open it makes
 * one exchange naming `preferredVersion` (expected `accepted`) and one naming
 * a version below the floor (expected `refused`), and finds each record by its
 * `requested`. A2A names the version in `A2A-Version` on a JSON-RPC `GetTask`
 * for a task that does not exist; MCP names it in `MCP-Protocol-Version` and
 * `_meta` on `tools/list`. Neither call changes host state.
 *
 * @see RFCS/0242-negotiation-decided-requested-and-inbound.md
 * @see spec/v2/core/interop.md §Negotiation is a protocol
 * @see spec/v2/core/events.md §Host events
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { v2Discovery, familyAdvertised, v2Validator } from '../lib/v2.js';
import { loadEnv } from '../lib/env.js';
import { subscribe } from '../lib/sse.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { EVENT, inboundServed, judgeInboundRecord, judgeListed } from '../lib/negotiation-record.js';

const DOC = 'interop.md §The audit event';
const ID_LISTED = 'openwop.requirement.0242.inbound.listed';
const ID_A2A = 'openwop.requirement.0242.inbound.recorded';
const ID_A2A_REFUSED = 'openwop.requirement.0242.inbound.refused';
const ID_MCP = 'openwop.requirement.0242.inbound.recorded.mcp';
const ID_MCP_REFUSED = 'openwop.requirement.0242.inbound.refused.mcp';
const A2A_BELOW = '0.3';
const MCP_BELOW = '2025-06-18';
const META_V = 'io.modelcontextprotocol/protocolVersion';
const STREAM_MS = 3_000;

const hostEvent = v2Validator('host-event');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const absolute = (u: string): string => (/^https?:\/\//i.test(u) ? u : `${loadEnv().baseUrl}${u.startsWith('/') ? '' : '/'}${u}`);

/** `a.b` versions and ISO-date revisions both order correctly as compared here. */
function below(candidate: string, floor: string): boolean {
  if (/^\d+\.\d+$/.test(candidate) && /^\d+\.\d+$/.test(floor)) {
    const [cm, cn] = candidate.split('.').map(Number);
    const [fm, fn] = floor.split('.').map(Number);
    return cm! < fm! || (cm === fm && cn! < fn!);
  }
  return candidate < floor;
}

type Surface = { url: string; preferred: string; floor: string };
type Gate = { ok: true; doc: Record<string, unknown>; surface: Surface } | { ok: false; kind: 'blocked' | 'inapplicable'; reason: string };

async function gate(protocol: 'a2a' | 'mcp'): Promise<Gate> {
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const facet = await familyAdvertised(protocol);
  if (!facet || !inboundServed(doc)[protocol]) return { ok: false, kind: 'inapplicable', reason: `the host serves no inbound ${protocol} surface (${protocol === 'a2a' ? 'a2a.agentCardUrl' : 'mcp.serverUrls / mcp.serverMount'} absent)` };
  if (!judgeListed(doc).ok) return { ok: false, kind: 'inapplicable', reason: `hostEvents.types[] does not list ${EVENT}, so the host emits no such host event; ${ID_LISTED} records that failure` };
  const preferred = facet['preferredVersion'];
  const floor = protocol === 'a2a' ? facet['minimumVersion'] : facet['minimumRevision'];
  if (typeof preferred !== 'string' || typeof floor !== 'string') return { ok: false, kind: 'blocked', reason: `the ${protocol} facet lacks preferredVersion or its floor` };
  if (protocol === 'mcp') {
    const urls = Array.isArray(facet['serverUrls']) ? (facet['serverUrls'] as unknown[]).filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
    if (urls.length === 0) return { ok: false, kind: 'blocked', reason: 'mcp is served inbound with no mcp.serverUrls[0] — the mount is unaddressable' };
    return { ok: true, doc, surface: { url: absolute(urls[0]!), preferred, floor } };
  }
  const res = await fetch(String(facet['agentCardUrl']), { headers: { accept: 'application/json', 'A2A-Version': preferred } }).catch(() => null);
  if (!res || res.status !== 200) return { ok: false, kind: 'blocked', reason: `the advertised agentCardUrl answered ${res?.status ?? 'nothing'}` };
  const card = (await res.json().catch(() => ({}))) as { supportedInterfaces?: Array<{ url?: string; protocolBinding?: string }> };
  const iface = (card.supportedInterfaces ?? []).find((i) => i.protocolBinding === 'JSONRPC' && typeof i.url === 'string');
  if (!iface) return { ok: false, kind: 'blocked', reason: 'the public agent card lists no JSONRPC interface to send an inbound request to' };
  return { ok: true, doc, surface: { url: absolute(iface.url!), preferred, floor } };
}

/** One inbound exchange naming `version`; the caller's bearer authenticates it (`interop.md` §Authentication). */
async function exchange(protocol: 'a2a' | 'mcp', url: string, version: string): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${loadEnv().apiKey}` };
  const id = randomBytes(4).readUInt32BE(0);
  let body: Record<string, unknown>;
  if (protocol === 'a2a') {
    headers['A2A-Version'] = version;
    body = { jsonrpc: '2.0', id, method: 'GetTask', params: { id: `conf-0242-${randomBytes(8).toString('hex')}` } };
  } else {
    headers['MCP-Protocol-Version'] = version;
    headers['Mcp-Method'] = 'tools/list';
    body = { jsonrpc: '2.0', id, method: 'tools/list', params: { _meta: { [META_V]: version } } };
  }
  await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.text()).catch(() => undefined);
}

/** Open `/host/events`, make the exchange, and return the parsed envelope of every `negotiation.decided` frame. */
async function recordsOf(protocol: 'a2a' | 'mcp', url: string, version: string): Promise<{ envelopes: Record<string, unknown>[]; invalid: string[] }> {
  const sub = subscribe('/host/events', { timeoutMs: STREAM_MS, extraHeaders: { 'OpenWOP-Version': '2.0' } });
  await sleep(400);
  await exchange(protocol, url, version);
  const frames = (await sub).events.filter((f) => f.event === EVENT);
  const envelopes: Record<string, unknown>[] = [];
  const invalid: string[] = [];
  for (const f of frames) {
    let env: unknown;
    try { env = JSON.parse(f.data); } catch { invalid.push('non-JSON data'); continue; }
    const v = hostEvent(env);
    if (!v.ok) invalid.push(v.errors);
    if (env && typeof env === 'object') envelopes.push(env as Record<string, unknown>);
  }
  return { envelopes, invalid };
}

async function inboundLeg(protocol: 'a2a' | 'mcp', id: string, which: 'accepted' | 'refused'): Promise<void> {
  const g = await gate(protocol);
  if (!g.ok) return softSkip(g.kind, g.reason);
  const candidate = protocol === 'a2a' ? A2A_BELOW : MCP_BELOW;
  if (which === 'refused' && !below(candidate, g.surface.floor)) {
    return softSkip('inapplicable', `the ${protocol} floor ${g.surface.floor} is at or below ${candidate}, the lowest version the suite can name — nothing below the floor to ask for`);
  }
  const named = which === 'accepted' ? g.surface.preferred : candidate;
  const { envelopes, invalid } = await recordsOf(protocol, g.surface.url, named);
  expect(invalid, req(id, 'events.md §Host events', `every ${EVENT} host event MUST validate against host-event.schema.json: ${invalid.join('; ')}`)).toEqual([]);
  for (const f of judgeInboundRecord(envelopes, { protocol, named, outcome: which })) expect(f.ok, req(id, DOC, f.message)).toBe(true);
}

describe('RFC 0242 §B — an inbound negotiation is a durable host event (gated on an inbound a2a/mcp surface)', () => {
  it('a host serving A2A or MCP inbound lists negotiation.decided as a durable host-event type', async () => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const served = inboundServed(doc);
    if (!served.a2a && !served.mcp) return softSkip('inapplicable', 'the host advertises no inbound A2A or MCP surface (a2a.agentCardUrl, mcp.serverUrls, mcp.serverMount)');
    const f = judgeListed(doc);
    expect(f.ok, req(ID_LISTED, DOC, f.message)).toBe(true);
  });
  it('an inbound A2A exchange at preferredVersion is recorded accepted, with requested', async () => {
    await inboundLeg('a2a', ID_A2A, 'accepted');
  });
  it('an inbound A2A exchange below minimumVersion is recorded refused, with requested', async () => {
    await inboundLeg('a2a', ID_A2A_REFUSED, 'refused');
  });
  it('an inbound MCP exchange at preferredVersion is recorded accepted, with requested', async () => {
    await inboundLeg('mcp', ID_MCP, 'accepted');
  });
  it('an inbound MCP exchange below minimumRevision is recorded refused, with requested', async () => {
    await inboundLeg('mcp', ID_MCP_REFUSED, 'refused');
  });
});
