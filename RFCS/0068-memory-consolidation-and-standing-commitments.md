# RFC 0068: Memory consolidation + standing commitments

| Field | Value |
|---|---|
| **RFC** | 0068 |
| **Title** | Background memory consolidation (merge/dedup/strengthen of long-term entries) + inferred standing commitments — two additive optional capabilities (`agents.memoryConsolidation` + `agents.commitments`) with their own content-free observability events (`agent.memory.consolidated` + `commitment.fired`), distinct from RFC 0062 token-budgeted distillation |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-26 |
| **Updated** | 2026-05-29 — promoted `Draft → Active`. The full wire surface already landed on `main` (the `agents.memoryConsolidation` + `agents.commitments` blocks in `capabilities.schema.json`; the `agentMemoryConsolidated` + `commitmentFired` payload defs + `_typeIndex` entries in `run-event-payloads.schema.json`; the two RunEventType enum members in `run-event.schema.json`; the §D normative prose in `agent-memory.md`; and the three conformance scenarios). All four `Active`-gating Unresolved questions are resolved below — #1 (the keystone replay-determinism question) confirmed against RFC 0041 §C: consolidation is a host-managed mutation outside the replay envelope, `agent.memory.consolidated` is an observability event re-read from the log per §C observable-output-sequence determinism, never regenerated. Comment window waived per `GOVERNANCE.md` lazy consensus. Reference-host behavioral implementation remains deferred per §Conformance (shape always-on; behavioral scenarios soft-skip until a host wires the seam). |
| **Affects** | `spec/v1/agent-memory.md` (new §"Background consolidation" + §"Inferred commitments") · `schemas/run-event-payloads.schema.json` (additive optional `agent.memory.consolidated` + `commitment.fired` payloads + `_typeIndex` entries) · `schemas/capabilities.schema.json` (`agents.memoryConsolidation.{supported,schedule}` + `agents.commitments.supported`) · `CHANGELOG.md` · `INTEROP-MATRIX.md` · 3 new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

A long-running agent accumulates many long-term `MemoryEntry` rows that overlap, contradict, or restate one another, and it forms *standing intentions* ("follow up next Monday", "remind me when the invoice clears") that should fire later without a fresh user turn. openwop has the read-only `MemoryAdapter` (RFC 0004), token-budgeted *distillation* of transactional → long-term memory (RFC 0062), the write-attribution event (RFC 0057), and scheduling (RFC 0052), but it has no contract for two distinct behaviors: (1) **background consolidation** — an idempotent merge/dedup/strengthen pass *within* long-term memory that does not collapse a budget window but reconciles the standing corpus; and (2) **inferred standing commitments** — a host promoting a memory-derived intention into a durable, time- or condition-gated arm that fires a run. This RFC adds two additive optional capabilities (`agents.memoryConsolidation`, `agents.commitments`) each with one content-free observability event (`agent.memory.consolidated`, `commitment.fired`). Both are optional/additive; hosts that omit them are unchanged, and the RFC carries an explicit **Unresolved questions** section on whether replay determinism holds through a consolidation pass.

## Motivation

The feature-gap analysis (`docs/OPENWOP-FEATURE-GAP-ANALYSIS.md` row 4) lists "memory: search, get, active-memory plugin, dreaming, inferred commitments." Three of those are already closed or in motion: read access is RFC 0004; "dreaming" as token-budgeted background compaction is RFC 0062 (`memory.distillation`); per-node provenance is RFC 0057. Two are **not** covered:

1. **Consolidation is not distillation.** RFC 0062 distills *recent transactional* memory into long-term artifacts under a *mandatory token budget*, emitting `memory.compacted` with a `distillation` sub-object. That is a forward funnel (many short-lived rows → fewer long-lived rows). It does not address the *standing* problem: a long-term corpus that, over months, contains near-duplicate facts, superseded preferences, and conflicting statements. Consolidation is a *reconciliation* pass over long-term entries — merge duplicates, supersede stale facts, strengthen corroborated ones — and is not budget-driven. Folding it into RFC 0062 would overload `memory.compacted` with a second, semantically different meaning; an observer watching the compaction stream would conflate "I distilled today's transcript" with "I reconciled the standing corpus." A distinct, content-free `agent.memory.consolidated` event keeps the two observable streams separable.
2. **Inferred commitments have no protocol home.** RFC 0052 scheduling and RFC 0058 wall-clock arms can *fire* a run on a clock; RFC 0060 heartbeat can fire on a predicate. But neither models a commitment *the agent inferred from memory* ("the user asked to be reminded when the contract is signed"). A commitment is a durable, agent-derived arm with a fire condition (time or predicate) and a memory provenance. When it fires it MUST be observable — but content-free, since the underlying intention text lives in SR-1-redacted memory, not on the event.

