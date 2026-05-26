# RFC 0062: Scheduled memory distillation — "dreams" (`memory.distillation`)

| Field | Value |
|---|---|
| **RFC** | 0062 |
| **Title** | A `memory.distillation` capability — scheduled, token-budgeted background compaction runs reusing RFC 0012's `memory.compacted` event (with an additive optional `distillation` sub-object), writing a stable archive + a memory-index workspace file; composing RFC 0012 (compaction) + RFC 0052 (scheduling) + RFC 0004 (memory) into the "dream" pattern |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 (Active → Accepted — Milestone 2: the in-memory reference host advertises `capabilities.memory.distillation` and implements the `POST /v1/host/sample/memory/distill` seam end-to-end — §B budgeted run (`tokensUsed ≤ tokenBudget`; an un-meetable budget fails atomically with `token_budget_exceeded`, no partial archive), a byte-stable JCS+SHA-256 archive checksum, a retrievable `MEMORY-INDEX.json` workspace file (composing RFC 0059) on `indexEmitted`, and SR-1 carry-forward (a redacted secret never re-enters the archive). The `memory.compacted` event carries the additive `distillation` sub-object — no new event type. All five `distillation-*.test.ts` scenarios are live + green. No new SECURITY invariant (SR-1 holds at the RFC 0012 layer).) |
| **Affects** | `schemas/capabilities.schema.json` (`memory.distillation` sub-block, nested under `memory`) · `spec/v1/agent-memory.md` (distillation contract) · `spec/v1/run-options.md` (reserved key `distillation.tokenBudget`) · `schemas/run-event-payloads.schema.json` (additive optional `distillation` sub-object on `memoryCompacted`) · `spec/v1/rest-endpoints.md` (register `token_budget_exceeded`) · `RFCS/0012` (reuses `memory.compacted`) · `RFCS/0052` (scheduling trigger) · `RFCS/0059` (memory-index as a workspace file) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

A "dream" is a periodic background run that distills recent transactional memory into long-term artifacts under an explicit token budget, then updates a retrieval index used at the next session's startup. openwop already has the halves — RFC 0012 defines host-managed *compaction* (lossy distillation + the `memory.compacted` event), and RFC 0052 defines *scheduled* run initiation — but nothing binds them, pins a *token budget*, or defines the *retrieval index* that closes the loop back to startup. This RFC adds an additive `memory.distillation` capability that composes them: a scheduled compaction run reads memory (RFC 0004), applies a mandatory token budget, runs RFC 0012 compaction, writes a stable archive plus a memory-index manifest (a workspace file per RFC 0059), and emits the **existing `memory.compacted` event with an additive optional `distillation` sub-object** carrying budget metadata — not a parallel `memory.distilled` event.

## Motivation

The feature set's product story: "an agent runs nightly memory distillation so it can synthesize learnings without manual prompting… cron @ 23:00 triggers a DREAM-ROUTINE with token budgets; output appended to archives and indices updated for next-day retrieval." The constraints section is explicit that **token budgets are mandatory** — "token budgets / context windows can cause memory retrieval failures if misconfigured; dreams must have explicit budgets."

Today RFC 0012 compaction exists and the `examples/hosts/postgres` host even implements `runCompaction()`, but: (a) nothing schedules it — it is trigger-on-demand only; (b) there is no token-budget contract, so distillation can blow a context window; (c) there is no *index* the next run reads, so distilled output is written but not made discoverable at startup. The `apps/workflow-engine` demo neither advertises nor wires any of it.

The spec is the right place because "distillation ran on schedule, stayed within its token budget, produced a stable archive, and updated the index the next run reads" are interop + correctness guarantees an operator depends on for unattended overnight runs.

## Proposal

### §A — `capabilities.schema.json`: `memory.distillation` sub-block (additive, nested under `memory`)

