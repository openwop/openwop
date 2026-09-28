# Runs

> **Status: Stable.**
> **Normative home:** `runList`, `limits`, `conversationPrimitive`, `dataResidency`.

## Why this exists

A run is the unit of execution, ownership and observation. This document covers the run surface of `api/v2/openapi.yaml`: how a run is created, read, streamed, cancelled, paused, forked and diffed. Every host projects the same snapshot shape from the same event log ([events.md](events.md)).

## Identity

Every id `$ref`s `schemas/v2/ids.schema.json` ([identity.md](identity.md)). A `runId` is host-minted and tenant-bound: `<tenantId>/<opaque>`.

- A caller MUST treat every id as opaque.
- A host MUST reject a `runId` whose tenant segment is not the caller's with `403 id_tenant_mismatch`, and MUST NOT disclose whether the run exists.

## Surface

Every operation accepts `OpenWOP-Version` ([overview.md](overview.md)) and every response carries it. Every mutating operation accepts `Idempotency-Key` ([idempotency.md](idempotency.md)). Scopes are the vocabulary listed in `api/v2/openapi.yaml`'s security schemes, matched as [identity.md](identity.md) §2.1 describes.

| Operation | Method and path | Scope | Gate |
| --- | --- | --- | --- |
| `createRun` | `POST /runs` | `runs:create` | — |
| `getRun` | `GET /runs/{runId}` | `runs:read` | — |
| `listRuns` | `GET /runs` | `runs:read` | `runList` |
| `streamRunEvents` | `GET /runs/{runId}/events` | `runs:read` | [events.md](events.md) |
| `pollRunEvents` | `GET /runs/{runId}/events/poll` | `runs:read` | [events.md](events.md) |
| `cancelRun` | `POST /runs/{runId}/cancel` | `runs:cancel` | — |
| `bulkCancelRuns` | `POST /runs:bulk-cancel` | `runs:cancel` | — |
| `pauseRun` | `POST /runs/{runId}:pause` | `runs:cancel` | — |
| `resumeRun` | `POST /runs/{runId}:resume` | `runs:cancel` | — |
| `forkRun` | `POST /runs/{runId}:fork` | `runs:create` + `runs:read` | `replay` |
| `diffRun` | `GET /runs/{runId}:diff?against=` | `runs:read` on both | OPTIONAL |
| `getRunAncestry` | `GET /runs/{runId}/ancestry` | `runs:read` | `multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported` |
| `createAnnotation` / `listAnnotations` | `POST` / `GET /runs/{runId}/annotations` | `runs:annotate` / `runs:read` | `feedback` |
| `getArtifact` | `GET /runs/{runId}/artifacts/{artifactId}` | `artifacts:read` | — |
| `getEvalSummary` | `GET /runs/{runId}/eval-summary` | `runs:read` | `agents.evalSuite` |
| `getRunCompensation` | `GET /runs/{runId}/compensation` | `runs:read` | `compensation` |
| `getRunEffects` | `GET /runs/{runId}/effects` | `runs:read` | `idempotency` |

A gated operation the host does not advertise (or an absent `diffRun`) answers `404`; for annotations it is `404 not_found`.

## Create

The `createRun` body is closed (`unevaluatedProperties: false`). Its fields:

- `workflowId` — REQUIRED unless `mode: eval`.
- `inputs`, `residency`, `tenantId`, `scopeId`.
- `callbackUrl` — see [interrupt.md](interrupt.md) §Callback delivery. A refused value is `400 validation_error` with `details.field: "callbackUrl"`.
- `mode`, `evalSuiteRef`, `agentId`.
- The `RunOptions` fields `configurable`, `tags`, `metadata`. A body without `RunOptions` MUST be accepted as if it were `{}`.

### Request headers

| Header | Rule |
| --- | --- |
| `Idempotency-Key` | RECOMMENDED. A replayed create MUST NOT create a second run, and carries `OpenWOP-Idempotent-Replay: true`. |
| `OpenWOP-Dedup: enforce` | The host MUST reject a duplicate `(tenantId, scopeId)` with `409 run_already_active` and `Retry-After`. |
| `OpenWOP-Force-Engine-Version` | Test keys only (the seams profile). A host MUST reject it on a production credential with `403`. |

### Response

The `201` response is `{ runId, status, eventsUrl, statusUrl? }`. `status` is one of `pending`, `running`, `waiting-approval`, `waiting-input`, `waiting-external`.

