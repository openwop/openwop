# Replay and Fork

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0140, 0041, 0173 §C, 0176 §A.5.**

## Why this exists

The event log makes any past state of a run reconstructible by folding events up to a sequence. `POST /runs/{runId}:fork` turns that into a wire surface: a replay proves that current code reproduces recorded history; a branch explores an alternative from a recorded point. This document states what a fork MUST reproduce, what it MUST NOT re-fire, and how a host proves the second.

## The surface

A host that advertises `replay` (capabilities.md) serves `forkRun` (`api/v2/openapi.yaml`, `POST /runs/{runId}:fork`) and `getEffectSeamManifest` (`GET /host/effect-seams`). The `replay` facet (`spec/v2/facets/replay.schema.json`) is `{ modes[], retention?, effectSeamsManifest }`; `modes` enumerates `fork | branch | rerun`; `effectSeamsManifest` is the constant `/host/effect-seams`. There is no `sideEffectSuppression` field: suppression is the only conforming replay behavior (RFC 0173 §B, row `C6.2`) and `none` is not a value.

The request body is `{ mode, fromSeq?, runOptionsOverlay? }`, `mode ∈ replay | branch`. Events with `sequence < fromSeq` are fixed history; events `>= fromSeq` are re-executed.

| Rule | Requirement |
| --- | --- |
| `fromSeq` for `replay` | MAY be omitted; omission means `0` (full re-execution). |
| `fromSeq` for `branch` | MUST be supplied. |
| `runOptionsOverlay` | MUST be omitted or empty for `replay`; MAY be supplied for `branch`. |
| `fromSeq` out of range | `400`; a sequence absent from the source log is `422`. |
| Source run not visible to the caller | `404`. |
| Response | `201` `{ runId, sourceRunId, fromSeq, mode, status, eventsUrl }`; the fork is a new run with its own log. |

The fork's `owner.tenant` and `owner.subject` MUST be copied verbatim from the source run (RFC 0165 §B.4; identity.md).

## Modes

**`replay`** re-executes the workflow against current code from `fromSeq`, consuming the source run's events as fixed history.

**`branch`** starts from the projected state at `fromSeq` with caller-supplied `runOptionsOverlay`. A branch is an independent run and is NOT deterministic by design; determinism and suppression apply only to the inherited prefix.

## Byte-equivalence of the prefix

The replay contract is observable-output-sequence determinism, not bit-equivalent execution (RFC 0041 §C):

1. The events at indices `[0, fromSeq]` MUST be byte-equivalent between source and replay, modulo per-region clock fields (RFC 0036 §E) and ULID time-component entropy when ULIDs are minted fresh.
2. `variables`, `channels`, and `status` of the run snapshot at each index MUST be byte-equivalent.
3. The bytes on the wire of underlying tool and LLM calls MAY differ, provided the observable state at each index is byte-equivalent.

A host MUST cache the observable result (return value, workflow-state effects, emitted events), not merely the tool-call boundary. The cache key for LLM-calling nodes is the RFC 0041 content-addressed key; for other tool-calling nodes it MUST be content-addressable, never a host-internal sequence number or timestamp.

## Determinism caveats (`replay` mode)

1. A side-effecting node MUST NOT call the external system twice; see §Suppression.
2. `ctx.interrupt(K)` MUST short-circuit to the persisted `interrupt.resolved` value.
3. `ctx.getVersion` pins from the source run are fixed history; the replay MUST take the recorded branch.
4. Nodes MUST consume time via `ctx.now()` where available; direct clock reads make replay non-deterministic.
5. Recorded-fact events such as `memory.written` (RFC 0057) are fixed history. A replay MUST re-emit them verbatim from the log and MUST NOT regenerate their identifiers or timestamps — never a new `memoryId`. A `branch` MAY perform its own memory writes with fresh identifiers.
6. Approver eligibility recorded on a resume event is fixed history; a host MUST NOT re-resolve membership during replay (RFC 0104).

## Divergence

When a replayed node produces an event different from the source at the same sequence, the host MUST continue, MUST emit `replay.diverged` `{ originalEventId, replayEventId, divergencePoint }`, and MUST surface it in `debug` stream mode and as OTel attribute `openwop.replay.diverged: true`.

