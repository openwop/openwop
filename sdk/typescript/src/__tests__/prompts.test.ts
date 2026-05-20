/**
 * SDK tests for `OpenwopClient.prompts.*` (RFC 0028 §A).
 *
 * Verifies each of the six methods (`list`, `get`, `render`, `create`,
 * `update`, `delete`) maps to the correct HTTP method + path + body +
 * headers. Uses `OpenwopClientOptions.fetch` override to inject a
 * mock fetch that captures the request without round-tripping a live
 * server. Mirrors the testing pattern used by `audit.test.ts` / the
 * existing client surface (per the SDK's "test the wire mapping, not
 * the runtime" posture).
 */

import { describe, it, expect } from 'vitest';
import { OpenwopClient } from '../client.js';
import type {
  PromptTemplate,
  ListPromptsResponse,
  RenderPromptResponse,
} from '../types.js';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

/** Build a client + mock fetch that captures the request and returns a
 *  scripted response. The returned `captured` array fills with one
 *  entry per request the client issues; tests inspect it after the
 *  awaited method call. */
function mockClient(
  responder: (req: CapturedRequest) => { status: number; body?: unknown; headers?: Record<string, string> },
): { client: OpenwopClient; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers ?? {});
    const body = init?.body !== undefined && init.body !== null ? String(init.body) : undefined;
    const req: CapturedRequest = body !== undefined
      ? { url, method, headers, body }
      : { url, method, headers };
    captured.push(req);
    const r = responder(req);
    const responseHeaders = new Headers(r.headers ?? {});
    if (r.body !== undefined && !responseHeaders.has('content-type')) {
      responseHeaders.set('content-type', 'application/json');
    }
    return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, {
      status: r.status,
      headers: responseHeaders,
    });
  };
  const client = new OpenwopClient({
    baseUrl: 'https://test.example/',
    apiKey: 'test-key',
    fetch: mockFetch,
  });
  return { client, captured };
}

const SAMPLE_TEMPLATE: PromptTemplate = {
  templateId: 'writer-system',
  version: '1.0.0',
  kind: 'system',
  text: 'You are a writer.',
  meta: { source: 'host' },
};

describe('client.prompts.list', () => {
  it('GETs /v1/prompts with no query params when called bare', async () => {
    const { client, captured } = mockClient(() => ({
      status: 200,
      body: { items: [SAMPLE_TEMPLATE] } satisfies ListPromptsResponse,
    }));
    const result = await client.prompts.list();
    expect(captured).toHaveLength(1);
    expect(captured[0]!.method).toBe('GET');
    expect(captured[0]!.url).toBe('https://test.example/v1/prompts');
    expect(result.items).toHaveLength(1);
  });

  it('forwards kind/tag/modelClass/source/cursor/limit as query params', async () => {
    const { client, captured } = mockClient(() => ({
      status: 200,
      body: { items: [] } satisfies ListPromptsResponse,
    }));
    await client.prompts.list({
      kind: 'user',
      tag: 'editorial',
      modelClass: 'writing',
      source: 'host',
      cursor: 'abc',
      limit: 25,
    });
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/v1/prompts');
    expect(url.searchParams.get('kind')).toBe('user');
    expect(url.searchParams.get('tag')).toBe('editorial');
    expect(url.searchParams.get('modelClass')).toBe('writing');
    expect(url.searchParams.get('source')).toBe('host');
    expect(url.searchParams.get('cursor')).toBe('abc');
    expect(url.searchParams.get('limit')).toBe('25');
  });
});

describe('client.prompts.get', () => {
  it('GETs /v1/prompts/{templateId} bare', async () => {
    const { client, captured } = mockClient(() => ({ status: 200, body: SAMPLE_TEMPLATE }));
    const result = await client.prompts.get({ templateId: 'writer-system' });
    expect(captured[0]!.method).toBe('GET');
    expect(captured[0]!.url).toBe('https://test.example/v1/prompts/writer-system');
    expect(result.templateId).toBe('writer-system');
  });

  it('forwards version + libraryId as query params', async () => {
    const { client, captured } = mockClient(() => ({ status: 200, body: SAMPLE_TEMPLATE }));
    await client.prompts.get({
      templateId: 'writer-system',
      version: '1.0.0',
      libraryId: 'vendor.acme.editorial',
    });
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/v1/prompts/writer-system');
    expect(url.searchParams.get('version')).toBe('1.0.0');
    expect(url.searchParams.get('libraryId')).toBe('vendor.acme.editorial');
  });

  it('encodes templateId for path-safe transmission', async () => {
    const { client, captured } = mockClient(() => ({ status: 200, body: SAMPLE_TEMPLATE }));
    await client.prompts.get({ templateId: 'vendor.acme.with-dots.and-dashes' });
    expect(captured[0]!.url).toBe(
      'https://test.example/v1/prompts/vendor.acme.with-dots.and-dashes',
    );
  });
});

