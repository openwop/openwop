/**
 * Server-free unit tests for the OTLP protobuf decoder.
 *
 * The decoder is real protobuf wire-format parsing. Track 11 follow-up
 * landed it to unlock the broader class of OTLP-only hosts that emit
 * application/x-protobuf rather than application/json. A regression in
 * varint decoding, fixed64 endianness, or AnyValue oneof handling would
 * cause silent telemetry loss — the host emits, the collector accepts,
 * but the spans/metrics never reach the assertion path.
 *
 * Strategy: an in-file `PbWriter` encoder synthesizes minimal OTLP
 * payloads; we round-trip them through `decodeExportTraceServiceRequest`
 * / `decodeExportMetricsServiceRequest` and assert the output shape.
 * The writer is test-only — production code only ever decodes.
 *
 * @see conformance/src/lib/otlp-protobuf.ts
 */

import { describe, it, expect } from 'vitest';
import {
  PbReader,
  decodeExportTraceServiceRequest,
  decodeExportMetricsServiceRequest,
} from './otlp-protobuf.js';

// ─── Test-only protobuf encoder ────────────────────────────────────────────

const WIRE_VARINT = 0;
const WIRE_I64 = 1;
const WIRE_LEN = 2;

class PbWriter {
  private chunks: number[] = [];

  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }

  writeVarint(v: bigint | number): void {
    let x = typeof v === 'bigint' ? v : BigInt(v);
    while (x >= 0x80n) {
      this.chunks.push(Number(x & 0x7fn) | 0x80);
      x >>= 7n;
    }
    this.chunks.push(Number(x & 0x7fn));
  }

  writeTag(fieldNumber: number, wireType: number): void {
    this.writeVarint((fieldNumber << 3) | wireType);
  }

  writeString(fieldNumber: number, value: string): void {
    this.writeTag(fieldNumber, WIRE_LEN);
    const enc = new TextEncoder().encode(value);
    this.writeVarint(enc.length);
    for (const b of enc) this.chunks.push(b);
  }

  writeBytes(fieldNumber: number, value: Uint8Array): void {
    this.writeTag(fieldNumber, WIRE_LEN);
    this.writeVarint(value.length);
    for (const b of value) this.chunks.push(b);
  }

  writeBytesHex(fieldNumber: number, hex: string): void {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    this.writeBytes(fieldNumber, bytes);
  }

  writeVarintField(fieldNumber: number, v: bigint | number): void {
    this.writeTag(fieldNumber, WIRE_VARINT);
    this.writeVarint(v);
  }

  writeFixed64Uint(fieldNumber: number, v: bigint): void {
    this.writeTag(fieldNumber, WIRE_I64);
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setBigUint64(0, v, true);
    for (let i = 0; i < 8; i++) this.chunks.push(view.getUint8(i));
  }

  writeFixed64Int(fieldNumber: number, v: bigint): void {
    this.writeTag(fieldNumber, WIRE_I64);
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setBigInt64(0, v, true);
    for (let i = 0; i < 8; i++) this.chunks.push(view.getUint8(i));
  }

  writeDouble(fieldNumber: number, v: number): void {
    this.writeTag(fieldNumber, WIRE_I64);
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.chunks.push(view.getUint8(i));
  }

  writeMessage(fieldNumber: number, body: Uint8Array): void {
    this.writeTag(fieldNumber, WIRE_LEN);
    this.writeVarint(body.length);
    for (const b of body) this.chunks.push(b);
  }
}

// Helpers for building OTLP message shapes.

function buildAnyValue(variant: { type: 'string' | 'int' | 'double' | 'bool'; value: unknown }): Uint8Array {
  const w = new PbWriter();
  switch (variant.type) {
    case 'string':
      w.writeString(1, variant.value as string);
      break;
    case 'int':
      w.writeVarintField(3, variant.value as number);
      break;
    case 'double':
      w.writeDouble(4, variant.value as number);
      break;
    case 'bool':
      w.writeVarintField(2, (variant.value as boolean) ? 1 : 0);
      break;
  }
  return w.bytes();
}

function buildKeyValue(key: string, value: Uint8Array): Uint8Array {
  const w = new PbWriter();
  w.writeString(1, key);
  w.writeMessage(2, value);
  return w.bytes();
}

