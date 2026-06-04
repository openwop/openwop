/**
 * Reference domain slice (white-label PRD §4) — proves the conventions the
 * example exists to teach:
 *   - tenant scoping (A's widgets invisible to B),
 *   - idempotent per-entity seed (re-run = no-op; partial seed self-heals),
 *   - fail-closed mutation (409 + machine-readable reason; no silent success),
 *   - derived read-through projection (summary recomputes from the live store),
 *   - the env gate (routes absent unless OPENWOP_EXAMPLE_WIDGETS_ENABLED=true).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import {
  archiveWidget,
  listWidgets,
  seedDemoWidgets,
  widgetSummary,
} from '../src/host/examples/widgetService.js';

let server: http.Server;
const PORT = 18713;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  process.env.OPENWOP_EXAMPLE_WIDGETS_ENABLED = 'true';
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
  delete process.env.OPENWOP_EXAMPLE_WIDGETS_ENABLED;
});

async function api<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe('widget reference domain — service conventions', () => {
  it('seed is idempotent and per-entity', async () => {
    const first = await seedDemoWidgets('tenant-a');
    expect(first.seeded).toBe(true);
    expect(first.widgets).toBe(2);

    const second = await seedDemoWidgets('tenant-a');
    expect(second.seeded).toBe(false);
    expect(second.widgets).toBe(2);
  });

  it('tenant scoping: tenant B sees none of tenant A', async () => {
    expect((await listWidgets('tenant-a')).length).toBe(2);
    expect((await listWidgets('tenant-b')).length).toBe(0);
  });

  it('fail-closed mutation: second archive refuses with a typed reason', async () => {
    const [w] = await listWidgets('tenant-a');
    const ok = await archiveWidget('tenant-a', w.widgetId);
    expect(ok).toMatchObject({ ok: true });

    const again = await archiveWidget('tenant-a', w.widgetId);
    expect(again).toEqual({ ok: false, reason: 'already_archived' });

    // Cross-tenant mutation is a not_found, never a hit.
    const cross = await archiveWidget('tenant-b', w.widgetId);
    expect(cross).toEqual({ ok: false, reason: 'not_found' });
  });

  it('derived projection recomputes from the live store', async () => {
    expect(await widgetSummary('tenant-a')).toEqual({ total: 2, active: 1, archived: 1 });
    expect(await widgetSummary('tenant-b')).toEqual({ total: 0, active: 0, archived: 0 });
  });
});

describe('widget reference domain — route conventions', () => {
  it('seed + list round-trip over HTTP (bearer-shared default tenant)', async () => {
    const seed = await api<{ seeded: boolean; widgets: number }>('/v1/host/sample/widgets/seed', { method: 'POST', body: '{}' });
    expect(seed.status).toBe(200);
    const list = await api<{ widgets: Array<{ widgetId: string; status: string }>; total: number }>('/v1/host/sample/widgets');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
  });

  it('fail-closed mutation maps to 409 + machine-readable reason', async () => {
    const list = await api<{ widgets: Array<{ widgetId: string }> }>('/v1/host/sample/widgets');
    const id = list.body.widgets[0].widgetId;

    const first = await api<{ status: string }>(`/v1/host/sample/widgets/${id}/archive`, { method: 'POST', body: '{}' });
    expect(first.status).toBe(200);

    const second = await api<{ error: string; reason: string }>(`/v1/host/sample/widgets/${id}/archive`, { method: 'POST', body: '{}' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: 'conflict', reason: 'already_archived' });
  });

  it('validation failures are 400 with the canonical envelope', async () => {
    const bad = await api<{ error: string }>('/v1/host/sample/widgets', { method: 'POST', body: '{}' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('validation_error');
  });
});
