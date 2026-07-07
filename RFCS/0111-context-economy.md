# RFC 0111: Context Economy — Transcript Token Budget & Declared Summarization

| Field             | Value                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **RFC**           | 0111                                                                                           |
| **Title**         | Context Economy — Transcript Token Budget & Declared Summarization                             |
| **Status**        | `Active`                                                                                       |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                  |
| **Created**       | 2026-06-26                                                                                     |
| **Updated**       | 2026-06-26                                                                                     |
| **Affects**       | `spec/v1/multi-agent-execution.md`, `spec/v1/host-sample-test-seams.md`, `schemas/capabilities.schema.json`, `schemas/run-event-payloads.schema.json`, conformance |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                                               |
| **Supersedes**    | —                                                                                              |
| **Superseded by** | —                                                                                              |

## Summary

A v1-conformant host MAY feed an unbounded transcript to each orchestrator turn: `multi-agent-execution.md` §"Stateful agent-loop lifecycle" defines `transcriptWindow` as an *event-count* bound and states "Absent ⇒ unbounded on the wire." This RFC adds an opt-in `contextBudget` object to the multi-agent execution-model capability that lets a host advertise (a) a per-turn **token** budget for the orchestrator transcript and (b) a **declared summarization** contract for turns evicted beyond that budget — making the per-iteration context contract observable and conformance-testable. It does **not** change any existing default: a host that advertises neither field behaves exactly as today.

## Motivation

The protocol is byte-lean on the wire (content-free events, reference-by-id payloads, `updates` delta streams as the default) but says nothing normative about the prompt a host assembles and sends to the model each iteration. A third-party token-efficiency red-team (2026-06-15) identified this as the dominant cost: a conformant host re-sending the full transcript each turn grows per-turn cost O(turns) and cumulative run cost O(turns²). Two facts make this a spec concern rather than a pure implementation choice:

1. `transcriptWindow` already exists (RFC 0061, `version >= 5`) but bounds by **event count**, which does not bound **tokens** — a single large tool result blows the budget regardless of count.
2. The spec is *silent* on what a host does with evicted turns. Per `COMPATIBILITY.md` §4, a new normative requirement on previously-undefined behavior is additive — so the spec is the right place to define a budgeted, summarization-aware context contract that hosts can advertise and clients can rely on.

This RFC makes the contract declarable without forcing it on anyone: the "kill the unbounded default" framing from the red-team is deliberately **not** adopted, because flipping `absent ⇒ unbounded` to `absent ⇒ bounded` is a behavior change requiring the safety-fix process. Opt-in advertisement is the additive-safe path.

## Proposal

### Capability surface

Add an optional `contextBudget` object under `multiAgent.executionModel` (the same object that carries `transcriptWindow`). It is `version >= 5` (RFC 0061 stateful loop) gated.

```diff
   "executionModel": {
     "type": "object",
     "properties": {
       "transcriptWindow": { "type": "integer", "minimum": 1 },
+      "contextBudget": {
+        "type": "object",
+        "additionalProperties": false,
+        "properties": {
+          "transcriptTokenBudget": {
+            "type": "integer", "minimum": 1,
+            "description": "RFC 0111. Max tokens of transcript the host feeds any single orchestrator turn. Advertise-and-honor; complements (does not replace) transcriptWindow. Absent ⇒ no token bound."
+          },
+          "tokenCounter": {
+            "type": "string",
+            "enum": ["o200k_base", "cl100k_base", "chars", "host-defined"],
+            "description": "RFC 0111. The unit transcriptTokenBudget is denominated in, so the bound is interpretable across hosts. REQUIRED when transcriptTokenBudget is present. Same enum as RFC 0113 memory.injectionBudget.tokenCounter — transcript + memory budgets denominate consistently."
+          },
+          "summarization": {
+            "type": "object",
+            "additionalProperties": false,
+            "properties": {
+              "supported": { "type": "boolean" },
+              "strategy": { "type": "string", "enum": ["sliding-window", "recursive", "map-reduce"] },
+              "keepLastTurns": { "type": "integer", "minimum": 0,
+                "description": "Turns kept verbatim at the head of the window; older turns MAY be replaced by a summary." }
+            },
+            "required": ["supported"]
+          }
+        }
+      }
     }
   }
```

