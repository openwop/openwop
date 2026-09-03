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
import { setHostCapability, resetHostCapabilities, isToggleAvailable } from '../lib/host-toggle.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

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
    expect(parentTerminal.status, req('openwop.it.dispatch-input-mapping.hvmap-1a-inputmapping-projects-parent-variables-into-child-inputs', 
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
    expect(dispatched, req('openwop.it.dispatch-input-mapping.hvmap-1a-inputmapping-projects-parent-variables-into-child-inputs', 
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
    expect(childSnapshot.status, req('openwop.it.dispatch-input-mapping.hvmap-1a-inputmapping-projects-parent-variables-into-child-inputs', 
      'RFCS/0007-dispatch.md',
      'child run MUST reach terminal `completed`',
    )).toBe('completed');
    const childInputs = childSnapshot.inputs ?? {};
    expect(childInputs.childGreeting, req('openwop.it.dispatch-input-mapping.hvmap-1a-inputmapping-projects-parent-variables-into-child-inputs', 
      'RFCS/0022-dispatch-input-output-mapping.md §A',
      'child `inputs.childGreeting` MUST be parent\'s `parentName` projection ("Alice") per inputMapping',
    )).toBe('Alice');
  });

  it('HVMAP-1a-null: parent variable unset → child input surfaces as `undefined` per §A', async () => {
    const PARENT_NO_DEFAULT = 'conformance-dispatch-input-mapping-no-default';
    if (!isFixtureAdvertised(PARENT_NO_DEFAULT) || !isFixtureAdvertised(CHILD)) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(PARENT_NO_DEFAULT) || !isFixtureAdvertised(CHILD)` returned early (fixture not seeded — soft-skip)'); // fixture not seeded — soft-skip
    const create = await driver.post('/v1/runs', { workflowId: PARENT_NO_DEFAULT });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(parentRunId);

    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(parentRunId)}/events`);
    const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []);
    const dispatched = events.find(
      (e) => e.type === 'node.dispatched' && e.payload?.childWorkflowId === CHILD,
    );
    if (!dispatched) return softSkip('blocked', 'precondition not met — `!dispatched` returned early (host doesn\'t emit node.dispatched — soft-skip) (seam, prior step, or fixture unavailable)'); // host doesn't emit node.dispatched — soft-skip
    const childRunId = dispatched.payload?.childRunId;

    const childRes = await driver.get(`/v1/runs/${encodeURIComponent(childRunId!)}`);
    const child = childRes.json as RunSnapshot;
    // Per RFC 0022 §A: an unset parent variable MUST surface as `undefined`.
    // On the wire, `undefined` becomes either omitted from the JSON object
    // OR explicit `null`; the spec REJECTS the latter. We accept either
    // "key absent" or "key === undefined" but FAIL on `null`.
    const inputs = child.inputs ?? {};
    const v = inputs.childGreeting;
    expect(
      v === undefined || !('childGreeting' in inputs),
      req('openwop.it.dispatch-input-mapping.hvmap-1a-null-parent-variable-unset-child-input-surfaces-as-undefined-per-a', 
        'RFCS/0022-dispatch-input-output-mapping.md §A',
        'unset parent variable projection MUST surface as undefined (NOT null, NOT a default placeholder)',
      ),
    ).toBe(true);
    expect(v).not.toBe(null);
  });

});

describe('dispatch-input-mapping: registration refusal (RFC 0022 §C HVMAP-1a-refusal)', () => {
  it('host with agents.dispatchMapping toggled OFF MUST refuse non-empty inputMapping at registration', async () => {
    if (!(await isToggleAvailable())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!(await isToggleAvailable())` returned early (seam not exposed — soft-skip)'); // seam not exposed — soft-skip
    await setHostCapability('agents.dispatchMapping', false);
    try {
      const workflow = {
        workflowId: `hvmap-1a-refusal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nodes: [
          {
            nodeId: 'dispatch-1',
            typeId: 'core.dispatch',
            config: {
              nextWorkerIds: ['child-a'],
              inputMapping: { childInput: 'parentVar' }, // non-empty — refusal trigger
            },
          },
        ],
      };
      const res = await driver.post('/v1/host/sample/workflows', workflow);
      expect(
        res.status,
        req('openwop.it.dispatch-input-mapping.host-with-agents-dispatchmapping-toggled-off-must-refuse-non-empty-inputmapping', 
          'RFCS/0022-dispatch-input-output-mapping.md §C',
          'workflow with non-empty inputMapping MUST be refused when capabilities.agents.dispatchMapping is not advertised',
        ),
      ).toBe(400);
      const body = res.json as { error?: string; details?: { requiredCapability?: string } };
      expect(body.error).toBe('validation_error');
      expect(
        body.details?.requiredCapability,
        req('openwop.it.dispatch-input-mapping.host-with-agents-dispatchmapping-toggled-off-must-refuse-non-empty-inputmapping', 
          'RFCS/0022-dispatch-input-output-mapping.md §C',
          'refusal MUST surface requiredCapability: "agents.dispatchMapping"',
        ),
      ).toBe('agents.dispatchMapping');
    } finally {
      await resetHostCapabilities();
    }
  });
});