function buildSpan(s: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startNanos: bigint;
  endNanos: bigint;
  attrs: Array<{ key: string; type: 'string' | 'int' | 'double' | 'bool'; value: unknown }>;
}): Uint8Array {
  const w = new PbWriter();
  w.writeBytesHex(1, s.traceId);
  w.writeBytesHex(2, s.spanId);
  if (s.parentSpanId) w.writeBytesHex(4, s.parentSpanId);
  w.writeString(5, s.name);
  w.writeFixed64Uint(7, s.startNanos);
  w.writeFixed64Uint(8, s.endNanos);
  for (const a of s.attrs) {
    w.writeMessage(9, buildKeyValue(a.key, buildAnyValue({ type: a.type, value: a.value })));
  }
  return w.bytes();
}

function buildExportTrace(span: Uint8Array, resourceAttrs: Array<{ key: string; value: string }> = []): Uint8Array {
  const scopeSpans = new PbWriter();
  scopeSpans.writeMessage(2, span);

  const resource = new PbWriter();
  for (const a of resourceAttrs) {
    resource.writeMessage(1, buildKeyValue(a.key, buildAnyValue({ type: 'string', value: a.value })));
  }

  const resourceSpans = new PbWriter();
  resourceSpans.writeMessage(1, resource.bytes());
  resourceSpans.writeMessage(2, scopeSpans.bytes());

  const req = new PbWriter();
  req.writeMessage(1, resourceSpans.bytes());
  return req.bytes();
}

function buildNumberDataPoint(opts: {
  asDouble?: number;
  asInt?: bigint;
  attrs?: Array<{ key: string; value: string }>;
}): Uint8Array {
  const w = new PbWriter();
  if (opts.asDouble !== undefined) w.writeDouble(4, opts.asDouble);
  if (opts.asInt !== undefined) w.writeFixed64Int(6, opts.asInt);
  for (const a of opts.attrs ?? []) {
    w.writeMessage(7, buildKeyValue(a.key, buildAnyValue({ type: 'string', value: a.value })));
  }
  return w.bytes();
}

function buildMetric(opts: {
  name: string;
  description?: string;
  unit?: string;
  variant: 'gauge' | 'sum';
  dataPoint: Uint8Array;
}): Uint8Array {
  const dpc = new PbWriter();
  dpc.writeMessage(1, opts.dataPoint);

  const m = new PbWriter();
  m.writeString(1, opts.name);
  if (opts.description) m.writeString(2, opts.description);
  if (opts.unit) m.writeString(3, opts.unit);
  if (opts.variant === 'gauge') {
    m.writeMessage(5, dpc.bytes());
  } else {
    m.writeMessage(7, dpc.bytes());
  }
  return m.bytes();
}

