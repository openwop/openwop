/**
 * host.knowledge — `vendor.myndhyve.knowledge-tools` retrieval against the demo
 * host. Proves the surface returns real, ranked, query-relevant chunks with
 * de-duplicated sources (lexical RAG over the seeded corpus), both end-to-end
 * through the mounted pack node and surface-direct (collection filter + shape).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { buildHostSurfaceBundle } from '../src/host/inMemorySurfaces.js';

let server: http.Server;
const PORT = 18197;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  const app = await createApp({ port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false });
  await new Promise<void>((res) => { server = app.listen(PORT, res); });
});
afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  return { status: res.status, body: (await res.json()) as T };
}

interface BundleEvent { type?: string; nodeId?: string; payload?: Record<string, unknown> }

describe('host.knowledge: retrieve node returns ranked chunks + sources', () => {
  it('a knowledge.retrieve run surfaces query-relevant chunks', async () => {
    await jsonFetch('/v1/host/sample/workflows', {
      method: 'POST',
      body: JSON.stringify({ workflowId: 'sample.knowledge', nodes: [{ nodeId: 'op', typeId: 'knowledge.retrieve' }], edges: [] }),
    });
    const create = await jsonFetch<{ runId: string }>('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ workflowId: 'sample.knowledge', inputs: { query: 'how do I rotate API keys and report secret leakage' } }),
    });
    expect(create.status).toBe(201);
    const { runId } = create.body;
    let status = 'pending';
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
      status = snap.body.status;
      if (['completed', 'failed', 'cancelled'].includes(status)) break;
    }
    expect(status).toBe('completed');
    const bundle = await jsonFetch<{ events?: BundleEvent[] }>(`/v1/runs/${runId}/debug-bundle`);
    const out = ((bundle.body.events ?? []).find((e) => e.type === 'node.completed' && e.nodeId === 'op')?.payload?.outputs ?? {}) as Record<string, unknown>;
    const chunks = out.chunks as Array<Record<string, unknown>>;
    expect(out.hasResults).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
    // The security/credentials chunk should rank top for this query.
    expect(chunks[0]!.assetId).toBe('doc-security');
    expect(typeof chunks[0]!.relevanceScore).toBe('number');
    expect(chunks[0]!.relevanceScore).toBeGreaterThan(0);
    const sources = out.sources as Array<Record<string, unknown>>;
    expect(sources.some((s) => s.assetId === 'doc-security')).toBe(true);
  });
});

describe('host.knowledge: surface-direct', () => {
  const kb = () => buildHostSurfaceBundle({ tenantId: 'kb-test' }).knowledge;

  it('filters by collectionIds and de-duplicates sources by asset', async () => {
    const res = await kb().retrieve({ query: 'workflow triggers and the event log runtime', collectionIds: ['engineering'], resultLimit: 5 }) as Record<string, unknown>;
    const chunks = res.chunks as Array<Record<string, unknown>>;
    expect(chunks.length).toBeGreaterThan(0);
    // Only the engineering collection is in scope.
    expect(chunks.every((c) => c.collectionId === 'engineering')).toBe(true);
    // doc-arch has two chunks (c4, c5) — sources must collapse to one entry.
    const sources = res.sources as Array<Record<string, unknown>>;
    const archSources = sources.filter((s) => s.assetId === 'doc-arch');
    expect(archSources.length).toBeLessThanOrEqual(1);
    // Required citation fields present.
    if (sources.length) {
      expect(typeof sources[0]!.sourceId).toBe('string');
      expect(typeof sources[0]!.title).toBe('string');
    }
  });

  it('honors scoreThreshold and returns no results for an unrelated query', async () => {
    const res = await kb().retrieve({ query: 'zzzqqq nonexistent topic xylophone', scoreThreshold: 0.01 }) as Record<string, unknown>;
    expect(res.hasResults).toBe(false);
    expect((res.chunks as unknown[]).length).toBe(0);
  });
});