```diff
   "memory": {
     "properties": {
       "compaction": { "...": "RFC 0012 (unchanged)" },
+      "distillation": {
+        "type": "object",
+        "description": "RFC 0062. Scheduled, token-budgeted distillation built on compaction (RFC 0012) + scheduling (RFC 0052). A distillation run is a compaction run with a budget + schedule + index.",
+        "required": ["supported"],
+        "additionalProperties": false,
+        "properties": {
+          "supported": { "type": "boolean" },
+          "maxTokenBudget": { "type": "integer", "minimum": 1, "description": "Largest per-run distillation token budget the host honors." },
+          "scheduled": { "type": "boolean", "description": "Host can initiate distillation on a schedule (requires host.scheduling, RFC 0052). Distillation MAY also run on-demand without scheduling." },
+          "indexEmitted": { "type": "boolean", "description": "Host writes a retrievable memory-index manifest after distillation." },
+          "tokenizerName": { "type": "string", "description": "Identifier of the tokenizer the budget is counted against (e.g. `claude`, `gpt-4`). The budget is best-effort-honest per this tokenizer, not byte-exact." }
+        }
+      }
     }
   }
```

### §B — distillation run contract (normative, when `memory.distillation.supported: true`)

A distillation run — whether scheduled (RFC 0052 `schedule` trigger targeting the distillation handler) or on demand — MUST:

1. **Read** the source `memoryRef`'s entries via the RFC 0004 read snapshot (deterministic input).
2. **Apply a token budget** — a `tokenBudget` (≤ advertised `maxTokenBudget`), supplied via the `run-options.md` reserved key `distillation.tokenBudget` (clamped to `maxTokenBudget`); absent ⇒ the host MUST default to `maxTokenBudget`. The budget caps *input + output* token accounting, counted against the advertised `tokenizerName` (best-effort-honest). If the source cannot be meaningfully distilled within the budget the run MUST fail with **`token_budget_exceeded`** and write no partial archive (atomic). (`token_budget_exceeded` is registered in `rest-endpoints.md` by this RFC — it is present in the SDK error vocabulary but not yet in the spec's error-code list.)
3. **Distill** via the RFC 0012 compaction mechanism (carrying forward the SR-1 redaction invariant — a distilled archive MUST NOT re-expose a secret the sources had redacted).
4. **Write a stable archive** — the distilled output is an immutable, addressable artifact (byte-stable for a given source set + budget, so it is reproducible + auditable).
5. **Update the memory-index manifest** when `indexEmitted: true` — a retrievable summary the next session loads at startup. Per RFC 0059 §"Unresolved", the index is stored as a workspace file (`MEMORY-INDEX.json`); updating it emits `workspace.updated` (RFC 0059), not a bespoke index event.
6. **Emit the existing `memory.compacted` event** (RFC 0012) — extended with an additive optional `distillation` sub-object. The `trigger` field stays within RFC 0012's closed enum (`host-managed` for a scheduled distillation — the host owns the schedule; clients don't request it on-demand):

```diff
   "memoryCompacted": {
     "properties": {
       "memoryRef": { "...": "unchanged" },
       "trigger":   { "enum": ["host-managed", "client-requested", "both"], "...": "unchanged" },
       "sourceCount": { "...": "unchanged" }, "byteSize": { "...": "unchanged" },
+      "distillation": {
+        "type": "object",
+        "description": "RFC 0062. Present when this compaction is part of a budgeted distillation run.",
+        "properties": {
+          "tokenBudget":  { "type": "integer", "minimum": 1 },
+          "tokensUsed":   { "type": "integer", "minimum": 0 },
+          "indexUpdated": { "type": "boolean" }
+        }
+      }
     }
   }
```

**Positive example.** Nightly schedule (RFC 0052, `0 23 * * *`) fires a distillation run with `tokenBudget: 8000`; it distills 412 entries into one archive using 7,611 tokens, updates the index (`workspace.updated`), emits `memory.compacted { trigger: 'host-managed', distillation: { tokenBudget: 8000, tokensUsed: 7611, indexUpdated: true } }`. Next morning's run loads the index at startup.
**Negative example.** `tokenBudget: 100` against a 400-entry corpus that cannot be distilled under 100 tokens → `token_budget_exceeded { details: { budget: 100, minimumRequired: ~900 } }`; no partial archive (atomic).

