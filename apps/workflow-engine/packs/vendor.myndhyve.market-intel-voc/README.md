# vendor.myndhyve.market-intel-voc

> `market-intel.voc-extraction` — extract Voice of Customer records (verbatim quotes + tagType + intentStage + confidence + rationale) from a single piece of content via one AI call. First marketIntel pack of the Stage 5 cohort.

## Node

| typeId | Role | Behavior |
|---|---|---|
| `market-intel.voc-extraction` | action (AI) | Issues one `ctx.callAI` against content + ICP/product context. Parses the JSON response. Validates each record against the VoC schema (6 tag types × 4 intent stages × clamped confidence). **Invalid records are dropped with per-record warnings — NOT errored** — so a partial parse still returns the valid subset. |

## VoC schema

Each output record:

| Field | Constraint |
|---|---|
| `quote` | verbatim quote from `inputs.content`; ≥10 chars; invalid → drop with warning |
| `tagType` | one of `pain / desire / objection / trigger / proof_request / alternative`; invalid → drop with warning |
| `intentStage` | one of `ready_now / researching / problem_aware / unaware`; invalid → drop with warning |
| `confidence` | `0..1`; non-numeric → default `0.5` + warning; out-of-range → clamped + warning |
| `impliedOutcome` | optional string |
| `classificationRationale` | string (default: `"No rationale provided"`) |

`summary` carries `totalQuotesFound + highConfidenceCount (≥0.7) + tagDistribution + intentDistribution`.

`warnings[]` merges AI-emitted warnings with per-record validation warnings, so callers can surface both classes uniformly.

## Required host capability

`peerDependencies: { "aiProviders": "supported" }` — single `ctx.callAI` per invocation. Host's default provider/model routes the call; override per-execution via `config.provider` + `config.model`.

## Defaults

| Config | Default | Why |
|---|---|---|
| `temperature` | `0.3` | VoC extraction is precision-oriented; high temperature hallucinates non-verbatim quotes |
| `maxTokens` | `4096` | Handles `maxRecords` × ~150 tokens/record + summary |
| `maxRecords` (input) | `15` | Source PRD §10.3 — beyond 15, signal-to-noise drops sharply |

## Composing with `vendor.myndhyve.knowledge-tools`

VoC extraction is content-bound — it analyzes the text in `inputs.content`. If you want VoC extraction grounded in a **knowledge corpus** rather than a single document, chain:

```
knowledge.retrieve  →  market-intel.voc-extraction
─────────────────────  ──────────────────────────────
inputs.query            inputs.content = retrieved chunks joined
                        inputs.icpContext / productContext as usual
```

This pack does NOT need `host.knowledge` — it's a fixed-content analyzer. The composition above is the recommended pattern for RAG-grounded VoC.

## Differences vs MyndHyve source

**`aiService.complete(...)` → `ctx.callAI(...)`**: source-side `vocExtraction.ts` is invoked via `PromptPackExecutor` which wraps `aiService` (`@/core/ai/services/AIOrchestrationService`). Pack uses openwop's standard `ctx.callAI({ provider, model, systemPrompt, messages, temperature, maxTokens })`.

**`VoCExtractionValidationError`** (which threw on any invalid records) → soft validation: invalid records are dropped + warnings appended. Callers prefer a partial parse over a thrown error for downstream tolerance.

**`SourcePlatform` / `VoCTagType` / `IntentStage` TypeScript enum constraints** → plain string-literal arrays (`VALID_TAG_TYPES`, `VALID_INTENT_STAGES`) checked at validation time.

**`createScopedLogger('VoCExtraction')`** → `ctx.log` shim — same level set (`debug / info / warn / error`).

## Source lineage

| Pack function | MyndHyve source | LOC |
|---|---|---|
| `vocExtraction` + helpers | `src/core/market-intel/prompts/vocExtraction.ts` + `executors.ts` excerpts | ~404 + ~50 |

~454 LOC of TS ported to ~290 LOC of pure JS.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
