# Interrupt

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0170 §E.1, RFC 0171 §A.4, RFC 0173 §B.**

## Why this exists

`interrupt` is the one primitive by which a run waits for something outside itself: a human decision, an answer, an external event, a conversation turn. Every kind shares one payload shape, one pair of events, one resolve contract and one token scheme, so a client that can resolve an approval can resolve anything.

## Payload

`schemas/v2/suspend-request.schema.json` (`InterruptPayload`) is closed and discriminated by `kind`; `kind`, `key` and `data` are REQUIRED.

| Kind | `data` (required fields) | Notes |
| --- | --- | --- |
| `approval` | `artifactId`, `artifactType`, `title`, `actions` | 5-action vocabulary below; quorum and eligibility fields |
| `clarification` | `questions[]` (`id`, `question`, optional `schema`) | Snapshot status `waiting-input` |
| `external-event` | `eventType`, `correlation` | Snapshot status MUST be `waiting-external` |
| `custom` | `customKind`, optional `payload` | A host MUST accept and persist it; rendering is best-effort |
| `conversation.start` | `conversationId` | Gated on the `conversation` capability (capabilities.md); `conversationId` MUST be tenant-unique and MUST NOT be assumed resolvable on another host |
| `conversation.exchange` | `conversationId`, `prompt` | The resume value MUST validate against `outcomeSchema` when supplied |
| `conversation.close` | `conversationId` | Gated as above |
| `low-confidence` | `agentId`, `threshold`, `observed` | An `agent.decided` with `confidence` below the threshold MUST be followed by `node.suspended { reason: 'low-confidence' }`; the per-run threshold is `configurable.run.escalationThreshold` (runs.md) |

`key` is the deterministic re-entry key: a host MUST invoke an interrupt with key `K` at most once for the lifetime of the run. On recovery the engine MUST consult the event log, find the prior `interrupt.resolved`, and return the persisted `resumeValue` without emitting a second `interrupt.requested`; an in-memory cache MAY serve in-process replays but MUST NOT replace the event log for cross-process replays. A host MUST validate the resume value against `resumeSchema` when one is declared and MUST refuse a failing value with `400 validation_error`. `timeoutMs`, when set, is the interrupt's own deadline.

## Events

Every kind is recorded by two registered types (events.md): `interrupt.requested`, whose payload is the `InterruptPayload` verbatim, and `interrupt.resolved`, whose payload is `{ nodeId, interruptId, kind?, resumeValue? }` (closed). The legacy `approval.*` and `clarification.*` types remain registered; their payload definitions in `schemas/v2/run-event-payloads.schema.json` are `$ref` aliases of `interruptRequested` and `interruptResolved` (RFC 0171 §A.4 E4), so there is one shape per direction. A host emitting `interrupt.requested` SHOULD also emit the legacy kind-specific type until its consumers migrate. Both events are durable and appear in the `updates` and `debug` stream modes. While suspended, `RunSnapshot.currentNodeId` names the node and `status` is `waiting-approval`, `waiting-input` or `waiting-external`.

## Resolve surfaces

| Operation | Path | Auth | Body |
| --- | --- | --- | --- |
| `resolveInterruptByRun` | `POST /runs/{runId}/interrupts/{nodeId}` | `approvals:respond` | `{ resumeValue }` (closed) |
| `inspectInterruptByToken` | `GET /interrupts/{token}` | the token | — (returns the `InterruptPayload`) |
| `resolveInterruptByToken` | `POST /interrupts/{token}` | the token | `{ resumeValue }` (closed) |

A host MUST expose the run-scoped surface and SHOULD expose the signed-token surface for callers not authenticated to the protocol (a payment webhook, a mail link). Every resolve MUST honor `Idempotency-Key` (idempotency.md). Exactly one of two concurrent resolves MUST succeed; the other MUST receive `409 interrupt_already_resolved`.

| Status | Code | Condition |
| --- | --- | --- |
| `400` | `validation_error` | `resumeValue` fails `resumeSchema` or the approval action is not in `actions` |
| `401` | `interrupt_token_invalid` | MAC, `alg` or `kid` not accepted |
| `404` | `not_found` | No such run or node |
| `409` | `interrupt_already_resolved` | Already resolved; or a token invalidated by resolution, cancellation or completion |
| `410` | `interrupt_expired` | Token past `expiresAt` (token surface only) |

## Tokens

The token grammar is `ow2.<alg>.<kid>.<payload>.<mac>`, defined in identity.md; `alg` MUST be one the host advertises in `interrupt.tokenAlgs[]` (`hs256` at the cut) and `kid` MUST select a secret the host holds, otherwise `401 interrupt_token_invalid`. A v1 two-segment token remains resolvable under `kid: legacy` until its `expiresAt`.

| Rule | Requirement |
| --- | --- |
| Expiry | Every token MUST carry `expiresAt`. The default SHOULD be 30 minutes; a host MUST cap the lifetime at the interrupt's `timeoutMs` when one exists. A token MUST NOT outlive the interrupt it resolves; past `expiresAt` the host MUST answer `410 interrupt_expired`. |
| Invalidation | A token MUST be invalidated when its interrupt is resolved or its run is cancelled or completed; later use MUST answer `409 interrupt_already_resolved`. |
| Verification | MAC comparison MUST be constant-time. `kid` selects the verification secret so secrets rotate without orphaning outstanding tokens. |
| Intent | A token minted with `intent: resolve` authorizes both operations; a host MAY mint `intent: inspect` tokens, and a resolve with one MUST be refused with `403`. |

## Approval

`actions` is a non-empty subset of `accept`, `reject`, `refine`, `edit-accept`, `ask`; a host MUST enforce it on resolve. `ask` does not exit the suspend.

| `action` | Required field |
| --- | --- |
| `accept` | — (`feedback?`) |
| `reject` | — (`feedback?`) |
| `refine` | `refineFeedback { scope: whole \| section \| items, sectionPath?, itemIds?, tags?, text? }` |
| `edit-accept` | `editedArtifactData` |

Every resume carries `decidedAt`; `decidedBy` MAY be omitted by an authenticated caller, and every consumer MUST treat it as an opaque string. `requiredApprovals` sets the quorum (default 1) and `rejectionPolicy` is `single-veto` (default) or `majority`; when `overrideBypassesQuorum` is `true` a configured override principal MAY release the gate alone, otherwise its vote counts once.

## Approver enforcement

Enforcement is an obligation of the fields, not a discovery flag (RFC 0173 §B). The facet `spec/v2/facets/interrupt.schema.json` carries `tokenAlgs[]` (REQUIRED) and `refKinds[]` ⊆ `principal`, `group`, `role`.

| Field | Binds |
| --- | --- |
| `approversList` (explicit principals) | Everywhere: a host advertising `interrupt` MUST refuse a resolver not in the list |
| `approverGroupRefs` | Only where `refKinds` includes `group`: the host MUST surface the field unchanged and MUST resolve and enforce its members as eligible approvers |
| `approverRoleRefs` | Only where `refKinds` includes `role`: as for groups, with holders |
| `audience` | A notification hint, never eligibility; omitted ⇒ the host SHOULD notify the union of the eligibility refs |

Refs are opaque to the engine; the host resolves them against its own identity model. Membership MUST be resolved at decision time and MUST NOT be re-resolved during replay or `forkRun`: the recorded eligibility decision is fixed history (replay.md). A host that does not advertise a ref kind MUST ignore that field. A relaxation of any obligation here is an operator setting recorded in the certification bundle, never a discovery field (security-defaults.md).
