/**
 * agent-manifest-runtime — RFC 0070. When a host advertises
 * `capabilities.agents.manifestRuntime.supported`, it has loaded pack `agents[]`
 * (RFC 0003) into an AgentRegistry and can dispatch a manifest agent on the
 * existing core.dispatch/orchestrator loop, enforcing toolAllowlist (RFC 0002
 * §A14) and confidence escalation (§F).
 *
 * Gated on the capability + the host dispatch seam; soft-skips when either is
 * absent (a v1.0-only host passes the locked-core suite unaffected).
 *
 * @see RFCS/0070-agent-manifest-runtime.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readManifestRuntimeCap, listManifestAgents, dispatchAgent } from '../lib/agentRuntime.js';

describe('agent-manifest-runtime (RFC 0070)', () => {
  it('lists installed manifest agents and dispatches one with attributed events', async () => {
    const cap = await readManifestRuntimeCap();
    if (cap?.supported !== true) return; // unadvertised — soft-skip

    const inv = await listManifestAgents();
    if (inv === null) return; // seam absent — soft-skip
    const agents = inv.agents ?? [];
    expect(
      Array.isArray(agents) && agents.length > 0,
      driver.describe('RFC 0070 §A', 'a manifestRuntime host MUST surface ≥1 installed manifest agent'),
    ).toBe(true);

    const agentId = agents[0]?.agentId;
    if (typeof agentId !== 'string') return;

    // Opaque-payload dispatch (validateHandoff:false) so the assertion is
    // independent of the chosen agent's handoff schema.
    const res = await dispatchAgent(agentId, { task: {}, validateHandoff: false, availableTools: [] });
    if (res === null) return; // seam absent — soft-skip
    expect(
      res.status === 'completed' || res.status === 'escalated',
      driver.describe('RFC 0070', 'dispatch MUST resolve to a terminal status (completed | escalated)'),
    ).toBe(true);
    const types = (res.events ?? []).map((e) => e.type);
    expect(
      types.includes('agent.reasoned') && types.includes('agent.decided'),
      driver.describe('RFC 0002 §A', 'dispatch MUST emit attributed agent.reasoned + agent.decided events'),
    ).toBe(true);
    expect(
      (res.events ?? []).every((e) => e.agentId === agentId),
      driver.describe('RFC 0002 §A', 'every emitted agent.* event MUST carry the dispatched agentId'),
    ).toBe(true);
  });

  // NOTE: RFC 0002 §F confidence escalation is NOT asserted here. Forcing a
  // sub-threshold decision black-box would require a non-normative test hook
  // (the reference host's `simulateConfidence`); a conformant host need not
  // expose one, so asserting it here would wrongly fail conformant peers.
  // Escalation is covered against the reference host in
  // apps/workflow-engine/backend/typescript/test/{agents,agent-dispatch-route}.test.ts.
});
