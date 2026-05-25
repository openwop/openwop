/**
 * OTel observability emission for the Postgres reference host (wired
 * into the executor + metric loop as of 2026-05-11).
 *
 * Implements the `openwop.*` OpenTelemetry namespace defined in
 * `spec/v1/observability.md`. The host emits OTLP/HTTP-JSON to
 * `OTEL_EXPORTER_OTLP_ENDPOINT` (operator-configured) when set; when
 * absent, the module is a no-op and the host doesn't advertise
 * observability capabilities.
 *
 * What's emitted:
 *   - **Spans:** `openwop.run` (run lifecycle) + `openwop.node.<typeId>`
 *     (per node execution). Both carry `openwop.run_id` +
 *     `openwop.workflow_id`; node spans additionally carry
 *     `openwop.node_id`, `openwop.node_type`, `openwop.node_attempt`.
 *   - **Metrics:** `openwop.run.backlog` (gauge — count of pending +
 *     running runs), `openwop.queue.depth` (gauge — same for this
 *     single-process host), `openwop.run.duration` (histogram of
 *     completed-run durations in seconds).
 *
 * Wire format: OTLP/HTTP-JSON per
 *   https://opentelemetry.io/docs/specs/otlp/#otlphttp-json-encoded-payload
 *
 * Reference-only properties:
 *   - Hand-rolled HTTP-JSON emitter (no @opentelemetry/* deps).
 *   - Best-effort POST; failures swallowed silently.
 *   - Span IDs and trace IDs generated from `crypto.randomBytes`.
 *   - No batching or backpressure — each event POSTs immediately.
 *   - Metric histogram is approximated as a sum + count + min/max
 *     (no bucket boundaries; enough for shape conformance).
 *
 * @see spec/v1/observability.md
 */

import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Querier } from './db.js';

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
const SERVICE_NAME = 'openwop-host-postgres';
const METRIC_INTERVAL_MS = Number(process.env.OPENWOP_OTEL_METRIC_INTERVAL_MS ?? 1000);

const enabled = OTEL_ENDPOINT.length > 0;

/** True iff the host should advertise `capabilities.observability`. */
export function observabilityEnabled(): boolean {
  return enabled;
}

type AttrValue = string | number | boolean;

function attr(key: string, value: AttrValue): {
  key: string;
  value: Record<string, unknown>;
} {
  if (typeof value === 'string') return { key, value: { stringValue: value } };
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (Number.isInteger(value)) return { key, value: { intValue: String(value) } };
  return { key, value: { doubleValue: value } };
}

function nowNanos(): string {
  return `${BigInt(Date.now()) * 1_000_000n}`;
}

function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

function post(path: '/v1/traces' | '/v1/metrics', body: unknown): void {
  if (!enabled) return;
  let url: URL;
  try {
    url = new URL(path, OTEL_ENDPOINT);
  } catch {
    return;
  }
  const payload = JSON.stringify(body);
  const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const req = reqFn({
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (res) => {
    res.resume();
  });
  req.on('error', () => undefined);
  req.setTimeout(2000, () => req.destroy());
  req.write(payload);
  req.end();
}

const resourceAttrs = [
  attr('service.name', SERVICE_NAME),
  attr('service.version', '1.0.0'),
];

/** Active spans keyed by `${runId}:${nodeId|''}` so node spans can be closed by id. */
interface ActiveSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly startNanos: string;
  readonly attributes: Array<ReturnType<typeof attr>>;
}
const activeSpans = new Map<string, ActiveSpan>();

/** Inbound W3C trace context (parsed from `traceparent` header) keyed by runId. */
interface InboundTraceContext {
  readonly traceId: string;
  readonly parentSpanId: string;
}
const inboundTraceContexts = new Map<string, InboundTraceContext>();

/**
 * Parse a W3C `traceparent` header (RFC: https://www.w3.org/TR/trace-context/).
 * Expected format: `00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>`.
 * Returns `null` on any shape violation.
 */
export function parseTraceparent(header: string | undefined): InboundTraceContext | null {
  if (!header || typeof header !== 'string') return null;
  const parts = header.trim().split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, parentId, flags] = parts;
  if (version !== '00') return null;
  if (!/^[0-9a-f]{32}$/.test(traceId ?? '')) return null;
  if (!/^[0-9a-f]{16}$/.test(parentId ?? '')) return null;
  if (!/^[0-9a-f]{2}$/.test(flags ?? '')) return null;
  // Reject zero IDs per spec §3.2.2.3.
  if (/^0+$/.test(traceId!)) return null;
  if (/^0+$/.test(parentId!)) return null;
  return { traceId: traceId!, parentSpanId: parentId! };
}

/** Record an inbound trace context so subsequent span emissions for the run can adopt it. */
export function recordInboundTraceContext(runId: string, ctx: InboundTraceContext | null): void {
  if (!enabled || !ctx) return;
  inboundTraceContexts.set(runId, ctx);
}

function emitSpan(end: ActiveSpan & { endNanos: string }): void {
  post('/v1/traces', {
    resourceSpans: [{
      resource: { attributes: resourceAttrs },
      scopeSpans: [{
        scope: { name: 'openwop' },
        spans: [{
          traceId: end.traceId,
          spanId: end.spanId,
          parentSpanId: end.parentSpanId ?? undefined,
          name: end.name,
          kind: 1, // INTERNAL
          startTimeUnixNano: end.startNanos,
          endTimeUnixNano: end.endNanos,
          attributes: end.attributes,
        }],
      }],
    }],
  });
}

