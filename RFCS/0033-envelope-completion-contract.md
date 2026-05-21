# RFC 0033: Envelope-completion contract (truncation vs schema-violation distinction)

| Field | Value |
|---|---|
| **RFC** | 0033 |
| **Title** | Envelope-completion criteria; distinguishing truncation from schema-violation in retry routing; truncation-retry cap |
| **Status** | `Active` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-20 |
| **Updated** | 2026-05-20 (Draft → Active — see [Status history](#status-history) below). |
| **Affects** | `spec/v1/ai-envelope.md` (adds §"Envelope-completion criteria"; amends §"Production flow" with the retry-routing distinction) · `schemas/capabilities.schema.json` (extends `envelopes.reliability` block from RFC 0032 with `completion` sub-fields) · `spec/v1/observability.md` (adds §"Envelope-completion retry routing") · 2 new conformance scenarios · CHANGELOG |
| **Compatibility** | `additive` (new MUSTs in previously-undefined behavior space) |
| **Supersedes** | — |

## Summary

Normates the envelope-completion criteria and the **truncation-vs-schema-violation retry-routing distinction** that hosts MUST honor when emitting structured envelopes via LLM calls. An envelope is *complete* only when (a) the underlying LLM call reached a clean stop AND (b) the emitted payload validates against the envelope's payload schema. The two failure modes (truncation = output cut off; schema-violation = model emitted wrong-shape JSON) require fundamentally different retry strategies: truncation needs a budget increase; schema-violation needs a corrective system fragment. Conflating them is non-conformant. Reuses RFC 0032's `envelope.truncated` and `envelope.retry.attempted` events as the observability surface; reuses the existing `limits.schemaRounds` as the truncation-retry budget so no new cap surface is introduced. Closes spec gap E5 (Refusal-mode interaction with retry policies) from `ai-envelope.md` §"Open spec gaps."

## Motivation

### 2.1 Hosts handle envelope completion ad-hoc today

`ai-envelope.md` §"Production flow" specifies the validation pipeline (shape → kind → payload → contract → limits → redaction → trust → dedup → handler) but is silent on the retry-routing semantics for the two distinct failure modes the LLM call can produce:

- **Schema violation.** The model returned JSON, but the JSON doesn't validate against the envelope's payload schema (missing required field, wrong type, invalid `enum` value). Standard retry strategy: re-prompt the model with a corrective fragment describing what was wrong. The model self-corrects on attempt 2.

- **Truncation.** The model started emitting a syntactically correct JSON envelope but ran out of output tokens before finishing the closing brace. Standard retry strategy: retry with an increased output budget. A corrective schema fragment would be actively harmful — it tells the model "your shape was wrong" when actually the shape was *right*, just incomplete.

Hosts that conflate the two paths produce surprising behavior:

- A host that applies the schema-violation corrective fragment to truncation: the model receives "your envelope was malformed, here's the correct shape" + retries within the same budget, gets cut off at the same point, fails again. The retry budget exhausts without ever increasing the output budget.

- A host that applies the truncation budget-doubling to schema-violation: the model re-emits a still-wrong-shape envelope with twice the budget, producing the same malformed output but using twice the tokens. The retry budget exhausts on a tractable problem because the wrong remediation was applied.

Both failure modes are observable from the provider response's `stop_reason` field (or the validator's failure shape), but the spec doesn't normate that hosts MUST inspect them. This RFC closes the gap.

### 2.2 Spec gap E5 closure

`ai-envelope.md` §"Open spec gaps" E5:

> Refusal-mode interaction with retry policies — `refusalMode: "fail-node"` plus a per-run retry policy can produce surprising loops if the LLM keeps emitting refused kinds. The interaction needs a worked example.

RFC 0032 (envelope-reliability events) provides the event vocabulary; this RFC provides the worked example — the truncation-vs-schema-violation distinction is the canonical retry-routing case the gap was tracking.

### 2.3 Truncation-retry DoS opening

A naive truncation-retry implementation can be DoS'd if the model truncates every time: the host keeps doubling the budget, the model keeps truncating at the new ceiling, the run consumes ever-larger token budgets until external cost limits intervene. This RFC normates a per-emission truncation-retry cap (reusing `limits.schemaRounds`) so the failure mode is bounded by protocol contract, not just by operator wallet limits.

## Proposal

### §A — Envelope-completion criteria (normative)

Add a new §"Envelope-completion criteria" to `spec/v1/ai-envelope.md` after §"Production flow":

> A host SHALL treat an envelope as **complete** only when BOTH of the following hold:
>
> 1. The underlying LLM call reached a clean stop condition (`stop_reason: "stop"` per OpenAI, `stop_reason: "end_turn"` per Anthropic, `finish_reason: "STOP"` per Gemini, or vendor equivalent indicating model self-determined completion).
> 2. The emitted payload parses as JSON and validates against the envelope's per-kind payload schema (per §"Schema discipline"), after applying the host's normalization pass (if any).
>
> If condition 1 fails (truncation), the host SHALL emit `envelope.truncated` (per RFC 0032 §B.4) and MAY retry per §B. Hosts MUST NOT apply schema-correction system fragments to truncation failures — truncation is an output-size problem, not a schema problem.
>
> If condition 2 fails (schema violation, truncation-clean stop but invalid payload), the host MAY retry per §C with a corrective system fragment. Hosts emitting retries SHALL emit `envelope.retry.attempted` (per RFC 0032 §B.1) before each retry call past the first.
>
> Hosts SHALL distinguish truncation from schema violation in their retry routing AND in emitted telemetry (the two RFC 0032 events distinguish; conflating them in the event stream is non-conformant).
>
> If conditions 1 and 2 both fail in the same response (e.g., the response is truncated AND the partial payload doesn't even satisfy the syntactic-JSON requirement — common when truncation occurs mid-string), the host SHALL treat the failure as truncation (condition 1) for routing purposes, since the underlying problem is output budget; emit `envelope.truncated`, NOT `envelope.retry.attempted` with `reason: "schema-violation"`. This priority matches the principle that the retry strategy should address the upstream cause.

### §B — Truncation retry path (normative)

> A host MAY retry an emission whose `envelope.truncated` event fires by re-issuing the LLM call with an **increased output budget**. The new budget SHOULD be greater than the previous budget; a 2× multiplier is RECOMMENDED but not normative.
>
> **Provider-ceiling guidance (clarified by amendment 2026-05-21).** When the doubled (or otherwise increased) output budget would exceed the active provider's per-call maximum (e.g., Anthropic's `max_tokens` ceiling, OpenAI's response-length cap, Gemini's `maxOutputTokens`), the host MAY further reduce the requested budget to the provider's ceiling AND continue the retry. Hosts SHOULD NOT silently truncate the request to the ceiling without emitting `envelope.retry.attempted { reason: "truncation" }` for the retry attempt — the retry IS a retry regardless of budget-clamping. Hosts SHOULD treat a budget-clamped retry that also fails with truncation as terminal (no further retries with the same ceiling), failing the node with `envelope_truncation_unrecoverable` per §F.
>
> Truncation retries SHALL NOT include any corrective system fragment that describes a schema problem — the previous attempt's payload shape (as far as it was emitted before truncation) was correct; the only failure mode is incomplete output.
>
> Truncation retries count against `limits.schemaRounds` (the existing per-emission retry budget per `capabilities.md` §"Engine-enforced limits"). When the retry budget is exhausted while the failure mode remains truncation, the host SHALL emit `envelope.retry.exhausted` (per RFC 0032 §B.2) with `finalReason: "truncation"` AND `cap.breached` (per `observability.md`) with `kind: "schema"`. The node MUST fail with `error.code: "envelope_truncation_unrecoverable"` (NEW error code; see §F).
>
> Each truncation retry MUST emit `envelope.retry.attempted` with `reason: "truncation"` per RFC 0032 §B.1 (the second-and-subsequent attempts; the first attempt does not emit per RFC 0032 §B.1 normative text).

### §C — Schema-violation retry path (normative)

> A host MAY retry an emission whose payload-validation step fails (per `ai-envelope.md` §"Production flow" → "Per-kind payload validation") by re-issuing the LLM call with a **corrective system fragment** describing the validation error. The fragment SHOULD reproduce the validator's failure description (e.g., "required field 'steps' missing") but MUST NOT contain prompt-injection content extracted from the model's previous output (the corrective fragment is host-authored, not model-authored).
>
> The corrective system fragment is host-implementation-defined; this RFC does not normate its exact wording. A reasonable shape:
>
> > "Your previous emission did not validate against the required envelope schema. Validator output: `<validator-summary>`. Please re-emit your structured response with the correction applied."
>
> Schema-violation retries SHALL NOT include an increased output budget — schema violations don't fail for size reasons; doubling the budget on a tractable shape problem is wasted tokens.
>
> Schema-violation retries count against `limits.schemaRounds`. When exhausted, the host SHALL emit `envelope.retry.exhausted` with `finalReason: "schema-violation"` AND `cap.breached` with `kind: "schema"`. The node fails with `error.code: "envelope_payload_invalid"` (existing error code per RFC 0021 §"Validation outcomes").
>
> Each retry MUST emit `envelope.retry.attempted` with `reason: "schema-violation"` per RFC 0032 §B.1.

### §D — Refusal and recovery paths (cross-reference)

The two RFC 0032 events `envelope.refusal` and `envelope.recovery.applied` fire on **distinct** paths from truncation/schema-violation. This RFC normates how they interact with retry budgets:

- **Refusal.** The provider returned an explicit refusal (safety stop, content policy block). Per RFC 0032 §"Unresolved questions" #1 + the RFC 0032 §B.3 normative text: **the host MUST NOT retry on refusal.** No retry attempt; no `envelope.retry.attempted` event; the node fails with `error.code: "envelope_refused_by_provider"` (NEW error code, §F).

- **Recovery.** Lenient parsing recovered a malformed envelope (e.g., markdown-fence stripping). Recovery is **internal to the parsing step**, before validation; recovery does NOT consume a retry attempt and does NOT emit `envelope.retry.attempted`. The downstream validation either succeeds (envelope is accepted normally) or fails (proceeds to §C schema-violation retry path).

### §E — Capability advertisement

`schemas/capabilities.schema.json` extends the `envelopes.reliability` block (introduced by RFC 0032 §C) with one new sub-field:

```diff
   "envelopes": {
     "properties": {
       "reasoning": { ... },
       "tierOneSubsetCompliance": { ... },
       "reliability": {
         "properties": {
           "supported": { ... },
           "events": { ... },
           "maxRetryAttempts": { ... },
+          "completion": {
+            "type": "object",
+            "additionalProperties": false,
+            "required": ["distinguishesTruncation"],
+            "properties": {
+              "distinguishesTruncation": {
+                "type": "boolean",
+                "description": "Host implements RFC 0033's truncation-vs-schema-violation retry-routing distinction. When false or absent, the host conflates the two paths (legacy behavior); conformance scenarios for the distinction soft-skip."
+              },
+              "truncationBudgetMultiplier": {
+                "type": "number",
+                "minimum": 1,
+                "maximum": 8,
+                "description": "Host's per-attempt output-budget multiplier on truncation retries. Informational; clients MAY surface this in cost-estimation UIs. Defaults to 2 when absent and `distinguishesTruncation: true`."
+              }
+            },
+            "description": "Host self-attestation for RFC 0033 envelope-completion contract."
+          }
         }
       }
     }
   }
```

### §F — Error codes

Two new error codes for the terminal failure paths:

| Code | When |
|---|---|
| `envelope_truncation_unrecoverable` | Truncation-retry budget exhausted while failure mode remained truncation. Pairs with `envelope.retry.exhausted { finalReason: "truncation" }` and `cap.breached { kind: "schema" }`. |
| `envelope_refused_by_provider` | Provider returned an explicit refusal; the host (per §D) did not retry. Pairs with `envelope.refusal`. |

Both codes are added to the canonical error-code table in `spec/v1/rest-endpoints.md` §"Common error codes." Existing `envelope_payload_invalid` (RFC 0021) remains the code for schema-violation-retry-exhausted; this RFC does not introduce a separate code for that path (the existing code already correctly characterizes the failure).

### §G — Production flow amendment

`ai-envelope.md` §"Production flow" gains a non-normative annotation showing the retry-routing branches:

```
LLM emission
  │
  ▼
Parse JSON (lenient if host advertises recovery; §D)
  │   ├── fail (terminal parse error) → emit envelope.retry.exhausted { finalReason: "parse-error" }; fail node
  │   ├── recovered via lenient path → emit envelope.recovery.applied (RFC 0032 §B.6); continue
  │   └── ok (direct or recovered)
  ▼
Stop reason inspection (RFC 0033 §A condition 1)
  │   ├── truncation (max_tokens / length) → emit envelope.truncated (RFC 0032 §B.4)
  │   │     ├── retry budget remains → §B truncation retry path (increased budget, NO corrective fragment)
  │   │     │       → emit envelope.retry.attempted { reason: "truncation" } before next call
  │   │     └── budget exhausted → emit envelope.retry.exhausted { finalReason: "truncation" } + cap.breached + fail node
  │   └── clean stop (model self-determined completion)
  ▼
Shape validation
  │   ├── fail → see schema-violation retry path §C
  │   └── ok
  ▼
Kind / payload / contract / limits / redaction / trust / dedup / handler (per RFC 0021 §"Production flow")
  │
  ├── provider refusal at any point → emit envelope.refusal; fail node with envelope_refused_by_provider (§D)
  ▼
Per-kind payload validation
  │   ├── fail → §C schema-violation retry path (corrective fragment, NO budget increase)
  │   │       → emit envelope.retry.attempted { reason: "schema-violation" } before next call
  │   │       → budget exhausted: emit envelope.retry.exhausted { finalReason: "schema-violation" } + cap.breached + fail node
  │   └── ok → accept envelope
```

### §H — Trust boundary + SECURITY (carry-forward)

This RFC's normative additions ride entirely on RFC 0032's event surface; no new event types are introduced. The SECURITY invariants from RFC 0032 §G (`envelope-refusal-no-prompt-leak`, `envelope-recovery-no-content-leak`) apply unchanged. The corrective system fragment §C produces is host-authored from validator output, not from the model's previous output; redaction of the validator's failure description is RECOMMENDED but not mandated — validator output rarely contains secrets, but hosts MAY apply SR-1 redaction defensively.

## Compatibility

**Additive per `COMPATIBILITY.md §2.1 + §4`.** All claims:

- Existing required fields: unchanged.
- Existing optional fields: unchanged.
- Existing event types: unchanged. This RFC introduces no new `RunEventType` entries; it normates the *retry-routing semantics* using RFC 0032's existing event vocabulary.
- Existing endpoints: unchanged.
- Existing MUST requirements: **not relaxed.** RFC 0033 introduces NEW MUSTs in a previously-silent area (the retry-routing distinction was not normated in v1.1). Per `COMPATIBILITY.md §4` row "New normative requirement on a previously-undefined behavior" — additive.
- Existing error codes: unchanged. Two NEW error codes (`envelope_truncation_unrecoverable`, `envelope_refused_by_provider`) added; existing codes remain.

Hosts that don't advertise `capabilities.envelopes.reliability.completion.distinguishesTruncation: true` retain their legacy retry-routing behavior; conformance scenarios for the distinction soft-skip. Hosts that DO advertise commit to the new MUSTs; conformance gates accordingly.

The new MUSTs are scoped to hosts that opt in via the capability flag, so v1.1 hosts that haven't migrated remain conformant against the suite version they pass. Soak window: one release cycle, matching the RFC 0026 / RFC 0027 / RFC 0032 precedent for additive capability-gated MUSTs.

## Conformance

Two new scenarios under `conformance/src/scenarios/`. Both gated on `capabilities.envelopes.reliability.supported: true` AND `capabilities.envelopes.reliability.completion.distinguishesTruncation: true` AND the test seam.

- `envelope-completion-distinguishes-truncation.test.ts` — drives two scenarios in sequence:
  1. **Truncation path.** Mock LLM stops at `max_tokens` mid-envelope. Asserts: (a) `envelope.truncated` event fires; (b) `envelope.retry.attempted { reason: "truncation" }` fires on retry; (c) the host's retry call carries an INCREASED output budget (verified via the mock provider's `lastReceivedMaxTokens` test-introspection hook); (d) NO corrective schema fragment in the retry's system prompt.
  2. **Schema-violation path.** Mock LLM returns a clean stop with malformed JSON (missing required field). Asserts: (a) NO `envelope.truncated` event; (b) `envelope.retry.attempted { reason: "schema-violation" }` fires on retry; (c) the host's retry call carries an UNCHANGED output budget; (d) a corrective schema fragment IS present in the retry's system prompt (verified via the mock provider's `lastReceivedSystemPrompt` hook).

- `envelope-truncation-cap-exhaustion.test.ts` — drives a scenario where the mock LLM truncates every attempt up to `maxRetryAttempts + 1`. Asserts: (a) `envelope.retry.exhausted { finalReason: "truncation" }` fires; (b) `cap.breached { kind: "schema" }` fires; (c) the node fails with `error.code: "envelope_truncation_unrecoverable"`; (d) the run does NOT exceed `maxRetryAttempts` total LLM calls (no infinite loop). This is the DoS-bound assertion.

The `behaviorGate` helper from RFC 0032 gains a predicate `requireEnvelopeCompletionDistinguishes()`.

## Alternatives considered

1. **Make the truncation-vs-schema-violation distinction a SHOULD instead of a MUST.** Rejected — the entire point of the RFC is the conformance-gateable distinction. SHOULD-tier semantics are too soft to assert; conformance suites have to fall back to "did the host retry at all?" assertions, which catches the wrong errors. MUST + capability-gating (host opts in, then must comply) is the right shape.

2. **Drop the truncation-retry cap; rely on operator-side cost limits.** Rejected — leaves a DoS opening on hosts that don't have operator-side wallet caps configured. The `limits.schemaRounds` reuse adds bounded behavior at the protocol level without introducing a new cap surface.

3. **Mandate a specific truncation budget multiplier (2× exactly).** Rejected — different model classes have different optimal multipliers (a model with a 4k context might need 4× to break out of a tight budget; a model with a 200k context can go from 1k → 2k → 4k → 8k → 16k more efficiently). The RFC RECOMMENDS 2× and exposes `truncationBudgetMultiplier` as informational advertisement; hosts pick what fits their model roster.

4. **Introduce a new `envelope.budget.doubled` event for the budget-increase path.** Rejected — RFC 0032's `envelope.retry.attempted { reason: "truncation" }` is sufficient (the `reason` field carries the routing decision). Adding a separate event would clutter the event vocabulary without new information.

5. **Bundle this RFC into RFC 0032 (envelope-reliability events).** Rejected — RFC 0032 ships the event vocabulary; RFC 0033 ships the retry semantics that depend on the events. Splitting them lets RFC 0032 land first (lower-risk additive event surface) and RFC 0033 follow once the event vocabulary is settled. Same staging logic as the proposal's PR 3 boundary (R4 + R5 together but conceptually separate; this RFC track honors the boundary as separate RFCs).

## Unresolved questions

1. **Schema-violation retry with model-self-corrective fragment vs spec-canonical fragment.** §C says the corrective fragment is "host-implementation-defined." Should the spec offer a reference text the host MAY use, or normate a minimum fragment shape (e.g., must include the JSON Pointer to the failing field)? Recommendation: stay host-defined for v1.x; revisit if interop issues materialize.

2. **Combined truncation + schema-violation diagnosis.** §A says if both conditions fail in the same response, treat as truncation. Is there an edge case where a model emits truncation-clean stop with payload that's both syntactically valid AND validates partially (e.g., extra fields plus missing required field)? Recommendation: the existing pipeline handles this — partial validation success isn't a thing in JSON Schema; either the schema validates or it doesn't. No edge case in practice.

3. **`partialPayloadAvailable` consumption.** RFC 0032 §B.4 introduces `envelope.truncated.partialPayloadAvailable: boolean`. This RFC doesn't mandate any particular use of the partial payload. Should the spec offer a recovery path that uses the partial payload as input to the budget-doubled retry (e.g., "continue from where you left off")? Recommendation: defer — partial-payload continuation is a host-discretion strategy that adds complexity without obvious win. The simple budget-double-and-retry strategy is sufficient for v1.2.

4. **Interaction with run-level retry policies.** A run-level `RunOptions.retryPolicy` may also produce retries at the node level (separate from the envelope-level retries this RFC normates). Should the spec clarify the precedence — envelope-level retries fire first, run-level fires only if the envelope-level path exhausts? Recommendation: yes; document in `spec/v1/run-options.md` §"Retry policy" as a non-normative integration note. The envelope-level path is the inner retry loop; the run-level path is the outer.

5. **Truncation in tool-using flows.** When the LLM is mid-tool-call (function-calling) and truncates, the truncation might be in the tool-call arguments rather than the envelope payload. Is the truncation event still `envelope.truncated`, or something tool-call-specific? Recommendation: emit `envelope.truncated` for the *envelope's* completion; tool-call argument truncation is a separate condition handled by the function-calling layer. The two surfaces don't conflict because envelope emission and tool-call argument emission are sequential, not simultaneous.

## Implementation notes (non-normative)

- Reference host `apps/workflow-engine/backend/typescript`:
  - Extend `executor/envelopeReliability.ts` (introduced by RFC 0032) with the retry-routing branch: inspect `stopReason`, route to truncation-budget-double path or schema-violation-corrective-fragment path.
  - The budget-double helper lives in `aiProviders/aiProvidersHost.ts` `dispatchPlain` — extend the retry loop to accept a `budgetMultiplier` parameter (defaulting to 1 for schema-violation, 2 for truncation).
  - The corrective-fragment helper lives in a new `executor/correctiveFragment.ts` module that consumes Ajv2020 validator output and synthesizes a human-readable instruction. Reuses Ajv's existing error-formatting machinery.
- Mock-provider extensions for the two conformance scenarios: add `mockTruncationSequence: number[]` (per-attempt truncation behavior) and `mockSchemaViolationSequence: boolean[]` (per-attempt malformed-JSON behavior). Both are extensions to the existing mock-provider config shape from RFC 0023.
- Estimated total effort: schema + spec text + production-flow amendment ~1 day; reference-host retry-routing implementation ~1.5 days; two conformance scenarios ~1.5 days; CHANGELOG + INTEROP-MATRIX + observability.md prose ~30 min. Total ~4.5 days plus the standard Active window unless the bootstrap-phase waiver applies.

## Acceptance criteria

Promotion from `Active` → `Accepted`:

- [ ] `spec/v1/ai-envelope.md` extended with §"Envelope-completion criteria" per §A; §"Production flow" annotated with the retry-routing branches per §G.
- [ ] `spec/v1/observability.md` extended with §"Envelope-completion retry routing" cross-referencing RFC 0032's event family and this RFC's routing semantics.
- [ ] `spec/v1/rest-endpoints.md` §"Common error codes" gains `envelope_truncation_unrecoverable` and `envelope_refused_by_provider` per §F.
- [ ] `schemas/capabilities.schema.json` `envelopes.reliability` block extended with `completion` per §E.
- [ ] Two new conformance scenarios per §"Conformance" land in `@openwop/openwop-conformance`; suite minor-version bumps.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] `INTEROP-MATRIX.md` extended with a row for `capabilities.envelopes.reliability.completion.distinguishesTruncation` alongside the RFC 0032 reliability rows.
- [ ] Reference host (`apps/workflow-engine/backend/typescript`) advertises `capabilities.envelopes.reliability.completion.distinguishesTruncation: true` with `truncationBudgetMultiplier: 2`, implements the retry-routing distinction, passes both new conformance scenarios.
- [ ] Spec gap E5 (`ai-envelope.md` §"Open spec gaps") marked closed in a follow-up doc-prose pass.
- [ ] First non-steward host advertises `capabilities.envelopes.reliability.completion.distinguishesTruncation: true` (third-party validation gate per RFC 0001). MAY be waived under bootstrap-phase waiver.

