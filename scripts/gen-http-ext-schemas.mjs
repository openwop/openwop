#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PACK = 'core.openwop.http';
const VER = '1.1.0';
const OUT = join('packs', PACK, 'schemas');
mkdirSync(OUT, { recursive: true });
const $id = (f) => `https://packs.openwop.dev/${PACK}/${VER}/${f}`;
const obj = (title, required, properties) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title, type: 'object',
  ...(required && required.length ? { required } : {}),
  properties, additionalProperties: false,
});

const STR = { type: 'string' };
const INT = { type: 'integer' };
const URL_F = { type: 'string', format: 'uri' };
const HEADERS = { type: 'object', additionalProperties: STR };
const ANY = {};

const M = {
  'openapi-call': {
    c: obj('OpenapiCallConfig', ['operationId'], { operationId: STR, baseUrl: URL_F }),
    i: obj('OpenapiCallInput', ['openapi'], {
      openapi: { type: 'object', additionalProperties: true },
      pathParams: { type: 'object', additionalProperties: ANY },
      queryParams: { type: 'object', additionalProperties: ANY },
      headers: HEADERS, body: ANY,
    }),
    o: obj('OpenapiCallOutput', ['status'], { url: STR, method: STR, status: INT, headers: HEADERS, body: ANY }),
  },
  'graphql-query': {
    c: obj('GraphqlQueryConfig', ['endpoint'], { endpoint: URL_F }),
    i: obj('GraphqlQueryInput', ['query'], { query: STR, variables: { type: 'object', additionalProperties: ANY }, operationName: STR, headers: HEADERS }),
    o: obj('GraphqlQueryOutput', ['status'], { status: INT, headers: HEADERS, body: ANY, data: ANY, errors: { type: ['array','null'] } }),
  },
  'graphql-mutation': {
    c: obj('GraphqlMutationConfig', ['endpoint'], { endpoint: URL_F }),
    i: obj('GraphqlMutationInput', ['query'], { query: STR, variables: { type: 'object', additionalProperties: ANY }, operationName: STR, headers: HEADERS }),
    o: obj('GraphqlMutationOutput', ['status'], { status: INT, headers: HEADERS, body: ANY, data: ANY, errors: { type: ['array','null'] } }),
  },
  'graphql-subscription': {
    c: obj('GraphqlSubscriptionConfig', ['endpoint'], { endpoint: URL_F }),
    i: obj('GraphqlSubscriptionInput', ['query'], { query: STR, variables: { type: 'object', additionalProperties: ANY }, headers: HEADERS }),
    o: obj('GraphqlSubscriptionOutput', ['events','eventCount'], { terminal: ANY, events: { type: 'array' }, eventCount: INT }),
  },
  'soap-call': {
    c: obj('SoapCallConfig', ['endpoint'], { endpoint: URL_F, soapAction: STR }),
    i: obj('SoapCallInput', ['envelope'], { envelope: STR, headers: HEADERS }),
    o: obj('SoapCallOutput', ['status'], { status: INT, headers: HEADERS, body: STR }),
  },
  ...Object.fromEntries(['unary','server-stream','client-stream','bidi'].map((k) => [
    `grpc-${k}`,
    {
      c: obj(`Grpc${k}Config`, ['endpoint','service','method'], { endpoint: URL_F, service: STR, method: STR }),
      i: obj(`Grpc${k}Input`, ['request'], { request: ANY, metadata: { type: 'object', additionalProperties: ANY } }),
      o: obj(`Grpc${k}Output`, [], k === 'unary' ? { result: ANY } : { result: ANY, events: { type: 'array' }, eventCount: INT }),
    },
  ])),
  'sse-consume': {
    c: obj('SseConsumeConfig', [], { durationMs: { type: 'integer', minimum: 0, default: 30000 } }),
    i: obj('SseConsumeInput', ['url'], { url: URL_F, headers: HEADERS }),
    o: obj('SseConsumeOutput', ['events','eventCount'], { events: { type: 'array' }, eventCount: INT }),
  },
  'websocket-client': {
    c: obj('WebsocketClientConfig', [], { durationMs: { type: 'integer', minimum: 0, default: 30000 } }),
    i: obj('WebsocketClientInput', ['url'], { url: URL_F, headers: HEADERS, send: { type: 'array', items: ANY } }),
    o: obj('WebsocketClientOutput', ['events','eventCount'], { events: { type: 'array' }, eventCount: INT }),
  },
  'long-poll': {
    c: obj('LongPollConfig', [], { maxIterations: { type: 'integer', default: 60 }, intervalMs: { type: 'integer', default: 5000 } }),
    i: obj('LongPollInput', ['url'], { url: URL_F, headers: HEADERS }),
    o: obj('LongPollOutput', ['status','iterations'], { status: INT, headers: HEADERS, body: ANY, iterations: INT, exhausted: { type: 'boolean' } }),
  },
  'upload-multipart': {
    c: obj('UploadMultipartConfig', [], {}),
    i: obj('UploadMultipartInput', ['url'], {
      url: URL_F, headers: HEADERS,
      fields: { type: 'object', additionalProperties: ANY },
      files: { type: 'array', items: obj('FilePart', ['field','filename','contentBase64'], {
        field: STR, filename: STR, contentBase64: STR, contentType: STR,
      }) },
    }),
    o: obj('UploadMultipartOutput', ['status'], { status: INT, headers: HEADERS, body: ANY }),
  },
  'upload-resumable': {
    c: obj('UploadResumableConfig', [], { protocol: { type: 'string', enum: ['tus','s3-multipart','gcs-resumable'], default: 'tus' } }),
    i: obj('UploadResumableInput', ['url','contentBase64'], { url: URL_F, contentBase64: STR, contentType: STR, metadata: { type: 'object', additionalProperties: ANY } }),
    o: obj('UploadResumableOutput', ['result'], { result: ANY }),
  },
  'download-stream': {
    c: obj('DownloadStreamConfig', [], {}),
    i: obj('DownloadStreamInput', ['url'], { url: URL_F, headers: HEADERS }),
    o: obj('DownloadStreamOutput', ['status','totalBytes','contentBase64'], { status: INT, totalBytes: INT, contentBase64: STR, contentType: STR }),
  },
  'pagination-cursor': {
    c: obj('PaginationCursorConfig', [], { maxPages: INT, cursorPath: STR, itemsPath: STR }),
    i: obj('PaginationCursorInput', ['url'], { url: URL_F, headers: HEADERS, startCursor: STR }),
    o: obj('PaginationCursorOutput', ['pages','pageCount'], { pages: { type: 'array' }, pageCount: INT }),
  },
  'pagination-offset': {
    c: obj('PaginationOffsetConfig', [], { maxPages: INT, pageSize: INT, itemsPath: STR }),
    i: obj('PaginationOffsetInput', ['url'], { url: URL_F, headers: HEADERS, startOffset: INT }),
    o: obj('PaginationOffsetOutput', ['pages','pageCount'], { pages: { type: 'array' }, pageCount: INT }),
  },
  'pagination-link-header': {
    c: obj('PaginationLinkHeaderConfig', [], { maxPages: INT }),
    i: obj('PaginationLinkHeaderInput', ['url'], { url: URL_F, headers: HEADERS }),
    o: obj('PaginationLinkHeaderOutput', ['pages','pageCount'], { pages: { type: 'array' }, pageCount: INT }),
  },
  'retry-rate-limit-aware': {
    c: obj('RetryRateLimitAwareConfig', [], { maxAttempts: { type: 'integer', default: 5 }, baseDelayMs: { type: 'integer', default: 500 } }),
    i: obj('RetryRateLimitAwareInput', ['url'], { url: URL_F, method: STR, headers: HEADERS, body: ANY }),
    o: obj('RetryRateLimitAwareOutput', ['status','attempts'], { status: INT, headers: HEADERS, body: ANY, attempts: INT, exhausted: { type: 'boolean' } }),
  },
  'circuit-breaker': {
    c: obj('CircuitBreakerConfig', [], { breakerKey: STR, threshold: { type: 'integer', default: 5 }, cooldownMs: { type: 'integer', default: 30000 } }),
    i: obj('CircuitBreakerInput', ['url'], { url: URL_F, method: STR, headers: HEADERS, body: ANY }),
    o: obj('CircuitBreakerOutput', ['circuitOpen'], { circuitOpen: { type: 'boolean' }, status: INT, headers: HEADERS, body: ANY, openUntilMs: INT }),
  },
  'idempotency-key': {
    c: obj('IdempotencyKeyConfig', [], { mode: { type: 'string', enum: ['uuid','hash','composite'], default: 'uuid' } }),
    i: obj('IdempotencyKeyInput', [], { payload: ANY, runId: STR, nodeId: STR }),
    o: obj('IdempotencyKeyOutput', ['key'], { key: STR }),
  },
  'webhook-verify': {
    c: obj('WebhookVerifyConfig', ['family'], {
      family: { type: 'string', enum: ['stripe','github','slack','raw-hmac'] },
      algorithm: { type: 'string', enum: ['sha256','sha384','sha512'] },
    }),
    i: obj('WebhookVerifyInput', ['signatureHeader','secret','body'], {
      signatureHeader: STR, secret: STR, body: STR, timestampHeader: STR,
    }),
    o: obj('WebhookVerifyOutput', ['valid'], { valid: { type: 'boolean' }, family: STR }),
  },
};

