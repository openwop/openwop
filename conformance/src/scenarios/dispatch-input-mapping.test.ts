/**
 * RFC 0022 §A — `core.dispatch` `inputMapping` projection (HVMAP-1a).
 * Normative reference: RFCS/0022-dispatch-input-output-mapping.md §A
 *
 * Verifies that when a `core.dispatch` config carries `inputMapping`, the
 * host builds child inputs by projecting parent variables before invoking
 * each `nextWorkerIds[i]` child. Per §A: `childInputs[childKey] =
 * parentVariables.get(parentKey)`; unset parent variables surface as
 * `undefined` on the child input (NOT omitted, NOT coerced to `null`).
 *
 * Host status (2026-05-18): the Postgres reference host implements §A
 * runtime behavior end-to-end — `dispatch.node.ts` reads
 * `node.config.inputMapping` / `perWorkerInputMappings`, projects parent
 * variables into the child run's `inputs_json` before invocation, and
 * harvests via `outputMapping` / `perWorkerOutputMappings` on terminal
 * `completed`. The host advertises `capabilities.agents.dispatchMapping:
 * true`. The blocking piece for this scenario's behavioral assertion is
 * the conformance harness's supervisor mock — the existing
 * `core.orchestrator.supervisor` reference implementation emits a single
 * hard-coded `next-worker: ['conformance-noop']` decision, which doesn't
 * cover the variant-fixture decision sequences these tests need. The
 * test stays `it.todo()` until either (a) the supervisor mock gains a
 * `mockDispatchPlan: OrchestratorDecision[]` config field that fixtures
 * can drive, or (b) the RFC 0023 `core.conformance.mock-agent` typeId
 * wires the supervisor side of the dispatch chain.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.dispatchMapping: true`. Fixture-gated: requires
 * `conformance-dispatch-input-mapping`.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §A
 * @see schemas/dispatch-config.schema.json #/properties/inputMapping
 * @see examples/hosts/postgres/src/server.ts (core.dispatch executor)
 */

import { describe, it } from 'vitest';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const FIXTURE = 'conformance-dispatch-input-mapping';
const SKIP = !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('dispatch-input-mapping: parent → child variable projection', () => {
  it.todo(
    'HVMAP-1a: dispatch.config.inputMapping = { childGreeting: "parentName" }; parent\'s `parentName="Alice"`; child-a MUST receive `inputs.childGreeting === "Alice"`. Host implements; awaiting supervisor-mock extension to drive decisions per-fixture.',
  );

  it.todo(
    'HVMAP-1a-null: parent variable unset → child input surfaces as `undefined` (NOT omitted, NOT `null`) per §A normative bullet.',
  );

  it.todo(
    'HVMAP-1a-refusal: host advertises capabilities.agents.dispatch: true but NOT capabilities.agents.dispatchMapping: true; workflow with non-empty inputMapping MUST fail registration with validation_error + details.requiredCapability === "agents.dispatchMapping". Requires a host-capability-toggle hook in the conformance harness.',
  );
});
