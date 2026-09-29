/**
 * Multi-Agent Shift Phase 5 — orchestrator terminate decision (CO-3).
 * Normative reference: RFCS/0006-orchestrator.md
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
import { req } from '../lib/requirement-ids.js';
import { softSkip, type SoftSkipKind } from '../lib/soft-skip.js';

const FIXTURE = 'conformance-orchestrator-terminate';
const SKIP = !isOrchestratorSupported() || !isFixtureAdvertised(FIXTURE);

/** Why the gate below holds, as RFC 0148 §A names it (openwop#1686: a describe-level skip recorded no disposition). */
const GATE_WHY: readonly [SoftSkipKind, string] =
  (!isOrchestratorSupported()) ? ['inapplicable', `the host does not advertise the capability this scenario covers (isOrchestratorSupported() is false)`] as const : 
  (!isFixtureAdvertised(FIXTURE)) ? ['blocked', `the \`${FIXTURE}\` fixture is not advertised`] as const : ['blocked', 'the gate held for no named reason'] as const;

describe('orchestratorTermination: terminate decision → run.completed (CO-3)', () => {
  it('terminate is the final orchestrator decision; run completes cleanly', async () => {
    if (SKIP) return softSkip(...GATE_WHY);
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status, req('openwop.it.orchestratorTermination.terminate-is-the-final-orchestrator-decision-run-completes-cleanly', 'RFCS/0006-orchestrator.md', 'terminate is the final orchestrator decision; run completes cleanly')).toBe(201);
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