describe('client.prompts.render', () => {
  it('POSTs /v1/prompts:render with ref + variables in the body', async () => {
    const { client, captured } = mockClient(() => ({
      status: 200,
      body: {
        hash: 'sha256:' + 'a'.repeat(64),
        refs: ['prompt:writer-system@1.0.0'],
        variableHashes: {},
      } satisfies RenderPromptResponse,
    }));
    const result = await client.prompts.render({
      ref: 'prompt:writer-system@1.0.0',
      variables: { topic: 'openwop' },
    });
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url).toBe('https://test.example/v1/prompts:render');
    const body = JSON.parse(captured[0]!.body!);
    expect(body.ref).toBe('prompt:writer-system@1.0.0');
    expect(body.variables).toEqual({ topic: 'openwop' });
    expect(result.hash).toMatch(/^sha256:/);
  });

  it('forwards object-form PromptRef + contentTrust', async () => {
    const { client, captured } = mockClient(() => ({
      status: 200,
      body: {
        hash: 'sha256:' + 'b'.repeat(64),
        refs: ['prompt:vendor.acme.editorial.writer-system@1.0.0'],
        variableHashes: {},
        contentTrust: 'untrusted',
      } satisfies RenderPromptResponse,
    }));
    await client.prompts.render({
      ref: {
        libraryId: 'vendor.acme.editorial',
        templateId: 'writer-system',
        version: '1.0.0',
      },
      variables: { topic: 'x' },
      contentTrust: 'untrusted',
    });
    const body = JSON.parse(captured[0]!.body!);
    expect(body.ref).toEqual({
      libraryId: 'vendor.acme.editorial',
      templateId: 'writer-system',
      version: '1.0.0',
    });
    expect(body.contentTrust).toBe('untrusted');
  });
});

describe('client.prompts.create', () => {
  it('POSTs /v1/prompts with the PromptTemplate as body', async () => {
    const { client, captured } = mockClient(() => ({ status: 201, headers: { Location: '/v1/prompts/foo' } }));
    await client.prompts.create(SAMPLE_TEMPLATE);
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url).toBe('https://test.example/v1/prompts');
    expect(JSON.parse(captured[0]!.body!)).toMatchObject({
      templateId: 'writer-system',
      version: '1.0.0',
      kind: 'system',
    });
  });

  it('forwards Idempotency-Key header from MutationOptions', async () => {
    const { client, captured } = mockClient(() => ({ status: 201 }));
    await client.prompts.create(SAMPLE_TEMPLATE, { idempotencyKey: 'key-123' });
    expect(captured[0]!.headers.get('idempotency-key')).toBe('key-123');
  });
});

describe('client.prompts.update', () => {
  it('PUTs /v1/prompts/{templateId} with the PromptTemplate as body', async () => {
    const { client, captured } = mockClient(() => ({
      status: 200,
      body: { ...SAMPLE_TEMPLATE, version: '1.1.0' },
    }));
    const next: PromptTemplate = { ...SAMPLE_TEMPLATE, version: '1.1.0' };
    const result = await client.prompts.update('writer-system', next);
    expect(captured[0]!.method).toBe('PUT');
    expect(captured[0]!.url).toBe('https://test.example/v1/prompts/writer-system');
    expect(result.version).toBe('1.1.0');
  });
});

describe('client.prompts.delete', () => {
  it('DELETEs /v1/prompts/{templateId} and resolves on 204', async () => {
    const { client, captured } = mockClient(() => ({ status: 204 }));
    await client.prompts.delete('writer-system');
    expect(captured[0]!.method).toBe('DELETE');
    expect(captured[0]!.url).toBe('https://test.example/v1/prompts/writer-system');
  });
});

describe('client.prompts error envelope mapping', () => {
  it('throws WopError on 501 capability_not_provided', async () => {
    // Canonical ErrorEnvelope shape: `{ error: <code-string>, message }`
    // per schemas/error-envelope.schema.json (NOT nested
    // `{ error: { code, message } }`). The SDK parses this via the
    // #request fault-handling path and surfaces the parsed envelope on
    // `WopError.envelope.error` as the code string.
    const { client } = mockClient(() => ({
      status: 501,
      body: { error: 'capability_not_provided', message: 'host does not advertise capabilities.prompts.endpointsSupported' },
    }));
    await expect(client.prompts.list()).rejects.toMatchObject({
      status: 501,
      envelope: { error: 'capability_not_provided' },
    });
  });

  it('throws WopError on 409 conflict from create', async () => {
    const { client } = mockClient(() => ({
      status: 409,
      body: { error: 'prompt_create_conflict', message: 'duplicate (templateId, version)' },
    }));
    await expect(client.prompts.create(SAMPLE_TEMPLATE)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('throws WopError on 404 from get', async () => {
    const { client } = mockClient(() => ({
      status: 404,
      body: { error: 'prompt_template_not_found', message: 'no template' },
    }));
    await expect(
      client.prompts.get({ templateId: 'unknown' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
