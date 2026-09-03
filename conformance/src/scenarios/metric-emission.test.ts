/**
 * Track 11: metric-emission verification.
 *
 * Verifies that hosts claiming `capabilities.observability.metrics`
 * emit the canonical `openwop.run.backlog`, `openwop.queue.depth`, and
 * (after at least one completed run) `openwop.run.duration` metrics
 * documented in `spec/v1/observability.md`.
 *
 * Operator contract (same as `otel-emission.test.ts`):
 *   1. Start the conformance suite with `OPENWOP_OTEL_COLLECTOR=true`
 *      and `OPENWOP_OTEL_COLLECTOR_PORT=<port>`.
 *   2. Boot the host with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<port>`.
 *
 * Skip conditions:
 *   - Collector disabled (`OPENWOP_OTEL_COLLECTOR` unset / false).
 *   - Host doesn't advertise `capabilities.observability.metrics.supported`.
 *
 * @see spec/v1/observability.md §"Metrics"
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { getCollector } from '../lib/otel-collector.js';
import { req } from '../lib/requirement-ids.js';

/**
 * Callback-shaped: the host exports OTLP metrics to the suite's collector.
 *
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance; no route.
 */
export const REQUIRES_HOST_CALLBACK = "the host exports OTLP metrics to the suite's collector";

const FIXTURE = 'conformance-noop';

interface MetricsCaps {
  supported?: boolean;
  names?: ReadonlyArray<string>;
}

async function metricsAdvertised(): Promise<MetricsCaps | null> {
  try {
    const disco = await driver.get('/.well-known/openwop');
    const caps = discoveryFamilies(disco.json) as { observability?: { metrics?: MetricsCaps } };
    return caps.observability?.metrics ?? null;
  } catch {
    return null;
  }
}

async function waitForMetric(name: string, timeoutMs = 5_000): Promise<boolean> {
  const collector = getCollector();
  if (!collector) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (collector.metricByName(name)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe('metric-emission: canonical openwop.* metrics arrive at the collector', () => {
  it('host emits openwop.run.backlog, openwop.queue.depth, and openwop.run.duration', async () => {
    if (!getCollector()) {
      // eslint-disable-next-line no-console
      console.warn(
        '[metric-emission] collector not started; set OPENWOP_OTEL_COLLECTOR=true to run',
      );
      return softSkip('blocked', 'precondition not met — `!getCollector()` returned early (seam, prior step, or fixture unavailable)');
    }
    const metricsCaps = await metricsAdvertised();
    if (!metricsCaps?.supported) {
      // eslint-disable-next-line no-console
      console.warn(
        '[metric-emission] host does not advertise observability.metrics.supported; skipping',
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!metricsCaps?.supported` returned early');
    }
    if (!isFixtureAdvertised(FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(`[metric-emission] ${FIXTURE} not advertised; skipping`);
      return softSkip('inapplicable', '[metric-emission] … not advertised; skipping');
    }

    const collector = getCollector()!;
    collector.reset();

    // Drive at least one completed run so openwop.run.duration has a sample.
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId, { timeoutMs: 10_000 });

    // Wait for the host's metric-emit tick to land at the collector.
    const sawBacklog = await waitForMetric('openwop.run.backlog', 5_000);
    expect(sawBacklog, req('openwop.it.metric-emission.host-emits-openwop-run-backlog-openwop-queue-depth-and-openwop-run-duration', 
      'observability.md §"Metrics"',
      'host claiming metrics MUST emit openwop.run.backlog',
    )).toBe(true);

    const sawQueueDepth = await waitForMetric('openwop.queue.depth', 5_000);
    expect(sawQueueDepth, req('openwop.it.metric-emission.host-emits-openwop-run-backlog-openwop-queue-depth-and-openwop-run-duration', 
      'observability.md §"Metrics"',
      'host claiming metrics MUST emit openwop.queue.depth',
    )).toBe(true);

    const sawDuration = await waitForMetric('openwop.run.duration', 5_000);
    expect(sawDuration, req('openwop.it.metric-emission.host-emits-openwop-run-backlog-openwop-queue-depth-and-openwop-run-duration', 
      'observability.md §"Metrics"',
      'host claiming metrics MUST emit openwop.run.duration after a completed run',
    )).toBe(true);

    // Shape spot-check: backlog gauge data point has a numeric value.
    const backlog = collector.metricByName('openwop.run.backlog')!;
    expect(backlog.kind).toBe('gauge');
    expect(typeof backlog.dataPoint.value).toBe('number');
  });
});
