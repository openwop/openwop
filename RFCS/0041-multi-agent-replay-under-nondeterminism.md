# RFC 0041: Multi-agent Phase 4 — replay determinism under nondeterministic models

| Field | Value |
|---|---|
| **RFC** | 0041 |
| **Title** | Multi-agent execution model Phase 4: LLM cache-key recipe normation + envelope-refusal recovery in replay context + determinism vs idempotency contract |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-22 |
| **Updated** | 2026-05-22 |
| **Affects** | `spec/v1/replay.md` (extends with §"Replay under non-deterministic agents (Phase 4, normative)") · `spec/v1/multi-agent-execution.md` (extends with §"Phase 4 replay determinism") · `schemas/capabilities.schema.json` (bumps `multiAgent.executionModel.version` ceiling effective range to include `4`; adds optional `replayDeterminism` block) · 3 new conformance scenarios (replacing `replay-llm-cache-key.test.ts` placeholders) · `SECURITY/invariants.yaml` (adds `replay-llm-cache-key-portable` SECURITY invariant) · `INTEROP-MATRIX.md` · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Closes the final 3 open spec gaps from [RFC 0037](./0037-multi-agent-execution-model.md) §"Open spec gaps":

- **MAE-7** (`LLM cache-key recipe`): normate the recipe `spec/v1/replay.md` §"LLM cache-key recipe" already documents informationally. Today `replay-llm-cache-key.test.ts` is shape-only (3 `it.todo()` placeholders per `docs/KNOWN-LIMITS.md:18`); Phase 4 graduates them to behavioral assertions.
- **MAE-8** (`envelope-refusal recovery in replay`): define what happens when the original run got a valid envelope from the model but the replay gets a refusal (or vice-versa).
- **MAE-9** (`determinism vs idempotency`): formalize that replay produces the same OBSERVABLE OUTPUT SEQUENCE even when underlying tool calls differ — the user-visible state at each event-log index is bit-equivalent across replays even if a tool call's bytes-on-the-wire differ.

Bumps `multiAgent.executionModel.version` from `3` (Phase 3, RFC 0040) to `4` (Phase 4, this RFC) when implemented. The capability-version ceiling at `4` was already reserved in the schema's `version` enum range.

## Motivation

OpenWOP's replay contract works for deterministic node executors (existing `replay.md` machinery). For nondeterministic executors — LLM calls being the load-bearing case — replay determinism depends on cache-key portability + a clear contract for what happens when the model's response shifts between runs.

The external standards-readiness review of 2026-05-21 flagged "replay under nondeterministic model behavior" as part of finding (3). RFC 0037 Phase 1 + RFC 0039 Phase 2 + RFC 0040 Phase 3 close the per-host and cross-host portability halves; this RFC closes the temporal-portability half (same workflow definition, two runs at different times → same observable output sequence on replay).

This is the LAST of the four phases from RFC 0037's roadmap. After Phase 4 Accepts, the multi-agent execution model is closed.

## Proposal — Phased (still substantial)

### §A — LLM cache-key recipe normation (MAE-7 closure)

`spec/v1/replay.md` §"LLM cache-key recipe" currently documents the recipe as INFORMATIVE. Phase 4 promotes it to NORMATIVE when `multiAgent.executionModel.version >= 4`:

> Hosts MUST compute the cache key for an LLM call as:
>
> ```
> SHA-256(canonicalize({
>   model: <stable-model-identifier>,
>   provider: <provider-identifier>,
>   messages: <canonical-message-array>,
>   tools: <canonical-tool-array-or-empty>,
>   temperature: <number-or-null>,
>   responseSchema: <canonical-schema-or-null>
> }))
> ```
>
> where `canonicalize(...)` is JSON canonicalization per RFC 8785 (JCS). The key is deterministic across hosts that follow the recipe: given the same model + provider + messages + tools + temperature + schema, two independent hosts produce the same key. Cached responses are keyed by this hash; on replay, a host that has the same key in cache MUST return the cached response (subject to the §B refusal-recovery contract below).

### §B — Envelope-refusal recovery in replay (MAE-8 closure)

