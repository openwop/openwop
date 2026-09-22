# Events

> **Status: Stable · RFC 0171 §A, §E; RFC 0176 §A.**
> **Normative home:** `heartbeat`, `envelopeContracts`, `envelopes`, `feedback`, `providerUsage`, `supportedEnvelopes`, `schemaVersions`, `envelopeStrictness`.

## Why this exists

A run is its append-only event log; every snapshot, stream, poll, fork and diff is a projection of it. v2 has one closed envelope, type registry, payload registry, ordering field, events channel and poll cursor.

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

`type` is `oneOf` a closed enum of registered protocol types and a vendor pattern. The enum is GENERATED from `spec/v2/event-codemap.json` (118 rows, every row `decided`) and MUST NOT be edited by hand. The vendor branch is exactly:

```text
^(?!openwop\.)[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)?$
```

| Rule | Requirement |
| --- | --- |
| Naming | A protocol type is `domain.verb-ed`: kebab-case, exactly two segments, past tense for a transition (`run.started`, `node.suspend-failed`, `run.resume-started`). `domain.noun` is permitted only for an emitted artifact (`output.chunk`, `provider.usage`, `channel.presence`, `agent.handoff`, `envelope.refusal`, `agent.reasoning-delta`, `voice.synthesis-chunk`, `voice.endpoint-candidate`); each exception is recorded in the codemap and checked by the corpus gate. |
| Reserved prefix | `openwop.` is the only reserved prefix. `core.`, `community.`, `vendor.`, `private.` and `local.` are pack namespaces, not event namespaces, and a type under them is invalid. |
| Vendor events | A vendor type's first segment MUST be an org registered in the `extensions` object of `spec/v2/declaration.json` — the ORG REGISTRY, not the `extensions` metadata key a host publishes in its own discovery payload; an unregistered org fails validation. An org named in `reservedOrgs` is forbidden, never registered, and `extensionsKeyPattern` is the shape a vendor type must have, not a permission to use it. The registry is normally small: `example` is held by the protocol for documentation and conformance and is never assignable to a vendor. |
| Growth | The registry grows by the closed-enum rule in overview.md §0: a producer MUST NOT emit an unregistered protocol type; a consumer MUST accept an unknown registered member and MUST NOT act on it. |

## Payloads

`schemas/v2/run-event-payloads.schema.json` holds one `$defs` entry per payload, every entry `additionalProperties: false`, and `_typeIndex`: the NORMATIVE map from v2 type to `$defs` key, GENERATED from `spec/v2/event-codemap.json`. A host MUST emit a payload that validates against the entry `_typeIndex` names for its `type`. Sub-typing is `$ref` composition, never duplication: `approval.*` and `clarification.*` resolve to `interruptRequested` / `interruptResolved` (interrupt.md); `lease.acquired`, `lease.renewed` and `lease.lost` share `leaseLifecycle`.

The CloudEvents mapping and the webhook delivery envelope are GENERATED from the same definition (one source, three renderings): the event's `type`, `eventId`, `sequence` and `payload` are byte-identical across the run stream, a CloudEvents rendering and a webhook delivery.

`run.started` carries the `owner` block (identity.md §1.1).
`run.cancelled` carries `reason`, `cancelledBy`, `durationMs`, and `parentRunId`.
`run.completed` MUST carry `outputs` as an object; an empty object is valid, but
an absent key is not. This distinguishes “no outputs” from “outputs not
rendered” and is witnessed by `v2-run-completed-outputs`.

## AI envelopes: E1–E5

`schemas/v2/ai-envelope.schema.json` is the shape an LLM emits; the engine records its acceptance as one or more `RunEventDoc`s. In v2 `correlationId` and `meta.source` are REQUIRED on every envelope, and an engine MUST reject an envelope that omits either; nothing is synthesized. An envelope kind MUST be namespaced under the same `<org>.` rule as events, universal kinds excepted.

| Gap | Contract |
| --- | --- |
| E1 partial reassembly | Every chunk of one partial emission carries the same `correlationId`; the events that record them are ordered by `sequence`; the emission is complete at the first recorded chunk with `partial: false`. A consumer MAY render progressively but MUST NOT enable any action before that event. |
| E2 multi-turn correlation | Each turn is an envelope with its own `correlationId`; every event it produces carries `causationId = correlationId`. A re-emission with a `correlationId` already recorded in the run MUST return the cached outcome and MUST NOT emit new events. |
| E3 vendor kinds | The registry of vendor kinds is `spec/v2/declaration.json`; a kind whose org is not registered is invalid. |
| E4 sub-typing | `$ref` composition, as in the payload registry above. |
| E5 refusal × retry | `configurable.ai.maxRefusals` (runs.md) is the ceiling on `envelope.refusal` events a run records. A host MUST NOT retry the emission that produced a refusal. |

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

Each frame carries `id:`, `event:` and `data:`: `id:` is the `sequence`, `event:` is the v2 `type` (single mode), `data:` is the `RunEventDoc`. Three frame names are not types and are absent from the `type` enum: `state.snapshot` (`values`; `data:` a `RunSnapshot`), `batch` (`bufferMs`; `data:` an array of `RunEventDoc`) and `ai.message.chunk` (`messages`; `data:` the `outputChunk` payload, persisted type `output.chunk`). A host MUST set `Content-Type: text/event-stream`, MUST emit a keep-alive comment at least every 30 seconds, and MUST close the connection after the run's terminal event (`run.completed`, `run.failed`, `run.cancelled`).