function buildExportMetrics(metric: Uint8Array): Uint8Array {
  const scopeMetrics = new PbWriter();
  scopeMetrics.writeMessage(2, metric);

  const resourceMetrics = new PbWriter();
  resourceMetrics.writeMessage(2, scopeMetrics.bytes());

  const req = new PbWriter();
  req.writeMessage(1, resourceMetrics.bytes());
  return req.bytes();
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('PbReader: low-level wire format', () => {
  it('decodes single-byte varint', () => {
    const r = new PbReader(new Uint8Array([0x7f]));
    expect(r.readVarintNumber()).toBe(127);
  });

  it('decodes multi-byte varint (continuation bit)', () => {
    // 300 = 0xAC, 0x02
    const r = new PbReader(new Uint8Array([0xac, 0x02]));
    expect(r.readVarintNumber()).toBe(300);
  });

  it('throws on varint exceeding 10 bytes', () => {
    const r = new PbReader(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    expect(() => r.readVarint()).toThrow(/exceeds 10 bytes/);
  });

  it('readTag splits field number and wire type', () => {
    const w = new PbWriter();
    w.writeTag(42, WIRE_LEN);
    const r = new PbReader(w.bytes());
    const t = r.readTag();
    expect(t.fieldNumber).toBe(42);
    expect(t.wireType).toBe(WIRE_LEN);
  });

  it('readDouble round-trips little-endian IEEE 754', () => {
    const w = new PbWriter();
    w.writeDouble(1, 3.14159);
    const r = new PbReader(w.bytes());
    r.readTag();
    expect(r.readDouble()).toBeCloseTo(3.14159, 10);
  });

  it('readFixed64Uint round-trips a large unsigned 64-bit', () => {
    const w = new PbWriter();
    const v = 1758000000000000000n; // realistic OTel timestamp (Sept 2025-ish)
    w.writeFixed64Uint(1, v);
    const r = new PbReader(w.bytes());
    r.readTag();
    expect(r.readFixed64Uint()).toBe(v);
  });

  it('readFixed64Int handles negative two\'s-complement', () => {
    const w = new PbWriter();
    w.writeFixed64Int(1, -42n);
    const r = new PbReader(w.bytes());
    r.readTag();
    expect(r.readFixed64Int()).toBe(-42n);
  });

  it('readBytesAsHex produces canonical lowercase hex', () => {
    const w = new PbWriter();
    w.writeBytes(1, new Uint8Array([0x00, 0xfa, 0xce, 0xb0, 0x0c]));
    const r = new PbReader(w.bytes());
    r.readTag();
    expect(r.readBytesAsHex()).toBe('00faceb00c');
  });
});

describe('decodeExportTraceServiceRequest: span round-trip', () => {
  it('decodes a single span with required fields', () => {
    const span = buildSpan({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: 'fedcba9876543210',
      name: 'openwop.run',
      startNanos: 1700000000000000000n,
      endNanos: 1700000000100000000n,
      attrs: [
        { key: 'openwop.run_id', type: 'string', value: 'run-abc' },
        { key: 'openwop.workflow_id', type: 'string', value: 'conformance-noop' },
      ],
    });
    const req = buildExportTrace(span);

    const decoded = decodeExportTraceServiceRequest(req);
    expect(decoded.resourceSpans.length).toBe(1);
    const spans = decoded.resourceSpans[0].scopeSpans?.[0]?.spans ?? [];
    expect(spans.length).toBe(1);
    const s = spans[0];
    expect(s.traceId).toBe('0123456789abcdef0123456789abcdef');
    expect(s.spanId).toBe('fedcba9876543210');
    expect(s.parentSpanId).toBeUndefined();
    expect(s.name).toBe('openwop.run');
    expect(s.startTimeUnixNano).toBe('1700000000000000000');
    expect(s.endTimeUnixNano).toBe('1700000000100000000');
    expect(s.attributes?.map((a) => a.key)).toEqual([
      'openwop.run_id',
      'openwop.workflow_id',
    ]);
    expect(s.attributes?.[0].value).toEqual({ stringValue: 'run-abc' });
  });

  it('handles parentSpanId when present', () => {
    const span = buildSpan({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      parentSpanId: 'c'.repeat(16),
      name: 'child',
      startNanos: 0n,
      endNanos: 1n,
      attrs: [],
    });
    const req = buildExportTrace(span);
    const decoded = decodeExportTraceServiceRequest(req);
    const s = decoded.resourceSpans[0].scopeSpans?.[0]?.spans?.[0];
    expect(s?.parentSpanId).toBe('c'.repeat(16));
  });

  it('threads resource attributes through ResourceSpans', () => {
    const span = buildSpan({
      traceId: '00'.repeat(16),
      spanId: '11'.repeat(8),
      name: 's',
      startNanos: 0n,
      endNanos: 1n,
      attrs: [],
    });
    const req = buildExportTrace(span, [{ key: 'service.name', value: 'openwop-host-sqlite' }]);
    const decoded = decodeExportTraceServiceRequest(req);
    const resource = decoded.resourceSpans[0].resource;
    expect(resource?.attributes?.[0]).toEqual({
      key: 'service.name',
      value: { stringValue: 'openwop-host-sqlite' },
    });
  });
});

describe('decodeExportTraceServiceRequest: AnyValue oneof', () => {
  it('decodes intValue as a string (matches JSON shape)', () => {
    const span = buildSpan({
      traceId: '00'.repeat(16),
      spanId: '11'.repeat(8),
      name: 's',
      startNanos: 0n,
      endNanos: 1n,
      attrs: [{ key: 'openwop.node_count', type: 'int', value: 7 }],
    });
    const decoded = decodeExportTraceServiceRequest(buildExportTrace(span));
    const attr = decoded.resourceSpans[0].scopeSpans?.[0]?.spans?.[0]?.attributes?.[0];
    expect(attr?.value).toEqual({ intValue: '7' });
  });

  it('decodes doubleValue as a number', () => {
    const span = buildSpan({
      traceId: '00'.repeat(16),
      spanId: '11'.repeat(8),
      name: 's',
      startNanos: 0n,
      endNanos: 1n,
      attrs: [{ key: 'openwop.cost.usd', type: 'double', value: 0.0123 }],
    });
    const decoded = decodeExportTraceServiceRequest(buildExportTrace(span));
    const attr = decoded.resourceSpans[0].scopeSpans?.[0]?.spans?.[0]?.attributes?.[0];
    expect(attr?.value).toEqual({ doubleValue: 0.0123 });
  });

  it('decodes boolValue', () => {
    const span = buildSpan({
      traceId: '00'.repeat(16),
      spanId: '11'.repeat(8),
      name: 's',
      startNanos: 0n,
      endNanos: 1n,
      attrs: [{ key: 'openwop.is_replay', type: 'bool', value: true }],
    });
    const decoded = decodeExportTraceServiceRequest(buildExportTrace(span));
    const attr = decoded.resourceSpans[0].scopeSpans?.[0]?.spans?.[0]?.attributes?.[0];
    expect(attr?.value).toEqual({ boolValue: true });
  });
});

describe('decodeExportMetricsServiceRequest: gauge + sum', () => {
  it('decodes a gauge with double data point + attributes', () => {
    const dp = buildNumberDataPoint({
      asDouble: 5.5,
      attrs: [{ key: 'openwop.run_id', value: 'run-xyz' }],
    });
    const m = buildMetric({
      name: 'openwop.run.duration',
      unit: 'ms',
      variant: 'gauge',
      dataPoint: dp,
    });
    const req = buildExportMetrics(m);

    const decoded = decodeExportMetricsServiceRequest(req);
    const metric = decoded.resourceMetrics[0].scopeMetrics?.[0]?.metrics?.[0];
    expect(metric?.name).toBe('openwop.run.duration');
    expect(metric?.unit).toBe('ms');
    expect(metric?.gauge?.dataPoints?.[0].asDouble).toBe(5.5);
    expect(metric?.gauge?.dataPoints?.[0].attributes?.[0]).toEqual({
      key: 'openwop.run_id',
      value: { stringValue: 'run-xyz' },
    });
  });

  it('decodes a sum with sfixed64 as_int (negative value as string)', () => {
    const dp = buildNumberDataPoint({ asInt: -1234n });
    const m = buildMetric({
      name: 'openwop.queue.depth',
      variant: 'sum',
      dataPoint: dp,
    });
    const decoded = decodeExportMetricsServiceRequest(buildExportMetrics(m));
    const metric = decoded.resourceMetrics[0].scopeMetrics?.[0]?.metrics?.[0];
    expect(metric?.sum?.dataPoints?.[0].asInt).toBe('-1234');
  });
});

describe('decodeExportTraceServiceRequest: forward-compat (unknown fields)', () => {
  it('skips unknown field numbers without erroring', () => {
    // Build a Span body that includes an unknown field 99 (varint).
    const w = new PbWriter();
    w.writeBytesHex(1, '00'.repeat(16)); // traceId
    w.writeBytesHex(2, '11'.repeat(8)); // spanId
    w.writeString(5, 'forward-compat-span'); // name
    w.writeFixed64Uint(7, 0n); // startTimeUnixNano
    w.writeFixed64Uint(8, 1n); // endTimeUnixNano
    w.writeVarintField(99, 1234); // unknown — decoder MUST skip
    w.writeString(100, 'future-field'); // unknown LEN — decoder MUST skip

    const req = buildExportTrace(w.bytes());
    const decoded = decodeExportTraceServiceRequest(req);
    const s = decoded.resourceSpans[0].scopeSpans?.[0]?.spans?.[0];
    expect(s?.name).toBe('forward-compat-span');
  });
});

describe('decodeExportTraceServiceRequest: empty payload', () => {
  it('returns empty resourceSpans for an empty buffer', () => {
    const decoded = decodeExportTraceServiceRequest(new Uint8Array(0));
    expect(decoded.resourceSpans).toEqual([]);
  });
});
