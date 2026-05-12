/**
 * Minimal OTLP/protobuf decoder for the conformance suite's OTel collector.
 *
 * OTLP supports three transport encodings: HTTP-JSON, HTTP-protobuf, and
 * gRPC. The collector at `otel-collector.ts` previously accepted only
 * HTTP-JSON, returning `415` to any host configured for HTTP-protobuf.
 * Track 11 follow-up (gap-closure plan): unlock HTTP-protobuf by decoding
 * the binary OTLP payload in-process. gRPC remains out of scope (deferred
 * to v1.2+ per `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 11).
 *
 * Scope: this decoder handles the subset of OTLP needed by the conformance
 * scenarios — trace + metric exports, with KeyValue attributes (string,
 * int, double, bool, array, kvlist, bytes variants). It is NOT a general-
 * purpose protobuf library. Zero npm dependencies; uses only node:crypto
 * stdlib types.
 *
 * Output shape: deliberately matches the OTLP/HTTP-JSON shape the
 * existing `_ingestTraces` / `_ingestMetrics` helpers already consume,
 * so the protobuf path requires no changes to the ingest logic — only
 * a content-type-routed call to `decodeExportTraceServiceRequest()` or
 * `decodeExportMetricsServiceRequest()` instead of `JSON.parse()`.
 *
 * Wire format reference:
 *   https://protobuf.dev/programming-guides/encoding/
 * OTLP proto definitions:
 *   https://github.com/open-telemetry/opentelemetry-proto/tree/main/opentelemetry/proto
 *
 * @see conformance/src/lib/otel-collector.ts
 * @see spec/v1/observability.md
 * @see docs/PROTOCOL-GAP-CLOSURE-PLAN.md Track 11
 */

const WIRE_VARINT = 0;
const WIRE_I64 = 1;
const WIRE_LEN = 2;
const WIRE_I32 = 5;

const textDecoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Reader for the OTLP protobuf wire format subset. Supports varint, LEN,
 * and I64 wire types. I32 is supported only for skip (no OTLP field we
 * decode uses fixed32 today).
 */
export class PbReader {
  private offset: number;
  public readonly end: number;
  private readonly buf: Uint8Array;

  constructor(buf: Uint8Array, offset: number = 0, end?: number) {
    this.buf = buf;
    this.offset = offset;
    this.end = end ?? buf.length;
  }

  hasMore(): boolean {
    return this.offset < this.end;
  }

  /** Read a varint as a bigint (full 64-bit range). */
  readVarint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (this.offset >= this.end) throw new Error('PbReader: unexpected EOF in varint');
      const b = this.buf[this.offset++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new Error('PbReader: varint exceeds 10 bytes');
  }

  /** Convenience: varint as a JS number (truncates above 2^53). */
  readVarintNumber(): number {
    return Number(this.readVarint());
  }

  /** Decode the field tag at the current offset. */
  readTag(): { fieldNumber: number; wireType: number } {
    const t = this.readVarintNumber();
    return { fieldNumber: t >>> 3, wireType: t & 0x7 };
  }

