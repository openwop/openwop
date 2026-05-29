# RFC 0077: Agent Run Lifecycle + Live Manifest Dispatch

| Field | Value |
|---|---|
| **RFC** | 0077 |
| **Title** | A normative `AgentManifest` → live-run mapping + an optional `capabilities.agents.liveRuntime` flag + an `agent.invocation.started` / `agent.invocation.completed` event bracket, so a manifest agent executes against live models/tools with one portable, observable event family across all three entry points (workflow node, run API, chat mention) |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-29 |
| **Updated** | 2026-05-29 — promoted `Draft → Active`. All five Unresolved questions resolved via MyndHyve T4 co-design (architect-validated against the RFC 0002 id model + `replay.md`); the wire surface landed atomically: `capabilities.agents.liveRuntime` (`capabilities.schema.json`), the `agentInvocationStarted`/`agentInvocationCompleted` payloads + `_typeIndex` (`run-event-payloads.schema.json`), the RunEventType enum +2 (`run-event.schema.json`), the normative §"Live manifest dispatch" prose (`multi-agent-execution.md`), and the always-on server-free `agent-live-runtime-shape.test.ts` conformance scenario. Comment window waived per `GOVERNANCE.md` lazy consensus. No new SECURITY invariant (§F reuses the existing floor guarantees). Behavioral conformance + reference-host advertisement deferred per §Conformance; `Active → Accepted` gated on a non-steward host (MyndHyve) advertising `liveRuntime` + emitting the invocation pair. |
| **Affects** | `schemas/capabilities.schema.json` (additive optional `agents.liveRuntime` sub-block) · `schemas/run-event-payloads.schema.json` (additive `agentInvocationStarted` + `agentInvocationCompleted` payloads + `_typeIndex` entries) · `schemas/run-event.schema.json` (RunEventType enum +2) · `spec/v1/multi-agent-execution.md` (new §"Live manifest dispatch") · `spec/v1/rest-endpoints.md` (`WorkflowNode.agent` + `POST /v1/runs` composition note) · `CHANGELOG.md` · `INTEROP-MATRIX.md` · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

RFC 0070 (`agents.manifestRuntime`) made pack-declared `AgentManifest`s loadable and dispatchable, and RFC 0072 pinned their inventory (`GET /v1/agents`) and dispatch path (`WorkflowNode.agent` + `POST /v1/runs`) to the normative run surface — but the dispatch *floor* both specify is deterministic (a fixed sample projection), so "the agent ran" does not yet mean "the agent ran a live model, with its real tools, validated its structured output, and escalated on low confidence." This RFC specifies the normative mapping from an `AgentManifest` to a **live agent run** — model/provider selection from `modelClass`, prompt resolution (RFC 0028/0029), tool-surface construction from `toolAllowlist` (RFC 0002 §A14 + RFC 0064), memory binding from `memoryShape` (RFC 0004/0057/0068), inbound/outbound schema validation from `handoff.*SchemaRef`, confidence escalation from `confidence.defaultThreshold` (RFC 0002 §F), and terminal result projection — gated behind an additive optional `capabilities.agents.liveRuntime`. It adds a content-free `agent.invocation.started` / `agent.invocation.completed` event **bracket** around the existing `agent.reasoned` / `agent.toolCalled` / `agent.toolReturned` / `agent.decided` family, and requires all three invocation entry points (workflow node, run API, chat mention) to emit that **one identical observable event family** so an agent is portable end-to-end, not just portable-on-paper. Everything is advertisement-gated and additive; hosts that advertise only `manifestRuntime` keep today's floor behavior unchanged.

## Motivation

`docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0077" frames the gap precisely: RFC 0070/0072 make manifest agents *discoverable and runnable in principle, but the sample dispatch floor is still deterministic and does not prove live model/tool execution quality.* Three concrete gaps remain after 0070/0072:

1. **No normative manifest→live-run mapping.** An `AgentManifest` declares `modelClass`, `systemPrompt`/`systemPromptRef`, `toolAllowlist`, `memoryShape`, `confidence`, and `handoff.*SchemaRef` (RFC 0003 + `agent-manifest.schema.json`), but the spec never says how a host turns those declarations into a running invocation: which of the eight steps are MUST, in what order, and what each one composes. Two independently-built hosts can both "support manifest agents" and produce divergent live behavior — one validates `returnSchemaRef`, one ignores it; one enforces `confidence.defaultThreshold`, one drops it — with no portable contract a client can rely on.
2. **No live-runtime capability signal.** `agents.manifestRuntime` advertises "I load `agents[]` and dispatch them on the orchestrator loop" — it deliberately permits the deterministic floor (RFC 0070 §D graceful-degradation ladder). There is no flag by which a host advertises "I execute these against live models and tools," so a client cannot tell a real agent run from a sample projection, and cannot pre-flight whether structured-output validation or confidence escalation will actually happen.
3. **Three entry points, no unified observable family.** An agent can be invoked three ways — as a `WorkflowNode.agent` step (RFC 0072 §B), as the root of a `POST /v1/runs` ("Run agent" directly), or via a chat `@agent` mention — but the spec does not require these to converge on one event family. Without that, a timeline/debugger/analytics consumer must special-case each entry point, and "the same agent" looks different depending on how it was launched.

The spec is the right place because manifest→live-run is a **cross-host interop + observability + safety** contract: an operator running a third-party agent needs to know its tool allowlist was enforced, its output was schema-validated, its low-confidence turn escalated rather than silently shipped, and its run is observable with the same event vocabulary regardless of entry point. The *algorithm* (which model backs `reasoning`, the prompt-assembly internals, the inference of confidence) stays a host choice; this RFC pins the mapping's MUST-steps, the capability gate, the two bracket events, and the safety carry-forward.

## Proposal

### §A — `capabilities.schema.json`: additive optional `agents.liveRuntime`

```diff
   "agents": {
     "type": "object",
     "properties": {
       "supported":         { "...": "unchanged" },
       "manifestRuntime":   { "...": "unchanged — RFC 0070 floor" },
       "memoryConsolidation": { "...": "unchanged — RFC 0068" },
       "commitments":       { "...": "unchanged — RFC 0068" },
+      "liveRuntime": {
+        "type": "object",
+        "description": "RFC 0077. The host executes manifest agents against LIVE models and tools (not the deterministic RFC 0070 sample floor) per the normative manifest→live-run mapping (§B), and emits the agent.invocation.started/completed bracket (§C). REQUIRES agents.manifestRuntime.supported: true — liveRuntime is a strict superset of the floor. Hosts that omit this block run the floor only; the conformance behavioral scenarios skip cleanly.",
+        "additionalProperties": false,
+        "required": ["supported"],
+        "properties": {
+          "supported": { "type": "boolean", "description": "REQUIRED when present. true ⇒ the host performs live manifest dispatch per §B and emits the §C events." },
+          "structuredOutput": { "type": "boolean", "description": "true ⇒ the host validates the terminal result against the agent's handoff.returnSchemaRef (§B step 6) and fails the run with a structured-output error on a non-conforming result rather than shipping it. Absent ⇒ false (the host runs live but does not enforce returnSchemaRef)." },
+          "confidenceEscalation": { "type": "boolean", "description": "true ⇒ the host honors confidence.defaultThreshold and triggers the RFC 0002 §F escalation contract when an agent.decided confidence falls below threshold (§B step 7). Absent ⇒ false." },
+          "sources": {
+            "type": "array",
+            "uniqueItems": true,
+            "items": { "type": "string", "enum": ["workflow-node", "run-api", "chat-mention"] },
+            "description": "Which invocation entry points the host exposes for live manifest dispatch (§D). `workflow-node`: an agent step inside a workflow run; `run-api`: an agent as the root of POST /v1/runs; `chat-mention`: a chat @agent invocation mapped onto the run surface. Absent ⇒ ['workflow-node'] (the RFC 0072 §B normative path). All listed sources MUST emit the identical §C/§E event family."
+          }
+        }
+      }
     },
     "additionalProperties": true
   }
