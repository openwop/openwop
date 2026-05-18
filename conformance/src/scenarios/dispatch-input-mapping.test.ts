/**
 * RFC 0022 §A — `core.dispatch` `inputMapping` projection (HVMAP-1a).
 * Normative reference: RFCS/0022-dispatch-input-output-mapping.md §A
 *
 * Verifies that when a `core.dispatch` config carries `inputMapping`, the
 * host builds child inputs by projecting parent variables before invoking
 * each `nextWorkerIds[i]` child. Per §A: `childInputs[childKey] =
 * parentVariables.get(parentKey)`. Verified end-to-end against the
 * Postgres reference host on 2026-05-18 alongside the supervisor-mock
 * extension that lets fixtures drive `OrchestratorDecision` sequences
 * (RFC 0022 §"Unresolved questions" #6 — `mockDispatchPlan` config on
 * `core.orchestrator.supervisor`).
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.dispatchMapping: true`. Fixture-gated: requires
 * `conformance-dispatch-input-mapping` + the matching child fixture.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §A
 * @see schemas/dispatch-config.schema.json #/properties/inputMapping
 * @see examples/hosts/postgres/src/server.ts (core.dispatch executor)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const PARENT = 'conformance-dispatch-input-mapping';
const CHILD = 'conformance-dispatch-input-mapping-child';
const SKIP = !isFixtureAdvertised(PARENT) || !isFixtureAdvertised(CHILD);

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

describe.skipIf(SKIP)('dispatch-input-mapping: parent → child variable projection (RFC 0022 §A)', () => {
  it('HVMAP-1a: inputMapping projects parent variables into child inputs', async () => {
    const create = await driver.post('/v1/runs', { workflowId: PARENT });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;

    const parentTerminal = (await pollUntilTerminal(parentRunId)) as RunSnapshot;
    expect(parentTerminal.status, driver.describe(
      'RFCS/0022-dispatch-input-output-mapping.md §A',
      'parent run MUST reach terminal `completed` once the dispatch loop terminates',
    )).toBe('completed');

    // Locate the child run via the parent's `node.dispatched` event.
    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(parentRunId)}/events`);
    expect(eventsRes.status).toBe(200);
    const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []);
    const dispatched = events.find(
      (e) => e.type === 'node.dispatched' && e.payload?.childWorkflowId === CHILD,
    );
    expect(dispatched, driver.describe(
      'RFCS/0007-dispatch.md §D',
      'parent event log MUST contain a `node.dispatched` event naming the child workflow',
    )).toBeDefined();
    const childRunId = dispatched?.payload?.childRunId;
    expect(typeof childRunId).toBe('string');

    // The child's inputs_json (surfaced as `inputs` on GET /v1/runs)
    // MUST contain the parent's `parentName` projected onto `childGreeting`
    // per the dispatch config's inputMapping.
    const childSnapshotRes = await driver.get(`/v1/runs/${encodeURIComponent(childRunId!)}`);
    expect(childSnapshotRes.status).toBe(200);
    const childSnapshot = childSnapshotRes.json as RunSnapshot;
    expect(childSnapshot.status, driver.describe(
      'RFCS/0007-dispatch.md',
      'child run MUST reach terminal `completed`',
    )).toBe('completed');
    const childInputs = childSnapshot.inputs ?? {};
    expect(childInputs.childGreeting, driver.describe(
      'RFCS/0022-dispatch-input-output-mapping.md §A',
      'child `inputs.childGreeting` MUST be parent\'s `parentName` projection ("Alice") per inputMapping',
    )).toBe('Alice');
  });

  it.todo(
    'HVMAP-1a-null: parent variable unset → child input surfaces as `undefined` (NOT omitted, NOT `null`) per §A normative bullet. Requires a fixture variant omitting parentName.defaultValue.',
  );

  it.todo(
    'HVMAP-1a-refusal: host advertises capabilities.agents.dispatch: true but NOT capabilities.agents.dispatchMapping: true; workflow with non-empty inputMapping MUST fail registration with validation_error + details.requiredCapability === "agents.dispatchMapping". Requires a host-capability-toggle hook in the conformance harness.',
  );
});
