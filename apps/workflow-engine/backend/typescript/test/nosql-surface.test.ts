/**
 * host.db.nosql — `core.openwop.db` NoSQL nodes against the demo host.
 *
 * Proves the document store really works end-to-end (createApp → register a
 * workflow per CRUD op → run → inspect node outputs): insert returns ids, find
 * filters + projects + sorts, update mutates matched docs, delete removes them.
 * Also asserts the §host.db.nosql injection guard ($-operator filters are
 * refused) and that the store is tenant-scoped via the bundle scope.
 *
 * The db pack is mounted from the repo's `packs/` tree by
 * `ensureLocalPacksMounted()` during `createApp`.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import { buildHostSurfaceBundle } from '../src/host/inMemorySurfaces.js';

let server: http.Server;
const PORT = 18193;
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
  await new Promise<void>((res) => { server = app.listen(PORT, res); });
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

interface BundleEvent { type?: string; nodeId?: string; payload?: Record<string, unknown> }
interface BundleBody { events?: BundleEvent[] }

/** Register a one-node db workflow, run it, return the node's outputs. */
async function runNode(workflowId: string, typeId: string, config: Record<string, unknown>, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  await jsonFetch('/v1/host/sample/workflows', {
    method: 'POST',
    body: JSON.stringify({ workflowId, nodes: [{ nodeId: 'op', typeId, config }], edges: [] }),
  });
  const create = await jsonFetch<{ runId: string }>('/v1/runs', { method: 'POST', body: JSON.stringify({ workflowId, inputs }) });
  expect(create.status).toBe(201);
  const { runId } = create.body;
  let status = 'pending';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
    status = snap.body.status;
    if (['completed', 'failed', 'cancelled'].includes(status)) break;
  }
  const bundle = await jsonFetch<BundleBody>(`/v1/runs/${runId}/debug-bundle`);
  const ev = (bundle.body.events ?? []).find((e) => e.type === 'node.completed' && e.nodeId === 'op');
  return { __status: status, ...((ev?.payload?.outputs as Record<string, unknown>) ?? {}) };
}

const DS = { datasource: 'demo-ds', collection: 'people' };

describe('host.db.nosql: CRUD round-trip through the db pack', () => {
  it('insert → find → update → delete works end-to-end', async () => {
    const ins = await runNode('sample.nosql.insert', 'core.db.nosql-insert', DS, {
      docs: [{ name: 'Ada', dept: 'eng', rank: 2 }, { name: 'Babbage', dept: 'eng', rank: 1 }, { name: 'Lovelace', dept: 'math', rank: 3 }],
    });
    expect(ins.inserted).toBe(3);
    expect(Array.isArray(ins.ids)).toBe(true);

    // find with exact-match filter + sort + projection.
    const found = await runNode('sample.nosql.find', 'core.db.nosql-find', DS, {
      filter: { dept: 'eng' }, sort: { rank: 1 }, projection: { name: 1 },
    });
    const docs = found.docs as Array<Record<string, unknown>>;
    expect(docs).toHaveLength(2);
    expect(docs[0]!.name).toBe('Babbage'); // rank 1 sorts first
    expect(docs[1]!.name).toBe('Ada');
    expect(docs[0]!.dept, 'projection excludes dept').toBeUndefined();
    expect(typeof docs[0]!._id, 'projection always keeps _id').toBe('string');

    // update the matched docs via $set.
    const upd = await runNode('sample.nosql.update', 'core.db.nosql-update', DS, {
      filter: { dept: 'eng' }, update: { $set: { active: true } },
    });
    expect(upd.matched).toBe(2);
    expect(upd.modified).toBe(2);

    const afterUpdate = await runNode('sample.nosql.find2', 'core.db.nosql-find', DS, { filter: { active: true } });
    expect((afterUpdate.docs as unknown[])).toHaveLength(2);

    // delete one.
    const del = await runNode('sample.nosql.delete', 'core.db.nosql-delete', DS, { filter: { name: 'Ada' } });
    expect(del.deleted).toBe(1);

    const afterDelete = await runNode('sample.nosql.find3', 'core.db.nosql-find', DS, { filter: { dept: 'eng' } });
    expect((afterDelete.docs as unknown[])).toHaveLength(1);
  });

  it('refuses $-operator filters (injection guard)', async () => {
    const out = await runNode('sample.nosql.badfilter', 'core.db.nosql-find', DS, { filter: { rank: { $gt: 1 } } });
    // The node fails because the surface throws nosql_filter_unsupported.
    expect(out.__status).toBe('failed');
  });
});

describe('host.db.nosql: tenant isolation (bundle scope)', () => {
  it('a different tenant scope sees a separate collection', async () => {
    // Surfaces were already initialized by createApp in the top-level beforeAll.
    const a = buildHostSurfaceBundle({ tenantId: 'tenant-a' });
    const b = buildHostSurfaceBundle({ tenantId: 'tenant-b' });
    await a.db.nosql.insert({ datasource: 'd', collection: 'c', docs: [{ x: 1 }] });
    const aFind = await a.db.nosql.find({ datasource: 'd', collection: 'c', filter: {} });
    const bFind = await b.db.nosql.find({ datasource: 'd', collection: 'c', filter: {} });
    expect((aFind.docs as unknown[])).toHaveLength(1);
    expect((bFind.docs as unknown[]), 'tenant-b must not see tenant-a docs').toHaveLength(0);
  });
});