### §C — relationship to the cohort

- **RFC 0012** — distillation *is* compaction with a budget + schedule + index wrapped around it; it reuses `memory.compacted` (+ the optional `distillation` sub-object), not a new event. RFC 0012's block + the existing payload are unchanged for consumers that ignore the sub-object.
- **RFC 0052** — supplies the schedule; `scheduled: true` requires `host.scheduling`.
- **RFC 0059** — the index manifest is a workspace file; its update rides `workspace.updated`.
- **RFC 0004** — source reads use the memory snapshot; CTI-1 tenant isolation holds for the archive.

## Compatibility

**Additive.** New optional `memory.distillation` sub-block; new optional `distillation.tokenBudget` reserved key; an additive optional `distillation` sub-object on the existing `memory.compacted` payload (its `required` array unchanged; consumers that only know RFC 0012 ignore the sub-object). The `trigger` enum is **unchanged** (distillation emits `host-managed`). `token_budget_exceeded` is a new error code (no existing code changes meaning). Hosts without the block keep on-demand compaction (RFC 0012) or no memory. No existing surface changes. No conformance pass invalidated.

## Conformance

- **`distillation-shape.test.ts`** — `memory.distillation` block validates; `maxTokenBudget` positive; the `distillation` sub-object on `memory.compacted` validates. (Always-on.)
- **`distillation-token-budget.test.ts`** — within budget: `memory.compacted` carries `distillation.tokensUsed ≤ tokenBudget`; un-meetable budget → `token_budget_exceeded`, no partial archive. (Gated on `memory.distillation.supported`.)
- **`distillation-stable-archive.test.ts`** — same source set + budget ⇒ byte-stable archive. (Gated.)
- **`distillation-index-roundtrip.test.ts`** — after distillation the memory-index workspace file is retrievable + a `workspace.updated` event fired. (Gated on `indexEmitted` + `host.workspace.supported`.)
- **`distillation-secret-carryforward.test.ts`** — a redacted secret in source memory stays redacted in the archive (SR-1). (Gated; composes with the redaction suite.)

The four gated scenarios drive the **memory-distillation seam** `POST /v1/host/sample/memory/distill` (request `{ memoryRef, tokenBudget?, sources?, indexEmitted?, includeSecretCanary? }` → `{ event, archiveChecksum, indexUpdated, indexFile? }`), specified in [`host-sample-test-seams.md`](../spec/v1/host-sample-test-seams.md) §"Open seams". A host advertising `capabilities.memory.distillation.supported: true` wires it to light them up; they soft-skip on `404` until then.

## Alternatives considered

