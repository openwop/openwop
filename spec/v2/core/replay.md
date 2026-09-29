# Replay and Fork

> **Status: Stable.**
> **Normative home:** `eventLog`, `replay`, `nondeterminismPolicy`.

## Why this exists

`POST /runs/{runId}:fork` makes any past state of a run re-executable: a replay proves that current code reproduces recorded history; a branch explores an alternative from a recorded point. This document states what a fork MUST reproduce, what it MUST NOT re-fire, and how a host proves the second.

## The surface

A host that advertises `replay` ([capabilities.md](capabilities.md)) serves `forkRun` (`api/v2/openapi.yaml`, `POST /runs/{runId}:fork`) and `getEffectSeamManifest` (`GET /host/effect-seams`).

The `replay` facet (`spec/v2/facets/replay.schema.json`) is `{ modes[], retention?, effectSeamsManifest }`:

- `modes` enumerates `replay | branch` (the `forkRun` `mode` values);
- `effectSeamsManifest` is the constant `/host/effect-seams`.

Suppression is the only conforming replay behavior; no field turns it off, and `none` is not a value.

The request body, `fromSeq` defaults and `201` response are [runs.md §Fork](runs.md). Events with `sequence < fromSeq` are fixed history; events `>= fromSeq` are re-executed.

Refusals:

- `fromSeq` out of range — `400`.
- A sequence absent from the source log — `422`.
- A `fromSeq` greater than the sequence of the source run's terminal run event MUST be refused `422 fork_point_invalid`: the fork would inherit a terminal event and then execute. This binds only where a compensation tail follows the terminal event.
- Source run not visible to the caller — `404`.

## Modes

**`replay`** re-executes the workflow against current code from `fromSeq`, consuming the source run's events as fixed history.

**`branch`** starts from the projected state at `fromSeq` with caller-supplied `runOptionsOverlay`. A branch is an independent run and is NOT deterministic by design; determinism and suppression apply only to the inherited prefix.

## Byte-equivalence of the prefix

The replay contract is observable-output-sequence determinism, not bit-equivalent execution:

1. The events at indices `[0, fromSeq)` MUST be byte-equivalent between source and replay, modulo per-region clock fields and ULID time-component entropy when ULIDs are minted fresh. The event at `fromSeq` is governed by §Divergence.
2. `variables`, `channels`, and `status` of the run snapshot at each index in that range MUST be byte-equivalent.
3. The bytes on the wire of underlying tool and LLM calls MAY differ, provided the observable state at each index is byte-equivalent.

