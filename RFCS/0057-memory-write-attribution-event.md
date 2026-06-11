# RFC 0057: Memory write-attribution event (`memory.written`)

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0057                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Title**         | An optional `memory.attribution` capability + additive `memory.written` RunEvent carrying `{ memoryRef, memoryId, nodeId?, agentId? }`, so a consumer can see which node wrote which memory entry during a run — making per-node memory provenance observable on the wire without exposing memory content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Created**       | 2026-05-25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Updated**       | 2026-05-26 (Active → **Accepted** — non-steward host advertises it: MyndHyve `workflow-runtime` advertises `capabilities.memory.attribution.{supported: true, emitsWriteEvents: true}` live on `https://workflow-runtime-gjw5bcse7a-uc.a.run.app/.well-known/openwop` (openwop-side curl-verified 2026-05-26, revision `workflow-runtime-00217-q7c`) and dual-emits the canonical content-free `memory.written` (honoring `memory-attribution-no-content`) alongside a vendor `x-host-myndhyve-memory-written` variant retained for MAE-3 reverse-projection. Honest omission: the SHOULD-tier `nodeId` field is not yet threaded through MyndHyve's `ServerMemoryWriteInput` — permitted by RFC 0057 §B ("writes with no node attribution"), not blocking. 2026-05-25 (Draft → Active).) |
| **Affects**       | `schemas/capabilities.schema.json` (additive `memory.attribution` block) · `schemas/run-event.schema.json` (additive `memory.written` event type) · `spec/v1/agent-memory.md` (write-attribution as an observability surface; closes an Open spec gap) · `spec/v1/observability.md` (event vocabulary row) · `spec/v1/replay.md` (the event is a recorded fact, re-emitted from the log) · `SECURITY/invariants.yaml` (no-content / SR-1 + CTI-1 invariants) · new conformance scenarios                                                                                                                                                                                                                                                                                                  |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Summary

OpenWOP exposes memory as a read-only adapter (`agent-memory.md` — `list` / `get`), but the run event log carries **no signal for which node wrote which memory entry**. The only memory event today is `memory.compacted` (RFC 0012), which reports a host-managed compaction, not per-node provenance. This RFC adds an optional `memory.attribution` capability and an additive `memory.written` RunEvent emitted when a node's execution causes a memory write, carrying **identifiers only** — `{ memoryRef, memoryId, nodeId?, agentId?, tags? }`, never the entry content. A debugger, a timeline view, or an analytics consumer can then attribute memory provenance to the node that produced it (and correlate to the entry via the existing read-side), turning today's flat "ledger" into a per-node memory trail. Everything is advertisement-gated; the event is ignorable by existing consumers; and because the payload is content-free, it adds no BYOK-leakage or replay-divergence surface.

## Motivation

Three concrete needs, none expressible portably today:

1. **Per-node memory provenance in debugging.** A reference-app memory ledger (app-ux §A3) can list a tenant's memory entries via the read-side, but it cannot say _"node `summarize-2` wrote this entry."_ The wire carries no attribution, so a "which node touched memory" timeline marker is impossible — `agent-memory.md` §"Open spec gaps" and `observability.md` are both silent on per-node memory events. Every host that wants this invents an incompatible, app-private signal.
2. **Honest analytics.** "How much memory did this run produce, and where?" is unanswerable from the event log. Memory writes are the durable side effect of a run; not emitting them leaves a blind spot next to cost, reasoning, and interrupt events that _are_ attributed.
3. **Replayable provenance.** When a run is forked/replayed, the reviewer wants to see the memory writes the original run made, attributed to nodes, as recorded facts — not regenerated guesses.

This is squarely an **observability** concern (`observability.md`), the same domain that justifies `agent.reasoned` / `agent.toolCalled`. The interop argument mirrors those: a memory-provenance signal is only useful if any consumer reads it identically. A host-private "node→memory" table fails that test; a `memory.written` event passes it.

**Why the spec was silent until now (and why this is safe).** `agent-memory.md` deliberately keeps memory _access_ internal to nodes and emits no per-access events, to protect replay determinism (a mid-run memory mutation that became observable could perturb a replay). This RFC does **not** reopen that: `memory.written` records a write that _already happened_ as an immutable event-log fact. On replay the event is **re-read from the log, never regenerated** — the host MUST NOT mint new `memoryId`s or timestamps at replay time. The payload is content-free, so it carries no non-deterministic body to diverge on. Reads remain unattributed (a `memory.read` event is explicitly out of scope — see Alternatives).

## Proposal

### A. Capability advertisement (additive)

`schemas/capabilities.schema.json` gains an additive `memory.attribution` sub-block:

```json
"attribution": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "supported": { "const": true },
    "emitsWriteEvents": { "type": "boolean" }
  },
  "required": ["supported"]
}
```

A host advertising `capabilities.memory.attribution.{ supported: true, emitsWriteEvents: true }` MUST emit `memory.written` for every memory write it makes during a run (`MUST`). A host that omits the block, or sets `emitsWriteEvents: false`, MUST NOT be expected to emit it, and consumers MUST tolerate its absence (`MUST`). Existing hosts are unaffected — the block is absent and the event never appears.

### B. The `memory.written` RunEvent (additive)

`schemas/run-event.schema.json` gains an additive event type. The payload carries **identifiers only**:

```json
{
  "type": "memory.written",
  "payload": {
    "memoryRef": "agent:summarizer:tenant-42",
    "memoryId": "mem_8c1f0a2b",
    "nodeId": "summarize-2",
    "agentId": "summarizer",
    "tags": ["session-summary"]
  }
}
```

| Field       | Required | Notes                                                                                                                            |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `memoryRef` | MUST     | The ref the entry was written under (resolvable via the read-side).                                                              |
| `memoryId`  | MUST     | Host-issued entry id, stable; correlates to `MemoryAdapter.get(memoryRef, memoryId)`.                                            |
| `nodeId`    | SHOULD   | The node whose execution caused the write. Omitted only for writes with no node attribution (e.g. host session-end auto-memory). |
| `agentId`   | MAY      | The agent identity (`AgentRef`) behind the write, when known.                                                                    |
| `tags`      | MAY      | The entry's tags (non-secret labels only).                                                                                       |

The event MUST NOT carry the entry **content** (the read-side serves it, already SR-1-redacted). It emits in the `updates` and `debug` stream modes (`stream-modes.md`).

### C. SECURITY invariants

Two protocol-tier invariants in `SECURITY/invariants.yaml`, each with a public conformance test:

- **`memory-attribution-no-content`** — a `memory.written` event payload MUST NOT contain the memory entry content or any BYOK-resolved secret material (SR-1 holds trivially: identifiers + non-secret tags only).
- **`memory-attribution-tenant-scoped`** — `memory.written` events appear only on the run event stream of the tenant that owns the run (CTI-1; no cross-tenant `memoryRef`/`memoryId` disclosure).

### D. Replay

Per `replay.md`: `memory.written` is an immutable recorded fact. On `POST /v1/runs/{runId}:fork` against a historical checkpoint, the host MUST re-emit the recorded events from the log and MUST NOT regenerate `memoryId` or timestamps. No new non-determinism is introduced (the payload is content-free).

The distinction is between the two fork modes. A `branch`-mode fork is a genuinely new run: it MAY perform its own memory writes and emit its own `memory.written` events with fresh `memoryId`s — those are new facts, not regenerated ones. A `replay`-mode fork reproduces a prior run's recorded history; the host MUST NOT mint a new `memoryId` for a write the source run already recorded.

_Implementation note (non-normative)._ The reference workflow-engine host honors this by **skipping** its host session-end run-summary write when `run.forkMode === 'replay'` — it does not re-mint, so no second `memory.written` with a new `memoryId` appears on a replay. (Full replay-stable re-emission of a historical `memory.written` whose original sequence is `≥ fromSeq` is a host responsibility tied to whether the host replays recorded events or re-executes; the reference host re-executes, so it suppresses rather than re-emits — which satisfies the "MUST NOT regenerate" half. The `memory-attribution-replay-stable` conformance scenario asserts a replay introduces no new-`memoryId` `memory.written`.)

## Compatibility

**Additive.** New optional capability block + new optional event type. No existing required field changes; no existing event shape changes; no existing `MUST` relaxes. Hosts that don't advertise `memory.attribution` never emit the event, and consumers that don't recognize `memory.written` ignore it per the forward-compatibility rule (`COMPATIBILITY.md` §2.1). Existing v1.x conformance passes are unaffected.

## Conformance

New capability-gated scenarios (gated on `capabilities.memory.attribution.emitsWriteEvents`):

- A run that writes memory emits a `memory.written` event whose `memoryId` resolves via `MemoryAdapter.get`.
- The event payload contains no `content` field (the no-content invariant).
- `memory.written` events for run R appear only on R's tenant stream (the tenant-scoped invariant).
- A host not advertising the capability emits no `memory.written` and still passes the locked core.

## Alternatives considered

- **A `writtenByNodeId` field on `MemoryEntry`.** Rejected as primary: it conflates the durable entry (read-side) with run-time provenance, and a single entry mutated by multiple runs/nodes has no single writer. An event is the natural per-write record. (A host MAY still expose `writtenByNodeId` as a host extension.)
- **A `memory.read` event.** Out of scope. Reads are high-volume and re-emitting attributed reads risks the very determinism concern `agent-memory.md` avoided. Writes are the durable, attributable mutations; start there.
- **Carrying content in the event.** Rejected — it duplicates the read-side and reopens the SR-1 redaction surface on the event log. Identifiers + a read-side fetch keep the event content-free.

## Unresolved questions

- Should `memory.written` carry a `contentDigest` (non-reversible hash) for change-detection without a read-side round-trip? Deferred — adds a hashing-recipe normative surface; revisit on implementer demand.
- Batch writes: one event per entry vs. one event per write-batch. Proposed: one event per entry (simplest to correlate); a `batchId` could group them additively later.

## Acceptance criteria

Promotion `Draft → Active` when the schema additions (capability block + event type), the `agent-memory.md` / `observability.md` prose, the two SECURITY invariants + public tests, and the capability-gated conformance scenarios land atomically and a host advertises `capabilities.memory.attribution.emitsWriteEvents: true` with honored behavior. `Active → Accepted` on a non-steward host advertising it, per `RFCS/0001` §"Promotion to Accepted".

## References

- `spec/v1/agent-memory.md` §"Open spec gaps" (the gap this closes)
- `spec/v1/observability.md` §event vocabulary (`memory.compacted` precedent)
- `spec/v1/replay.md` (recorded-fact re-emission)
- `schemas/run-event.schema.json` · `schemas/capabilities.schema.json` · `schemas/memory-entry.schema.json`
- `RFCS/0004-memory-layer.md` (the read-side this attributes)
- `RFCS/0012` (`memory.compacted`, the only prior memory event)
