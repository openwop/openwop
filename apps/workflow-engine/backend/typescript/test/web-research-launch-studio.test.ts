/**
 * host.webResearch + host.launchStudio — the last two vendor surfaces.
 *
 * webResearch: fetchBatch really fetches (against a mock HTTP server) and
 * extracts title + readable text; search returns an honest demo result;
 * research composes the two. launchStudio: getStudio returns the seeded studio
 * (null for unknown ids); buildProjectContext/resolveLinkedArtifacts derive
 * context; a launch-studio.linkStep node runs end-to-end (ctx.variables +
 * ctx.userId wired) and reports success.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/index.js';
import { buildHostSurfaceBundle } from '../src/host/inMemorySurfaces.js';

let server: http.Server;
let mock: http.Server;
let mockUrl: string;
const PORT = 18207;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  const app = await createApp({ port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false });
  await new Promise<void>((res) => { server = app.listen(PORT, res); });
  mock = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>Test Page</title></head><body><script>ignore()</script><p>Hello readable world.</p></body></html>');
  });
  await new Promise<void>((res) => mock.listen(0, res));
  mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/`;
});
afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
  await new Promise<void>((res) => mock.close(() => res()));
});

async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  return { status: res.status, body: (await res.json()) as T };
}

interface BundleEvent { type?: string; nodeId?: string; payload?: Record<string, unknown> }

async function runNode(workflowId: string, typeId: string, config: Record<string, unknown>, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  await jsonFetch('/v1/host/sample/workflows', { method: 'POST', body: JSON.stringify({ workflowId, nodes: [{ nodeId: 'op', typeId, config }], edges: [] }) });
  const create = await jsonFetch<{ runId: string }>('/v1/runs', { method: 'POST', body: JSON.stringify({ workflowId, inputs, tenantId: 'default' }) });
  expect(create.status).toBe(201);
  const { runId } = create.body;
  let status = 'pending';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
    status = snap.body.status;
    if (['completed', 'failed', 'cancelled'].includes(status)) break;
  }
  const bundle = await jsonFetch<{ events?: BundleEvent[] }>(`/v1/runs/${runId}/debug-bundle`);
  const ev = (bundle.body.events ?? []).find((e) => e.type === 'node.completed' && e.nodeId === 'op');
  return { __status: status, ...((ev?.payload?.outputs as Record<string, unknown>) ?? {}) };
}

describe('host.webResearch', () => {
  it('fetchUrls node really fetches + extracts title and readable text', async () => {
    const out = await runNode('wr.fetch', 'data.transform.fetchUrls', {}, { urls: [mockUrl] });
    expect(out.__status).toBe('completed');
    const pages = out.pages as Array<Record<string, unknown>>;
    expect(pages).toHaveLength(1);
    expect(pages[0]!.status).toBe(200);
    expect(pages[0]!.title).toBe('Test Page');
    expect(String(pages[0]!.extractedText)).toContain('Hello readable world.');
    expect(String(pages[0]!.extractedText)).not.toContain('ignore()'); // script stripped
  });

  it('search returns an honest demo result; research composes search + fetch', async () => {
    const wr = buildHostSurfaceBundle({ tenantId: 'default' }).webResearch;
    const s = await wr.search({ query: 'openwop protocol' });
    expect(s.engine).toBe('demo');
    expect(s.results[0]!.url).toContain('duckduckgo.com');
    const r = await wr.research({ query: 'openwop protocol', maxResults: 1 });
    expect(r.citations).toHaveLength(1);
    expect(typeof r.citations[0]!.content).toBe('string');
  });
});

describe('host.launchStudio', () => {
  const ls = () => buildHostSurfaceBundle({ tenantId: 'default' }).launchStudio;

  it('getStudio returns the seeded studio and null for unknown ids', async () => {
    const studio = await ls().getStudio('demo-launch-studio');
    expect(studio).not.toBeNull();
    expect(studio!.steps.length).toBe(3);
    expect(await ls().getStudio('does-not-exist')).toBeNull();
  });

  it('buildProjectContext + resolveLinkedArtifacts derive context', async () => {
    const studio = (await ls().getStudio('demo-launch-studio'))!;
    const ctx = await ls().buildProjectContext({ studio, userId: 'u1', canvasTypeId: 'canvas.design' });
    expect(ctx.brandId).toBe('brand-acme');
    expect(ctx.userId).toBe('u1');
    const art = await ls().resolveLinkedArtifacts({ studio, sourceCanvasTypeId: 'canvas.design' });
    expect((art.sharedArtifacts as unknown[]).length).toBe(2);
    // canvas.design is step 2 → one inherited prior step (canvas.brief).
    expect((art.inheritedSteps as unknown[]).length).toBe(1);
  });

  it('linkStep node runs end-to-end (ctx.variables + ctx.userId wired)', async () => {
    const out = await runNode('ls.link', 'launch-studio.linkStep', {}, {
      studioId: 'demo-launch-studio', stepId: 'step-brief', projectId: 'proj-1', canvasTypeId: 'canvas.brief',
    });
    expect(out.__status).toBe('completed');
    expect(out.success).toBe(true);
    expect(out.studioId).toBe('demo-launch-studio');
  });
});
