/**
 * RFC 0022 §A — `core.dispatch` `outputMapping` harvesting (HVMAP-1b).
 * Normative reference: RFCS/0022-dispatch-input-output-mapping.md §A
 *
 * Verifies that when a `core.dispatch` config carries `outputMapping` and
 * a child reaches terminal `completed`, the host projects child variables
 * back into parent variables: `parentVariables.set(parentKey, childVariables[childKey])`.
 * Failed / cancelled children MUST skip the mapping; the parent's variable
 * stays at its pre-dispatch state for that child.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.dispatchMapping: true`. Fixture-gated: requires
 * `conformance-dispatch-output-mapping`.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §A
 * @see schemas/dispatch-config.schema.json #/properties/outputMapping
 */

import { describe, it } from 'vitest';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const FIXTURE = 'conformance-dispatch-output-mapping';
const SKIP = !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('dispatch-output-mapping: child → parent variable harvest', () => {
  it.todo(
    'HVMAP-1b: dispatch.config.outputMapping = { parentResult: "childOutcome" }; child returns variables.childOutcome="done"; parent MUST have variables.parentResult === "done" after dispatch yields.',
  );

  it.todo(
    'HVMAP-1b-failed: child terminates with `failed` status; outputMapping MUST be skipped; parent variables stay at pre-dispatch state for that child.',
  );

  it.todo(
    'HVMAP-1b-cancelled: child terminates with `cancelled` status; outputMapping MUST be skipped; parent variables stay at pre-dispatch state for that child.',
  );
});
