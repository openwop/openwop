# Errors

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0171 §B.**

## Why this exists

Every error a v2 host returns is a row in one registry. A client routes on `error`, never on `message`, and a code that is not registered is not a protocol error. The registry is the single source for the envelope schema, the HTTP status, and retriability.

## The registry

`spec/v2/errors.json` holds one row per code: `{ code, httpStatus, retriable, details, since, deprecated? }` plus the provenance fields `statusSource` and `source`. It registers **96** codes. `schemas/v2/error-envelope.schema.json` is GENERATED from it and MUST NOT be edited by hand.

A host MUST return a registered code, or a vendor code, in every error response. A vendor code MUST match `^(?!openwop\.)[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9_]*$` with its first segment an org registered in `spec/v2/declaration.json`; `openwop.` is reserved. The registry grows by the closed-enum rule in overview.md §0: a producer MUST NOT emit an unregistered member, and a consumer MUST accept an unknown registered member and MUST NOT act on it.

## The envelope

Every error response body MUST be `{ error, message, details? }` and nothing else (`additionalProperties: false`). `error` is the registered code or a vendor code; `message` is a non-empty string; `details` is an object whose shape is the row's `details` schema. A row whose `details` is `null` accepts any object; when a row registers a schema, the generated envelope becomes a `oneOf` discriminated on `error`. Contextual data (conflict refs, trace ids, validation paths) MUST live under `details`, never at a new top level. The same envelope is the per-id `error` of `bulkCancelRuns` (runs.md). When present, `details.correlationId` MUST be a non-empty string.

`x-openwop-http-status` and `x-openwop-retriable` in the generated schema mirror the registry; a host MUST answer with the registered status.

## Retry timing

Retry timing lives in the `Retry-After` header only. `details.retryAfter`, `details.retryAfterMs` and `details.retryAfterSeconds` are not part of v2 and a host MUST NOT emit them. A `429 rate_limited` response MUST set `Retry-After`. The retriable rows are `residency_unavailable`, `rate_limited`, `internal_error`, `pack_registry_unreachable`, `runner_unavailable`.

## One code per state

An interrupt has one code per state: a token or run-scoped resolve against an interrupt that is already resolved, or whose run is cancelled or completed, MUST return `409 interrupt_already_resolved`; a signed token past its `expiresAt` MUST return `410 interrupt_expired`; a token whose `alg` or `kid` the host does not accept MUST return `401 interrupt_token_invalid` (see interrupt.md, identity.md). The idempotency mismatch code is `idempotency_key_mismatch` only (idempotency.md).

## Codes by HTTP status

Generated from `spec/v2/errors.json` (96 codes; `retriable` and `statusSource` are in the registry).

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
`unsupported_stream_mode` | 400
`until_in_past` | 400
`validation_error` | 400
`webhook_url_rejected` | 400
`audience_mismatch` | 401
`connector_auth_expired` | 401
`credential_revoked` | 401
`delegation_expired` | 401
`identity_unresolvable` | 401
`identity_unverified` | 401
`interrupt_token_invalid` | 401
`key_revoked` | 401
`sender_constraint_missing` | 401
`unauthenticated` | 401
`credential_forbidden` | 403
`delegation_scope_amplified` | 403
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
`replay_diverged_at_refusal` | 409
`replay_memory_snapshot_unavailable` | 409
`run_already_active` | 409
`run_terminal` | 409
`version_conflict` | 409
`workspace_conflict` | 409
`interrupt_cancelled` | 410
`interrupt_expired` | 410
`workspace_too_large` | 413
`payload_too_large` | 413
`unsupported_media_type` | 415
`capability_not_provided` | 422
`capability_required` | 422
`credential_required` | 422
`envelope_invalid` | 422
`envelope_refusal` | 422
`fork_point_invalid` | 422
`envelope_truncation_unrecoverable` | 422
`loop_limit_exceeded` | 422
`mcp_mrtr_rounds_exceeded` | 422
`pack_runtime_requirement_unmet` | 422
`recursion_limit_exceeded` | 422
`residency_unavailable` | 422
`run_timeout` | 422
`sandbox_memory_exceeded` | 422
`sandbox_timeout` | 422
`token_budget_exceeded` | 422
`client_version_unsupported` | 426
`rate_limited` | 429
`event_type_unmapped` | 500
`internal_error` | 500
`pack_load_failure` | 500
`credential_unavailable` | 501
`pack_registry_unreachable` | 503
`runner_unavailable` | 503
