/**
 * Dispatch loop scenarios (Phase 6 / RFC 0007) — exercises `conformance-dispatch-loop`
 * which uses `core.dispatch` to process orchestrator decisions and route to child workflows
 * or terminate the loop.
 *
 * Verifies:
 *   1. Dispatch loop handles `next-worker` by delegating to child run.
 *   2. Dispatch loop handles `terminate` cleanly.
 *
 * Spec references:
 *   - RFCS/0007-dispatch-loop.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

const DISPATCH_LOOP_WORKFLOW_ID = 'conformance-dispatch-loop';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(DISPATCH_LOOP_WORKFLOW_ID);

describe.skipIf(SKIP_NO_FIXTURE)('dispatchLoop: core.dispatch consumes OrchestratorDecision', () => {
  it('host correctly processes orchestrator decisions and terminates', async () => {
    // 1. Create the run
    const create = await driver.post('/v1/runs', { workflowId: DISPATCH_LOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    // Hosts may drive orchestrator decisions internally or through a conformance
    // mock. The black-box contract here is terminal completion.
    
    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, req('openwop.it.dispatchLoop.host-correctly-processes-orchestrator-decisions-and-terminates', 
      'RFCS/0007-dispatch-loop.md §H',
      'run MUST reach terminal `completed` after dispatch processes terminate decision',
    )).toBe('completed');

    // Verify the event log has the expected orchestrator decisions
    const eventsRes = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    expect(eventsRes.status).toBe(200);
    const events = (eventsRes.json as { events?: any[] })?.events ?? [];

    const decisions = events
      .filter((e) => e.type === 'runOrchestrator.decided')
      .map((e) => e.payload?.decision?.kind);

    expect(decisions, req('openwop.it.dispatchLoop.host-correctly-processes-orchestrator-decisions-and-terminates', 
      'RFCS/0007-dispatch-loop.md §D',
      'host MUST emit next-worker then terminate in a loop topology'
    )).toEqual(['next-worker', 'terminate']);
  });
});
