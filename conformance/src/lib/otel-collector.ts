/**
 * In-process OTLP/HTTP receiver for OTel conformance verification (Track 11).
 *
 * Purpose: the conformance suite is otherwise black-box (HTTP + SSE). To
 * verify that hosts emit the canonical `openwop.*` OTel spans + metrics
 * documented in `spec/v1/observability.md`, we need an inbound channel
 * that captures what the host's OTLP exporter emits.
 *
 * Approach: stand up a minimal HTTP server (Node stdlib only — no
 * `@opentelemetry/*` deps) that accepts POST to `/v1/traces` and
 * `/v1/metrics` in OTLP/HTTP-JSON encoding, parses the payloads, and
 * exposes them via a query API. Scenarios assert on the captured data.
 *
 * Operator contract: when running the OTel conformance scenarios, the
 * host MUST be configured to export to `OTEL_EXPORTER_OTLP_ENDPOINT`
 * pointing at the collector started here. The suite reads
 * `OPENWOP_OTEL_COLLECTOR_PORT` (default `4318`, OTLP/HTTP convention) to
 * determine where to bind. The operator sets `OTEL_EXPORTER_OTLP_ENDPOINT`
 * on the host process to the matching `http://localhost:<port>` value.
 *
 * Wire format: OTLP/HTTP-JSON per
 *   https://opentelemetry.io/docs/specs/otlp/#otlphttp-json-encoded-payload
 * Shape (simplified):
 *   { resourceSpans: [{ resource, scopeSpans: [{ scope, spans: [...] }] }] }
 *   { resourceMetrics: [{ resource, scopeMetrics: [{ scope, metrics: [...] }] }] }
 *
 * Span attribute encoding (OTLP): each attribute is
 *   { key: string, value: { stringValue | intValue | doubleValue | boolValue | arrayValue | kvlistValue } }
 *
 * @see spec/v1/observability.md
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  decodeExportTraceServiceRequest,
  decodeExportMetricsServiceRequest,
} from './otlp-protobuf.js';

export interface OtelAttribute {
  readonly key: string;
  readonly value: string | number | boolean | null | readonly unknown[];
}

/**
 * Narrow structural type the `_ingestTraces` helper accepts. Both the
 * JSON parser (`JSON.parse(body) → unknown`, cast to this shape) and
 * the protobuf decoder (`decodeExportTraceServiceRequest → JsonExport-
 * TraceServiceRequest`) flow through this interface without needing
 * `as unknown as Record<string, unknown>` double-casts.
 */
export interface TracesIngest {
  resourceSpans?: unknown;
}

/** Same idea for the metrics ingest path. */
export interface MetricsIngest {
  resourceMetrics?: unknown;
}

export interface CapturedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: ReadonlyMap<string, string | number | boolean | null | readonly unknown[]>;
  readonly resourceAttributes: ReadonlyMap<string, string | number | boolean | null | readonly unknown[]>;
}

export interface CapturedMetric {
  readonly name: string;
  readonly description: string | undefined;
  readonly unit: string | undefined;
  readonly kind: 'sum' | 'gauge' | 'histogram' | 'unknown';
  /** First captured data point — sufficient for shape assertions. */
  readonly dataPoint: {
    readonly attributes: ReadonlyMap<string, string | number | boolean | null | readonly unknown[]>;
    readonly value: number | undefined;
  };
}

/**
 * Decode an OTLP attribute-value object into a primitive. Returns `null`
 * when the value shape is unrecognized.
 */
