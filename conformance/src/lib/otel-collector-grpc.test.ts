/**
 * End-to-end OTLP/gRPC collector tests — Track 11.
 *
 * Boots an `OtelCollector` with `startGrpc()`, sends a hand-rolled
 * OTLP trace request over h2c HTTP/2 with gRPC framing, and asserts
 * the collector captured the span. Validates that the framing
 * primitive + protobuf decoder + ingest pipeline compose end-to-end.
 *
 * @see otel-collector.ts §_handleGrpcStream
 * @see grpc-framing.ts
 * @see otlp-protobuf.ts
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { connect, type ClientHttp2Session } from 'node:http2';
import { OtelCollector } from './otel-collector.js';
import { frameMessage, unframeMessages } from './grpc-framing.js';

// ─── Minimal OTLP/protobuf encoder ────────────────────────────────────────
// Inlined rather than imported from `otlp-protobuf.test.ts` so this file
// stays self-contained. Same builder shape; smaller surface (just what
// the e2e test needs).

const WIRE_LEN = 2;
const WIRE_I64 = 1;

class PbWriter {
  private readonly chunks: number[] = [];
  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
  private writeVarint(v: number): void {
    let n = v >>> 0;
    while (n >= 0x80) {
      this.chunks.push((n & 0x7f) | 0x80);
      n = n >>> 7;
    }
    this.chunks.push(n & 0x7f);
  }
  writeTag(fieldNumber: number, wireType: number): void {
    this.writeVarint((fieldNumber << 3) | wireType);
  }
  writeString(fieldNumber: number, s: string): void {
    const enc = new TextEncoder().encode(s);
    this.writeTag(fieldNumber, WIRE_LEN);
    this.writeVarint(enc.length);
    for (const b of enc) this.chunks.push(b);
  }
  writeBytesHex(fieldNumber: number, hex: string): void {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    this.writeTag(fieldNumber, WIRE_LEN);
    this.writeVarint(bytes.length);
    for (const b of bytes) this.chunks.push(b);
  }
  writeFixed64(fieldNumber: number, v: bigint): void {
    this.writeTag(fieldNumber, WIRE_I64);
    let big = v;
    for (let i = 0; i < 8; i++) {
      this.chunks.push(Number(big & 0xffn));
      big = big >> 8n;
    }
  }
  writeMessage(fieldNumber: number, body: Uint8Array): void {
    this.writeTag(fieldNumber, WIRE_LEN);
    this.writeVarint(body.length);
    for (const b of body) this.chunks.push(b);
  }
}

function buildSpan(traceId: string, spanId: string, name: string): Uint8Array {
  const w = new PbWriter();
  w.writeBytesHex(1, traceId);
  w.writeBytesHex(2, spanId);
  w.writeString(5, name);
  w.writeFixed64(7, BigInt(1700000000) * 1_000_000_000n);
  w.writeFixed64(8, BigInt(1700000001) * 1_000_000_000n);
  return w.bytes();
}

function buildExportTrace(spanBytes: Uint8Array): Uint8Array {
  // ResourceSpans → ScopeSpans (field 2) → Span (field 2)
  const scopeSpans = new PbWriter();
  scopeSpans.writeMessage(2, spanBytes);
  const resourceSpans = new PbWriter();
  resourceSpans.writeMessage(2, scopeSpans.bytes());
  const root = new PbWriter();
  root.writeMessage(1, resourceSpans.bytes()); // ExportTraceServiceRequest.resource_spans
  return root.bytes();
}

// ─── Test fixture ─────────────────────────────────────────────────────────

describe('otel-collector OTLP/gRPC: end-to-end capture', () => {
  let collector: OtelCollector;

  beforeEach(async () => {
    collector = new OtelCollector();
    await collector.startGrpc(0);
  });

  afterEach(async () => {
    await collector.stopGrpc();
  });

  it('captures a span sent over gRPC framing', async () => {
    const TRACE_ID = '0102030405060708090a0b0c0d0e0f10';
    const SPAN_ID = '1112131415161718';
    const SPAN_NAME = 'openwop.run';

    const span = buildSpan(TRACE_ID, SPAN_ID, SPAN_NAME);
    const exportReq = buildExportTrace(span);
    const framed = frameMessage(exportReq);

    const session: ClientHttp2Session = connect(collector.grpcEndpoint());
    try {
      await new Promise<void>((resolve, reject) => {
        const req = session.request({
          ':method': 'POST',
          ':path': '/opentelemetry.proto.collector.trace.v1.TraceService/Export',
          'content-type': 'application/grpc+proto',
          te: 'trailers',
        });
        let respStatus = '';
        let trailerStatus = '';
        const chunks: Buffer[] = [];
        req.on('response', (headers) => {
          respStatus = String(headers[':status'] ?? '');
        });
        req.on('trailers', (trailers) => {
          trailerStatus = String(trailers['grpc-status'] ?? '');
        });
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            expect(respStatus).toBe('200');
            expect(trailerStatus).toBe('0');
            // Response body MUST be a 5-byte frame with a zero-length payload.
            const respBody = Buffer.concat(chunks);
            const unframed = unframeMessages(
              new Uint8Array(respBody.buffer, respBody.byteOffset, respBody.byteLength),
            );
            expect(unframed.length).toBe(1);
            expect(unframed[0]!.byteLength).toBe(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
        req.on('error', reject);
        req.end(Buffer.from(framed));
      });
    } finally {
      session.close();
    }

    // Collector captured the span exactly once.
    const spans = collector.spans();
    expect(spans.length).toBe(1);
    expect(spans[0]!.name).toBe(SPAN_NAME);
    expect(spans[0]!.traceId).toBe(TRACE_ID);
    expect(spans[0]!.spanId).toBe(SPAN_ID);
  });

  it('returns INVALID_ARGUMENT trailer for unsupported content-type', async () => {
    const session: ClientHttp2Session = connect(collector.grpcEndpoint());
    try {
      await new Promise<void>((resolve, reject) => {
        const req = session.request({
          ':method': 'POST',
          ':path': '/opentelemetry.proto.collector.trace.v1.TraceService/Export',
          'content-type': 'text/plain',
        });
        req.on('response', (headers) => {
          try {
            expect(headers['grpc-status']).toBe('3'); // INVALID_ARGUMENT
            resolve();
          } catch (err) {
            reject(err);
          }
        });
        req.on('error', reject);
        req.end();
      });
    } finally {
      session.close();
    }
  });
});