The spec is the right place because "a consolidation pass ran, reconciled N entries into M, and did not re-expose a redacted secret" and "a memory-derived commitment fired exactly once, attributable to its source memory" are cross-host interop + correctness + security guarantees an operator depends on for unattended long-running agents. The *algorithm* (which entries merge, how a contradiction is resolved, the inference model) stays a host choice; this RFC pins only the wire shape, the capability gate, and the invariants.

## Proposal

### §A — `capabilities.schema.json`: two additive optional sub-blocks under `agents`

```diff
   "agents": {
     "type": "object",
     "properties": {
       "supported":      { "...": "unchanged" },
       "memoryBackends": { "...": "unchanged — ['long-term']" },
+      "memoryConsolidation": {
+        "type": "object",
+        "description": "RFC 0068. Background reconciliation of LONG-TERM memory (merge/dedup/supersede/strengthen) — distinct from RFC 0062 token-budgeted distillation of TRANSACTIONAL memory. A host advertising this emits `agent.memory.consolidated` (content-free) after a consolidation pass. Requires `agents.memoryBackends` to include `long-term`. SR-1 carry-forward (RFC 0004 §SR-1) and CTI-1 (RFC 0004 §CTI-1) hold across the pass. Hosts that omit this block do not consolidate; the conformance scenarios skip cleanly.",
+        "additionalProperties": false,
+        "required": ["supported"],
+        "properties": {
+          "supported": { "type": "boolean", "description": "REQUIRED when the block is present. When true, the host performs background consolidation over long-term memory and emits `agent.memory.consolidated`." },
+          "schedule": { "type": "string", "enum": ["host-managed", "scheduled", "on-demand"], "description": "How a consolidation pass is initiated. `host-managed`: a host-internal cadence clients do not control (default when absent and supported:true). `scheduled`: bound to a `capabilities.scheduling` (RFC 0052) trigger. `on-demand`: the host runs a pass when explicitly requested. A host MAY honor more than one path but advertises the primary." }
+        }
+      },
+      "commitments": {
+        "type": "object",
+        "description": "RFC 0068. Inferred STANDING commitments — durable, memory-derived intentions the host promotes into a time- or predicate-gated arm that fires a run later, without a fresh user turn. When an arm fires the host emits `commitment.fired` (content-free — the intention text lives in SR-1-redacted memory). Composes RFC 0052 (time arms) / RFC 0060 (predicate arms) for the fire substrate. Hosts that omit this block do not infer commitments; the conformance scenario skips cleanly.",
+        "additionalProperties": false,
+        "required": ["supported"],
+        "properties": {
+          "supported": { "type": "boolean", "description": "REQUIRED when the block is present. When true, the host infers standing commitments from memory and emits `commitment.fired` when one fires." },
+          "fireConditions": { "type": "array", "items": { "type": "string", "enum": ["time", "predicate"] }, "uniqueItems": true, "description": "Which fire-condition kinds the host supports. `time` composes RFC 0052 scheduling; `predicate` composes RFC 0060 heartbeat. Absent ⇒ `['time']`." }
+        }
+      }
     },
     "additionalProperties": true
   }
```

### §B — `agent.memory.consolidated` event (additive, content-free)

Emitted by a host advertising `agents.memoryConsolidation.supported: true` after each consolidation pass completes — regardless of how the pass was initiated. Content-free: counts + the affected `memoryRef` only. The entry bodies are served by the SR-1-redacted read-side (`MemoryAdapter.get`); the event records a write that already happened and is re-read from the log on replay, never regenerated.

