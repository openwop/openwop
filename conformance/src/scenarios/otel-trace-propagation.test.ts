/**
 * Track 11: W3C Trace Context propagation verification.
 *
 * Verifies that hosts claiming observability conformance honor inbound
 * `traceparent` headers — spans emitted during the run MUST share the
 * caller-provided traceId so distributed traces stitch correctly across
 * client→host→provider boundaries.
 *
 * Reuses the in-process OTel collector from `setup.ts`.
 *
 * Skip conditions:
 *   - Collector disabled.
 *   - Host doesn't advertise `capabilities.observability`.
 *   - Fixture `conformance-noop` not advertised.
 *
 * @see spec/v1/observability.md §"Trace context propagation"
 * @see https://www.w3.org/TR/trace-context/
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { getCollector, waitForRunSpans } from '../lib/otel-collector.js';

/**
 * Callback-shaped: the host exports OTLP spans to the suite's collector.
 *
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance; no route.
 */
export const REQUIRES_HOST_CALLBACK = "the host exports OTLP spans to the suite's collector";

const FIXTURE = 'conformance-noop';

/** Build a syntactically-valid traceparent with a known traceId. */
function makeTraceparent(): { header: string; traceId: string } {
  // W3C format: 00-<32 hex traceId>-<16 hex spanId>-01
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const spanId = '00f067aa0ba902b7';
  return { header: `00-${traceId}-${spanId}-01`, traceId };
}

async function isObservabilityAdvertised(): Promise<boolean> {
  try {
    const disco = await driver.get('/.well-known/openwop');
    const caps = (disco.json as { capabilities?: { observability?: unknown } }).capabilities ?? {};
    return caps.observability !== undefined;
  } catch {
    return false;
  }
}

describe('otel-trace-propagation: inbound traceparent threads to emitted spans', () => {
  it('host-emitted spans share the caller-supplied traceId', async () => {
    if (!getCollector()) {
      // eslint-disable-next-line no-console
      console.warn('[otel-trace-propagation] collector not started; skipping');
      return;
    }
    if (!isFixtureAdvertised(FIXTURE)) {
      return;
    }
    if (!(await isObservabilityAdvertised())) {
      // eslint-disable-next-line no-console
      console.warn('[otel-trace-propagation] capabilities.observability not advertised; skipping');
      return;
    }

    const collector = getCollector()!;
    collector.reset();

    const { header, traceId } = makeTraceparent();
    const create = await driver.post(
      '/v1/runs',
      { workflowId: FIXTURE },
      { headers: { traceparent: header } },
    );
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId, { timeoutMs: 15_000 });

    const runSpans = await waitForRunSpans(runId, { timeoutMs: 5_000, minCount: 1 });

    expect(runSpans.length).toBeGreaterThan(0);

    // OTLP encodes traceId as a 32-char lowercase hex string in JSON. Compare case-insensitively
    // since some exporters emit uppercase.
    const wantTrace = traceId.toLowerCase();
    const matching = runSpans.filter((s) => s.traceId.toLowerCase() === wantTrace);

    expect(matching.length, driver.describe(
      'observability.md §"Trace context propagation"',
      'spans emitted during a run started with an inbound traceparent MUST share its traceId',
    )).toBeGreaterThan(0);
  });
});
