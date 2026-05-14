# vendor.myndhyve.ads-policy

> `ads.policy.check` — 7-rule built-in policy text scanner with caller-supplied placement-length + trust-guardrail augmentation.

## Node

| typeId | Behavior |
|---|---|
| `ads.policy.check` | Scans ad copy against 7 built-in policy text rules (claims, trademark, prohibited content, discriminatory targeting). Pattern + keyword matching with severity-driven fail/warning classification. Optional caller-supplied augmentations for placement text-length limits + trust-guardrail results. |

## Built-in rules

| Rule id | Category | Severity | Detects |
|---|---|---|---|
| `claims-guarantee` | claims | high | Unqualified guarantees (100%, guaranteed, risk-free, money-back) |
| `claims-income` | claims | critical | Income claims ("earn $X per day/week/month/year") |
| `claims-superlative` | claims | medium | Unsubstantiated superlatives (best, #1, top-rated, fastest, cheapest) |
| `trademark-competitor` | trademark | medium (meta/google only) | Competitor brand mentions |
| `prohibited-before-after` | prohibited_content | high (meta only) | Before/after transformations |
| `prohibited-urgency-scam` | prohibited_content | medium | Deceptive urgency (act now, last chance, expires today) |
| `targeting-discrimination` | targeting | critical | Discriminatory language |

`config.customRules` extends this list. Same shape as built-ins.

## Caller-supplied augmentations

**`inputs.placementTextLimits`**: per-placement headline/description/bodyText/ctaText limits. Workflow author resolves via `vendor.myndhyve.ads-platforms` pack OR a `host.adPlatformSpecs` capability. When supplied, the executor adds placement-aware text-length checks to the output. When absent, length checks are skipped.

**`inputs.trustGuardrailChecks`**: pre-computed trust-guardrail check results from a TrustGuardrail-aware node (e.g., MyndHyve's TrustGuardrailService). Each entry: `{rule?, category?, status, message, autoResolvable?}`. Merged into `riskFlags`.

## Differences vs MyndHyve source

MyndHyve's `AdApprovalGateService.runComplianceChecks` does three things: text rule scanning, asset-format checks (via `getSpecForPlacement`), and placement text-length checks (via `validateTextForPlacement`). MyndHyve's `policy.check` executor passes `assets=[]` so the asset-format branch is always skipped.

This pack inlines:
- The 7 `BUILT_IN_RULES` + `evaluateRule` (the text-rule scanner)
- A trimmed `checkTextLengths` that uses caller-supplied limits instead of PlatformSpecRegistry

Trust-guardrail results are delegated to the caller (MyndHyve's TrustGuardrailService stays in-tree; this pack accepts its output). This keeps the pack at ~300 LOC vs. inlining the 1230 LOC TrustGuardrailService.

Asset-format checks defer to the [`vendor.myndhyve.ads-creative-validate`](../vendor.myndhyve.ads-creative-validate/) pack — it accepts caller-supplied `placementSpecs` from `ads-platforms` and runs text-rule + asset-format + text-length checks together.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
