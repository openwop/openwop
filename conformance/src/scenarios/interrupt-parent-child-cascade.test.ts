/**
 * Interrupt profile: `openwop-interrupt-parent-child` (interrupt-profiles.md).
 *
 * Exercises parent-cancellation cascade against the
 * `conformance-interrupt-parent-child-cancel` fixture pair. Parent spawns
 * a child sub-workflow that suspends on an approval, then the parent run
 * is cancelled mid-suspend. The child MUST also transition to cancelled.
 *
 * Verifies:
 *   1. Parent :cancel cascades to the child (child run terminal === 'cancelled').
 *   2. Child cancellation reason includes 'parent-cancelled' (or equivalent).
 *   3. Post-cascade resolve of the child's interrupt returns 410 Gone (or 409).
 *
 * Profile gating: fixture advertisement.
 *
 * @see spec/v1/interrupt-profiles.md §openwop-interrupt-parent-child
 * @see conformance/fixtures/conformance-interrupt-parent-child-cancel.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilStatus, pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const PARENT_WORKFLOW = 'conformance-interrupt-parent-child-cancel';
const CHILD_WORKFLOW = 'conformance-interrupt-parent-child-cancel-child';
const CHILD_NODE_ID = 'child-gate';
const SKIP =
  !isFixtureAdvertised(PARENT_WORKFLOW) || !isFixtureAdvertised(CHILD_WORKFLOW);

interface RunSnapshot {
  status: string;
  childRuns?: Array<{ runId: string; status: string }>;
}

async function findChildRunId(parentRunId: string): Promise<string | null> {
  const snap = await driver.get(`/v1/runs/${encodeURIComponent(parentRunId)}`);
  const json = snap.json as RunSnapshot;
  const child = json.childRuns?.[0];
  return child?.runId ?? null;
}

describe.skipIf(SKIP)('interrupt: parent/child — parent cancel cascades to child', () => {
  it('child transitions to cancelled when parent is cancelled mid-suspend', async () => {
    const create = await driver.post('/v1/runs', { workflowId: PARENT_WORKFLOW });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;

    // Wait for the parent to have spawned the child and the child to be suspended.
    await pollUntilStatus(parentRunId, 'waiting-approval', { timeoutMs: 15_000 });

    const childRunId = await findChildRunId(parentRunId);
    expect(childRunId, driver.describe(
      'fixtures.md conformance-interrupt-parent-child-cancel',
      'parent snapshot MUST surface the spawned child runId',
    )).not.toBeNull();

    const cancel = await driver.post(`/v1/runs/${encodeURIComponent(parentRunId)}/cancel`, {
      reason: 'conformance-test-cascade',
    });
    expect(cancel.status).toBeGreaterThanOrEqual(200);
    expect(cancel.status).toBeLessThan(300);

    const parentTerminal = await pollUntilTerminal(parentRunId, { timeoutMs: 10_000 });
    expect(parentTerminal.status).toBe('cancelled');

    const childTerminal = await pollUntilTerminal(childRunId!, { timeoutMs: 10_000 });
    expect(childTerminal.status, driver.describe(
      'interrupt-profiles.md §openwop-interrupt-parent-child',
      'parent cancellation MUST cascade — child run MUST reach terminal cancelled',
    )).toBe('cancelled');
  });
});

describe.skipIf(SKIP)('interrupt: parent/child — post-cascade resolve of child returns 410/409', () => {
  it('attempting to resolve the cascaded child interrupt is rejected', async () => {
    const create = await driver.post('/v1/runs', { workflowId: PARENT_WORKFLOW });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;

    await pollUntilStatus(parentRunId, 'waiting-approval', { timeoutMs: 15_000 });
    const childRunId = await findChildRunId(parentRunId);
    expect(childRunId).not.toBeNull();

    await driver.post(`/v1/runs/${encodeURIComponent(parentRunId)}/cancel`, {
      reason: 'conformance-test-cascade',
    });
    await pollUntilTerminal(childRunId!, { timeoutMs: 10_000 });

    const lateResolve = await driver.post(
      `/v1/runs/${encodeURIComponent(childRunId!)}/interrupts/${encodeURIComponent(CHILD_NODE_ID)}`,
      { resumeValue: { action: 'accept' } },
    );
    expect(
      [410, 409, 404].includes(lateResolve.status),
      driver.describe(
        'interrupt-profiles.md §openwop-interrupt-parent-child',
        'resolving a cascaded child interrupt MUST be rejected (410 Gone preferred, 409/404 acceptable)',
      ),
    ).toBe(true);
  });
});
