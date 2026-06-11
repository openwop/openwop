# RFC 0023: Conformance Agent-Event Emitters

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0023                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Title**         | Conformance Agent-Event Emitters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Created**       | 2026-05-18                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Updated**       | 2026-05-18 (Active → Accepted: spec text complete; reference host (`examples/hosts/postgres`) registers `core.conformance.mock-agent`, advertises `capabilities.conformance.mockAgent: true`, and the in-tree host-internal smoke (`examples/hosts/postgres/test/mock-agent.test.ts`) passes against both affected conformance fixtures end-to-end via PGlite; conformance scenario `agentReasoningEvents.test.ts` per-event-type assertion fixed to match the canonical schema and merged into the in-tree suite. The earlier deferral on a future `@openwop/openwop-conformance` release was over-conservative — per `RFCs/README.md`, `Accepted` requires the conformance suite source tree to reflect the impl, not a published package release. Source-tree state reflects RFC 0023; downstream package republishes pick it up on their next release. Prior history: Draft → Active 2026-05-18 via bootstrap-phase steward waiver.) |
| **Affects**       | `RFCS/0002-agent-identity-and-reasoning-events.md`, `spec/v1/node-packs.md`, `schemas/core-conformance-mock-agent-config.schema.json` (NEW), `schemas/capabilities.schema.json`, `conformance/fixtures/conformance-agent-reasoning.json`, `conformance/fixtures/conformance-agent-low-confidence.json`, `conformance/fixtures.md`, `conformance/src/scenarios/agentReasoningEvents.test.ts`, `examples/hosts/postgres/src/server.ts`, `examples/hosts/postgres/src/agent-events.ts`, `examples/hosts/postgres/test/mock-agent.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Summary

RFC 0002 specified the wire shape of the five `agent.*` events but did not say **which `typeId`s are authorized to emit them**. As a result, conformance fixtures `conformance-agent-reasoning` and `conformance-agent-low-confidence` rely on undocumented `config.emitReasoningTrace` / `config.mockConfidence` hooks layered onto `core.identity` (a passthrough primitive whose declared contract is `inputs.payload → outputs.payload`). Hosts that implement `core.identity` strictly to spec — or that adopt the published `core.openwop.flow.noop` pack — cannot pass those fixtures, because nothing in the spec attaches the hooks to a specific typeId. This RFC closes the gap with three additive changes: (1) an Authorized-Emitters table in RFC 0002 §B naming which typeIds MAY emit each `agent.*` event; (2) a new conformance-only `core.conformance.mock-agent` typeId in `spec/v1/node-packs.md` that carries the test-time hooks on a clearly test-scoped surface; (3) retroactive documentation of the existing `mockConfidence` / `mockPendingDecision` config keys on `core.orchestrator.supervisor`, which the spec already names as a CP-1 emitter. No wire shapes change.

## Motivation

The gap surfaced when a downstream host (MyndHyve workflow-engine) deleted its local `identityNode.ts` to adopt the spec-canonical `core.openwop.flow.noop` pack. The two affected fixtures regressed silently — the host's previous `identityNode` had carried two hook blocks (lines 102-161 of the deleted file) that translated `config.emitReasoningTrace` / `config.mockConfidence` into `agent.reasoned` / `agent.decided` event emissions. Those blocks were the de-facto contract the conformance suite assumed, but nothing in the spec named `core.identity` (or its `core.openwop.flow.noop` superset) as an authorized emitter of those events. The host's two-hour debugging trail is the kind of cost RFCs exist to prevent.

Reading the repository tells the same story from the other direction:

- `spec/v1/node-packs.md:60` already names `core.orchestrator.supervisor` as the typeId that MUST emit `node.suspended { reason: 'low-confidence' }` when its `agent.decided.confidence` falls below the resolved threshold. That binding is normative.
- The Postgres reference host at `examples/hosts/postgres/src/server.ts:1085-1101` emits `agent.reasoned` / `agent.decided` from its built-in `core.llm.chat` node — _not_ from `core.identity`. That binding is folkloric: it lives in implementation code, never reaches the spec.
- The primary reference host at `apps/workflow-engine/backend/typescript/src/` has zero plumbing for `emitReasoningTrace` / `mockConfidence`. The openwop maintainer's own host cannot satisfy the affected fixtures via the hook path.
- The orchestrator counterpart fixture `conformance-orchestrator-low-confidence.json` already uses the same `mockConfidence: 0.5` hook, pinned to `core.orchestrator.supervisor`. The hook is documented nowhere in the spec, but the orchestrator scenario `orchestratorConservativePath.test.ts` depends on it.

The spec is solving this problem twice already (one row in `node-packs.md`, one ref-host code path) without ever naming the _general_ invariant: an emitter is a property of a typeId, not a free-floating capability. RFC 0002 §B catalogs the _shape_ of each `agent.*` event payload but is silent on _who_ emits.

This RFC makes that invariant normative on three fronts so the surface stops drifting between fixture, ref host, and downstream host.

## Proposal

### §A Authorized-Emitters table (additive amendment to RFC 0002 §B)

RFC 0002 §B describes payload shapes for `agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, and `agent.decided`. Append the following normative table:

| Event                | Authorized emitting `typeId`s                                                                                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.reasoned`     | LLM-block typeIds (`openwop.llm.*` portable-optional; `core.llm.*` if a host ships one) · `core.orchestrator.supervisor` (when supervisor reasoning is exposed) · `core.conformance.mock-agent` (conformance-only)                                                         |
| `agent.toolCalled`   | LLM-block typeIds · MCP tool-call typeIds (`core.mcp.toolCall` or `openwop.mcp.*`) · `core.conformance.mock-agent` (conformance-only)                                                                                                                                      |
| `agent.toolReturned` | Same set as `agent.toolCalled`; `causationId` MUST match the corresponding `agent.toolCalled.eventId` per RFC 0002 §B                                                                                                                                                      |
| `agent.handoff`      | `core.dispatch` (on `next-worker` decisions when the prior worker's `nodes[].agent` differs) · engine on `nodes[].agent` boundary transitions per `schemas/workflow-definition.schema.json` `nodes[].agent.description` · `core.conformance.mock-agent` (conformance-only) |
| `agent.decided`      | `core.orchestrator.supervisor` (per `spec/v1/node-packs.md:60`) · LLM-block typeIds · `core.conformance.mock-agent` (conformance-only)                                                                                                                                     |

Other typeIds (notably `core.identity`, `core.flow.noop`, and the published `core.openwop.flow.noop` pack) MUST NOT emit `agent.*` events. Hosts that conflate passthrough primitives with agent semantics are non-conformant.

Hosts MAY emit `agent.*` events from vendor-extension typeIds (`vendor.<host>.*`) without breaking conformance; this RFC normates only which **core** and **conformance** typeIds are authorized.

Capability gating remains unchanged: hosts that don't advertise `capabilities.agents.supported: true` MUST NOT emit any `agent.*` event (RFC 0002 §D), regardless of typeId.

### §B `core.conformance.mock-agent` typeId

New conformance-only typeId added to `spec/v1/node-packs.md`. Carries the test-time hooks that previously lived implicitly on `core.identity`:

```json
{
  "id": "<unique node id>",
  "typeId": "core.conformance.mock-agent",
  "config": {
    "mockReasoning": "boolean | { summary: string, trace?: string, tokenCount?: integer }",
    "mockToolCalls": "array<{ toolId: string, arguments: any, result?: any, error?: ErrorEnvelope, durationMs?: integer }>",
    "mockHandoff": "{ toAgentId: string, reason?: string, context?: any }",
    "mockDecision": "{ decision: any, confidence?: number, reasoning?: string }",
    "mockConfidence": "number 0..1 — shorthand for mockDecision.confidence when mockDecision is otherwise absent",
    "agentId": "string (optional; falls back to nodes[].agent.agentId)"
  },
  "agent": { "agentId": "...", "modelClass": "..." }
}
```

Emission contract (normative, applied in this order during the node's execution):

1. If `config.mockReasoning` is set, emit `agent.reasoned` with payload derived from the config value (boolean `true` → host-generated stub summary; object → projected onto the §B `agent.reasoned` shape).
2. For each entry in `config.mockToolCalls`, emit `agent.toolCalled` followed by `agent.toolReturned` paired by a host-minted `callId`. Order matches array order. `agent.toolReturned.causationId` MUST equal the paired `agent.toolCalled.eventId` per RFC 0002 §B.
3. If `config.mockHandoff` is set, emit `agent.handoff` with `from = nodes[].agent` (the current node's pin) and `to.agentId = config.mockHandoff.toAgentId`.
4. If `config.mockDecision` is set (or `config.mockConfidence` is set without `mockDecision`), emit `agent.decided` with the resolved decision payload. When `confidence < resolvedEscalationThreshold` (default `0.7`, per-run override `RunOptions.configurable.escalationThreshold`), the host MUST follow with `node.suspended { reason: 'low-confidence' }` per the existing CP-1 contract from `spec/v1/interrupt.md:278`.
5. The node's `outputs` are `{}`; `core.conformance.mock-agent` does not produce data outputs. Consumers of this typeId rely on the event stream, not on variable projection.

`agentId` resolution: the emitted events' `agentId` field uses (in order) `config.agentId`, then `nodes[].agent.agentId`, then a host-minted synthetic id (e.g., `host:mock-agent:<nodeId>`).

#### §B.1 Hard limits

- `core.conformance.mock-agent` is **conformance-only**. Hosts MUST refuse this typeId at workflow registration unless one of the following is true:
  - The workflow's `id` matches the conformance fixture prefix (e.g., `conformance-*`), OR
  - The host advertises an explicit opt-in (`capabilities.conformance.mockAgent: true`) AND the run is created against a tenant whose role permits conformance test workflows.
- Hosts MUST NOT register `core.conformance.mock-agent` for production tenants without the opt-in advertisement.
- The typeId's config schema MUST be validated against `schemas/core-conformance-mock-agent-config.schema.json` at workflow registration time. `additionalProperties: false` (zero tolerance for stray config keys — drift is the failure mode this RFC is closing).
- The reference hosts in `apps/workflow-engine` and `examples/hosts/postgres` MAY ship `core.conformance.mock-agent` registered by default for the suite's conformance-fixture prefix; production deployments of those hosts SHOULD remove it.

#### §B.2 Capability advertisement

Hosts that register `core.conformance.mock-agent` MUST advertise:

```json
{
  "capabilities": {
    "conformance": {
      "mockAgent": true
    }
  }
}
```

`capabilities.conformance.mockAgent` defaults to `false`. Conformance scenarios that exercise the mock-agent typeId (`agentReasoningEvents.test.ts`, `agentConfidenceEscalation.test.ts`) MUST gate on both `capabilities.agents.supported: true` (RFC 0002 §D) AND `capabilities.fixtures` advertisement for the specific fixture id. The `capabilities.conformance.mockAgent` flag exists for hosts that want to advertise the typeId is registered without binding to specific fixtures (e.g., for vendor-internal regression tests).

### §C Retroactive documentation of `core.orchestrator.supervisor` hooks

`conformance-orchestrator-low-confidence.json` already uses `config.mockConfidence` and `config.mockPendingDecision` on `core.orchestrator.supervisor`. Those keys are de-facto contract — `orchestratorConservativePath.test.ts` depends on them — but appear nowhere in the spec. Append to `spec/v1/node-packs.md`'s `core.orchestrator.supervisor` row a "Conformance hooks" subsection documenting:

- `config.mockConfidence: number (0..1)` — when set, the supervisor's emitted `agent.decided` uses this confidence instead of the live agent's. Conformance-only — host MAY refuse the key for production tenants.
- `config.mockPendingDecision: OrchestratorDecision` — when set, the supervisor emits this decision shape instead of running its live agent. Conformance-only with the same refusal semantics.

These keys remain optional on the supervisor's config schema. Production supervisors MUST NOT honor either key without the same `capabilities.conformance.mockAgent: true` opt-in advertisement from §B.2.

### §D Schema diff: `schemas/core-conformance-mock-agent-config.schema.json` (NEW)

New JSON Schema at `https://openwop.dev/spec/v1/core-conformance-mock-agent-config.schema.json`. `$schema: draft 2020-12`. `additionalProperties: false`. Fields:

```diff
+ {
+   "$schema": "https://json-schema.org/draft/2020-12/schema",
+   "$id": "https://openwop.dev/spec/v1/core-conformance-mock-agent-config.schema.json",
+   "title": "CoreConformanceMockAgentConfig",
+   "description": "Config shape for core.conformance.mock-agent (RFC 0023). Conformance-only typeId. Hosts MUST refuse non-conformance workflows that declare this typeId unless capabilities.conformance.mockAgent is advertised.",
+   "type": "object",
+   "additionalProperties": false,
+   "properties": {
+     "agentId":         { "type": "string", "minLength": 3, "description": "Optional override for the agentId field on emitted agent.* events; falls back to nodes[].agent.agentId, then to a host-minted synthetic id." },
+     "mockReasoning":   { "oneOf": [ { "type": "boolean" }, { "type": "object", "properties": { "summary": { "type": "string" }, "trace": { "type": "string" }, "tokenCount": { "type": "integer", "minimum": 0 } }, "required": ["summary"], "additionalProperties": false } ], "description": "Emit agent.reasoned. Boolean true → host-generated stub summary. Object → projected onto the §B agent.reasoned shape." },
+     "mockToolCalls":   { "type": "array", "items": { "type": "object", "properties": { "toolId": { "type": "string" }, "arguments": {}, "result": {}, "error": { "$ref": "error-envelope.schema.json" }, "durationMs": { "type": "integer", "minimum": 0 } }, "required": ["toolId"], "additionalProperties": false }, "description": "Emit agent.toolCalled + agent.toolReturned pairs in array order. Each pair shares a host-minted callId; the toolReturned event's causationId MUST equal the toolCalled event's eventId." },
+     "mockHandoff":     { "type": "object", "properties": { "toAgentId": { "type": "string", "minLength": 3 }, "reason": { "type": "string" }, "context": {} }, "required": ["toAgentId"], "additionalProperties": false, "description": "Emit agent.handoff with from = nodes[].agent and to.agentId = toAgentId." },
+     "mockDecision":    { "type": "object", "properties": { "decision": {}, "confidence": { "type": "number", "minimum": 0, "maximum": 1 }, "reasoning": { "type": "string" } }, "required": ["decision"], "additionalProperties": false, "description": "Emit agent.decided. When confidence is below the resolved escalation threshold, the host MUST follow with node.suspended { reason: 'low-confidence' } per spec/v1/interrupt.md:278." },
+     "mockConfidence":  { "type": "number", "minimum": 0, "maximum": 1, "description": "Shorthand for mockDecision.confidence when mockDecision is otherwise absent. When set, the host emits agent.decided with a synthetic decision (host-defined) carrying this confidence." }
+   }
+ }
```

