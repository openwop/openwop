# MyndHyve RFC 0030/0031/0032/0033 Adoption Feedback Template

> **Owner:** MyndHyve workflow-runtime integration session
> **Date opened:** 2026-05-20
> **RFC comment window closes:** 2026-05-27 (Active → Accepted landing)
> **Purpose:** Capture wire-shape ambiguities, ergonomic gaps, and integration friction encountered while wiring the envelope LLM-contract-hardening surface. Surfaced items get folded into the §"Open spec gaps" amendment on each RFC before the Active → Accepted commit.

---

## How to use this template

Fill in each section below as integration progresses. Empty sections at the close of the comment window land as "no feedback in this category" in the Accepted commit. Each finding should answer:

1. **What happened** — the specific behavior or wire-shape detail.
2. **Where in the spec** — RFC section + spec doc (`spec/v1/ai-envelope.md §X`) the finding touches.
3. **What we did** — the integration decision MyndHyve made when the spec was silent or ambiguous.
4. **Recommendation** — clarification text, schema tightening, or a follow-up RFC.

Each finding lands as one row in the RFC's §"Open spec gaps" table if accepted upstream.

---

## §A — Wire-shape ambiguities

Places where MyndHyve had to make a judgment call because the spec didn't fully specify. These are the highest-priority findings — wire-shape ambiguities create cross-host interop drift.

### A.1 — RFC 0030 `reasoning` field

- [ ] Did `responseSchema.properties.reasoning: { type: 'string' }` match the openwop spec contract, or did MyndHyve need to tighten it (e.g., `minLength`, `maxLength`, additional properties)?
- [ ] When `promptDirective` is `"mandatory"`, did any third-party LLM provider refuse to emit `reasoning` for input that genuinely didn't warrant analysis? (Surfaces an honest tension between the directive strength and provider behavior.)
- [ ] Was the Tam et al. arXiv 2408.02442 advisory-tier directive wording adequate, or did MyndHyve substitute different prompt copy?

### A.2 — RFC 0031 `modelCapabilities`

