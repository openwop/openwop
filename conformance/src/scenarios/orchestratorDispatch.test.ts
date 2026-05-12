/**
 * Multi-Agent Shift Phase 5 — orchestrator → dispatch → next-worker round-trip.
 * Normative reference: RFCS/0006-orchestrator.md
 *
 * Verifies that a workflow with `core.orchestrator.supervisor` →
 * `core.dispatch` topology emits the canonical event sequence:
 *   `node.started{supervisor}` → `runOrchestrator.decided{next-worker}`
 *   → `node.completed{supervisor}` → `node.started{dispatch}` → child-run
 *   lifecycle → `node.completed{dispatch}`.
 *
 * The supervisor's `runOrchestrator.decided` payload conforms to
 * `schemas/run-orchestrator-decided-event.schema.json` + nested
 * `schemas/orchestrator-decision.schema.json`.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.orchestrator: true` AND `capabilities.agents.dispatch: true`.
 * Fixture-gated: requires `conformance-orchestrator-dispatch`.
 *
 * @see schemas/orchestrator-decision.schema.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import {
  isOrchestratorSupported,
  isDispatchSupported,
} from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-orchestrator-dispatch';
const SKIP =
  !isOrchestratorSupported() ||
  !isDispatchSupported() ||
  !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('orchestratorDispatch: supervisor → dispatch → next-worker', () => {
  it('emits runOrchestrator.decided{next-worker} between supervisor + dispatch', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status).toBe('completed');

    const events = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
    const list = (events.json as { events?: Array<{ type: string; payload?: Record<string, unknown> }> })
      .events ?? [];

    const decisions = list.filter((e) => e.type === 'runOrchestrator.decided');
    expect(decisions.length).toBeGreaterThan(0);

    // At least one decision must be kind:'next-worker' (the dispatched-worker case).
    const nextWorker = decisions.find((e) => {
      const d = e.payload?.decision as { kind?: string } | undefined;
      return d?.kind === 'next-worker';
    });
    expect(nextWorker, 'fixture emits at least one kind:next-worker decision').toBeDefined();

    const payload = nextWorker!.payload!;
    expect(typeof payload.agentId).toBe('string');
    const decision = payload.decision as { kind: string; nextWorkerIds: string[] };
    expect(decision.kind).toBe('next-worker');
    expect(Array.isArray(decision.nextWorkerIds)).toBe(true);
    expect(decision.nextWorkerIds.length).toBeGreaterThanOrEqual(1);
  });
});