### Normative requirements

- **Scope.** `contextBudget` governs the **RFC 0061 per-iteration orchestrator-loop transcript** — `multi-agent-execution.md` §"Per-iteration state inputs" input 3, the SAME transcript `transcriptWindow` bounds — **NOT** a general chat-conversation history (RFC 0005) or any other prompt. A host whose multi-agent orchestrator loop does not run real model turns (e.g. a mock supervisor with no live inference) **MUST NOT** advertise `contextBudget`, exactly as it MUST NOT dishonestly advertise `transcriptWindow`. Budget-only advertisement (`transcriptTokenBudget` + `tokenCounter` **without** `summarization.supported`) is valid for a host that HAS a real orchestrator loop but does not summarize.
- A host advertising `contextBudget.transcriptTokenBudget` **MUST NOT** feed more than that many tokens of transcript to any single orchestrator turn, measured in the unit named by `contextBudget.tokenCounter`.
- A host advertising `transcriptTokenBudget` **MUST** also advertise `tokenCounter`; the budget is otherwise uninterpretable.
- `transcriptTokenBudget` and `transcriptWindow` **MAY** both be advertised; when both are present the host **MUST** honor whichever bound is tighter for a given turn.
- A host advertising `contextBudget.summarization.supported: true` **MUST** keep the most recent `keepLastTurns` turns verbatim and **MAY** replace older in-window turns with a host-produced summary. The active (most recent) turn **MUST NOT** be summarized.
- **Replay determinism (normative).** Per `multi-agent-execution.md` §"Per-iteration state inputs", the transcript is a deterministic, replay-reproducible iteration input — today a pure projection of the event-log tail. A host-produced summary is **nondeterministic host output** that breaks that purity, so it is governed exactly like a nondeterministic LLM envelope under RFC 0041 (`version >= 5` implies the `version >= 4` replay-determinism contract). Therefore:
  - Each substitution **MUST** be recorded as a `context.summarized` event (payload below) whose `summaryRef` points at the persisted summary.
  - On a `POST /v1/runs/{runId}:fork mode: replay`, when a summarization point falls at sequence ≥ `fromSeq`, the host **MUST** reuse the recorded summary (resolved via `summaryRef`) and **MUST NOT** re-summarize. A host that re-summarizes and produces a different model-facing transcript is non-conformant — the direct analogue of RFC 0041 §"Envelope-refusal recovery in replay".
  - `summaryRef` is an **artifactId** (a run-produced artifact read via `GET /v1/runs/{runId}/artifacts/{artifactId}`), keeping the event content-free. By direct analogy to the MAE-3 memory carry-forward (`multi-agent-execution.md` §"Replay carry-forward"), the summary artifact **MUST** be persisted and readable as-of the iteration's event-log index; a host that cannot serve it at the requested `fromSeq` **MUST** refuse the fork (mirroring `replay_memory_snapshot_unavailable`).
  - Summarization that is not recorded this way breaks replay and **MUST NOT** be advertised under this capability.

### Event-payload addition

`schemas/run-event-payloads.schema.json` gains `context.summarized`:

```json
{
  "type": "context.summarized",
  "payload": {
    "iteration": 12,
    "replacedTurns": ["evt_0a1", "evt_0a2"],
    "summaryRef": "art_sum_7c",
    "tokenCounter": "o200k_base",
    "tokensBefore": 4120,
    "tokensAfter": 280
  }
}
```

`summaryRef` is a reference-by-id to the summary artifact (the summary text is **not** inlined on the wire — content-free event discipline). `replacedTurns` lists the event ids the summary stands in for, so a replay engine can reconstruct the exact transcript.

### Conformance seam

