# RFC 0080: Agent Memory Capability Reconciliation

| Field | Value |
|---|---|
| **RFC** | 0080 |
| **Title** | Reconcile the fragmented memory advertisement (`capabilities.memory.*` + `capabilities.agents.{memoryBackends,memoryConsolidation,commitments}` + `agent-memory.md` + `AgentManifest.memoryShape`) into one coherent, additive memory-capability model with eight named dimensions, a derived `openwop-memory` profile, and a normative requirement that the agent inventory surface when an agent's requested memory is degraded |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-29 |
| **Updated** | 2026-05-30 (`Draft → Active` — steward acceptance, comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus after MyndHyve (non-steward) wire-shape review; wire shapes now locked. All 4 Unresolved questions resolved as proposed: UQ1 `writable` absent ⇒ writable + read-only host sets `false`; UQ2 `degradedMemoryDimensions` uses the §A dimension names (closed enum), not the `memoryShape` keys; UQ3 `forget` is a host-managed mutation outside the replay envelope (`replay.md` §"Recorded-fact events"); UQ4 ship base `openwop-memory`, defer `-search`/`-managed` tiers. §A dimension table + §B query-endpoint decision + §C degraded-projection + the additive `memory.{writable,search,retention}` + inventory `memoryDegraded`/`degradedMemoryDimensions` + the `openwop-memory` profile + `memory-capability-model-shape.test.ts` landed. Reference-host degraded-projection + behavioral `memory-degraded-projection.test.ts` deferred to `Active → Accepted`.) |
| **Affects** | `schemas/capabilities.schema.json` (additive optional `memory.search` + `memory.retention` dimensions; no existing field changes) · `schemas/agent-inventory-response.schema.json` (additive optional `memoryDegraded` / `degradedMemoryDimensions[]` on the inventory entry) · `spec/v1/agent-memory.md` (new §"Memory capability model" reconciliation table) · `RFCS/profiles.md` + `spec/v1/profiles.md` (derived `openwop-memory` profile) · `CHANGELOG.md` · `INTEROP-MATRIX.md` · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop's memory story is **advertised across two unrelated capability blocks and four RFCs**: `capabilities.memory.{supported,compaction,distillation,attribution}` (RFC 0004/0012/0062/0057), `capabilities.agents.{memoryBackends,memoryConsolidation,commitments}` (RFC 0003/0068), `agent-memory.md` prose (the `MemoryAdapter` + CTI-1/SR-1/TTL), and `AgentManifest.memoryShape` (RFC 0003/0077). A client cannot answer "does this host support *write*? *search*? *forget*?" from one place, and when an agent declares a `memoryShape` the host can't fully satisfy, dispatch silently degrades with no observable signal — the live-platform symptom is "`host.memory` exists but top-level memory is not fully supported," invisible to a consumer. This RFC reconciles the **advertisement** into one coherent, **additive** model: it names eight memory dimensions (read / write / search / long-term / compaction / attribution / replay-snapshot / retention-forget), maps each to its existing flag and adds the two missing ones (`memory.search`, `memory.retention`) as optional fields, derives an `openwop-memory` profile over them, and **requires `GET /v1/agents` to surface an agent's memory as degraded** when its `memoryShape` isn't satisfiable — rather than re-organizing the existing flags (which would break v1.x). It also resolves the standing question of a canonical memory-query endpoint: memory query stays the host-internal `MemoryAdapter` at v1.x; no `GET /v1/memory` is added.

## Motivation

`docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0080" frames it: *the memory story is split across `agent-memory.md`, attribution, compaction, standing commitments, `host.memory`, `capabilities.memory`, and `agents.memoryBackends`; the live demo exposes this split.* Three concrete gaps:

1. **No single advertised shape.** Memory support is scattered between `capabilities.memory.*` (read via the `MemoryAdapter`, plus compaction/distillation/attribution) and `capabilities.agents.*` (long-term backend, consolidation, commitments). There is **no advertised `write`, `search`, or `retention/forget` dimension at all** — a host that supports memory writes or a forget operation has nowhere to say so, and a client building a memory console (or pre-flighting an agent) must infer capability from a union of two blocks plus prose.
2. **Silent degradation.** `AgentManifest.memoryShape` declares `{scratchpad, conversation, longTerm}` (RFC 0003). If a host advertising the agent can't satisfy `longTerm: true` (no `agents.memoryBackends: ['long-term']`), RFC 0003/0070 lets it dispatch at a degraded floor — but `GET /v1/agents` (RFC 0072/0074) shows the agent as plainly runnable, with **no signal that its memory is degraded**. An operator can't see the gap until behavior surprises them.
3. **An unresolved query-endpoint question.** Whether memory should have a canonical `GET /v1/memory` query surface or stay host-extension-only has been open since RFC 0004; the fragmentation makes it ambiguous whether `capabilities.memory.supported` even implies a portable read path (it does not — it advertises the host-internal `MemoryAdapter`).

The spec is the right place because *advertisement coherence*, *degraded-status visibility*, and the *query-surface decision* are cross-host interop concerns a memory console + an agent inventory depend on. The per-host memory *implementation* stays a host choice; this RFC reconciles the advertised shape, adds the two missing optional dimensions, requires the degraded projection, and pins the query-surface decision — all additively.

## Proposal

### §A — The memory capability model (eight dimensions; `agent-memory.md` §"Memory capability model")

A normative reconciliation table names the eight memory dimensions and maps each to its **existing** advertised source, adding the two that have none today. This is a *reading* over the existing capability surface plus two additive optional fields — no existing flag is moved, renamed, or removed.

| Dimension | Meaning | Advertised by (existing / **NEW**) |
|---|---|---|
| **read** | `MemoryAdapter.list`/`get` (RFC 0004) | `capabilities.memory.supported` |
| **write** | `MemoryAdapter.put`/`delete` | `capabilities.memory.supported` ⇒ read+write are the four-op contract (RFC 0004 §A); a **read-only** host advertises **NEW** `memory.writable: false` |
| **search** | semantic / filtered query beyond `list` | **NEW** optional `capabilities.memory.search` (`{ supported, modes?: ["semantic","filter"] }`) |
| **long-term** | cross-run durable store | `capabilities.agents.memoryBackends` includes `"long-term"` |
| **compaction** | RFC 0012 budgeted compaction + RFC 0062 distillation | `capabilities.memory.compaction` / `capabilities.memory.distillation` |
| **attribution** | RFC 0057 `memory.written` provenance | `capabilities.memory.attribution` |
| **replay-snapshot** | MAE-3 deterministic read-snapshot on replay (RFC 0039/0041); consolidation outside the envelope (RFC 0068) | derived: `agents.memoryBackends: ["long-term"]` + `multiAgent.executionModel.version >= 2` |
| **retention/forget** | TTL expiry (`agent-memory.md §TTL`) + explicit forget/delete | **NEW** optional `capabilities.memory.retention` (`{ ttl?: boolean, forget?: boolean }`) — `forget` advertises a tenant-scoped delete-by-subject operation (composes CTI-1) |

`capabilities.agents.{memoryConsolidation,commitments}` (RFC 0068) stay where they are (they're agent-runtime behaviors, not adapter dimensions) and are cross-referenced from the table, not relocated.

### §B — Canonical query endpoint: host-internal at v1.x (resolves the standing question)

`capabilities.memory.supported` advertises the **host-internal `MemoryAdapter`** (RFC 0004) + the SR-1-redacted read-side a run sees — **not** a portable client query path. This RFC **does NOT add a `GET /v1/memory` endpoint**: the `MemoryAdapter` is deliberately host-internal (RFC 0004 §"Open spec gaps" — bulk-ops deferred), a portable cross-tenant memory query is a much larger surface + attack surface, and the interop need (an operator/console seeing memory state) is met by the existing read-side + the §C degraded projection. A host that wants a query API exposes it under a host-extension scope (`x-host-<vendor>-memory-query`). A normative `GET /v1/memory` MAY be revisited in a future RFC if implementer demand surfaces; v1.x keeps memory query host-internal.

### §C — `memoryShape` enforcement + degraded projection (normative)

When a host advertises a manifest agent (RFC 0072/0074 `GET /v1/agents`) whose `AgentManifest.memoryShape` declares a dimension the host's reconciled model (§A) does NOT satisfy:

1. The host MUST surface the gap on the inventory entry via the additive optional **`memoryDegraded: true`** + **`degradedMemoryDimensions: string[]`** (the §A dimension names it can't satisfy) on `agent-inventory-response.schema.json`. Absent ⇒ memory fully satisfied (back-compat: an old host omits the fields; consumers treat absence as "not degraded / unknown" and MAY probe).
2. A degraded agent MAY still dispatch at the RFC 0070 floor (degradation is permitted), but the degradation MUST be **observable** — a silent satisfied-looking inventory entry for an agent whose `longTerm: true` can't be honored is non-conformant.
3. This reuses the RFC 0072 §C `degraded[]` marker philosophy (per-dependency degradation visibility), applied to the memory dimensions.

### §D — Derived `openwop-memory` profile (`profiles.md`)

A derived profile whose predicate is the §A core: `capabilities.memory.supported: true` (read+write) AND `agents.memoryBackends` includes `"long-term"`. Optional richer tiers (`openwop-memory-search`, `openwop-memory-managed` = + compaction + attribution + retention) let a client filter hosts by memory capability coherently instead of union-testing two blocks. Profiles are derived predicates (RFC 0009 profile machinery), not new advertised flags.

### Examples

**Positive.** A full-memory host: `capabilities.memory: { supported: true, search: { supported: true, modes: ["semantic"] }, compaction: {...}, attribution: {...}, retention: { ttl: true, forget: true } }` + `agents.memoryBackends: ["long-term"]` → satisfies `openwop-memory-managed`; an agent with `memoryShape: { longTerm: true }` shows `memoryDegraded` absent (satisfied). A read-only host: `memory: { supported: true, writable: false }` + no `memoryBackends` → an agent with `memoryShape: { longTerm: true }` shows `memoryDegraded: true, degradedMemoryDimensions: ["write", "long-term"]`.

**Negative (non-conformant behavior).** A host advertising an agent with `memoryShape: { longTerm: true }` it can't satisfy, but returning the inventory entry with no `memoryDegraded` field and dispatching as if satisfied → non-conformant by §C-2 (silent degradation). **Negative (schema).** `memory.retention: { ttl: "yes" }` fails validation (`ttl` is boolean).

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). Two new optional `capabilities.memory` dimensions (`search`, `retention`) + an optional `writable` flag (absent ⇒ the RFC 0004 four-op default, i.e. writable); two new optional inventory fields (`memoryDegraded` / `degradedMemoryDimensions`); a derived profile; a reconciliation table in prose. **No existing field is moved, renamed, removed, or type-changed** — `capabilities.memory.*` and `capabilities.agents.*` keep their shapes; the model is a *reading* over them plus the additive dimensions. No new endpoint (§B explicitly adds none). No conformance pass is invalidated. (A full structural re-org into a single memory block would be breaking → deliberately deferred to a hypothetical v2; this RFC reconciles *advertisement coherence* additively.)

## Conformance

- **New scenarios:**
  - **`memory-capability-model-shape.test.ts`** (always-on, server-free): the additive `memory.search` / `memory.retention` / `memory.writable` fields + the `memoryDegraded` / `degradedMemoryDimensions` inventory fields validate; the §A reconciliation dimension names are stable; negatives (`retention.ttl` non-boolean).
  - **`memory-degraded-projection.test.ts`** (gated on `capabilities.agents.manifestRuntime` + `memory`): an agent whose `memoryShape` exceeds the host's reconciled model surfaces `memoryDegraded: true` + the right `degradedMemoryDimensions` on `GET /v1/agents`; a satisfiable agent omits them (the §C-1/§C-2 contract). Soft-skips when unadvertised.
- **Capability gating** per `conformance/coverage.md`; shape always-on, degraded-projection gated.
- **Reference host.** Deferred (files at `Draft`). The shape + derived profile ship; the degraded-projection scenario soft-skips until a reference host computes `memoryShape` satisfaction in its inventory.

## Alternatives considered

1. **Structural re-org into a single `capabilities.memory` block** (move `memoryBackends`/`memoryConsolidation`/`commitments` under it). Rejected — moving advertised fields is breaking (`COMPATIBILITY.md` §2.2), invalidating every host's pass for no interop gain the additive model doesn't already deliver. Reconciliation is a *reading* + the missing dimensions, not relocation.
2. **A normative `GET /v1/memory` query endpoint.** Rejected for v1.x (§B) — the `MemoryAdapter` is host-internal by design; a portable cross-tenant query is a large new surface + attack surface; the console/operator need is met by the read-side + the §C projection. Revisitable in a future RFC.
3. **Leave it fragmented + document the union.** Rejected — the live-platform symptom (silent degradation, no `write`/`search`/`forget` dimension) is a real interop + honesty gap, not just a docs nit. The degraded projection (§C) is the load-bearing fix that documentation alone can't provide.
4. **Do nothing.** Rejected — the gap analysis flags memory reconciliation explicitly (the Memory tab / agent memory-status console depend on it), and 0068's consolidation/commitments make the fragmentation worse without a unifying model.

## Unresolved questions

**All four resolved at `Draft → Active` (2026-05-30) as proposed below — recorded in `Updated:`.** Retained for the rationale trail:

1. **`writable` default.** Is absence of `memory.writable` "writable" (RFC 0004 four-op default) or "unknown"? Proposed: absent ⇒ writable (back-compat with today's four-op `MemoryAdapter`); a read-only host MUST set `writable: false`. Confirm.
2. **`degradedMemoryDimensions` vocabulary.** Should it use the §A dimension names verbatim (`write`/`search`/`long-term`/…) or the `memoryShape` keys (`scratchpad`/`conversation`/`longTerm`)? Proposed: the §A dimension names (broader, future-proof). Confirm the mapping to `memoryShape` keys.
3. **`forget` + replay determinism.** A tenant-scoped forget/delete mutates memory — does a replayed run that read a since-forgotten entry diverge? Proposed: forget is a host-managed mutation outside the replay envelope (the RFC 0068 §UQ1 / `replay.md` §"Recorded-fact events" posture — a replay re-reads the log-recorded snapshot, not live memory). Confirm against `replay.md` before `Active`.
4. **Profile tier names.** `openwop-memory` / `-search` / `-managed` — right granularity, or just one `openwop-memory`? Proposed: ship the base `openwop-memory` + defer the richer tiers unless a client needs them. Confirm.

## Implementation notes (non-normative)

- **Sequencing.** Editorial/composable over RFC 0004 (MemoryAdapter) + 0012 (compaction) + 0057 (attribution) + 0062 (distillation) + 0068 (consolidation/commitments) + RFC 0077 `memoryShape` + RFC 0072/0074 inventory. Adds two optional capability dimensions + two optional inventory fields + a derived profile; no new endpoint, event, or invocation path.
- **Reference host.** The reference workflow-engine advertises `capabilities.memory` + `agents.memoryBackends` today; wiring §C is computing `memoryShape` satisfaction against the reconciled model in its `GET /v1/agents` handler and stamping `memoryDegraded` when a dimension is unmet.
- **Demo impact** (out of scope): a Memory tab as a real knowledge/memory console; agent detail pages showing memory requirements + live/degraded status.
- **Expected effort:** S–M for the schema dimensions + prose + shape conformance (this lands the surface); M for the degraded-projection reference implementation.

## Acceptance criteria

Checklist for `Active → Accepted` (files at `Draft`):

- [ ] `agent-memory.md` §"Memory capability model" reconciliation table (§A) + the §B query-endpoint decision + the §C degraded-projection contract.
- [ ] `capabilities.schema.json` additive `memory.search` / `memory.retention` / `memory.writable`; `agent-inventory-response.schema.json` additive `memoryDegraded` / `degradedMemoryDimensions`.
- [ ] `profiles.md` + `spec/v1/profiles.md` derived `openwop-memory` profile.
- [ ] Conformance: `memory-capability-model-shape.test.ts` (always-on) + `memory-degraded-projection.test.ts` (gated).
- [ ] CHANGELOG entry + INTEROP-MATRIX row.
- [ ] All four Unresolved questions resolved (recorded in `Updated:`).
- [ ] Reference host computes the degraded projection + passes the scenario, OR the RFC explicitly defers reference-host implementation.

## References

- `docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0080" — the source recommendation.
- [`spec/v1/agent-memory.md`](../spec/v1/agent-memory.md) — `MemoryAdapter`, CTI-1, SR-1, TTL, the existing capability-advertisement section this reconciles.
- [`RFCS/0004-memory-layer.md`](./0004-memory-layer.md) — the four-op `MemoryAdapter` (`read`/`write` dimensions).
- [`RFCS/0012-memory-compaction-profile.md`](./0012-memory-compaction-profile.md) + [`RFCS/0062-scheduled-memory-distillation.md`](./0062-scheduled-memory-distillation.md) — `compaction` dimension.
- [`RFCS/0057-memory-write-attribution-event.md`](./0057-memory-write-attribution-event.md) — `attribution` dimension.
- [`RFCS/0068-memory-consolidation-and-standing-commitments.md`](./0068-memory-consolidation-and-standing-commitments.md) — consolidation/commitments (cross-referenced, not relocated); §UQ1 replay-determinism posture `forget` reuses.
- [`RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md`](./0077-agent-run-lifecycle-and-live-manifest-dispatch.md) — `AgentManifest.memoryShape` binding (§B step 4) whose degradation §C surfaces.
- [`RFCS/0072-agent-inventory-and-dispatch.md`](./0072-agent-inventory-and-dispatch.md) + [`RFCS/0074-tenant-scoped-agent-inventory.md`](./0074-tenant-scoped-agent-inventory.md) — the `GET /v1/agents` inventory the degraded projection extends; the §C `degraded[]` marker philosophy.
- [`spec/v1/replay.md`](../spec/v1/replay.md) §"Recorded-fact events" — the `forget` × replay posture (UQ #3).