| Code (`spec/v2/errors.json`) | Where | Condition |
| --- | --- | --- |
| `replay_diverged_at_refusal` | fork fails, `409` | The source obtained a valid envelope and the replay a refusal, or the reverse. The host MUST NOT substitute silently; it MUST emit `replay.diverged-at-refusal` naming the node and both envelope kinds and fail the replay with this code (RFC 0041 §B). |
| `replay_source_missing` | `node.failed` payload; the fork request still returns `201` | A side-effecting node reached with no recorded source outcome for `(nodeId, attempt)` (§Suppression). |
| `replay_memory_snapshot_unavailable` | fork refused, `409` | The host cannot serve memory state as-of `fromSeq`. It MUST refuse rather than substitute current memory; `details.fromSeq` SHOULD name the index (RFC 0039 §B). |

## Suppression

Suppression is an obligation of the `replay` surface (RFC 0173 §A.1, §B): advertising `replay` binds it, and a host that cannot suppress MUST NOT advertise `replay`. A relaxation is an operator setting recorded in the certification bundle (security-defaults.md).

For a fork with `mode: replay`:

1. A node that performs an external side effect — any operation observable outside the run's own event log — MUST NOT perform it.
2. The host MUST resolve the node's outcome from the source run's recorded terminal outcome for the same `(nodeId, attempt)`, keyed on `(sourceRunId, nodeId, attempt)` and never on the fork's own `runId` (the Layer-2 key includes `runId`, so it cannot span a fork).
3. Absent a recorded outcome, the host MUST fail the node closed with `replay_source_missing`, MUST NOT perform the effect, and MUST NOT substitute a synthesized or empty success.
4. A node whose pack manifest declares `role: "side-effect"` MUST be treated as side-effecting; a host classifier MAY add nodes and MUST NOT remove any. A throwing seam satisfies rule 1 only.
5. The guarantee is whole-run and requires both classification before execution and a default-deny guard at every effect seam.
6. A dispatch to a peer host is an outbound call under rule 2; the peer is never contacted.

Pure nodes and LLM calls served from the invocation log MUST re-execute live; otherwise divergence detection is vacuous.

**Fan-out.** A host that projects its log outward — webhook delivery, outbound streams, analytics or audit sinks — MUST NOT deliver events a replay re-emits as fixed history. Replay-ness MUST be read from the run, never from the event type; the fork's own log MUST still carry the re-emitted events (webhooks.md).

**Branch.** A branch re-fires effects for sequences `>= fromSeq`; those are effects the operator asked for. A host MAY suppress branch effects and MUST NOT report that as replay suppression. A host SHOULD surface the re-fire in operator-facing fork UI.

### The effect-seam manifest

A host advertising `replay` MUST publish `schemas/v2/effect-seam-manifest.schema.json`-shaped data at `GET /host/effect-seams` (RFC 0173 §C.1): `{ manifestVersion: "1", host: { name, build }, seams[] }`, one row per outbound effect path its node runtime can reach, `{ id, kind: http | provider | webhook | queue | storage | pack | other, suppression: "recorded-outcome", witness?, note? }`. The host owns the list. The suite drives one seam of each kind and observes no re-fire (`effect-seam-manifest`, conformance.md).

A seam omitted from the manifest is invisible to the suite: the manifest is a self-declaration whose false negatives are found by audit — negative-existence, not a witness.

## Replay-from-event-log internals

1. Load the source run's events with `sequence < fromSeq` through the storage boundary, where an era-`2` log is translated (persistence.md).
2. Fold them to a projected state.
3. Initialize the new run with that state, copy-on-write into its own log.
4. For `replay`, resolve side-effecting nodes from the source run's recorded outcomes keyed on `(sourceRunId, nodeId, attempt)`; LLM invocations additionally consult the invocation log via the RFC 0041 content-addressed key.
5. For `branch`, executor invocations create new invocation-log entries keyed on the new `runId`.

## Forking a v1 run

A v2 host MUST fork a run created before the cut (era `2`, persistence.md). The fork's prefix MUST be byte-equivalent to the *translated* parent — the parent as read through the codemap, not its stored bytes — and `run.started` on the fork MUST carry the legacy Subject (`issuer: urn:openwop:legacy`, identity.md) where the parent had none (RFC 0176 §A.5, scenario `fork-a-v1-run`). A backfill of an era-`2` log is permitted only atomically per run with the original preserved, so this obligation stays checkable.

## Retention

A host advertising `replay` MUST document retention for source snapshots, source logs, the invocation records replay depends on, and forked runs; `retention.days` MAY advertise the window. When the range `fromSeq` needs has expired, the host MUST reject the fork with `410` or `422`; `details` SHOULD carry `sourceRunId`, `fromSeq`, and the boundary.

See also: events.md, runs.md, persistence.md, security-defaults.md.
