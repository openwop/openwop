# Runs

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0170 §A, §D.1; RFC 0171 §D; RFC 0176 §B.1.**

## Why this exists

A run is the unit of execution, ownership and observation. This document is the run surface of `api/v2/openapi.yaml`: how a run is created, read, streamed, cancelled, paused, forked and diffed, and the one snapshot shape every host projects from the same event log (events.md).

## Identity

Every id `$ref`s `schemas/v2/ids.schema.json` (identity.md). A `runId` is tenant-bound, `<tenantId>/<opaque>`, host-minted; a host MUST reject a `runId` whose tenant segment is not the caller's with `403 id_tenant_mismatch` and MUST NOT disclose whether the run exists. A caller MUST treat every id as opaque.

## Surface

Every operation accepts `OpenWOP-Version` (overview.md); every mutating operation accepts `Idempotency-Key` (idempotency.md); every response carries `OpenWOP-Version`. Scopes are the `auth.md` vocabulary.

| Operation | Method and path | Scope | Gate |
| --- | --- | --- | --- |
| `createRun` | `POST /runs` | `runs:create` | — |
| `getRun` | `GET /runs/{runId}` | `runs:read` | — |
| `streamRunEvents` | `GET /runs/{runId}/events` | `runs:read` | events.md |
| `pollRunEvents` | `GET /runs/{runId}/events/poll` | `runs:read` | events.md |
| `cancelRun` | `POST /runs/{runId}/cancel` | `runs:cancel` | — |
| `bulkCancelRuns` | `POST /runs:bulk-cancel` | `runs:cancel` | — |
| `pauseRun` | `POST /runs/{runId}:pause` | `runs:cancel` | — |
| `resumeRun` | `POST /runs/{runId}:resume` | `runs:cancel` | — |
| `forkRun` | `POST /runs/{runId}:fork` | `runs:create` + `runs:read` | `replay` (replay.md) |
| `diffRun` | `GET /runs/{runId}:diff?against=` | `runs:read` on both | OPTIONAL; `404` when absent |
| `getRunAncestry` | `GET /runs/{runId}/ancestry` | `runs:read` | `multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported`; `404` when unadvertised |
| `createAnnotation` / `listAnnotations` | `POST` / `GET /runs/{runId}/annotations` | `runs:annotate` / `runs:read` | `feedback`; `501` when unadvertised |
| `getArtifact` | `GET /runs/{runId}/artifacts/{artifactId}` | `artifacts:read` | — |
| `getEvalSummary` | `GET /runs/{runId}/eval-summary` | `runs:read` | `agents.evalSuite`; `404` when unadvertised |
| `getRunCompensation` | `GET /runs/{runId}/compensation` | `runs:read` | `compensation` (security-defaults.md) |
| `getRunEffects` | `GET /runs/{runId}/effects` | `runs:read` | `idempotency` (idempotency.md) |

## Create

The `createRun` body is closed at the composition (`unevaluatedProperties: false`): `workflowId` (REQUIRED unless `mode: eval`), `inputs`, `residency`, `tenantId`, `scopeId`, `callbackUrl` (the signed-token callback, interrupt.md), `mode`, `evalSuiteRef`, `agentId`, and the `RunOptions` fields `configurable`, `tags`, `metadata`. A body without `RunOptions` MUST be accepted as if it were `{}`.

| Header | Rule |
| --- | --- |
| `Idempotency-Key` | RECOMMENDED; a replayed create MUST NOT create a second run and carries `OpenWOP-Idempotent-Replay: true`. |
| `OpenWOP-Dedup: enforce` | The host MUST reject a duplicate `(tenantId, scopeId)` with `409 run_already_active` and `Retry-After`. |
| `OpenWOP-Force-Engine-Version` | Test keys only; the seams profile. A host MUST reject it on a production credential with `403`. |

The `201` response is `{ runId, status, eventsUrl, statusUrl? }`, `status` one of `pending`, `running`, `waiting-approval`, `waiting-input`, `waiting-external`. `mode: eval` (with `evalSuiteRef` and `agentId` REQUIRED) starts an eval-suite projection that emits the content-free `eval.*` family and terminates with an `EvalSummary`; a host that does not advertise `agents.evalSuite` MUST reject it. A `residency.region` the host does not advertise MUST be rejected with `422 residency_unavailable` and no run created. A workflow that references a capability-gated reserved node type on a host that does not advertise the capability MUST be rejected with `422 capability_required`.

`run.started` (events.md) MUST echo the run's `owner` block exactly as `RunSnapshot.owner` carries it (RFC 0170 §A.1); `transport` records `rest`, `mcp`, `a2a` or `ui`.

## Run options

`schemas/v2/run-options.schema.json` is `{ configurable?, tags?, metadata? }`.

