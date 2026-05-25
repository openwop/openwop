# RFC 0062: Scheduled memory distillation — "dreams" (`memory.distillation`)

| Field | Value |
|---|---|
| **RFC** | 0062 |
| **Title** | A `memory.distillation` capability — scheduled, token-budgeted background compaction runs that read transactional memory, distill it under an explicit budget, write a stable archive + a retrievable memory-index manifest, and emit `memory.distilled`; composing RFC 0012 (compaction) + RFC 0052 (scheduling) + RFC 0004 (memory) into the "dream" pattern |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 |
| **Affects** | `schemas/capabilities.schema.json` (`memory.distillation` sub-block) · `spec/v1/agent-memory.md` (distillation contract) · `spec/v1/run-options.md` (reserved key `distillation.tokenBudget`) · `api/asyncapi.yaml` (`memory.distilled` event) · `RFCS/0012` (extends `memory.compacted`) · `RFCS/0052` (scheduling trigger) · `RFCS/0059` (memory-index as a workspace file) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

A "dream" is a periodic background run that distills recent transactional memory into long-term artifacts under an explicit token budget, then updates a retrieval index used at the next session's startup. openwop already has the two halves — RFC 0012 defines host-managed *compaction* (lossy distillation + a `memory.compacted` event), and RFC 0052 defines *scheduled* run initiation — but nothing binds them, pins a *token budget*, or defines the *retrieval index* that closes the loop back to startup. This RFC adds an additive `memory.distillation` capability that composes the two: a scheduled distillation run reads memory (RFC 0004), applies a mandatory token budget, runs compaction (RFC 0012), writes a stable archive plus a memory-index manifest (as a workspace file per RFC 0059), and emits `memory.distilled` with budget + scheduling metadata.

## Motivation

The feature set's product story: "an agent runs nightly memory distillation so it can synthesize learnings without manual prompting… cron @ 23:00 triggers a DREAM-ROUTINE with token budgets; output appended to archives and indices updated for next-day retrieval." The constraints section is explicit that **token budgets are mandatory** — "token budgets / context windows can cause memory retrieval failures if misconfigured; dreams must have explicit budgets."

Today RFC 0012 compaction exists and the `examples/hosts/postgres` host even implements `runCompaction()`, but: (a) nothing schedules it — it is trigger-on-demand only; (b) there is no token-budget contract, so distillation can blow a context window; (c) there is no *index* the next run reads, so distilled output is written but not made discoverable at startup. The result is that the `apps/workflow-engine` demo neither advertises nor wires any of it.

The spec is the right place because "distillation ran on schedule, stayed within its token budget, produced a stable archive, and updated the index the next run reads" are interop + correctness guarantees an operator depends on for unattended overnight runs.

## Proposal

### §A — `capabilities.schema.json`: `memory.distillation` sub-block (additive, nested under `memory`)

```diff
   "memory": {
     "properties": {
       "compaction": { "...": "RFC 0012 (unchanged)" },
+      "distillation": {
+        "type": "object",
+        "description": "RFC 0062. Scheduled, token-budgeted background distillation built on compaction (RFC 0012) + scheduling (RFC 0052).",
+        "required": ["supported"],
+        "additionalProperties": false,
+        "properties": {
+          "supported": { "type": "boolean" },
+          "maxTokenBudget": { "type": "integer", "minimum": 1, "description": "Largest per-run distillation token budget the host honors." },
+          "scheduled": { "type": "boolean", "description": "Host can initiate distillation on a schedule (requires host.scheduling, RFC 0052)." },
+          "indexEmitted": { "type": "boolean", "description": "Host writes a retrievable memory-index manifest after distillation." }
+        }
+      }
     }
   }
```

### §B — distillation run contract (normative, when `memory.distillation.supported: true`)

A distillation run — whether scheduled (RFC 0052 `schedule` trigger targeting the distillation handler) or invoked on demand — MUST:

1. **Read** the source `memoryRef`'s entries via the RFC 0004 read snapshot (deterministic input).
2. **Apply a token budget** — a `tokenBudget` (≤ advertised `maxTokenBudget`) caps the distillation's *input + output* token accounting. The caller supplies it via the `run-options.md` reserved key `distillation.tokenBudget` (clamped to `maxTokenBudget`); when absent, the host MUST default to `maxTokenBudget`. If the source exceeds the budget the host MUST distill within it (e.g. prioritized/windowed), never silently exceed it; a budget that cannot be met returns `token_budget_exceeded` (existing code).
3. **Distill** via the RFC 0012 compaction mechanism (carrying forward the SR-1 redaction invariant — a distilled archive MUST NOT re-expose a secret the sources had redacted).
4. **Write a stable archive** — the distilled output is an immutable, addressable artifact (stable bytes for a given source set + budget, so it is reproducible and auditable).
5. **Update the memory-index manifest** when `indexEmitted: true` — a retrievable summary (`{ archiveId, entryCount, tokenCount, distilledAt, tags }`) that the next session loads at startup. Per RFC 0059 §"Unresolved", the index SHOULD be stored as a workspace file (`MEMORY-INDEX.md` / its JSON sibling) so it rides the same durable layer.
6. **Emit `memory.distilled`** — extends RFC 0012's `memory.compacted` with distillation metadata:

```json
{ "type": "memory.distilled", "runId": "run-…",
  "data": { "memoryRef": "…", "sourceCount": 412, "archiveId": "arch-…",
            "tokenBudget": 8000, "tokensUsed": 7611, "trigger": "scheduled",
            "indexUpdated": true } }
```

**Positive example.** Nightly schedule (RFC 0052, `0 23 * * *`) fires a distillation run with `tokenBudget: 8000`; it distills 412 entries into one archive using 7,611 tokens, updates the index, emits `memory.distilled { trigger: 'scheduled' }`. Next morning's run loads the index at startup.
**Negative example.** `tokenBudget: 100` against a 400-entry corpus that cannot be meaningfully distilled under 100 tokens → `token_budget_exceeded { details: { budget: 100, minimumRequired: ~900 } }`; no partial archive is written (atomic).

### §C — relationship to the cohort

- **RFC 0012** — distillation *is* compaction with a budget + schedule + index wrapped around it; `memory.distilled` is `memory.compacted` plus the new metadata. RFC 0012's block is unchanged.
- **RFC 0052** — supplies the schedule that initiates a distillation run; `scheduled: true` requires `host.scheduling`.
- **RFC 0059** — the index manifest is a workspace file, closing the loop back to startup retrieval.
- **RFC 0004** — source reads use the memory snapshot; CTI-1 tenant isolation holds for the archive.

## Compatibility

**Additive.** New optional `memory.distillation` sub-block; new optional `run-options.md` reserved key `distillation.tokenBudget`; `memory.distilled` is additive observability (`memory.compacted` semantics unchanged for consumers that only know that event). Hosts without the block are unaffected — they keep on-demand compaction (RFC 0012) or no memory at all. No existing surface changes. No conformance pass invalidated.

## Conformance

- **`distillation-shape.test.ts`** — `memory.distillation` block validates; `maxTokenBudget` positive. (Always runs.)
- **`distillation-token-budget.test.ts`** — a distillation within budget succeeds and reports `tokensUsed ≤ tokenBudget`; one that cannot meet budget returns `token_budget_exceeded` with no partial archive. (Gated on `memory.distillation.supported`.)
- **`distillation-stable-archive.test.ts`** — same source set + budget ⇒ byte-stable archive (reproducible). (Gated.)
- **`distillation-index-roundtrip.test.ts`** — after distillation the memory-index manifest is retrievable and reflects the new archive. (Gated on `indexEmitted`.)
- **`distillation-secret-carryforward.test.ts`** — a redacted secret in source memory stays redacted in the distilled archive (SR-1). (Gated; composes with the redaction suite.)

## Alternatives considered

1. **Just tell hosts to schedule RFC 0012 compaction themselves.** Rejected — that leaves the token budget, the stable-archive guarantee, and the retrieval index undefined, so two hosts' "nightly distillation" would not be portable or auditable, and the misconfiguration risk the feature set warns about is unaddressed.
2. **A new distillation pipeline independent of RFC 0012.** Rejected — duplicates the compaction mechanism and its SR-1 carry-forward invariant; composition reuses the audited path.
3. **Store the index as a new top-level surface, not a workspace file.** Rejected — RFC 0059 already gives a durable, versioned, tenant-scoped file layer; a second store fragments retrieval.

## Unresolved questions

1. **Token accounting authority.** Whose tokenizer counts the budget — the host's, or a normative reference? Proposed: host-advertised tokenizer id; budget is best-effort-honest, not byte-exact. Resolve before Active.
2. **Archive retention / GC.** How long must archives persist, and can distillation distill prior archives (recursive)? Proposed: advertise `archiveRetention`; recursive distillation allowed but each level re-checks SR-1. Decide before Active.
3. **Index format.** Markdown (`MEMORY-INDEX.md`, human-editable) vs. JSON (machine-loaded) vs. both? Proposed both, with JSON normative for loading. Confirm with RFC 0059.

## Implementation notes (non-normative)

- `examples/hosts/postgres` already has `runCompaction()`; the reference wiring adds a budget guard, the archive write, the index manifest, and the scheduled trigger binding. `apps/workflow-engine` would advertise `memory.distillation` and wire the same. Depends on RFC 0052 (schedule) + RFC 0059 (index file).
- SR-1 carry-forward already lands at the RFC 0012 layer; no *new* invariant, but the distillation conformance scenario re-asserts it.

## Acceptance criteria

- [ ] `agent-memory.md` distillation section (budget + stable archive + index + scheduled-trigger binding) + `distillation.tokenBudget` reserved key in `run-options.md`.
- [ ] `memory.distillation` block + `memory.distilled` (AsyncAPI + payload schema).
- [ ] Conformance: shape always-on; budget/archive/index/secret-carryforward capability-gated.
- [ ] CHANGELOG entry under `[1.1.4 — unreleased]`.
- [ ] A host runs a scheduled distillation within budget and updates a retrievable index, or the RFC defers reference-host wiring.

## References

- [`RFCS/0012-memory-compaction-profile.md`](./0012-memory-compaction-profile.md) — the compaction mechanism + `memory.compacted` this extends.
- [`RFCS/0052-scheduling-and-time-based-triggers.md`](./0052-scheduling-and-time-based-triggers.md) — the schedule that initiates a dream.
- [`RFCS/0059-agent-workspace.md`](./0059-agent-workspace.md) — the durable layer the index manifest rides.
- [`spec/v1/agent-memory.md`](../spec/v1/agent-memory.md) — read snapshot + SR-1 / CTI-1 invariants.