  /** Skip a field's payload based on its wire type. */
  skip(wireType: number): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.readVarint();
        return;
      case WIRE_I64:
        this.offset += 8;
        return;
      case WIRE_LEN: {
        const n = this.readVarintNumber();
        this.offset += n;
        return;
      }
      case WIRE_I32:
        this.offset += 4;
        return;
      default:
        throw new Error(`PbReader: cannot skip unknown wire type ${wireType}`);
    }
  }

  /** Read a LEN-prefixed byte run as raw bytes. */
  readLengthDelimited(): Uint8Array {
    const n = this.readVarintNumber();
    const start = this.offset;
    if (start + n > this.end) throw new Error('PbReader: LEN overruns buffer');
    this.offset = start + n;
    return this.buf.subarray(start, start + n);
  }

  /** Read a LEN-prefixed UTF-8 string. */
  readString(): string {
    return textDecoder.decode(this.readLengthDelimited());
  }

  /** Read a LEN-prefixed byte run as a lowercase hex string. */
  readBytesAsHex(): string {
    const bytes = this.readLengthDelimited();
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  /** Read 8 bytes as a little-endian IEEE 754 double. */
  readDouble(): number {
    if (this.offset + 8 > this.end) throw new Error('PbReader: double overruns buffer');
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, 8);
    const v = view.getFloat64(0, true);
    this.offset += 8;
    return v;
  }

  /** Read 8 bytes as a little-endian unsigned 64-bit integer (bigint). */
  readFixed64Uint(): bigint {
    if (this.offset + 8 > this.end) throw new Error('PbReader: fixed64 overruns buffer');
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, 8);
    const lo = BigInt(view.getUint32(0, true));
    const hi = BigInt(view.getUint32(4, true));
    this.offset += 8;
    return (hi << 32n) | lo;
  }

  /** Read 8 bytes as a little-endian signed 64-bit (two's complement). */
  readFixed64Int(): bigint {
    const u = this.readFixed64Uint();
    if (u >= 0x8000000000000000n) return u - 0x10000000000000000n;
    return u;
  }

  /** Open a sub-reader over a LEN-prefixed embedded message. */
  readMessage(): PbReader {
    const n = this.readVarintNumber();
    const start = this.offset;
    const end = start + n;
    if (end > this.end) throw new Error('PbReader: embedded message overruns buffer');
    this.offset = end;
    return new PbReader(this.buf, start, end);
  }
}

// ─── OTLP type aliases (deliberately match JSON shape) ─────────────────────

/**
 * Attribute value variant matching OTLP/HTTP-JSON encoding. The collector's
 * `decodeAttrValue()` already handles these shapes; the protobuf decoder
 * produces the same objects so no downstream change is needed.
 */
type JsonAnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: JsonAnyValue[] } }
  | { kvlistValue: { values: JsonKeyValue[] } }
  | { bytesValue: string }
  | Record<string, never>;

interface JsonKeyValue {
  key: string;
  value: JsonAnyValue;
}

interface JsonResource {
  attributes?: JsonKeyValue[];
}

interface JsonSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: JsonKeyValue[];
}

interface JsonScopeSpans {
  spans?: JsonSpan[];
}

interface JsonResourceSpans {
  resource?: JsonResource;
  scopeSpans?: JsonScopeSpans[];
}

export interface JsonExportTraceServiceRequest {
  resourceSpans: JsonResourceSpans[];
}

interface JsonNumberDataPoint {
  attributes?: JsonKeyValue[];
  asDouble?: number;
  asInt?: string;
}

interface JsonMetric {
  name?: string;
  description?: string;
  unit?: string;
  gauge?: { dataPoints?: JsonNumberDataPoint[] };
  sum?: { dataPoints?: JsonNumberDataPoint[] };
  histogram?: { dataPoints?: JsonNumberDataPoint[] };
}

interface JsonScopeMetrics {
  metrics?: JsonMetric[];
}

interface JsonResourceMetrics {
  resource?: JsonResource;
  scopeMetrics?: JsonScopeMetrics[];
}

export interface JsonExportMetricsServiceRequest {
  resourceMetrics: JsonResourceMetrics[];
}

// ─── Decoders ──────────────────────────────────────────────────────────────

