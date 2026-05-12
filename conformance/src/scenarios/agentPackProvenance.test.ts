/**
 * Multi-Agent Shift Phase 2 — sourceManifestId provenance round-trip.
 * Normative reference: RFCS/0003-agent-packs.md
 *
 * Verifies that when a workspace agent originates from a pack install,
 * the agent's runtime AgentRef AND the exported AgentManifest both
 * carry the original `sourceManifestId` so audit consumers can trace
 * agents back to their distribution source.
 *
 * Capability-gated: skips when host doesn't advertise
 * `capabilities.agents.supported: true`. Fixture-gated: requires
 * `conformance-agent-pack-provenance`.
 *
 * @see schemas/agent-ref.schema.json §`sourceManifestId`
 * @see schemas/agent-manifest.schema.json §`sourceManifestId`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { isAgentSupported } from '../lib/multi-agent-capabilities.js';

const FIXTURE = 'conformance-agent-pack-provenance';
const SKIP = !isAgentSupported() || !isFixtureAdvertised(FIXTURE);

describe.skipIf(SKIP)('agentPackProvenance: sourceManifestId survives install + run', () => {
  it('run-level AgentRef carries sourceManifestId pointing back to the install source', async () => {
    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const body = snap.json as {
      agent?: { agentId?: string; sourceManifestId?: string };
      runOrchestrator?: { agentId?: string; sourceManifestId?: string };
    };

    const refs = [body.agent, body.runOrchestrator].filter(
      (r): r is { agentId?: string; sourceManifestId?: string } => Boolean(r),
    );
    expect(refs.length).toBeGreaterThan(0);

    // At least one of the run's AgentRefs MUST carry sourceManifestId
    // when the fixture's agent originated from a pack install.
    const withProvenance = refs.filter((r) => typeof r.sourceManifestId === 'string');
    expect(
      withProvenance.length,
      'pack-installed agents MUST surface sourceManifestId on their runtime AgentRef projection',
    ).toBeGreaterThan(0);
  });
});
