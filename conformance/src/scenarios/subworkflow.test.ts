/**
 * Sub-workflow scenarios (G3 / F2) — exercises `conformance-subworkflow-parent`
 * which invokes `conformance-subworkflow-child` via `core.subWorkflow` with
 * blocking dispatch.
 *
 * Verifies:
 *   1. Parent run reaches terminal `completed`.
 *   2. Child run was created and reached terminal `completed`.
 *   3. Child run carries parent linkage (`parentRunId`, `parentNodeId`).
 *   4. Child variables propagate to parent via outputMapping.
 *   5. Both runs terminate within the parent's timeout.
 *
 * Spec references:
 *   - node-packs.md §Reserved Core openwop typeIds → `core.subWorkflow`
 *   - conformance/fixtures.md §F2 sub-workflow fixture
 *   - spec gap G3
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const PARENT_WORKFLOW_ID = 'conformance-subworkflow-parent';
const CHILD_WORKFLOW_ID = 'conformance-subworkflow-child';
const SKIP_NO_FIXTURE =
  !isFixtureAdvertised(PARENT_WORKFLOW_ID) || !isFixtureAdvertised(CHILD_WORKFLOW_ID);

interface RunSnapshot {
  readonly runId: string;
  readonly status: string;
  readonly variables?: Record<string, unknown>;
  readonly parentRunId?: string;
  readonly parentNodeId?: string;
  readonly childDepth?: number;
  readonly error?: { code?: string; message?: string };
}

interface RunEvent {
  readonly type: string;
  readonly nodeId?: string;
  readonly sequence: number;
  readonly payload?: unknown;
}

describe.skipIf(SKIP_NO_FIXTURE)('subworkflow: conformance-subworkflow-parent dispatches child + completes', () => {
  it('parent run reaches terminal completed and child variable is propagated via outputMapping', async () => {
    const create = await driver.post('/v1/runs', { workflowId: PARENT_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;

    const parentTerminal = await pollUntilTerminal(parentRunId);
    expect(parentTerminal.status, driver.describe(
      'fixtures.md conformance-subworkflow-parent §Terminal status',
      'parent fixture MUST reach terminal `completed` after child finishes',
    )).toBe('completed');

    // outputMapping in the parent fixture maps child's `childResult` →
    // parent's `childOutcome`. The variable should appear on the parent's
    // final variables.
    const parentVars = (parentTerminal as RunSnapshot).variables ?? {};
    expect(parentVars.childOutcome, driver.describe(
      'node-packs.md §core.subWorkflow outputMapping',
      'parent variables MUST include `childOutcome` mapped from child `childResult`',
    )).toBeDefined();
    expect(parentVars.childOutcome).toBe('child-completed');
  });

  it('child run is created with parent linkage fields and reaches terminal completed', async () => {
    const create = await driver.post('/v1/runs', { workflowId: PARENT_WORKFLOW_ID });
    const parentRunId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(parentRunId);

    // Find the child run id from the parent's event log. The
    // `node.completed` event for `subwf-call` carries `outputs.childRunId`
    // per `core.subWorkflow`'s outputSchema.
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
      'parent event log MUST contain node.completed for the subwf-call node',
    )).toBeDefined();

    const subwfPayload = subwfCompleted?.payload as
      | { outputs?: { childRunId?: string; childStatus?: string; skipped?: boolean } }
      | undefined;
    const childRunId = subwfPayload?.outputs?.childRunId;
    expect(typeof childRunId, driver.describe(
      'node-packs.md §core.subWorkflow outputSchema',
      'core.subWorkflow output MUST include childRunId as a string',
    )).toBe('string');

    expect(subwfPayload?.outputs?.childStatus, driver.describe(
      'node-packs.md §core.subWorkflow outputSchema',
      'core.subWorkflow output MUST include childStatus="completed" on success',
    )).toBe('completed');

    // Fetch the child run snapshot and verify parent linkage.
    const childRes = await driver.get(`/v1/runs/${encodeURIComponent(childRunId!)}`);
    expect(childRes.status, 'child run snapshot MUST be retrievable').toBe(200);
    const child = childRes.json as RunSnapshot;

    expect(child.status, driver.describe(
      'fixtures.md conformance-subworkflow-child §Terminal status',
      'child MUST reach terminal `completed`',
    )).toBe('completed');

    expect(child.parentRunId, driver.describe(
      'spec gap G3 parent linkage',
      'child run MUST carry parentRunId pointing back to dispatcher',
    )).toBe(parentRunId);

    expect(child.parentNodeId, driver.describe(
      'spec gap G3 parent linkage',
      'child run MUST carry parentNodeId pointing back to the subwf-call node',
    )).toBe('subwf-call');
  });
});