A host MUST cache the observable result (return value, workflow-state effects, emitted events), not merely the tool-call boundary. The cache key for LLM-calling nodes is the content-addressed invocation key defined in [RFC 0041](https://github.com/openwop/openwop/blob/main/RFCS/0041-multi-agent-replay-under-nondeterminism.md); for other tool-calling nodes it MUST be content-addressable, never a host-internal sequence number or timestamp.

## Determinism caveats (`replay` mode)

1. A side-effecting node MUST NOT call the external system twice; see §Suppression.
2. `ctx.interrupt(K)` MUST short-circuit to the persisted `interrupt.resolved` value.
3. `ctx.getVersion` pins from the source run are fixed history; the replay MUST take the recorded branch.
4. Nodes MUST consume time via `ctx.now()` where available; direct clock reads make replay non-deterministic.
5. Recorded-fact events such as `memory.written` are fixed history. A replay MUST re-emit them verbatim from the log and MUST NOT regenerate their identifiers or timestamps — never a new `memoryId`. A `branch` MAY perform its own memory writes with fresh identifiers.
6. Approver eligibility recorded on a resume event is fixed history; a host MUST NOT re-resolve membership during replay.

## Divergence

When a replayed node produces an event different from the source at the same sequence, the host:

- MUST continue;
- MUST emit `replay.diverged` `{ originalEventId, replayEventId, divergencePoint }`;
- MUST surface it in `debug` stream mode and as OTel attribute `openwop.replay.diverged: true`.

Divergence codes (`spec/v2/errors.json`):

- **`replay_diverged_at_refusal`** (fork fails, `409`) — the source obtained a valid envelope and the replay a refusal, or the reverse. The host MUST NOT substitute silently; it MUST emit `replay.diverged-at-refusal` naming the node and both envelope kinds and fail the replay with this code.
- **`replay_source_missing`** (`node.failed` payload; the fork request still returns `201`) — a side-effecting node reached with no recorded source outcome (§Suppression).
- **`replay_memory_snapshot_unavailable`** (fork refused, `409`) — the host cannot serve memory state as-of `fromSeq`. It MUST refuse rather than substitute current memory; `details.fromSeq` SHOULD name the index.
- **`replay_context_summary_unavailable`** (fork refused, `409`) — the host advertises `multiAgent.executionModel.contextBudget.summarization` and cannot serve, as-of `fromSeq`, a summary artifact (`context.summarized.summaryRef`) the replay would reuse. It MUST refuse rather than re-summarize; `details.fromSeq` SHOULD name the index.

## Suppression

Suppression is an obligation of the `replay` surface: advertising `replay` binds it, and a host that cannot suppress MUST NOT advertise `replay`. A relaxation is an operator setting recorded in the certification bundle (security-defaults.md).

For a fork with `mode: replay`:

1. A node that performs an external side effect — any operation observable outside the run's own event log — MUST NOT perform it.
2. The host MUST resolve the node's outcome from the source run's recorded terminal outcome keyed on `(sourceRunId, nodeId, n)`, never on the fork's own `runId`, where `n` counts the node's `node.started` events through this execution, including retries, later visits and the fork's inherited prefix.
3. Absent a recorded outcome, the host MUST fail the node closed with `replay_source_missing`, MUST NOT perform the effect, and MUST NOT substitute a synthesized or empty success.
4. A node whose pack manifest declares `role: "side-effect"` MUST be treated as side-effecting; a host classifier MAY add nodes and MUST NOT remove any. A throwing seam satisfies rule 1 only.
5. The guarantee is whole-run and requires both classification before execution and a default-deny guard at every effect seam.
6. A dispatch to a peer host is an outbound call under rule 2; the peer is never contacted.

Pure nodes and LLM calls served from the invocation log MUST re-execute live; otherwise divergence detection is vacuous.

**Fan-out.** A host that projects its log outward — webhook delivery, A2A push, outbound streams, analytics or audit sinks — MUST NOT deliver events a replay re-emits as fixed history, and a fork of either mode MUST NOT inherit its source's A2A push configs. Replay-ness MUST be read from the run, never from the event type; the fork's own log MUST still carry the re-emitted events ([webhooks.md](webhooks.md)).

**Branch.** A branch re-fires effects for sequences `>= fromSeq`; those are effects the operator asked for. A host MAY suppress branch effects and MUST NOT report that as replay suppression. A host SHOULD surface the re-fire in operator-facing fork UI.

### The effect-seam manifest

A host advertising `replay` MUST publish `schemas/v2/effect-seam-manifest.schema.json`-shaped data at `GET /host/effect-seams`: `{ manifestVersion: "1", host: { name, build }, seams[] }`, one row per outbound effect path its node runtime can reach, `{ seam, kind, guarded: true, guardedBy, branchReFires?, note? }`. The host owns the list. The suite drives one seam of each kind it can reach and observes no re-fire (`effect-seam-manifest`, [conformance.md](conformance.md)).

`kind` names the outbound wire mechanism the seam leaves the host by — not the suite's driving mechanism, and not the business purpose. It MUST be one of `http`, `smtp`, `queue`, `storage`, `provider-sdk`, `webhook-fanout`, `other`.

- Two seams a host guards through one code path but that leave by different mechanisms are different `kind`s; two that leave by the same mechanism for different business reasons are one.
- `other` is the escape for a mechanism this list does not name — raw TCP, gRPC, a filesystem write, a device SDK. A row using it MUST carry `note` naming that mechanism.

**Completeness outranks driveability.** Every outbound effect path the node runtime can reach MUST be listed, including one the suite cannot drive (typically `smtp` or `other`); the scenario records that one `inapplicable`, naming the mechanism. A host MUST NOT omit a seam because the suite cannot drive it, and MUST NOT relabel it as a `kind` the suite can drive. The manifest is a self-declaration whose false negatives are found by audit, not a witness.

## Replay-from-event-log internals

1. Load the source run's events with `sequence < fromSeq` through the storage boundary, where an era-`2` log is translated (persistence.md).
2. Fold them to a projected state.
3. Initialize the new run with that state, copy-on-write into its own log.
4. For `replay`, resolve side-effecting nodes from the source run's recorded outcomes keyed on `(sourceRunId, nodeId, n)`; LLM invocations additionally consult the invocation log via the content-addressed invocation key.
5. For `branch`, executor invocations create new invocation-log entries keyed on the new `runId`.

## Forking a v1 run

A v2 host MUST fork a run created before the cut (era `2`, [persistence.md](persistence.md)). The `fork-a-v1-run` scenario witnesses this.

- The fork's prefix MUST be byte-equivalent to the *translated* parent — the parent as read through the codemap, not its stored bytes.
- `run.started` on the fork MUST carry the legacy Subject (`issuer: urn:openwop:legacy`, [identity.md](identity.md)) where the parent had none.
- A backfill of an era-`2` log is permitted only atomically per run with the original preserved, so this obligation stays checkable.

## Cross-engine ordering

When a host advertises both `idempotency.multiRegion` and `eventLog.crossEngineOrdering`, a fork served by a region other than the one that wrote the run MUST produce the same observable state at the `fromSeq` boundary as a fork served by the writing region:

- `status`, `variables`, and the projected event log up to `fromSeq` MUST be byte-equivalent across regions.
- Per-region wall-clock and entropy fields in events after the boundary MAY differ.

A host that advertises only one of the two keeps the single-region contract above; a host that advertises neither is single-region and the cross-region claim does not apply.

## Retention

A host advertising `replay` MUST document retention for source snapshots, source logs, the invocation records replay depends on, and forked runs; `retention.days` MAY advertise the window. When the range `fromSeq` needs has expired, the host MUST reject the fork with `410 run_expired` or `422`; `details` SHOULD carry `sourceRunId`, `fromSeq`, and the boundary.

## Declared nondeterminism

`nondeterminismPolicy` is the host's statement of which nondeterministic sources it declares rather than suppresses. A host advertising `nondeterminismPolicy.declared` MUST record every declared source in the run's event log at the point it is read, so a fork replays the recorded value rather than re-drawing it. A source the host neither declares nor suppresses is a replay defect, not a policy choice.

See also: events.md, runs.md, persistence.md, security-defaults.md.

*Sources: RFCs 0036, 0039, 0041, 0057, 0104, 0111, 0140, 0173, 0176, 0194, 0228.*
