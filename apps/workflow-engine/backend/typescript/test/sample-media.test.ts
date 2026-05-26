/**
 * Gap D-2 — sample media generation routes that back `openwop media`.
 *
 *   POST /v1/host/sample/media/generate-image
 *   POST /v1/host/sample/media/transcribe
 *   POST /v1/host/sample/media/synthesize
 *
 * The demo host advertises aiProviders.imageGeneration: supported:false and
 * wires no live media provider, so these return DETERMINISTIC stub assets
 * tagged `stub: true`. Verifies each route validates its required field,
 * returns the documented shape, and (for the binary kinds) that the minted
 * asset URL resolves to the stored bytes via the token-authed serve route.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';

let server: http.Server;
const PORT = 18204;
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

interface AssetResp { url?: string; bytes?: number; contentType?: string; stub?: boolean; voice?: string }
interface TranscriptResp { text?: string; language?: string; bytes?: number; stub?: boolean }

describe('sample media routes (gap D-2)', () => {
  it('generate-image: rejects an empty prompt', async () => {
    const r = await jsonFetch('/v1/host/sample/media/generate-image', { method: 'POST', body: JSON.stringify({}) });
    expect(r.status).toBe(400);
  });

  it('generate-image: returns a stub PNG asset whose URL resolves', async () => {
    const r = await jsonFetch<AssetResp>('/v1/host/sample/media/generate-image', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'a red bicycle' }),
    });
    expect(r.status).toBe(201);
    expect(r.body.stub).toBe(true);
    expect(r.body.contentType).toBe('image/png');
    expect(r.body.url).toMatch(/^\/v1\/host\/sample\/assets\//);
    expect((r.body.bytes ?? 0)).toBeGreaterThan(0);

    const served = await fetch(`${BASE}${r.body.url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
  });

  it('transcribe: rejects missing audio', async () => {
    const r = await jsonFetch('/v1/host/sample/media/transcribe', { method: 'POST', body: JSON.stringify({}) });
    expect(r.status).toBe(400);
  });

  it('transcribe: returns a deterministic stub transcript', async () => {
    const audioBase64 = Buffer.from('fake-audio-bytes').toString('base64');
    const r1 = await jsonFetch<TranscriptResp>('/v1/host/sample/media/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, language: 'en' }),
    });
    expect(r1.status).toBe(200);
    expect(r1.body.stub).toBe(true);
    expect(r1.body.language).toBe('en');
    expect(typeof r1.body.text).toBe('string');
    expect((r1.body.text ?? '').length).toBeGreaterThan(0);

    // Deterministic: same input → same transcript.
    const r2 = await jsonFetch<TranscriptResp>('/v1/host/sample/media/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audioBase64, language: 'en' }),
    });
    expect(r2.body.text).toBe(r1.body.text);
  });

  it('synthesize: rejects empty text', async () => {
    const r = await jsonFetch('/v1/host/sample/media/synthesize', { method: 'POST', body: JSON.stringify({}) });
    expect(r.status).toBe(400);
  });

  it('synthesize: returns a stub WAV asset whose URL resolves', async () => {
    const r = await jsonFetch<AssetResp>('/v1/host/sample/media/synthesize', {
      method: 'POST',
      body: JSON.stringify({ text: 'hello world', voice: 'narrator' }),
    });
    expect(r.status).toBe(201);
    expect(r.body.stub).toBe(true);
    expect(r.body.contentType).toBe('audio/wav');
    expect(r.body.voice).toBe('narrator');
    expect(r.body.url).toMatch(/^\/v1\/host\/sample\/assets\//);

    const served = await fetch(`${BASE}${r.body.url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('audio/wav');
  });
});