`configurable` is `schemas/v2/configurable.schema.json`: closed, nested and versioned (RFC 0171 §D.1). The request body `$ref`s it directly; there is no `allOf`-merge of an open map. `version` is REQUIRED and is `1`.

| Section | Keys | Rule |
| --- | --- | --- |
| `run` | `recursionLimit`, `runTimeoutMs`, `maxLoopIterations`, `escalationThreshold` | `recursionLimit` is clamped to `limits.maxNodeExecutions`. `runTimeoutMs` resolves to `min(runTimeoutMs, limits.maxRunDurationMs)`; an out-of-range value MUST return `400 validation_error` at create, and a breach MUST emit `cap.breached { kind: 'run-duration' }` and terminate the run `failed` with `run_timeout`. `maxLoopIterations` resolves against `limits.maxLoopIterations`; a breach MUST emit `cap.breached { kind: 'loop-iterations' }` and fail with `loop_limit_exceeded`. `escalationThreshold` is the `low-confidence` threshold (interrupt.md). |
| `ai` | `provider`, `model`, `temperature` (0..2), `maxTokens`, `credentialRef`, `promptOverrides`, `mockProvider`, `reasoningVerbosity` (`none` \| `summary` \| `full`), `maxRefusals` | `provider` MUST be in `aiProviders.supported`, else `400 validation_error`. `credentialRef` MUST reference a provider in `aiProviders.byok`, else `403 credential_forbidden`; it never carries key material. `mockProvider` is test-keys-only: a host MUST refuse it on a production credential with `403`. `maxRefusals` is the refusal ceiling (events.md E5). |
| `distillation` | `tokenBudget` | Resolves to `min(tokenBudget, memory.distillation.maxTokenBudget)`; a run that cannot distill within it MUST fail atomically with `token_budget_exceeded`. |
| `budget` | `schemas/v2/budget-policy.schema.json` | The run's budget policy. |
| `extensions` | `<org>: {…}` | A vendor key lives under its registered org and nowhere else. |

An unknown root key, an unknown key inside a section, or a dotted key (`ai.provider` as a string key) MUST be rejected with `400 validation_error`. A host MUST persist `RunOptions` on the run at creation, MUST surface the same `configurable` to every attempt of a node, and MUST NOT allow `configurable` to change after creation. A workflow's `configurableSchema` MUST be validated against at create time and MUST be surfaced on `getWorkflow`.

`tags` is an opaque string array (at most 100 entries, each at most 256 characters, valid UTF-8); a host MUST NOT reject a tag on format and MUST return `400 validation_error` over the limits. `metadata` is a free-form JSON object the engine MUST NOT consume for any execution decision; a host MUST persist it. Both surface unchanged on `RunSnapshot`.

## Snapshot

`getRun` returns `schemas/v2/run-snapshot.schema.json`, the fold of the event log through the run projection. `runId`, `workflowId`, `status`, `owner` and `eventLogSchemaVersion` are REQUIRED; the object is closed.

| Field | Rule |
| --- | --- |
| `owner` | `{ tenant, workspace?, subject }`, closed, `subject` REQUIRED (`schemas/v2/subject.schema.json`). `principal` and `principalKind` do not exist. A run created before the host emitted subjects reads with the legacy subject rule (identity.md), stamped at first read and never rewritten. |
| `status` | `pending`, `running`, `paused`, `waiting-approval`, `waiting-input`, `waiting-external`, `completed`, `failed`, `cancelling`, `cancelled`. `waiting-external` MUST be used when the suspended interrupt's `kind` is `external-event`. `cancelling` is the state between an accepted cancel and the terminal `cancelled`. The vocabulary grows by overview.md §0. |
| `eventLogSchemaVersion` | The era key, integer ≥ 2. A v2 host MUST stamp `3` on every run it creates; a v1-era run reads as `2` (events.md). |
| `engineVersion` | Integer. |
| `compensationStatus` | `none`, `pending`, `running`, `completed`, `partial`, `failed`, `manual`. A host that does not advertise `compensation` MUST omit it; a host that does MUST include it on every snapshot, `none` when never requested. |
| `currentNodeId` | Set while suspended; names the node holding the interrupt. |
| `error` | `{ code, message, details? }` on terminal `failed`. |
| `configurable`, `tags`, `metadata` | The persisted `RunOptions`. |
| `agent`, `runOrchestrator` | `schemas/v2/agent-ref.schema.json`; `runOrchestrator` MUST NOT change for the run's lifetime. |
| `metrics.openwopCost` | `{ usd, tokens { input, output }, model, provider, duration_ms }`; absence is not zero. |

