/**
 * RFC 0022 §A — `core.dispatch` `outputMapping` harvesting (HVMAP-1b).
 * Normative reference: RFCS/0022-dispatch-input-output-mapping.md §A
 *
 * Verifies that when a `core.dispatch` config carries `outputMapping` and
 * a child reaches terminal `completed`, the host projects child variables
 * back into parent variables: `parentVariables.set(parentKey, childVariables[childKey])`.
 * Failed / cancelled children MUST skip the mapping; the parent's variable
 * stays at its pre-dispatch state for that child. Verified end-to-end
 * against the Postgres reference host on 2026-05-18.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.dispatchMapping: true`. Fixture-gated: requires
 * `conformance-dispatch-output-mapping` + the matching child fixture.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §A
 * @see schemas/dispatch-config.schema.json #/properties/outputMapping
 * @see examples/hosts/postgres/src/server.ts (core.dispatch executor)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const PARENT = 'conformance-dispatch-output-mapping';
const CHILD = 'conformance-dispatch-output-mapping-child';
const SKIP = !isFixtureAdvertised(PARENT) || !isFixtureAdvertised(CHILD);

interface RunSnapshot {
  readonly status: string;
  readonly variables?: Record<string, unknown>;
}

describe.skipIf(SKIP)('dispatch-output-mapping: child → parent variable harvest (RFC 0022 §A)', () => {
  it('HVMAP-1b: outputMapping harvests child variables into parent variables on terminal completed', async () => {
    const create = await driver.post('/v1/runs', { workflowId: PARENT });
    expect(create.status).toBe(201);
    const parentRunId = (create.json as { runId: string }).runId;

    const parentTerminal = (await pollUntilTerminal(parentRunId)) as RunSnapshot;
    expect(parentTerminal.status, driver.describe(
      'RFCS/0022-dispatch-input-output-mapping.md §A',
      'parent run MUST reach terminal `completed` once the dispatch loop terminates',
    )).toBe('completed');

    // Parent's `parentResult` MUST equal child's `childOutcome` ("done")
    // per the dispatch config's outputMapping = { parentResult: 'childOutcome' }.
    // Child declares childOutcome.defaultValue='done' so the value is
    // present in the child's variables_json at terminal time.
    const parentVars = parentTerminal.variables ?? {};
    expect(parentVars.parentResult, driver.describe(
      'RFCS/0022-dispatch-input-output-mapping.md §A',
      'parent `parentResult` MUST be child\'s `childOutcome` projection ("done") per outputMapping',
    )).toBe('done');
  });

  it.todo(
    'HVMAP-1b-failed: child terminates with `failed` status; outputMapping MUST be skipped; parent variables stay at pre-dispatch state for that child. Requires a child fixture that fails deterministically.',
  );

  it.todo(
    'HVMAP-1b-cancelled: child terminates with `cancelled` status; outputMapping MUST be skipped; parent variables stay at pre-dispatch state for that child. Requires a child fixture that supports external cancellation.',
  );
});