Positive example:

```json
{
  "typeId": "core.conformance.mock-agent",
  "config": {
    "mockReasoning": { "summary": "Considered three options; chose A.", "tokenCount": 42 },
    "mockToolCalls": [
      { "toolId": "openwop.search.web", "arguments": { "q": "openwop" }, "result": ["hit-1", "hit-2"], "durationMs": 12 }
    ],
    "mockDecision": { "decision": { "next": "summarize" }, "confidence": 0.92 }
  }
}
```

Negative example (rejected at registration):

```json
{
  "typeId": "core.conformance.mock-agent",
  "config": {
    "mockConfidence": 1.7,
    "extra": "stray"
  }
}
```

Fails because `mockConfidence` is outside `[0, 1]` AND `additionalProperties: false` refuses `extra`.

### §E Fixture rewrites

Two fixtures move off `core.identity` and pin to the new typeId. The remaining two (`conformance-agent-identity`, `conformance-agent-pack-provenance`) stay on `core.identity` because they only exercise `nodes[].agent` → `RunSnapshot.agent` round-trip, which is already specced in `schemas/workflow-definition.schema.json` `nodes[].agent.description` and needs no hook contract.

`conformance-agent-reasoning.json`:

```diff
-      "typeId": "core.identity",
+      "typeId": "core.conformance.mock-agent",
       "name": "Reasoning Agent",
       "position": { "x": 0, "y": 0 },
       "config": {
-        "emitReasoningTrace": true
+        "mockReasoning": { "summary": "Decomposed query, decided to call a tool, then handed off." },
+        "mockToolCalls": [
+          { "toolId": "openwop.echo", "arguments": { "x": 1 }, "result": { "x": 1 }, "durationMs": 1 }
+        ],
+        "mockHandoff": { "toAgentId": "core.conformance.handoff-target", "reason": "demo-handoff" },
+        "mockDecision": { "decision": { "next": "done" }, "confidence": 1 }
       },
```

