# Events

> **Status: Stable.**
> **Normative home:** `heartbeat`, `hostEvents`, `feedback`, `providerUsage`, `limits`.

## Why this exists

A run is its append-only event log. Every snapshot, stream, poll, fork and diff is a projection of it.

## The envelope

`schemas/v2/run-event.schema.json` (`RunEventDoc`) is closed. `eventId`, `runId`, `type`, `payload`, `timestamp`, `sequence` and `schemaVersion` are REQUIRED; `nodeId`, `engineVersion` and `causationId` are OPTIONAL. Every id field `$ref`s its grammar in `schemas/v2/ids.schema.json` ([identity.md](identity.md)).

| Field | Meaning |
| --- | --- |
| `sequence` | The one ordering field: integer ≥ 0, first event `0`, strictly increasing per run |
| `schemaVersion` | Per-event schema version, integer ≥ 1, first-class |
| `engineVersion` | Integer ≥ 0 everywhere |
| `eventId` | Host-minted, opaque |
| `causationId` | The `eventId` that caused this event |
| `timestamp` | ISO 8601 |

- Persisted logs are never renumbered.
- A consumer MUST treat `eventId` as a string.
- A consumer MUST NOT throw on an event whose `type` it does not know; it folds what it understands and ignores the rest.

## Types

`type` is `oneOf` a closed enum of registered protocol types and a vendor pattern. The enum is generated from `spec/v2/event-codemap.json` and MUST NOT be edited by hand. The vendor branch is exactly:

```text
^(?!openwop\.)[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)?$
```

- **Naming.** A protocol type is `domain.verb-ed`: kebab-case, exactly two segments, past tense for a transition (`run.started`, `node.suspend-failed`). `domain.noun` is permitted only for an emitted artifact (`output.chunk`, `channel.presence`); each exception is recorded in the codemap.
- **Reserved prefix.** `openwop.` is the only reserved prefix. `core.`, `community.`, `vendor.`, `private.` and `local.` are pack namespaces, not event namespaces; a type under them is invalid.
- **Vendor events.** A vendor type's first segment MUST be an org registered in the `extensions` object of `spec/v2/declaration.json` (the org registry, not discovery's `extensions` key). An unregistered org fails validation. An org in `reservedOrgs` is forbidden and never registered. `extensionsKeyPattern` is a vendor type's shape, not a permission to use it. `example` is reserved for documentation and conformance, never a vendor.
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

## The events channel

`api/v2/asyncapi.yaml` declares one channel, `runEvents`, at `/runs/{runId}/events`, and `api/v2/openapi.yaml` the same path (`streamRunEvents`); both MUST resolve to one absolute path.

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

A host MUST set `Content-Type: text/event-stream`, MUST emit a keep-alive comment at least every 30 seconds, and MUST close the connection after the run's terminal event.

#### Resuming with `Last-Event-ID`

`Last-Event-ID: N` resumes every mode as an exclusive cursor, with the semantics of poll's `afterSequence`.

- The host MUST stream the events with `sequence > N` in log order and MUST NOT re-emit `N`.
- When `N` is at or beyond the last persisted sequence there is no backlog. On a live run the host MUST hold the stream open for later events; on a terminal run it MUST close the stream without a frame.
- A host MUST NOT refuse a well-formed non-negative integer `Last-Event-ID` because no event carries that sequence. Any other value SHOULD be refused with `400 validation_error`.
- The header is evaluated only after the caller is authorized to read the run. For a run the caller cannot read, the response MUST be the one the host gives without the header.
- In `values` mode, resumption MUST emit a `state.snapshot` first.

#### Bounded close

With `resumable=true`, a host advertising `limits.maxStreamAgeSec` MAY end a live stream early, per that facet. That close is not terminal; the consumer MUST resume with `Last-Event-ID`.

#### Batching and subscribers

With `bufferMs` (0..5000) the host accumulates events into one `event: batch` frame whose `data:` is an array of `RunEventDoc`.

- It MUST flush on a terminal event, on `node.suspended`, and on close.
- The batch's `id:` SHOULD be its highest `sequence`, and `Last-Event-ID` MUST honor that id.
- A consumer MUST tolerate both a one-element batch and an unbatched frame.
- A host MUST NOT limit subscribers per run except for resource protection, and then MUST answer `429 rate_limited` with `Retry-After` rather than drop silently.

### Host events

`hostEvents` carries the heartbeat messages (`schemas/v2/heartbeat-evaluated.schema.json`, `schemas/v2/heartbeat-state-changed.schema.json`) and host events at the default address `/host/events` (`streamHostEvents`). A host MAY declare another address under `heartbeat.deliveryChannel` ([capabilities.md](capabilities.md)); every channel has an address. The channel carries no run data. Every host event, and every heartbeat a tenant owns, MUST reach only that tenant's subscribers.

#### `hostEvents`

A host event's envelope (`schemas/v2/host-event.schema.json`) has no `runId` or `sequence`. `hostEvents.types[]` lists each emitted type with its `delivery` class. A host advertising it:

- MUST deliver each listed type here, `event:` being the type and `data:` the envelope, and MUST emit no other type or class;
- MUST confine an event naming a `workspaceId` to that workspace, and an ephemeral event to subscribers it is visible to;
- MUST emit each listed `host-test.*` type, only through `emitTestHostEvent`, to the caller's tenant.

`negotiation.decided` is reserved and durable ([interop.md](interop.md)).

An ephemeral event MUST NOT be persisted, redelivered on reconnection, or sent through webhooks, A2A push or any sink; its frame has no `id:`. A durable event's `id:` is its `eventId`; a host SHOULD honour `Last-Event-ID` for it within retention, and MUST under `hostEvents.replay`. A vendor payload MUST NOT carry secrets.

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
- `compensation.*` events and `run.dead-lettered` MAY follow it. Vendor-prefixed types are unconstrained.
- A host that receives work for a run whose terminal event is recorded (a duplicate delivery, a late worker) MUST NOT append forward-execution events for it, SHOULD record the refusal in its operational log, and MUST NOT surface the refusal as a run event.

## Era-2 logs

An `eventLogSchemaVersion` of `2` means v1-written. Every reader, diff included, translates it per [persistence.md](persistence.md) §"The reader rule".

- A projection MUST NOT silently drop a property: it carries it or fails with `500 payload_unprojectable` (hatch `^(openwop-|x-|vendor\.)`).
- Fork and replay over an era-2 parent are in [replay.md](replay.md).

## Feedback and usage facets

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
- **`providerUsage.costEstimates`** advertises that the host stamps a derived cost on the event. It is an estimate from the host's rate table; a consumer MUST NOT treat it as a billed amount.
- The payload MUST NOT carry credential refs, hashed credential identifiers, or prompt or response text (invariant `provider-usage-no-credential-leak`).
- `providerUsage.currency` is the ISO 4217 currency of `costEstimateUsd`; absent means USD.

*Sources: RFCs 0026, 0030, 0032, 0033, 0056, 0060, 0171, 0172, 0176, 0185, 0194, 0213, 0236, 0247.*