## References

- `RFCS/0021-ai-envelope-primitive.md` — Production flow + Validation outcomes table this RFC normates the retry-routing path for.
- `RFCS/0032-envelope-reliability-events.md` — event vocabulary (`envelope.truncated`, `envelope.retry.attempted`, `envelope.retry.exhausted`, `envelope.refusal`, `envelope.recovery.applied`) this RFC's retry routing references; ships first per the track's PR sequencing.
- `RFCS/0030-envelope-reasoning-and-tier-one-subset.md` — `reasoning` field consumes output tokens; relevant to truncation-budget calculations referenced in §B.
- `RFCS/0031-envelope-variants-and-model-capabilities.md` — `model.capability.substituted` event fires BEFORE this RFC's completion-criteria check; substitution doesn't reset the retry budget mid-emission.
- `spec/v1/ai-envelope.md` §"Open spec gaps" E5 — closed by this RFC's normative retry-routing semantics.
- `spec/v1/capabilities.md` §"Engine-enforced limits" — `limits.schemaRounds` reused as the truncation-retry budget per §B.
- `spec/v1/rest-endpoints.md` §"Common error codes" — error-code table extended with the two new codes per §F.
- `spec/v1/run-options.md` §"Retry policy" — outer retry loop; non-normative integration note recommended per §"Unresolved questions" #4.
- Tam et al., "Let Me Speak Freely?" — https://arxiv.org/pdf/2408.02442 (informs the "truncation needs budget, not corrective fragment" recommendation: truncation typically reflects model running out of room mid-reasoning, not model emitting wrong shape).