`conformance-agent-low-confidence.json`:

```diff
-      "typeId": "core.identity",
+      "typeId": "core.conformance.mock-agent",
       "name": "Low-Confidence Decider",
       "position": { "x": 0, "y": 0 },
       "config": {
-        "mockConfidence": 0.5
+        "mockDecision": { "decision": { "kind": "stub-low-conf" }, "confidence": 0.5 }
       },
```

`mockConfidence` shorthand is retained in §D for compatibility with hosts that already implement it on the orchestrator typeId; new fixtures SHOULD prefer the explicit `mockDecision.confidence` form for readability.

The two scenarios (`agentReasoningEvents.test.ts`, `agentConfidenceEscalation.test.ts`) need no behavioral changes — they already gate on `isAgentSupported()` + `isFixtureAdvertised(FIXTURE)` and assert on event shape, not on the underlying typeId.

## Compatibility

**Additive** per `COMPATIBILITY.md §2.1`. The specific clauses guaranteeing backward compatibility:

- The Authorized-Emitters table in §A is normative going forward, but **does not invalidate any pre-RFC-0023 conformance pass**. Hosts that previously passed `agent-reasoning` / `agent-low-confidence` via a non-conformant `core.identity` hook continue to pass — the fixture rewrite in §E is the surface that changes, not the host requirement. Hosts that bind `agent.*` emission to other typeIds (e.g., vendor-extension nodes) remain conformant.
- The `core.conformance.mock-agent` typeId is new and conformance-only. Hosts that don't register it have no required behavior change; the affected scenarios already skip via `isFixtureAdvertised()` gating.
- `capabilities.conformance.mockAgent` defaults to `false`. Hosts that omit it continue to advertise spec-conformant capability surfaces.
- The retroactive `core.orchestrator.supervisor` `mockConfidence` / `mockPendingDecision` documentation in §C describes existing implementation behavior; no schema or behavior change is required. The keys remain optional and conformance-only.
- The fixture rewrites in §E change `typeId` on two fixture files. Hosts that have hardcoded the `core.identity` `typeId` on those specific fixtures for advertisement-skipping (rather than reading `workflowId`) need to update; in practice the suite gates on `workflowId` advertisement via `capabilities.fixtures`, not on typeId.

No wire-shape changes. No event-payload changes. No `RunEventType` additions. No required-field changes.

## Conformance

Existing scenarios:

- `conformance/src/scenarios/agentReasoningEvents.test.ts` — already exercises `conformance-agent-reasoning`. No assertion changes needed; fixture rewrite is transparent.
- `conformance/src/scenarios/agentConfidenceEscalation.test.ts` — already exercises `conformance-agent-low-confidence`. Same — transparent.
- `conformance/src/scenarios/orchestratorConservativePath.test.ts` — exercises `conformance-orchestrator-low-confidence` against `core.orchestrator.supervisor`. The §C documentation of `mockConfidence` / `mockPendingDecision` retroactively normalizes that scenario's de-facto hook contract.
- `conformance/src/scenarios/agentMetadata.test.ts` — covers `conformance-agent-identity`. No change (fixture stays on `core.identity`).
- `conformance/src/scenarios/agentPackProvenance.test.ts` — covers `conformance-agent-pack-provenance`. No change.

