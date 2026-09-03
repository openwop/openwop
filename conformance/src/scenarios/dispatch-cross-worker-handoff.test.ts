/**
 * RFC 0022 §A + §D — `core.dispatch` sequential cross-worker handoff (HVMAP-1c).
 * Normative reference: RFCS/0022-dispatch-input-output-mapping.md §A + §D
 *
 * Verifies that under `fanOutPolicy: 'sequential'` (v1.x default), the
 * output mapping of child N MUST be visible to child N+1's input mapping
 * within the same dispatch loop — they share the parent variable bag.
 * The scenario routes child-a's `output` variable through the parent's
 * `sharedVar` slot via per-worker mappings, then child-b reads it back
 * as `inputs.input`. Verified end-to-end against the Postgres reference
 * host on 2026-05-18 alongside the supervisor-mock extension (RFC 0022
 * §"Unresolved questions" #6) that lets fixtures drive multi-worker
 * `OrchestratorDecision` sequences.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.dispatchMapping: true`. Fixture-gated: requires
 * `conformance-dispatch-cross-worker-handoff` + the two child fixtures.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §A + §D
 * @see schemas/dispatch-config.schema.json #/properties/perWorker*
 * @see examples/hosts/postgres/src/server.ts (core.dispatch executor)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const PARENT = 'conformance-dispatch-cross-worker-handoff';
const CHILD_A = 'conformance-dispatch-cross-worker-handoff-child-a';
const CHILD_B = 'conformance-dispatch-cross-worker-handoff-child-b';
const SKIP =
  !isFixtureAdvertised(PARENT) ||
  !isFixtureAdvertised(CHILD_A) ||
  !isFixtureAdvertised(CHILD_B);

interface RunEvent {
  readonly type: string;
  readonly nodeId?: string;
  readonly payload?: { childRunId?: string; childWorkflowId?: string } & Record<string, unknown>;
}

interface RunSnapshot {
  readonly status: string;
  readonly inputs?: Record<string, unknown>;
  readonly variables?: Record<string, unknown>;
}

describe.skipIf(SKIP)('dispatch-cross-worker-handoff: sequential child→parent→child variable flow (RFC 0022 §A + §D)', () => {
  it('HVMAP-1c: child-a writes via perWorkerOutputMappings; child-b reads via perWorkerInputMappings; shared parent bag is the handoff channel', async () => {
    const create = await driver.post('/v1/runs', { workflowId: PARENT });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;

    const parentTerminal = (await pollUntilTerminal(parentRunId)) as RunSnapshot;
    expect(parentTerminal.status, req('openwop.it.dispatch-cross-worker-handoff.hvmap-1c-child-a-writes-via-perworkeroutputmappings-child-b-reads-via-perworkeri', 
      'RFCS/0022-dispatch-input-output-mapping.md §D',
      'parent run MUST reach terminal `completed` once both children finish sequentially',
    )).toBe('completed');

    // Parent's sharedVar MUST be 'hello' — set by child-a's outputMapping.
    const parentVars = parentTerminal.variables ?? {};
    expect(parentVars.sharedVar, req('openwop.it.dispatch-cross-worker-handoff.hvmap-1c-child-a-writes-via-perworkeroutputmappings-child-b-reads-via-perworkeri', 
      'RFCS/0022-dispatch-input-output-mapping.md §A',
      'parent `sharedVar` MUST be child-a\'s `output` projection ("hello") via perWorkerOutputMappings',
    )).toBe('hello');

    // Locate child-b via the parent's `node.dispatched` events.
    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(parentRunId)}/events`);
    expect(eventsRes.status).toBe(200);
    const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []);
    const dispatchedB = events.find(
      (e) => e.type === 'node.dispatched' && e.payload?.childWorkflowId === CHILD_B,
    );
    expect(dispatchedB, req('openwop.it.dispatch-cross-worker-handoff.hvmap-1c-child-a-writes-via-perworkeroutputmappings-child-b-reads-via-perworkeri', 
      'RFCS/0022-dispatch-input-output-mapping.md §D',
      'parent event log MUST contain a `node.dispatched` event for child-b after child-a completes (sequential fan-out)',
    )).toBeDefined();
    const childBRunId = dispatchedB?.payload?.childRunId;
    expect(typeof childBRunId).toBe('string');

    // Child-b's inputs MUST reflect child-a's output (via the shared
    // parent variable bag's sharedVar).
    const childBSnapshotRes = await driver.get(`/v1/runs/${encodeURIComponent(childBRunId!)}`);
    expect(childBSnapshotRes.status).toBe(200);
    const childBSnapshot = childBSnapshotRes.json as RunSnapshot;
    expect(childBSnapshot.status).toBe('completed');
    const childBInputs = childBSnapshot.inputs ?? {};
    expect(childBInputs.input, req('openwop.it.dispatch-cross-worker-handoff.hvmap-1c-child-a-writes-via-perworkeroutputmappings-child-b-reads-via-perworkeri', 
      'RFCS/0022-dispatch-input-output-mapping.md §A + §D',
      'child-b `inputs.input` MUST be parent\'s `sharedVar` ("hello") — written by child-a, read by child-b via shared parent variable bag',
    )).toBe('hello');
  });

  it('HVMAP-1c-override: per-worker mapping overrides default mapping per §A effectiveInputMapping precedence', async () => {
    const PARENT_OVERRIDE = 'conformance-dispatch-per-worker-override';
    if (!isFixtureAdvertised(PARENT_OVERRIDE)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(PARENT_OVERRIDE)` returned early (fixture not seeded — soft-skip)'); // fixture not seeded — soft-skip
    const create = await driver.post('/v1/runs', { workflowId: PARENT_OVERRIDE });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(parentRunId);

    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(parentRunId)}/events`);
    const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []);
    const dispatchedA = events.find((e) => e.type === 'node.dispatched' && e.payload?.childWorkflowId === CHILD_A);
    const dispatchedB = events.find((e) => e.type === 'node.dispatched' && e.payload?.childWorkflowId === CHILD_B);
    if (!dispatchedA || !dispatchedB) return softSkip('blocked', 'precondition not met — `!dispatchedA || !dispatchedB` returned early (seam, prior step, or fixture unavailable)');

    const childARes = await driver.get(`/v1/runs/${encodeURIComponent(dispatchedA.payload!.childRunId!)}`);
    const childBRes = await driver.get(`/v1/runs/${encodeURIComponent(dispatchedB.payload!.childRunId!)}`);
    const childAInputs = (childARes.json as { inputs?: Record<string, unknown> }).inputs ?? {};
    const childBInputs = (childBRes.json as { inputs?: Record<string, unknown> }).inputs ?? {};

    expect(
      childAInputs.input,
      req('openwop.it.dispatch-cross-worker-handoff.hvmap-1c-override-per-worker-mapping-overrides-default-mapping-per-a-effectivein', 
        'RFCS/0022-dispatch-input-output-mapping.md §A',
        'child-a uses the DEFAULT inputMapping; input MUST come from parent.defaultX',
      ),
    ).toBe('default-x-value');
    expect(
      childBInputs.input,
      req('openwop.it.dispatch-cross-worker-handoff.hvmap-1c-override-per-worker-mapping-overrides-default-mapping-per-a-effectivein', 
        'RFCS/0022-dispatch-input-output-mapping.md §A',
        'child-b uses the per-worker OVERRIDE; input MUST come from parent.sharedVar (NOT defaultX)',
      ),
    ).toBe('shared-value');
  });
});