1. **A new `memory.distilled` event** (the author's first draft). Rejected — it duplicates `memory.compacted` (RFC 0012), splitting the compaction observability stream so an existing `memory.compacted` consumer misses scheduled distillations. Reusing `memory.compacted` + an additive optional `distillation` sub-object is the lower-surface-area path (the RFC 0058 `cap.breached` precedent).
2. **Add `"scheduled"` to the `trigger` enum.** Rejected — RFC 0012's `trigger` enum is closed and discriminates *who controls the trigger* (host vs client), not *how the host schedules it*. A scheduled distillation is `host-managed`; its scheduled nature is evident from the `distillation` sub-object + the initiating `schedule` trigger.
3. **A distillation pipeline independent of RFC 0012.** Rejected — duplicates the compaction mechanism + its SR-1 carry-forward invariant.

## Unresolved questions

1. **Token accounting authority.** The budget is counted against the advertised `tokenizerName`, best-effort-honest (±margin), not byte-exact. Conformance uses a reference tokenizer with a tolerance. Confirm the tolerance before Active.
2. **Archive retention / GC.** How long must archives persist; can distillation distill prior archives (recursive)? Proposed: advertise `archiveRetention`; recursive allowed, each level re-checks SR-1. Decide before Active.
3. **Index format.** `MEMORY-INDEX.json` (machine-loaded, normative) vs. a human-editable `.md` sibling. Proposed JSON normative. Confirm with RFC 0059.

## Phase-0 resolution (architect ruling, 2026-05-25)

Per `docs/autonomous-agent-runtime-plan.md` §8 — Unresolved questions resolved (wire shape pinned; Active-ready pending schema + prose):

1. **Token accounting authority** → counted against an advertised `tokenizerName`, best-effort-honest; conformance tolerance **±10%**.
2. **Archive retention / GC** → advertise `archiveRetention` (ISO-8601 duration); recursive distillation allowed, each level re-checks SR-1.
3. **Index format** → `MEMORY-INDEX.json` normative (machine-loaded); optional human-editable `.md` sibling. The additive `distillation` sub-object on `memory.compacted` is confirmed non-breaking (ruling A; `additionalProperties:true`); `token_budget_exceeded` is a new error code registered in `rest-endpoints.md` (ruling C).

## Implementation notes (non-normative)

- `examples/hosts/postgres` already has `runCompaction()`; the reference wiring adds a budget guard, the archive write, the index workspace-file write, and the scheduled-trigger binding — emitting the extended `memory.compacted`. `apps/workflow-engine` advertises `memory.distillation` + wires the same. Depends on RFC 0052 (schedule) + RFC 0059 (index file). Gate RFC 0062 `Accepted` on RFC 0059 reaching at least a pinned workspace-file schema.
- SR-1 carry-forward lands at the RFC 0012 layer; no *new* invariant, but the distillation conformance scenario re-asserts it.

## Acceptance criteria

- [x] `agent-memory.md` distillation section (budget + stable archive + index + scheduled-trigger binding) + `distillation.tokenBudget` reserved key in `run-options.md` + `token_budget_exceeded` registered in `rest-endpoints.md`.
- [x] `memory.distillation` block (schema) + additive optional `distillation` sub-object on `memoryCompacted` (run-event-payloads schema). No new event type.
- [x] Conformance: shape always-on; budget/archive/index/secret-carryforward capability-gated — all five `distillation-*.test.ts` scenarios live + green against the in-memory host.
- [x] CHANGELOG entry under `[1.1.4 — unreleased]`.
- [x] **Milestone 2 — reference-host enforcement (`Active → Accepted`).** The in-memory reference host (`examples/hosts/in-memory`) advertises `capabilities.memory.distillation { supported, maxTokenBudget, scheduled: false, indexEmitted: true, tokenizerName, archiveRetention }` and implements the `POST /v1/host/sample/memory/distill` seam: §B runs a budgeted distillation (`tokensUsed ≤ tokenBudget`; a budget below the corpus minimum fails atomically with `token_budget_exceeded` and writes no partial archive), produces a byte-stable JCS+SHA-256 `archiveChecksum` (same sources ⇒ same digest), writes a content-free `MEMORY-INDEX.json` workspace file via the RFC 0059 store on `indexEmitted`, and SR-1-scrubs the corpus before archiving so a redacted secret never re-appears. The `memory.compacted` event carries the additive `distillation` sub-object — no new event type, no new SECURITY invariant (SR-1 holds at the RFC 0012 layer). **On-demand only:** `scheduled: false` (no `capabilities.scheduling` on this host — a scheduled trigger composes RFC 0052 on a scheduling host); the host has no production `MemoryAdapter`, so distillation is seam-demonstrated.

## References

- [`RFCS/0012-memory-compaction-profile.md`](./0012-memory-compaction-profile.md) — the compaction mechanism + `memory.compacted` event this reuses + extends.
- [`RFCS/0052-scheduling-and-time-based-triggers.md`](./0052-scheduling-and-time-based-triggers.md) — the schedule that initiates a dream.
- [`RFCS/0059-agent-workspace.md`](./0059-agent-workspace.md) — the durable layer the index manifest rides (`workspace.updated`).
- [`spec/v1/agent-memory.md`](../spec/v1/agent-memory.md) — read snapshot + SR-1 / CTI-1 invariants.
