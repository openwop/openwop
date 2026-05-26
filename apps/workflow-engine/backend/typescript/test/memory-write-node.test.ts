/**
 * RFC 0057 node-attributed producer — `local.sample.demo.memory-write`.
 *
 * Runs a workflow whose single node writes a tenant memory entry mid-run,
 * then verifies the run emits a `memory.written` event attributed to that
 * node (payload `nodeId`), content-free (no `content` field — the
 * `memory-attribution-no-content` invariant), and that the `memoryId`
 * resolves via the read-side ledger — closing the per-node memory-attribution
 * loop (write → attribute → ledger). Gives the RunTimeline memory-write
 * markers (#192) a node-attributed event to render. Mirrors
 * `media-emit-node.test.ts`, the RFC 0055 §C counterpart.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18189;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'test',
    serviceVersion: '0.0.1',
    enableConsoleTracer: false,
  });
  await new Promise<void>((res) => {
    server = app.listen(PORT, res);
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

async function jsonFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json()) as T };
}

interface MemWrittenPayload {
  memoryRef?: string;
  memoryId?: string;
  nodeId?: string;
  tags?: string[];
  content?: unknown;
}
interface BundleBody { events?: { type?: string; nodeId?: string; payload?: MemWrittenPayload }[] }
interface MemoryEntry { id: string; content: string; tags: string[] }
interface MemoryListBody { memoryRef: string; entries: MemoryEntry[] }

describe('memory-write demo node (RFC 0057 node-attributed producer)', () => {
  it('emits a node-attributed, content-free memory.written whose memoryId resolves in the ledger', async () => {
    const reg = await jsonFetch('/v1/host/sample/workflows', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: 'sample.demo.memwrite',
        nodes: [{ nodeId: 'mem', typeId: 'local.sample.demo.memory-write' }],
        edges: [],
      }),
    });
    expect([200, 201]).toContain(reg.status);

    const create = await jsonFetch<{ runId: string }>('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ workflowId: 'sample.demo.memwrite', inputs: {} }),
    });
    expect(create.status).toBe(201);
    const { runId } = create.body;

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
      if (['completed', 'failed', 'cancelled'].includes(snap.body.status)) break;
    }

    const bundle = await jsonFetch<BundleBody>(`/v1/runs/${runId}/debug-bundle`);
    expect(bundle.status).toBe(200);
    const writes = (bundle.body.events ?? []).filter((e) => e.type === 'memory.written');
    // Two writes: the node-attributed one (nodeId 'mem') + the host session-end
    // run-summary (no nodeId). Assert the node-attributed one specifically.
    const nodeWrite = writes.find((e) => e.payload?.nodeId === 'mem');
    expect(nodeWrite, 'a memory.written attributed to node `mem` MUST appear').toBeDefined();
    // RFC 0057 §B: identifiers present, attributed to the node.
    expect(typeof nodeWrite!.payload?.memoryId).toBe('string');
    expect(nodeWrite!.payload?.memoryRef).toBe('tenant-memory');
    // `memory-attribution-no-content`: the event MUST NOT carry entry content.
    expect(nodeWrite!.payload?.content, 'memory.written MUST be content-free').toBeUndefined();

    // The memoryId resolves via the read-side, tagged with the writing node.
    const mem = await jsonFetch<MemoryListBody>('/v1/host/sample/memory');
    expect(mem.status).toBe(200);
    const entry = mem.body.entries.find((e) => e.id === nodeWrite!.payload!.memoryId);
    expect(entry, 'the attributed memoryId MUST resolve in the ledger').toBeDefined();
    expect(entry!.tags).toContain('node:mem');
  });
});
