/**
 * Interrupt profile: `openwop-interrupt-quorum` (interrupt-profiles.md).
 *
 * Exercises multi-approver quorum semantics against the
 * `conformance-interrupt-quorum` fixture: requiredApprovals = 3,
 * rejectionPolicy = 'majority'.
 *
 * Verifies:
 *   1. Partial votes emit a per-vote event without resuming the run.
 *   2. The N-th accept (N === requiredApprovals) fires the suspend resume.
 *   3. A majority-reject path fails the gate with the rejection envelope.
 *
 * Capability-gated: skips unless the host advertises the quorum
 * interrupt profile AND the fixture is seeded.
 *
 * @see spec/v1/interrupt-profiles.md §openwop-interrupt-quorum
 * @see conformance/fixtures/conformance-interrupt-quorum.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilStatus, pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

// Profile gating: a host claims `openwop-interrupt-quorum` support by
// advertising the fixture. Hosts that don't support quorum semantics
// MUST NOT seed `conformance-interrupt-quorum`; this scenario then skips.
const WORKFLOW_ID = 'conformance-interrupt-quorum';
const NODE_ID = 'gate';
const SKIP = !isFixtureAdvertised(WORKFLOW_ID);

describe.skipIf(SKIP)('interrupt: quorum — three accepts resume to completed', () => {
  it('first two accepts persist without resuming; third accept drives terminal completed', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    for (let i = 1; i <= 2; i++) {
      const partial = await driver.post(
        `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
        { resumeValue: { action: 'accept', voter: `approver-${i}` } },
      );
      expect(partial.status, req('openwop.it.interrupt-quorum-resolution.first-two-accepts-persist-without-resuming-third-accept-drives-terminal-complete', 
        'interrupt-profiles.md §openwop-interrupt-quorum',
        `partial vote ${i}/3 MUST be accepted (2xx) without terminating the run`,
      )).toBeGreaterThanOrEqual(200);
      expect(partial.status).toBeLessThan(300);

      const stillWaiting = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      const status = (stillWaiting.json as { status: string }).status;
      expect(status, req('openwop.it.interrupt-quorum-resolution.first-two-accepts-persist-without-resuming-third-accept-drives-terminal-complete', 
        'interrupt-profiles.md §openwop-interrupt-quorum',
        `run MUST still be in waiting-approval after ${i}/3 votes (quorum not met)`,
      )).toBe('waiting-approval');
    }

    const final = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { action: 'accept', voter: 'approver-3' } },
    );
    expect(final.status).toBeGreaterThanOrEqual(200);
    expect(final.status).toBeLessThan(300);

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    expect(terminal.status, req('openwop.it.interrupt-quorum-resolution.first-two-accepts-persist-without-resuming-third-accept-drives-terminal-complete', 
      'fixtures.md conformance-interrupt-quorum §Terminal status',
      'three accepts (quorum met) MUST drive terminal completed',
    )).toBe('completed');
  });
});

describe.skipIf(SKIP)('interrupt: quorum — majority reject fails the gate', () => {
  it('two rejects out of three votes trigger the majority-reject termination', async () => {
    const create = await driver.post('/v1/runs', { workflowId: WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { action: 'reject', voter: 'approver-1' } },
    );
    await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(NODE_ID)}`,
      { resumeValue: { action: 'reject', voter: 'approver-2' } },
    );

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    expect(['failed', 'rejected'], req('openwop.it.interrupt-quorum-resolution.two-rejects-out-of-three-votes-trigger-the-majority-reject-termination', 
      'interrupt-profiles.md §openwop-interrupt-quorum (rejectionPolicy: majority)',
      'majority rejection MUST drive a non-completed terminal state',
    )).toContain(terminal.status);
  });
});