When the original run got a valid envelope from the model but the replay gets a refusal (e.g., the model's safety-filter has tightened since the original run):

> Hosts that advertise `multiAgent.executionModel.version >= 4` MUST surface this via a new `replay.divergedAtRefusal` event AND fail the replay with `error.code: "replay_diverged_at_refusal"` (NEW error code per `spec/v1/rest-endpoints.md` §"Common error codes"). The replay MUST NOT silently substitute the refusal for the original envelope — operators MUST be informed that the workflow's behavior would diverge under current model state.

The inverse case (original got a refusal, replay gets a valid envelope) follows the same contract: emit `replay.divergedAtRefusal` and fail. Both directions of divergence are observable; silent acceptance would hide a meaningful state shift.

### §C — Determinism vs idempotency contract (MAE-9 closure)

Add to `spec/v1/replay.md`:

> The replay contract is OBSERVABLE-OUTPUT-SEQUENCE determinism, NOT bit-equivalent execution determinism. Concretely:
>
> - The sequence of `RunEventDoc` records appended to the event log at indices `[0, forkAtEventLogIdx]` MUST be byte-equivalent between original and replay (modulo per-region clock fields per RFC 0036 §E).
> - The variables, channel state, and `RunSnapshot.status` at each event-log index MUST be byte-equivalent.
> - The bytes-on-the-wire of underlying tool/LLM calls MAY differ (e.g., a tool call with non-deterministic remote state, an LLM call against a model whose weights shifted) AS LONG AS the resulting observable state at each index is byte-equivalent.
>
> Hosts MUST NOT cache observable state ONLY at the tool-call boundary — they MUST cache the observable result (return value, side-effects on workflow state, emitted events) so a replay reproduces the observable sequence even when the underlying call differs.

### §D — Capability advertisement

```diff
   "multiAgent": {
     "executionModel": {
       ...,
+      "replayDeterminism": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": ["supported"],
+        "properties": {
+          "supported": { "type": "boolean" },
+          "llmCacheKeyRecipe": {
+            "type": "string",
+            "anyOf": [
+              { "const": "spec-rfc-0041" },
+              { "pattern": "^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$" }
+            ],
+            "description": "The cache-key recipe the host honors. `spec-rfc-0041` = this RFC §A. Vendor-specific recipes use the canonical host-extension namespace string matching `^x-host-<host>-<key>$` per `spec/v1/host-extensions.md` §'Canonical prefixes'; the matching algorithm MUST be documented at the host's discovery doc."
+          },
+          "refusalDivergenceEmission": {
+            "type": "boolean",
+            "description": "Host emits replay.divergedAtRefusal events + fails with replay_diverged_at_refusal per §B."
+          }
+        }
+      }
     }
   }
```

Hosts advertising `multiAgent.executionModel.version: 4` MUST also advertise `replayDeterminism.supported: true` + name the recipe + commit to refusal-divergence emission.

### §E — SECURITY invariant: `replay-llm-cache-key-portable`

`SECURITY/invariants.yaml` gains a new protocol-tier invariant:

```yaml
- id: replay-llm-cache-key-portable
  tier: protocol
  severity: high
  threat_model: SECURITY/threat-model-secret-leakage.md
  tests:
    - conformance/src/scenarios/replay-llm-cache-key-portable.test.ts
  note: |
    RFC 0041 §A. The LLM cache-key recipe MUST be byte-deterministic
    across independent hosts that follow the recipe. Conformance asserts
    two hosts (or two seq-N test runs against one host) produce the same
    key for the same canonical input. Lets the cross-host replay contract
    survive host migration + multi-region deployment.
```

## Compatibility

**Additive.** Hosts at version 1-3 continue unchanged. Hosts upgrading to version 4:

- Adopt the normative recipe in §A (compatible with hosts that already implement the informative recipe; non-conformant for hosts that use an idiosyncratic key shape).
- Emit the new `replay.divergedAtRefusal` event when replay-refusal-divergence occurs (additive RunEventType; pre-version-4 consumers ignore).
- Implement §C observable-sequence determinism (most hosts already do this implicitly via existing replay machinery; §C makes the contract explicit).

## Conformance

3 new conformance scenarios, REPLACING the 3 `it.todo()` placeholders in `replay-llm-cache-key.test.ts`:

- `replay-llm-cache-key-portable.test.ts` — capability-gated on `replayDeterminism.supported: true`. Two test runs against the host with identical canonical-input LLM calls; asserts the host's emitted cache-key field on `agent.toolCalled` events (or equivalent) is byte-equivalent.
- `replay-divergence-at-refusal.test.ts` — capability-gated on `refusalDivergenceEmission: true`. Original run: mock provider returns a valid envelope. Replay: mock provider returns a refusal. Asserts `replay.divergedAtRefusal` event fires AND replay fails with `replay_diverged_at_refusal`.
- `replay-observable-sequence-determinism.test.ts` — capability-gated. Runs a workflow with a non-deterministic tool call (a mock tool that returns different bytes on each call but the host caches the FIRST result as part of observable state). Forks the run at an intermediate index and replays; asserts the observable event sequence at indices `[0, forkAtEventLogIdx]` is byte-equivalent across original + replay even though the underlying tool would have produced different bytes.

## Alternatives considered

1. **Skip MAE-8 (refusal divergence) — let hosts silently substitute.** Rejected — silent substitution masks safety-policy shifts. Operators MUST be able to audit when their replays' behavior would diverge.
2. **Mandate bit-equivalent execution (not just observable-output equivalence).** Rejected — bit-equivalence requires every nondeterministic call to be cached forever (memory cost), and breaks legitimate use cases like tool calls against remote stateful APIs.
3. **Defer MAE-9 to a separate "replay-semantics" RFC after Phase 4.** Rejected — observable-sequence vs bit-equivalent is the load-bearing contract distinction; deferring leaves the spec ambiguous on the most consequential question.

## Unresolved questions

1. **Canonical message format.** §A's `<canonical-message-array>` needs to nail down field ordering + null/undefined semantics. The OpenAI `chat.completions` shape differs from Anthropic's `messages` and Gemini's `contents`; the canonical form needs to be vendor-neutral. Recommend: spec the canonical form as JSON Schema in `schemas/llm-canonical-message.schema.json`; defer the schema landing to the comment-window discussion.
2. **Tool-call non-determinism in observable state.** §C says hosts MUST cache observable result, not just the tool-call result. What about tools whose observable result depends on time of day (`getCurrentTime()`)? Recommend: tools that return non-cacheable state advertise via a NEW `tool.nondeterministic: true` field on AgentManifest's tool declarations; replay walks the cache transparently and re-issues for nondeterministic tools.
3. **Cross-host cache sharing.** If host A caches an LLM response and host B replays the run, can host B use host A's cache? RFC 0040 Phase 3 + RFC 0041 Phase 4 together define the surface but the cache-sharing protocol is a meta-question. Defer.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `spec/v1/replay.md` extended with §A + §B + §C normative text.
- [ ] `spec/v1/multi-agent-execution.md` extended with §"Phase 4 replay determinism".
- [ ] `schemas/capabilities.schema.json` extends `multiAgent.executionModel` with `replayDeterminism` block per §D.
- [ ] `schemas/run-event.schema.json` `RunEventType` enum gains `replay.divergedAtRefusal`.
- [ ] `schemas/run-event-payloads.schema.json` gains `replayDivergedAtRefusal` payload schema.
- [ ] `spec/v1/rest-endpoints.md` §"Common error codes" gains `replay_diverged_at_refusal`.
- [ ] `SECURITY/invariants.yaml` gains `replay-llm-cache-key-portable` row with public test glob per §E.
- [ ] 3 new conformance scenarios per §Conformance (replacing the existing `replay-llm-cache-key.test.ts` placeholders).
- [ ] At least one reference host advertises `version: 4` + passes the 3 scenarios.
- [ ] `docs/KNOWN-LIMITS.md` `replay-llm-cache-key.test.ts` row dropped from §"Shape-only conformance coverage."
- [ ] `INTEROP-MATRIX.md` updated.
- [ ] CHANGELOG entry under `[Unreleased]`.

Path to `Active → Accepted`: cross-host advertisement evidence per `RFCs/0001-rfc-process.md` §"Promotion to Accepted." The multi-agent execution model roadmap closes when this RFC reaches Accepted.

## References

- [`RFCS/0037-multi-agent-execution-model.md`](./0037-multi-agent-execution-model.md) §"Open spec gaps" MAE-7, MAE-8, MAE-9.
- [`RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md`](./0039-multi-agent-confidence-and-memory-lifecycle.md) (Phase 2).
- [`RFCS/0040-multi-agent-cross-host-causation.md`](./0040-multi-agent-cross-host-causation.md) (Phase 3 — this RFC's predecessor).
- [`spec/v1/replay.md`](../spec/v1/replay.md) §"LLM cache-key recipe" + §"Determinism with non-deterministic agents" (the docs §A + §C extend).
- [`docs/KNOWN-LIMITS.md`](../docs/KNOWN-LIMITS.md) line 18 (the row this RFC closes).
- External standards-readiness review 2026-05-21 — finding (3).