New scenarios:

- None required for `Active` status. The 2 rewritten fixtures continue to be exercised by their existing scenarios. The Authorized-Emitters table in §A is normative spec text — its compliance is implicit in the existing scenarios' assertions that the events arrive from the correct surface.

Capability gating: scenarios that exercise `core.conformance.mock-agent` MUST gate on both `capabilities.agents.supported: true` AND `isFixtureAdvertised(fixtureId)`. The §B.2 `capabilities.conformance.mockAgent` flag is an additional optional advertisement and is NOT a required gate for any in-tree scenario.

## Alternatives considered

1. **Add hooks to `core.flow.noop` (the published `core.openwop.flow.noop` pack equivalent).** Rejected. Couples a control primitive with agent semantics — wrong namespace. Any host that ships `core.flow.noop` would inherit a test-only contract surface. The hooks need a typeId whose entire purpose is exposing them.
2. **Rewrite the affected fixtures to drive `core.orchestrator.supervisor` + `core.dispatch` directly.** Rejected as the _primary_ fix. Two reasons: (a) the orchestrator fixture has the same undocumented-hook problem (`mockConfidence` on the supervisor is also folkloric, fixed by §C in this RFC); (b) the unit-scale "minimal isolated case" quality of `agent-reasoning` / `agent-low-confidence` would be lost if every event-emission scenario had to construct a full supervisor + dispatch + child-worker rig. The `core.conformance.mock-agent` typeId keeps the unit-scale property while making the hook contract honest.
3. **Add a new `core.agent.emit-events` primitive in core.** Rejected. The typeId would have no production purpose; its config is entirely test-fixture instrumentation. Putting it in `core.*` blurs the production/test boundary. The `core.conformance.*` namespace is a clearer fence.
4. **Document the hooks as a vendor pack at `vendor.openwop.conformance.*`.** Rejected. Same drift the spec is trying to solve — every host would either ship the vendor pack or invent its own. The conformance suite is part of the spec corpus and should reference spec-canonical surfaces.
5. **Do nothing — let hosts continue to layer hooks onto `core.identity` privately.** Rejected. This is the status quo and is what cost a downstream host two hours of debugging when they swapped local identity for the published `core.openwop.flow.noop` pack. The hooks were load-bearing and undiscoverable.

## Unresolved questions

1. Should `agent.handoff` emission from `core.dispatch` on `next-worker` boundaries be lifted out of this RFC into the existing `core.dispatch` row in `node-packs.md` (a doc-only change), or stay inside the §A table for grouping? Current: keep in §A so the full emitter set is in one place.
2. Should the `capabilities.conformance.mockAgent` flag be folded into a broader `capabilities.conformance` object (anticipating future conformance-only typeIds), or stay as a single boolean? Current: single boolean. Future RFCs can promote to an object additively if needed.
3. Should `core.conformance.mock-agent` also support a `mockSuspend` config that bypasses the `agent.decided` → `node.suspended` chain (i.e., suspend directly)? Current: no — the chain is the contract under test; bypassing it would weaken what the fixture validates.
4. Is "conformance fixture prefix `conformance-*`" the right registration-gate heuristic from §B.1, or should the spec require an explicit per-workflow opt-in flag? Current: prefix. Open to feedback during the comment window.

## Implementation notes (non-normative)

Expected effort: ~½ day for the reference hosts.