```diff
+    "agentMemoryConsolidated": {
+      "type": "object",
+      "description": "RFC 0068. Emitted by a host advertising `capabilities.agents.memoryConsolidation.supported: true` after a background consolidation pass over LONG-TERM memory. Content-free: identifiers + counts only — entry content is served by the SR-1-redacted read-side (`MemoryAdapter.get`). On replay the event is re-read from the log, never regenerated. Distinct from RFC 0062 `memory.compacted` (token-budgeted distillation of transactional memory). SR-1 carry-forward (RFC 0004) + CTI-1 apply to the consolidated entries.",
+      "required": ["memoryRef", "inputCount", "outputCount"],
+      "properties": {
+        "memoryRef":     { "type": "string", "minLength": 1, "description": "Opaque MemoryAdapter handle (RFC 0004 §C) the consolidation pass operated over. Bounds the pass to a single memory scope (CTI-1)." },
+        "inputCount":    { "type": "integer", "minimum": 0, "description": "Long-term entries considered by the pass." },
+        "outputCount":   { "type": "integer", "minimum": 0, "description": "Long-term entries remaining after the pass. MUST be <= inputCount for a pass that only merges/dedups; a pass that also strengthens (no merge) MAY leave outputCount == inputCount." },
+        "mergedIds":     { "type": "array", "items": { "type": "string", "minLength": 1 }, "description": "MAY — ids of entries collapsed/superseded by the pass. Hosts MAY omit when inputCount is large; consumers MUST tolerate absence." },
+        "trigger":       { "type": "string", "enum": ["host-managed", "scheduled", "on-demand"], "description": "MAY — which initiation path drove this pass (mirrors `agents.memoryConsolidation.schedule`)." }
+      },
+      "additionalProperties": true
+    },
```

`_typeIndex`: `"agent.memory.consolidated": { "$ref": "#/$defs/agentMemoryConsolidated" }`.

### §C — `commitment.fired` event (additive, content-free)

Emitted by a host advertising `agents.commitments.supported: true` when an inferred standing commitment's fire condition is met. Content-free: a host-issued commitment id + provenance `memoryRef`/`memoryId` + the condition kind. The intention text and any payload live in SR-1-redacted memory; the event MUST NOT carry it.

```diff
+    "commitmentFired": {
+      "type": "object",
+      "description": "RFC 0068. Emitted by a host advertising `capabilities.agents.commitments.supported: true` when an inferred standing commitment fires. Content-free: identifiers + condition kind only — the intention text lives in SR-1-redacted memory (`MemoryAdapter.get(memoryRef, memoryId)`). The fired arm composes RFC 0052 (time) or RFC 0060 (predicate). On replay the event is re-read from the log, never regenerated (the host MUST NOT re-infer or re-fire a commitment at replay time). CTI-1: the commitment, its memory provenance, and any run it enqueues MUST share the source memory's tenant.",
+      "required": ["commitmentId", "memoryRef", "condition"],
+      "properties": {
+        "commitmentId": { "type": "string", "minLength": 1, "description": "Host-issued, stable id for the inferred commitment. Correlates repeated observability across re-evaluations of the same commitment." },
+        "memoryRef":    { "type": "string", "minLength": 1, "description": "Opaque MemoryAdapter handle of the memory scope the commitment was inferred from (provenance + CTI-1 tenant binding)." },
+        "memoryId":     { "type": "string", "minLength": 1, "description": "MAY — id of the source `MemoryEntry` the commitment was inferred from, when a single entry is attributable. Resolvable via `MemoryAdapter.get`; content is read SR-1-redacted from the read-side." },
+        "condition":    { "type": "string", "enum": ["time", "predicate"], "description": "Which fire-condition kind triggered. `time` composes RFC 0052; `predicate` composes RFC 0060." },
+        "enqueuedRunId":{ "type": "string", "minLength": 1, "description": "MAY — id of the run the fired commitment enqueued, when the host initiates one. Absent when the commitment fires as a notification without a run." }
+      },
+      "additionalProperties": true
+    },
```

`_typeIndex`: `"commitment.fired": { "$ref": "#/$defs/commitmentFired" }`.

### §D — agent-memory.md normative prose (two new sections)

**§"Background consolidation" (normative, when `agents.memoryConsolidation.supported: true`).** A consolidation pass MUST:
1. Operate over a single `memoryRef`'s long-term entries (CTI-1 — a pass MUST NOT read or write entries of another tenant).
2. Be **idempotent over a stable corpus** — running a pass twice over an unchanged corpus MUST NOT further reduce `outputCount` (a no-op second pass). This bounds runaway consolidation and is the testable surface.
3. Route every derived/merged entry's content through the same BYOK redaction harness applied to a fresh `put` (SR-1 carry-forward, RFC 0004 §SR-1) — a merged summary can introduce secret-shaped substrings not present in any source, exactly as RFC 0012 §D / RFC 0062 establish for compaction.
4. Emit `agent.memory.consolidated` with `inputCount`/`outputCount`/`memoryRef` after the pass.

Consolidation is **read-modify-write of long-term memory**; it is NOT a token-budgeted distillation of transactional memory (that is RFC 0062, which emits `memory.compacted`). A host MAY implement both; they are independent capabilities.

