/**
 * Regression coverage for the SDK's "host doesn't advertise this
 * capability → return null/false" fallback path.
 *
 * The fallback used to inspect `err.message` with `/\b404\b/`, which
 * is fragile: when the host returns an error envelope whose `message`
 * doesn't contain the literal string "404" (e.g., the workflow-engine
 * catch-all's `"No route matches this request."`), the regex misses
 * and the SDK throws a WopError to the caller instead of returning
 * the documented null. This forces every consumer to add a try/catch
 * + status-code sniff of their own.
 *
 * The fix routes the fallback through `err instanceof WopError &&
 * err.status === 404` so the actual HTTP status — which WopError
 * already carries verbatim — is the load-bearing signal. The
 * envelope's `message` is purely for display.
 *
 * Each test asserts the bug shape directly: respond with a 404 (or
 * 501) plus an envelope whose `message` contains no status-code
 * substring; verify the SDK returns the documented sentinel.
 */

import { describe, it, expect } from 'vitest';
import { OpenwopClient } from '../client.js';

function mockClient(
  responder: (url: string, method: string) => { status: number; body?: unknown },
): OpenwopClient {
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const r = responder(url, method);
    return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return new OpenwopClient({
    baseUrl: 'https://test.example',
    apiKey: 'test-key',
    fetch: mockFetch,
  });
}

// Envelope shape used by the workflow-engine catch-all: a 404 whose
// `message` field carries no status-code substring. This is exactly
// the wire shape that previously broke the `/\b404\b/` heuristic.
const NO_ROUTE_404 = {
  status: 404,
  body: { error: 'not_found', message: 'No route matches this request.' },
};

const NOT_IMPLEMENTED_501 = {
  status: 501,
  body: { error: 'not_implemented', message: 'Capability not advertised by this host.' },
};

describe('SDK fallback returns null on 404 with no status substring in envelope', () => {
  it('runs.debugBundle → null', async () => {
    const client = mockClient(() => NO_ROUTE_404);
    const result = await client.runs.debugBundle('run-1');
    expect(result).toBeNull();
  });

  it('runs.ancestry → null', async () => {
    const client = mockClient(() => NO_ROUTE_404);
    const result = await client.runs.ancestry('run-1');
    expect(result).toBeNull();
  });

  it('runs.diff → null', async () => {
    const client = mockClient(() => NO_ROUTE_404);
    const result = await client.runs.diff('run-1', 'run-2');
    expect(result).toBeNull();
  });

  it('agents.list → null', async () => {
    const client = mockClient(() => NO_ROUTE_404);
    const result = await client.agents.list();
    expect(result).toBeNull();
  });

  it('agents.get → null', async () => {
    const client = mockClient(() => NO_ROUTE_404);
    const result = await client.agents.get('agent-1');
    expect(result).toBeNull();
  });

  it('userAgents.listAvailablePacks → null (this was the production bug)', async () => {
    const client = mockClient(() => NO_ROUTE_404);
    const result = await client.userAgents.listAvailablePacks();
    expect(result).toBeNull();
  });

  it('userAgents.delete → false', async () => {
    const client = mockClient(() => NO_ROUTE_404);
    const result = await client.userAgents.delete('agent-1');
    expect(result).toBe(false);
  });
});

describe('SDK fallback returns null on 404/501 for capability-gated reads', () => {
  it('runs.listAnnotations → null on 404', async () => {
    const client = mockClient(() => NO_ROUTE_404);
    const result = await client.runs.listAnnotations('run-1');
    expect(result).toBeNull();
  });

  it('runs.listAnnotations → null on 501 (capability absent)', async () => {
    const client = mockClient(() => NOT_IMPLEMENTED_501);
    const result = await client.runs.listAnnotations('run-1');
    expect(result).toBeNull();
  });
});

describe('SDK still throws for non-404/501 errors', () => {
  it('500 still throws — only capability-absent statuses are swallowed', async () => {
    const client = mockClient(() => ({
      status: 500,
      body: { error: 'internal_error', message: 'something broke' },
    }));
    await expect(client.runs.debugBundle('run-1')).rejects.toThrow(/something broke/);
  });

  it('400 with a "404" substring in the message does NOT trigger the fallback', async () => {
    // The old regex-on-message heuristic would FALSELY swallow this
    // because the message text happens to contain "404". The new
    // status-based check rejects it correctly: this is a 400, not a
    // 404, and the caller MUST see the error.
    const client = mockClient(() => ({
      status: 400,
      body: { error: 'invalid_request', message: 'expected URL like /404/foo, got /baz' },
    }));
    await expect(client.runs.debugBundle('run-1')).rejects.toThrow();
  });
});
