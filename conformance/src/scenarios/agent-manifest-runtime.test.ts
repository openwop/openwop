/**
 * agent-manifest-runtime — RFC 0070. When a host advertises
 * `capabilities.agents.manifestRuntime.supported`, it has loaded pack `agents[]`
 * (RFC 0003) into an AgentRegistry and can dispatch a manifest agent on the
 * existing core.dispatch/orchestrator loop, enforcing toolAllowlist (RFC 0002
 * §A14) and confidence escalation (§F).
 *
 * The inventory leg is exercised against the NORMATIVE `GET /v1/agents` surface
 * (RFC 0072 §A), so it runs black-box against any conformant host. The dispatch
 * leg uses the sample-extension seam and soft-skips on hosts that don't expose
 * it (full black-box dispatch is the sequenced executor-integration tier). Both
 * legs gate on `capabilities.agents.manifestRuntime.supported`.
 *
 * @see RFCS/0070-agent-manifest-runtime.md, RFCS/0072-agent-inventory-and-dispatch.md
 */

import { describe, it, expect } from 'vitest';
import { readManifestRuntimeCap, listManifestAgents, dispatchAgent } from '../lib/agentRuntime.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

describe('agent-manifest-runtime (RFC 0070)', () => {
  it('lists installed manifest agents and dispatches one with attributed events', async () => {
    const cap = await readManifestRuntimeCap();
    if (cap?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.supported !== true` returned early (unadvertised — soft-skip)'); // unadvertised — soft-skip

    // RFC 0074 §B — installScope governs how GET /v1/agents is scoped.
    const installScope = typeof cap.installScope === 'string' ? cap.installScope : 'host';
    expect(
      installScope === 'host' || installScope === 'tenant',
      req('openwop.it.agent-manifest-runtime.lists-installed-manifest-agents-and-dispatches-one-with-attributed-events', 'RFC 0074 §B', "agents.manifestRuntime.installScope (when present) MUST be 'host' or 'tenant'"),
    ).toBe(true);

    const inv = await listManifestAgents();
    if (inv === null) return softSkip('blocked', 'precondition not met — `inv === null` returned early (seam absent — soft-skip) (seam, prior step, or fixture unavailable)'); // seam absent — soft-skip
    const agents = inv.agents ?? [];
    expect(
      Array.isArray(agents),
      req('openwop.it.agent-manifest-runtime.lists-installed-manifest-agents-and-dispatches-one-with-attributed-events', 'RFC 0072 §A', 'GET /v1/agents MUST return an agents[] array'),
    ).toBe(true);

    if (installScope === 'host') {
      // Host-global inventory (RFC 0072 §A): a manifestRuntime host MUST surface ≥1 agent.
      expect(
        agents.length > 0,
        req('openwop.it.agent-manifest-runtime.lists-installed-manifest-agents-and-dispatches-one-with-attributed-events', 'RFC 0070 §A', 'a host-scoped manifestRuntime host MUST surface ≥1 installed manifest agent'),
      ).toBe(true);
    } else if (agents.length === 0) {
      // RFC 0074 §A + Unresolved Q3 — tenant-scoped: GET /v1/agents is the
      // authenticated principal's workspace set, which MAY be empty (the workspace
      // approved no agent packs) while manifestRuntime is advertised host-wide.
      // Empty is conformant; the cross-tenant no-disclosure 404 is covered by the
      // owner-triple isolation harness (RFC 0048/0059), not re-probed here. Nothing
      // to dispatch.
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `agents.length === 0` returned early (RFC 0074 §A + Unresolved Q3 — tenant-scoped: GET /v1/agents is the authenticated principal\'s workspace set, which MAY be e…');
    }

    const agentId = agents[0]?.agentId;
    if (typeof agentId !== 'string') return softSkip('blocked', 'precondition not met — `typeof agentId !== \'string\'` returned early (seam, prior step, or fixture unavailable)');

    // Opaque-payload dispatch (validateHandoff:false) so the assertion is
    // independent of the chosen agent's handoff schema.
    const res = await dispatchAgent(agentId, { task: {}, validateHandoff: false, availableTools: [] });
    if (res === null) return softSkip('blocked', 'precondition not met — `res === null` returned early (seam absent — soft-skip) (seam, prior step, or fixture unavailable)'); // seam absent — soft-skip
    expect(
      res.status === 'completed' || res.status === 'escalated',
      req('openwop.it.agent-manifest-runtime.lists-installed-manifest-agents-and-dispatches-one-with-attributed-events', 'RFC 0070', 'dispatch MUST resolve to a terminal status (completed | escalated)'),
    ).toBe(true);
    const types = (res.events ?? []).map((e) => e.type);
    expect(
      types.includes('agent.reasoned') && types.includes('agent.decided'),
      req('openwop.it.agent-manifest-runtime.lists-installed-manifest-agents-and-dispatches-one-with-attributed-events', 'RFC 0002 §A', 'dispatch MUST emit attributed agent.reasoned + agent.decided events'),
    ).toBe(true);
    expect(
      (res.events ?? []).every((e) => e.agentId === agentId),
      req('openwop.it.agent-manifest-runtime.lists-installed-manifest-agents-and-dispatches-one-with-attributed-events', 'RFC 0002 §A', 'every emitted agent.* event MUST carry the dispatched agentId'),
    ).toBe(true);
  });

  // NOTE: RFC 0002 §F confidence escalation is NOT asserted here. Forcing a
  // sub-threshold decision black-box would require a non-normative test hook
  // (the reference host's `simulateConfidence`); a conformant host need not
  // expose one, so asserting it here would wrongly fail conformant peers.
  // Escalation is covered against the reference host in
  // apps/workflow-engine/backend/typescript/test/{agents,agent-dispatch-route}.test.ts.
});
