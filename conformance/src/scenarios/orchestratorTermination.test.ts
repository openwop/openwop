/**
 * Multi-Agent Shift Phase 5 — orchestrator terminate decision (CO-3).
 *
 * Verifies that when an `core.orchestrator.supervisor` emits a decision
 * with `kind: 'terminate'`:
 *   1. `runOrchestrator.decided` event carries the terminate decision.
 *   2. `run.completed` follows (NOT `run.failed`).
 *   3. No further `runOrchestrator.decided` events are emitted (CO-3).
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.orchestrator: true`. Fixture-gated: requires
 * `conformance-orchestrator-terminate`.
 *
 * @see schemas/orchestrator-decision.schema.json (TerminateDecision)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isOrchestratorSupported } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-orchestrator-terminate';
const SKIP = !isOrchestratorSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('orchestratorTermination: terminate decision → run.completed (CO-3)', () => {
  it('terminate is the final orchestrator decision; run completes cleanly', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status).toBe('completed');

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown>; sequence?: number }> })
      .events ?? [];

    const decisions = list.filter((e) => e.type === 'runOrchestrator.decided');
    expect(decisions.length).toBeGreaterThan(0);

    const lastDecision = decisions[decisions.length - 1];
    const decision = lastDecision.payload?.decision as { kind?: string } | undefined;
    expect(decision?.kind).toBe('terminate');

    // CO-3: no terminate after another terminate. Equivalent: only one
    // terminate decision per run.
    const terminates = decisions.filter((e) => {
      const d = e.payload?.decision as { kind?: string } | undefined;
      return d?.kind === 'terminate';
    });
    expect(terminates.length).toBe(1);
  });
});
