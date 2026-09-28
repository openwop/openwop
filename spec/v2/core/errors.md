# Errors

> **Status: Stable.**

## Why this exists

Every error a v2 host returns is a row in one registry. A client routes on `error`, never on `message`. A code that is not registered is not a protocol error. The registry is the single source for the envelope schema, the HTTP status and retriability.

## The registry

`spec/v2/errors.json` holds one row per code, defined by `spec/v2/errors.schema.json`. It registers **108** codes. `schemas/v2/error-envelope.schema.json` is GENERATED from it and MUST NOT be edited by hand.

- A host MUST emit a registered code, or a vendor code, wherever it emits an error code: the `error` of every error response, and `error.code` on `run.failed`, `node.failed` and the snapshot's `error` (overview.md §0). A recorded event re-emitted by replay or `:fork` is carried as recorded ([replay.md](replay.md)).
- A vendor code MUST match `^(?!openwop\.)[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9_]*$`, with its first segment an org registered in `spec/v2/declaration.json`. `openwop.` is reserved.
- The registry grows by [overview.md](overview.md) §0.

## The envelope

Every error response body MUST be `{ error, message, details? }` and nothing else (`additionalProperties: false`).

- `error` is the registered code or a vendor code. `message` is a non-empty string.
- `details` is an object shaped by the row's `details` schema. A row whose `details` is `null` accepts any object. When a row registers a schema, the generated envelope applies it to `details` only when `error` names that code.
- Contextual data (conflict refs, trace ids, validation paths) MUST live under `details`, never at a new top level.
- When present, `details.correlationId` MUST be a non-empty string.

The same envelope is the per-id `error` of `bulkCancelRuns` ([runs.md](runs.md)). `x-openwop-http-status` and `x-openwop-retriable` in the generated schema mirror the registry; a host MUST answer with the registered status.

## Retry timing

Retry timing lives in the `Retry-After` header only.

- A host MUST NOT emit `details.retryAfter`, `details.retryAfterMs` or `details.retryAfterSeconds`.
- A `429 rate_limited` response MUST set `Retry-After`.

The retriable rows are `residency_unavailable`, `rate_limited`, `internal_error`, `pack_registry_unreachable`, `runner_unavailable`.

## One code per state

An interrupt has one code per state ([interrupt.md](interrupt.md), [identity.md](identity.md)):

- A token or run-scoped resolve against an interrupt that is already resolved, or whose run is cancelled or completed, MUST return `409 interrupt_already_resolved`.
- A signed token past its `expiresAt` MUST return `410 interrupt_expired`.
- A token whose `alg` or `kid` the host does not accept MUST return `401 interrupt_token_invalid`.
- `interrupt_cancelled` is registered but names no state of the core resolve surfaces. A host MUST NOT emit it from `resolveInterruptByRun`, `inspectInterruptByToken` or `resolveInterruptByToken`.

The idempotency mismatch code is `idempotency_key_mismatch` only ([idempotency.md](idempotency.md)).

## Codes by HTTP status

Every registered code, by HTTP status, is listed in [error-codes.md](../generated/error-codes.md), generated from `spec/v2/errors.json` (108 codes).

*Sources: RFCs 0171, 0213, 0227.*
