# Interrupt

> **Status: Stable.**
> **Normative home:** `interrupt`.

## Why this exists

`interrupt` is how a run waits for something outside itself: a decision, an answer, an event, a conversation turn. Every kind shares one payload shape, event pair, resolve contract and token scheme, so a client that resolves an approval can resolve anything.

## Payload

`schemas/v2/suspend-request.schema.json` (`InterruptPayload`) is closed and discriminated by `kind`; `kind`, `key` and `data` are REQUIRED.

| Kind | `data` (required fields) | Snapshot status / gate |
| --- | --- | --- |
| `approval` | `artifactId`, `artifactType`, `title`, `actions` | 5-action vocabulary, quorum and eligibility (§Approval) |
| `clarification` | `questions[]` (`id`, `question`, optional `schema`) | `waiting-input` |
| `external-event` | `eventType`, `correlation` | `waiting-external` |
| `custom` | `customKind`, optional `payload` | — |
| `conversation.start` | `conversationId` | Gated on `conversation` ([capabilities.md](capabilities.md)) |
| `conversation.exchange` | `conversationId`, `prompt` | — |
| `conversation.close` | `conversationId` | Gated as above |
| `low-confidence` | `agentId`, `threshold`, `observed` | — |
| `credential` | `provider`, `scopes`, `reason`, `connectUrl` | `waiting-input`; gated on `oauth.credentialInterrupt` ([oauth.md](oauth.md)) |

Per-kind rules:

- `external-event`: the snapshot status MUST be `waiting-external`.
- `custom`: a host MUST accept and persist it; rendering is best-effort.
- `conversation.start`: `conversationId` MUST be tenant-unique and MUST NOT be assumed resolvable on another host.
- `conversation.exchange`: the resume value MUST validate against `outcomeSchema` when supplied.
- `low-confidence`: an `agent.decided` with `confidence` below the threshold MUST be followed by `node.suspended { reason: 'low-confidence' }`. The per-run threshold is `configurable.run.escalationThreshold` ([runs.md](runs.md)).
- `credential`: the resume value is `{ outcome }` and carries no credential.
- An interrupt of any kind MUST NOT solicit credential material; a credential is acquired through `credential`.

### Re-entry and resume values

`key` is the deterministic re-entry key of one invocation. A host MUST derive it from at least the run, the node and the node's visit index: the number of that node's interrupts in this run whose resolution was consumed before this execution began. Its spelling is host-defined.

- A replay or recovery of the same execution MUST re-derive the same key.
- A later execution of the node, reached over an edge, MUST derive a different key, MUST raise a new `interrupt.requested`, and MUST NOT return an earlier visit's `resumeValue`.
- Two interrupts raised in one execution MUST have distinct keys.
- A host MUST invoke an interrupt with key `K` at most once for the lifetime of the run.
- On recovery the engine MUST consult the event log, find the prior `interrupt.resolved`, and return the persisted `resumeValue` without emitting a second `interrupt.requested`.
- An in-memory cache MAY serve in-process replays but MUST NOT replace the event log for cross-process replays.
- A host MUST validate the resume value against `resumeSchema` when one is declared, and MUST refuse a failing value with `400 validation_error`.

`timeoutMs`, when set, is the interrupt's own deadline. What an approval gate does when it elapses is §Rejection.

## Events

Every kind uses two registered types ([events.md](events.md)):

- `interrupt.requested` — the payload is the `InterruptPayload` verbatim.
- `interrupt.resolved` — the closed payload is `interruptResolved`. Resolving an approval-kind interrupt MUST record the applied `action` there, with the field §Approval requires.

The kind-specific `approval.*` and `clarification.*` types remain registered. Their payload definitions in `schemas/v2/run-event-payloads.schema.json` are `$ref` aliases of `interruptRequested` and `interruptResolved`. A host emitting `interrupt.requested` SHOULD also emit the kind-specific type until its consumers migrate.

Both events are durable and appear in the `updates` and `debug` stream modes. While suspended, `RunSnapshot.currentNodeId` names the node and `status` is `waiting-approval`, `waiting-input` or `waiting-external`.

## Resolve surfaces

| Operation | Path | Auth | Body |
| --- | --- | --- | --- |
| `resolveInterruptByRun` | `POST /runs/{runId}/interrupts/{nodeId}` | `approvals:respond` | `{ resumeValue }` (closed) |
| `inspectInterruptByToken` | `GET /interrupts/{token}` | the token | — (returns the `InterruptPayload`) |
| `resolveInterruptByToken` | `POST /interrupts/{token}` | the token | `{ resumeValue }` (closed) |

- A host MUST expose the run-scoped surface, and SHOULD expose the signed-token surface for callers not authenticated to the protocol.
- Every resolve MUST honor `Idempotency-Key` ([idempotency.md](idempotency.md)).
- Of two concurrent resolves, exactly one MUST succeed; the other MUST receive `409 interrupt_already_resolved`.

### Callback delivery

`createRun.callbackUrl` names where a host that advertises `interrupt.callbackDelivery: true` delivers notice of an interrupt, so its holder can resolve it through the token surface. The payload, timing and signing are host-defined.

A host advertising the facet:

- MUST refuse at `createRun`, with `400 validation_error` and `details.field: "callbackUrl"`, a URL the `webhooks.md` §Egress registration guard would refuse;
- MUST re-validate every resolved address at delivery;
- MUST NOT follow a redirect.

