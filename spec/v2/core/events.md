# Events

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0171 §A, §E; RFC 0176 §A.**

## Why this exists

A run is its append-only event log; every snapshot, stream, poll, fork and diff is a projection of it. v2 has one event envelope, one closed type registry with one naming rule, one payload registry, one ordering field, one events channel and one poll cursor, so that a typo is a validation failure and not a silently ignored event.

## The envelope

`schemas/v2/run-event.schema.json` (`RunEventDoc`) is closed. `eventId`, `runId`, `type`, `payload`, `timestamp`, `sequence` and `schemaVersion` are REQUIRED; `nodeId`, `engineVersion` and `causationId` are OPTIONAL. Every id field `$ref`s its grammar in `schemas/v2/ids.schema.json` (identity.md).

| Field | Rule |
| --- | --- |
| `sequence` | The one ordering field: integer ≥ 0, first event `0`, strictly increasing per run. Persisted logs are never renumbered. |
| `schemaVersion` | Per-event schema version, integer ≥ 1, first-class (RFC 0172 §B axis 5). |
| `engineVersion` | Integer ≥ 0 everywhere (RFC 0172 §B axis 3). |
| `eventId` | Host-minted, opaque; consumers MUST treat it as a string. |
| `causationId` | The `eventId`, or AI-envelope `correlationId`, that caused this event. |
| `timestamp` | ISO 8601. |

A consumer MUST NOT throw on an event whose `type` it does not know; it folds what it understands and ignores the rest.

## Types

`type` is `oneOf` a closed enum of registered protocol types and a vendor pattern. The enum is GENERATED from `spec/v2/event-codemap.json` (117 rows, every row `decided`) and MUST NOT be edited by hand. The vendor branch is exactly:

```text
^(?!openwop\.)[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)?$
```

| Rule | Requirement |
| --- | --- |
| Naming | A protocol type is `domain.verb-ed`: kebab-case, exactly two segments, past tense for a transition (`run.started`, `node.suspend-failed`, `run.resume-started`). `domain.noun` is permitted only for an emitted artifact (`output.chunk`, `provider.usage`, `channel.presence`, `agent.handoff`, `envelope.refusal`, `agent.reasoning-delta`, `voice.synthesis-chunk`, `voice.endpoint-candidate`); each exception is recorded in the codemap and checked by the corpus gate. |
| Reserved prefix | `openwop.` is the only reserved prefix. `core.`, `community.`, `vendor.`, `private.` and `local.` are pack namespaces, not event namespaces, and a type under them is invalid. |
| Vendor events | A vendor type's first segment MUST be an org registered under `extensions` in `spec/v2/declaration.json`; an unregistered org fails validation. |
| Growth | The registry grows by the closed-enum rule in overview.md §0: a producer MUST NOT emit an unregistered protocol type; a consumer MUST accept an unknown registered member and MUST NOT act on it. |

## Payloads

`schemas/v2/run-event-payloads.schema.json` holds one `$defs` entry per payload, every entry `additionalProperties: false`, and `_typeIndex`: the NORMATIVE map from v2 type to `$defs` key, GENERATED from `spec/v2/event-codemap.json`. A host MUST emit a payload that validates against the entry `_typeIndex` names for its `type`. Sub-typing is `$ref` composition, never duplication: `approval.*` and `clarification.*` resolve to `interruptRequested` / `interruptResolved` (interrupt.md); `lease.acquired`, `lease.renewed` and `lease.lost` share `leaseLifecycle`.

The CloudEvents mapping and the webhook delivery envelope are GENERATED from the same definition (one source, three renderings): the event's `type`, `eventId`, `sequence` and `payload` are byte-identical across the run stream, a CloudEvents rendering and a webhook delivery.

`run.started` carries `owner { tenant, workspace?, subject }`, the same closed block as `RunSnapshot.owner` with `subject` REQUIRED (runs.md, identity.md). `run.cancelled` carries `reason`, `cancelledBy`, `durationMs` and `parentRunId`. `run.completed` MUST carry `outputs` as an object — an empty object is a valid value; an absent key is not. A client cannot tell "no outputs" from "outputs not rendered" when the key is missing, and until 2026-09-04 no schema in either major required it: v1 named the property, required nothing and left the object open, so a host emitted the singular `output` for its whole life and validated every time. Closing the object in v2 caught the extra key; only this sentence and its witness (`v2-run-completed-outputs`) catch an absent one.

## AI envelopes: E1–E5

`schemas/v2/ai-envelope.schema.json` is the shape an LLM emits; the engine records its acceptance as one or more `RunEventDoc`s. In v2 `correlationId` and `meta.source` are REQUIRED on every envelope, and an engine MUST reject an envelope that omits either; nothing is synthesized. An envelope kind MUST be namespaced under the same `<org>.` rule as events, universal kinds excepted.

| Gap | Contract |
| --- | --- |
| E1 partial reassembly | Every chunk of one partial emission carries the same `correlationId`; the events that record them are ordered by `sequence`; the emission is complete at the first recorded chunk with `partial: false`. A consumer MAY render progressively but MUST NOT enable any action before that event. |
| E2 multi-turn correlation | Each turn is an envelope with its own `correlationId`; every event it produces carries `causationId = correlationId`. A re-emission with a `correlationId` already recorded in the run MUST return the cached outcome and MUST NOT emit new events. |
| E3 vendor kinds | The registry of vendor kinds is `spec/v2/declaration.json`; a kind whose org is not registered is invalid. |
| E4 sub-typing | `$ref` composition, as in the payload registry above. |
| E5 refusal × retry | `configurable.ai.maxRefusals` (runs.md) is the ceiling on `envelope.refusal` events a run records. A host MUST NOT retry the emission that produced a refusal. |