**§"Inferred commitments" (normative, when `agents.commitments.supported: true`).** A standing commitment is a host-inferred, durable intention with a fire condition. A host:
1. MUST bind each commitment to the `memoryRef` it was inferred from; the commitment, the fired event, and any enqueued run MUST share that memory's tenant (CTI-1).
2. MUST fire each commitment **at most once per satisfied condition** — a `time` commitment fires once per scheduled instant (reusing RFC 0052's once-per-tick guarantee); a `predicate` commitment fires once per state transition (reusing RFC 0060's anti-spam semantics). A host MUST NOT re-fire a commitment on replay.
3. MUST emit `commitment.fired` (content-free) when a commitment fires, and MUST NOT place the inferred intention text or any secret-bearing payload on the event (the read-side serves it SR-1-redacted).
4. MAY enqueue a run when a commitment fires; when it does, the run inherits the source memory's tenant and the `enqueuedRunId` is reported on the event.

### Examples

**Positive (consolidation).** A nightly host-managed pass reads 240 long-term entries for `mem://support/agent-7`, merges 31 near-duplicate refund-policy notes into 4 and supersedes 12 stale price facts, leaving 201 entries; emits `agent.memory.consolidated { memoryRef: "mem://support/agent-7", inputCount: 240, outputCount: 201, trigger: "host-managed" }`. A second pass that night over the unchanged corpus is a no-op (`inputCount == outputCount`).

**Positive (commitment).** From a user turn "remind me when the SOC2 report is filed," the host infers a predicate commitment bound to `mem://legal/agent-2` entry `mem-88`. When the host's heartbeat (RFC 0060) detects the filing, it fires once: `commitment.fired { commitmentId: "cmt-...", memoryRef: "mem://legal/agent-2", memoryId: "mem-88", condition: "predicate", enqueuedRunId: "run-..." }`.

**Negative.** A host emits `commitment.fired { commitmentId, condition: "time" }` *without* `memoryRef` → fails schema validation (`memoryRef` required) — a commitment with no memory provenance is not an *inferred* commitment and breaks the CTI-1 tenant binding. A host that emits the inferred intention text in the event payload violates §C / the SR-1 posture even though `additionalProperties: true` would let the field through (the no-content invariant is the semantic constraint).

## Compatibility

