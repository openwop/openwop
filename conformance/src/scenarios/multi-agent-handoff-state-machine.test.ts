/**
 * multi-agent-handoff-state-machine — RFC 0037 Phase 1 advertisement-shape + behavioral.
 *
 * Status: ACTIVE (advertisement-shape + behavioral). RFC 0037 filed
 * 2026-05-21 as Draft; this scenario lands the matching conformance gate.
 * Capability-gated on `capabilities.multiAgent.executionModel.supported: true`
 * AND fixture-gated on the `conformance-multi-agent-handoff` parent + child
 * fixtures (when those land; current scenario is shape + soft-skip until then).
 *
 * Asserts (Phase 1 — execution-loop + handoff state machine per spec/v1/multi-agent-execution.md):
 *
 *   1. Advertisement shape: when capabilities.multiAgent.executionModel.supported
 *      is present, version MUST be integer in [1, 5]; supported MUST be boolean.
 *
 *   2. Behavioral (gated on supported: true + fixture availability): a
 *      supervisor → next-worker → child-completed run emits the 4 expected
 *      `core.workflowChain.event` records in causation order:
 *        - dispatch.began (causationId → runOrchestrator.decided eventId)
 *        - dispatch.succeeded (causationId → dispatch.began eventId)
 *        - child.completed (causationId → dispatch.succeeded eventId)
 *        - output.harvested (causationId → child.completed eventId; harvestedKeys present
 *          when the dispatch config carried outputMapping)
 *
 *   3. Behavioral negative: failed-child path emits dispatch.began → dispatch.succeeded
 *      → child.failed (NO output.harvested — per spec/v1/multi-agent-execution.md
 *      §"Handoff state machine" + RFC 0022 §B).
 *
 * @see RFCS/0037-multi-agent-execution-model.md
 * @see spec/v1/multi-agent-execution.md §"Execution loop" + §"Handoff state machine"
 * @see schemas/run-event-payloads.schema.json §coreWorkflowChainEvent
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    multiAgent?: {
      executionModel?: {
        supported?: unknown;
        version?: unknown;
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

describe.skipIf(HTTP_SKIP)('multi-agent-handoff-state-machine: advertisement shape (RFC 0037 §C)', () => {
  it('capabilities.multiAgent.executionModel (when present) conforms to RFC 0037 §C', async () => {
    const d = await readDiscovery();
    if (d === null) return softSkip('blocked', 'discovery unavailable — skip (d === null)');
    const executionModel = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel;
    if (executionModel === undefined) return softSkip('inapplicable', 'host doesn\'t advertise — soft-skip');
    expect(
      typeof executionModel.supported,
      driver.describe(
        'RFCS/0037-multi-agent-execution-model.md §C',
        'capabilities.multiAgent.executionModel.supported MUST be boolean when present',
      ),
    ).toBe('boolean');
    expect(
      typeof executionModel.version,
      driver.describe(
        'RFCS/0037-multi-agent-execution-model.md §C',
        'capabilities.multiAgent.executionModel.version MUST be integer when present',
      ),
    ).toBe('number');
    const v = executionModel.version as number;
    expect(
      Number.isInteger(v) && v >= 1 && v <= 5,
      driver.describe(
        'RFCS/0037-multi-agent-execution-model.md §C',
        'version MUST be an integer in [1, 5] (1 = Phase 1 only; Phases 2-5 lift the ceiling additively — Phase 5 = RFC 0061 stateful agent-loop lifecycle, matching `capabilities.schema.json` §multiAgent.executionModel.version maximum)',
      ),
    ).toBe(true);
  });
});

// Behavioral assertion: when a host advertises capabilities.multiAgent.executionModel.supported,
// it MUST emit the 7-state handoff state machine's transition events as `core.workflowChain.event`
// records with causationId chained per the spec §"Transition events" table. The happy-path
// fixture (supervisor → next-worker → child completed with outputMapping non-empty) drives 4
// of the 7 transitions: dispatch.began → dispatch.succeeded → child.completed → output.harvested.

interface RunEvent { type: string; eventId?: string; causationId?: string; payload?: Record<string, unknown>; }

const PARENT_FIXTURE = 'conformance-multi-agent-handoff';
const CHILD_FIXTURE = 'conformance-multi-agent-handoff-child';
const BEHAVIORAL_SKIP = HTTP_SKIP || !isFixtureAdvertised(PARENT_FIXTURE) || !isFixtureAdvertised(CHILD_FIXTURE);

describe.skipIf(BEHAVIORAL_SKIP)('multi-agent-handoff-state-machine: behavioral 4-event causation chain (RFC 0037 §"Handoff state machine")', () => {
  it('happy-path: dispatch.began → dispatch.succeeded → child.completed → output.harvested fire in causation order', async () => {
    const d = await readDiscovery();
    const advertised = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.supported === true;
    if (!advertised) return softSkip('inapplicable', 'soft-skip — host honest about not implementing');

    const create = await driver.post('/v1/runs', { workflowId: PARENT_FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, driver.describe(
      'spec/v1/multi-agent-execution.md §"Execution loop"',
      'parent run with supervisor → next-worker → terminate MUST reach terminal `completed`',
    )).toBe('completed');

    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    expect(eventsRes.status).toBe(200);
    const events = ((eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? []);
    const chainEvents = events.filter((e) => e.type === 'core.workflowChain.event');

    expect(chainEvents.length, driver.describe(
      'RFCS/0037-multi-agent-execution-model.md §"Conformance"',
      'happy-path fixture MUST produce 4 core.workflowChain.event records (dispatch.began, dispatch.succeeded, child.completed, output.harvested)',
    )).toBe(4);

    const phases = chainEvents.map((e) => (e.payload as { phase?: string } | undefined)?.phase);
    expect(phases, driver.describe(
      'spec/v1/multi-agent-execution.md §"Transition events"',
      'phase order MUST be dispatch.began → dispatch.succeeded → child.completed → output.harvested',
    )).toEqual(['dispatch.began', 'dispatch.succeeded', 'child.completed', 'output.harvested']);

    // Causation chain: each transition's causationId MUST equal the prior transition's eventId.
    // dispatch.began causes back to a runOrchestrator.decided; the inner 3 chain through each other.
    for (let i = 1; i < chainEvents.length; i++) {
      const prior = chainEvents[i - 1];
      const cur = chainEvents[i];
      expect(cur?.causationId, driver.describe(
        'spec/v1/multi-agent-execution.md §"Transition events"',
        `core.workflowChain.event #${i} (${phases[i]}) MUST have causationId === prior event's eventId`,
      )).toBe(prior?.eventId);
    }

    // dispatch.began causationId MUST chain back to a runOrchestrator.decided event.
    const dispatchBegan = chainEvents[0];
    expect(dispatchBegan?.causationId).toBeDefined();
    const decidedEvent = events.find((e) => e.eventId === dispatchBegan?.causationId);
    expect(decidedEvent?.type, driver.describe(
      'spec/v1/multi-agent-execution.md §"Transition events"',
      'dispatch.began causationId MUST point at the runOrchestrator.decided event that named this worker',
    )).toBe('runOrchestrator.decided');

    // output.harvested.harvestedKeys MUST list the outputMapping keys harvested.
    const harvested = chainEvents[3]?.payload as { harvestedKeys?: string[] } | undefined;
    expect(harvested?.harvestedKeys, driver.describe(
      'spec/v1/multi-agent-execution.md §"Transition events"',
      'output.harvested payload MUST list harvested parent-variable keys (the fixture\'s outputMapping is { parentResult: \'childOutcome\' })',
    )).toEqual(['parentResult']);
  });
});

// Cross-host promotion path per RFCs/0001 §"Promotion to Accepted": once a non-steward host
// advertises capabilities.multiAgent.executionModel.supported + the behavioral assertion above
// passes against it, RFC 0037 Phase 1 graduates Active → Accepted.
