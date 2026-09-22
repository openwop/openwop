/**
 * RFC 0204 §A — the v2 host MCP client returns MCP results (suite 2.36.0,
 * target major 2; gated on `mcp.client` + the `conformance-mcp-client` fixture).
 *
 * `spec/v2/core/host-services.md` §`mcp`: a host advertising `mcp.client`
 * exposes `ctx.mcp.callTool` / `listTools` / `readResource` / `serverHealth`
 * to pack code, and each resolves to the MCP result UNALTERED. The fixture's
 * node calls the host's own `ctx.mcp.<method>` with the run's inputs and
 * records the resolved value as `node.completed.outputs.result` (the v2
 * RunSnapshot carries no run outputs, so the event log is the observation
 * path — `GET /runs/{runId}/events/poll`).
 *
 * The expected value is never read from the host. Every leg compares the host's
 * output with the JSON-RPC result the suite's own fake MCP server recorded
 * sending (`McpFakeServer.exchanges()`), so a host that re-wraps, drops `_meta`,
 * merges pages or answers from a stub cannot reproduce it.
 *
 *   call-tool-verbatim       structured-echo with a per-run nonce → deep-equal
 *                            to the server's CallToolResult, `_meta` included;
 *   call-tool-iserror-resolves  always-error → the run completes and resolves
 *                            `isError: true` with the server's `content[]`;
 *   list-tools-page          run 1: one page, deep-equal, with `nextCursor`;
 *                            run 2 with that cursor: the server saw the cursor,
 *                            the page is deep-equal and has no `nextCursor`;
 *   server-health            `conformance` → reachable + the DiscoverResult;
 *                            `conformance.down` → unreachable; never
 *                            `connected` / `disconnected`;
 *   reject-unknown-server    an unconfigured `serverId` fails the node
 *                            `not_found`.
 *
 * Sabotage (RFC 0204 §Conformance), each run once against the v2 reference
 * host: resolve `{ result }`; strip `_meta`; throw on `isError`; merge pages;
 * drop the cursor; report `connected`; report `reachable` always; resolve
 * `undefined` for an unknown id — each turns its row red.
 *
 * @see spec/v2/core/host-services.md §mcp
 * @see RFCS/0204-host-mcp-client-returns-mcp-results.md §A
 * @see conformance/fixtures.md §"The `ctx.mcp` fixture (RFC 0204)"
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { getMcpFakeServer, ALWAYS_ERROR_CONTENT, TOOLS_PAGE_SIZE, type McpExchange, type McpFakeServer } from '../lib/mcp-fake-server.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = "the host's ctx.mcp client calls the suite's fake MCP server (serverId \"conformance\")";

const FIXTURE = 'conformance-mcp-client';
const NODE_ID = 'mcp-client';
const DOC = 'spec/v2/core/host-services.md §mcp';
const ID = {
  verbatim: 'openwop.requirement.0204.call-tool-verbatim',
  isError: 'openwop.requirement.0204.call-tool-iserror-resolves',
  page: 'openwop.requirement.0204.list-tools-page',
  health: 'openwop.requirement.0204.server-health',
  reject: 'openwop.requirement.0204.reject-unknown-server',
} as const;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const SESSION_WORDS = /"(dis)?connected"/i;

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);

/** The gate: the fake server, or the recorded reason the leg cannot run. */
type Gate = { fake: McpFakeServer } | { skip: ['inapplicable' | 'blocked', string] };
async function gate(): Promise<Gate> {
  const doc = await v2Discovery().catch(() => null);
  if (!doc) return { skip: ['blocked', 'v2 discovery unreachable'] };
  const facet = await familyAdvertised('mcp');
  if (!facet || facet['client'] !== true) return { skip: ['inapplicable', 'mcp.client not advertised — the host exposes no ctx.mcp to pack code (RFC 0204 §A.1)'] };
  if (!isFixtureAdvertised(FIXTURE)) return { skip: ['blocked', `the host advertises mcp.client but not the ${FIXTURE} fixture — ctx.mcp is claimed and cannot be observed`] };
  const fake = getMcpFakeServer();
  if (fake === null) return { skip: ['blocked', 'the suite MCP fake server (OPENWOP_MCP_FAKE_SERVER=true) is not started in this run'] };
  return { fake };
}