let count = 0;
const manifestEntries = [];
for (const [node, parts] of Object.entries(M)) {
  for (const [k, schema] of [['config', parts.c], ['input', parts.i], ['output', parts.o]]) {
    const f = `${node}.${k}.json`;
    const ordered = { $schema: schema.$schema, $id: $id(f), ...Object.fromEntries(Object.entries(schema).filter(([x]) => x !== '$schema' && x !== '$id')) };
    writeFileSync(join(OUT, f), JSON.stringify(ordered, null, 2) + '\n');
    count++;
  }
  const isStreaming = ['graphql-subscription','grpc-server-stream','grpc-client-stream','grpc-bidi','sse-consume','websocket-client','download-stream','pagination-cursor','pagination-offset','pagination-link-header'].includes(node);
  manifestEntries.push({
    typeId: `core.openwop.http.${node}`, version: '1.0.0',
    label: parts.c.title.replace(/Config$/, '').replace(/([a-z])([A-Z])/g, '$1 $2'),
    description: `v1.1 HTTP node — ${node}.`,
    category: 'integration',
    role: ['idempotency-key','webhook-verify'].includes(node) ? 'pure' : (isStreaming ? 'streaming-output' : 'side-effect'),
    capabilities: ['idempotency-key','webhook-verify'].includes(node) ? ['cacheable'] : (isStreaming ? ['cacheable','side-effectful','streamable'] : ['cacheable','side-effectful']),
    configSchemaRef: `schemas/${node}.config.json`,
    inputSchemaRef: `schemas/${node}.input.json`,
    outputSchemaRef: `schemas/${node}.output.json`,
  });
}
writeFileSync(join('packs', PACK, 'v1.1-nodes.json'), JSON.stringify(manifestEntries, null, 2) + '\n');
console.log(`wrote ${count} schemas + manifest fragment with ${manifestEntries.length} nodes`);
