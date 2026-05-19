# RFC 0024: Streaming `agent.reasoned` Deltas

| Field | Value |
|---|---|
| **RFC** | 0024 |
| **Title** | Streaming `agent.reasoned` Deltas |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-18 |
| **Updated** | 2026-05-19 (Active → Accepted — see [Status history](#status-history) below). |
| **Affects** | `schemas/run-event-payloads.schema.json`, `schemas/run-event.schema.json`, `schemas/capabilities.schema.json`, `spec/v1/capabilities.md` §`agents.reasoning`, `spec/v1/node-packs.md` §"Authorized emitters", `api/asyncapi.yaml`, `conformance/src/scenarios/`, `conformance/fixtures/`, `examples/hosts/postgres/`, `apps/workflow-engine/` |
| **Compatibility** | `additive` per `COMPATIBILITY.md §2.1` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Adds a new optional event type `agent.reasoning.delta` and a companion capability flag `capabilities.agents.reasoning.streaming` to let hosts surface a reasoning trace incrementally — one delta event per token chunk — while a model is still inside its `<think>...</think>` (or equivalent) block. This unlocks the "live thoughts" UX pioneered by Claude.ai extended thinking and ChatGPT o1, where users watch the model's reasoning unfold in real time inside a collapsible disclosure. The existing `agent.reasoned` event continues to fire once per closed block with the complete trace — old consumers that only read `agent.reasoned` keep working without change.

## Motivation

`agent.reasoned` (RFC 0002, finalized in `schemas/run-event-payloads.schema.json:557-567`) fires exactly ONCE per closed reasoning block with the full `reasoning: string`. For hosts emitting from reasoning models that produce long chain-of-thought traces (MiniMax-M2.7, DeepSeek-R1, qwen3-think, Anthropic extended thinking, OpenAI o1), this means the user sees **nothing** while the model reasons — and then a wall of text appears all at once when the block closes. Modern AI chat surfaces (Claude.ai, ChatGPT, Cursor) all stream reasoning live.

The workflow-engine sample's "Try it free" tile shipped Phase 1 of this UX in commit `46d2ac2` with a `Thoughts` collapsible disclosure backed by `agent.reasoned`. End-user feedback confirmed the missing piece: the disclosure shows a "Thinking…" pulse for tens of seconds with no content, then reveals everything at once. State-of-the-art parity requires incremental delivery.

This RFC is the additive surface that lets hosts opt in to streaming without breaking any v1.x consumer of `agent.reasoned`.

## Proposal

### New event type: `agent.reasoning.delta`

Added to `schemas/run-event-payloads.schema.json` as a sibling of `agentReasoned`:

```diff
+    "agentReasoningDelta": {
+      "type": "object",
+      "description": "Incremental reasoning chunk for live-streaming UX. Emitted while a reasoning block is still open, BEFORE the corresponding `agent.reasoned` finalization. Consumers concatenate `delta` strings in arrival order to reconstruct the in-progress trace. The final, authoritative content arrives in the closing `agent.reasoned` event (which carries the FULL `reasoning`, NOT just the last chunk).",
+      "required": ["agentId", "delta", "sequence"],
+      "properties": {
+        "agentId": { "type": "string", "minLength": 3, "maxLength": 256, "description": "AgentRef.agentId of the reasoning agent. Same value as the eventual closing `agent.reasoned`." },
+        "delta":    { "type": "string", "description": "New reasoning content since the previous delta event (or since the open of the current block, if this is the first delta)." },
+        "sequence": { "type": "integer", "minimum": 0, "description": "Monotonically-increasing index within the current reasoning block (resets per block). MUST start at 0 for the first delta in a block. Consumers MAY use this to detect dropped events." },
+        "verbosity": { "type": "string", "enum": ["summary", "full", "off"], "description": "Verbosity mode the host resolved for this block. SHOULD match the verbosity reported on the closing `agent.reasoned`." }
+      },
+      "additionalProperties": true
+    },
```

Registered as a `RunEventType` in the event-type enum + AsyncAPI channel.

### New capability flag: `capabilities.agents.reasoning.streaming`

Added to `schemas/capabilities.schema.json` under the existing `agents.reasoning` block:

```diff
   "reasoning": {
     "type": "object",
     "description": "Phase 1 reasoning-event verbosity configuration.",
     "properties": {
       "verbosity": { ... existing ... },
-      "tokenLimit": { ... existing ... }
+      "tokenLimit": { ... existing ... },
+      "streaming": {
+        "type": "boolean",
+        "default": false,
+        "description": "When `true`, the host MAY emit `agent.reasoning.delta` events while a reasoning block is still open, in addition to the final `agent.reasoned`. Hosts that omit / `false` this flag emit only the final `agent.reasoned`. Consumers MUST tolerate both modes — see `spec/v1/agents.md` §`agent.reasoning.delta`."
+      }
     },
     "additionalProperties": false
   }
```

### Normative semantics

When `capabilities.agents.reasoning.streaming: true`, a host emitting from a reasoning model:

1. **MUST** emit zero or more `agent.reasoning.delta` events for the in-progress trace as content becomes available.
2. **MUST** emit exactly one `agent.reasoned` event at block close, carrying the **complete** `reasoning` string (the concatenation of all preceding deltas plus any tail content held in the splitter). The closing event is authoritative.
3. **MUST** keep `agentId` consistent across all `agent.reasoning.delta` events AND the closing `agent.reasoned` event for a given block.
4. **MUST** assign `sequence: 0` to the first delta of each block and increment by 1 per delta. Sequences reset to 0 at each new block open.
5. **SHOULD** emit deltas as soon as content is available; **MUST NOT** buffer reasoning across SSE chunks unnecessarily.
6. **MAY** emit empty deltas (`delta: ""`) as keepalives; consumers **MUST** ignore them.

Consumers (clients / SDKs / FE renderers):

1. **MUST** tolerate both streaming and non-streaming hosts — the final `agent.reasoned` event is the single source of truth for reasoning content.
2. **SHOULD** render `agent.reasoning.delta` events progressively (e.g. typewriter UX in a Thoughts disclosure).
3. **MUST NOT** treat the concatenation of deltas as authoritative if it conflicts with the closing `agent.reasoned.reasoning`. In a conflict, the closing event wins (the host's redaction / truncation / verbosity-summary pipeline runs on the final content, not on individual deltas).

### Replay determinism

Per `spec/v1/replay.md`:

- On replay, hosts **MAY** collapse all streaming deltas into a single closing `agent.reasoned` event, OR replay the original delta sequence. Consumers **MUST** tolerate both — this is "consumer-tolerant determinism."
- The invocation-log cache (Layer-2 idempotency per `executor.ts:invocationLog`) caches the FULL completion of a node attempt. Replay reconstructs reasoning content from the cache; the choice of delta-or-collapsed reemission is host-policy.
- Sequence numbers on replay **MUST** be deterministic given the same attempt cache key but **MAY** differ in number/granularity from the original recording (e.g. faster replay can coalesce neighboring deltas).

### Examples

**Positive — streaming-aware host:**

```
agent.reasoning.delta  { agentId: "asst-1", sequence: 0, delta: "Let me think.", verbosity: "full" }
agent.reasoning.delta  { agentId: "asst-1", sequence: 1, delta: " First, the user is asking" }
agent.reasoning.delta  { agentId: "asst-1", sequence: 2, delta: " about openwop." }
agent.reasoned         { agentId: "asst-1", reasoning: "Let me think. First, the user is asking about openwop.", verbosity: "full" }
```

**Positive — non-streaming host (unchanged behavior):**

```
agent.reasoned  { agentId: "asst-1", reasoning: "Let me think. First, the user is asking about openwop.", verbosity: "full" }
```

**Negative — schema-rejected (missing required `sequence`):**

```
agent.reasoning.delta  { agentId: "asst-1", delta: "..." }
```

**Negative — semantically invalid (closing event content mismatches delta concatenation):**

The schema accepts this, but the spec contract gives the closing event precedence. Conformance scenarios assert the closing event's `reasoning` field is the authoritative final content.

## Compatibility

**Additive** per `COMPATIBILITY.md §2.1`:

- New event type `agent.reasoning.delta` — consumers MUST tolerate unknown event types per the existing v1 contract; consumers that DON'T subscribe to streaming see only the unchanged `agent.reasoned` event.
- New capability flag `capabilities.agents.reasoning.streaming` — defaults to `false`. Hosts that omit it advertise non-streaming behavior, which is the existing contract.
- Existing `agentReasoned` schema unchanged. Required fields stay required. Optional fields stay optional. The `additionalProperties: true` declared in Phase 1 of the multi-agent shift (a deliberate carve-out, see `schemas/run-event-payloads.schema.json:567`) is NOT extended by this RFC — `agent.reasoned` keeps its current shape.

No existing v1.x conformance pass is invalidated. Old hosts emitting only `agent.reasoned` remain conformant. Old consumers reading only `agent.reasoned` remain conformant.

## Conformance

### Existing scenarios covering this surface

- `conformance/src/scenarios/agentReasoningEvents.test.ts` — asserts `agent.reasoned` shape against the canonical schema. Unchanged by this RFC.
- `conformance/fixtures/conformance-agent-reasoning.json` — drives `agent.reasoned` emission via the `core.conformance.mock-agent` typeId. Unchanged.

### New scenarios

- `conformance/src/scenarios/agentReasoningStreaming.test.ts` (NEW) — gated on `capabilities.agents.reasoning.streaming: true`. Asserts:
  1. When a streaming host runs a reasoning workflow, it emits ≥1 `agent.reasoning.delta` event followed by exactly one `agent.reasoned`.
  2. The concatenation of all `delta` strings equals the closing `reasoning` field, OR the closing field is a host-applied transform (truncation under `verbosity: summary`, redaction under SR-1) of the concatenation. (Spec contract: closing event wins.)
  3. `sequence` values start at 0, increment by 1 per delta within a block, and reset across multiple blocks.
  4. `agentId` is consistent across all events in a single block.

- `conformance/fixtures/conformance-agent-reasoning-streaming.json` (NEW) — uses `core.conformance.mock-agent` with a `mockReasoningStreaming: true` flag that signals the mock-agent to emit deltas. Schema diff in `schemas/core-conformance-mock-agent-config.schema.json` is additive.

## Alternatives considered

### A1. Overload `agent.reasoned` with optional `delta` / `done` fields (architect review Issue 3, option B)

Add optional `delta: string`, `done: boolean`, `sequence: integer` to the existing `agentReasoned` payload. Streaming events have `delta` populated; the closing event has `done: true` and the full `reasoning`.

**Rejected because:** the `reasoning` field is currently REQUIRED. In streaming mode, intermediate events would have to carry an awkward value — either the running buffer (quadratic bandwidth), or just the delta (overloading the field's meaning), or empty (violates the field's intent). All three choices produce a worse contract than a separate event type.

### A2. New event type per phase of multi-agent shift (e.g. `agent.thought`, `agent.thinking`)

**Rejected:** would proliferate event types for a single semantic surface (reasoning). The "open block → deltas → close" pattern fits naturally as `agent.reasoning.delta` + `agent.reasoned` (the existing close event).

### A3. Out-of-band streaming (separate WebSocket / SSE channel for reasoning)

**Rejected:** breaks the unified event-log model. Existing consumers (webhooks, replay, audit log) wouldn't see reasoning at all. Replay determinism would be impossible.

### A4. Do nothing

**Rejected because:** the existing `agent.reasoned` once-per-block model is significantly behind the SOTA UX (Claude.ai extended thinking, ChatGPT o1). For hosts surfacing reasoning models in chat surfaces, the lack of streaming reasoning is a credibility gap visible in every long-reasoning turn.

## Unresolved questions

1. **Default `sequence: 0` start vs `sequence: 1` start.** Both are reasonable. Drafted as 0-based for consistency with `RunEventDoc.sequence` (also 0-based per `executor.ts:appendEvent`).
2. **MUST the delta `verbosity` field match across all events in a block?** Drafted as SHOULD. Strict MUST might be over-restrictive if a host resolves verbosity mid-block (edge case).
3. **Should hosts emit a final empty `agent.reasoning.delta { delta: "", sequence: N }` to signal "block about to close"?** Drafted as no — the closing `agent.reasoned` is the boundary marker. Adding an extra event is redundant.
4. **Should the existing `agent.reasoned` event get a `streamingFinalized: true` marker so consumers know whether deltas preceded it?** Drafted as no — consumers that care can detect this by checking whether they received any `agent.reasoning.delta` events for the same `agentId` in the current run. Adding the flag would require touching `agentReasoned`, which this RFC explicitly avoids.

## Implementation notes (non-normative)

- The reference workflow-engine sample (`apps/workflow-engine/`) implements both Phase 1 and Phase 2 paths in `bootstrap/nodes.ts` chat-responder. The `ThinkBlockSplitter` (`providers/thinkBlockSplitter.ts`) already produces incremental `reasoningDelta` callbacks; wiring them to `ctx.emit('agent.reasoning.delta', …)` is the BE side of Phase 2.
- The FE (`apps/workflow-engine/frontend/react/src/chat/hooks/useChatSession.ts`) already handles both event types — `agent.reasoning.delta` appends to the in-flight `thoughts.content`; `agent.reasoned` finalizes the buffer. Shipped in commit `46d2ac2`.
- Postgres reference host (`examples/hosts/postgres/`) does not yet implement streaming reasoning. Tracked as a follow-up.
- Cross-cut to impl plan: see `WORKFLOW-PROTOCOL-openwop-PLAN.md` "Cross-cuts" — CC entry for RFC 0024.

## Acceptance criteria

- [x] Spec text merged: paragraph in `spec/v1/capabilities.md` §`agents.reasoning` describing the `streaming` flag + default + opt-in semantics; new event-type addendum in `spec/v1/node-packs.md` §"Authorized emitters for `agent.*` events" listing `agent.reasoning.delta`. Landed in commit `fdf695a`.
- [x] Schema updated: `schemas/run-event-payloads.schema.json` adds `agentReasoningDelta`; `schemas/run-event.schema.json` adds the `RunEventType` enum value; `schemas/capabilities.schema.json` adds `agents.reasoning.streaming`. Landed in commit `455a3d4`.
- [x] AsyncAPI channel: covered transitively via `api/asyncapi.yaml`'s cross-file `$ref` to `run-event.schema.json` + `run-event-payloads.schema.json`. The new event type is picked up automatically through the discriminator map; no inline channel addition required.
- [x] At least one conformance scenario gated on `capabilities.agents.reasoning.streaming: true` — `conformance/src/scenarios/agentReasoningStreaming.test.ts` (5 assertions) + fixture `conformance/fixtures/conformance-agent-reasoning-streaming.json`. Landed in commit `b5b284d`.
- [x] CHANGELOG entry under `[Unreleased]`. Landed in commit `455a3d4`; Phase 4 + Active-flip cross-links in `fdf695a` and the present commit.
- [x] Reference hosts implement streaming emit AND pass the new scenario:
  - **Workflow-engine sample** (`apps/workflow-engine/backend/typescript/src/bootstrap/conformanceMockAgent.ts`) — emits `agent.reasoning.delta` + closing `agent.reasoned` per `streamChunks`; sample's `test/conformance-mock-agent.test.ts` includes a streaming + verbosity-off pair (19/19 pass). Sample BE advertises `capabilities.agents.reasoning.streaming: true` (commit `455a3d4`).
  - **Postgres** (`examples/hosts/postgres/src/server.ts`) — emits the same shape; `test/mock-agent.test.ts` third block verifies the contract end-to-end against pglite. Capability advertised via `REFERENCE_AGENTS_CAPABILITY.reasoning.streaming: true` (commit `08ac7bc`).
- [x] Additive RFC promotion under the bootstrap-phase steward waiver per `CONTRIBUTING.md` §"Bootstrap-phase notes". The 7-day RFC window cited in `RFCS/README.md` is the post-bootstrap process; bootstrap-phase additive RFCs with reference-impl verification (this RFC has BOTH ref hosts implementing AND a conformance scenario passing) graduate directly. Pattern matches RFC 0023 (Draft → Active 2026-05-18 same-day) and RFC 0022 (Draft → Active 2026-05-18 same-day).
- [x] **Active → Accepted** flip (2026-05-19): closed by criterion (b) — `@openwop/openwop-conformance@1.3.0` published to npm on 2026-05-19 carrying `conformance-agent-reasoning-streaming.json` + `agentReasoningStreaming.test.ts` + the `streamChunks` mock-agent extension. Downstream consumers now exercise the streaming-reasoning contract without local patches via `npx openwop-conformance --base-url <url> --api-key <k>`. Criterion (a) (external host advertisement evidence in `INTEROP-MATRIX.md`) was an OR condition and remains an adoption data-point, no longer load-bearing for the status flip.

## Status history

### Draft → Active (2026-05-18)

Promoted under the bootstrap-phase steward waiver per `CONTRIBUTING.md` §"Bootstrap-phase notes". Same path RFC 0022 and RFC 0023 used the same day.

Evidence at promotion:

- Spec prose merged: `spec/v1/capabilities.md` §`agents.reasoning` (streaming flag paragraph) + `spec/v1/node-packs.md` §"Authorized emitters" (RFC 0024 addendum).
- Schemas additive: `agentReasoningDelta` payload + `RunEventType` enum value + `capabilities.agents.reasoning.streaming` flag (default `false`).
- Conformance scenario `agentReasoningStreaming.test.ts` gated on `capabilities.agents.reasoning.streaming: true` — 5 assertions (event count, sequence monotonicity, agentId consistency, concatenation equality, ordering invariant).
- **Both** reference impls landed in commit `08ac7bc`:
  - Workflow-engine sample (`apps/workflow-engine/backend/typescript/src/bootstrap/conformanceMockAgent.ts`) — mock-agent `streamChunks` emission + schema-field-alignment cleanup (the pre-finalize prose-name bug fixed in the same commit).
  - Postgres reference host (`examples/hosts/postgres/src/server.ts`) — mock-agent `streamChunks` emission; in-tree pglite smoke (`test/mock-agent.test.ts` third block) verifies the contract end-to-end.

### SDK typed-helper rollout (2026-05-19)

All three reference SDKs (TS / Python / Go) gain typed payload types + type-guard predicates for the full `agent.*` event family, plus a high-level streaming-reasoning subscription helper on the TS SDK. Each SDK ships a schema-mirror test that catches drift between the hand-authored types and the canonical `schemas/run-event-payloads.schema.json` $defs. The §"Implementation notes" SDK-helper item is now resolved.

### Active → Accepted (2026-05-19)

Flipped on the publish of `@openwop/openwop-conformance@1.3.0` to npm (release commit `28e7579`, tag `openwop-conformance/v1.3.0`, npm provenance attestation attached by `npm publish --provenance`). Closes acceptance criterion (b): the conformance suite carrying `conformance-agent-reasoning-streaming.json` + `agentReasoningStreaming.test.ts` + the RFC 0023 `core.conformance.mock-agent` schema extended with `mockReasoning.streamChunks` is now installable by any downstream host without a repository checkout.

Verification chain:

- npm registry shows `@openwop/openwop-conformance@1.3.0` available alongside prior versions `[1.0.0, 1.1.0, 1.1.1, 1.2.0, 1.3.0]`.
- Tarball ships 296 files including the RFC 0024 fixture + scenario + the updated `schemas/core-conformance-mock-agent-config.schema.json` + `schemas/capabilities.schema.json` (verified pre-publish via `npm pack` dry-run + post-publish via `npm install @openwop/openwop-conformance@1.3.0` smoke).
- SLSA provenance attestation (attached by `npm publish --provenance`) pins the artifact to commit `28e7579` of the public openwop repo.
- `npx openwop-conformance --base-url <url> --api-key <key>` runs the streaming-reasoning scenario against any host. The scenario auto-skips when `capabilities.agents.reasoning.streaming` is absent or `false`, so existing hosts that haven't opted in are not destabilized by the bump.

Criterion (a) (external third-party host advertising `capabilities.agents.reasoning.streaming: true` in `INTEROP-MATRIX.md`) was an OR condition, not AND — it remains an adoption data point but no longer gates the RFC's status. When a third-party host advertises the flag, the row lands in `INTEROP-MATRIX.md` independently of this RFC.

## References

- **RFC 0002** — Agent identity and reasoning events. Defines `agent.reasoned`.
- **RFC 0023** — Conformance agent-event emitters. Defines authorized emitter typeIds.
- **`spec/v1/replay.md`** — Replay determinism contract for streaming events.
- **`spec/v1/capabilities.md`** — Capability advertisement + per-run override precedence.
- **`SECURITY/threat-model-secret-leakage.md`** SR-1 — Reasoning content goes through host-internal redaction before persistence (applies equally to deltas and the closing event).
- **`COMPATIBILITY.md §2.1`** — Additive-change criteria for v1.x.
- **Prior art:** Claude.ai extended thinking disclosure; ChatGPT o1 "thoughts" stream; Cursor inline action cards.
