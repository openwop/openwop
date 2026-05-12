/**
 * Multi-Agent Shift Phase 1 — agent identity (RunSnapshot.agent / runOrchestrator).
 * Normative reference: RFCS/0002-agent-identity-and-reasoning-events.md
 *
 * Verifies:
 *   1. Hosts advertising `capabilities.agents.supported: true` populate
 *      `RunSnapshot.agent` and/or `RunSnapshot.runOrchestrator` with
 *      AgentRef-shaped values when a run carries agent provenance.
 *   2. The AgentRef shape conforms to `schemas/agent-ref.schema.json`
 *      (required `agentId`; optional `name`, `modelClass`, `memoryRef`,
 *      `version`, `sourceManifestId`).
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.supported: true`. Fixture-gated: requires
 * `conformance-agent-identity` advertised in `capabilities.fixtures`.
 *
 * @see spec/v1/capabilities.md §`agents`
 * @see schemas/agent-ref.schema.json
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isAgentSupported } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-identity';
const SKIP = !isAgentSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentMetadata: RunSnapshot.agent + runOrchestrator wire-shape', () => {
  it('host populates AgentRef-shaped agent identity on RunSnapshot', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(['completed', 'failed']).toContain(terminal.status);

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    expect(snap.status).toBe(200);
    const body = snap.json as { agent?: { agentId?: string }; runOrchestrator?: { agentId?: string } };

    const hasAgent = body.agent && typeof body.agent.agentId === 'string';
    const hasOrch = body.runOrchestrator && typeof body.runOrchestrator.agentId === 'string';
    expect(
      hasAgent || hasOrch,
      'fixture-runs MUST populate at least one of RunSnapshot.agent / runOrchestrator',
    ).toBe(true);

    if (hasAgent) {
      expect(body.agent!.agentId!.length).toBeGreaterThanOrEqual(3);
    }
    if (hasOrch) {
      expect(body.runOrchestrator!.agentId!.length).toBeGreaterThanOrEqual(3);
    }
  });
});
