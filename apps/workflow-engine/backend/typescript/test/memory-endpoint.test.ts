/**
 * Memory ledger read-side (RFC 0004 / app-ux §A3).
 *
 * Verifies the host-extension GET /v1/host/sample/memory returns the
 * run-summary the executor writes on completion, tenant-scoped from the
 * caller's principal (not the query) per CTI-1.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18184;
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

async function jsonFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, body: (await res.json()) as T };
}

interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
}
interface MemoryListBody {
  memoryRef: string;
  entries: MemoryEntry[];
}

describe('memory ledger read-side', () => {
  it('requires auth', async () => {
    const res = await fetch(`${BASE}/v1/host/sample/memory`);
    expect(res.status).toBe(401);
  });

  it('returns the run-summary the host writes on completion', async () => {
    // Omit body.tenantId so the run resolves the same tenant the memory GET
    // does (`req.tenantId ?? 'default'`) — the api-key principal is wildcard,
    // so both land on 'default' and the ledger read sees the run's write.
    const create = await jsonFetch<{ runId: string; status: string }>('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: 'sample.demo.uppercase',
        inputs: { text: 'remember me' },
      }),
    });
    expect(create.status).toBe(201);
    const { runId } = create.body;

    // Poll for terminal status (the run-summary is written on completion).
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const snap = await jsonFetch<{ status: string }>(`/v1/runs/${runId}`);
      if (['completed', 'failed', 'cancelled'].includes(snap.body.status)) break;
    }

    const mem = await jsonFetch<MemoryListBody>('/v1/host/sample/memory');
    expect(mem.status).toBe(200);
    expect(mem.body.memoryRef).toBe('tenant-memory');
    const mine = mem.body.entries.filter((e) => e.tags.includes(`run-id:${runId}`));
    expect(mine.length).toBe(1);
    expect(mine[0]!.tags).toContain('run-summary');
    expect(mine[0]!.content).toContain(runId);
  });

  it('filters by tag', async () => {
    const mem = await jsonFetch<MemoryListBody>('/v1/host/sample/memory?tag=run-summary');
    expect(mem.status).toBe(200);
    for (const e of mem.body.entries) expect(e.tags).toContain('run-summary');
  });

  it('deletes a tenant-scoped entry (demo DELETE route)', async () => {
    // Grab an existing entry, delete it, and confirm it's gone.
    const before = await jsonFetch<MemoryListBody>('/v1/host/sample/memory');
    expect(before.body.entries.length).toBeGreaterThan(0);
    const target = before.body.entries[0]!;

    const del = await jsonFetch<{ memoryRef: string; memoryId: string; removed: boolean }>(
      `/v1/host/sample/memory/${target.id}`,
      { method: 'DELETE' },
    );
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(true);
    expect(del.body.memoryId).toBe(target.id);

    const after = await jsonFetch<MemoryListBody>('/v1/host/sample/memory');
    expect(after.body.entries.find((e) => e.id === target.id)).toBeUndefined();
  });

  it('returns 404 deleting a missing entry', async () => {
    const del = await jsonFetch<{ error: string }>('/v1/host/sample/memory/mem_does_not_exist', {
      method: 'DELETE',
    });
    expect(del.status).toBe(404);
    expect(del.body.error).toBe('not_found');
  });

  it('requires auth to delete', async () => {
    const res = await fetch(`${BASE}/v1/host/sample/memory/whatever`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});
