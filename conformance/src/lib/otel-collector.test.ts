/**
 * End-to-end unit tests for the OTel collector's HTTP receiver.
 *
 * Boots the collector on an ephemeral port, posts synthesized OTLP
 * payloads (both JSON and protobuf), and asserts the collector
 * correctly captures them. Closes the gap the senior code-review pass
 * flagged as MEDIUM-3 — the protobuf decoder has 18 unit tests, but
 * those don't exercise the collector's HTTP receive wiring
 * (content-type routing, body-size guard, error responses).
 *
 * Server-free (binds to 127.0.0.1 on an ephemeral port; no host required).
 *
 * @see conformance/src/lib/otel-collector.ts
 * @see conformance/src/lib/otlp-protobuf.ts
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { OtelCollector } from './otel-collector.js';

// ─── Minimal in-test OTLP/protobuf encoder ─────────────────────────────────
// Hand-rolled so the e2e test doesn't depend on the decoder's own test file
// re-exporting its writer. ~50 LOC; only encodes the wire-format subset this
// file actually emits.

const WIRE_I64 = 1;
const WIRE_LEN = 2;

function encVarint(out: number[], v: number | bigint): void {
  let x = typeof v === 'bigint' ? v : BigInt(v);
  while (x >= 0x80n) {
    out.push(Number(x & 0x7fn) | 0x80);
    x >>= 7n;
  }
  out.push(Number(x & 0x7fn));
}

function encTag(out: number[], field: number, wire: number): void {
  encVarint(out, (field << 3) | wire);
}

function encString(out: number[], field: number, s: string): void {
  const bytes = new TextEncoder().encode(s);
  encTag(out, field, WIRE_LEN);
  encVarint(out, bytes.length);
  for (const b of bytes) out.push(b);
}

function encBytesHex(out: number[], field: number, hex: string): void {
  const len = hex.length / 2;
  encTag(out, field, WIRE_LEN);
  encVarint(out, len);
  for (let i = 0; i < len; i++) {
    out.push(Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
}

function encFixed64(out: number[], field: number, v: bigint): void {
  encTag(out, field, WIRE_I64);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, v, true);
  for (let i = 0; i < 8; i++) out.push(new Uint8Array(buf)[i]);
}

function encMessage(out: number[], field: number, body: number[]): void {
  encTag(out, field, WIRE_LEN);
  encVarint(out, body.length);
  for (const b of body) out.push(b);
}

function buildMinimalProtobufExportTrace(spanName: string, traceIdHex: string, runIdAttr: string): Uint8Array {
  // KeyValue { key: "openwop.run_id", value: { stringValue: runIdAttr } }
  const anyValue: number[] = [];
  encString(anyValue, 1, runIdAttr);
  const kv: number[] = [];
  encString(kv, 1, 'openwop.run_id');
  encMessage(kv, 2, anyValue);

  // Span { trace_id, span_id, name, start, end, attributes }
  const span: number[] = [];
  encBytesHex(span, 1, traceIdHex);
  encBytesHex(span, 2, '0123456789abcdef');
  encString(span, 5, spanName);
  encFixed64(span, 7, 1700000000000000000n);
  encFixed64(span, 8, 1700000000100000000n);
  encMessage(span, 9, kv);

  // ScopeSpans { spans: [span] }
  const scopeSpans: number[] = [];
  encMessage(scopeSpans, 2, span);

  // ResourceSpans { scope_spans: [scopeSpans] }
  const resourceSpans: number[] = [];
  encMessage(resourceSpans, 2, scopeSpans);

  // ExportTraceServiceRequest { resource_spans: [resourceSpans] }
  const req: number[] = [];
  encMessage(req, 1, resourceSpans);

  return new Uint8Array(req);
}

// ─── Test fixture ──────────────────────────────────────────────────────────

let collector: OtelCollector;
let endpoint: string;

beforeAll(async () => {
  collector = new OtelCollector();
  await collector.start(0);
  endpoint = collector.endpoint();
});

afterAll(async () => {
  await collector.stop();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('OtelCollector: HTTP receiver wiring', () => {
  it('accepts OTLP/HTTP-protobuf POST on /v1/traces and captures spans', async () => {
    collector.reset();
    const body = buildMinimalProtobufExportTrace(
      'openwop.run',
      '0123456789abcdef0123456789abcdef',
      'run-pb-e2e',
    );

    const res = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body,
    });

    expect(res.status).toBe(200);

    const captured = collector.spansWithAttribute('openwop.run_id', 'run-pb-e2e');
    expect(captured.length).toBe(1);
    expect(captured[0].name).toBe('openwop.run');
    expect(captured[0].traceId).toBe('0123456789abcdef0123456789abcdef');
  });

  it('accepts OTLP/HTTP-JSON POST on /v1/traces and captures spans', async () => {
    collector.reset();
    const payload = {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  spanId: 'bbbbbbbbbbbbbbbb',
                  name: 'openwop.run',
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000000050000000',
                  attributes: [
                    { key: 'openwop.run_id', value: { stringValue: 'run-json-e2e' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);

    const captured = collector.spansWithAttribute('openwop.run_id', 'run-json-e2e');
    expect(captured.length).toBe(1);
    expect(captured[0].name).toBe('openwop.run');
  });

  // Note: the collector also accepts "no Content-Type" as JSON for
  // back-compat with non-spec OTLP clients. fetch() can't reproduce
  // that case — Node automatically sets Content-Type when given a body
  // — so the empty-content-type path is exercised only via direct
  // node:http use (out of scope for this e2e suite).

  it('returns 415 for an unsupported Content-Type', async () => {
    collector.reset();
    const res = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: 'a,b,c\n1,2,3',
    });

    expect(res.status).toBe(415);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe('unsupported_media_type');
    expect(body.message).toContain('text/csv');
    expect(collector.spans().length).toBe(0);
  });

  it('returns 400 for malformed JSON', async () => {
    collector.reset();
    const res = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not valid json',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid_json');
  });

  it('returns 400 for malformed protobuf', async () => {
    collector.reset();
    // Garbage bytes — first byte is a tag for field 0 (invalid) which the
    // decoder skips, but the second byte is mid-varint with continuation
    // bit set and no follow-up → readVarint throws on unexpected EOF.
    const res = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: new Uint8Array([0x0a, 0xff]),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid_protobuf');
  });

  it('returns 405 for non-POST methods', async () => {
    collector.reset();
    const res = await fetch(`${endpoint}/v1/traces`, { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('returns 413 when body exceeds 16 MiB cap', async () => {
    collector.reset();
    // 16 MiB + 1 byte. Use a fresh ArrayBuffer to avoid TypedArray-cap issues.
    const oversize = new Uint8Array(16 * 1024 * 1024 + 1);
    oversize.fill(0x00);

    const res = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: oversize,
    });

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('payload_too_large');
  }, 30_000); // larger timeout — uploading 16 MiB to localhost still costs a few hundred ms

  it('routes /v1/metrics to the metrics ingest path (JSON)', async () => {
    collector.reset();
    const payload = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'openwop.queue.depth',
                  unit: 'count',
                  gauge: {
                    dataPoints: [
                      {
                        asDouble: 3,
                        attributes: [],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const res = await fetch(`${endpoint}/v1/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const m = collector.metricByName('openwop.queue.depth');
    expect(m).toBeDefined();
    expect(m?.kind).toBe('gauge');
    expect(m?.dataPoint.value).toBe(3);
  });

  it('200-OKs unknown paths without ingesting (forward-compat for /v1/logs)', async () => {
    collector.reset();
    const res = await fetch(`${endpoint}/v1/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(collector.spans().length).toBe(0);
    expect(collector.metrics().length).toBe(0);
  });
});