The `200` SHOULD carry a strong `ETag` derived from the latest persisted `sequence`; when present it MUST change on every observable transition and be stable otherwise. A request whose `If-None-Match` matches MUST receive `304` with no body. A host MAY compress (`gzip` baseline; `br`, `zstd` only where advertised under `restTransport.contentEncodings`) and MUST then set `Content-Encoding` and `Vary: Accept-Encoding`; the decoded body is byte-identical.

## Cancel

`cancelRun` accepts `{ reason? }` and answers `200 { runId, status }` with `status` `cancelling` or `cancelled`; the cascade MAY be asynchronous and the run emits `run.cancelled` when it completes. Cancelling a parent MUST NOT silently abandon an active compensation (security-defaults.md). `run.cancelled.parentRunId` with `reason: parent-cancelled` records a cascade from a parent.

A non-terminal run a v2 host inherits from v1 whose `version.pinned` change ids the host still implements MUST continue under the era-2 reader; the pin is never rewritten. When any pinned change id is no longer implemented the host MUST cancel the run with `run.cancelled { reason: 'v1_pin_unsupported', cancelledBy: 'v2-cutover' }` and MUST NOT follow code it no longer has (RFC 0176 §B.1). A run suspended on an interrupt at the cut continues, its token resolvable under `kid: legacy` until `expiresAt` (interrupt.md).

`bulkCancelRuns` accepts `{ runIds[1..100], reason? }`; over the host's cap (RECOMMENDED 100) it MUST return `400 validation_error` with `details.maxRunIds`. The host MUST process each id independently, MUST return `200 { results[] }` in request order even when every id failed, and MUST enforce authorization per id: a run the caller cannot see yields `ok: false` with `error` `run_forbidden` in that entry, never a top-level `403`. `ok: true` carries `status` `cancelling` or `cancelled`; `ok: false` carries the error envelope (errors.md).

## Pause and resume

`pauseRun` accepts `{ reason?, drainPolicy? }` with `drainPolicy` `immediate` (snapshot between events) or `drain-current-node` (default; the executing node reaches a terminal first) and answers `202 { runId, status: 'paused', pausedAt? }`; the transition emits `run.paused`. A run already paused, terminal, or otherwise unpausable MUST receive `409`. `resumeRun` accepts `{ reason? }`, answers `202 { runId, status: 'running', resumedAt? }`, emits `run.resumed`, and MUST return `409` when the run is not paused. Pause is operator-driven and distinct from cancel (terminal) and from an interrupt (`waiting-*`); only `resumeRun` or a cancel exits `paused`. A replay MUST fold `run.paused` and `run.resumed` as no-ops for projected state.

## Fork

`forkRun` accepts `{ mode: replay | branch, fromSeq?, runOptionsOverlay? }`: events with `sequence < fromSeq` are fixed history and events `≥ fromSeq` re-execute. `fromSeq` is REQUIRED for `branch` and defaults to `0` for `replay`; `runOptionsOverlay` is `branch`-only, and a `replay` with a non-empty overlay MUST be rejected with `400`. A `fromSeq` not in the source log MUST be rejected with `422 fork_point_invalid`. The `201` response is `{ runId, sourceRunId, fromSeq?, mode, status, eventsUrl }`. The child's `owner` is copied verbatim from the parent (RFC 0170 §A.4). Determinism, side-effect suppression, and forking an era-2 parent are in replay.md.

## Diff and ancestry

`diffRun` returns `schemas/v2/run-diff-response.schema.json`: `divergedAtSeq`, ordered `eventDiffs[]`, `stateDiff`, optional `truncated`. The diff MUST be a pure function of the two logs: identical logs MUST yield `divergedAtSeq: null` and empty `eventDiffs`; `eventId`, `runId`, `timestamp` and other run-scoped fields MUST be excluded from comparison. A host that diffs an in-flight prefix MUST set `truncated: true`. A caller lacking `runs:read` on either run MUST receive `403`. `getRunAncestry` returns `schemas/v2/run-ancestry-response.schema.json` (`runId`, `hostId`, `parent` or `null`); a client walks the chain one hop at a time via `parent.wellKnownUrl`.

## Annotations, artifacts, eval summary

`createAnnotation` accepts `schemas/v2/annotation-create.schema.json` and returns `201` with `schemas/v2/annotation.schema.json`; `listAnnotations` returns `{ annotations[] }`. An annotation is a live notification (`run.annotated`), never a run event: it MUST NOT enter the event log and MUST be excluded from fork, replay and diff. `getArtifact` returns the artifact as an implementation-defined JSON object. `getEvalSummary` returns `schemas/v2/eval-summary.schema.json` for a terminal eval run, `409` while it is running, `404` when the run is not an eval run; the summary MUST be content-free of task output, rubric prose and credentials.