interface Outcome {
  readonly status: string;
  readonly result: unknown;
  readonly hasResult: boolean;
  readonly errorCode: string | null;
}

/** Run the fixture with `inputs` and read the node's terminal event. */
async function runFixture(inputs: Record<string, unknown>): Promise<Outcome | { reason: string }> {
  const created = await http(() => driver.post('/runs', { workflowId: FIXTURE, inputs }));
  if (created === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (created.json as { runId?: unknown } | null)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs answered ${created.status} ${readErrorCode(created.json) ?? ''} — the fixture run was refused`.trim() };
  const t0 = Date.now(); let status = '';
  while (Date.now() - t0 < 30_000) {
    const snap = await http(() => driver.get(`/runs/${enc(runId)}`));
    status = String((snap?.json as { status?: unknown } | null)?.status ?? '');
    if (TERMINAL.has(status)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!TERMINAL.has(status)) return { reason: `the ${FIXTURE} run did not reach a terminal status within 30 s (last: ${status || 'unreadable'})` };
  const ev = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  const events = (ev?.json as { events?: unknown } | null)?.events;
  if (ev?.status !== 200 || !Array.isArray(events)) return { reason: `GET /runs/{runId}/events/poll answered ${ev?.status ?? 'nothing'}` };
  const node = (type: string) => (events as Array<{ type?: unknown; payload?: Record<string, unknown> }>).find((e) => e.type === type && e.payload?.['nodeId'] === NODE_ID)?.payload;
  const completed = node('node.completed');
  const failed = node('node.failed');
  const outputs = (completed?.['outputs'] ?? {}) as Record<string, unknown>;
  const error = (failed?.['error'] ?? null) as { code?: unknown } | null;
  return { status, result: outputs['result'], hasResult: 'result' in outputs, errorCode: typeof error?.code === 'string' ? error.code : null };
}

function lastExchange(fake: McpFakeServer, pred: (x: McpExchange) => boolean): McpExchange | undefined {
  return [...fake.exchanges()].reverse().find(pred);
}
const paramsOf = (x: McpExchange): Record<string, unknown> => (x.params ?? {}) as Record<string, unknown>;

describe('RFC 0204 §A — ctx.mcp returns MCP results (gated on mcp.client)', () => {
  it('callTool resolves to the server CallToolResult unaltered, _meta included', async () => {
    const g = await gate(); if ('skip' in g) return softSkip(...g.skip);
    const fake = g.fake;
    const nonce = randomUUID();
    const out = await runFixture({ method: 'callTool', serverId: 'conformance', name: 'structured-echo', arguments: { nonce } });
    if ('reason' in out) return softSkip('blocked', out.reason);
    const sent = lastExchange(fake, (x) => x.method === 'tools/call' && paramsOf(x)['name'] === 'structured-echo' && (paramsOf(x)['arguments'] as { nonce?: unknown } | undefined)?.nonce === nonce);
    if (!sent) return softSkip('blocked', 'the suite fake server received no structured-echo call carrying this run\'s nonce — the host\'s "conformance" binding does not reach this suite\'s server');
    expect(out.status, req(ID.verbatim, DOC, `the run MUST complete (got ${out.status}, node error ${out.errorCode ?? 'none'})`)).toBe('completed');
    expect(out.hasResult, req(ID.verbatim, 'fixtures.md §The ctx.mcp fixture', 'node.completed.outputs.result MUST carry the resolved value')).toBe(true);
    expect(out.result, req(ID.verbatim, DOC, 'callTool MUST resolve to the server\'s CallToolResult unaltered — content[], structuredContent, isError and _meta, deep-equal to what the server sent')).toEqual(sent.result);
    expect((out.result as { _meta?: Record<string, unknown> } | undefined)?._meta?.['dev.openwop.conformance/nonce'], req(ID.verbatim, DOC, 'the result\'s _meta MUST survive (the per-run nonce is in it)')).toBe(nonce);
  });

  it('callTool resolves (does not reject) a result with isError: true', async () => {
    const g = await gate(); if ('skip' in g) return softSkip(...g.skip);
    const fake = g.fake;
    const out = await runFixture({ method: 'callTool', serverId: 'conformance', name: 'always-error', arguments: {} });
    if ('reason' in out) return softSkip('blocked', out.reason);
    const sent = lastExchange(fake, (x) => x.method === 'tools/call' && paramsOf(x)['name'] === 'always-error');
    if (!sent) return softSkip('blocked', 'the suite fake server received no always-error call — the host\'s "conformance" binding does not reach this suite\'s server');
    expect(out.status, req(ID.isError, DOC, `a tool error is a result, not a rejection: the run MUST complete (got ${out.status}, node error ${out.errorCode ?? 'none'})`)).toBe('completed');
    const r = out.result as { isError?: unknown; content?: unknown } | undefined;
    expect(r?.isError, req(ID.isError, DOC, 'the resolved CallToolResult MUST carry isError: true')).toBe(true);
    expect(r?.content, req(ID.isError, DOC, 'the resolved CallToolResult MUST carry the server\'s content[]')).toEqual([...ALWAYS_ERROR_CONTENT]);
    expect(out.result, req(ID.isError, DOC, 'the isError result MUST be the server\'s, unaltered')).toEqual(sent.result);
  });

  it('listTools resolves one ListToolsResult page unaltered and forwards the cursor', async () => {
    const g = await gate(); if ('skip' in g) return softSkip(...g.skip);
    const fake = g.fake;
    const first = await runFixture({ method: 'listTools', serverId: 'conformance' });
    if ('reason' in first) return softSkip('blocked', first.reason);
    const sent1 = lastExchange(fake, (x) => x.method === 'tools/list' && paramsOf(x)['cursor'] === undefined);
    if (!sent1) return softSkip('blocked', 'the suite fake server received no tools/list — the host\'s "conformance" binding does not reach this suite\'s server');
    expect(first.status, req(ID.page, DOC, `the listTools run MUST complete (got ${first.status}, node error ${first.errorCode ?? 'none'})`)).toBe('completed');
    const page1 = first.result as { tools?: Array<Record<string, unknown>>; nextCursor?: unknown } | undefined;
    expect(page1, req(ID.page, DOC, 'listTools MUST resolve to ONE ListToolsResult page unaltered — tools with outputSchema and annotations, nextCursor, ttlMs, cacheScope')).toEqual(sent1.result);
    expect(page1?.tools?.length, req(ID.page, DOC, `the page MUST NOT be merged with later pages (the server pages ${TOOLS_PAGE_SIZE} at a time)`)).toBe(TOOLS_PAGE_SIZE);
    expect(page1?.tools?.some((t) => t['outputSchema'] !== undefined && t['annotations'] !== undefined), req(ID.page, DOC, 'outputSchema and annotations MUST survive')).toBe(true);
    const cursor = page1?.nextCursor;
    expect(typeof cursor, req(ID.page, DOC, 'the first page MUST carry the server\'s nextCursor')).toBe('string');
    if (typeof cursor !== 'string') return softSkip('blocked', 'unreachable: the nextCursor assertion above failed');
    const second = await runFixture({ method: 'listTools', serverId: 'conformance', cursor });
    if ('reason' in second) return softSkip('blocked', second.reason);
    const sent2 = lastExchange(fake, (x) => x.method === 'tools/list' && paramsOf(x)['cursor'] === cursor);
    expect(sent2 !== undefined, req(ID.page, DOC, 'listTools MUST forward the pack\'s cursor to the server (no tools/list carried it)')).toBe(true);
    expect(second.status, req(ID.page, DOC, `the cursor run MUST complete (got ${second.status}, node error ${second.errorCode ?? 'none'})`)).toBe('completed');
    expect(second.result, req(ID.page, DOC, 'the cursor page MUST be the server\'s second page, unaltered')).toEqual(sent2?.result);
    expect((second.result as { nextCursor?: unknown } | undefined)?.nextCursor, req(ID.page, DOC, 'the last page carries no nextCursor')).toBeUndefined();
  });

  it('serverHealth reports reachability from server/discover, never a session state', async () => {
    const g = await gate(); if ('skip' in g) return softSkip(...g.skip);
    const fake = g.fake;
    const up = await runFixture({ method: 'serverHealth', serverId: 'conformance' });
    if ('reason' in up) return softSkip('blocked', up.reason);
    expect(up.status, req(ID.health, DOC, `the serverHealth run MUST complete (got ${up.status}, node error ${up.errorCode ?? 'none'})`)).toBe('completed');
    const h = up.result as { state?: unknown; discover?: { supportedVersions?: unknown } } | undefined;
    if (h?.state === 'unreachable' && !fake.exchanges().some((x) => x.method === 'server/discover')) {
      return softSkip('blocked', 'serverHealth("conformance") is unreachable and the suite fake server received no server/discover — the host\'s "conformance" binding does not reach this suite\'s server');
    }
    expect(h?.state, req(ID.health, DOC, 'a server whose server/discover succeeded with a revision the host negotiates MUST be reachable')).toBe('reachable');
    expect(h?.discover?.supportedVersions, req(ID.health, DOC, 'serverHealth MUST carry the DiscoverResult it received')).toEqual([...fake.protocolVersions()]);
    const sentDiscover = lastExchange(fake, (x) => x.method === 'server/discover');
    if (sentDiscover) expect(h?.discover, req(ID.health, DOC, 'the DiscoverResult MUST be the server\'s, unaltered')).toEqual(sentDiscover.result);
    expect(SESSION_WORDS.test(JSON.stringify(up.result ?? null)), req(ID.health, DOC, 'serverHealth MUST NOT report a connection or session state (connected / disconnected)')).toBe(false);
    const down = await runFixture({ method: 'serverHealth', serverId: 'conformance.down' });
    if ('reason' in down) return softSkip('blocked', down.reason);
    if (down.errorCode === 'not_found') return softSkip('blocked', 'the host has no "conformance.down" binding (fixtures.md operator contract) — the unreachable half cannot be observed');
    expect(down.status, req(ID.health, DOC, `serverHealth on an unanswering server resolves, it does not reject (got ${down.status}, node error ${down.errorCode ?? 'none'})`)).toBe('completed');
    expect((down.result as { state?: unknown } | undefined)?.state, req(ID.health, DOC, 'a server nothing answers MUST be unreachable')).toBe('unreachable');
    expect(SESSION_WORDS.test(JSON.stringify(down.result ?? null)), req(ID.health, DOC, 'serverHealth MUST NOT report a connection or session state')).toBe(false);
  });

  it('an unknown serverId rejects with not_found', async () => {
    const g = await gate(); if ('skip' in g) return softSkip(...g.skip);
    const out = await runFixture({ method: 'callTool', serverId: `no-such-${randomUUID().slice(0, 8)}`, name: 'echo', arguments: { text: 'x' } });
    if ('reason' in out) return softSkip('blocked', out.reason);
    expect(out.status, req(ID.reject, DOC, `a call to an unconfigured serverId MUST reject, failing the node (got ${out.status})`)).toBe('failed');
    expect(out.errorCode, req(ID.reject, DOC, 'the rejection MUST be not_found')).toBe('not_found');
  });
});
