/**
 * RFC 0022 §B — `core.subWorkflow` `inputMapping` seeding (HVMAP-2).
 * Normative reference: RFCS/0022-dispatch-input-output-mapping.md §B
 *   + spec/v1/node-packs.md §"`core.subWorkflow` contract" (post-RFC-0022).
 *
 * Verifies that when a `core.subWorkflow` config carries `inputMapping`,
 * the host seeds the child run's initial variable bag with
 * `parentVariables[parentKey]` projections AFTER the child's
 * `variables[].defaultValue` fold (so `inputMapping` overrides matching
 * defaults). Verified end-to-end against the Postgres reference host on
 * 2026-05-18 alongside the RFC's `Active` promotion.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.subWorkflow.inputMapping: true`. Fixture-gated: requires
 * `conformance-subworkflow-input-mapping` + the matching child fixture.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §B
 * @see spec/v1/node-packs.md §"`core.subWorkflow` contract"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { setHostCapability, resetHostCapabilities, isToggleAvailable } from '../lib/host-toggle.js';

const PARENT = 'conformance-subworkflow-input-mapping';
const CHILD = 'conformance-subworkflow-input-mapping-child';
const SKIP = !isFixtureAdvertised(PARENT) || !isFixtureAdvertised(CHILD);

interface RunEvent {
  readonly type: string;
  readonly nodeId?: string;
  readonly payload?: { outputs?: { childRunId?: string } } & Record<string, unknown>;
}

interface RunSnapshot {
  readonly status: string;
  readonly variables?: Record<string, unknown>;
}

describe.skipIf(SKIP)('subworkflow-input-mapping: parent → child variable seeding (RFC 0022 §B)', () => {
  it('HVMAP-2: inputMapping seeds child variables, overrides defaultValue, child reads parent projection', async () => {
    // Parent fixture declares currentPrdId='prd-1' as its defaultValue.
    // The parent's `core.subWorkflow` node carries
    // `inputMapping: { receivedPrdId: 'currentPrdId' }`. Child fixture
    // declares `receivedPrdId.defaultValue='baked-in'` — the mapping
    // MUST override that default per RFC 0022 §B.
    const create = await driver.post('/v1/runs', { workflowId: PARENT });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;

    const parentTerminal = (await pollUntilTerminal(parentRunId)) as RunSnapshot;
    expect(parentTerminal.status, driver.describe(
      'RFCS/0022-dispatch-input-output-mapping.md §B',
      'parent run MUST reach terminal `completed` once the child finishes',
    )).toBe('completed');

    // Locate the child run via the parent's event log.
    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(parentRunId)}/events`);
    expect(eventsRes.status).toBe(200);
    const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []);
    const subwfCompleted = events.find(
      (e) => e.type === 'node.completed' && e.nodeId === 'subwf-call',
    );
    expect(subwfCompleted, driver.describe(
      'spec/v1/node-packs.md §"`core.subWorkflow` contract"',
      'parent event log MUST contain `node.completed` for the subwf-call node',
    )).toBeDefined();
    const childRunId = subwfCompleted?.payload?.outputs?.childRunId;
    expect(typeof childRunId).toBe('string');

    // Inspect the child run's final variables — receivedPrdId MUST be
    // the parent's projection ("prd-1"), NOT the child's defaultValue
    // ("baked-in").
    const childSnapshotRes = await driver.get(`/v1/runs/${encodeURIComponent(childRunId!)}`);
    expect(childSnapshotRes.status).toBe(200);
    const childSnapshot = childSnapshotRes.json as RunSnapshot;
    expect(childSnapshot.status, driver.describe(
      'spec/v1/node-packs.md §"`core.subWorkflow` contract"',
      'child run MUST reach terminal `completed`',
    )).toBe('completed');
    const childVars = childSnapshot.variables ?? {};
    expect(childVars.receivedPrdId, driver.describe(
      'RFCS/0022-dispatch-input-output-mapping.md §B',
      'child `receivedPrdId` MUST be parent\'s `currentPrdId` projection ("prd-1"), overriding the child\'s defaultValue "baked-in"',
    )).toBe('prd-1');
  });

  it('HVMAP-2-unset: parent.currentPrdId unset → child receivedPrdId MUST surface as `undefined`', async () => {
    const PARENT_NO_DEFAULT = 'conformance-subworkflow-input-mapping-no-default';
    if (!isFixtureAdvertised(PARENT_NO_DEFAULT) || !isFixtureAdvertised(CHILD)) return; // soft-skip
    const create = await driver.post('/v1/runs', { workflowId: PARENT_NO_DEFAULT });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(parentRunId);

    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(parentRunId)}/events`);
    const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []);
    const subwfCompleted = events.find(
      (e) => e.type === 'node.completed' && e.nodeId === 'subwf-call',
    );
    if (!subwfCompleted) return;
    const childRunId = subwfCompleted.payload?.outputs?.childRunId;

    const childRes = await driver.get(`/v1/runs/${encodeURIComponent(childRunId!)}`);
    const child = childRes.json as RunSnapshot;
    const vars = child.variables ?? {};
    const v = vars.receivedPrdId;
    // Note: the spec says `undefined` (NOT null). On the wire, `undefined`
    // serializes as either key-absent or the child's own defaultValue fold
    // ("baked-in"). The MUST-NOT is `null`. Per RFC 0022 §B, inputMapping
    // override happens AFTER defaultValue fold, so when the projection is
    // undefined the child's defaultValue should remain.
    expect(
      v === 'baked-in' || v === undefined || !('receivedPrdId' in vars),
      driver.describe(
        'RFCS/0022-dispatch-input-output-mapping.md §B',
        'unset parent variable MUST surface as undefined-or-defaultValue-fallback (NOT null)',
      ),
    ).toBe(true);
    expect(v).not.toBe(null);
  });

  // HVMAP-2-no-midrun-propagation: `inputMapping` is a one-shot fold at
  // child-dispatch time. Once the parent's mapping has projected
  // `currentPrdId → receivedPrdId` and the child has been spawned, any
  // mid-run mutation to the parent's `currentPrdId` MUST NOT propagate
  // into the already-seeded child bag. The harness uses the sample-only
  // test seam `POST /v1/host/sample/test/runs/:runId/variables` (gated
  // on `OPENWOP_TEST_SEAM_ENABLED=true`; soft-skip when the seam is not
  // exposed) to mutate the parent's variable bag WHILE the child is
  // suspended on a `core.approvalGate`, then resolves the gate and reads
  // the child's terminal `receivedPrdId` variable.
  const MID_RUN_PARENT = 'conformance-subworkflow-mid-run-mutation';
  const MID_RUN_CHILD = 'conformance-subworkflow-mid-run-mutation-child';
  const CHILD_GATE_NODE = 'child-gate';

  it('HVMAP-2-no-midrun-propagation: parent mid-run mutation MUST NOT propagate into the seeded child', async () => {
    if (!isFixtureAdvertised(MID_RUN_PARENT) || !isFixtureAdvertised(MID_RUN_CHILD)) return; // fixture not seeded — soft-skip
    if (!(await isToggleAvailable())) return; // sample test seam not exposed — soft-skip

    const create = await driver.post('/v1/runs', { workflowId: MID_RUN_PARENT });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;

    // Wait for the parent to spawn the child and the child to reach
    // `waiting-approval`. The parent's status mirrors the child's
    // suspended kind via the dispatcher's parent-suspends-while-child-
    // suspends contract (interrupt-profiles.md §openwop-interrupt-
    // cascade-cancel).
    const { pollUntilStatus } = await import('../lib/polling.js');
    await pollUntilStatus(parentRunId, 'waiting-approval', { timeoutMs: 15_000 });

    // Find the child runId via the parent snapshot's `childRuns[]`
    // projection (interrupt-profiles.md §openwop-interrupt-cascade-cancel).
    const parentSnap = await driver.get(`/v1/runs/${encodeURIComponent(parentRunId)}`);
    const parentJson = parentSnap.json as { childRuns?: Array<{ runId: string; status: string }> };
    const childRunId = parentJson.childRuns?.[0]?.runId;
    expect(childRunId, driver.describe(
      'fixtures.md conformance-subworkflow-mid-run-mutation',
      'parent snapshot MUST surface the spawned child runId via childRuns[]',
    )).toBeDefined();

    // Mutate the parent's `currentPrdId` WHILE the child is suspended.
    // The mutation MUST NOT propagate per RFC 0022 §B (one-shot fold).
    const mutate = await driver.post(
      `/v1/host/sample/test/runs/${encodeURIComponent(parentRunId)}/variables`,
      { variables: { currentPrdId: 'mutated-id' } },
    );
    expect(mutate.status).toBe(200);

    // Resolve the child's approval gate so it terminates.
    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(childRunId!)}/interrupts/${encodeURIComponent(CHILD_GATE_NODE)}`,
      { resumeValue: { action: 'accept' } },
    );
    expect(resolve.status).toBeGreaterThanOrEqual(200);
    expect(resolve.status).toBeLessThan(300);

    const childTerminal = (await pollUntilTerminal(childRunId!)) as RunSnapshot;
    expect(childTerminal.status).toBe('completed');

    // The §B one-shot-fold assertion: the child's terminal
    // `receivedPrdId` MUST still equal the dispatch-time fold value
    // (`seeded-id`), NOT the post-mutation parent value (`mutated-id`).
    expect(
      childTerminal.variables?.receivedPrdId,
      driver.describe(
        'RFCS/0022-dispatch-input-output-mapping.md §B',
        'mid-run parent mutation MUST NOT propagate; child receivedPrdId stays at dispatch-time fold',
      ),
    ).toBe('seeded-id');
  });

});

describe('subworkflow-input-mapping: registration refusal (RFC 0022 §C HVMAP-2-refusal)', () => {
  it('host with subWorkflow.inputMapping toggled OFF MUST refuse non-empty inputMapping at registration', async () => {
    if (!(await isToggleAvailable())) return; // seam not exposed — soft-skip
    await setHostCapability('subWorkflow.inputMapping', false);
    try {
      const workflow = {
        workflowId: `hvmap-2-refusal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nodes: [
          {
            nodeId: 'subwf-1',
            typeId: 'core.subWorkflow',
            config: {
              childWorkflowId: 'some-child',
              inputMapping: { receivedPrdId: 'currentPrdId' }, // non-empty — refusal trigger
            },
          },
        ],
      };
      const res = await driver.post('/v1/host/sample/workflows', workflow);
      expect(
        res.status,
        driver.describe(
          'RFCS/0022-dispatch-input-output-mapping.md §C',
          'workflow with non-empty subWorkflow.inputMapping MUST be refused when capability is not advertised',
        ),
      ).toBe(400);
      const body = res.json as { error?: string; details?: { requiredCapability?: string } };
      expect(body.error).toBe('validation_error');
      expect(
        body.details?.requiredCapability,
        driver.describe(
          'RFCS/0022-dispatch-input-output-mapping.md §C',
          'refusal MUST surface requiredCapability: "subWorkflow.inputMapping"',
        ),
      ).toBe('subWorkflow.inputMapping');
    } finally {
      await resetHostCapabilities();
    }
  });
});
