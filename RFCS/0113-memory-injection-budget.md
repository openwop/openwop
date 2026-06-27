# RFC 0113: Memory Injection Budget

| Field             | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| **RFC**           | 0113                                                                 |
| **Title**         | Memory Injection Budget                                              |
| **Status**        | `Accepted`                                                             |
| **Author(s)**     | David Tufts (@davidscotttufts)                                       |
| **Created**       | 2026-06-26                                                           |
| **Updated**       | 2026-06-27 (Active → Accepted — dual-witness vs conformance suite 1.43.0: openwop-app reference host rev `00332-gm2` + MyndHyve tier-2 witness rev `00512-pej`, both passing memory injectionBudget non-vacuously (token-budget caps with whole-entry omission + keep-≥1, `tokenCounter:chars`, recency rank, missing/negative budget → 400), steward-curl-verified). 2026-06-26                                                           |
| **Affects**       | `spec/v1/agent-memory.md`, `schemas/memory-list-options.schema.json`, `schemas/capabilities.schema.json`, conformance |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                                    |
| **Supersedes**    | —                                                                    |
| **Superseded by** | —                                                                    |

## Summary

`MemoryAdapter.list(memoryRef, options?)` (RFC 0068) bounds reads only by entry `limit` and `tag` — there is no token budget and no relevance ranking, so a host that injects "recent memory" into a turn can inject an unbounded number of tokens. RFC 0062 distillation has a `tokenBudget`, but that governs *background compaction*, not the *live read* that feeds a turn. This RFC adds optional `tokenBudget` and `rank` (recency | relevance) to `MemoryListOptions`, letting a host return a token-bounded, relevance-ranked top-k slice of memory for injection. The existing secret-redaction (SR-1) and cross-tenant (CTI-1) invariants are preserved verbatim.

## Motivation

"Whole memory injected" is one of the compounding per-turn costs the red-team flagged (F4): on a long-running agent the memory store grows without bound, and a count `limit` is a poor proxy for tokens (one long entry blows the budget). Distillation (RFC 0062) shrinks the *store* on a schedule but does not shape what a *single turn* pulls. The read path is the right place to bound injection because that is where the host decides what the model sees, and because relevance-ranked top-k is a strictly better selection than "most recent N entries" for retrieval-augmented turns.

## Proposal

### Interface change

`MemoryListOptions` (`agent-memory.md` lines 42–45) gains two optional fields:

```diff
  interface MemoryListOptions {
    readonly limit?: number;
    readonly tag?: string;
+   readonly tokenBudget?: number;   // RFC 0113. Max cumulative tokens across returned entries (the new lever).
+   readonly rank?: 'recency' | 'relevance';  // RFC 0113. Selection order; 'relevance' DELEGATES to memory.search (RFC 0080).
+   readonly query?: string;         // RFC 0113. Relevance anchor when rank='relevance' (the memory.search semantic query).
  }
```

The genuinely new contribution is **`tokenBudget`** — a token-denominated bound where today only an entry-`limit` count exists. Ranking is **not** a new primitive: `rank:'relevance'` **delegates to the existing `memory.search` semantic mode (RFC 0080)**, it does not introduce a parallel relevance engine.

### Normative requirements