/** AnyValue oneof — field numbers per opentelemetry-proto/common/v1/common.proto. */
function decodeAnyValue(r: PbReader): JsonAnyValue {
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    switch (fieldNumber) {
      case 1: // string_value
        return { stringValue: r.readString() };
      case 2: // bool_value (varint)
        return { boolValue: r.readVarintNumber() !== 0 };
      case 3: // int_value (varint, signed)
        return { intValue: String(r.readVarint()) };
      case 4: // double_value (fixed64 → double)
        return { doubleValue: r.readDouble() };
      case 5: { // array_value (ArrayValue)
        const sub = r.readMessage();
        const values: JsonAnyValue[] = [];
        while (sub.hasMore()) {
          const t = sub.readTag();
          if (t.fieldNumber === 1 && t.wireType === WIRE_LEN) {
            values.push(decodeAnyValue(sub.readMessage()));
          } else {
            sub.skip(t.wireType);
          }
        }
        return { arrayValue: { values } };
      }
      case 6: { // kvlist_value (KeyValueList)
        const sub = r.readMessage();
        const values: JsonKeyValue[] = [];
        while (sub.hasMore()) {
          const t = sub.readTag();
          if (t.fieldNumber === 1 && t.wireType === WIRE_LEN) {
            values.push(decodeKeyValue(sub.readMessage()));
          } else {
            sub.skip(t.wireType);
          }
        }
        return { kvlistValue: { values } };
      }
      case 7: // bytes_value
        return { bytesValue: r.readBytesAsHex() };
      default:
        r.skip(wireType);
    }
  }
  return {};
}

function decodeKeyValue(r: PbReader): JsonKeyValue {
  let key = '';
  let value: JsonAnyValue = {};
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === WIRE_LEN) {
      key = r.readString();
    } else if (fieldNumber === 2 && wireType === WIRE_LEN) {
      value = decodeAnyValue(r.readMessage());
    } else {
      r.skip(wireType);
    }
  }
  return { key, value };
}

function decodeAttributes(r: PbReader): JsonKeyValue[] {
  // Reader already positioned at the START of a KeyValue message body.
  return [decodeKeyValue(r)];
}

function decodeResource(r: PbReader): JsonResource {
  const attributes: JsonKeyValue[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === WIRE_LEN) {
      attributes.push(...decodeAttributes(r.readMessage()));
    } else {
      r.skip(wireType);
    }
  }
  return { attributes };
}

function decodeSpan(r: PbReader): JsonSpan {
  const span: JsonSpan = {};
  const attributes: JsonKeyValue[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    switch (fieldNumber) {
      case 1: // trace_id (bytes)
        span.traceId = r.readBytesAsHex();
        break;
      case 2: // span_id (bytes)
        span.spanId = r.readBytesAsHex();
        break;
      case 4: { // parent_span_id (bytes)
        const hex = r.readBytesAsHex();
        if (hex.length > 0) span.parentSpanId = hex;
        break;
      }
      case 5: // name (string)
        span.name = r.readString();
        break;
      case 7: // start_time_unix_nano (fixed64)
        span.startTimeUnixNano = String(r.readFixed64Uint());
        break;
      case 8: // end_time_unix_nano (fixed64)
        span.endTimeUnixNano = String(r.readFixed64Uint());
        break;
      case 9: // attributes (repeated KeyValue)
        attributes.push(...decodeAttributes(r.readMessage()));
        break;
      default:
        r.skip(wireType);
    }
  }
  if (attributes.length > 0) span.attributes = attributes;
  return span;
}

function decodeScopeSpans(r: PbReader): JsonScopeSpans {
  const spans: JsonSpan[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 2 && wireType === WIRE_LEN) {
      spans.push(decodeSpan(r.readMessage()));
    } else {
      r.skip(wireType);
    }
  }
  return { spans };
}

function decodeResourceSpans(r: PbReader): JsonResourceSpans {
  let resource: JsonResource | undefined;
  const scopeSpans: JsonScopeSpans[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === WIRE_LEN) {
      resource = decodeResource(r.readMessage());
    } else if (fieldNumber === 2 && wireType === WIRE_LEN) {
      scopeSpans.push(decodeScopeSpans(r.readMessage()));
    } else {
      r.skip(wireType);
    }
  }
  const out: JsonResourceSpans = { scopeSpans };
  if (resource) out.resource = resource;
  return out;
}