```

### §B — Normative `AgentManifest` → live-run mapping (when `agents.liveRuntime.supported: true`)

A live manifest invocation MUST perform the following steps. Each composes an existing surface; this RFC pins which are MUST and their ordering, not the internal algorithm.

1. **Model/provider selection.** The host resolves the manifest's abstract `modelClass` (`reasoning` / `writing` / `coding` / `research` / `classification` / `general`) to a concrete model + provider it routes to. The mapping is host-defined; the host MUST keep it stable within a run for replay (the resolved model participates in the RFC 0041 LLM cache-key recipe). A run-time override MAY be supplied via `RunOptions.configurable.ai.*` (RFC 0002), which takes precedence over the `modelClass` default.
2. **Prompt resolution.** The host resolves the system prompt from `systemPrompt` | `systemPromptRef` (intrinsic, wins) with `promptOverrides` / `promptLibraryRef` fallback per the `prompts.md` resolution chain (RFC 0028/0029). The host MUST emit `agent.promptResolved` (existing event) recording the resolved PromptRef identifiers (content-free per RFC 0028).
3. **Tool-surface construction.** The host constructs the agent's callable tool surface by filtering against `toolAllowlist` (RFC 0002 §A14 `ToolPermissionService.filterTools` derivation pattern). A tool NOT in the allowlist MUST NOT be callable. When the host advertises `capabilities.toolHooks` (RFC 0064), per-tool authorization MUST fail closed (`forbidden`) and tool calls MUST emit `agent.toolCalled` / `agent.toolReturned`. Absence of `toolAllowlist` is host-policy (`[]` or host-default) per `agent-manifest.schema.json`.
4. **Memory binding.** The host binds the memory backends declared in `memoryShape` (RFC 0004 `MemoryAdapter`). When `memoryShape.longTerm: true`, the host MUST apply the SR-1 redaction harness on writes (RFC 0004 §SR-1) and MAY emit `memory.written` (RFC 0057) / participate in consolidation (RFC 0068). Memory reads are tenant-scoped (CTI-1).
5. **Reasoning + tool loop.** The host runs the agent turn(s): live model inference, tool calls through the §B-3 surface, emitting the existing `agent.reasoned` / `agent.reasoning.delta` / `agent.toolCalled` / `agent.toolReturned` events. When the host advertises `multiAgent.executionModel.version >= 5` the loop composes RFC 0061's stateful agent-loop (per-iteration snapshots + `maxLoopIterations` bound, RFC 0058); a `liveRuntime` host that does not advertise `version >= 5` MAY run a single-shot turn (see Unresolved #5).
6. **Handoff + structured-output validation.** When `handoff.taskSchemaRef` is present, the host MUST validate the inbound task payload against it before step 5 and reject a non-conforming task. When `handoff.returnSchemaRef` is present AND the host advertises `liveRuntime.structuredOutput: true`, the host MUST validate the terminal result against it and fail the run with a structured-output error rather than shipping a non-conforming result. Cross-agent handoffs emit `agent.handoff` (existing).
7. **Confidence escalation.** When the host advertises `liveRuntime.confidenceEscalation: true`, an `agent.decided` whose `confidence` falls below the effective threshold (`confidence.defaultThreshold`, or the run-resolved threshold per RFC 0002 §F, default 0.7) MUST trigger the RFC 0002 §F escalation contract (e.g., an escalation interrupt) rather than silently accepting the decision.
8. **Terminal result projection.** On termination the host projects the agent's terminal result onto the run's normal result surface (RFC 0002 run lifecycle). When the agent ran as a sub-run with `capabilities.agents.subRunAttestation` (RFC 0063), the output attestation composes unchanged. The host MUST emit `agent.invocation.completed` (§C) as the final agent-scoped event.

### §C — `agent.invocation.started` / `agent.invocation.completed` (additive, content-free)

A `liveRuntime` host MUST emit `agent.invocation.started` as the first agent-scoped event of a live invocation and `agent.invocation.completed` as the last, bracketing the existing family. Both are **content-free** (identifiers + metadata only — no prompt text, no result body, no secret-bearing payload; those live in the run's normal projection / SR-1-redacted surfaces). Both are **recorded-fact events** per [`replay.md`](../spec/v1/replay.md) §"Recorded-fact events" (the `memory.written`/RFC 0057 precedent): on replay against a checkpoint a host MUST re-emit them from the event log and MUST NOT regenerate their identifiers — notably `invocationId` — or timestamps. Because the payloads are content-free they introduce no non-deterministic body to diverge on.

```diff
+    "agentInvocationStarted": {
+      "type": "object",
+      "description": "RFC 0077. Emitted by a host advertising capabilities.agents.liveRuntime.supported: true as the FIRST agent-scoped event of a live manifest invocation. Content-free: identifiers + selection metadata only — prompt/task content is served by the run's normal projection, never on this event. Brackets the existing agent.* family with agent.invocation.completed.",
+      "required": ["invocationId", "agentId", "source"],
+      "properties": {
+        "invocationId":     { "type": "string", "minLength": 1, "description": "Host-issued, stable id correlating this agent invocation within its run. Distinct from runId — one run MAY dispatch several agent invocations (e.g., a workflow with multiple agent nodes, or a handoff chain)." },
+        "agentId":          { "type": "string", "minLength": 1, "description": "The manifest agentId being invoked (matches AgentManifest.agentId)." },
+        "source":           { "type": "string", "enum": ["workflow-node", "run-api", "chat-mention"], "description": "Which entry point launched the invocation (§D). All sources emit this identical family." },
+        "modelClass":       { "type": "string", "description": "MAY — the manifest's abstract modelClass (§B step 1)." },
+        "resolvedModel":    { "type": "string", "description": "MAY — the concrete model the host selected. A host MAY omit for deployment-privacy reasons (see Unresolved #1)." },
+        "resolvedProvider": { "type": "string", "description": "MAY — the concrete provider the host routed to (aligns with capabilities.aiProviders.supported / RFC 0067 authModes)." },
+        "toolSurfaceCount": { "type": "integer", "minimum": 0, "description": "MAY — number of tools in the constructed surface after toolAllowlist filtering (§B step 3). Content-free count, not the tool ids." },
+        "memoryBound":      { "type": "boolean", "description": "MAY — whether a long-term memory backend was bound (§B step 4)." }
+      },
+      "additionalProperties": true
+    },
+    "agentInvocationCompleted": {
+      "type": "object",
+      "description": "RFC 0077. Emitted by a host advertising capabilities.agents.liveRuntime.supported: true as the LAST agent-scoped event of a live manifest invocation. Content-free: identifiers + outcome metadata only — the result body is served by the run's normal projection. On replay re-read from the log, never regenerated.",
+      "required": ["invocationId", "agentId", "outcome"],
+      "properties": {
+        "invocationId":    { "type": "string", "minLength": 1, "description": "Correlates to the agent.invocation.started invocationId." },
+        "agentId":         { "type": "string", "minLength": 1, "description": "The manifest agentId." },
+        "outcome":         { "type": "string", "enum": ["completed", "handed-off", "escalated", "refused", "failed"], "description": "Terminal disposition. `completed`: produced a (schema-valid, if enforced) terminal result. `handed-off`: control passed to another agent (agent.handoff). `escalated`: confidence escalation fired (§B step 7). `refused`: the model refused (RFC 0032 refusal envelope). `failed`: an error terminated the invocation." },
+        "schemaValidated": { "type": "boolean", "description": "MAY — whether the terminal result was validated against handoff.returnSchemaRef (true only when liveRuntime.structuredOutput is advertised and a returnSchemaRef exists; §B step 6)." },
+        "confidence":      { "type": "number", "minimum": 0, "maximum": 1, "description": "MAY — the terminal agent.decided confidence, mirrored for convenience. Content-free scalar." },
+        "enqueuedRunId":   { "type": "string", "minLength": 1, "description": "MAY — id of a follow-on run the invocation enqueued (e.g., a sub-run), when applicable." }
+      },
+      "additionalProperties": true
+    },
```

`_typeIndex`: `"agent.invocation.started": { "$ref": "#/$defs/agentInvocationStarted" }`, `"agent.invocation.completed": { "$ref": "#/$defs/agentInvocationCompleted" }`. `run-event.schema.json` `$defs.RunEventType` enum gains `agent.invocation.started` + `agent.invocation.completed` additively.

### §D — Composition: workflow node, run API, chat mention

A live manifest agent is invocable three ways; all three MUST resolve to the same §B mapping and emit the identical §C/§E observable family:

1. **`workflow-node`** — a `WorkflowNode.agent` step (RFC 0072 §B). The agent invocation is a node execution; it inherits the run's replay/fork/observability envelope. This is the default `sources` value and the RFC 0072 normative path.
2. **`run-api`** — an agent as the root of `POST /v1/runs` (the "Run agent" surface). The run's root node IS the agent invocation; the run lifecycle (RFC 0002) wraps it. A host advertising `liveRuntime.sources` including `run-api` MUST accept a run whose root references a manifest `agentId`.
3. **`chat-mention`** — a chat `@agent` invocation. The chat surface is host UX (non-normative), but when a host advertises `chat-mention` it MUST map the mention onto the same run surface and emit the identical event family — a chat-launched agent is observably indistinguishable from a node- or API-launched one. (Whether `chat-mention` is normative at all is Unresolved #3.)

The contract: **one agent, one observable event family, three entry points.** A consumer subscribing to `agent.invocation.*` + the existing `agent.*` family sees a uniform invocation regardless of how it was launched.

### §E — Observable event family + ordering (normative)

For a single live invocation the agent-scoped events MUST appear in this order on the run's event log (modulo interleaved non-agent run events):

```
agent.invocation.started
  → agent.promptResolved
  → (agent.reasoning.delta* → agent.reasoned)        # one or more reasoning turns
  → (agent.toolCalled → agent.toolReturned)*          # zero or more tool calls
  → agent.decided                                     # one or more decisions
  → agent.handoff?                                    # optional, if control passes
