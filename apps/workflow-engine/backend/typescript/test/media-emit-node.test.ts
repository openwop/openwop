/**
 * RFC 0055 §C demo producer — `local.sample.demo.image-emit`.
 *
 * Runs a workflow whose single node emits a `media.image` event, then
 * verifies the run's debug bundle carries that event referenced BY URL
 * (never inlined) and that the served URL resolves — closing the §C loop
 * (produce → store → serve → debug bundle) the rails were built for.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18188;
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

interface MediaPayload { url?: string; bytes?: number; base64?: string }
interface BundleBody { events?: { type?: string; payload?: MediaPayload }[] }

describe('media-emit demo node (RFC 0055 §C producer)', () => {
  it('emits a media.image referenced by URL in the run debug bundle, and the URL resolves', async () => {
    // Register the image-emit node as a one-node workflow.
    const reg = await jsonFetch('/v1/host/sample/workflows', {
      method: 'POST',
      body: JSON.stringify({
        workflowId: 'sample.demo.image',
        nodes: [{ nodeId: 'img', typeId: 'local.sample.demo.image-emit' }],
        edges: [],
      }),
    });
    expect([200, 201]).toContain(reg.status);

    const create = await jsonFetch<{ runId: string }>('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ workflowId: 'sample.demo.image', inputs: {} }),
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
    const mediaEvents = (bundle.body.events ?? []).filter((e) => typeof e.type === 'string' && e.type.startsWith('media.'));
    expect(mediaEvents.length, 'debug bundle MUST carry the emitted media.image event').toBeGreaterThanOrEqual(1);
    const ev = mediaEvents[0]!;
    // RFC 0055 §C rule 3: referenced by URL, never inlined.
    expect(typeof ev.payload?.url).toBe('string');
    expect(ev.payload?.base64, 'media.image MUST NOT inline the binary').toBeUndefined();
    expect(ev.payload?.url).toMatch(/^\/v1\/host\/sample\/assets\//);

    // The served URL resolves (public, token-authed).
    const served = await fetch(`${BASE}${ev.payload!.url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
  });
});
