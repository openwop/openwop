# RFC 0002: Agent Identity and Reasoning Events

| Field | Value |
|---|---|
| **RFC** | 0002 |
| **Title** | Agent Identity and Reasoning Events |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-01 |
| **Updated** | 2026-05-11 (Active → Accepted: integration-seams audit closed via `docs/MULTI-AGENT-INTEGRATION-GAPS.md` archive; conformance scenarios pass against SQLite reference host) |
| **Affects** | `schemas/agent-manifest.schema.json`, `schemas/run-event.schema.json`, `schemas/run-event-payloads.schema.json`, `schemas/run-snapshot.schema.json`, `spec/v1/observability.md`, `spec/v1/replay.md`, `spec/v1/capabilities.md` |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

> **Amended (additive) 2026-05-25:** RFC 0064 (tool invocation hooks) extends the `agent.toolCalled` / `agent.toolReturned` events with optional `argsHash` / `principal` / `transport` (on `toolCalled`) + `status` / `durationMs` (on `toolReturned`) fields. The events are `additionalProperties: true`, `required` is unchanged, and `agentId` **stays required** (non-agent egress emits under the reserved synthetic agent id `core.system`). Non-breaking per `COMPATIBILITY.md` §2.1; no `eventLogSchemaVersion` bump.

## Summary

