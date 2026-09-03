/**
 * Live manifest-dispatch structured-output enforcement (RFC 0077 §B step 6) —
 * behavioral.
 *
 * Gated on `capabilities.agents.liveRuntime.structuredOutput` (root-first per
 * RFC 0073) — itself meaningful only alongside `liveRuntime.supported`.
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`.
 *
 * Asserts the §B step-6 MUST: when the host advertises `structuredOutput` and an
 * agent declares a `handoff.returnSchemaRef`, a terminal result that VIOLATES
 * that schema MUST fail the invocation (`agent.invocation.completed.outcome ===
 * "failed"`, `schemaValidated !== true`) rather than ship a non-conforming
 * result as `completed`. Driven by the `forceInvalidResult` seam param so the
 * assertion is deterministic; soft-skips when the seam/hook is unwired.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/multi-agent-execution.md (§"Live manifest dispatch")
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md (§B step 6)
 */

import { describe, it, expect } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readLiveRuntimeCap, invokeLive } from '../lib/liveRuntime.js';
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

describe('agent-live-structured-output (RFC 0077 §B step 6)', () => {
  it('fails the invocation on a result that violates handoff.returnSchemaRef', async () => {
    const cap = await readLiveRuntimeCap();
    // structuredOutput is a sub-flag of a supported liveRuntime; gate on both.
    const advertised = cap?.supported === true && cap?.structuredOutput === true;
    if (!behaviorGate('openwop-live-structured-output', advertised)) return;

    if (!(await isEventLogSeamAvailable())) return softSkip('blocked', 'precondition not met — `!(await isEventLogSeamAvailable())` returned early (soft-skip) (seam, prior step, or fixture unavailable)'); // soft-skip
    const res = await invokeLive({
      source: 'run-api',
      returnSchemaRef: 'conformance-strict-handoff',
      forceInvalidResult: true,
    });
    if (res === null || !res.runId) return softSkip('blocked', 'precondition not met — `res === null || !res.runId` returned early (seam/hook absent — soft-skip) (seam, prior step, or fixture unavailable)'); // seam/hook absent — soft-skip

    const q = await queryTestEvents(res.runId, { type: 'agent.invocation.completed' });
    if (!q.ok || !q.events[0]) return softSkip('blocked', 'precondition not met — `!q.ok || !q.events[0]` returned early (seam, prior step, or fixture unavailable)');
    const payload = q.events[q.events.length - 1]!.payload;

    expect(
      payload.outcome === 'failed',
      req('openwop.it.agent-live-structured-output.fails-the-invocation-on-a-result-that-violates-handoff-returnschemaref', 'RFC 0077 §B step 6', 'a result violating handoff.returnSchemaRef MUST fail the invocation (outcome "failed"), not ship as completed'),
    ).toBe(true);
    expect(
      payload.schemaValidated !== true,
      req('openwop.it.agent-live-structured-output.fails-the-invocation-on-a-result-that-violates-handoff-returnschemaref', 'RFC 0077 §B step 6', 'schemaValidated MUST NOT be true for a schema-violating result'),
    ).toBe(true);

    await resetTestSeam();
  });
});
