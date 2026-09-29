# Events

> **Status: Stable.**
> **Normative home:** `heartbeat`, `envelopeContracts`, `envelopes`, `feedback`, `providerUsage`, `supportedEnvelopes`, `schemaVersions`, `envelopeStrictness`.

## Why this exists

A run is its append-only event log. Every snapshot, stream, poll, fork and diff is a projection of it. There is one closed envelope, type registry, payload registry, ordering field, events channel and poll cursor.

## The envelope

`schemas/v2/run-event.schema.json` (`RunEventDoc`) is closed. `eventId`, `runId`, `type`, `payload`, `timestamp`, `sequence` and `schemaVersion` are REQUIRED; `nodeId`, `engineVersion` and `causationId` are OPTIONAL. Every id field `$ref`s its grammar in `schemas/v2/ids.schema.json` ([identity.md](identity.md)).

| Field | Meaning |
| --- | --- |
| `sequence` | The one ordering field: integer ≥ 0, first event `0`, strictly increasing per run |
| `schemaVersion` | Per-event schema version, integer ≥ 1, first-class |
| `engineVersion` | Integer ≥ 0 everywhere |
| `eventId` | Host-minted, opaque |
| `causationId` | The `eventId`, or AI-envelope `correlationId`, that caused this event |
| `timestamp` | ISO 8601 |

- Persisted logs are never renumbered.
- A consumer MUST treat `eventId` as a string.
- A consumer MUST NOT throw on an event whose `type` it does not know; it folds what it understands and ignores the rest.

## Types

`type` is `oneOf` a closed enum of registered protocol types and a vendor pattern. The enum is generated from `spec/v2/event-codemap.json` and MUST NOT be edited by hand. The vendor branch is exactly:

```text
^(?!openwop\.)[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)?$
```

- **Naming.** A protocol type is `domain.verb-ed`: kebab-case, exactly two segments, past tense for a transition (`run.started`, `node.suspend-failed`, `run.resume-started`). `domain.noun` is permitted only for an emitted artifact (`output.chunk`, `provider.usage`, `channel.presence`, `agent.handoff`, `envelope.refusal`, `agent.reasoning-delta`, `voice.synthesis-chunk`, `voice.endpoint-candidate`); each exception is recorded in the codemap.
- **Reserved prefix.** `openwop.` is the only reserved prefix. `core.`, `community.`, `vendor.`, `private.` and `local.` are pack namespaces, not event namespaces; a type under them is invalid.
- **Vendor events.** A vendor type's first segment MUST be an org registered in the `extensions` object of `spec/v2/declaration.json` (the org registry, not the `extensions` metadata key a host publishes in discovery). An unregistered org fails validation. An org in `reservedOrgs` is forbidden and never registered. `extensionsKeyPattern` is the shape a vendor type must have, not a permission to use it. `example` is held by the protocol for documentation and conformance and is never assignable to a vendor.
- **Growth.** The registry grows by the closed-enum rule in [overview.md](overview.md) §0. A producer MUST NOT emit an unregistered protocol type. A consumer MUST accept an unknown registered member and MUST NOT act on it.

## Payloads

`schemas/v2/run-event-payloads.schema.json` holds one `$defs` entry per payload, each `additionalProperties: false`, plus `_typeIndex`: the normative map from v2 type to `$defs` key, generated from `spec/v2/event-codemap.json`.

- A host MUST emit a payload that validates against the entry `_typeIndex` names for its `type`.
- Sub-typing is `$ref` composition, never duplication. `approval.*` and `clarification.*` resolve to `interruptRequested` / `interruptResolved` ([interrupt.md](interrupt.md)); `lease.acquired`, `lease.renewed` and `lease.lost` share `leaseLifecycle`.
- The CloudEvents mapping and the webhook delivery envelope are generated from the same definition. An event's `type`, `eventId`, `sequence` and `payload` are byte-identical across the run stream, a CloudEvents rendering and a webhook delivery.

Specific payloads:

- `run.started` carries the `owner` block ([identity.md](identity.md) §1.1).
- `run.cancelled` carries `reason`, `cancelledBy`, `durationMs`, and `parentRunId`.
- `run.completed` MUST carry `outputs` as an object. An empty object is valid; an absent key is not. This separates "no outputs" from "outputs not rendered".

## AI envelopes: E1–E5

`schemas/v2/ai-envelope.schema.json` is the shape an LLM emits; the engine records its acceptance as one or more `RunEventDoc`s.