- `eventsUrl` and `statusUrl` MUST resolve under the origin the request was made to — a relative path, or an absolute URL on the same origin — and MUST NOT downgrade the scheme. A link naming a different host, or `http://` on an `https://` origin, is non-conformant.
- The base that minted `runId` MUST resolve it: `GET /runs/{runId}` and `GET /runs/{runId}/events/poll` at that base MUST answer `200` for the returned id, percent-encoded per [identity.md](identity.md) §5. (A front door that decodes `%2F` before routing makes every tenant-bound id unreachable.)

### Refusals

- `mode: eval` makes `evalSuiteRef` and `agentId` REQUIRED. It starts an eval-suite projection that emits the content-free `eval.*` family and terminates with an `EvalSummary`. A host that does not advertise `agents.evalSuite` MUST reject it.
- A host advertising `dataResidency` MUST reject a `residency.region` outside `dataResidency.regions` with `422 residency_unavailable` and create no run (see §"Conversation and residency capabilities").
- A workflow that references a capability-gated reserved node type on a host that does not advertise the capability MUST be rejected with `422 capability_required`.

### The start event

`run.started` ([events.md](events.md)) MUST echo the run's `owner` block exactly as `RunSnapshot.owner` carries it. Its `transport` records `rest`, `mcp`, `a2a` or `ui`.

## Run options

`schemas/v2/run-options.schema.json` is `{ configurable?, tags?, metadata? }`.

`configurable` is `schemas/v2/configurable.schema.json`: closed, nested and versioned. The request body `$ref`s it directly; there is no `allOf`-merge of an open map. `version` is REQUIRED and is `1`. It has five sections:

| Section | Keys |
| --- | --- |
| `run` | `recursionLimit`, `runTimeoutMs`, `maxLoopIterations`, `escalationThreshold` |
| `ai` | `provider`, `model`, `temperature` (0..2), `maxTokens`, `credentialRef`, `promptOverrides`, `mockProvider`, `reasoningVerbosity` (`none` \| `summary` \| `full`), `maxRefusals` |
| `distillation` | `tokenBudget` |
| `budget` | `schemas/v2/budget-policy.schema.json` — the run's budget policy |
| `extensions` | `<org>: {…}` — a vendor key lives under its registered org and nowhere else |

### `run` section

- `recursionLimit` is clamped to `limits.maxNodeExecutions`.
- `runTimeoutMs` resolves to `min(runTimeoutMs, limits.maxRunDurationMs)`. An out-of-range value MUST return `400 validation_error` at create. A breach MUST emit `cap.breached { kind: 'run-duration' }` and terminate the run `failed` with `run_timeout`.
- `maxLoopIterations` resolves against `limits.maxLoopIterations`. A breach MUST emit `cap.breached { kind: 'loop-iterations' }` and fail with `loop_limit_exceeded`.
- `escalationThreshold` is the `low-confidence` threshold ([interrupt.md](interrupt.md)).

### `ai` section

- `provider` MUST be in `aiProviders.providers`, else `400 validation_error`.
- `credentialRef` MUST reference a provider in `aiProviders.byok`, else `403 credential_forbidden`. It never carries key material.
- `mockProvider` is test-keys-only: a host MUST refuse it on a production credential with `403`.
- `maxRefusals` is the refusal ceiling ([events.md](events.md) E5).

### `distillation` section

`tokenBudget` resolves to `min(tokenBudget, memory.distillation.maxTokenBudget)`. A run that cannot distill within it MUST fail atomically with `token_budget_exceeded`.

### Validation and persistence

- An unknown root key, an unknown key inside a section, or a dotted key (`ai.provider` as a string key) MUST be rejected with `400 validation_error`.
- A host MUST persist `RunOptions` on the run at creation, MUST surface the same `configurable` to every attempt of a node, and MUST NOT allow `configurable` to change after creation.
- A workflow's `configurableSchema` MUST be validated against at create time and MUST be surfaced on `getWorkflow`.

### `tags` and `metadata`

- `tags` is an opaque string array: at most 100 entries, each at most 256 characters, valid UTF-8. A host MUST NOT reject a tag on format, and MUST return `400 validation_error` over the limits.
- `metadata` is a free-form JSON object. A host MUST persist it, and the engine MUST NOT consume it for any execution decision.
- Both surface unchanged on `RunSnapshot`.

## Snapshot

`getRun` returns `schemas/v2/run-snapshot.schema.json`: the fold of the event log through the run projection. The object is closed. `runId`, `workflowId`, `status`, `owner` and `eventLogSchemaVersion` are REQUIRED.

