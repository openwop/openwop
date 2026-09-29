# Errors

> **Status: Stable.**

## Why this exists

Every error a v2 host returns is a row in one registry. A client routes on `error`, never on `message`. A code that is not registered is not a protocol error.

## The registry

`spec/v2/errors.json` holds one row per code, defined by `spec/v2/errors.schema.json`. It registers **120** codes. `schemas/v2/error-envelope.schema.json` is GENERATED from it and MUST NOT be edited by hand.

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

The retriable rows are `residency_unavailable`, `rate_limited`, `internal_error`, `pack_registry_unreachable`, `runner_unavailable`, `service_unavailable`, `upstream_unavailable`.

## One code per state

An interrupt has one code per state ([interrupt.md](interrupt.md), [identity.md](identity.md)):

- A token or run-scoped resolve against an interrupt that is already resolved, or whose run is cancelled or completed, MUST return `409 interrupt_already_resolved`.
- A signed token past its `expiresAt` MUST return `410 interrupt_expired`.
- A token whose `alg` or `kid` the host does not accept MUST return `401 interrupt_token_invalid`.
- `interrupt_cancelled` is registered but names no state of the core resolve surfaces. A host MUST NOT emit it from `resolveInterruptByRun`, `inspectInterruptByToken` or `resolveInterruptByToken`.

The idempotency mismatch code is `idempotency_key_mismatch` only ([idempotency.md](idempotency.md)).

## Host-service refusals

A `ctx.*` call that rejects MUST use a registered or vendor code. A host MAY carry an uncaught rejection unchanged as the `node.failed` code.

- A generic code (`not_found`, `forbidden`, `validation_error`, `rate_limited`, `credential_not_found`, `credential_forbidden`) MUST carry `details.service`, the family key.
- `details.reason` MAY name a finer cause in lower-kebab. A client MUST NOT route on it.
- A vendor code MUST NOT stand for a state a registered code names.

## Unadvertised operations

An operation gated on a family or facet the host does not advertise MUST answer `404 not_found`.

## Codes by HTTP status

Generated from `spec/v2/errors.json` (120 codes; `retriable` and `statusSource` are in the registry).

Code | Status
--- | ---
`connection_provider_unresolved` | 400
`connector_action_unresolved` | 400
`credential_scope_unsupported` | 400
`delegation_chain_cyclic` | 400
`delegation_chain_too_long` | 400
`idempotency_key_invalid` | 400
`interop_version_unsupported` | 400
`oauth_provider_unsupported` | 400
`oauth_scope_unsupported` | 400
`pack_dependency_cycle` | 400
`pack_engine_unsupported` | 400
`pack_integrity_failure` | 400
`pack_kind_invalid` | 400
`pack_lockfile_incomplete` | 400
`pack_peer_dependency_missing` | 400
`pack_peer_dependency_undefined` | 400
`pack_signature_invalid` | 400
`pack_validation_failed` | 400
`protocol_version_mismatch` | 400
`schedule_horizon_exceeded` | 400
`sub_chain_cycle` | 400
`sub_chain_depth_exceeded` | 400
`unsupported_runtime` | 400
`unsupported_stream_mode` | 400
`until_in_past` | 400
`validation_error` | 400
`webhook_endpoint_unverified` | 400
`webhook_url_rejected` | 400
`audience_mismatch` | 401
`connector_auth_declined` | 401
`connector_auth_expired` | 401
`credential_lifetime_exceeded` | 401
`credential_revoked` | 401
`delegation_expired` | 401
`identity_unresolvable` | 401
`identity_unverified` | 401
`interrupt_token_invalid` | 401
`key_revoked` | 401
`sender_constraint_missing` | 401
`unauthenticated` | 401
`credential_forbidden` | 403
`credential_scope_forbidden` | 403
`delegation_scope_amplified` | 403
`egress_denied` | 403
`forbidden` | 403
`force_engine_version_forbidden` | 403
`id_tenant_mismatch` | 403
`mock_provider_forbidden` | 403
`pack_namespace_unauthorized` | 403
`run_forbidden` | 403
`sandbox_capability_denied` | 403
`sandbox_escape_attempt` | 403
`workspace_membership_required` | 403
`credential_not_found` | 404
`interrupt_not_found` | 404
`not_found` | 404
`pack_version_not_found` | 404
`replay_source_missing` | 404
`signature_not_available` | 404
`protocol_version_unsupported` | 406
`connection_provider_conflict` | 409
`envelope_correlation_conflict` | 409
`idempotency_in_flight` | 409
`idempotency_key_mismatch` | 409
`interrupt_already_resolved` | 409
`pack_dependency_conflict` | 409
`pack_integrity_mismatch` | 409
`replay_context_summary_unavailable` | 409
`replay_diverged_at_refusal` | 409
`replay_memory_snapshot_unavailable` | 409
`run_already_active` | 409
`run_state_conflict` | 409
`run_terminal` | 409
`version_conflict` | 409
`workspace_conflict` | 409
`interrupt_cancelled` | 410
`interrupt_expired` | 410
`run_expired` | 410
`payload_too_large` | 413
`workspace_too_large` | 413
`unsupported_media_type` | 415
`approval_rejected` | 422
`budget_exhausted` | 422
`budget_model_denied` | 422
`capability_not_provided` | 422
`capability_required` | 422
`connection_auth_metadata_mismatch` | 422
`credential_required` | 422
`envelope_invalid` | 422
`envelope_refusal` | 422
`envelope_truncation_unrecoverable` | 422
`eval_gate_unmet` | 422
`fork_point_invalid` | 422
`loop_limit_exceeded` | 422
`mcp_mrtr_rounds_exceeded` | 422
`node_config_invalid` | 422
`pack_runtime_requirement_unmet` | 422
`provider_policy_denied` | 422
`recursion_limit_exceeded` | 422
`residency_unavailable` | 422
`run_timeout` | 422
`sandbox_invocation_error` | 422
`sandbox_memory_exceeded` | 422
`sandbox_timeout` | 422
`storage_limit_exceeded` | 422
`token_budget_exceeded` | 422
`unknown_envelope_kind` | 422
`unknown_schema_version` | 422
`client_version_unsupported` | 426
`rate_limited` | 429
`event_type_unmapped` | 500
`internal_error` | 500
`pack_load_failure` | 500
`payload_unprojectable` | 500
`credential_unavailable` | 501
`mcp_error` | 502
`upstream_unavailable` | 502
`pack_registry_unreachable` | 503
`runner_unavailable` | 503
`service_unavailable` | 503

*Sources: RFCs 0171, 0213, 0228.*
