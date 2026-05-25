/**
 * RFC 0055 §C media-asset serving.
 *
 * Verifies the reference host stores an asset and serves it back over a
 * tenant-scoped, non-guessable capability URL (GET /v1/host/sample/assets/
 * :token), and that an unknown token does not resolve (the capability-token
 * basis of the `media-asset-url-tenant-scoped` invariant).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18186;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  // The store route (POST) is gated on the test-seam flag.
  process.env.OPENWOP_TEST_SEAM_ENABLED = 'true';
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

describe('media-asset serving (RFC 0055 §C)', () => {
  it('stores an asset and serves it back over the tenant-scoped URL', async () => {
    const stored = await postJson<{ url: string; bytes: number; expiresAt: string }>(
      '/v1/host/sample/media/put',
      { contentBase64: PNG_1x1_BASE64, contentType: 'image/png' },
    );
    expect(stored.status).toBe(201);
    expect(stored.body.url).toMatch(/^\/v1\/host\/sample\/assets\/[A-Za-z0-9_-]+$/);
    expect(stored.body.bytes).toBeGreaterThan(0);

    // Serve route is always-on; the token is the capability (no auth header needed).
    const served = await fetch(`${BASE}${stored.body.url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    const buf = Buffer.from(await served.arrayBuffer());
    expect(buf.equals(Buffer.from(PNG_1x1_BASE64, 'base64'))).toBe(true);
  });

  it('returns 404 for an unknown token (capability-token isolation)', async () => {
    const res = await fetch(`${BASE}/v1/host/sample/assets/this-token-was-never-minted`);
    expect(res.status).toBe(404);
  });

  it('rejects an empty store request', async () => {
    const res = await postJson<{ error: string }>('/v1/host/sample/media/put', { contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_argument');
  });
});
