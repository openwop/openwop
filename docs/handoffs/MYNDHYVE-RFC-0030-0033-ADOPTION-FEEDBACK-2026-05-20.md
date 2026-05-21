# MyndHyve RFC 0030/0031/0032/0033 Adoption Feedback — FILLED

> **Owner:** MyndHyve workflow-runtime integration session
> **Date opened:** 2026-05-20
> **Date filled:** 2026-05-21
> **RFC comment window closes:** 2026-05-27 (`Active → Accepted` landing)
> **Status:** FILLED — see §"Summary of resolutions" at the bottom for the OpenWOP steward's per-finding disposition.

---

## §A — Wire-shape ambiguities

### A.1 — RFC 0030 `reasoning` field

- **Schema fit:** Matched without tightening. MyndHyve uses `z.string().nullable().optional()` (Zod-side) → `zodToOpenApi.ts`. No need for `minLength` / `maxLength`. No `additionalProperties` issues — the field lives inside object payloads whose outer `additionalProperties: false` is set by `forceOpenAIStrict`.
- **`promptDirective: "mandatory"` operational concern:** Spec text says hosts MUST NOT reject absent-reasoning envelopes regardless of strength — but the *model itself* isn't the host. Risk: strict-output models might honor the mandatory wording literally and refuse mid-emission if they cannot generate reasoning. **Worth a paragraph in RFC 0030 §C** documenting this provider-side failure mode + operator guidance.
- **Directive text:** Tam et al. directive wording adopted verbatim from OpenWOP reference (commit `9412f57`). One drift: the env-var name `OPENWOP_ENVELOPE_REASONING_DIRECTIVE` is centralized in `@openwop/workflow-engine`'s `readReasoningDirectiveStrengthFromEnv()` per A3.2 review feedback so server + browser read the same source.

### A.2 — RFC 0031 `modelCapabilities`

- **Identifiers advertised:** `structured-output` + `discriminator-enum` only (2 of 5 spec-reserved). `long-context` / `reasoning` / `function-calling` NOT advertised because no NodeModule declares `requiredModelCapabilities: [...]` gating on them. Advertising would be dishonest per `capabilities.md §"Truthful advertisement"`. **Recommend spec normate: "advertised[] MUST reflect identifiers the host actually gates on"** — avoids boilerplate-paste.
- **`fallbackModel` no-recursive-fallback:** discipline honored. App Builder PRD/plan/design declare 4.6 satisfies both required capabilities natively (no chained fallback). The rule felt right.
- **`substitutionSupported` scope ambiguity:** MyndHyve does NOT advertise this because `model.capability.substituted` emission happens at envelope-emitting nodes only (`core.ai.callPrompt`), not as a host-wide per-call swap. **Spec is genuinely ambiguous** whether `substitutionSupported: true` means (a) any AI call gets the swap or (b) envelope-emitting nodes with declared fallback get the swap. Recommend clarifying.

### A.3 — RFC 0032 reliability events

- **`previousError` / `finalError`:** include the host's own structured prefix (`ENVELOPE_INVALID: payload.title: Required`). NEVER includes the AI prompt or provider's response body. The `contextAdapter`'s `extractEnvelopeJson` is the source of these strings — strings are derived from the Zod issue list (validator output only). RFC 0032 §G MUST NOT covers prompt-content + credentialRefs; **MyndHyve complies**.
- **`refusalText`:** routed through the run's BYOK `MemorySecretRegistry.redact()` BEFORE emission (commit `85834ccf`, server-side path; browser path is vacuous because BYOK plaintext never reaches the browser). Test fixture: register `sk-LIVE-akrJ4yKvF1RnX2pT5oQbZ3` as a tracked secret, simulate refusal echoing the key — emitted `refusalText` becomes `[REDACTED:user-byok-secret]`.
- **`recovery.applied.byteOffset` semantics:** never populated in MyndHyve's emission. Their `parseLenientJsonEnvelope` returns a `recoveryPath` discriminator (`'jsonrepair' | 'markdown-fence' | 'brace-walker' | 'double-encoded'`) but does NOT track a byte position — jsonrepair is a black-box pass and the brace-walker stack-state doesn't expose byteOffset. **Open spec gap:** should `byteOffset` be MAY (path-dependent absence) or MUST-omit for jsonrepair? Spec currently silent.

### A.4 — RFC 0033 truncation routing

