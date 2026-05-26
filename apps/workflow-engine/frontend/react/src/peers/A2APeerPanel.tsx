/**
 * A2APeerPanel — placeholder for the A2A composition pairing with the
 * already-shipped `McpToolsPanel`.
 *
 * `spec/v1/a2a-integration.md` (FINAL v1.1, 2026-05-05) documents how
 * an openwop host can expose itself as an A2A agent (each Workflow →
 * an `AgentSkill`, each run → a `Task`) and how an openwop client can
 * dispatch into a remote A2A peer. But:
 *
 *   - the capability advertisement shape is still a candidate
 *     (`{supported: boolean, agentCardUrl: string}` is the leading
 *     candidate per `a2a-integration.md` §"Capability advertisement");
 *   - `capabilities.schema.json` does NOT yet define a `capabilities.a2a`
 *     block;
 *   - the reference host does NOT expose itself as an A2A agent and
 *     no `core.a2a.*` NodeModule is registered;
 *   - no non-steward host publishes an A2A AgentCard yet.
 *
 * So this panel does the only honest thing the reference app can do
 * today: tell the operator that A2A peer discovery is not yet
 * advertised, point at the spec, and point at the round-2 handoff
 * (`docs/myndhyve-round-2-handoff.md` §3) that asks MyndHyve to publish
 * an A2A peer endpoint — which would convert this panel from a
 * placeholder into a real peer browser.
 *
 * The MCP companion (`McpToolsPanel`) renders right above it on
 * `/capabilities`, so the operator sees the paired surface even
 * though one side is not yet implementable end-to-end.
 */

export function A2APeerPanel() {
  return (
    <div className="card">
      <h2>
        A2A peers{' '}
        <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
          (RFC 0007 + <code>spec/v1/a2a-integration.md</code>)
        </span>
      </h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Agent2Agent (A2A) composition lets an openwop host appear to remote
        callers as an A2A agent (each Workflow becomes an{' '}
        <code>AgentSkill</code>; each run becomes a <code>Task</code>) and
        lets workflows dispatch into remote A2A peers.{' '}
        <strong>Not advertised by this host.</strong>
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        A2A composition is documented as <em>stable</em> in{' '}
        <code>spec/v1/a2a-integration.md</code> but the capability
        advertisement shape is still a candidate (the leading shape is{' '}
        <code>{'{supported: true, agentCardUrl: "…"}'}</code>) and{' '}
        <code>capabilities.schema.json</code> does not yet define a{' '}
        <code>capabilities.a2a</code> block. The reference host does not
        expose itself as an A2A agent and no <code>core.a2a.*</code>{' '}
        NodeModule is registered, so a peer browser has nothing to
        enumerate against today.
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        Path forward — published as{' '}
        <code>docs/myndhyve-round-2-handoff.md</code> §3: a non-steward
        host publishing an A2A AgentCard (MyndHyve already references
        A2A peers from <code>vendor.myndhyve.agent-orchestration</code>{' '}
        and <code>vendor.myndhyve.ads-crew</code>) would converge a
        concrete <code>capabilities.a2a</code> shape and unblock this
        panel — at which point this placeholder becomes the actual peer
        browser (Agent Card fetch → list of Skills → "drop an{' '}
        <code>a2a.dispatch</code> node configured with this Skill" CTA).
      </p>
    </div>
  );
}
