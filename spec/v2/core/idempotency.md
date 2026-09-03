# Idempotency

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0170 §D.3, RFC 0171 §B.2, RFC 0173 §B.**

## Why this exists

A retried request MUST NOT create a second run, and a retried node MUST NOT issue a second external effect. A host MUST implement Layer 1 for every mutating endpoint and Layer 2 for every node executor that performs an external side effect.

## Layer 1: `Idempotency-Key`

The header keeps its standard name (RFC 0171 §C.1) and applies to every mutating operation in `api/v2/openapi.yaml`; `GET` operations MUST NOT honor it.

| Rule | Requirement |
| --- | --- |
| Grammar | The value MUST match `^[A-Za-z0-9._~-]{22,128}$` and MUST carry at least 128 bits of entropy (a UUIDv4 in canonical or base64url form satisfies it). A host MUST reject a value outside the grammar with `400 idempotency_key_invalid`. |
| Record key | A record MUST be keyed by `(authenticatedTenantId, canonicalEndpointId, callerIdempotencyKey)`; the tenant MUST come from the credential, never the body. |
| Final outcomes | A host MUST cache `2xx` and non-retryable `4xx` responses (status, headers, body) and MUST return the cached response to a same-key duplicate. |
| Retryable outcomes | `429` and `5xx` MUST NOT be replayed from cache; a same-key retry MUST re-execute, and a later final outcome replaces the record. |
| Not cached | `400 idempotency_key_invalid`, `400 validation_error`, `401` and `403` MUST NOT be cached. |
| Digest mismatch | A different request digest under the same record key MUST fail with `409 idempotency_key_mismatch` and MUST NOT return the cached body. This is the only mismatch code. |
| Concurrency | Of two concurrent same-key requests a host MUST process exactly one to completion and MUST NOT process both. Retry timing travels in `Retry-After` only. |
| Replay marker | A response served from cache MUST carry `OpenWOP-Idempotent-Replay: true`. |
| Retention | A record MUST be retained for at least 24 hours. |
| Keyspace | Host-minted identifiers MUST NOT share the caller idempotency store. Logs and spans MUST NOT expose keys. |

## Layer 2: effect identity

Layer 2 is bound by advertising `idempotency` (security-defaults.md). Its unit is the **effect**, identified once and stable across every transport or provider retry.

| Rule | Requirement |
| --- | --- |
| Keying | An effect MUST be keyed on its business identity (`keying: business-identity`): derived from the business operation, stable across every entry point, containing no `runId`, `nodeId` or ordinal. The activity recipe (`keying: activity-recipe`: tenant, run, node, ordinal, `providerKey`) is the fallback for a provider with no business key. |
| Attempts | The retry counter MUST NOT participate in the identity. Two distinct logical invocations MUST receive different identities. |
| Claim | The persist that guards the effect MUST be an atomic claim (compare-and-set or insert-if-absent) that at most one executor can win, so at most one concurrent duplicate performs the effect. |
| Provider key | When the provider accepts an idempotency key, the host MUST inject the effect identity (or a documented deterministic derivative), stable across retries. A host that cannot use the provider's convention MUST still persist the outcome. |
| Streaming | A streamed body MUST NOT be cached in the ledger; the host SHOULD record the request and its final outcome. |
| Retention | An effect record MUST be retained for at least 14 days. |

### Witness: `GET /runs/{runId}/effects`

A host that advertises `idempotency` MUST serve `schemas/v2/effect-ledger-projection.schema.json` at `GET /runs/{runId}/effects` (`getRunEffects`): `{ runId, effects[] }`, each record carrying `effectId` (tenant-bound, `schemas/v2/ids.schema.json`), `nodeId`, `attempt`, `keying`, `state` (`claimed` | `completed` | `released` | `escaped`), `at`, optional `invocationId` and a redaction-safe `providerKey`. The projection MUST be content-free of provider payloads and credential material.

## Composition

Layer 1 deduplicates the caller's request; Layer 2 deduplicates the run's effects. A retried provider call inside a run MUST resolve to the same effect record. Effects under replay and fork are in replay.md; identifier grammars are in identity.md.
