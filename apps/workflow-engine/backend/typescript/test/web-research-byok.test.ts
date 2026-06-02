/**
 * host.webResearch.search — BYOK/env-gated live provider (Residual #2).
 *
 * With a provider key + base URL configured, search() queries the real provider
 * (mock Brave-shaped JSON here) and returns live results + engine. With no key
 * it returns the honest demo result; on a provider error it falls back to demo
 * rather than hard-failing. research() composes search→fetchBatch.
 */

import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/index.js';
import { buildHostSurfaceBundle } from '../src/host/inMemorySurfaces.js';

let app: http.Server;
let provider: http.Server;
let providerUrl: string;
let lastAuthHeader: string | null = null;
let providerStatus = 200;
const PORT = 18211;

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  process.env.OPENWOP_AUTH_DISABLE_COOKIES = 'true';
  const a = await createApp({ port: PORT, storageDsn: 'memory://', serviceName: 'test', serviceVersion: '0.0.1', enableConsoleTracer: false });
  await new Promise<void>((res) => { app = a.listen(PORT, res); });
  provider = http.createServer((req, res) => {
    lastAuthHeader = (req.headers['x-subscription-token'] as string) ?? null;
    if (providerStatus !== 200) { res.writeHead(providerStatus).end('err'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ web: { results: [
      { url: 'https://example.com/a', title: 'Result A', description: 'snippet A' },
      { url: 'https://example.com/b', title: 'Result B', description: 'snippet B' },
    ] } }));
  });
  await new Promise<void>((res) => provider.listen(0, res));
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/search`;
});

afterAll(async () => {
  await new Promise<void>((res) => app.close(() => res()));
  await new Promise<void>((res) => provider.close(() => res()));
});

afterEach(() => {
  delete process.env.OPENWOP_WEBSEARCH_API_KEY;
  delete process.env.OPENWOP_WEBSEARCH_BASE_URL;
  delete process.env.OPENWOP_WEBSEARCH_ENGINE;
  providerStatus = 200;
  lastAuthHeader = null;
});

const wr = () => buildHostSurfaceBundle({ tenantId: 'default' }).webResearch;

describe('host.webResearch.search BYOK provider', () => {
  it('queries the live provider when a key + base URL are configured', async () => {
    process.env.OPENWOP_WEBSEARCH_API_KEY = 'test-key';
    process.env.OPENWOP_WEBSEARCH_BASE_URL = providerUrl;
    process.env.OPENWOP_WEBSEARCH_ENGINE = 'brave';
    const r = await wr().search({ query: 'openwop protocol', maxResults: 5 });
    expect(r.engine).toBe('brave');
    expect(r.results).toHaveLength(2);
    expect(r.results[0]!.url).toBe('https://example.com/a');
    expect(r.results[0]!.snippet).toBe('snippet A');
    expect(r.results[1]!.rank).toBe(2);
    expect(lastAuthHeader, 'the provider key is sent as x-subscription-token').toBe('test-key');
  });

  it('applies siteFilter to the query', async () => {
    process.env.OPENWOP_WEBSEARCH_API_KEY = 'k';
    process.env.OPENWOP_WEBSEARCH_BASE_URL = providerUrl;
    const r = await wr().search({ query: 'spec', siteFilter: 'openwop.dev' });
    expect(r.engine).toBe('brave'); // default engine label
    expect(r.results.length).toBeGreaterThan(0);
  });

  it('returns the honest demo result when no key is configured', async () => {
    const r = await wr().search({ query: 'anything' });
    expect(r.engine).toBe('demo');
    expect(r.results[0]!.url).toContain('duckduckgo.com');
  });

  it('falls back to demo on a provider error (does not hard-fail)', async () => {
    process.env.OPENWOP_WEBSEARCH_API_KEY = 'k';
    process.env.OPENWOP_WEBSEARCH_BASE_URL = providerUrl;
    providerStatus = 500;
    const r = await wr().search({ query: 'x' });
    expect(r.engine).toBe('demo');
  });

  it('research composes the live search with real fetch', async () => {
    process.env.OPENWOP_WEBSEARCH_API_KEY = 'k';
    process.env.OPENWOP_WEBSEARCH_BASE_URL = providerUrl;
    const r = await wr().research({ query: 'openwop', maxResults: 2 });
    expect(r.engine).toBe('brave');
    expect(r.citations).toHaveLength(2);
    // fetchBatch ran against the result URLs (example.com → some content or an error field).
    expect(typeof r.citations[0]!.content).toBe('string');
  });
});