- `correlationId` and `meta.source` are REQUIRED on every envelope. An engine MUST reject an envelope that omits either; nothing is synthesized.
- An envelope kind MUST be namespaced under the same `<org>.` rule as events, universal kinds and the core content-primitive families `ui.*` and `media.*` excepted.

The five contracts:

- **E1 partial reassembly.** Every chunk of one partial emission carries the same `correlationId`, and the events that record them are ordered by `sequence`. The emission is complete at the first recorded chunk with `partial: false`. A consumer MAY render progressively but MUST NOT enable any action before that event.
- **E2 multi-turn correlation.** Each turn is an envelope with its own `correlationId`; every event it produces carries `causationId = correlationId`. A re-emission with a `correlationId` already recorded in the run MUST return the cached outcome and MUST NOT emit new events.
- **E3 vendor kinds.** The registry of vendor kinds is `spec/v2/declaration.json`. A kind whose org is not registered is invalid.
- **E4 sub-typing.** `$ref` composition, as in the payload registry above.
- **E5 refusal × retry.** `configurable.ai.maxRefusals` ([runs.md](runs.md)) is the ceiling on `envelope.refusal` events a run records. A host MUST NOT retry the emission that produced a refusal.

## The events channel

`api/v2/asyncapi.yaml` declares one channel, `runEvents`, at `/runs/{runId}/events`, and `api/v2/openapi.yaml` declares the same path (`streamRunEvents`). The two MUST resolve to the same absolute path.

### Stream modes

The `streamMode` query parameter is one pattern:

```text
^(values|(updates|messages|debug)(,(updates|messages|debug))*)$
```

| Mode | Emits | Combines |
| --- | --- | --- |
| `updates` (default) | Deltas for run transitions, terminal node transitions, suspensions, `node.dispatched`, interrupt events, `artifact.created`, `eval.*`, `deployment.*`, `workspace.updated` | yes |
| `values` | One synthesized `state.snapshot` (`schemas/v2/run-snapshot.schema.json`) after each `updates`-tier transition | never |
| `messages` | `ai.message.chunk` (`outputChunk` payload) from streaming AI nodes only | yes |
| `debug` | Every event in the log, including `log.appended`, `variable.changed`, `version.pinned`, `lease.*`, `node.retried` and every vendor event | yes |

- A host MUST implement `updates` and SHOULD implement all four.
- A value outside the pattern, or a mode the host does not implement, MUST return `400 unsupported_stream_mode` with `details.supported` listing each individual mode the host serves; combinations are not listed.
- Validation MUST run before any content negotiation.
- In `messages`, a host MUST populate a Tier 1 `meta` slot whenever it has the data.
- Vendor events appear in `debug` only.
- In a mixed mode the host emits the union of the filters in log order and MUST NOT reorder. Each frame SHOULD carry `event:` naming the mode that admitted it. A consumer MUST tolerate an event admitted by more than one mode.

### SSE frames

Each frame carries `id:` (the `sequence`), `event:` (the v2 `type`, in a single mode) and `data:` (the `RunEventDoc`). Three frame names are not types and are absent from the `type` enum:

- `state.snapshot` — `values` mode; `data:` is a `RunSnapshot`.
- `batch` — `bufferMs`; `data:` is an array of `RunEventDoc`.
- `ai.message.chunk` — `messages` mode; `data:` is the `outputChunk` payload, persisted as type `output.chunk`.

A host MUST set `Content-Type: text/event-stream`, MUST emit a keep-alive comment at least every 30 seconds, and MUST close the connection after the run's terminal event (`run.completed`, `run.failed`, `run.cancelled`).

#### Resuming with `Last-Event-ID`

`Last-Event-ID: N` resumes every mode as an exclusive cursor, with the semantics of poll's `afterSequence`.

- The host MUST stream the events with `sequence > N` in log order and MUST NOT re-emit `N`.
- When `N` is at or beyond the last persisted sequence there is no backlog. On a live run the host MUST hold the stream open for later events; on a terminal run it MUST close the stream without a frame.
- A host MUST NOT refuse a well-formed non-negative integer `Last-Event-ID` because no event carries that sequence. Any other value SHOULD be refused with `400 validation_error`.
- The header is evaluated only after the caller is authorized to read the run. For a run the caller cannot read, the response MUST be the one the host gives without the header.
- In `values` mode, resumption MUST emit a `state.snapshot` first.

#### Batching and subscribers

With `bufferMs` (0..5000) the host accumulates events into one `event: batch` frame whose `data:` is an array of `RunEventDoc`.

