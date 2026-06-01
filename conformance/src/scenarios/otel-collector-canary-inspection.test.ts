/**
 * otel-collector-canary-inspection — always-on proof that the conformance
 * OTel collector inspects real OTLP span attributes for secret leakage.
 *
 * Context: `secret-leakage-otel-attribute.test.ts` proves a host doesn't
 * leak a BYOK canary on its `GET /v1/host/sample/test/otel/spans` scrape
 * seam. But the scrape seam reports what the host *says* it emitted; a
 * host could redact there yet still ship the plaintext over the wire via
 * its real OTLP exporter. `docs/KNOWN-LIMITS.md` tracked exactly this gap:
 *
 *   "The conformance OTel collector seam doesn't yet inspect span
 *    attributes; a host could pass conformance while leaking BYOK
 *    material on telemetry exports."
 *
 * `OtelCollector.findCanaryLeakage()` (added with this scenario) closes
 * the harness half: it scans every captured span's name, attributes, and
 * resource attributes — plus metric data-point attributes — for the
 * canary, returning the offending surface. This file is the always-on,
 * server-free proof that the inspector is NON-VACUOUS: it stands up a
 * real collector, POSTs synthetic OTLP/HTTP-JSON payloads through the
 * collector's actual ingest path, and asserts the inspector (a) catches a
 * canary embedded in a span attribute / resource attribute / span name /
 * metric attribute, and (b) reports zero hits on a redacted payload.
 *
 * Pairing this with the live, capability-gated collector scrape in
 * `secret-leakage-otel-attribute.test.ts` means the invariant is proven
 * end-to-end the moment a host exports OTLP to the collector — the
 * inspector itself is no longer the missing piece.
 *
 * Runs unconditionally (no host, no network): it exercises the collector
 * library directly, so it executes in CI on every run.
 *
 * @see conformance/src/lib/otel-collector.ts findCanaryLeakage
 * @see SECURITY/invariants.yaml secret-leakage-otel-attribute
 * @see docs/KNOWN-LIMITS.md "Behavior tests too coarse to fully prove an invariant"
 */

import { describe, it, expect, afterEach } from 'vitest';
import { OtelCollector } from '../lib/otel-collector.js';

const CANARY = 'sk-canary-DO-NOT-LEAK-0f3a9c';
const REDACTED = '[REDACTED:openwop-conformance-canary-secret]';

/** Build an OTLP/HTTP-JSON traces export carrying the given span+resource attrs. */
function tracesPayload(opts: {
  spanName: string;
  spanAttrs: Record<string, string>;
  resourceAttrs: Record<string, string>;
}): unknown {
  const toAttrs = (m: Record<string, string>) =>
    Object.entries(m).map(([key, value]) => ({ key, value: { stringValue: value } }));
  return {
    resourceSpans: [
      {
        resource: { attributes: toAttrs(opts.resourceAttrs) },
        scopeSpans: [
          {
            scope: { name: 'openwop' },
            spans: [
              {
                traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                spanId: 'bbbbbbbbbbbbbbbb',
                name: opts.spanName,
                startTimeUnixNano: '1',
                endTimeUnixNano: '2',
                attributes: toAttrs(opts.spanAttrs),
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Build an OTLP/HTTP-JSON metrics export with one sum data point carrying attrs. */
function metricsPayload(metricName: string, attrs: Record<string, string>): unknown {
  return {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            scope: { name: 'openwop' },
            metrics: [
              {
                name: metricName,
                sum: {
                  dataPoints: [
                    {
                      asInt: '1',
                      attributes: Object.entries(attrs).map(([key, value]) => ({
                        key,
                        value: { stringValue: value },
                      })),
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
}

describe('otel-collector-canary-inspection: collector inspects real OTLP exports', () => {
  let collector: OtelCollector | null = null;

  afterEach(async () => {
    if (collector) {
      await collector.stop();
      collector = null;
    }
  });

  async function postTraces(payload: unknown): Promise<void> {
    const res = await fetch(`${collector!.endpoint()}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBeLessThan(300);
  }

  async function postMetrics(payload: unknown): Promise<void> {
    const res = await fetch(`${collector!.endpoint()}/v1/metrics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBeLessThan(300);
  }

  it('catches a canary embedded in a span attribute value', async () => {
    collector = new OtelCollector();
    await collector.start();
    await postTraces(
      tracesPayload({
        spanName: 'openwop.node.execute',
        spanAttrs: { 'openwop.node.id': 'n1', 'http.request.header.authorization': `Bearer ${CANARY}` },
        resourceAttrs: { 'service.name': 'host' },
      }),
    );

    const leaks = collector.findCanaryLeakage(CANARY);
    expect(leaks.length).toBeGreaterThan(0);
    const attrLeak = leaks.find((l) => l.surface === 'span.attribute');
    expect(attrLeak).toBeDefined();
    expect(attrLeak!.key).toBe('http.request.header.authorization');
    expect(attrLeak!.value).toContain(CANARY);
  });

  it('catches a canary in a resource attribute and in a span name', async () => {
    collector = new OtelCollector();
    await collector.start();
    await postTraces(
      tracesPayload({
        spanName: `openwop.run ${CANARY}`,
        spanAttrs: { 'openwop.run.id': 'r1' },
        resourceAttrs: { 'service.name': 'host', 'deployment.token': CANARY },
      }),
    );

    const leaks = collector.findCanaryLeakage(CANARY);
    const surfaces = new Set(leaks.map((l) => l.surface));
    expect(surfaces.has('span.name')).toBe(true);
    expect(surfaces.has('span.resourceAttribute')).toBe(true);
  });

  it('catches a canary in a metric data-point attribute', async () => {
    collector = new OtelCollector();
    await collector.start();
    await postMetrics(metricsPayload('openwop.node.duration', { 'secret.echo': CANARY }));

    const leaks = collector.findCanaryLeakage(CANARY);
    const metricLeak = leaks.find((l) => l.surface === 'metric.attribute');
    expect(metricLeak).toBeDefined();
    expect(metricLeak!.emitterName).toBe('openwop.node.duration');
  });

  it('reports ZERO hits when the host redacts the canary before export (positive control)', async () => {
    collector = new OtelCollector();
    await collector.start();
    await postTraces(
      tracesPayload({
        spanName: 'openwop.node.execute',
        spanAttrs: { 'openwop.node.id': 'n1', 'http.request.header.authorization': `Bearer ${REDACTED}` },
        resourceAttrs: { 'service.name': 'host', 'deployment.token': REDACTED },
      }),
    );
    await postMetrics(metricsPayload('openwop.node.duration', { 'secret.echo': REDACTED }));

    expect(collector.findCanaryLeakage(CANARY)).toEqual([]);
  });

  it('an empty or whitespace canary never produces a (vacuous) hit', async () => {
    collector = new OtelCollector();
    await collector.start();
    await postTraces(
      tracesPayload({
        spanName: 'openwop.node.execute',
        spanAttrs: { 'a': 'b' },
        resourceAttrs: { 'service.name': 'host' },
      }),
    );

    expect(collector.findCanaryLeakage('')).toEqual([]);
    expect(collector.findCanaryLeakage('   ')).toEqual([]);
  });
});