- When `tokenBudget` is supplied, the adapter **MUST** return a prefix of the ranked entry list whose cumulative token count (in the unit named by `memory.injectionBudget.tokenCounter`) does not exceed `tokenBudget`. A single entry exceeding the budget on its own **MUST** be omitted (not truncated mid-entry). `tokenBudget` is denominated in the advertised `tokenCounter` unit; `o200k_base`/`cl100k_base` are tokenizer encodings, `chars` counts UTF-8/Unicode characters of the entry `content` (a tokenizer-free unit a client can reason about directly — a real host, openwop-app ADR 0148 A4, budgets by character count), and `host-defined` is an opaque host unit. The over-budget-single-entry-omitted rule applies regardless of unit.
- When `rank: 'relevance'` is supplied, `query` **MUST** be present, **and** the host **MUST** advertise `memory.search` with `semantic` mode (RFC 0080) — `rank:'relevance'` is the budgeted projection *over* that existing semantic-search surface, not a new ranking capability. A host that does not advertise `memory.search` semantic mode **MUST** reject `rank:'relevance'` (or, if it advertises only `memory.injectionBudget`, fall back to `'recency'` per its documented behavior). When `rank` is absent or `'recency'`, entries are ordered most-recent-first (today's behavior).
- `tokenBudget` and `limit` **MAY** both be supplied; the adapter **MUST** honor whichever yields fewer entries.
- **SR-1 and CTI-1 hold by construction on this path** (not merely "restated"): SR-1 redacts at *write* time (`agent-memory.md` §SR-1 — the persisted `content` already carries `[REDACTED:<secretId>]`), so a budgeted/ranked read ranks over already-redacted content and cannot leak plaintext; CTI-1 scopes the resolve to a single tenant (`agent-memory.md` §CTI-1), so a budget/rank prefix of an already-single-tenant list stays single-tenant. The adapter **MUST NOT** widen either: ranking **MUST** operate on the redacted, single-tenant result set. Conformance re-asserts both on the budgeted path as a regression guard.

### Capability

```diff
   "memory": {
     "type": "object",
     "properties": {
       "supported": { "type": "boolean" },
+      "injectionBudget": {
+        "type": "object",
+        "additionalProperties": false,
+        "properties": {
+          "supported": { "type": "boolean" },
+          "tokenCounter": { "type": "string", "enum": ["o200k_base", "cl100k_base", "chars", "host-defined"],
+            "description": "RFC 0113. The unit `tokenBudget` is denominated in. REQUIRED when injectionBudget.supported. `chars` counts UTF-8/Unicode characters of the entry content (a tokenizer-free unit a client can reason about — preferred over opaque host-defined). RFC 0111 aligns to these same values when it lands (0113 lands first)." }
+        },
+        "required": ["supported"]
+      }
     }
   }
```

Relevance ranking is **not** advertised here — it is gated on the existing `memory.search` (`{ supported, modes:["semantic"] }`, RFC 0080), so there is exactly one relevance surface in the corpus.

### Examples

**Positive (recency)** — `list('mem:agent-7', { tokenBudget: 800 })` → most-recent entries up to 800 tokens, redacted, single-tenant.

**Positive (relevance, host advertises `memory.search` semantic)** — `list('mem:agent-7', { tokenBudget: 800, rank: 'relevance', query: 'refund policy' })` → the 800-token budgeted projection over the host's existing semantic search.

**Negative** — `rank: 'relevance'` on a host that does NOT advertise `memory.search` semantic mode → MUST reject (or fall back to recency per its documented behavior); the conformance scenario asserts it does not silently fabricate a ranking.

## Compatibility

**Additive.** `tokenBudget`, `rank`, `query` are new optional `MemoryListOptions` fields; callers that omit them get today's `limit`/`tag` behavior. `memory.injectionBudget` is a new optional capability object (the `memory` block is `additionalProperties:true`). No existing field changes. Relevance reuses RFC 0080 `memory.search` — no new ranking surface. SR-1/CTI-1 are preserved by construction, never relaxed.

## Conformance

- **Existing:** `memory-*` scenarios cover `list`/`get`; `agentMemoryCrossTenantIsolation.test.ts` (CTI-1, `conformance-agent-memory-cross-tenant` fixture) and `redaction.test.ts` (SR-1) already exist and are reused.
- **New:** `memory-injection-budget.test.ts`, gated on `capabilityFamily(d,'memory')?.injectionBudget?.supported === true` (driven via the host-sample memory seam). Asserts: returned entries' cumulative tokens ≤ `tokenBudget` in the advertised `tokenCounter`; an over-budget single entry is omitted (not truncated); when the host ALSO advertises `memory.search` semantic, `rank:'relevance'` ordering differs from `'recency'` on a crafted fixture (else the relevance leg soft-skips); **and re-asserts SR-1 + CTI-1 on the budgeted path** (a budgeted read returns redacted content + empty on the cross-tenant probe) as a regression guard.

## Alternatives considered

1. **Add a new `injectionBudget.ranking[]` / relevance engine.** Rejected (architect review 2026-06-26): `memory.search` (RFC 0080, `{supported, modes:["semantic","filter"]}`) already advertises semantic/similarity retrieval. A second ranking surface would fork the corpus. `rank:'relevance'` delegates to `memory.search`; 0113 contributes only the token budget.
2. **Extend RFC 0062 distillation to cover live reads.** Rejected: distillation is a scheduled background job with its own event (`memory.compacted`); overloading it with synchronous read-shaping conflates two lifecycles.
3. **Approximate token budget via `limit` + average entry size.** Rejected: a count cap cannot bound tokens when entry sizes vary by orders of magnitude.
4. **Do nothing.** Rejected: leaves injection unbounded on long runs; no token-denominated bound exists today (`limit` is count-only).

## Unresolved questions

1. ~~Reuse RFC 0111's `tokenCounter`?~~ **Resolved (architect 2026-06-26):** 0113 lands before 0111, so 0113 *defines* the `tokenCounter` enum (in `memory.injectionBudget`); 0111 aligns to the same values. No shared `$ref` (decoupled).
2. ~~Is `relevance` portably testable?~~ **Resolved:** relevance is delegated to `memory.search`; the scenario asserts only "differs from recency" and soft-skips when `memory.search` semantic is unadvertised — no host re-implements a retriever to satisfy `injectionBudget`.
3. Should `query` support structured filters (`memory.search` `filter` mode) too, or stay a free-text semantic anchor? (Lean: free-text now; `filter` is a follow-on that also routes through `memory.search`.)

## Implementation notes (non-normative)

- A recency-only host implements this cheaply (sort + token-accumulate) and advertises `memory.injectionBudget` WITHOUT `memory.search` — `relevance` is simply unavailable there, no retriever required.
- **Reconcile with openwop-app ADR 0148 A4 (host-internal memory budget):** the Tier-A internal budget calls `list({ tokenBudget })` rather than a private path — this Tier-B `MemoryListOptions` surface IS the contract the A4 lever uses, one model not two.
- Uses the same `tokenCounter` enum values as RFC 0111 plans, so transcript (0111) and memory (0113) budgets are denominated consistently once both land.

## Acceptance criteria

- [x] Spec text merged (`agent-memory.md` §injection budget).
- [x] `capabilities.schema.json` updated.
- [x] `memory-injection-budget.test.ts` (incl. SR-1/CTI-1 re-assertion) in the suite.
- [x] CHANGELOG entry.
- [x] Reference host advertises `memory.injectionBudget` and passes, or impl deferred.

## References

- `spec/v1/agent-memory.md` (RFC 0068) lines 25–48 (`MemoryAdapter`/`MemoryListOptions`), §SR-1 (line 64), §CTI-1 (line 52); RFC 0062 distillation (lines 136–147).
- `SECURITY/threat-model-secret-leakage.md` (SR-1), cross-tenant invariant in `SECURITY/invariants.yaml`.
- Prior art: RAG top-k retrieval; LangChain memory; vector-store budgeted context.
- Sibling RFCs: 0111, 0112, 0114, 0115, 0116.
