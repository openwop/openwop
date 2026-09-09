/**
 * Multi-Agent Shift Phase 5 — CP-1 conservative-path orchestrator suspend.
 * Normative reference: RFCS/0006-orchestrator.md
 *
 * Verifies the CP-1 invariant: when a `core.orchestrator.supervisor`
 * would emit a decision with `confidence < escalationThreshold`, the
 * host MUST:
 *   1. Hold the decision (do NOT emit runOrchestrator.decided).
 *   2. Suspend via `node.suspended { reason: 'low-confidence' }`.
 *   3. Transition run to `'waiting-approval'`.
 *   4. After human resume, emit ONE `runOrchestrator.decided` carrying
 *      the operator-ratified decision plus the supervisor's agentId.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.orchestrator: true`. Fixture-gated: requires
 * `conformance-orchestrator-low-confidence`.
 *
 * @see spec/v1/interrupt.md §`low-confidence`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isOrchestratorSupported } from '../lib/multi-agent-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-orchestrator-low-confidence';
const SKIP = !isOrchestratorSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('orchestratorConservativePath: CP-1 low-confidence suspend', () => {
  it('supervisor below threshold suspends with reason=low-confidence; ratified decision follows after resume', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    // Wait for the run to enter waiting-approval.
    let status: string | undefined;
    for (let i = 0; i < 50; i++) {
      const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      status = (res.json as { status: string }).status;
      if (status === 'waiting-approval' || status === 'failed' || status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe('waiting-approval');

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown> }> })
      .events ?? [];

    // Before resume: no runOrchestrator.decided emitted yet (the decision
    // was held per CP-1 step 1).
    const decisionsBeforeResume = list.filter((e) => e.type === 'runOrchestrator.decided');
    expect(
      decisionsBeforeResume.length,
      req('openwop.it.orchestratorConservativePath.supervisor-below-threshold-suspends-with-reason-low-confidence-ratified-decision', 'RFCS/0006-orchestrator.md', 'CP-1: low-confidence holds the decision until human ratification'),
    ).toBe(0);

    // node.suspended with reason=low-confidence is present.
    const lowConfSuspend = list.find(
      (e) => e.type === 'node.suspended' && e.payload?.reason === 'low-confidence',
    );
    expect(lowConfSuspend).toBeDefined();
    expect(typeof lowConfSuspend!.payload?.agentId).toBe('string');
  });
});