- `apps/workflow-engine/backend/typescript/src/executor/nodeRegistry.ts` — register `core.conformance.mock-agent` typeId guarded by the conformance-fixture-prefix check.
- New `apps/workflow-engine/backend/typescript/src/executor/nodes/conformanceMockAgent.ts` — implements the §B emission contract. Reuses the existing event-log append surface; no new infrastructure.
- `examples/hosts/postgres/src/server.ts` — mirror the registration in the `core.*` switch (~30 LOC).
- Discovery `routes/discovery.ts` advertises `capabilities.conformance.mockAgent: true` when the typeId is registered.
- Sequencing: this RFC lands `Draft` → `Active` after the 7-day window per `RFCS/README.md`. Reference-host implementation lands separately under the `Acceptance criteria` checklist below; the RFC does not block on it.

The MyndHyve host's local `core.identity` impl (referenced in the gap report) can stop carrying agent-event hooks once it picks up the rewritten fixtures; their `core.openwop.flow.noop` adoption then completes cleanly. Their host already implements the spec-canonical `nodes[].agent` → `RunSnapshot.agent` projection that the two pin-only fixtures (`agent-identity`, `agent-pack-provenance`) exercise.

## Acceptance criteria

- [x] RFC text merged (this file).
- [x] `schemas/core-conformance-mock-agent-config.schema.json` published with `$id` under `https://openwop.dev/spec/v1/`.
- [x] `spec/v1/node-packs.md` updated: new `core.conformance.mock-agent` row + retroactive `mockConfidence`/`mockPendingDecision` documentation on `core.orchestrator.supervisor`.
- [x] RFC 0002 cross-link landed via `spec/v1/node-packs.md` §"Authorized emitters for `agent.*` events" pointing at RFC 0023 §A. (A direct edit to RFC 0002's prose §B was avoided because RFC 0002 is `Accepted` and per `RFCs/README.md` is treated as historical; the spec-canonical view lives in `node-packs.md`.)
- [x] `conformance/fixtures/conformance-agent-reasoning.json` + `conformance-agent-low-confidence.json` rewritten per §E.
- [x] `conformance/fixtures.md` catalog entries updated to reflect the typeId change.
- [x] CHANGELOG entry under `[1.1.2 — unreleased]`.
- [x] Reference host (`examples/hosts/postgres`) registers `core.conformance.mock-agent` per §B (executor case + `SUPPORTED_NODE_TYPES` + discovery advertisement of `capabilities.conformance.mockAgent: true`). Host-internal smoke (`examples/hosts/postgres/test/mock-agent.test.ts`) exercises both affected fixtures end-to-end via PGlite and verifies (a) full `agent.*` family emission on cue, (b) CP-1 `node.suspended { reason: 'low-confidence', agentId, threshold, observed }` + `waiting-approval` transition.
- [x] **Active → Accepted** flip (2026-05-18): conformance suite source tree reflects the impl — `agentReasoningEvents.test.ts` per-event-type assertion lands inside the suite; reference host smoke passes both scenarios end-to-end. Downstream consumers pick up the suite change on their next `@openwop/openwop-conformance` republish; the package-release cadence does not gate `Accepted` per `RFCs/README.md` (which gates on the suite source-tree state, not the npm publication).

## References

- RFC 0002 — Agent Identity and Reasoning Events (`RFCS/0002-agent-identity-and-reasoning-events.md`)
- RFC 0006 — Orchestrator (`RFCS/0006-orchestrator.md`)
- RFC 0007 — Dispatch (`RFCS/0007-dispatch.md`)
- `spec/v1/node-packs.md` §`core.orchestrator.supervisor` (canonical CP-1 emitter)
- `spec/v1/interrupt.md` §`kind: "low-confidence"` (suspend contract)
- `spec/v1/run-options.md` §`escalationThreshold` (threshold resolution)
- `schemas/workflow-definition.schema.json` `nodes[].agent.description` (AgentRef pin → RunSnapshot.agent projection)
- `examples/hosts/postgres/src/server.ts:1085-1101` (de-facto `agent.reasoned`/`agent.decided` emission on `core.llm.chat`)
- `conformance/fixtures/conformance-orchestrator-low-confidence.json` (de-facto `mockConfidence` hook on `core.orchestrator.supervisor`)