The assembled transcript is host-internal and never crosses the wire, so conformance cannot observe it from discovery alone. This RFC adds one seam to `host-sample-test-seams.md`:

```
GET /v1/host/sample/agent/transcript-window?runId=…&iteration=N
→ { tokenCounter, tokenCount, eventIds: [...], summarizedRanges: [...] }
```

The seam returns the host's own accounting of what it fed the model that iteration. Conformance: drive enough turns that an *unbounded* transcript would exceed the budget, then assert (a) `tokenCount ≤ transcriptTokenBudget`; (b) the harness independently reads the events named in `eventIds` from the run event-log and re-computes their token sum in the advertised `tokenCounter` unit, confirming the host's reported `tokenCount` is internally consistent and ≤ budget; (c) `eventIds` are the recent tail (no older event included while a newer eligible one is dropped); and (d) every `summarizedRanges` entry has a matching `context.summarized` event.

**Honest non-vacuity limit (documented, not a gap to close):** the model-facing prompt is *genuinely* host-internal, so conformance verifies the host's **declared** transcript accounting is internally consistent and within budget — it **cannot** black-box-prove the host doesn't additionally feed off-seam content to the model. This is the inherent ceiling of governing host-internal assembly via a test seam; the capability is advertise-and-attest, and the seam proves the accounting is consistent + bounded, not that the prompt is nothing more. A host that lies in the seam fails the cross-check in (b)/(c); a host that lies *past* the seam is outside what any wire/seam witness can see.

### Examples

**Positive** — host advertises a 4 000-token budget with sliding-window summarization keeping the last 3 turns verbatim:

```json
{ "multiAgent": { "executionModel": { "version": 5,
  "contextBudget": { "transcriptTokenBudget": 4000, "tokenCounter": "o200k_base",
    "summarization": { "supported": true, "strategy": "sliding-window", "keepLastTurns": 3 } } } } }
```

**Negative** — `transcriptTokenBudget` without `tokenCounter` (uninterpretable budget) → fails schema (`tokenCounter` required when budget present, enforced by an `if/then` clause) and fails conformance.

## Compatibility

**Additive.** Backward-compat clauses:

- `contextBudget` is a new optional object; a host that omits it behaves exactly as today (`transcriptWindow` semantics, including `absent ⇒ unbounded`, are untouched).
- `context.summarized` is a new event type per `COMPATIBILITY.md` §2.1; consumers that do not recognize it ignore it. Server-emitted event schemas are open (RFC 0094), so adding it does not break schema-validating clients.
- No existing field changes type, optionality, or meaning. No default flips. The "bound the transcript by default" option was explicitly rejected as a §4 behavior change (see Alternatives).

## Conformance

- **Existing:** `multi-agent-*` scenarios cover the execution loop and `transcriptWindow` count semantics; none assert a token bound.
- **New:** `context-budget-transcript-bound.test.ts`, gated on `capabilityFamily(d,'multiAgent')?.executionModel?.contextBudget?.transcriptTokenBudget` being present (soft-skip on absence). Drives a multi-turn run, reads the host-sample transcript seam each iteration, asserts `tokenCount ≤ budget` and that `keepLastTurns` recent turns appear verbatim. A second scenario `context-summarization-replay.test.ts` (gated on `summarization.supported`) replays the run and asserts the reconstructed transcript matches, exercising the `context.summarized` → `summaryRef` path.

## Alternatives considered

1. **Flip the default (`absent ⇒ bounded`).** The red-team's headline. Rejected: per `COMPATIBILITY.md` §4 this changes observed behavior on hosts that never advertised a window → safety-fix process, not additive. Not worth a v1.x break for an efficiency optimization hosts can already perform.
2. **Leave it host-internal (do nothing).** Hosts can already token-budget their own prompt assembly with zero conformance impact (Tier-A in the red-team). Rejected as the *whole* answer because it leaves the contract unobservable: a client cannot tell whether a host bounds context, so cross-host portability of "this agent stays cheap on long runs" is impossible. The capability advertisement is the value-add.
3. **Reuse RFC 0084 `budget-policy` `maxTokens`.** Rejected: `maxTokens` is a run-wide spend ceiling that *fails or interrupts* the run on exhaustion; it is not a per-turn context-shaping budget and has no summarization semantics.

