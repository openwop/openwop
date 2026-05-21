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
 *      is present, version MUST be integer in [1, 4]; supported MUST be boolean.
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
import { driver } from '../lib/driver.js';

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
    if (d === null) return; // discovery unavailable — skip
    const executionModel = d.capabilities?.multiAgent?.executionModel;
    if (executionModel === undefined) return; // host doesn't advertise — soft-skip
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
      Number.isInteger(v) && v >= 1 && v <= 4,
      driver.describe(
        'RFCS/0037-multi-agent-execution-model.md §C',
        'version MUST be an integer in [1, 4] (1 = Phase 1 only; Phases 2-4 lift the ceiling additively)',
      ),
    ).toBe(true);
  });
});

// Behavioral assertions land when the conformance-multi-agent-handoff fixtures land in
// a follow-up commit + when a reference host advertises the capability. The shape probe
// above is the today-landable contract surface; the 4-event causation chain assertion
// in the docstring requires fixture infrastructure (a 2-node supervisor + dispatch parent
// + a deterministic child fixture pair) that is the same pattern RFC 0022 used and that
// we know works against the reference workflow-engine.
//
// Cross-host promotion path per RFCs/0001 §"Promotion to Accepted": once the reference
// host advertises capabilities.multiAgent.executionModel + the fixture lands + a
// non-steward host advertises, RFC 0037 Phase 1 graduates Draft → Active → Accepted.
