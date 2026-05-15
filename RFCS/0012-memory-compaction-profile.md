# RFC 0012: Memory Compaction Profile

| Field | Value |
|---|---|
| **RFC** | 0012 |
| **Title** | Memory Compaction Profile |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-13 |
| **Updated** | 2026-05-15 (Active → Accepted; comment window waived under `CONTRIBUTING.md` §"Bootstrap-phase notes" — sole-steward repo with no non-steward maintainer per `MAINTAINERS.md` and no external commenters of record. All 6 acceptance criteria satisfied at promotion time: spec text + invariant + reference impl + 3 conformance scenarios + CHANGELOG + INTEROP-MATRIX. Future RFCs revert to the 7-day window once a non-steward maintainer joins.) |
| **Affects** | `spec/v1/capabilities.md` (new optional `capabilities.memory.compaction` block), `spec/v1/observability.md` (new optional event type `memory.compacted`), `SECURITY/invariants.yaml` (SR-1 carry-forward through compaction outputs), `schemas/memory-entry.schema.json` (no shape change; new tag-prefix convention) |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Define an optional capability profile that lets a host advertise it runs background **memory compaction** — periodic distillation of many short-lived `MemoryEntry` rows into fewer long-lived ones — and emit a canonical `memory.compacted` audit event when it does so. The profile standardizes only the wire surface: capability shape, event vocabulary, and an SR-1 carry-forward invariant. The compaction algorithm (summarization model, embedding scheme, token budgets, scheduling cadence) remains a host implementation choice.

## Motivation

RFC 0004 (`MemoryAdapter`) already gives hosts everything they need to *implement* compaction: `list` reads candidates, `put` writes the distilled entry, `delete` evicts the originals. Three concrete pain points motivate adding a thin protocol surface on top:

1. **Cross-host observability.** An operator running multiple OpenWOP hosts (e.g., a dev SQLite host plus a prod Postgres host) today has no portable way to ask "did each host's compaction run last night?" Each host invents its own log shape. A canonical `memory.compacted` event in the `openwop.*` namespace gives one query across hosts.
2. **Replay attribution.** When `list` returns a *compacted* entry instead of the original raw entries, replay debugging is opaque — there's no protocol-visible link from "this distilled entry" back to "these source entries that no longer exist." A standard `tags: ["compacted-from:<runId>"]` convention plus a `sourceIds[]` field on the event gives the audit trail without requiring the source entries to still exist.
3. **Redaction-invariant carry-forward.** SR-1 (RFC 0004 §D) is enforced at `put` time over the *direct* content. When a host summarizes ten entries into one, the summarization step is a *new* `put` whose content is derived from the originals. Without an explicit normative carry-forward, a naive host implementation could route summarized content around the BYOK redaction harness. This RFC tightens that.

**Honest scope check.** Items (1) and (2) are observability conveniences; (3) is the only one that's strictly normative — a host that ignores it can leak secrets. The RFC is justified primarily by (3), with (1) and (2) as additive benefits that ride along.

Driven by the 2026-05-13 evaluation of an autonomous-agent-runtime feature set ("dreams" / background memory distillation) against the OpenWOP roadmap. Most of that feature set is application-runtime work that doesn't belong in the protocol; the compaction surface is the one slice that has a defensible protocol footprint.

## Proposal

### §A Capability advertisement

Hosts that perform memory compaction MAY advertise it under the existing `capabilities.memory` block from RFC 0004:

```json
"memory": {
  "supported": true,
  "maxEntrySizeBytes": 65536,
  "ttlSupported": true,
  "compaction": {
    "supported": true,
    "trigger": "host-managed",
    "maxInputEntries": 1000,
    "maxOutputBytes": 65536
  }
}
```

Fields:

