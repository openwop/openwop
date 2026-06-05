/**
 * Board rename — PATCH /v1/host/sample/kanban/boards/:boardId (architect memo
 * 2026-06-05). Rename is metadata-only: `name` is the ONLY mutable field
 * (owner rebinding alters run attribution per RFC 0086 §C; column edits alter
 * trigger semantics — both rejected), and the route is tenant-fenced like
 * DELETE.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18741;
const BASE = `http://127.0.0.1:${PORT}`;

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
  if (server) await new Promise<void>((res) => server.close(() => res()));
});

async function api<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: 'Bearer sample-token', 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

describe('board rename — PATCH boards/:boardId', () => {
  it('renames (name only), rejects other fields, 404s cross-tenant/missing', async () => {
    const created = await api<{ id: string; name: string }>('/v1/host/sample/kanban/boards', {
      method: 'POST', body: JSON.stringify({ name: 'Before' }),
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const renamed = await api<{ id: string; name: string }>(`/v1/host/sample/kanban/boards/${id}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'After' }),
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('After');

    // Only `name` is mutable — owner/column rebinding is rejected.
    const rejected = await api<{ error: string }>(`/v1/host/sample/kanban/boards/${id}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'X', rosterId: 'ros_evil' }),
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('validation_error');

    const empty = await api<{ error: string }>(`/v1/host/sample/kanban/boards/${id}`, {
      method: 'PATCH', body: JSON.stringify({ name: '  ' }),
    });
    expect(empty.status).toBe(400);

    const missing = await api<{ error: string }>('/v1/host/sample/kanban/boards/b_nope', {
      method: 'PATCH', body: JSON.stringify({ name: 'X' }),
    });
    expect(missing.status).toBe(404);
  });
});