- [ ] Spec-reserved identifiers (`structured-output`, `discriminator-enum`, `long-context`, `reasoning`, `function-calling`) — were any ambiguous in the wild? (E.g., does Gemini 2.5 Pro's "thinkingBudget" count as `reasoning`?)
- [ ] `fallbackModel` semantics — did MyndHyve hit the no-recursive-fallback rule? Did the rule feel like the right discipline, or too restrictive?
- [ ] `substitutionSupported: true` posture — if MyndHyve advertises this, how is the per-call provider swap actually wired? (May surface a sample-grade implementation pattern worth documenting in `host-capabilities.md`.)

### A.3 — RFC 0032 reliability events

- [ ] `previousError` / `finalError` content — what did MyndHyve include? (Validator output only, full provider error string, host-formatted summary?) The RFC 0032 §G normative MUST NOT covers prompt-content + credentialRefs; what else SHOULD be in or out?
- [ ] `refusalText` — same question. Production refusal surfaces sometimes echo user prompt content. How does MyndHyve scrub?
- [ ] `recovery.applied.byteOffset` semantics — when is it populated vs absent? Path-dependent? (Spec is currently silent.)

### A.4 — RFC 0033 truncation routing

- [ ] `truncationBudgetMultiplier` — does MyndHyve hit ceiling cases where the doubled budget itself exceeds provider limits? How is this handled (further retry with capped budget? Immediate fail?)
- [ ] Combined truncation + parse-failure (RFC 0033 §A priority rule) — how often does this come up in the wild? Is the precedence rule (route as truncation) the right call?
- [ ] `envelope_truncation_unrecoverable` vs `envelope_payload_invalid` — does the distinction map cleanly to MyndHyve's existing error vocabulary, or is there friction?

---

## §B — Ergonomic gaps

Places where the wire shape is correct but the integration was harder than necessary. These don't change the wire — they may change documentation, helper SDKs, or capability defaults.

### B.1 — Discovery advertisement composition

- [ ] Did MyndHyve's discovery doc end up with deeply-nested capability blocks that were hard to mentally parse? Would a flatter shape have helped?
- [ ] `events: []` (empty array when host opts out of end-to-end emission) — is the empty-array-meaning-no-emission convention clear enough? Or does it look like a bug?

### B.2 — Conformance-suite ergonomics

- [ ] Which conformance scenarios required the most fixture/seam setup on MyndHyve's side? Where could the reference fixtures or driver helpers reduce per-host work?
- [ ] Did MyndHyve write its own mock-AI provider to drive the envelope-reliability scenarios, or reuse the reference? (Could justify a published SDK helper.)
- [ ] `OPENWOP_REQUIRE_BEHAVIOR=true` strict-mode posture — how did MyndHyve gate the four new capabilities under strict-mode?

### B.3 — SDK helper gaps

- [ ] Is there a TypeScript/Python/Go helper that would have meaningfully shortened the integration? (E.g., a `parseRefusal(providerResponse): RefusalSignal | null` that normalizes per-provider safety-stop strings to the spec's single boolean.)
- [ ] `buildReasoningDirective` — would MyndHyve adopt the reference helper if exported from `sdk/typescript/`, or did their needs differ enough to warrant their own?

---

## §C — Capability advertisement findings

What MyndHyve actually advertises today, with any drift from the reference. Used as truth for the INTEROP-MATRIX row.

```jsonc
// Fill in MyndHyve's actual advertisement
{
  "capabilities": {
    "envelopes": {
      "reasoning": {
        "supported": true,
        "promptDirective": "advisory"  // or "mandatory" / "off"
      },
      "tierOneSubsetCompliance": "warn",  // or "enforce" / "off" — omit if not advertised
      "reliability": {
        "supported": true,
        "events": ["envelope.retry.attempted", "envelope.retry.exhausted", "envelope.refusal", "envelope.truncated"],  // MyndHyve's actual list
        "maxRetryAttempts": 3,
        "completion": {
          "distinguishesTruncation": true,
          "truncationBudgetMultiplier": 2
        }
      }
    },
    "modelCapabilities": {
      "supported": true,
      "advertised": ["structured-output", "discriminator-enum", "long-context", "reasoning", "function-calling"],  // MyndHyve's actual set
      "substitutionSupported": false  // flip true only when per-call provider swap is wired
    }
  }
}
```

- [ ] Were any of the spec-reserved capability identifiers omitted? Why?
- [ ] Did MyndHyve add any `x-host-myndhyve-*` extensions? List them — they're useful precedent for the §C extension pattern in RFC 0031.

---

## §D — Error code surfacing

Did the three new error codes from RFC 0033 §F (`envelope_payload_invalid`, `envelope_truncation_unrecoverable`, `envelope_refused_by_provider`) flow through MyndHyve's `RunSnapshot.error.code` cleanly?

- [ ] Are the three codes distinguishable downstream (e.g., in MyndHyve's UI? alerting? cost-attribution?)
- [ ] Did MyndHyve need to map any of them to a different existing error code in their stack? If so, which and why?
- [ ] Did the SECURITY invariant `envelope-refusal-no-prompt-leak` (no refusal text on `error.message`) surface any friction?

---

## §E — Conformance-suite findings

The 38+ live HTTP-gated assertions across 14 scenario files (per the INTEROP-MATRIX row template). MyndHyve's actual pass/fail/skip counts go here.

```
Scenario file                                          Pass  Fail  Skip
envelope-reasoning-shape.test.ts                       ____  ____  ____
envelope-reasoning-secret-redaction.test.ts            ____  ____  ____
envelope-tier-one-subset-static.test.ts                ____  ____  ____
envelope-variant-discriminator-static.test.ts          ____  ____  ____
model-capability-substituted.test.ts                   ____  ____  ____
model-capability-insufficient.test.ts                  ____  ____  ____
node-module-required-capabilities-shape.test.ts        ____  ____  ____
envelope-refusal-shape.test.ts                         ____  ____  ____
envelope-retry-attempted.test.ts                       ____  ____  ____
envelope-retry-exhausted.test.ts                       ____  ____  ____
envelope-truncated.test.ts                             ____  ____  ____
envelope-truncation-cap-exhaustion.test.ts             ____  ____  ____
envelope-completion-distinguishes-truncation.test.ts   ____  ____  ____
envelope-recovery-applied.test.ts                      ____  ____  ____
```

For any failure, note the scenario file + test name + observed-vs-expected behavior. Failures are the highest-priority feedback — they're either a host bug, a scenario bug, or a spec ambiguity.

---

## §F — Open questions for the next-slice work

Before the four RFCs flip Accepted on 2026-05-27, anything MyndHyve wants the openwop steward to clarify, normate, or schedule for a follow-up RFC?

- [ ] _Question 1_:
- [ ] _Question 2_:
- [ ] _Question 3_:

---

## Submission

When complete, MyndHyve's session pastes this filled template back to the openwop steward's Claude Code session. The steward folds each finding into:

- INTEROP-MATRIX.md row (replace `<TODO>` placeholders with MyndHyve's actual URL/commit/revision/pass-count)
- Each RFC's §"Open spec gaps" table (one row per finding that surfaces a spec clarification)
- A pre-Accepted amendment commit on each RFC where appropriate (additive — no wire-shape changes, just normative-text tightening)

Then the four `Active → Accepted` commits land 2026-05-27.