## Status history

### Active amendment (2026-05-21) — MyndHyve adoption feedback

Additive normative-text clarification per the filled adoption feedback at `docs/handoffs/MYNDHYVE-RFC-0030-0033-ADOPTION-FEEDBACK-2026-05-20.md` §A.4. **No wire-shape change; no schema change.**

- §B — Added provider-ceiling guidance for the truncation-budget multiplication path: when the doubled (or otherwise increased) output budget would exceed the active provider's per-call max, hosts MAY further reduce to the provider's ceiling AND continue the retry. Budget-clamped retries that ALSO fail with truncation SHOULD be treated as terminal (no further retries with the same ceiling). Surfaced by MyndHyve's default `max_tokens: 8192` not yet hitting the ceiling (16384 retry budget is well under every Tier-1 vendor's per-call max) — the guidance preempts the failure mode at higher base budgets.

A separate forthcoming amendment (filed in commit alongside this one) renames §F error codes per the same adoption feedback round (`envelope_payload_invalid → envelope_invalid`; `envelope_refused_by_provider → envelope_refusal`). See the commit immediately following for the rename rationale + reference-host + conformance updates.

Compatibility: **additive** per `COMPATIBILITY.md §2.1`. The §B clarification is operator guidance — hosts already implementing budget-clamping behavior remain compliant; the new text gives explicit normative cover for the pattern.