A host that does not advertise it SHOULD refuse the member and MUST NOT claim delivery it does not perform.

### Errors

| Status | Code | Condition |
| --- | --- | --- |
| `400` | `validation_error` | `resumeValue` fails `resumeSchema`, or the approval action is not in `actions` |
| `401` | `interrupt_token_invalid` | MAC, `alg` or `kid` not accepted |
| `404` | `not_found` | No such run or node |
| `409` | `interrupt_already_resolved` | Already resolved; the run is cancelled or completed (both surfaces); or the token was invalidated |
| `410` | `interrupt_expired` | Token past `expiresAt` (token surface only) |

## Tokens

The token grammar and the `interrupt.tokenAlgs[]` / `kid` check are [identity.md](identity.md) §4 (`401 interrupt_token_invalid`).

- **Expiry.** Every token MUST carry `expiresAt`. The default SHOULD be 30 minutes, and a host MUST cap the lifetime at the interrupt's `timeoutMs` when one exists. A token MUST NOT outlive the interrupt it resolves; past `expiresAt` the host MUST answer `410 interrupt_expired`.
- **Invalidation.** A token MUST be invalidated when its interrupt is resolved or its run is cancelled or completed. Later use MUST answer `409 interrupt_already_resolved`.
- **Verification.** MAC comparison MUST be constant-time. `kid` selects the verification secret, so secrets rotate without orphaning outstanding tokens.
- **Intent.** A token minted with `intent: resolve` authorizes both operations. A host MAY mint `intent: inspect` tokens; a resolve with one MUST be refused with `403`.

## Approval

`actions` is a non-empty subset of `accept`, `reject`, `refine`, `edit-accept`, `ask`; a host MUST enforce it on resolve. `ask` does not exit the suspend.

| `action` | Required field |
| --- | --- |
| `accept` | — (`feedback?`) |
| `reject` | — (`feedback?`) |
| `refine` | `refineFeedback { scope: whole \| section \| items, sectionPath?, itemIds?, tags?, text? }` |
| `edit-accept` | `editedArtifactData` |

- Every resume carries `decidedAt`. `decidedBy` MAY be omitted by an authenticated caller, and every consumer MUST treat it as an opaque string.
- `requiredApprovals` sets the quorum (default 1). `rejectionPolicy` is `single-veto` (default) or `majority`.
- When `overrideBypassesQuorum` is `true`, a configured override principal MAY release the gate alone; otherwise its vote counts once.

### Rejection

A `reject` exits the suspend. The host MUST record `action: "reject"` and `decision: "rejected"` on `interrupt.resolved`, and MAY also emit `approval.rejected`. The resume value returns to the raising node (§Re-entry and resume values).

- A node that does not turn the rejection into an output MUST fail with `approval_rejected` and `retryable: false` on the `node.failed` error, and MUST NOT be retried.
- A rejected gate is a failed source. It MUST NOT satisfy an `all_success`, `any_success` or `none_failed` edge. The run continues past it only over an edge whose `triggerRule` admits a failed source (`all_complete` or `any_failed`).
- When no such edge exists, the run MUST terminate `failed` with `run.failed.error.code` `approval_rejected` and `failedNodeId` naming the gate.
- The gate resolves rejected on one eligible `reject` under `single-veto`, or when rejects exceed half of `requiredApprovals` under `majority`. A vote that does not decide the gate MUST NOT emit `interrupt.resolved`.
- When a non-zero `timeoutMs` elapses with no resolution, the host MUST resolve the gate rejected, recording `action: "timeout"`, `decision: "rejected"` and `reason: "timeout"`, whatever `onTimeout` holds, and MUST apply the rules above. A timeout MUST NOT grant a gate. A host MUST treat `onTimeout: "approve"` as `reject` and SHOULD NOT emit it. `escalate` MAY notify a host-defined target but MUST NOT extend or grant the gate. A host MUST NOT accept `timeout` on a resume request.
- On replay the failure MUST be derived from the recorded `interrupt.resolved`, never re-decided.

## Approver enforcement

The facet `spec/v2/facets/interrupt.schema.json` carries `tokenAlgs[]` (REQUIRED) and `refKinds[]` ⊆ `principal`, `group`, `role`.

- **`approversList`** (explicit principals) binds everywhere: a host advertising `interrupt` MUST refuse a resolver not in the list.
- **`approverGroupRefs`** binds only where `refKinds` includes `group`: the host MUST surface the field unchanged and MUST resolve and enforce its members as eligible approvers.
- **`approverRoleRefs`** binds only where `refKinds` includes `role`: as for groups, with holders.
- **`audience`** is a notification hint, never eligibility. When omitted, the host SHOULD notify the union of the eligibility refs.
- A host that does not advertise a ref kind MUST ignore that field.

Eligibility binds every writer of the suspension record, not every route. A host whose durable store is writable by a principal other than the engine MUST enforce the same eligibility at the store, or MUST NOT expose the record to that principal for write.

Refs are opaque to the engine; the host resolves them. Membership MUST be resolved at decision time and MUST NOT be re-resolved during replay or `forkRun`: the recorded eligibility decision is fixed history ([replay.md](replay.md)).

## During the v1 overlap

The v1 interrupt-token drain is [identity.md](identity.md) §4.

*Sources: RFCs 0170, 0171, 0173, 0187, 0196, 0223.*