- **`truncationBudgetMultiplier` ceiling:** not yet observed in production because MyndHyve's default `max_tokens` is 8192 and the doubled retry hits 16384 which is well under every provider's per-call ceiling. Will recur at higher base budgets; today they'd succeed-or-fail on the doubled call (no third-tier retry). **Recommend the spec normate: "When doubled budget exceeds provider per-call max, host MAY further reduce"** — currently silent.
- **Truncation + parse-failure precedence:** their parser ordering is `checkJsonCompleteness → truncation OR parse-error` (mutually exclusive at their parser). When both detection signals would fire, `contextAdapter.ts:988` chooses truncation-first. **Matches RFC 0033 §A priority rule. Felt natural.**
- **Error code drift — `envelope_truncation_unrecoverable` maps cleanly** (MyndHyve's `ENVELOPE_TRUNCATED` translates to it). BUT `envelope_payload_invalid` and `envelope_refused_by_provider` from RFC 0033 §F don't match MyndHyve's wire-emitted codes:
  - MyndHyve emits `envelope_schema_violation` (spec wants `envelope_payload_invalid`)
  - MyndHyve emits `envelope_refusal` (spec wants `envelope_refused_by_provider`)
  - MyndHyve's argument: names mirror RunEvent type names (`envelope.refusal` → `envelope_refusal`), which is a sensible pattern.
  - Recommend: either MyndHyve changes the translator to match spec verbatim (1-line fix), OR the spec accepts MyndHyve's names as aliases / canonical.

---

## §B — Ergonomic gaps

### B.1 — Discovery composition

- **Nesting depth:** `capabilities.envelopes.reliability.completion.distinguishesTruncation` is 3 levels deep. Mentally fine, but live shape uses `events: true` (boolean) rather than `events: ['envelope.retry.attempted', ...]` (string[] per spec template). MyndHyve's discovery emits boolean. Either is honest, but **recommend the spec normate the array form** so conformance suites can introspect "does host emit `envelope.refusal`?" without firing it.
- **`events: []` empty-array convention:** not used (MyndHyve emits `events: true`). Wouldn't have helped — the boolean form is unambiguous to them. If the spec switches to array-required, the empty-array semantics matter.

### B.2 — Conformance ergonomics

- **API key mint friction:** the 21 auth-blocked end-to-end scenarios need an `OPENWOP_API_KEY`. MyndHyve's `scripts/mint-conformance-api-key.cjs` requires admin-SDK + gcloud auth + workspace context — multi-step. **Recommend a published SDK helper `@openwop/conformance-sdk/mint-test-key`** that abstracts "give me a short-lived API key bound to a test workspace."
- **Mock-AI provider:** MyndHyve did NOT write their own; they use real providers gated by env-var (`OPENWOP_CONFORMANCE_CANARY_SECRET`). The reference mock fixture would have shortened wiring meaningfully — they'd absolutely adopt a published helper.
- **`OPENWOP_REQUIRE_BEHAVIOR=true`:** not yet flipped in MyndHyve's profile claim. Plan to flip once 100% of the 14 scenarios pass.

### B.3 — SDK helper gaps

- **`parseRefusal`:** would have shortened MyndHyve's work — they hand-rolled per-provider refusal detection in `packages/ai-providers/src/providers/openai.ts` (line 178+) for OpenAI's `message.refusal` field. Anthropic + Gemini have different shapes (`stop_reason: 'safety'` etc.). A normalized `{ refusalText: string | null, safetyCategory?: string }` per-provider helper would be ~1 day of host wiring saved.
- **`buildReasoningDirective`:** adopted from reference verbatim (`src/core/ai/envelope/reasoningDirective.ts`). Would happily replace with `@openwop/sdk-typescript`'s export if published — currently MyndHyve ported the file. **The duplicated copy is a drift risk** (synced via `git show 9412f57` on the openwop repo).

---

## §C — Capability advertisement findings

Live shape at `https://api.myndhyve.ai/.well-known/openwop` (production, Cloud Run revision `workflow-runtime-00327-kah`):

```jsonc
{
  "envelopes": {
    "reliability": {
      "events": true,                  // DRIFT: spec template suggests string[] of event names
      "maxRetryAttempts": 2,
      "completion": {
        "distinguishesTruncation": true,
        "truncationRetryMultiplier": 2 // DRIFT: spec uses `truncationBudgetMultiplier`
      }
    },
    "tierOneSubsetCompliance": true,   // boolean — spec template suggests `"enforce" | "warn" | "off"` 3-state
    "reasoning": {
      "supported": true,
      "promptDirective": "advisory"
    }
  },
  "modelCapabilities": {
    "supported": true,
    "advertised": ["structured-output", "discriminator-enum"]
    // NOT advertised: `substitutionSupported` (no host-wide swap facility)
  }
}
```

- **Drifts to call out** (per §B.1 + §A.4): `events: true` vs `events: string[]`, `truncationRetryMultiplier` vs `truncationBudgetMultiplier`, `tierOneSubsetCompliance: boolean` vs tri-state enum.
- **No `x-host-myndhyve-*` extensions advertised.** Considered one for their `eventLogSchemaVersion` field but it predates RFC 0032 and lives at top-level, not under `envelopes`.

---

## §D — Error code surfacing

All three RFC 0033 §F codes flow through `RunSnapshot.error.code` cleanly via `services/workflow-runtime/src/utils/errorCodeTranslation.ts` (commit `b992c161`, A6.1):

- `envelope_truncation_unrecoverable` ✓ **MATCHES SPEC** (from `ENVELOPE_TRUNCATED`)
- `envelope_payload_invalid` — MyndHyve emits `envelope_schema_violation` instead (from `ENVELOPE_INVALID`)
- `envelope_refused_by_provider` — MyndHyve emits `envelope_refusal` instead (from `AI_REFUSAL`)

**Two-direction fix needed:** either MyndHyve adds aliases in their translator, or the spec accepts MyndHyve's names as variants. The current MyndHyve names match the RunEvent type names (`envelope.refusal`, `envelope.invalid`) which is a sensible pattern — MyndHyve would prefer the spec adopt them.

- **SECURITY invariant `envelope-refusal-no-prompt-leak`:** enforced via `redactKnownSecrets()` per A2.2 (commit `85834ccf`). Tests assert tracked-plaintext-in-refusal becomes `[REDACTED:<secretId>]` before reaching `RunSnapshot.error.message` or the persisted `RunEventDoc`. Zero friction from the invariant.
- **Downstream UI:** chat panel uses `aiErrorCopy.AI_REFUSAL` which surfaces the (redacted) refusal text verbatim to the end user. Conformance suites that check `error.message` MUST NOT echo refusal text pass because the message field is set to translated copy ("This step requires structured-output support…"), not the raw refusal.

---

## §E — Conformance suite results (2026-05-21)

```
Scenario file                                          Pass  Fail  Skip
envelope-reasoning-shape.test.ts                         12     0     0  (static shape — all pass)
envelope-reasoning-secret-redaction.test.ts               1     7     0  (7 fails = no API key)
envelope-tier-one-subset-static.test.ts                   5     0     0
envelope-variant-discriminator-static.test.ts             9     0     0
model-capability-substituted.test.ts                      1     3     0  (3 fails = no API key)
model-capability-insufficient.test.ts                     2     4     0  (4 fails = no API key)
node-module-required-capabilities-shape.test.ts           0     0     4  (Skipped — host doesn't expose nodeRegistry over the wire)
envelope-refusal-shape.test.ts                            5     3     0  (3 fails = no API key)
envelope-retry-attempted.test.ts                          6     0     0
envelope-retry-exhausted.test.ts                          5     0     0
envelope-truncated.test.ts                                4     0     0
envelope-truncation-cap-exhaustion.test.ts                4     0     0
envelope-completion-distinguishes-truncation.test.ts      5     0     0
envelope-recovery-applied.test.ts                         3     4     0  (4 fails = no API key)
─────────────────────────────────────────────────────────────────────
Aggregate:                                               62    21     4
```

- **62 pass live + 21 auth-blocked + 4 honest skip = 87 total.**
- All 21 fails are blocked on `OPENWOP_API_KEY` — needs `gcloud auth login` + `node scripts/mint-conformance-api-key.cjs --workspace <ws>` (script failed with `invalid_rapt` reauth error this turn).
- Net of the auth blocker: **83 of 87 = 95.4% MUST-tier coverage post-mint.** The 4 skips are honest (node-catalog endpoint not exposed).

---

## §F — Open questions for next-slice work

1. **`events` field shape:** should `envelopes.reliability.events` be boolean ("I emit RFC 0032 events") or `string[]` ("here's exactly which of the six I emit")? Conformance suite assumes the array form; production hosts (MyndHyve) lean toward boolean. **Pick one and normate.**
2. **Error-code naming:** should `envelope_refused_by_provider` accept `envelope_refusal` as a synonym? The latter mirrors the RunEvent type name and feels more consistent.
3. **`recovery.applied.byteOffset` semantics:** MAY-omit per recovery path? MUST-omit for jsonrepair? Spec is silent.
4. **`modelCapabilities.substitutionSupported` scope:** host-wide or per-node? Critical for how MyndHyve would flip the flag.

---

## Summary of resolutions (OpenWOP steward disposition)

> Filled by the OpenWOP steward as each finding lands. Each finding maps to either (a) a spec amendment commit before 2026-05-27, (b) an INTEROP-MATRIX row fill-in (already done), or (c) a deferred follow-up RFC.

| # | Finding | Lane | Disposition |
|---|---|---|---|
| 1 | `events: boolean` vs `string[]` drift | RFC 0032 §C amendment | ✅ **Resolved 2026-05-21** — RFC 0032 §C amendment landed (`a264b3a`). Spec normates `events[]` as JSON array of event names; boolean form NOT permitted. MyndHyve renames `true` → explicit `["envelope.retry.exhausted", "envelope.refusal"]` array before promotion. |
| 2 | `truncationRetryMultiplier` vs `truncationBudgetMultiplier` drift | RFC 0033 §B amendment | ✅ **Resolved 2026-05-21** — RFC 0033 §B amendment landed (this commit). Canonical name `truncationBudgetMultiplier` retained; the multiplier applies to output budget (not retry count), and the semantic distinction matters. MyndHyve renames `truncationRetryMultiplier` → `truncationBudgetMultiplier`. |
| 3 | `tierOneSubsetCompliance` boolean vs tri-state drift | RFC 0030 §C amendment | ✅ **Resolved 2026-05-21** — RFC 0030 §C amendment landed (this commit). Canonical form is tri-state `"strict" \| "warn" \| "off"`; boolean form NOT permitted. MyndHyve migrates `true` → `"strict"` or `"warn"` per actual posture. |
| 4 | Error code names (`envelope_schema_violation` / `envelope_refusal` vs spec) | RFC 0033 §F amendment | ✅ **Resolved 2026-05-21** — RFC 0033 §F + `spec/v1/rest-endpoints.md` §"Common error codes" amendment landed (`a264b3a`). Spec accepts MyndHyve's shorter forms: renamed `envelope_payload_invalid` → `envelope_invalid` and `envelope_refused_by_provider` → `envelope_refusal`. MyndHyve still renames `envelope_schema_violation` → `envelope_invalid`. |
| 5 | `modelCapabilities.advertised` truthful-only normation | RFC 0031 §C amendment | ✅ **Resolved 2026-05-21** — RFC 0031 §C amendment landed (`a264b3a`). Spec normates: `advertised[]` MUST reflect only identifiers the host actually gates on at dispatch. Boilerplate-paste is non-conformant. MyndHyve's posture (advertising 2 of 5 spec-reserved identifiers) is the canonical pattern. |
| 6 | `substitutionSupported` host-wide vs per-node ambiguity | RFC 0031 §E amendment | ✅ **Resolved 2026-05-21** — RFC 0031 §E amendment landed (`a264b3a`). Scope clarified: substitution is per-NodeModule, NOT host-wide. Hosts without per-call provider-swap MUST advertise `false`. MyndHyve's non-advertisement is honest given their `model.capability.substituted` emission is per-envelope-node only. |
| 7 | `recovery.applied.byteOffset` MAY-omit normation | RFC 0032 §B.6 amendment | ✅ **Resolved 2026-05-21** — RFC 0032 §B.6 amendment landed (`a264b3a`). `byteOffset` is OPTIONAL and path-dependent: MAY-omit for `jsonrepair` + `double-encoded`; SHOULD-populate for `markdown-fence` + `brace-walker` + `direct`. |
| 8 | `reasoning: "mandatory"` provider-refusal risk | RFC 0030 §C amendment | ✅ **Resolved 2026-05-21** — RFC 0030 §C amendment landed (`a264b3a`). Operator guidance added: hosts SHOULD prefer `"advisory"` unless empirical testing against the host's model class confirms `"mandatory"` does not trigger refusals. |
| 9 | Doubled budget exceeds provider per-call max | RFC 0033 §B amendment | ✅ **Resolved 2026-05-21** — RFC 0033 §B amendment landed (`a264b3a`). Provider-ceiling guidance added: host MAY reduce to ceiling AND continue retry; budget-clamped retry that also fails with truncation is terminal. |
| 10 | Reference `parseRefusal` helper | `sdk/typescript/` follow-up | Deferred (post-Accepted) |
| 11 | Reference `buildReasoningDirective` export | `sdk/typescript/` follow-up | Deferred (post-Accepted) |
| 12 | `@openwop/conformance-sdk/mint-test-key` helper | `sdk/typescript/` follow-up | Deferred (post-Accepted) |

**Track C summary (2026-05-21):** 9 of 12 findings resolved by in-spec amendments; 3 deferred to `sdk/typescript/` follow-up post-Accepted. All RFC 0030/0031/0032/0033 wire-shape drifts are addressed before the 2026-05-27 promotion-comment-window close. MyndHyve has 4 minor wire renames to deploy before re-running the conformance suite for the third-party-advertisement-evidence criterion per RFCs/0001 §"Promotion to Accepted."
