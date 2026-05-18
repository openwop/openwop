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
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.dispatchMapping: true`. Fixture-gated: requires
 * `conformance-dispatch-input-mapping`.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §A
 * @see schemas/dispatch-config.schema.json #/properties/inputMapping
 */

import { describe, it } from 'vitest';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const FIXTURE = 'conformance-dispatch-input-mapping';
const SKIP = !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('dispatch-input-mapping: parent → child variable projection', () => {
  it.todo(
    'HVMAP-1a: dispatch.config.inputMapping = { childGreeting: "parentName" }; parent\'s `parentName="Alice"`; child-a MUST receive `inputs.childGreeting === "Alice"`. Gated on capabilities.agents.dispatchMapping: true.',
  );

  it.todo(
    'HVMAP-1a-null: parent variable unset → child input surfaces as `undefined` (NOT omitted, NOT `null`) per §A normative bullet.',
  );

  it.todo(
    'HVMAP-1a-refusal: host advertises capabilities.agents.dispatch: true but NOT capabilities.agents.dispatchMapping: true; workflow with non-empty inputMapping MUST fail registration with validation_error + details.requiredCapability === "agents.dispatchMapping".',
  );
});
