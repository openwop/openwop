/**
 * RFC 0022 §A — `core.dispatch` sequential cross-worker handoff (HVMAP-1c).
 * Normative reference: RFCS/0022-dispatch-input-output-mapping.md §A + §D
 *
 * Verifies that under `fanOutPolicy: 'sequential'` (v1.x default), the
 * output mapping of child N MUST be visible to child N+1's input mapping
 * within the same dispatch loop — they share the parent variable bag. The
 * scenario routes child-a's `output` variable through the parent's
 * `sharedVar` slot via per-worker mappings, then child-b reads it back as
 * `inputs.input`.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.dispatchMapping: true`. Fixture-gated: requires
 * `conformance-dispatch-cross-worker-handoff`.
 *
 * @see RFCS/0022-dispatch-input-output-mapping.md §A + §D
 * @see schemas/dispatch-config.schema.json #/properties/perWorker*
 *
 * Host status (2026-05-18): Postgres reference host implements §A + §D
 * runtime end-to-end. The `core.dispatch` executor in
 * `examples/hosts/postgres/src/server.ts` loops over `nextWorkerIds[]`
 * sequentially, harvesting each child's outputMapping into the shared
 * parent variable bag before the next sibling's inputMapping reads it.
 * The cross-worker-handoff property is therefore wired; the remaining
 * gap is the supervisor-mock extension that drives multi-worker
 * decisions per fixture (same blocker as HVMAP-1a / 1b).
 */

import { describe, it } from 'vitest';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const FIXTURE = 'conformance-dispatch-cross-worker-handoff';
const SKIP = !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('dispatch-cross-worker-handoff: sequential child→parent→child variable flow', () => {
  it.todo(
    'HVMAP-1c: sequential fan-out [child-a, child-b]; perWorkerOutputMappings.child-a={sharedVar:"output"}; perWorkerInputMappings.child-b={input:"sharedVar"}; child-a writes output="hello"; child-b MUST receive inputs.input === "hello".',
  );

  it.todo(
    'HVMAP-1c-override: per-worker mapping overrides default mapping. dispatch.inputMapping={input:"defaultX"}; perWorkerInputMappings.child-b={input:"sharedVar"}; child-b MUST receive inputs.input from sharedVar, NOT defaultX.',
  );
});