Introduce a protocol-level `AgentRef` wire shape and a closed set of five `agent.*` reasoning events (`agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, `agent.decided`). `AgentRef` identifies which agent took which turn inside a run; the five events expose agent decision-making to observers, debuggers, and replay without prescribing the agent runtime. The shape is additive to v1: pre-RFC-0002 runs simply omit the agent fields and continue to fold correctly.

## Motivation

The v1 baseline (`run-event.schema.json`, `run-snapshot.schema.json`) is agent-agnostic: a node's `started` and `completed` events carry no record of *which* agent the node delegated to. For single-agent or single-model deployments this is sufficient. As soon as a host adopts orchestrator-driven topologies (RFC 0006) or shared-context multi-agent patterns, several gaps appear:

1. **Provenance.** Audit and replay can't answer "which agent reasoned about this state?"
2. **Tool-call attribution.** When a node calls multiple tools across multiple sub-agents, observers can't disambiguate which agent's reasoning produced each call.
3. **Cross-host portability.** A2A composition (`spec/v1/a2a-integration.md`) needs a stable identity for the external agent; without an `AgentRef` shape, every host invents its own.
4. **Handoff observability.** Supervisor-worker handoffs are common in practice but invisible at the wire layer.

The fix lives in the protocol because hosts and clients on both ends of a run need to agree on the wire shape. Moving it to a host extension creates `openwop.*` vs `vendor.*` drift across implementations.

## Proposal

### §A AgentRef wire shape

`AgentRef` is the canonical identity record for an agent acting inside a run. Where present, it MUST conform to:

```json
{
  "agentId": "string (required) — manifest agentId or host-local id",
  "agentSharing": "isolated | shared | shared:%shared% (optional)",
  "memoryRef": "string (optional, opaque) — host-resolvable handle for cross-run memory",
  "modelClass": "reasoning | writing | coding | research | classification | general (optional)"
}
```

#### §A1 `agentId`

Globally unique within the issuing host. Two namespace tiers are normative:

- **Manifest agents.** Names follow `agent-manifest.schema.json` (`<tier>.<org>.<pack>.<agent>` for `vendor` / `community` / `private` / `local`, or `core.<name>` for spec-canonical agents).
- **Host-local agents.** `host:<id>` is reserved for agents instantiated by the host without a pack manifest (e.g., a built-in orchestrator). Hosts MUST NOT accept `host:` IDs in pack manifests.

Clients MUST treat `agentId` as opaque; only the issuing host resolves it to a manifest or runtime.

#### §A8 `agentSharing`

Three values, closed enum:

- `'isolated'` — the agent runs with a fresh context per node (default).
- `'shared'` — the agent's context is shared across all nodes in the run.
- `'shared:<groupId>'` — the agent's context is shared across nodes with the same `groupId` discriminator. `groupId` is opaque.

`shared:<groupId>` requires a `groupId` field on accompanying messages (see RFC 0005 §C).

#### §A14 Tool permission mapping

When `toolAllowlist` is declared on the manifest (`agent-manifest.schema.json`), hosts MUST filter the agent's tool surface to the allowlist before dispatch. The canonical filter receives the agent's `harnessRole` (host-defined) and returns the allowed tool set. Reference implementations expose this as `ToolPermissionService.filterTools(harnessRole)`; the protocol does not constrain the name, only the result.

### §F Confidence and escalation

Agents MAY emit a `confidence` field on `agent.decided` (range `[0.0, 1.0]`). Hosts compare confidence against a threshold to decide whether to escalate (e.g., raise an `'ask-user'` orchestrator decision, RFC 0006 §C):

- **Default threshold.** `0.7`.
- **Per-agent threshold.** `confidence.defaultThreshold` on the agent manifest overrides.
- **Per-run threshold.** `RunOptions.configurable.escalationThreshold` overrides both.

When `confidence < threshold`, the host MUST take exactly one action: emit an `'ask-user'` `OrchestratorDecision` (if a `runOrchestrator` is configured), surface a `'clarification'` interrupt (if not), or emit a `cap.breached` event with `kind: 'confidence-escalation-suppressed'` if the host has explicitly opted out of escalation via configuration.

### §G ConversationMessage shape (referenced by RFCs 0005 and 0007)

`ConversationMessage` is the append-only message record for multi-agent communication:

```json
{
  "messageId": "string (required, dedup key, deterministic for replay)",
  "from": "string (agentId or 'user')",
  "to": "string (optional addressee)",
  "groupId": "string (optional, for shared-agent scoping)",
  "content": "any JSON value",
  "ts": "integer (ms epoch)"
}
```

Messages fold through the `applyMessage` reducer (channel kind: `messages`). Replays MUST be deterministic: re-folding the same `messageId` twice MUST be a no-op.

`ConversationTurn` (RFC 0005 §C) is a structural superset that adds `role`, `turnIndex`, and an optional `agent` reference.

### §B Reasoning events

Five new `RunEventType` values. All are additive (no v1 reader changes required — readers fold unknown types best-effort per the run-event schema).

#### `agent.reasoned`

Emitted when an agent produces a private reasoning trace before acting. Payload:

```json
{
  "agentId": "string",
  "reasoning": "string — the trace itself (summary or full per resolved verbosity)",
  "verbosity": "summary | full | off (optional)"
}
```

Hosts MUST redact secret material from `reasoning` before persistence per SR-1 in `SECURITY/threat-model-secret-leakage.md`. The trace's length is bounded by `capabilities.agents.reasoning.tokenLimit` (default 512 tokens) when the resolved verbosity is `summary`. RFC 0024 (separate proposal) adds the optional `agent.reasoning.delta` sibling event for live-streaming UX while a reasoning block is still open; consumers MAY ignore deltas and read only the closing `agent.reasoned` for the authoritative content.

> **Schema-evolution note (2026-05-18).** This RFC's prose originally proposed `{summary, trace, tokenCount}` payload fields. The schema finalized in `schemas/run-event-payloads.schema.json` (`$defs.agentReasoned`) uses `{reasoning, verbosity}` — a tighter, single-field shape that lets a per-run override (`RunOptions.configurable.reasoningVerbosity`) choose summary vs full vs off at dispatch time. The schema is the normative wire contract; this section was updated to match. Hosts implementing against the original prose MUST migrate to the schema's field names.

#### `agent.toolCalled`

Emitted before a tool invocation. Payload:

```json
{
  "agentId": "string",
  "toolId": "string — '<scope>:<tool-id>'",
  "callId": "string — caller-correlated id",
  "arguments": "any JSON value"
}
```

#### `agent.toolReturned`

Emitted after a tool invocation completes. `causationId` MUST equal the `eventId` of the corresponding `agent.toolCalled` — except for a proactive `status: 'forbidden'` / `'rate_limited'` row emitted at agent-loop start before any model call (RFC 0064 §C "forbidden-at-load"), which has no paired `agent.toolCalled` and MAY omit `causationId`. Payload:

```json
{
  "agentId": "string",
  "toolId": "string",
  "callId": "string — matches the .toolCalled callId",
  "result": "any JSON value (optional, present on success)",
  "error": "ErrorEnvelope (optional, present on failure)",
  "durationMs": "integer (optional)"
}
```

#### `agent.handoff`

Emitted when one agent transfers control to another within the same node. Payload:

```json
{
  "from": "AgentRef",
  "to": "AgentRef",
  "reason": "string (optional, free-form)",
  "context": "any JSON value (optional, the handoff payload)"
}
```

#### `agent.decided`

Emitted when an agent reaches an actionable decision. Distinct from `runOrchestrator.decided` (RFC 0006), which is supervisor-level. Payload:

```json
{
  "agentId": "string",
  "decision": "any JSON value (host-defined)",
  "confidence": "number 0..1 (optional)",
  "reasoning": "string (optional)"
}
```

When `confidence` is present, hosts MUST apply the §F escalation rules.

### §C `AgentRef` placement on existing event payloads

Three existing payloads gain an optional `agent: AgentRef` field:

- `node.started.payload.agent` — the agent the node delegated to.
- `node.completed.payload.agent` — same, for symmetry.
- `RunSnapshot.agent` — the run's primary agent (when a single agent owns the run).

All three fields are optional; pre-RFC-0002 events omit them and remain valid against v1 schema.

### §D Capability advertisement

Hosts advertise agent-event support via `/.well-known/openwop`:

```json
{
  "capabilities": {
    "agents": {
      "reasoningEvents": true,
      "toolEvents": true,
      "handoffEvents": true,
      "decisionEvents": true,
      "memoryBackends": ["scratchpad", "conversation", "longTerm"]
    }
  }
}
```

Clients that consume agent events SHOULD pre-flight via the discovery handshake. Hosts that do not advertise the relevant capability MUST NOT emit the corresponding event type.

## Compatibility

**Additive.** Specifically:

- All five new event types extend the `RunEventType` union; readers MUST fold unknowns best-effort, so pre-RFC consumers continue to project state correctly.
- All `agent` fields on existing payloads are optional with no default; absence preserves pre-RFC-0002 behavior.
- The `AgentRef` shape does not modify any existing required field.
- Capability advertisement is opt-in; hosts that omit `capabilities.agents.*` are still v1-conformant.

No migration tooling is required.

## Conformance

Existing scenarios that exercise the surface today:

- `conformance/src/scenarios/identity-passthrough.test.ts` — verifies `agent` field round-trips intact.
- `conformance/src/scenarios/multi-node-ordering.test.ts` — verifies reasoning event ordering against `node.*` envelopes.
- `conformance/src/scenarios/replayDeterminism.test.ts` — verifies replay reproduces `agent.reasoned` and `agent.decided` payloads bit-identically (when the host claims `replay.cached`).

New scenarios required to upgrade from `Active` to `Accepted`:

- `agent-reasoning-events.test.ts` — exercise all five new types against a reference host that advertises `capabilities.agents.*`.
- `agent-confidence-escalation.test.ts` — verify the §F escalation contract triggers at the configured threshold.

Both new scenarios MUST gate on capability advertisement (per `capabilities-change-detection.md` §"Optional capability discovery").

## Alternatives considered

1. **Embed reasoning in `node.completed.payload`.** Rejected: opacity. A single node may call many tools across many sub-agents; collapsing them all into the node's completion payload loses provenance and breaks per-tool causation chains.
2. **Treat reasoning as a host extension (`vendor.openwop.agent.*`).** Rejected: every multi-agent host would invent the same shape under a different prefix, fracturing tooling.
3. **Borrow LangGraph's `messages` reducer wholesale.** Partially adopted (§G + RFC 0005). Rejected as a sole mechanism because `messages` is conversation-oriented; reasoning, tool calls, and handoffs need distinct event types for selective subscription via `stream-modes.md` `updates` mode.
4. **Use A2A `AgentCard` directly.** Rejected: A2A's `AgentCard` is a *discovery* shape (capabilities, transport), not a *per-event provenance* shape. The two surfaces compose (`AgentRef` references manifest agents that A2A peers can resolve to `AgentCard`s) but are not the same record.

## Unresolved questions

1. Should `agent.toolReturned.error` reuse `ErrorEnvelope` (current proposal) or a tool-specific variant? Decision: ErrorEnvelope wins for consistency unless tool ecosystems push back.
2. Should `agent.reasoned.trace` have a normative size cap, or leave that to host policy? Current default: host policy.
3. Should `confidence` calibration be a closed enum (`low`/`medium`/`high`) instead of `[0.0, 1.0]`? Closed enum is more portable but loses scoring granularity. Current: numeric range.

## Implementation notes (non-normative)

The reference TypeScript host implements `AgentRef` resolution via a small `AgentRegistry` populated at workflow registration time. The registry maps `agentId` → `(AgentManifest | HostLocalAgent)`. Hosts MAY skip the registry and resolve inline at dispatch time; the contract is the wire shape, not the resolver.

Replay determinism: `agent.reasoned.trace` and `agent.toolCalled.arguments` MUST be cached at first execution and replayed bit-identically; otherwise replay diverges. See `spec/v1/replay.md` §"Determinism with non-deterministic agents".

## Acceptance criteria

- [x] Spec text merged (this file).
- [x] Schema updated (`run-event.schema.json` `RunEventType` enum includes all five `agent.*` types as of 2026-05-08).
- [x] `agent-manifest.schema.json` published.
- [ ] At least one conformance scenario covering reasoning-event round-trip.
- [ ] At least one conformance scenario covering §F escalation.
- [ ] CHANGELOG entry under `v1.0`.
- [ ] Reference host emits all five event types when `capabilities.agents.*` is advertised.

## References

- `schemas/agent-manifest.schema.json`
- `schemas/run-event.schema.json` (RunEventType enum)
- `schemas/conversation-event.schema.json` (consumes §G ConversationMessage shape)
- `schemas/conversation-turn.schema.json` (structural superset of §G)
- `schemas/orchestrator-decision.schema.json` (RFC 0006 — consumes §F escalation contract)
- `spec/v1/a2a-integration.md` (composition with A2A `AgentCard`)
- RFC 0003 (Agent Packs), RFC 0004 (Memory Layer), RFC 0005 (Conversation), RFC 0006 (Orchestrator), RFC 0007 (Dispatch)