**Additive.** Two new optional capability sub-blocks under `agents` (which keeps `additionalProperties: true`); two new optional event types (consumers that don't recognize them fold best-effort per `observability.md §"Forward-compat"`). No existing field, event, error code, or endpoint changes. No existing required array changes. Hosts that omit both blocks behave exactly as today. No conformance pass is invalidated.

Forward-compatibility clauses:
- New capability blocks are optional with no default emission by old hosts; the scenarios gate on the advertisement.
- New event types are additive RunEventTypes; existing consumers ignore unknown types. The `run-event.schema.json#$defs.RunEventType` enum gains two members additively (a consumer pinned to the old enum tolerates unknown types per the spec's fold-best-effort rule).
- Both events are content-free and re-read from the log on replay — they introduce no new replay-regeneration surface (see Unresolved questions on consolidation determinism).

## Conformance

- **Existing coverage.** `agentMemoryRoundTrip.test.ts`, `agentMemoryCrossTenantIsolation.test.ts` (CTI-1), `agentMemoryRedactionContract.test.ts` (SR-1), `memory-compaction-sr1-carry-forward.test.ts`, and (RFC 0062) the `distillation-*.test.ts` family cover adjacent memory surface. None cover consolidation or commitments.
- **New scenarios (3):**
  - **`memory-consolidation-shape.test.ts`** — always-on schema-shape probe: `agents.memoryConsolidation` + `agents.commitments` blocks validate; the `agent.memory.consolidated` + `commitment.fired` payloads validate against their `$defs`; a `commitment.fired` missing `memoryRef` is rejected (negative). (Always-on — drives the schemas, no host behavior.)
  - **`memory-consolidation-idempotent.test.ts`** — gated on `capabilities.agents.memoryConsolidation.supported`: a consolidation pass emits `agent.memory.consolidated` with `outputCount <= inputCount`, and a second pass over the unchanged corpus is a no-op (`inputCount == outputCount`) — the §D idempotence MUST. Also asserts SR-1 carry-forward over a consolidated entry (composes the redaction harness). Soft-skips on absent advertisement.
  - **`commitment-fired.test.ts`** — gated on `capabilities.agents.commitments.supported`: a fired commitment emits a content-free `commitment.fired` with `memoryRef` provenance + fire-once-per-condition; the event MUST NOT carry the inferred intention text (no-content assertion). Soft-skips on absent advertisement.
- **Fixtures.** A consolidation fixture (a long-term `memoryRef` seeded with duplicate/stale entries) + a commitment fixture (a memory entry tagged as a standing intention) under `conformance/fixtures/`, registered in `conformance/fixtures.md`. The behavioral assertions drive a documented host seam (`POST /v1/host/sample/memory/consolidate` + `.../commitment/fire`), staged per the RFC 0027 §G precedent — they soft-skip on `404` until a reference host wires the seam.
- **Capability gating.** Per `conformance/coverage.md`: shape always-on; behavioral scenarios gated on `agents.memoryConsolidation.supported` / `agents.commitments.supported` respectively.
- **Reference host.** Deferred to a follow-up milestone (this RFC lands at `Draft`). Shape + schema validation ship now; behavioral assertions soft-skip until a host advertises.
- **INTEROP-MATRIX.** A new "Capability adoption — RFC 0068 memory consolidation + commitments" row is added (status: no host advertises yet — Draft).

## Alternatives considered

1. **Extend RFC 0062 `memory.distillation` to cover consolidation** (reuse `memory.compacted`). Rejected — distillation is token-budgeted and operates on *transactional → long-term*; consolidation is unbudgeted and operates *within long-term*. Overloading `memory.compacted` would make the two indistinguishable on the observability stream and force a budget contract onto a reconciliation pass that has none. A distinct content-free event is the lower-confusion path (mirrors how RFC 0057 `memory.written` stayed separate from `memory.compacted`).
2. **Model commitments as plain RFC 0052 schedules / RFC 0060 heartbeats** with no new event. Rejected — those substrates *fire* the arm, but neither carries the *memory provenance* (`memoryRef`/`memoryId`) that makes a commitment "inferred." Without provenance the CTI-1 tenant binding and the auditability ("which memory did this come from?") are lost. The new event composes those substrates rather than replacing them.
3. **Do nothing.** Rejected — the gap analysis explicitly flags consolidation and inferred commitments as the two uncovered memory behaviors. Without a content-free event contract, hosts that build them will each invent a vendor-prefixed event, and fleet operators lose a canonical vocabulary (the same observability argument RFC 0012 §"Why this exists" makes for compaction). "Do nothing" is worse because divergent vendor extensions are harder to reconcile later than an additive spec contract now.

## Unresolved questions

1. **Replay determinism through a consolidation pass.** ✅ **RESOLVED (2026-05-29, `Active` gate) — option (a), confirmed against RFC 0041 §C.** A consolidation pass is modeled as a *host-managed background mutation* (like RFC 0062 distillation), explicitly **outside the replay envelope**. RFC 0041 §C pins the replay contract as *observable-output-sequence determinism, not bit-equivalent execution determinism*: the `RunEventDoc` records at event-log indices `[0, fromSeq]` MUST be byte-equivalent between original and replay (modulo per-region clock fields), and hosts cache the *observable result* rather than re-executing. Therefore: a run sees consolidated memory only via the deterministic read-snapshot the event log records; `agent.memory.consolidated` is an **observability event re-read from the log on replay, never regenerated** — a host MUST NOT re-run a consolidation pass at replay time. A run MUST NOT *trigger* a consolidation pass that mutates its own read-snapshot mid-run (the mid-run-triggered path stays out of scope at `Active`). This is exactly the posture the landed `agent-memory.md §"Background consolidation"` prose now states normatively, and it reuses RFC 0062's established "host-managed mutation, replayed run re-reads the snapshot" model — no new replay-regeneration surface.
2. **Idempotence tolerance.** ✅ **RESOLVED (2026-05-29, `Active` gate): exact, count-based — no tolerance window.** The §D rule-2 MUST is `inputCount == outputCount` on a second pass over an unchanged corpus, and the conformance assertion (`memory-consolidation-idempotent.test.ts`) is purely count-based. A strengthen-only pass (rewrites corroboration weights / recency without merging) is **count-neutral** — it leaves `outputCount == inputCount` — so it already satisfies the exact bar without any tolerance; the idempotence assertion does not inspect entry content or timestamps, so a strengthening rewrite does not perturb it. Exact count equality is the right and testable bar; no fuzz is introduced.
3. **Commitment lifecycle observability.** ✅ **RESOLVED (2026-05-29, `Active` gate): `fired`-only at `Active`.** `commitment.fired` is the minimal content-free observable that closes the gap-analysis "inferred commitments" item. A `commitment.inferred` (creation) + `commitment.cancelled` (revocation) lifecycle pair is **deferred to a follow-up RFC** — both would be additive new RunEventTypes that compose cleanly on top of `commitment.fired` without breaking it, so they need not block `Active`. An implementer needing the full create/cancel audit trail can request them then.
4. **Consolidation + write-attribution interaction.** ✅ **RESOLVED (2026-05-29, `Active` gate): emit both when both capabilities are advertised; the consolidation `memory.written` omits `nodeId`.** When a host advertises BOTH `agents.memoryConsolidation` AND RFC 0057 `memory.attribution`, a consolidation-pass write MAY emit RFC 0057 `memory.written` for each new/merged entry in addition to the pass-level `agent.memory.consolidated`. A consolidation pass is a host-managed *background* writer, not a workflow node, so its `memory.written` **SHOULD omit `nodeId`** — RFC 0057 §B already permits writes with no node attribution ("e.g. host session-end auto-memory"). The pass-level attribution is carried by `agent.memory.consolidated` (which names the `memoryRef` + counts); a host wanting finer attribution MAY set `agentId` to a host-chosen consolidation identifier but MUST NOT fabricate a workflow `nodeId` for a non-node writer. This introduces **no new reserved-id convention** and stays consistent with RFC 0057's existing no-node-attribution carve-out.

## Implementation notes (non-normative)

- Sequencing: ships *after* RFC 0062 (which it cites for the distillation contrast) and composes RFC 0052 / RFC 0060 for commitment fire substrates and RFC 0057 for the write-attribution interaction. No hard dependency ordering for the *schema* additions; the *behavioral* host seam depends on a MemoryAdapter being wired.
- The in-memory reference host has no production MemoryAdapter, so a behavioral implementation would be seam-demonstrated (mirroring RFC 0062's `scheduled: false` posture). A Postgres-backed host is the natural first behavioral implementer.
- Expected effort: M for the schema + prose + shape conformance (this PR); L for a behavioral reference implementation (deferred), dominated by the consolidation algorithm and the replay-determinism confirmation (Unresolved #1).

## Acceptance criteria

- [x] `agent-memory.md` §"Background consolidation" + §"Inferred commitments" (the §D normative contracts).
- [x] `capabilities.schema.json` carries `agents.memoryConsolidation` + `agents.commitments`; `run-event-payloads.schema.json` carries `agentMemoryConsolidated` + `commitmentFired` defs + `_typeIndex` entries; `run-event.schema.json` RunEventType enum gains the two event names.
- [x] 3 conformance scenarios (shape always-on; consolidation idempotence + commitment fire-once gated on capability).
- [x] CHANGELOG entry under `[1.1.6 — unreleased]` + INTEROP-MATRIX row.
- [x] Reference host implements + passes the behavioral scenarios, OR this RFC explicitly defers reference-host implementation (it does — shape ships; behavioral assertions soft-skip until a host advertises).

## References

- [`spec/v1/agent-memory.md`](../spec/v1/agent-memory.md) — MemoryAdapter, CTI-1, SR-1, the RFC 0062 distillation section this contrasts with.
- [`RFCS/0062-scheduled-memory-distillation.md`](./0062-scheduled-memory-distillation.md) — token-budgeted distillation of transactional memory (`memory.compacted` + `distillation`), the behavior consolidation is explicitly *not*.
- [`RFCS/0057-memory-write-attribution-event.md`](./0057-memory-write-attribution-event.md) — the content-free `memory.written` event whose redaction + replay-re-read posture this RFC mirrors.
- [`RFCS/0052-scheduling-and-time-based-triggers.md`](./0052-scheduling-and-time-based-triggers.md) — once-per-tick fire substrate for `time` commitments.
- [`RFCS/0060-host-heartbeat-capability.md`](./0060-host-heartbeat-capability.md) — predicate-gated fire substrate for `predicate` commitments.
- [`RFCS/0041-multi-agent-replay-under-nondeterminism.md`](./0041-multi-agent-replay-under-nondeterminism.md) — the determinism contract Unresolved #1 must be confirmed against.
- `docs/OPENWOP-FEATURE-GAP-ANALYSIS.md` row 4 (memory: dreaming + inferred commitments).
- Prior art: Letta/MemGPT memory tiers + sleep-time compute; LangGraph long-term memory store.