### Draft → Active (2026-05-20)

Promoted under the bootstrap-phase steward waiver per the RFC 0021–0032 precedent. Spec text + wire-shape locked. Closes spec gap E5 from `ai-envelope.md` §"Open spec gaps." Conformance scenarios + reference-host implementation remain as the path to `Accepted`.

Evidence at promotion:

- **Spec text:**
  - `spec/v1/ai-envelope.md` extended with §"Envelope-completion criteria" between §"Production flow" and §"Replay determinism". Carries the normative completion criteria (clean stop AND payload validates) + the four retry paths (truncation: increased budget, no corrective fragment; schema-violation: corrective fragment, no budget increase; refusal: terminal, no retry; recovery: internal to parsing, no retry consumed). Documents the priority rule when conditions 1 and 2 both fail (treat as truncation since output budget is the upstream cause). Cross-references the capability advertisement (`capabilities.envelopes.reliability.completion` — landed by the RFC 0032 batch) and the two new error codes.
  - `spec/v1/observability.md` extended with §"Envelope-completion retry routing (RFC 0033)" — landed in the RFC 0032 batch as part of the cross-track observability documentation. Summarizes the routing distinction; cross-references this RFC's §F error codes.
  - `spec/v1/rest-endpoints.md` §"Common error codes" gains two new codes per §F: `envelope_truncation_unrecoverable` (paired with `envelope.retry.exhausted { finalReason: "truncation" }` + `cap.breached`) and `envelope_refused_by_provider` (paired with `envelope.refusal`; MUST NOT echo refusal text in the error message per SECURITY invariant `envelope-refusal-no-prompt-leak`).