Worked example (E5), `maxRefusals: 2`:

```text
seq 7  envelope.refusal   nodeId n1  (refusal 1; the run's retry policy re-dispatches n1)
seq 9  envelope.refusal   nodeId n1  (refusal 2 = ceiling)
seq 10 node.failed        error.code envelope_refusal; n1 is not re-dispatched
```

## The events channel

`api/v2/asyncapi.yaml` declares one channel, `runEvents`, at `/runs/{runId}/events`, and `api/v2/openapi.yaml` declares the same path (`streamRunEvents`); the two MUST resolve to the same absolute path (RFC 0172 §C.2). The `streamMode` query parameter is one pattern, not four enums:

```text
^(values|(updates|messages|debug)(,(updates|messages|debug))*)$
```

The default is `updates`. A host MUST implement `updates` and SHOULD implement all four. A value outside the pattern, or a mode the host does not implement, MUST return `400 unsupported_stream_mode` with `details.supported` listing each individual mode the host serves; combinations are not listed. Validation MUST run before any content negotiation.

| Mode | Emits | Combines |
| --- | --- | --- |
| `updates` | Run transitions, terminal node transitions, suspensions, `node.dispatched`, interrupt events, `artifact.created`, `eval.*`, `deployment.*`, `workspace.updated`; each payload is a delta | yes |
| `values` | One synthesized `state.snapshot` (`schemas/v2/run-snapshot.schema.json`) after each `updates`-tier transition | never |
| `messages` | `ai.message.chunk` (`outputChunk` payload) from streaming AI nodes only; a host MUST populate a Tier 1 `meta` slot whenever it has the data | yes |
| `debug` | Every event in the log, including `log.appended`, `variable.changed`, `version.pinned`, `lease.*`, `node.retried` and every vendor event | yes |

Vendor events appear in `debug` only. In a mixed mode the host emits the union of the filters in log order and MUST NOT reorder; each frame SHOULD carry `event:` naming the mode that admitted it, and a consumer MUST tolerate an event admitted by more than one mode.

### SSE frames

Each frame carries `id:`, `event:` and `data:`: `id:` is the `sequence`, `event:` is the v2 `type` (single mode), `data:` is the `RunEventDoc`. Two frame names are not types and are not in the `type` enum: `state.snapshot` (the `values` frame, whose `data:` is a `RunSnapshot`) and `batch` (the `bufferMs` frame, whose `data:` is an array of `RunEventDoc`). A host MUST set `Content-Type: text/event-stream`, MUST emit a keep-alive comment at least every 30 seconds, and MUST close the connection after the run's terminal event (`run.completed`, `run.failed`, `run.cancelled`).

`Last-Event-ID` resumes every mode: the host MUST look up the event with that sequence, MUST begin at the next sequence, and MUST NOT re-emit the resumption point. In `values` mode resumption MUST emit a `state.snapshot` first. With `bufferMs` (0..5000) the host accumulates events into one `event: batch` frame whose `data:` is an array of `RunEventDoc`; it MUST flush on a terminal event, on `node.suspended`, and on close; the batch's `id:` SHOULD be its highest `sequence` and `Last-Event-ID` MUST honor that id. A consumer MUST tolerate both a one-element batch and an unbatched frame. A host MUST NOT limit subscribers per run except for resource protection, and then MUST answer `429 rate_limited` with `Retry-After` rather than drop silently.

### Host events

`hostEvents` carries the heartbeat messages (`schemas/v2/heartbeat-evaluated.schema.json`, `schemas/v2/heartbeat-state-changed.schema.json`) at `/host/events` (`streamHostEvents`), the documented default; a host MAY declare another address under `heartbeat.deliveryChannel` (capabilities.md). The channel is content-free of run data. There is no channel without an address.

## Poll

`GET /runs/{runId}/events/poll` (`pollRunEvents`) is the long-poll fallback.

| Parameter | Rule |
| --- | --- |
| `afterSequence` | Integer ≥ 0; the response carries events with `sequence > afterSequence`. Omission means "from the first event" (sequence 0). `lastSequence` and `since` are not parameters. |
| `timeout` | Seconds to wait for new events, 1..60, default 30. |

The response is `{ runId, events, lastSequence, status, isTerminal }` (closed): `lastSequence` is the highest sequence in the log at the time of the response, `-1` when the log is empty, and has no other meaning; `status` is the snapshot status; `isTerminal` is whether the run is terminal. A cursor past the end of the log MUST return `200` with an empty `events` array. The shape is declared here and generated into `api/v2/openapi.yaml` from one definition.

## Era-2 logs

A run whose `eventLogSchemaVersion` is `2` was written by a v1 host. Every reader (poll, stream, fork, diff, debug bundle) MUST translate each event through `spec/v2/event-codemap.json` at the storage boundary: `type` is mapped, the payload is projected, `sequence` (including `0`), `eventId`, `timestamp` and `causationId` pass through. A type the codemap does not name and that carries no vendor org MUST fail the read with `500 event_type_unmapped`. A host MUST NOT carry a private mapping and MUST NOT rewrite era-2 rows in place. Fork and replay over an era-2 parent are in replay.md.