- It MUST flush on a terminal event, on `node.suspended`, and on close.
- The batch's `id:` SHOULD be its highest `sequence`, and `Last-Event-ID` MUST honor that id.
- A consumer MUST tolerate both a one-element batch and an unbatched frame.
- A host MUST NOT limit subscribers per run except for resource protection, and then MUST answer `429 rate_limited` with `Retry-After` rather than drop silently.

### Host events

`hostEvents` carries the heartbeat messages (`schemas/v2/heartbeat-evaluated.schema.json`, `schemas/v2/heartbeat-state-changed.schema.json`) at the default address `/host/events` (`streamHostEvents`). A host MAY declare another address under `heartbeat.deliveryChannel` ([capabilities.md](capabilities.md)); every channel has an address. The channel carries no run data.

#### `heartbeat`

A heartbeat evaluates a predicate on an interval (at least `minIntervalSec`) and acts only on a state change. A host advertising `heartbeat` SHOULD also advertise `scheduling`, and otherwise MUST document its own interval substrate. On each tick it MUST:

- skip, not queue, a tick while the prior evaluation still runs;
- bound the evaluation by `maxRuntimeMs`, itself capped by `limits.maxRunDurationMs`, terminating an overrun with `status: timeout`;
- pass the predicate the prior tick's state, and perform no side effect itself. The predicate MUST be a pure function of observed and prior state;
- emit `heartbeat.evaluated`;
- on a transition only, emit `heartbeat.stateChanged` and, if the predicate asks, call `createRun`; never on an unchanged tick.

The first tick of a `heartbeatId` MUST be treated as a transition from `{}`. A durable host SHOULD persist prior state so a restart does not re-notify.

## Poll

`GET /runs/{runId}/events/poll` (`pollRunEvents`) is the long-poll fallback.

| Parameter | Meaning |
| --- | --- |
| `afterSequence` | Integer ≥ 0; return events with `sequence > afterSequence`. Omitted means from sequence 0 |
| `timeout` | Seconds to wait for new events, 1..60, default 30 |

`lastSequence` and `since` are not parameters.

The response is `{ runId, events, lastSequence, status, isTerminal }` (closed):

- `lastSequence` is the highest sequence in the log at the time of the response, `-1` when the log is empty.
- `status` is the snapshot status; `isTerminal` is whether the run is terminal.
- A cursor past the end of the log MUST return `200` with an empty `events` array.

## The terminal event

A run's log MUST contain exactly one terminal run event: `run.completed`, `run.failed` or `run.cancelled`.

- After it, the log MUST NOT contain another terminal run event, `run.started`, `run.resumed`, `run.resume-started`, `run.paused`, `run.restored-from-snapshot`, any `node.*` event or any `interrupt.*` event.
- `compensation.*` events and `run.dead-lettered` MAY follow it (a compensating host unwinds after a cancelled parent). Vendor-prefixed types are unconstrained.
- A host that receives work for a run whose terminal event is recorded (a duplicate delivery, a late worker) MUST NOT append forward-execution events for it, SHOULD record the refusal in its operational log, and MUST NOT surface the refusal as a run event.

## Era-2 logs

An `eventLogSchemaVersion` of `2` means v1-written. Every reader, diff included, translates it per [persistence.md](persistence.md) §"The reader rule".

- A projection MUST NOT silently drop a property: it carries it or fails with `500 payload_unprojectable` (hatch `^(openwop-|x-|vendor\.)`).
- Fork and replay over an era-2 parent are in [replay.md](replay.md).

## The envelope-kind catalog

`supportedEnvelopes`, `schemaVersions` and `envelopeStrictness` are one flow, read in that order on every inbound envelope.

### `supportedEnvelopes`

`supportedEnvelopes.kinds` is the catalog. A host advertising it MUST refuse an emitted `type` that is neither universal nor a member, with `unknown_envelope_kind`.

An absent `kinds` is not an empty catalog and is not an unrestricted one: a host advertising `supportedEnvelopes` without it has made no catalog claim, and an engine MUST refuse every non-universal kind rather than admit it unchecked.

### `schemaVersions`

`schemaVersions.kinds` maps a kind to its advertised floor; a kind absent from the map has a floor of `0`. An emitted `schemaVersion` above the floor MUST be refused with `unknown_schema_version`, whatever the strictness. `ui.a2ui-surface` at schema version 2 is specified by `ext/a2uiSurface/README.md`.

### `envelopeStrictness`

`envelopeStrictness.mode` governs drift below the floor only. A host MUST NOT read an absent `mode` as "no checking".

