/**
 * Track 11: OTel span emission verification.
 *
 * Verifies that hosts claiming observability conformance emit the
 * canonical `openwop.*` spans + attributes documented in
 * `spec/v1/observability.md` §"Run-level attributes" and §"Node-level
 * attributes". Uses the in-process OTLP/HTTP-JSON collector started by
 * `setup.ts` when `OPENWOP_OTEL_COLLECTOR=true`.
 *
 * Operator contract for this scenario to exercise the host:
 *   1. Start the conformance suite with `OPENWOP_OTEL_COLLECTOR=true`.
 *   2. Configure the host with
 *      `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<port>` (port
 *      printed at suite init) and
 *      `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`.
 *
 * Skip conditions:
 *   - Collector disabled (`OPENWOP_OTEL_COLLECTOR` unset / false).
 *   - Host does not advertise `capabilities.observability` (presumed
 *     non-conformant for OTel emission).
 *   - Required fixture (`conformance-noop`) not advertised.
 *
 * @see spec/v1/observability.md §"Span attributes"
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { discoveryFamilies } from '../lib/discovery-capabilities.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { getCollector, waitForRunSpans } from '../lib/otel-collector.js';
import { req } from '../lib/requirement-ids.js';

/**
 * Callback-shaped: the host exports OTLP/HTTP spans to the suite's collector.
 *
 * Unwitnessable when the host is in a separate network namespace — see
 * `../lib/host-callback.ts`. Not host non-conformance; no route.
 */
export const REQUIRES_HOST_CALLBACK = "the host exports OTLP/HTTP spans to the suite's collector";

const FIXTURE = 'conformance-noop';

async function isObservabilityAdvertised(): Promise<boolean> {
  try {
    const disco = await driver.get('/.well-known/openwop');
    const caps = discoveryFamilies(disco.json) as { observability?: unknown };
    return caps.observability !== undefined;
  } catch {
    return false;
  }
}

describe('otel-emission: required run-level + node-level attributes', () => {
  it('host emits openwop.run + openwop.node.* spans with required attributes', async () => {
    if (!getCollector()) {
      // eslint-disable-next-line no-console
      console.warn('[otel-emission] collector not started; set OPENWOP_OTEL_COLLECTOR=true to run');
      return softSkip('blocked', '[otel-emission] collector not started; set OPENWOP_OTEL_COLLECTOR=true to run');
    }
    if (!isFixtureAdvertised(FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(`[otel-emission] fixture ${FIXTURE} not advertised; skipping`);
      return softSkip('inapplicable', '[otel-emission] fixture … not advertised; skipping');
    }
    if (!(await isObservabilityAdvertised())) {
      // eslint-disable-next-line no-console
      console.warn('[otel-emission] host does not advertise capabilities.observability; skipping');
      return softSkip('inapplicable', '[otel-emission] host does not advertise capabilities.observability; skipping');
    }

    const collector = getCollector()!;
    collector.reset();

    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId, { timeoutMs: 15_000 });

    const runSpans = await waitForRunSpans(runId, { timeoutMs: 5_000, minCount: 2 });

    expect(runSpans.length, req('openwop.it.otel-emission.host-emits-openwop-run-openwop-node-spans-with-required-attributes', 
      'observability.md §"Span attributes"',
      'host MUST emit at least one openwop.* span carrying openwop.run_id',
    )).toBeGreaterThan(0);

    // Required run-level attributes per §"Run-level attributes": MUST
    // include openwop.run_id (which we filtered on) and openwop.workflow_id.
    const anySpanHasWorkflowId = runSpans.some(
      (s) => s.attributes.get('openwop.workflow_id') === FIXTURE,
    );
    expect(anySpanHasWorkflowId, req('openwop.it.otel-emission.host-emits-openwop-run-openwop-node-spans-with-required-attributes', 
      'observability.md §"Run-level attributes"',
      'spans MUST carry openwop.workflow_id matching the run\'s workflow',
    )).toBe(true);

    // Find an openwop.run span (lifecycle span; named per §"Span naming").
    const runSpan = runSpans.find((s) => s.name === 'openwop.run' || s.name.startsWith('openwop.run.'));
    expect(runSpan, req('openwop.it.otel-emission.host-emits-openwop-run-openwop-node-spans-with-required-attributes', 
      'observability.md §"Span naming"',
      'host MUST emit a span named openwop.run (or openwop.run.<phase>) per run',
    )).toBeDefined();

    // Find an openwop.node.<typeId> span; conformance-noop has one node.
    const nodeSpan = runSpans.find((s) => s.name.startsWith('openwop.node.'));
    expect(nodeSpan, req('openwop.it.otel-emission.host-emits-openwop-run-openwop-node-spans-with-required-attributes', 
      'observability.md §"Span naming"',
      'host MUST emit a span named openwop.node.<typeId> per node execution',
    )).toBeDefined();

    if (nodeSpan) {
      // Required node-level attributes.
      expect(typeof nodeSpan.attributes.get('openwop.node_id')).toBe('string');
      expect(typeof nodeSpan.attributes.get('openwop.node_type')).toBe('string');
      const attempt = nodeSpan.attributes.get('openwop.node_attempt');
      expect(typeof attempt === 'number' && attempt >= 0, req('openwop.it.otel-emission.host-emits-openwop-run-openwop-node-spans-with-required-attributes', 
        'observability.md §"Node-level attributes"',
        'openwop.node_attempt MUST be a non-negative number',
      )).toBe(true);
    }
  });
});