export function startRunSpan(runId: string, workflowId: string): void {
  if (!enabled) return;
  // Adopt inbound W3C trace context if the create request supplied one.
  const inbound = inboundTraceContexts.get(runId);
  const span: ActiveSpan = {
    traceId: inbound?.traceId ?? newTraceId(),
    spanId: newSpanId(),
    parentSpanId: inbound?.parentSpanId,
    name: 'openwop.run',
    startNanos: nowNanos(),
    attributes: [
      attr('openwop.run_id', runId),
      attr('openwop.workflow_id', workflowId),
    ],
  };
  activeSpans.set(`${runId}:`, span);
}

export function endRunSpan(runId: string, status: string): void {
  if (!enabled) return;
  const key = `${runId}:`;
  const span = activeSpans.get(key);
  if (!span) return;
  activeSpans.delete(key);
  inboundTraceContexts.delete(runId);
  emitSpan({
    ...span,
    endNanos: nowNanos(),
    attributes: [...span.attributes, attr('openwop.run_status', status)],
  });
}

export function startNodeSpan(
  runId: string,
  nodeId: string,
  nodeType: string,
  attempt = 0,
): void {
  if (!enabled) return;
  const parent = activeSpans.get(`${runId}:`);
  const span: ActiveSpan = {
    traceId: parent?.traceId ?? newTraceId(),
    spanId: newSpanId(),
    parentSpanId: parent?.spanId,
    name: `openwop.node.${nodeType}`,
    startNanos: nowNanos(),
    attributes: [
      attr('openwop.run_id', runId),
      attr('openwop.node_id', nodeId),
      attr('openwop.node_type', nodeType),
      attr('openwop.node_attempt', attempt),
    ],
  };
  activeSpans.set(`${runId}:${nodeId}`, span);
}

/** Append attributes to an in-flight node span (RFC 0026 cost attribution
 *  writes the sanitized `openwop.cost.*` set here so an OTel collector
 *  scrape sees them). No-op when tracing is disabled or the span is gone. */
export function addNodeSpanAttributes(
  runId: string,
  nodeId: string,
  attrs: Record<string, string | number | boolean>,
): void {
  if (!enabled) return;
  const span = activeSpans.get(`${runId}:${nodeId}`);
  if (!span) return;
  for (const [k, v] of Object.entries(attrs)) span.attributes.push(attr(k, v));
}

export function endNodeSpan(runId: string, nodeId: string, outcome: string): void {
  if (!enabled) return;
  const key = `${runId}:${nodeId}`;
  const span = activeSpans.get(key);
  if (!span) return;
  activeSpans.delete(key);
  emitSpan({
    ...span,
    endNanos: nowNanos(),
    attributes: [...span.attributes, attr('openwop.node_outcome', outcome)],
  });
}

/** Histogram-ish accumulator for run durations. */
const durations: { count: number; sum: number; min: number; max: number } = {
  count: 0,
  sum: 0,
  min: Number.POSITIVE_INFINITY,
  max: 0,
};

export function recordRunDuration(seconds: number): void {
  if (!enabled || !Number.isFinite(seconds) || seconds < 0) return;
  durations.count += 1;
  durations.sum += seconds;
  if (seconds < durations.min) durations.min = seconds;
  if (seconds > durations.max) durations.max = seconds;
}

let metricTimer: NodeJS.Timeout | null = null;

export function startMetricLoop(q: Querier): void {
  if (!enabled || metricTimer) return;
  metricTimer = setInterval(() => {
    void (async (): Promise<void> => {
      const res = await q.query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM runs WHERE status IN ('pending', 'running', 'waiting-approval', 'waiting-input', 'waiting-external', 'paused')",
      );
      const backlog = Number(res.rows[0]?.n ?? 0);
      const timeNano = nowNanos();

    const histogram = durations.count === 0
      ? undefined
      : {
          dataPoints: [{
            timeUnixNano: timeNano,
            startTimeUnixNano: timeNano,
            count: String(durations.count),
            sum: durations.sum,
            min: durations.min === Number.POSITIVE_INFINITY ? 0 : durations.min,
            max: durations.max,
            attributes: [],
            // Bucket-free histogram — count + sum + min + max only.
            bucketCounts: [],
            explicitBounds: [],
          }],
          aggregationTemporality: 2, // CUMULATIVE
        };

    const metrics: Array<Record<string, unknown>> = [
      {
        name: 'openwop.run.backlog',
        description: 'Count of runs in non-terminal states.',
        unit: '{run}',
        gauge: {
          dataPoints: [{
            timeUnixNano: timeNano,
            asInt: String(backlog),
            attributes: [],
          }],
        },
      },
      {
        name: 'openwop.queue.depth',
        description: 'Active task queue depth (single-process host: same as backlog).',
        unit: '{task}',
        gauge: {
          dataPoints: [{
            timeUnixNano: timeNano,
            asInt: String(backlog),
            attributes: [],
          }],
        },
      },
    ];
    if (histogram) {
      metrics.push({
        name: 'openwop.run.duration',
        description: 'Wall-clock duration of terminal runs.',
        unit: 's',
        histogram,
      });
    }

      post('/v1/metrics', {
        resourceMetrics: [{
          resource: { attributes: resourceAttrs },
          scopeMetrics: [{
            scope: { name: 'openwop' },
            metrics,
          }],
        }],
      });
    })().catch(() => undefined);
  }, METRIC_INTERVAL_MS);
  metricTimer.unref?.();
}

export function stopMetricLoop(): void {
  if (metricTimer) {
    clearInterval(metricTimer);
    metricTimer = null;
  }
}