- Under `warn` (the value when the seat is absent), an engine MUST validate against the advertised version and log `envelope_schema_version_drift`.
- Under `strict`, the same condition MUST refuse with `unknown_schema_version`.

## Envelope contracts

`envelopeContracts` advertises that a host enforces per-node envelope permission sets. A host advertising `envelopeContracts.advertised` MUST refuse a node whose emitted envelope `type` is neither universal nor listed in that node's accepted set. It MUST refuse it distinctly from the capability-gated `typeId` refusal: the two stack rather than substitute.

## Envelope, feedback and usage facets

### `feedback`

`feedback.signals` lists the signal kinds a host accepts; absent means all four. `feedback.targets` names the resources an annotation may be attached to. A host advertising `feedback` MUST:

- accept an annotation on a terminal run;
- refuse an annotation whose target is outside the advertised `targets`, and MUST NOT write it to the replayable run event log;
- keep annotations visible only within the run's tenant (invariant `annotation-cross-tenant-isolation`);
- redact secret-shaped material in `signal.correction` and `note` before persistence, listing and export (invariant `annotation-content-redaction`);
- audit-log each recording with the acting principal.

### `providerUsage`

A host advertising `providerUsage` MUST emit exactly one `provider.usage` per LLM provider invocation, before that node's `node.completed`. A host that does not advertise it omits the event.

- `inputTokens` and `outputTokens` MUST replay identically; `costEstimateUsd` MAY be omitted on replay.
- **`providerUsage.costEstimates`** advertises that the host stamps a derived cost on the event. That figure is an estimate from the host's own rate table; a consumer MUST NOT treat it as a billed amount.
- The payload MUST NOT carry credential refs, hashed credential identifiers, or prompt or response text (invariant `provider-usage-no-credential-leak`).
- `providerUsage.currency` is the ISO 4217 currency of `costEstimateUsd`; absent means USD.

### `envelopes`

**`envelopes.tierOneSubsetCompliance`** advertises that the host accepts the Tier 1 structured-output subset shared across major providers. A host advertising it MUST accept an envelope restricted to that subset from any provider it advertises, rather than refusing on provider-specific grounds.

`envelopes.reasoning` advertises the host's prompt posture for the optional payload field `reasoning`.

- `reasoning` SHOULD be the first property where the schema dialect orders properties. A vendor kind whose payload needs multi-step reasoning SHOULD declare it as optional.
- Where a payload schema permits it, a host SHOULD instruct the model to populate it. A host MUST NOT reject an envelope without it, whatever `promptDirective` says.
- A host MUST NOT route on `reasoning`. A known secret in the input MUST NOT appear verbatim in it, in derived events, span attributes or the debug bundle (invariant `envelope-reasoning-secret-redaction`).

A host advertising `envelopes.reliability`:

- MUST emit `envelope.retry-exhausted` and `envelope.refusal`, and list in `reliability.events[]` both of them and only the other reliability events it emits;
- SHOULD emit `envelope.retry-attempted` before each retry past the first;
- MUST pass `previousError`, `finalError` and `refusalText` through the secret redaction applied to envelope payloads (invariants `envelope-refusal-no-prompt-leak`, `envelope-recovery-no-content-leak`);
- MUST replay `totalAttempts`, `outputTokenCount` and the recovery `path` identically. `refusalText` MAY differ, and a consumer MUST tolerate `null`.

Under `reliability.completion.distinguishesTruncation`, an envelope is complete only on a clean provider stop with a payload that validates against its kind's schema.

- **Truncation** (no clean stop, whatever the payload): the host MUST emit `envelope.truncated`. A retry SHOULD raise the output budget, by `truncationBudgetMultiplier` (default 2), and MUST NOT carry a schema-correcting fragment.
- **Schema violation** (clean stop, invalid payload): a retry's corrective fragment SHOULD reproduce the validator's failure and MUST NOT contain text from the model's output. The retry MUST NOT raise the output budget.
- **Refusal** is terminal: the node MUST fail with `envelope_refusal`.
- Each retry past the first MUST emit `envelope.retry-attempted` with that `reason`. Both paths count against `limits.schemaRounds`.
- On exhaustion the host MUST emit `envelope.retry-exhausted` with that `finalReason` and `cap.breached` `kind: "schema"`, and fail the node with `envelope_truncation_unrecoverable` or `envelope_invalid`.
- Lenient-parse recovery consumes no retry. It emits `envelope.recovery-applied` once per recovery, carrying only the path and an optional byte offset.

*Sources: RFCs 0026, 0030, 0032, 0033, 0056, 0060, 0171, 0172, 0176, 0185, 0194, 0213.*