`Last-Event-ID` resumes every mode: the host MUST look up the event with that sequence, MUST begin at the next sequence, and MUST NOT re-emit the resumption point. In `values` mode resumption MUST emit a `state.snapshot` first. With `bufferMs` (0..5000) the host accumulates events into one `event: batch` frame whose `data:` is an array of `RunEventDoc`; it MUST flush on a terminal event, on `node.suspended`, and on close; the batch's `id:` SHOULD be its highest `sequence` and `Last-Event-ID` MUST honor that id. A consumer MUST tolerate both a one-element batch and an unbatched frame. A host MUST NOT limit subscribers per run except for resource protection, and then MUST answer `429 rate_limited` with `Retry-After` rather than drop silently.

### Host events

`hostEvents` carries the heartbeat messages (`schemas/v2/heartbeat-evaluated.schema.json`, `schemas/v2/heartbeat-state-changed.schema.json`) at `/host/events` (`streamHostEvents`), the documented default; a host MAY declare another address under `heartbeat.deliveryChannel` (capabilities.md). The channel is content-free of run data. There is no channel without an address.

## Poll

`GET /runs/{runId}/events/poll` (`pollRunEvents`) is the long-poll fallback.

| Parameter | Rule |
| --- | --- |
| `afterSequence` | Integer ≥ 0; the response carries events with `sequence > afterSequence`. Omission means "from the first event" (sequence 0). `lastSequence` and `since` are not parameters. |
| `timeout` | Seconds to wait for new events, 1..60, default 30. |

The response is `{ runId, events, lastSequence, status, isTerminal }` (closed): `lastSequence` is the highest sequence in the log at the time of the response, `-1` when the log is empty; `status` is the snapshot status; `isTerminal` is whether the run is terminal. A cursor past the end of the log MUST return `200` with an empty `events` array. The shape is declared here and generated into `api/v2/openapi.yaml` from one definition.

## The terminal event

A run's log MUST contain exactly one terminal run event — `run.completed`, `run.failed` or `run.cancelled` — and after it MUST NOT contain another terminal run event, `run.started`, `run.resumed`, `run.resume-started`, `run.paused`, `run.restored-from-snapshot`, any `node.*` event or any `interrupt.*` event. `compensation.*` events and `run.dead-lettered` MAY follow it (a compensating host unwinds after a cancelled parent); vendor-prefixed types are unconstrained. A host that receives work for a run whose terminal event is recorded — a duplicate delivery, a late worker — MUST NOT append forward-execution events for it, SHOULD record the refusal in its operational log, and MUST NOT surface the refusal as a run event (RFC 0194). No stream-closure rule changes.

## Era-2 logs

An `eventLogSchemaVersion` of `2` means v1-written; every reader, diff included, translates it per persistence.md §"The reader rule". **A projection MUST NOT silently drop a property**: carry or fail `500 payload_unprojectable` (hatch `^(openwop-|x-|vendor\.)`; RFC 0185). Fork and replay over an era-2 parent: replay.md.

## The envelope-kind catalog

`supportedEnvelopes`, `schemaVersions` and `envelopeStrictness` are one flow, read in
that order on every inbound envelope.

`supportedEnvelopes.kinds` is the catalog. A host advertising it MUST refuse an
emitted `type` that is neither universal nor a member, with `unknown_envelope_kind`.
**An absent `kinds` is not an empty catalog and is not an unrestricted one**: a host
advertising `supportedEnvelopes` without it has made no catalog claim, and an engine
MUST refuse every non-universal kind rather than admit it unchecked.

`schemaVersions.kinds` maps a kind to its advertised floor; a kind absent from the map
has a floor of `0`. An emitted `schemaVersion` ABOVE the floor MUST be refused with
`unknown_schema_version` whatever the strictness.

`envelopeStrictness.mode` governs drift BELOW the floor only. Under `warn` — the value
when the seat is absent — an engine MUST validate against the advertised version and
log `envelope_schema_version_drift`. Under `strict` the same condition MUST refuse with
`unknown_schema_version`. A host MUST NOT read an absent `mode` as "no checking".

## Envelope contracts

`envelopeContracts` advertises that a host enforces per-node envelope permission
sets. A host advertising `envelopeContracts.advertised` MUST refuse a node whose
emitted envelope `type` is neither universal nor listed in that node's accepted
set, and MUST refuse it distinctly from the capability-gated `typeId` refusal —
the two stack rather than substitute.

## Envelope, feedback and usage facets

`envelopes.tierOneSubsetCompliance` advertises that the host accepts the Tier 1
structured-output subset shared across major providers; a host advertising it MUST
accept an envelope restricted to that subset from any provider it advertises, rather
than refusing on provider-specific grounds.

`feedback.targets` names the resources an annotation may be attached to. A host MUST
refuse an annotation whose target is outside the advertised set, and MUST NOT write it
to the replayable run event log.

`providerUsage.costEstimates` advertises that the host stamps a derived cost on the
`provider.usage` event. That figure is an estimate from the host's own rate table, and
a consumer MUST NOT treat it as a billed amount.