## Unresolved questions

1. Should `tokenCounter` permit provider-native counters (e.g., a named Anthropic/OpenAI tokenizer) or stay at a small portable enum? The enum keeps conformance deterministic but may diverge from a host's real provider count.
2. Is `keepLastTurns` the right knob, or should the verbatim floor be expressed in tokens (`keepLastTokens`) to compose with `transcriptTokenBudget`?
3. Does `context.summarized` belong in the normative core event set, or behind the same `version >= 5` gate as the rest of the stateful loop?
4. Should the transcript seam be normative here or deferred to a host-sample-only test seam (as drafted)?

## Implementation notes (non-normative)

- Tier-A host patches that need **no** spec change and **SHOULD** ship independently of this RFC: provider context-caching (byte-identical, front-loaded system prompt), per-task tool sub-allowlisting, gzipped SSE bus, stripping optional event meta. This RFC governs only the *declarable* transcript contract; the rest is host craft.
- Sequence after the schema lands: reference host (sqlite) implements the seam + a sliding-window summarizer first; it is the simplest strategy and exercises the `context.summarized` replay path.
- **Reconcile with openwop-app ADR 0148 A1 (host-internal token-budgeted transcript assembly + `transcriptWindow` advert):** A1 is the Tier-A producer of exactly the budgeted transcript that `contextBudget` advertises and the seam witnesses — the host's A1 assembly path emits the `context.summarized` event + the seam reads its accounting. One model, not two.
- `tokenCounter` shares the RFC 0113 enum (incl. `chars`), so a host budgets transcript (0111) and memory (0113) in one consistent unit.

## Acceptance criteria

- [x] Spec text merged (`multi-agent-execution.md` §contextBudget + `host-sample-test-seams.md` seam) — landed with the `Active` surface 2026-06-26 (CHANGELOG `[Unreleased]`).
- [x] `capabilities.schema.json` + `run-event-payloads.schema.json` updated — `contextBudget` (capabilities) + `context.summarized` (run-event-payloads) both on `main`.
- [x] `context-budget-transcript-bound.test.ts` + `context-summarization-replay.test.ts` in `@openwop/openwop-conformance` — both present; capability-gated + driver-based, so they exercise non-vacuously only against a host advertising `contextBudget` on a real orchestrator loop.
- [x] CHANGELOG entry under the next minor — `[Unreleased]` "RFCs 0111 / 0114 / 0116 — token-economy surfaces (`Active`, 2026-06-26)".
- [x] A reference host advertises `contextBudget` and passes both scenarios non-vacuously, **or the RFC explicitly defers reference-host implementation** — this RFC takes the deferral: no current steward reference host runs a real orchestrator-loop model turn to witness against (the mock supervisor MUST NOT advertise `contextBudget` per §"Scope"). Both conformance scenarios soft-skip on non-advertising hosts; the non-vacuous witness comes from a host that runs real orchestrator turns (the `Active → Accepted` graduation gate).

## References

- `spec/v1/multi-agent-execution.md` §"Stateful agent-loop lifecycle" (`transcriptWindow`, line 238).
- `spec/v1/budget-policy.md` (RFC 0084) — run-wide spend, contrasted in Alternatives.
- `COMPATIBILITY.md` §4 (behavior-only changes) — the §4 table is why the default cannot flip.
- RFC 0061 (stateful agent-loop lifecycle), RFC 0041 (replay determinism), RFC 0094 (schema closure).
- Prior art: Anthropic prompt caching; LangGraph checkpoint/summarization; sliding-window context management.
- Sibling RFCs in this set: 0112 (compact tools), 0113 (memory budget), 0114 (A2UI deltas), 0115 (transport economy), 0116 (prompt-prefix cache).
