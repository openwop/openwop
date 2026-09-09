/**
 * RFC 0153 §B — `server/discover`, stateless `_meta`, header/body agreement,
 * and the version error — pinned on the suite's own MCP server (server-free),
 * plus the host half against a host that claims `mcp-2026-07-28`.
 *
 * Peer half (always-on): `McpFakeServer` became dual-era at suite 1.113.0.
 * A server that is 2026-07-28-shaped only in its comments would let every §B/§C
 * host leg pass against a 2025-06-18 wire and prove nothing, so this file
 * drives it from the wire: `server/discover` (`resultType`, `supportedVersions`,
 * cache hints, `_meta.serverInfo`), `_meta.protocolVersion` REQUIRED, header ≠
 * body ⇒ `-32020`, unsupported ⇒ `-32022` + `data.supported[]`, header-less ⇒
 * legacy semantics on a dual-era server / `-32022` on a current-only server,
 * `initialize` under the current revision ⇒ method-not-found (loud).
 *
 * Host half (gated on `mcp.profiles ∋ mcp-2026-07-28`, hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`): the host's own MCP mount answers
 * `server/discover` with `supportedVersions[]` EQUAL to
 * `capabilities.mcp.protocolVersions` (two documents, one fact — `mcp-integration.md`
 * §B), `resultType: "complete"`, `ttlMs`/`cacheScope`; a header/body mismatch is
 * refused `400` + `-32020`; an unsupported revision is refused `400` + `-32022`.
 * A 2025-06-18 host soft-skips (`blocked`).
 *
 * @see spec/v1/mcp-integration.md §"MCP 2026-07-28 versioned composition" §B
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { driver } from '../lib/driver.js';
import { seamAbsent } from '../lib/soft-skip.js';
import { mcpServerMount } from '../lib/mcp-mount.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { McpFakeServer, MCP_ERR } from '../lib/mcp-fake-server.js';
import { req } from '../lib/requirement-ids.js';

// The first describe drives the in-process McpFakeServer itself; the second (gated) describe
// talks to the host's own MCP server mount and hands it nothing harness-hosted.
export const HOST_CALLBACK_NOT_REQUIRED = 'the suite drives both ends itself: the fake-server legs read the in-process McpFakeServer directly and the host-as-server legs POST to the host mount; no harness endpoint is handed to the host';

const META_V = 'io.modelcontextprotocol/protocolVersion';
const META_C = 'io.modelcontextprotocol/clientCapabilities';
const META_S = 'io.modelcontextprotocol/serverInfo';

async function call(endpoint: string, method: string, params: Record<string, unknown>, opts: { version?: string; mcpMethod?: string; mcpName?: string; withMeta?: boolean } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.version !== undefined) headers['MCP-Protocol-Version'] = opts.version;
  if (opts.mcpMethod !== undefined) headers['Mcp-Method'] = opts.mcpMethod;
  if (opts.mcpName !== undefined) headers['Mcp-Name'] = opts.mcpName;
  const withMeta = opts.withMeta ?? true;
  const p = withMeta && opts.version ? { ...params, _meta: { [META_V]: opts.version, [META_C]: {}, ...((params['_meta'] as Record<string, unknown> | undefined) ?? {}) } } : params;
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: p }) });
  const body = (await res.json()) as { result?: Record<string, unknown>; error?: { code: number; message: string; data?: Record<string, unknown> } };
  return { status: res.status, ...body };
}

describe('RFC 0153 §B — the suite MCP server speaks 2026-07-28 (dual-era McpFakeServer)', () => {
  const server = new McpFakeServer();
  beforeAll(async () => server.start(0));
  afterAll(async () => server.stop());

  it('server/discover: resultType complete, supportedVersions, capabilities, cache hints, _meta.serverInfo', async () => {
    const r = await call(server.endpoint(), 'server/discover', {}, { version: '2026-07-28', mcpMethod: 'server/discover' });
    expect(r.error, req('openwop.it.mcp-2026-07-28-discover.server-discover-resulttype-complete-supportedversions-capabilities-cache-hints-m', 'RFC 0153 §B', 'server/discover: resultType complete, supportedVersions, capabilities, cache hints, _meta.serverInfo')).toBeUndefined();
    expect(r.result?.['resultType']).toBe('complete');
    expect(r.result?.['supportedVersions']).toEqual(['2026-07-28', '2025-06-18']);
    expect(typeof r.result?.['ttlMs']).toBe('number');
    expect(['public', 'private']).toContain(r.result?.['cacheScope']);
    expect((r.result?.['_meta'] as Record<string, unknown>)[META_S]).toBeDefined();
  });

  it('a request without _meta.protocolVersion under the current revision is refused -32020', async () => {
    const r = await call(server.endpoint(), 'tools/list', {}, { version: '2026-07-28', withMeta: false });
    expect(r.status, req('openwop.it.mcp-2026-07-28-discover.a-request-without-meta-protocolversion-under-the-current-revision-is-refused-320', 'RFC 0153 §B', 'a request without _meta.protocolVersion under the current revision is refused -32020')).toBe(400);
    expect(r.error?.code).toBe(MCP_ERR.HEADER_MISMATCH);
  });

  it('header ≠ body revision ⇒ -32020 HeaderMismatch (400); Mcp-Method ≠ method ⇒ -32020', async () => {
    const r1 = await call(server.endpoint(), 'tools/list', { _meta: { [META_V]: '2025-11-25', [META_C]: {} } }, { version: '2026-07-28', withMeta: false });
    expect(r1.status, req('openwop.it.mcp-2026-07-28-discover.header-body-revision-32020-headermismatch-400-mcp-method-method-32020', 'RFC 0153 §B', 'header ≠ body revision ⇒ -32020 HeaderMismatch (400); Mcp-Method ≠ method ⇒ -32020')).toBe(400);
    expect(r1.error?.code).toBe(MCP_ERR.HEADER_MISMATCH);
    const r2 = await call(server.endpoint(), 'tools/list', {}, { version: '2026-07-28', mcpMethod: 'tools/call' });
    expect(r2.error?.code).toBe(MCP_ERR.HEADER_MISMATCH);
  });

  it('an unsupported revision ⇒ -32022 UnsupportedProtocolVersion with data.supported[] (400)', async () => {
    const r = await call(server.endpoint(), 'tools/list', {}, { version: '1999-01-01' });
    expect(r.status, req('openwop.it.mcp-2026-07-28-discover.an-unsupported-revision-32022-unsupportedprotocolversion-with-data-supported-400', 'RFC 0153 §B', 'an unsupported revision ⇒ -32022 UnsupportedProtocolVersion with data.supported[] (400)')).toBe(400);
    expect(r.error?.code).toBe(MCP_ERR.UNSUPPORTED_PROTOCOL_VERSION);
    expect(r.error?.data?.['supported']).toEqual(['2026-07-28', '2025-06-18']);
    expect(r.error?.data?.['requested']).toBe('1999-01-01');
  });

  it('header-less ⇒ legacy semantics on a dual-era server (initialize works); ⇒ -32022 on a current-only server', async () => {
    const legacy = await call(server.endpoint(), 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '0' } });
    expect(legacy.error, req('openwop.it.mcp-2026-07-28-discover.header-less-legacy-semantics-on-a-dual-era-server-initialize-works-32022-on-a-cu', 'RFC 0153 §B', 'header-less ⇒ legacy semantics on a dual-era server (initialize works); ⇒ -32022 on a current-only server')).toBeUndefined();
    expect(typeof legacy.result?.['protocolVersion']).toBe('string');
    const only = new McpFakeServer({ protocolVersions: ['2026-07-28'] });
    await only.start(0);
    try {
      const r = await call(only.endpoint(), 'tools/list', {});
      expect(r.status).toBe(400);
      expect(r.error?.code).toBe(MCP_ERR.UNSUPPORTED_PROTOCOL_VERSION);
    } finally {
      await only.stop();
    }
  });

  it('initialize under 2026-07-28 is method-not-found — the handshake does not exist in this revision', async () => {
    const r = await call(server.endpoint(), 'initialize', {}, { version: '2026-07-28' });
    expect(r.status, req('openwop.it.mcp-2026-07-28-discover.initialize-under-2026-07-28-is-method-not-found-the-handshake-does-not-exist-in', 'RFC 0153 §B', 'initialize under 2026-07-28 is method-not-found — the handshake does not exist in this revision')).toBe(404);
    expect(r.error?.code).toBe(-32601);
  });

  it('tools/list @2026-07-28 carries resultType + CacheableResult hints and lists the MRTR tool', async () => {
    const r = await call(server.endpoint(), 'tools/list', {}, { version: '2026-07-28', mcpMethod: 'tools/list' });
    expect(r.result?.['resultType'], req('openwop.it.mcp-2026-07-28-discover.tools-list-2026-07-28-carries-resulttype-cacheableresult-hints-and-lists-the-mrt', 'RFC 0153 §B', 'tools/list @2026-07-28 carries resultType + CacheableResult hints and lists the MRTR tool')).toBe('complete');
    expect(typeof r.result?.['ttlMs']).toBe('number');
    expect(r.result?.['cacheScope']).toBe('public');
    const names = (r.result?.['tools'] as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(['echo', 'needs_input']);
    // legacy list does NOT carry the current-revision fields
    const legacy = await call(server.endpoint(), 'tools/list', {});
    expect(legacy.result?.['ttlMs']).toBeUndefined();
  });

  it('MRTR: needs_input answers input_required (elicitation + opaque requestState) and completes on the retry; missing capability ⇒ -32021', async () => {
    server.reset();
    const noCap = await call(server.endpoint(), 'tools/call', { name: 'needs_input', arguments: {} }, { version: '2026-07-28', mcpMethod: 'tools/call', mcpName: 'needs_input' });
    expect(noCap.error?.code, req('openwop.it.mcp-2026-07-28-discover.mrtr-needs-input-answers-input-required-elicitation-opaque-requeststate-and-comp', 'RFC 0153 §B', 'MRTR: needs_input answers input_required (elicitation + opaque requestState) and completes on the retry; missing capability ⇒ -32021')).toBe(MCP_ERR.MISSING_REQUIRED_CLIENT_CAPABILITY);
    expect(noCap.error?.data?.['requiredCapabilities']).toEqual(['elicitation']);

    const first = await call(server.endpoint(), 'tools/call', { name: 'needs_input', arguments: {}, _meta: { [META_C]: { elicitation: {} } } }, { version: '2026-07-28', mcpMethod: 'tools/call', mcpName: 'needs_input' });
    expect(first.error).toBeUndefined();
    expect(first.result?.['resultType']).toBe('input_required');
    const reqs = first.result?.['inputRequests'] as Record<string, { method: string; params: { mode: string } }>;
    expect(reqs['who']?.method).toBe('elicitation/create');
    expect(reqs['who']?.params.mode).toBe('form');
    const state = first.result?.['requestState'];
    expect(typeof state).toBe('string');

    // Retry: NEW id, inputResponses + requestState echoed exactly.
    const retry = await call(server.endpoint(), 'tools/call', {
      name: 'needs_input', arguments: {}, requestState: state,
      inputResponses: { who: { action: 'accept', content: { name: 'Ada' } } },
      _meta: { [META_C]: { elicitation: {} } },
    }, { version: '2026-07-28', mcpMethod: 'tools/call', mcpName: 'needs_input' });
    expect(retry.error).toBeUndefined();
    expect(retry.result?.['resultType']).toBe('complete');
    expect(((retry.result?.['content'] as Array<{ text: string }>)[0]).text).toBe('hello Ada');

    // Tampered / missing state ⇒ refused
    const bad = await call(server.endpoint(), 'tools/call', {
      name: 'needs_input', arguments: {}, requestState: 'forged',
      inputResponses: { who: { action: 'accept', content: { name: 'Eve' } } },
      _meta: { [META_C]: { elicitation: {} } },
    }, { version: '2026-07-28', mcpMethod: 'tools/call', mcpName: 'needs_input' });
    expect(bad.error?.code).toBe(-32602);
    // Both calls were independent requests recorded under the current revision.
    expect(server.invocations().filter((i) => i.revision === '2026-07-28').length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Host half ───────────────────────────────────────────────────────────────

const PROFILE = 'mcp-2026-07-28';
interface McpCaps { readonly supported?: boolean; readonly protocolVersions?: readonly string[]; readonly profiles?: readonly string[]; readonly serverMount?: { supported?: boolean } }
async function mcp(): Promise<McpCaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<McpCaps>(disco.json, 'mcp');
}
async function claimsCurrent(): Promise<boolean> {
  const caps = await mcp();
  return caps?.supported === true && (caps.profiles ?? []).includes(PROFILE) && caps.serverMount?.supported === true;
}
async function hostRpc(method: string, params: Record<string, unknown>, headers: Record<string, string>) {
  // The reference host mounts its MCP server at /v1/host/sample/mcp (mcp-server-* scenarios).
  const res = await driver.post(await mcpServerMount(), { jsonrpc: '2.0', id: 1, method, params }, { headers });
  return { status: res.status, body: res.json as { result?: Record<string, unknown>; error?: { code: number; data?: Record<string, unknown> } } };
}

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0153 §B — host as MCP server: server/discover and version refusal (gated on mcp.profiles ∋ mcp-2026-07-28)', () => {
  it('server/discover reports supportedVersions equal to capabilities.mcp.protocolVersions, with resultType + cache hints', async () => {
    if (!behaviorGate(PROFILE, await claimsCurrent())) return;
    const caps = (await mcp())!;
    const r = await hostRpc('server/discover', { _meta: { [META_V]: '2026-07-28', [META_C]: {} } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover' });
    if (r.status === 404 || r.status === 403) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${r.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    expect(r.status, req('openwop.it.mcp-2026-07-28-discover.server-discover-reports-supportedversions-equal-to-capabilities-mcp-protocolvers', 'mcp-integration.md §B', 'server/discover is a server MUST under 2026-07-28')).toBe(200);
    expect(r.body.result?.['resultType']).toBe('complete');
    expect([...((r.body.result?.['supportedVersions'] as string[] | undefined) ?? [])].sort(), req('openwop.it.mcp-2026-07-28-discover.server-discover-reports-supportedversions-equal-to-capabilities-mcp-protocolvers', 'mcp-integration.md §B', 'server/discover.supportedVersions MUST equal capabilities.mcp.protocolVersions — two documents, one fact')).toEqual([...(caps.protocolVersions ?? [])].sort());
    expect(typeof r.body.result?.['ttlMs'], req('openwop.it.mcp-2026-07-28-discover.server-discover-reports-supportedversions-equal-to-capabilities-mcp-protocolvers', 'mcp-integration.md §D', 'server/discover is cacheable: ttlMs REQUIRED')).toBe('number');
    expect(['public', 'private']).toContain(r.body.result?.['cacheScope']);
  });

  it('a header/body revision mismatch is refused 400 + -32020; an unsupported revision 400 + -32022', async () => {
    if (!behaviorGate(PROFILE, await claimsCurrent())) return;
    // Header ≠ body with a body revision the host DOES support, so the leg
    // isolates HeaderMismatchError (-32020) from UnsupportedProtocolVersion
    // (-32022). The earlier vector (`2025-11-25` in the body) was BOTH
    // mismatched and unsupported, and a host that checked support first
    // answered -32022 — the leg was testing an unstated precedence
    // (mcp-integration.md §B: agreement is checked before selection).
    const mismatch = await hostRpc('tools/list', { _meta: { [META_V]: '2025-06-18', [META_C]: {} } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' });
    if (mismatch.status === 404 || mismatch.status === 403) return seamAbsent(`host advertises an MCP server mount but the mount (capabilities.mcp.serverUrls[0], else /v1/host/sample/mcp) answered ${mismatch.status} — RFC 0153 §B is unobservable at the path the host itself advertised`);
    expect(mismatch.status, req('openwop.it.mcp-2026-07-28-discover.a-header-body-revision-mismatch-is-refused-400-32020-an-unsupported-revision-400', 'mcp-integration.md §B', 'header ≠ body MUST be refused 400 (HeaderMismatchError -32020) — fail closed')).toBe(400);
    expect(mismatch.body.error?.code).toBe(MCP_ERR.HEADER_MISMATCH);
    const unsupported = await hostRpc('tools/list', { _meta: { [META_V]: '1999-01-01', [META_C]: {} } }, { 'MCP-Protocol-Version': '1999-01-01', 'Mcp-Method': 'tools/list' });
    expect(unsupported.status, req('openwop.it.mcp-2026-07-28-discover.a-header-body-revision-mismatch-is-refused-400-32020-an-unsupported-revision-400', 'mcp-integration.md §B', 'an unsupported revision MUST be refused 400 (UnsupportedProtocolVersionError -32022)')).toBe(400);
    expect(unsupported.body.error?.code).toBe(MCP_ERR.UNSUPPORTED_PROTOCOL_VERSION);
    expect(Array.isArray(unsupported.body.error?.data?.['supported']), req('openwop.it.mcp-2026-07-28-discover.a-header-body-revision-mismatch-is-refused-400-32020-an-unsupported-revision-400', 'mcp-integration.md §B', 'the refusal MUST list data.supported[]')).toBe(true);
  });
});