function decodeAttrValue(v: unknown): string | number | boolean | null | readonly unknown[] {
  if (v === null || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  if (typeof obj.stringValue === 'string') return obj.stringValue;
  if (typeof obj.intValue === 'string') return Number(obj.intValue);
  if (typeof obj.intValue === 'number') return obj.intValue;
  if (typeof obj.doubleValue === 'number') return obj.doubleValue;
  if (typeof obj.boolValue === 'boolean') return obj.boolValue;
  if (obj.arrayValue && typeof obj.arrayValue === 'object') {
    const av = (obj.arrayValue as { values?: unknown[] }).values ?? [];
    return av.map(decodeAttrValue);
  }
  return null;
}

function decodeAttributes(
  attrs: ReadonlyArray<{ key: unknown; value: unknown }> | undefined,
): Map<string, string | number | boolean | null | readonly unknown[]> {
  const out = new Map<string, string | number | boolean | null | readonly unknown[]>();
  if (!attrs) return out;
  for (const a of attrs) {
    if (typeof a.key !== 'string') continue;
    out.set(a.key, decodeAttrValue(a.value));
  }
  return out;
}

export class OtelCollector {
  private readonly _spans: CapturedSpan[] = [];
  private readonly _metrics: CapturedMetric[] = [];
  private _server: Server | null = null;
  private _boundPort: number = 0;

  /**
   * Start the collector. If `port` is `0` (or unset), an ephemeral port
   * is assigned and exposed via `boundPort()`.
   */
  async start(port: number = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this._handle(req, res));
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        this._server = server;
        this._boundPort = addr.port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this._server) return;
    const server = this._server;
    this._server = null;
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  boundPort(): number {
    return this._boundPort;
  }

  endpoint(): string {
    return `http://127.0.0.1:${this._boundPort}`;
  }

  reset(): void {
    this._spans.length = 0;
    this._metrics.length = 0;
  }

  /** All captured spans, in capture (arrival) order. */
  spans(): readonly CapturedSpan[] {
    return this._spans;
  }

  /** Spans filtered by an attribute equality. Use for run-scoping. */
  spansWithAttribute(key: string, value: unknown): readonly CapturedSpan[] {
    return this._spans.filter((s) => s.attributes.get(key) === value);
  }

  spansByName(name: string): readonly CapturedSpan[] {
    return this._spans.filter((s) => s.name === name);
  }

  metrics(): readonly CapturedMetric[] {
    return this._metrics;
  }

  metricByName(name: string): CapturedMetric | undefined {
    return this._metrics.find((m) => m.name === name);
  }

  private async _handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    // Defense-in-depth: cap inbound body size before buffering. The
    // collector runs in the conformance suite process; a runaway host
    // (or operator misconfig) emitting a multi-GB OTLP payload would
    // otherwise OOM the suite. 16 MiB is generous for normal OTLP
    // traffic (a 100-span batch with 50-attribute payloads runs ~50 KiB
    // in JSON) but bounds the worst case. Hosts hitting this limit
    // should batch smaller; the cap is suite-side, not normative.
    const MAX_BODY_BYTES = 16 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const c of req) {
      const buf = c as Buffer;
      received += buf.length;
      if (received > MAX_BODY_BYTES) {
        res
          .writeHead(413, { 'Content-Type': 'application/json' })
          .end(
            JSON.stringify({
              error: 'payload_too_large',
              message: `OTLP body exceeds ${MAX_BODY_BYTES} bytes; reduce batch size or split exports`,
            }),
          );
        req.destroy();
        return;
      }
      chunks.push(buf);
    }
    const body = Buffer.concat(chunks);
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    const isProtobuf =
      contentType.includes('application/x-protobuf') ||
      contentType.includes('application/protobuf');
    const isJson = contentType.includes('application/json') || contentType === '';

    const isTracesRoute = req.url?.includes('/v1/traces') === true;
    const isMetricsRoute = req.url?.includes('/v1/metrics') === true;

    // Both the JSON parser and the protobuf decoder produce objects
    // with the same structural shape. Typing `payload` as the union
    // narrow-property interface (instead of `Record<string, unknown>`)
    // lets both paths flow in without `as unknown as` double-casts.
    let payload: TracesIngest & MetricsIngest = {};

    if (isProtobuf) {
      // OTLP/HTTP-protobuf — added in the Track 11 follow-up. Decode the
      // binary message via the in-suite hand-rolled decoder
      // (`otlp-protobuf.ts`) and produce the same JSON-shaped object
      // the existing `_ingestTraces` / `_ingestMetrics` already consume.
      try {
        if (isTracesRoute) {
          payload = decodeExportTraceServiceRequest(
            new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
          );
        } else if (isMetricsRoute) {
          payload = decodeExportMetricsServiceRequest(
            new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
          );
        } else {
          // /v1/logs or unknown — ack and ignore so the exporter doesn't retry.
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
          return;
        }
      } catch (err) {
        res
          .writeHead(400, { 'Content-Type': 'application/json' })
          .end(
            JSON.stringify({
              error: 'invalid_protobuf',
              message: `OTLP/HTTP-protobuf decode failed: ${(err as Error).message ?? 'unknown'}`,
            }),
          );
        return;
      }
    } else if (isJson) {
      try {
        payload =
          body.length > 0
            ? (JSON.parse(body.toString('utf8')) as TracesIngest & MetricsIngest)
            : {};
      } catch {
        res
          .writeHead(400, { 'Content-Type': 'application/json' })
          .end(
            JSON.stringify({
              error: 'invalid_json',
              message: 'OTLP/HTTP-JSON body did not parse',
            }),
          );
        return;
      }
    } else {
      res
        .writeHead(415, { 'Content-Type': 'application/json' })
        .end(
          JSON.stringify({
            error: 'unsupported_media_type',
            message: `OTLP collector accepts application/json or application/x-protobuf; got "${contentType}"`,
          }),
        );
      return;
    }

    if (isTracesRoute) {
      this._ingestTraces(payload);
    } else if (isMetricsRoute) {
      this._ingestMetrics(payload);
    } else {
      // Ignore /v1/logs and unknown paths; respond OK so the exporter doesn't retry.
    }

    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  }

  private _ingestTraces(payload: TracesIngest): void {
    const rs = (payload.resourceSpans ?? []) as ReadonlyArray<Record<string, unknown>>;
    for (const r of rs) {
      const resourceAttrs = decodeAttributes(
        ((r.resource ?? {}) as { attributes?: ReadonlyArray<{ key: unknown; value: unknown }> })
          .attributes,
      );
      const ss = (r.scopeSpans ?? []) as ReadonlyArray<Record<string, unknown>>;
      for (const s of ss) {
        const spans = (s.spans ?? []) as ReadonlyArray<Record<string, unknown>>;
        for (const sp of spans) {
          this._spans.push({
            traceId: String(sp.traceId ?? ''),
            spanId: String(sp.spanId ?? ''),
            parentSpanId: sp.parentSpanId ? String(sp.parentSpanId) : undefined,
            name: String(sp.name ?? ''),
            startTimeUnixNano: String(sp.startTimeUnixNano ?? '0'),
            endTimeUnixNano: String(sp.endTimeUnixNano ?? '0'),
            attributes: decodeAttributes(
              sp.attributes as ReadonlyArray<{ key: unknown; value: unknown }> | undefined,
            ),
            resourceAttributes: resourceAttrs,
          });
        }
      }
    }
  }

  private _ingestMetrics(payload: MetricsIngest): void {
    const rm = (payload.resourceMetrics ?? []) as ReadonlyArray<Record<string, unknown>>;
    for (const r of rm) {
      const sm = (r.scopeMetrics ?? []) as ReadonlyArray<Record<string, unknown>>;
      for (const s of sm) {
        const metrics = (s.metrics ?? []) as ReadonlyArray<Record<string, unknown>>;
        for (const m of metrics) {
          let kind: CapturedMetric['kind'] = 'unknown';
          let dp:
            | {
                attributes: Map<string, string | number | boolean | null | readonly unknown[]>;
                value: number | undefined;
              }
            | undefined;

          for (const k of ['sum', 'gauge', 'histogram'] as const) {
            const slot = m[k] as { dataPoints?: ReadonlyArray<Record<string, unknown>> } | undefined;
            if (!slot?.dataPoints?.length) continue;
            kind = k;
            const first = slot.dataPoints[0];
            const attrs = decodeAttributes(
              first.attributes as
                | ReadonlyArray<{ key: unknown; value: unknown }>
                | undefined,
            );
            const value =
              typeof first.asDouble === 'number'
                ? first.asDouble
                : typeof first.asInt === 'string'
                  ? Number(first.asInt)
                  : typeof first.asInt === 'number'
                    ? first.asInt
                    : undefined;
            dp = { attributes: attrs, value };
            break;
          }

          if (!dp) continue;

          this._metrics.push({
            name: String(m.name ?? ''),
            description: typeof m.description === 'string' ? m.description : undefined,
            unit: typeof m.unit === 'string' ? m.unit : undefined,
            kind,
            dataPoint: dp,
          });
        }
      }
    }
  }
}

/**
 * Module-scope collector instance. Vitest setup file starts it; scenarios
 * call `getCollector()` to fetch the running instance.
 */
let _instance: OtelCollector | null = null;

export function setCollector(c: OtelCollector | null): void {
  _instance = c;
}

export function getCollector(): OtelCollector | null {
  return _instance;
}

/**
 * Convenience: poll the collector for spans matching a run-id, with a
 * timeout. Hosts emit OTel spans asynchronously after run terminal, so
 * scenarios MUST poll rather than read once.
 */
export async function waitForRunSpans(
  runId: string,
  options: { timeoutMs?: number; pollIntervalMs?: number; minCount?: number } = {},
): Promise<readonly CapturedSpan[]> {
  const collector = getCollector();
  if (!collector) return [];
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const minCount = options.minCount ?? 1;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matching = collector.spansWithAttribute('openwop.run_id', runId);
    if (matching.length >= minCount) return matching;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return collector.spansWithAttribute('openwop.run_id', runId);
}