- **Schemas additive (no MUST relaxed):**
  - `schemas/capabilities.schema.json` — `envelopes.reliability.completion` sub-block landed in the RFC 0032 batch (since 0033 depends on 0032's event vocabulary, the sub-block lives under the `reliability` parent). Required `distinguishesTruncation: boolean`; optional `truncationBudgetMultiplier: 1..8` (default 2; informational for cost-estimation UIs). Hosts that don't advertise `distinguishesTruncation: true` retain legacy retry-routing behavior; conformance scenarios soft-skip.
  - `schemas/run-event.schema.json` — REUSES the six RFC 0032 envelope-reliability event types; this RFC introduces NO new event types. The retry-routing semantics layered on top of the existing event vocabulary.
  - `schemas/run-event-payloads.schema.json` — same; no schema changes (the `reason`/`finalReason` enum values `truncation` and `schema-violation` are already in the RFC 0032 enum).

Path to `Active → Accepted`: requires the reference workflow-engine to (a) advertise `capabilities.envelopes.reliability.completion.distinguishesTruncation: true` + `truncationBudgetMultiplier: 2`, (b) implement the truncation-vs-schema-violation retry-routing branch in `executor/envelopeReliability.ts` (or equivalent) — extending the retry loop to accept a `budgetMultiplier` parameter (defaulting to 1 for schema-violation, 2 for truncation) and the corrective-fragment helper to synthesize human-readable instructions from Ajv validator output, (c) ship the two conformance scenarios from §"Conformance" (envelope-completion-distinguishes-truncation; envelope-truncation-cap-exhaustion), and (d) mark spec gap E5 closed in a follow-up doc-prose pass to `ai-envelope.md` §"Open spec gaps." Alternatively, a non-steward host advertising the capability closes the third-party validation gate per the RFC 0021 / RFC 0026 precedent.