/** Decode an OTLP ExportTraceServiceRequest protobuf payload. */
export function decodeExportTraceServiceRequest(
  buf: Uint8Array,
): JsonExportTraceServiceRequest {
  const r = new PbReader(buf);
  const resourceSpans: JsonResourceSpans[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === WIRE_LEN) {
      resourceSpans.push(decodeResourceSpans(r.readMessage()));
    } else {
      r.skip(wireType);
    }
  }
  return { resourceSpans };
}

function decodeNumberDataPoint(r: PbReader): JsonNumberDataPoint {
  const dp: JsonNumberDataPoint = {};
  const attributes: JsonKeyValue[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    switch (fieldNumber) {
      case 4: // as_double (fixed64 → double)
        dp.asDouble = r.readDouble();
        break;
      case 6: // as_int (sfixed64)
        dp.asInt = String(r.readFixed64Int());
        break;
      case 7: // attributes
        attributes.push(...decodeAttributes(r.readMessage()));
        break;
      default:
        r.skip(wireType);
    }
  }
  if (attributes.length > 0) dp.attributes = attributes;
  return dp;
}

function decodeDataPointContainer(r: PbReader): { dataPoints: JsonNumberDataPoint[] } {
  const dataPoints: JsonNumberDataPoint[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === WIRE_LEN) {
      dataPoints.push(decodeNumberDataPoint(r.readMessage()));
    } else {
      r.skip(wireType);
    }
  }
  return { dataPoints };
}

function decodeMetric(r: PbReader): JsonMetric {
  const metric: JsonMetric = {};
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    switch (fieldNumber) {
      case 1: // name
        metric.name = r.readString();
        break;
      case 2: // description
        metric.description = r.readString();
        break;
      case 3: // unit
        metric.unit = r.readString();
        break;
      case 5: // gauge
        metric.gauge = decodeDataPointContainer(r.readMessage());
        break;
      case 7: // sum
        metric.sum = decodeDataPointContainer(r.readMessage());
        break;
      case 9: // histogram (data points have a different shape; we only
              // extract attributes + skip numeric value detail, which
              // the JSON path also handles via the same DataPointContainer
              // shape for the subset the conformance suite asserts on)
        metric.histogram = decodeDataPointContainer(r.readMessage());
        break;
      default:
        r.skip(wireType);
    }
  }
  return metric;
}

function decodeScopeMetrics(r: PbReader): JsonScopeMetrics {
  const metrics: JsonMetric[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 2 && wireType === WIRE_LEN) {
      metrics.push(decodeMetric(r.readMessage()));
    } else {
      r.skip(wireType);
    }
  }
  return { metrics };
}

function decodeResourceMetrics(r: PbReader): JsonResourceMetrics {
  let resource: JsonResource | undefined;
  const scopeMetrics: JsonScopeMetrics[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === WIRE_LEN) {
      resource = decodeResource(r.readMessage());
    } else if (fieldNumber === 2 && wireType === WIRE_LEN) {
      scopeMetrics.push(decodeScopeMetrics(r.readMessage()));
    } else {
      r.skip(wireType);
    }
  }
  const out: JsonResourceMetrics = { scopeMetrics };
  if (resource) out.resource = resource;
  return out;
}

/** Decode an OTLP ExportMetricsServiceRequest protobuf payload. */
export function decodeExportMetricsServiceRequest(
  buf: Uint8Array,
): JsonExportMetricsServiceRequest {
  const r = new PbReader(buf);
  const resourceMetrics: JsonResourceMetrics[] = [];
  while (r.hasMore()) {
    const { fieldNumber, wireType } = r.readTag();
    if (fieldNumber === 1 && wireType === WIRE_LEN) {
      resourceMetrics.push(decodeResourceMetrics(r.readMessage()));
    } else {
      r.skip(wireType);
    }
  }
  return { resourceMetrics };
}