- `supported` (boolean, required when the block is present) — when `true`, the host performs compaction over `longTerm` memory and emits the `memory.compacted` event defined in §B.
- `trigger` (closed enum: `"host-managed"` | `"client-requested"` | `"both"`, required when `supported: true`) — `host-managed` means compaction runs on a host-internal schedule that clients do not control. `client-requested` means clients may invoke compaction via an API surface (deferred — see §Unresolved questions #1). `both` means either path is supported. v1.x normates only `host-managed`; `client-requested` and `both` are reserved.
- `maxInputEntries` (integer, optional) — informational ceiling on how many source entries a single compaction call collapses. Clients MAY use this to set their own expectations; not enforced at the wire layer.
- `maxOutputBytes` (integer, optional) — informational ceiling on the size of the resulting distilled entry. SHOULD be `≤ memory.maxEntrySizeBytes`.

Hosts that don't advertise `capabilities.memory.compaction` are assumed not to perform compaction. Clients MUST NOT assume compaction has happened based on entry counts alone.

### §B `memory.compacted` event

Hosts that advertise `capabilities.memory.compaction.supported: true` MUST emit a `memory.compacted` event in the `openwop.*` observability namespace each time a compaction run completes, regardless of trigger.

Event shape (additive to `observability.md` §"Canonical event vocabulary"):

```json
{
  "type": "memory.compacted",
  "ts": "2026-05-13T03:00:00.000Z",
  "memoryRef": "mem_<tenantId>_<agentId>_longTerm",
  "outputId": "mem_<id>",
  "sourceIds": ["mem_<id1>", "mem_<id2>", "..."],
  "sourceCount": 47,
  "trigger": "host-managed",
  "byteSize": 12044
}
```

Field semantics:

- `memoryRef` (string, required) — same opaque handle from RFC 0004 §C. Bounds the compaction to a single memory scope.
- `outputId` (string, required) — the id of the new `MemoryEntry` created by compaction. MUST be readable via `MemoryAdapter.get(memoryRef, outputId)` until normal TTL eviction.
- `sourceIds` (array of strings, optional) — ids of entries that were collapsed into `outputId`. Hosts MAY omit this array when `sourceCount > 100` and instead rely on the `compacted-from:<runId>` tag convention (§C). Hosts that *do* include `sourceIds` MUST be exhaustive within the array (no "and N more" semantics).
- `sourceCount` (integer, required) — total count of source entries collapsed, including any not enumerated in `sourceIds`.
- `trigger` (string, required) — matches `capabilities.memory.compaction.trigger`. Indicates which trigger path drove this run.
- `byteSize` (integer, required) — byte size of the resulting `MemoryEntry.content`.

Consumers (observability dashboards, audit log aggregators) that don't recognize `memory.compacted` MUST ignore it without error. This is consistent with the additive-event-type pattern in `observability.md`.

### §C Provenance tag convention

The distilled entry SHOULD carry a tag of the form `compacted-from:<compactionRunId>` where `<compactionRunId>` is a host-issued identifier (any opaque string the host can correlate to its compaction log). This lets `MemoryAdapter.list` consumers detect compacted entries without needing access to the `memory.compacted` event stream.

This is a SHOULD, not a MUST: a host whose tag-space is structurally constrained (legacy tag-prefix discipline, fixed-vocabulary tagging) MAY omit this. The `memory.compacted` event remains the canonical provenance signal.

### §D SR-1 carry-forward (normative)

The Secret Redaction invariant **SR-1** (RFC 0004 §D) applies transitively through compaction:

> **SR-1 (compaction extension).** When a host produces a compacted `MemoryEntry` whose content is derived from one or more source entries, the host MUST route the derived content through the same BYOK redaction harness it would apply to a fresh `put` from a workflow node. The fact that the source entries were already SR-1-compliant at their original `put` time MUST NOT be used as evidence to skip redaction on the derived content. Summarization models in particular MAY introduce secret-shaped substrings (hallucinated tokens, format-leaks from in-context examples) that were not present in any source entry; the redaction harness is the only protocol-level defense.

This extension is the load-bearing normative claim in this RFC. Hosts that advertise `capabilities.memory.compaction.supported: true` but do not honor SR-1 carry-forward fail the conformance scenario in §Conformance.

### §E Out of scope

The following are explicitly NOT in this RFC:

- **Compaction scheduling.** Cron expressions, intervals, "at" times — purely host concerns. The protocol's only schedule visibility is `trigger`.
- **The compaction algorithm.** Summarization models, embedding schemes, token budgets, retrieval ranking — all host choices.
- **Client-requested compaction API surface.** Reserved by the `trigger: "client-requested"` enum value but not normated. A future RFC may add the API surface if implementer demand materializes.
- **Cross-tenant or cross-host compaction.** Same tenant-isolation rules as RFC 0004 §F apply; compaction MUST NOT cross tenant boundaries.
- **Lossy-vs-lossless distinction.** All compaction in this profile is assumed lossy (otherwise it's not compaction, it's archival). Hosts that want lossless archival have a different shape and should not advertise this profile.

## Compatibility

**Additive.**

- `capabilities.memory.compaction` is a new optional sub-block of an existing optional block. Hosts that don't advertise it are unaffected.
- `memory.compacted` is a new event type. The canonical `observability.md` rule is that consumers ignore unknown event types; this rule covers backward compatibility for existing observability consumers.
- The SR-1 carry-forward extension applies only at the boundary where compaction occurs. Hosts that don't perform compaction never encounter it. Hosts that *do* perform compaction without advertising the profile are NOT bound by this RFC, but SHOULD migrate to either (a) advertising the profile and honoring SR-1 carry-forward, or (b) ceasing compaction — silent compaction with no audit event is a protocol smell.
- No schema diffs to existing `MemoryEntry` or `MemoryListOptions` shapes. The provenance-tag convention (§C) lives entirely in the existing free-form `tags` array.

Lands in a v1.x minor as part of `@openwop/openwop-conformance` `1.X.0`. No SDK wire-type additions are strictly required (the event is JSON-shape, dashboard-facing); SDK error catalogs SHOULD add `compaction_redaction_failed` if a host wants to surface SR-1 violations via the normal error envelope, but the wire surface stands without it.

## Conformance

Existing scenarios that touch the surface:

- `conformance/src/scenarios/memory-put-redaction.test.ts` (RFC 0004 §D, MR-2) — base SR-1 enforcement at `put` time.
- `conformance/src/scenarios/redactionAdversarial.test.ts` — adversarial redaction inputs.

New scenarios required for `Active` → `Accepted` transition:

- `memory-compaction-event-emitted.test.ts` — gated on `capabilities.memory.compaction.supported: true`. Triggers a host-managed compaction (via env var or test hook), asserts a `memory.compacted` event surfaces with the documented shape, and asserts `outputId` is readable via `MemoryAdapter.get`.
- `memory-compaction-sr1-carry-forward.test.ts` — gated on `capabilities.memory.compaction.supported: true`. Plants source entries containing post-redaction `<REDACTED:...>` markers and adversarial near-secret strings, triggers compaction, asserts the resulting `outputId`'s content passes the redaction harness (no plaintext secrets, no `[BYOK:...]` form-leaks). This is the load-bearing SR-1 carry-forward test.
- `memory-compaction-provenance-tag.test.ts` — gated; asserts the `compacted-from:<id>` tag convention from §C when the host SHOULD-follows it. Soft assertion: log-and-warn if absent, fail only if the tag is malformed.

All three scenarios skip cleanly when the capability is absent. Suite-version bump: `@openwop/openwop-conformance` `1.X.0` minor.

## Alternatives considered

1. **Do nothing — leave compaction to vendor extensions.** Each host invents its own `vendor.<host>.memory.compaction` capability and its own `vendor.<host>.memory.compacted` event. Trade-off: the multi-host observability story stays broken, but the protocol surface stays smaller. **Rejected because** the SR-1 carry-forward invariant (§D) is a real security gap that doesn't have a non-protocol home — a vendor extension can't normate cross-host security behavior.
2. **Make compaction a first-class `MemoryAdapter` operation (`compact(memoryRef, options): MemoryEntry`).** Adds a fifth verb to RFC 0004's four. Trade-off: clean API surface, but forces every memory-capable host to either implement compaction or explicitly reject the call. **Rejected because** the compaction trigger is fundamentally a host concern in the dominant use case (nightly background work); exposing it as a client-callable verb pulls in scheduling concerns the protocol doesn't want.
3. **Make this RFC purely about the SR-1 carry-forward invariant and drop §A/§B/§C.** Smallest possible footprint. Trade-off: loses the cross-host observability win (motivation #1 and #2). **Rejected because** if a host is doing compaction at all, the cost of emitting a canonical event is trivial relative to the cost of running the compaction. The capability advertisement is what enables conformance gating, and without that, SR-1 carry-forward is hard to test mechanically.
4. **Defer entirely until a third-party host requests it.** The 2026-05-12 architecture review pattern: gate work on external demand. Trade-off: avoids speculative protocol surface. **Rejected because** the SR-1 gap exists in any host that does compaction today, including hosts not yet on the conformance trajectory — closing it after a leak is more expensive than closing it before. **However**, this remains a live option if no implementer adoption signal arrives within the comment window — the RFC may close `Withdrawn` honestly.

## Unresolved questions

1. **Is there a concrete client use case for `trigger: "client-requested"`?** None has been articulated as of 2026-05-13. If none surfaces, the enum value should be dropped from §A in `Active` status to avoid reserving wire surface that no one uses.
2. **Should `memory.compacted.sourceIds` be required, optional, or capped?** Current proposal: optional with a soft 100-id ceiling and `sourceCount` as the always-present count. A future revision may tighten this once real-world compaction batch sizes are known from the first reference-host implementation.
3. **Does this RFC need a SECURITY invariant entry?** The §D SR-1 carry-forward is normative. Strong candidate for a new `SECURITY/invariants.yaml` row (`memory-compaction-sr-1-carry-forward`) so it's enforced by the same machinery as the existing 35 protocol-tier invariants. Decision deferred to `Active`.
4. **Does this RFC even need to exist?** Honest open question. RFC 0004's existing `put`/`delete` is *functionally* sufficient for any host that wants to compact. This RFC's defense is the SR-1 carry-forward invariant (§D) plus the cross-host observability convenience. If maintainer review concludes (3) belongs in RFC 0004 as a clarifying revision and (1)+(2) don't clear the value-vs-protocol-surface bar, this RFC closes `Withdrawn` and the SR-1 carry-forward language folds into a `Accepted` revision of RFC 0004 §D.

## Implementation notes (non-normative)

- Reference TypeScript host (`examples/hosts/postgres/`) is the natural first implementation target; nightly compaction at the host level is the dominant deployment shape and the SR-1 carry-forward harness already exists via the BYOK redaction code path shared with `MemoryAdapter.put` and `debug-bundle` redaction.
- The compaction algorithm itself (which model to call, what prompts to use) is out of scope. The reference implementation likely uses the same `core.llm.chat` surface that nodes use, with the host as the caller. This is consistent with the "OpenWOP runs the workflow; the LLM call is whatever the node implementor wants" pattern from `README.md:53-60`.
- A2A composition: compaction is per-host. A2A peers do not see each other's `memory.compacted` events unless explicitly federated, which is out of scope for v1.x.
- No anticipated SDK code generation impact. The event type lives in observability, not in the request/response surface.

## Acceptance criteria

- [x] Spec text merged (this RFC + `capabilities.md` annex + `observability.md` event-vocabulary row). — Landed 2026-05-13 in `c30a284` (Phase 2).
- [x] `SECURITY/invariants.yaml` entry for `memory-compaction-sr-1-carry-forward` (or explicit decision to fold into RFC 0004's existing SR-1 row). — Landed 2026-05-13 in `c30a284`; new protocol-tier row (severity: critical) referenced by `memory-compaction-sr1-carry-forward.test.ts`. Protocol-tier invariants 35 → 36.
- [x] At least one reference host (in-memory or Postgres) implements §A advertisement + §B event emission + §D carry-forward. — Postgres reference host, landed 2026-05-14 in `2bf082a`. Conditional advertisement gated on `OPENWOP_MEMORY_COMPACTION=true`; `runCompaction` + `applyCompactionRedaction` enforce SR-1 §D end-to-end; host smoke verifies 7 paths.
- [x] Three conformance scenarios from §Conformance, all capability-gated. — `memory-compaction-{event-emitted,sr1-carry-forward,provenance-tag}.test.ts`, all gated on `capabilities.memory.compaction.supported`. 3/3 pass live against the Postgres reference host.
- [x] CHANGELOG entry under the v1.X version that ships the suite minor. — `[1.1.1 — unreleased]` block carries the Phase 1, Phase 2, and Phase 3 prep bullets.
- [x] `INTEROP-MATRIX.md` row updated for any reference host that advertises the profile, with a one-line evidence claim. — Postgres row's Phase I.7 / I.2 / RFC 0012 evidence paragraph names the conditional env vars + the host smoke file.

## References

- RFC 0004 (Memory Layer — `MemoryAdapter`, SR-1)
- RFC 0002 (Agent Identity — `AgentRef.memoryRef`)
- `spec/v1/capabilities.md` §"memory (RFC 0004)"
- `spec/v1/observability.md` §"Canonical event vocabulary"
- `SECURITY/invariants.yaml` (SR-1)
- `schemas/memory-entry.schema.json`
- 2026-05-13 OpenWOP roadmap evaluation of the autonomous-agent-runtime feature set (this RFC is the one slice of that proposal with a defensible protocol footprint)
