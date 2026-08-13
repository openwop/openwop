/**
 * Track 11 close-out: cross-run trace-context propagation across
 * `core.subWorkflow` invocation.
 *
 * `otel-trace-propagation.test.ts` verifies that a single run's spans
 * inherit an inbound `traceparent`'s traceId. This scenario closes the
 * remaining gap (`conformance/coverage.md` row 52: "Cross-host
 * propagation across `core.subWorkflow` invocation"): when a parent
 * run with a known inbound traceparent dispatches a child run via
 * `core.subWorkflow`, the CHILD run's emitted spans MUST also share
 * the parent's traceId — distributed traces stitch across the
 * sub-workflow boundary without operator-side correlation hacks.
 *
 * Operator-tier value: in production deployments, a sub-workflow may
 * execute on a different host instance (`core.subWorkflow` is a
 * dispatch boundary, not necessarily an in-process call). The
 * traceparent-propagation contract guarantees the operator's OTel
 * backend can render parent + child as one trace tree even when
 * they're on separate hosts.
 *
 * Skip conditions:
 *   - Collector disabled.
 *   - Host doesn't advertise `capabilities.observability`.
 *   - `conformance-subworkflow-parent` fixture not advertised (host
 *     doesn't implement `core.subWorkflow`).
 *   - `OPENWOP_OPTED_OUT_SCENARIOS` contains
 *     `otel-trace-propagation-subworkflow` — host claims
 *     observability + subWorkflow but explicitly does NOT propagate
 *     traceparent across the dispatch boundary.
 *
 * @see spec/v1/observability.md §"Trace context propagation"
 * @see spec/v1/node-packs.md §`core.subWorkflow`
 * @see conformance/coverage.md row 52
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isScenarioOptedOut } from '../lib/env.js';
import { getCollector, waitForRunSpans } from '../lib/otel-collector.js';

/**
 * Callback-shaped: the host exports OTLP spans to the suite's collector.
 *
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance; no route.
 */
export const REQUIRES_HOST_CALLBACK = "the host exports OTLP spans to the suite's collector";

const PARENT_FIXTURE = 'conformance-subworkflow-parent';
const SCENARIO_ID = 'otel-trace-propagation-subworkflow';

interface RunEvent {
  type: string;
  nodeId?: string;
  payload?: { outputs?: { childRunId?: string } };
}

function makeTraceparent(): { header: string; traceId: string } {
  // W3C format: 00-<32 hex traceId>-<16 hex spanId>-01.
  // Use a distinct id from the parent-only scenario so collector
  // matching is unambiguous when both scenarios run back-to-back.
  const traceId = '7c3e51b9d2a04e6f8b1c0d2e3f4a5b6c';
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

describe('otel-trace-propagation-subworkflow: traceparent threads parent → child via core.subWorkflow', () => {
  it('child run spans inherit the parent run\'s inbound traceId', async () => {
    if (isScenarioOptedOut(SCENARIO_ID)) {
      // Host operator has declared this scenario opted-out via
      // `OPENWOP_OPTED_OUT_SCENARIOS`. Used when the host advertises
      // `conformance-subworkflow-parent` (correctly — non-OTel
      // subworkflow scenarios pass) AND observability (for audit-log
      // integrity), but doesn't propagate traceparent across the
      // `core.subWorkflow` dispatch boundary. Fixture-opt-out would
      // be too coarse (kills passing non-OTel subworkflow tests);
      // capability-opt-out would lie about observability claims.
      // eslint-disable-next-line no-console
      console.warn(`[${SCENARIO_ID}] scenario opted out via OPENWOP_OPTED_OUT_SCENARIOS; skipping`);
      return;
    }
    if (!getCollector()) {
      // eslint-disable-next-line no-console
      console.warn('[otel-trace-propagation-subworkflow] collector not started; skipping');
      return;
    }
    if (!isFixtureAdvertised(PARENT_FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(`[otel-trace-propagation-subworkflow] ${PARENT_FIXTURE} not advertised; skipping`);
      return;
    }
    if (!(await isObservabilityAdvertised())) {
      // eslint-disable-next-line no-console
      console.warn('[otel-trace-propagation-subworkflow] capabilities.observability not advertised; skipping');
      return;
    }

    const collector = getCollector()!;
    collector.reset();

    const { header, traceId } = makeTraceparent();
    const create = await driver.post(
      '/v1/runs',
      { workflowId: PARENT_FIXTURE },
      { headers: { traceparent: header } },
    );
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(parentRunId, { timeoutMs: 30_000 });

    // Walk the parent's event log to discover the child run id.
    const eventsRes = await driver.get(
      `/v1/runs/${encodeURIComponent(parentRunId)}/events/poll?lastSequence=0&timeout=1`,
    );
    expect(eventsRes.status).toBe(200);
    const events = (eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? [];

    const subwfCompleted = events.find(
      (e) => e.type === 'node.completed' && e.nodeId === 'subwf-call',
    );
    expect(subwfCompleted, driver.describe(
      'node-packs.md §core.subWorkflow',
      'parent event log MUST include node.completed for the subwf-call node',
    )).toBeDefined();

    const childRunId = subwfCompleted?.payload?.outputs?.childRunId;
    expect(typeof childRunId, driver.describe(
      'node-packs.md §core.subWorkflow outputSchema',
      'subwf-call node.completed payload MUST carry outputs.childRunId',
    )).toBe('string');

    // Both parent + child spans MUST share the inbound traceId.
    const parentSpans = await waitForRunSpans(parentRunId, { timeoutMs: 10_000, minCount: 1 });
    const childSpans = await waitForRunSpans(childRunId!, { timeoutMs: 10_000, minCount: 1 });

    expect(parentSpans.length, 'collector MUST receive ≥1 span for the parent run').toBeGreaterThan(0);
    expect(childSpans.length, 'collector MUST receive ≥1 span for the child run').toBeGreaterThan(0);

    const wantTrace = traceId.toLowerCase();

    const parentMatching = parentSpans.filter((s) => s.traceId.toLowerCase() === wantTrace);
    expect(parentMatching.length, driver.describe(
      'observability.md §"Trace context propagation"',
      'parent-run spans MUST share the inbound traceparent traceId',
    )).toBeGreaterThan(0);

    const childMatching = childSpans.filter((s) => s.traceId.toLowerCase() === wantTrace);
    expect(childMatching.length, driver.describe(
      'observability.md §"Trace context propagation" + node-packs.md §core.subWorkflow',
      'child-run spans dispatched via core.subWorkflow MUST inherit the parent run\'s traceId so distributed traces stitch across the dispatch boundary',
    )).toBeGreaterThan(0);
  });
});