agent.invocation.completed
```

`agent.invocation.started` MUST precede every other agent-scoped event of the invocation; `agent.invocation.completed` MUST follow them. The interior events are the existing family (RFC 0070/0037/0061) and are unchanged. This ordering is the testable surface for the always-on shape scenario's gated behavioral counterpart.

### §F — Safety carry-forward (normative)

Live execution MUST NOT relax any RFC 0072 §D mandatory floor guarantee:

1. **Tool allowlist enforcement** (§B step 3) is mandatory, not a sub-flag — a tool outside `toolAllowlist` MUST NOT be callable even under `liveRuntime`.
2. **Handoff inbound validation** (§B step 6, `taskSchemaRef`) is mandatory when the ref is present.
3. **Tenant scoping** (CTI-1) on memory and any enqueued run is mandatory.
4. **Live model output is untrusted** — the host MUST treat model output per the RFC 0031/0032 envelope contract (`contentTrust`, refusal handling); a refusal terminates the invocation with `outcome: "refused"`, never a silent substitution.
5. Per-tool authorization (when `toolHooks` advertised) **fails closed** (RFC 0049/0064).

`structuredOutput` and `confidenceEscalation` are advertised *quality* sub-flags (a host MAY run live without them), but the five guarantees above are unconditional under `liveRuntime`.

### Examples

**Positive.** A host advertising `agents.liveRuntime: { supported: true, structuredOutput: true, confidenceEscalation: true, sources: ["workflow-node", "run-api"] }` runs the `vendor.acme.review.code-reviewer` manifest as a `POST /v1/runs` root. The event log carries: `agent.invocation.started { invocationId: "inv-1", agentId: "vendor.acme.review.code-reviewer", source: "run-api", modelClass: "coding", toolSurfaceCount: 3 }` → `agent.promptResolved` → `agent.reasoned` → `agent.toolCalled`/`agent.toolReturned` (a tool from the allowlist) → `agent.decided { confidence: 0.91 }` → `agent.invocation.completed { invocationId: "inv-1", outcome: "completed", schemaValidated: true, confidence: 0.91 }`.

**Negative (non-conformant behavior).** The same host ships a terminal result that does not validate against the agent's `handoff.returnSchemaRef` but emits `agent.invocation.completed { outcome: "completed", schemaValidated: true }`. This is non-conformant by §B step 6 + §F — with `structuredOutput: true` advertised, a non-conforming result MUST fail the run (`outcome: "failed"`), not be reported as a validated completion.

**Negative (schema).** `agent.invocation.started` without `source` → fails validation (`source` required). `agent.invocation.completed { outcome: "done" }` → fails validation (`done` not in the outcome enum — the canonical value is `completed`).

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). `agents.liveRuntime` is a new optional sub-block on the existing `agents` object (`additionalProperties: true`); `agent.invocation.started` / `agent.invocation.completed` are two new additive RunEventTypes that existing consumers fold best-effort per `observability.md §"Forward-compat"`. No existing field, event, error code, or endpoint changes. A host advertising only `agents.manifestRuntime` is unaffected — it keeps the RFC 0070 floor and emits none of the §C events; the behavioral conformance scenarios gate on `liveRuntime.supported` and skip cleanly. No existing conformance pass is invalidated.

Forward-compatibility clauses:
- `liveRuntime` optional with no default emission by old hosts; consumers gate on its presence.
- The two new event types are additive; a consumer pinned to the old `RunEventType` enum tolerates unknown types per the fold-best-effort rule.
- Both events are content-free and re-read from the log on replay — no new replay-regeneration surface (the §B-1 model resolution participates in the existing RFC 0041 cache-key, not a new mechanism).
- `liveRuntime` requires `manifestRuntime` — it is a strict superset, never a replacement.

## Conformance

- **Existing coverage.** RFC 0070's `agent-manifest-runtime*.test.ts` + RFC 0072's `agent-inventory*.test.ts` cover the floor (load, inventory, dispatch path). None assert live mapping, the capability shape, or the invocation bracket.
- **New scenarios:**
  - **`agent-live-runtime-shape.test.ts`** (always-on, server-free): the `agents.liveRuntime` block validates; `agentInvocationStarted` + `agentInvocationCompleted` validate against their `$defs`; an `agent.invocation.started` missing `source` and an `agent.invocation.completed` with an out-of-enum `outcome` are rejected (negative). Drives the schemas, no host behavior.
  - **`agent-live-invocation-bracket.test.ts`** (gated on `agents.liveRuntime.supported`): a live invocation emits `agent.invocation.started` before any other agent-scoped event and `agent.invocation.completed` after them (§E ordering), with matching `invocationId`; the events are content-free (no prompt/result body). Soft-skips on absent advertisement / `404` seam.
  - **`agent-live-structured-output.test.ts`** (gated on `agents.liveRuntime.structuredOutput`): a result violating `handoff.returnSchemaRef` fails the run (`outcome: "failed"`), not a validated completion (§B step 6). Soft-skips when the sub-flag is unadvertised.
  - **`agent-live-allowlist-enforced.test.ts`** (gated on `agents.liveRuntime.supported`): a tool outside `toolAllowlist` is not callable (§F-1) — the per-tool application of the floor's mandatory allowlist guarantee.
- **Capability gating.** Per `conformance/coverage.md`: shape always-on; behavioral scenarios gated on `agents.liveRuntime.supported` (+ `structuredOutput` sub-flag where applicable). The behavioral assertions drive a documented host seam (`POST /v1/host/sample/agents/live-invoke`), staged per the RFC 0027 §G precedent — soft-skip on `404` until a reference host wires it.
- **Reference host.** Deferred to a follow-up milestone (this RFC lands at `Draft`). The shape + always-on schema validation ship; behavioral assertions soft-skip until the reference workflow-engine (which already dispatches four live providers) wires the live-invoke seam + advertises `liveRuntime`.
- **INTEROP-MATRIX.** A new "RFC 0077 live manifest dispatch" row is added (status: no host advertises `liveRuntime` yet — Draft).

## Alternatives considered

1. **A bespoke `POST /v1/agents/{agentId}:invoke` endpoint** instead of composing the run surface. Rejected — it would fork agent execution off the run lifecycle, losing replay/fork/observability and duplicating `POST /v1/runs`. RFC 0072 §B already pinned dispatch to the run surface deliberately; this RFC extends that, it does not re-litigate it. The `run-api` source IS `POST /v1/runs` with an agent root, not a new endpoint.
2. **Fold live behavior into `agents.manifestRuntime` (no new flag).** Rejected — `manifestRuntime` deliberately permits the deterministic floor (RFC 0070 §D ladder); overloading it would make "supports manifestRuntime" ambiguous between "runs the sample floor" and "runs live models," exactly the signal gap this RFC closes. A distinct superset flag keeps the floor advertisement honest.
3. **No invocation bracket events (reuse `agent.reasoned`/`agent.decided` only).** Rejected — without a start/complete bracket a consumer cannot delimit one invocation from the next within a multi-agent run (a handoff chain emits interleaved `agent.*` events from several agents), and cannot attribute a tool call or decision to a specific invocation. The `invocationId` bracket is the minimal correlation surface; it mirrors how RFC 0061 added an `iteration` counter rather than leaving turns unattributable.
4. **Do nothing.** Rejected — the gap analysis explicitly targets a real "Run agent" surface, agent detail pages, and chat `@agent` parity, all of which require a portable live-run contract. Without it, every host's "live agent" diverges and the 37 inventory agents stay sample-floor demonstrations rather than runnable products.

## Unresolved questions

All five were resolved 2026-05-29 via MyndHyve T4 co-design (architect-validated against the RFC 0002 id model + `replay.md`) and folded into the normative surface at `Draft → Active`:

1. **Resolved-model disclosure → ✅ OPTIONAL.** `resolvedModel` / `resolvedProvider` on `agent.invocation.started` are OPTIONAL (`MAY`), not RECOMMENDED. `modelClass`→concrete resolution may happen downstream (at the prompt-call node, with capability-gated fallback substitution), so a dispatch-time `started` event genuinely may not know the resolved model; `modelClass` is the always-present portable signal. A host MAY also omit for deployment-privacy. (Aligns with the 0067 UQ3 "no deployment-topology disclosure" posture.)
2. **`invocationId` vs `runId` → ✅ host-defined, unique-within-run, MAY be runId-derived.** `invocationId` is a payload correlation field (NOT a new envelope id-space — the `RunEvent` envelope keeps `eventId`/`causationId`); distinct from `runId` (one run MAY host several invocations) but a host MAY derive it from an existing per-node-execution receipt (`runId:nodeId:seq`) or a UUID, and a single-invocation run MAY reuse `runId`. **Replay safety:** the invocation pair is classified as recorded-fact events per `replay.md` §"Recorded-fact events" (§C) — re-read from the log, `invocationId` MUST NOT be regenerated. Mandating a new global id-space was the one adoption-cost MyndHyve flagged; this avoids it.
3. **`chat-mention` normativity → ✅ optional `sources[]` member.** The run surface it maps onto is normative; the `@mention` parse is host UX. `chat-mention` is never a mandatory `sources[]` enum member — a host with no chat surface advertises `["workflow-node", "run-api"]` and is fully compliant (§D).
4. **Single-shot vs loop floor → ✅ single-shot IS the floor.** A `liveRuntime` host MAY run a single-shot turn; the multi-turn loop composes ABOVE via the orchestrator + RFC 0061 (`version >= 5`) and MUST NOT be folded into the floor (loop infrastructure is not forced to advertise `liveRuntime`) (§B step 5).
5. **Terminal projection + attestation → ✅ `completed` is the agent-scoped terminal.** `agent.invocation.completed` is the last agent-scoped event and PRECEDES the run-scoped RFC 0063 `output.harvested` attestation when the agent runs as a sub-run (§B step 8 / §E).

## Implementation notes (non-normative)

- **Sequencing.** Composes RFC 0070 (`manifestRuntime` floor, Accepted) + RFC 0072 (inventory + dispatch path, the keystone — `GET /v1/agents` + `WorkflowNode.agent`) + RFC 0061 (stateful loop) + RFC 0002 (run lifecycle) + RFC 0028/0029 (prompt resolution) + RFC 0064 (tool hooks) + RFC 0057/0068 (memory). It is the live-execution layer on top of the inventory/dispatch keystone; `agents.liveRuntime` ⇒ `agents.manifestRuntime`.
- **Reference host.** The reference workflow-engine already dispatches four live providers (anthropic, openai, google, minimax); wiring `liveRuntime` is primarily a matter of advertising the flag + emitting the two bracket events around the existing agent execution path + threading `returnSchemaRef` validation. The 31 manifest agents become real "Run agent" targets once it advertises.
- **Demo impact** (out of scope, implementation-only): a real "Run agent" button creating a standard run; agent detail pages showing provider/model/tools/memory/schema/recent-runs; chat `@agent` mentions on the same run surface.
- **Expected effort:** M for the schema + prose + shape conformance (this lands the surface); L for a behavioral reference implementation (the live-invoke seam + structured-output validation + the four behavioral scenarios), deferred.

## Acceptance criteria

Checklist the maintainers will use to flip `Status` from `Active` to `Accepted`. The wire surface + always-on conformance + all five UQ resolutions landed at `Draft → Active` (2026-05-29); the remaining unchecked items are the `Active → Accepted` adoption gate.

- [x] `multi-agent-execution.md` §"Live manifest dispatch" documents the §B mapping + §C events + §D composition + §E ordering + §F safety carry-forward.
- [x] `capabilities.schema.json` carries `agents.liveRuntime`; `run-event-payloads.schema.json` carries `agentInvocationStarted` + `agentInvocationCompleted` + `_typeIndex`; `run-event.schema.json` RunEventType enum gains the two event names.
- [x] Conformance: `agent-live-runtime-shape.test.ts` (always-on, server-free) landed. The three gated behavioral scenarios (bracket ordering, structured-output enforcement, allowlist enforcement) are **deferred per §Conformance** — they gate on `capabilities.agents.liveRuntime.supported` + a live-invoke seam and soft-skip until a host wires it.
- [x] CHANGELOG entry + INTEROP-MATRIX row.
- [x] All five Unresolved questions resolved (recorded in `Updated:` + §Unresolved questions).
- [x] Reference-host implementation **explicitly deferred** per §Conformance (shape + always-on validation ship; behavioral assertions soft-skip until a host advertises `liveRuntime`).
- [ ] **(Accepted gate)** A non-steward host advertises `capabilities.agents.liveRuntime.supported: true` + emits the `agent.invocation.started`/`completed` bracket with the §E ordering; the gated behavioral scenarios pass against it (MyndHyve T4, queued behind §B).

## References

- [`RFCS/0070-agent-manifest-runtime.md`](./0070-agent-manifest-runtime.md) — the `agents.manifestRuntime` floor `liveRuntime` is a superset of.
- [`RFCS/0072-agent-inventory-and-dispatch.md`](./0072-agent-inventory-and-dispatch.md) — `GET /v1/agents` inventory + the `WorkflowNode.agent` + `POST /v1/runs` dispatch path this composes (the Wave-1 keystone).
- [`RFCS/0061-agent-loop-lifecycle.md`](./0061-agent-loop-lifecycle.md) — the stateful agent loop (`executionModel.version: 5`) step 5 composes.
- [`RFCS/0041-multi-agent-replay-under-nondeterminism.md`](./0041-multi-agent-replay-under-nondeterminism.md) — the LLM cache-key recipe the §B-1 model resolution participates in.
- [`RFCS/0064-tool-invocation-hooks-and-authorization.md`](./0064-tool-invocation-hooks-and-authorization.md) — per-tool authorization + tool-call events used in §B step 3.
- [`schemas/agent-manifest.schema.json`](../schemas/agent-manifest.schema.json) — the `AgentManifest` shape (`modelClass`, `toolAllowlist`, `memoryShape`, `confidence`, `handoff.*SchemaRef`) §B maps.
- [`spec/v1/multi-agent-execution.md`](../spec/v1/multi-agent-execution.md) — the agent execution model this extends.
- `docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0077" — the source recommendation.
