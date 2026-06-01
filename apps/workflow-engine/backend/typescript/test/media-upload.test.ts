/**
 * First-class chat-attachment upload (POST /v1/host/sample/media/upload).
 *
 * Unlike the low-level /media/put (test-seam gated), the upload route is
 * ALWAYS ON so the public demo can attach files — bounded instead by a MIME
 * allow-list, a per-file size cap, and a per-tenant daily quota. This test
 * deliberately does NOT set OPENWOP_TEST_SEAM_ENABLED, proving the route is
 * first-class, and checks the fail-closed MIME guard + the serve round-trip
 * over the durable, tenant-scoped capability URL.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18191;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  // NOTE: OPENWOP_TEST_SEAM_ENABLED intentionally left unset — /media/upload
  // must work without it.
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

const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function postJson<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

describe('chat-attachment upload (POST /v1/host/sample/media/upload)', () => {
  it('uploads an allowed file and serves it back over the capability URL', async () => {
    const up = await postJson<{ url: string; bytes: number; contentType: string; name?: string }>(
      '/v1/host/sample/media/upload',
      { contentBase64: PNG_1x1_BASE64, contentType: 'image/png', name: 'pixel.png' },
    );
    expect(up.status).toBe(201);
    expect(up.body.url).toMatch(/^\/v1\/host\/sample\/assets\/[A-Za-z0-9_-]+$/);
    expect(up.body.contentType).toBe('image/png');
    expect(up.body.name).toBe('pixel.png');

    const served = await fetch(`${BASE}${up.body.url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    const buf = Buffer.from(await served.arrayBuffer());
    expect(buf.equals(Buffer.from(PNG_1x1_BASE64, 'base64'))).toBe(true);
  });

  it('accepts a text document type', async () => {
    const up = await postJson<{ url: string }>(
      '/v1/host/sample/media/upload',
      { contentBase64: Buffer.from('hello, world').toString('base64'), contentType: 'text/plain', name: 'note.txt' },
    );
    expect(up.status).toBe(201);
  });

  it('rejects a disallowed MIME type fail-closed (415)', async () => {
    const up = await postJson<{ error: string }>(
      '/v1/host/sample/media/upload',
      { contentBase64: PNG_1x1_BASE64, contentType: 'application/x-msdownload', name: 'evil.exe' },
    );
    expect(up.status).toBe(415);
    expect(up.body.error).toBe('unsupported_media_type');
  });

  it('rejects an empty upload (400)', async () => {
    const up = await postJson<{ error: string }>(
      '/v1/host/sample/media/upload',
      { contentType: 'image/png' },
    );
    expect(up.status).toBe(400);
    expect(up.body.error).toBe('invalid_argument');
  });
});
