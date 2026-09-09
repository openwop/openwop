/**
 * Multi-Agent Shift Phase 1 — confidence-escalation contract (CP-1).
 * Normative reference: RFCS/0002-agent-identity-and-reasoning-events.md
 *
 * Verifies: when an `agent.decided` event carries `confidence < threshold`,
 * the host MUST emit `node.suspended { reason: 'low-confidence' }` and
 * transition the run to `'waiting-approval'`. Resume value carries the
 * operator-ratified decision; a follow-up `agent.decided` (or
 * `runOrchestrator.decided`) follows after resume.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.supported: true`. Fixture-gated: requires
 * `conformance-agent-low-confidence` with mock confidence below the
 * default 0.7 threshold.
 *
 * @see spec/v1/interrupt.md §`low-confidence`
 * @see spec/v1/run-options.md §`escalationThreshold`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isAgentSupported } from '../lib/multi-agent-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const FIXTURE = 'conformance-agent-low-confidence';
const SKIP = !isAgentSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentConfidenceEscalation: confidence < threshold → low-confidence suspend', () => {
  it('low-confidence agent.decided suspends with reason=low-confidence and run reaches waiting-approval', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    // Wait for the run to suspend (not terminal).
    let snap: { status: string } | undefined;
    for (let i = 0; i < 40; i++) {
      const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      const body = res.json as { status: string };
      if (body.status === 'waiting-approval' || body.status === 'failed' || body.status === 'completed') {
        snap = body;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(snap?.status).toBe('waiting-approval');

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown> }> })
      .events ?? [];

    const lowConfSuspend = list.find(
      (e) => e.type === 'node.suspended' && e.payload?.reason === 'low-confidence',
    );
    expect(lowConfSuspend, req('openwop.it.agentConfidenceEscalation.low-confidence-agent-decided-suspends-with-reason-low-confidence-and-run-reaches', 'RFCS/0002-agent-identity-and-reasoning-events.md', 'CP-1: low-confidence agent.decided MUST emit node.suspended { reason: low-confidence }')).toBeDefined();

    const payload = lowConfSuspend!.payload as Record<string, unknown>;
    expect(typeof payload.agentId).toBe('string');
    expect(typeof payload.threshold).toBe('number');
    expect(typeof payload.observed).toBe('number');
    expect(payload.observed).toBeLessThan(payload.threshold as number);
  });
});