| Field | Meaning |
| --- | --- |
| `owner` | `{ tenant, workspace?, subject }`, closed; `subject` REQUIRED (`schemas/v2/subject.schema.json`) |
| `status` | Run state (below) |
| `eventLogSchemaVersion` | The era key, integer ≥ 2 ([persistence.md](persistence.md) §"The era key") |
| `engineVersion` | Integer |
| `compensationStatus` | `none`, `pending`, `running`, `completed`, `partial`, `failed`, `manual` |
| `currentNodeId` | Set while suspended; names the node holding the interrupt |
| `error` | `{ code, message, details? }` on terminal `failed` |
| `configurable`, `tags`, `metadata` | The persisted `RunOptions` |
| `agent`, `runOrchestrator` | `schemas/v2/agent-ref.schema.json` |
| `metrics.openwopCost` | `{ usd, tokens { input, output }, model, provider, duration_ms }`; absence is not zero |

Field rules:

- `status` is one of `pending`, `running`, `paused`, `waiting-approval`, `waiting-input`, `waiting-external`, `completed`, `failed`, `cancelling`, `cancelled`. `waiting-external` MUST be used when the suspended interrupt's `kind` is `external-event`. `cancelling` is the state between an accepted cancel and the terminal `cancelled`. The vocabulary grows by [overview.md](overview.md) §0.
- `owner`: a run created before the host emitted subjects reads with the subject rule in [identity.md](identity.md), stamped at first read and never rewritten.
- `compensationStatus`: a host that does not advertise `compensation` MUST omit it. A host that does MUST include it on every snapshot, `none` when never requested.
- `runOrchestrator` MUST NOT change for the run's lifetime.

### Caching and encoding

- The `200` SHOULD carry a strong `ETag` derived from the latest persisted `sequence`. When present it MUST change on every observable transition and be stable otherwise.
- When the host sends an `ETag`, a request whose `If-None-Match` matches it MUST receive `304` with no body.
- A host MAY compress (`gzip` baseline; `br` and `zstd` only where advertised under `extensions["<org>.rest-transport"].contentEncodings`, [ext/restTransport](../ext/restTransport/README.md)). It MUST then set `Content-Encoding` and `Vary: Accept-Encoding`. The decoded body is byte-identical.

## List

`GET /runs` (gated on `runList`) returns `{ runs: RunSnapshot[], nextCursor? }`: the caller's runs, newest first.

- Only runs whose tenant segment is the caller's appear, and every `runId` is bound ([identity.md](identity.md) §5). A run the caller created MUST appear.
- A page MUST NOT exceed `runList.maxPageSize`.
- `cursor` is opaque. A cursor the host did not mint MUST be refused with `400 validation_error`.
- `workflowId` and `status` are exact-match filters when `runList.filters` names them. An unadvertised filter is ignored.

## Cancel

`cancelRun` accepts `{ reason? }` and answers `200 { runId, status }`, where `status` is `cancelling` or `cancelled`. The cascade MAY be asynchronous; the run emits `run.cancelled` when it completes.

- A cancel on a terminal run (`completed`, `failed`, `cancelled`) MUST be refused with `409 run_terminal`. A `200` echoing the terminal state is non-conformant.
- Cancelling a parent MUST NOT silently abandon an active compensation ([security-defaults.md](security-defaults.md)).
- `run.cancelled.parentRunId` with `reason: parent-cancelled` records a cascade from a parent.

### Bulk cancel

`bulkCancelRuns` accepts `{ runIds[1..100], reason? }`.

- Over the host's cap (RECOMMENDED 100) it MUST return `400 validation_error` with `details.maxRunIds`.
- The host MUST process each id independently, and MUST return `200 { results[] }` in request order, even when every id failed.
- The host MUST enforce authorization per id. A run the caller cannot see yields `ok: false` with an error envelope in that entry, never a top-level `403`.

Per-entry errors ([errors.md](errors.md)):

| Condition | Code |
| --- | --- |
| The id's tenant segment is not the caller's ([identity.md](identity.md) §5 applies inside an entry as on a path) | `id_tenant_mismatch`, or `not_found` where existence is not leaked |
| A run in the caller's tenant the caller may not cancel | `run_forbidden` |
| A run already terminal | `run_terminal` |

`ok: true` carries `status` `cancelling` or `cancelled`; `ok: false` carries the error envelope.

## Pause and resume

`pauseRun` accepts `{ reason?, drainPolicy? }` and answers `202 { runId, status: 'paused', pausedAt? }`. The transition emits `run.paused`, whose payload echoes the request's `drainPolicy` word.

`drainPolicy` is one of:

- `drain-current-node` (default) — the executing node reaches a terminal first.
- `immediate` — the run is snapshotted between events. The executing attempt is cut: it has no terminal node event, a host MUST NOT record `node.failed` (or any terminal node event) for it, and the resumed run's `node.started` begins a fresh attempt. `run.paused` itself records the interruption; its payload MAY carry `interruptedNodeId` and `interruptedAttempt` so a `debug` consumer can see which attempt was cut.

