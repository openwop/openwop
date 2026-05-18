/**
 * RFC 0022 §B — `core.subWorkflow` `inputMapping` seeding (HVMAP-2).
 * Normative reference: RFCS/0022-dispatch-input-output-mapping.md §B
 *   + spec/v1/node-packs.md §"`core.subWorkflow` contract" (post-RFC-0022).
 *
 * Verifies that when a `core.subWorkflow` config carries `inputMapping`,
 * the host seeds the child run's initial variable bag with
 * `parentVariables[parentKey]` projections, AFTER the child's
 * `variables[].defaultValue` fold (so inputMapping overrides matching
 * defaults). Unset parent variables MUST surface as `undefined` on the
 * child variable. The seeding fold is one-shot at run-create time;
 * mid-run parent mutations MUST NOT propagate to the child.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.subWorkflow.inputMapping: true`. Fixture-gated: requires
 * `conformance-subworkflow-input-mapping`.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §B
 * @see spec/v1/node-packs.md §"`core.subWorkflow` contract"
 */

import { describe, it } from 'vitest';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const FIXTURE = 'conformance-subworkflow-input-mapping';
const SKIP = !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('subworkflow-input-mapping: parent → child variable seeding (RFC 0022 §B)', () => {
  it.todo(
    'HVMAP-2: parent.currentPrdId="prd-1"; subWorkflow.config.inputMapping={receivedPrdId:"currentPrdId"}; child run\'s initial variables MUST have receivedPrdId === "prd-1".',
  );

  it.todo(
    'HVMAP-2-override-default: child workflow declares variables[{name:"receivedPrdId",defaultValue:"baked-in"}]; inputMapping projects currentPrdId; child run\'s initial variables MUST have receivedPrdId === parent\'s currentPrdId (NOT "baked-in").',
  );

  it.todo(
    'HVMAP-2-unset: parent.currentPrdId is unset; inputMapping={receivedPrdId:"currentPrdId"}; child receivedPrdId MUST surface as `undefined` (NOT omitted, NOT `null`).',
  );

  it.todo(
    'HVMAP-2-no-midrun-propagation: child mid-run; parent updates currentPrdId; child\'s receivedPrdId MUST remain at its seeded value (one-shot fold).',
  );

  it.todo(
    'HVMAP-2-refusal: host advertises core.subWorkflow surface but NOT capabilities.subWorkflow.inputMapping: true; workflow with non-empty inputMapping MUST fail registration with validation_error + details.requiredCapability === "subWorkflow.inputMapping".',
  );
});