`resumeRun` accepts `{ reason? }`, answers `202 { runId, status: 'running', resumedAt? }`, and emits `run.resumed`.

Rules:

- A pause on a run that is already paused, terminal, or otherwise unpausable MUST receive `409`.
- A resume on a run that is not paused MUST return `409`.
- In both cases the code is `run_terminal` when the run is terminal, else `run_state_conflict` with `details.runStatus` naming the refusing status.
- Only `resumeRun` or a cancel exits `paused`.
- A replay MUST fold `run.paused` and `run.resumed` as no-ops for projected state.

## Fork

`forkRun` accepts `{ mode: replay | branch, fromSeq?, runOptionsOverlay? }`. Events with `sequence < fromSeq` are fixed history; events `≥ fromSeq` re-execute.

- `fromSeq` is REQUIRED for `branch` and defaults to `0` for `replay`.
- `runOptionsOverlay` is `branch`-only. A `replay` with a non-empty overlay MUST be rejected with `400`.
- A `fromSeq` not in the source log MUST be rejected with `422 fork_point_invalid`.

The `201` response is `{ runId, sourceRunId, fromSeq?, mode, status, eventsUrl }`. The child's `owner` is copied verbatim from the parent. Determinism, side-effect suppression, and forking an era-2 parent are in [replay.md](replay.md).

## Diff and ancestry

`diffRun` returns `schemas/v2/run-diff-response.schema.json`: `divergedAtSeq`, ordered `eventDiffs[]`, `stateDiff`, optional `truncated`.

- The diff MUST be a pure function of the two logs. Identical logs MUST yield `divergedAtSeq: null` and empty `eventDiffs`.
- `eventId`, `runId`, `timestamp` and other run-scoped fields MUST be excluded from comparison.
- A host that diffs an in-flight prefix MUST set `truncated: true`.
- A caller lacking `runs:read` on either run MUST receive `403`.

`getRunAncestry` returns `schemas/v2/run-ancestry-response.schema.json` (`runId`, `hostId`, `parent` or `null`). A client walks the chain one hop at a time via `parent.wellKnownUrl`.

## Annotations, artifacts, eval summary

### Annotations

`createAnnotation` accepts `schemas/v2/annotation-create.schema.json` and returns `201` with `schemas/v2/annotation.schema.json`. `listAnnotations` returns `{ annotations[] }`.

An annotation is a live notification (`run.annotated`), never a run event. It MUST NOT enter the event log and MUST be excluded from fork, replay and diff.

### Artifacts

`getArtifact` answers `application/json` with an implementation-defined object or, when `Accept` prefers `application/a2a+json`, an A2A `Artifact` (`schemas/v2/artifact.schema.json`). A host SHOULD offer the latter.

- A body served as `application/a2a+json` MUST validate against that schema, with `artifactId` equal to the path's.
- A `url` Part in it MUST NOT resolve beyond the caller's `artifacts:read` authorization.

### Eval summary

`getEvalSummary` returns `schemas/v2/eval-summary.schema.json` for a terminal eval run, `409` while it is running, and `404` when the run is not an eval run. The summary MUST be free of task output, rubric prose and credentials.

## Conversation and residency capabilities

### `conversationPrimitive`

`conversationPrimitive` carries no payload: its presence is the claim ([capabilities.md](capabilities.md) §2). A host that does not advertise it MUST refuse a workflow whose `nodes[].typeId` references `core.conversationGate` — at registration or at run creation — with `422 capability_required`, naming the family in `details.requiredCapability`.

A conversation turn MAY carry `parts`: a non-empty array of A2A `Part` objects (`schemas/v2/part.schema.json`) that marks the turn A2A-shaped. A producer SHOULD emit it and keep `content` readable by consumers that predate it. A turn without `parts` stays valid on emission, replay and fork.

### `dataResidency`

A host advertising `dataResidency` MUST honor-or-reject, and MUST NOT silently accept-and-ignore:

- accept a `residency` constraint naming a region in `dataResidency.regions`;
- refuse one it does not advertise with `residency_unavailable`.

A host that does not advertise `dataResidency` MAY ignore or reject a `residency` constraint, but MUST NOT claim to honor it.

## During the v1 overlap

A non-terminal run inherited from v1 continues, or is cancelled `v1_pin_unsupported`, per [persistence.md](persistence.md) §"Runs pinned to v1".

*Sources: RFCs 0170, 0171, 0176, 0182.*
