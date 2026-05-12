# openwop Spec v1 — REST Endpoint Catalog

> **Status: FINAL v1 (2026-04-27; hygiene pass 2026-05-10).** Comprehensive coverage of the canonical REST surface with per-route auth + scope, formalized in `api/openapi.yaml` against the JSON Schemas in `schemas/`. Replay/fork has shipped at `replay.md` + the `POST /v1/runs/{runId}:fork` endpoint. Remaining gaps are additive operational conveniences (bulk operations, explicit pause/resume, and any future gRPC transport), not blockers for v1 conformance. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Scope

This document catalogs the REST surface an OpenWOP-compliant server MUST expose, plus optional surfaces (MCP, A2A) that a server MAY expose. Path templates use `{paramName}` for path parameters.

## Versioning

- All paths under `/v1/` are versioned. Breaking changes go to `/v2/`.
- A server MAY support multiple versions concurrently (`/v1/...` and `/v2/...` side by side) for migration windows.
- Servers MUST return `400 Bad Request` for paths under unversioned roots.

## Required endpoints

Every OpenWOP-compliant server MUST expose:

### Discovery

| Method | Path | Auth | Scope | Purpose |
|---|---|---|---|---|
| `GET` | `/.well-known/openwop` | None | None | Capability declaration (see `capabilities.md`) |
| `GET` | `/v1/openapi.json` | None | None | Self-describing OpenAPI spec |

### Workflow manifest

| Method | Path | Auth | Scope | Purpose |
|---|---|---|---|---|
| `GET` | `/v1/workflows/{workflowId}` | API key | `manifest:read` | Workflow definition |

### Runs

| Method | Path | Auth | Scope | Purpose |
|---|---|---|---|---|
| `POST` | `/v1/runs` | API key | `runs:create` | Create a run |
| `GET` | `/v1/runs/{runId}` | API key | `runs:read` | Read run state |
| `GET` | `/v1/runs/{runId}/events` | API key | `runs:read` | SSE event stream (resumable via `Last-Event-ID`) |
| `GET` | `/v1/runs/{runId}/events/poll` | API key | `runs:read` | Long-poll fallback for non-SSE clients |
| `POST` | `/v1/runs/{runId}/cancel` | API key | `runs:cancel` | Cancel an in-flight run |
| `POST` | `/v1/runs:bulk-cancel` | API key | `runs:cancel` | Bulk cancel a set of in-flight runs |
| `POST` | `/v1/runs/{runId}:fork` | API key | `runs:create` + `runs:read` | Fork or replay a run from recorded state |
| `POST` | `/v1/runs/{runId}:pause` | API key | `runs:cancel` | Administratively pause an in-flight run |
| `POST` | `/v1/runs/{runId}:resume` | API key | `runs:cancel` | Resume a paused run |

#### `POST /v1/runs` request

```json
{
  "workflowId": "string (required)",
  "inputs": "object (optional)",
  "tenantId": "string (optional, server-defaults from API key)",
  "scopeId": "string (optional, opaque correlation)",
  "callbackUrl": "string (optional, signed-token HITL callback)",
  "configurable": "object (optional, per-run parameter overlay)",
  "tags": "string[] (optional)",
  "metadata": "object (optional)"
}
```

Headers:
- `Authorization: Bearer <key>` — REQUIRED
- `Idempotency-Key` — RECOMMENDED (see `idempotency.md`)
- `X-Dedup: enforce` — OPTIONAL; when set, server cross-host claim system rejects duplicate (tenantId, scopeId) pairs with `409 Conflict`

#### `POST /v1/runs` response

```json
{
  "runId": "string",
  "status": "pending | running | waiting-approval | ...",
  "eventsUrl": "string (SSE endpoint)",
  "statusUrl": "string"
}
```

Status codes:
- `201 Created` — run accepted
- `400 Bad Request` — malformed body, unknown workflowId, invalid inputs
- `401/403` — auth failures (see `auth.md`)
- `409 Conflict` — `X-Dedup` collision; body `{ error: "run_already_active", message, details: { activeRunId, activeHost, retryAfter } }`; header `Retry-After: <seconds>`
- `429 Too Many Requests` — rate-limit; header `Retry-After: <seconds>`

#### `POST /v1/runs:bulk-cancel` request

```json
{
  "runIds": ["run-...", "run-..."],
  "reason": "string (optional, free-form rationale)"
}
```

`runIds` MUST be a non-empty array (1..100 entries) of run identifiers the caller can `runs:cancel`. The cap on array length is host-defined (REQUIRED upper bound for any one request — RECOMMENDED 100); requests exceeding the cap MUST return `400 validation_error` with `details.maxRunIds` indicating the configured ceiling. Hosts MUST process each cancellation independently; partial failure MUST NOT block successful cancellations of sibling ids.

Response:

```json
{
  "results": [
    { "runId": "run-aaa", "status": "cancelling", "ok": true },
    { "runId": "run-bbb", "ok": false, "error": { "code": "not_found", "message": "..." } }
  ]
}
```

- `results[i].runId` echoes the corresponding request entry verbatim. Order MUST match the request's `runIds` array.
- `results[i].ok: true` indicates the host accepted the cancel intent; the run will transition to `cancelling` (per `runs/{runId}/cancel` single-cancel semantics) and emit `run.cancelled` when the cascade completes. `results[i].status` carries the post-acceptance state.
- `results[i].ok: false` carries a canonical `ErrorEnvelope`-shaped object under `error`. Common codes: `not_found`, `forbidden`, `run_terminal` (already-completed/failed/cancelled), `validation_error`.

Status codes:

- `200 OK` — the request reached at least one runId; per-id outcomes are in `results`. The host MUST return `200` even when every runId failed individually — the top-level operation succeeded.
- `400 Bad Request` — `runIds` array malformed (empty, oversized, non-string entries, or missing).
- `401 / 403` — auth failures on the request itself.

**Idempotency.** Bulk-cancel is naturally idempotent — re-issuing the same bulk request returns the same per-id outcomes (already-cancelled runs return `ok: true, status: 'cancelled'`). `Idempotency-Key` is RECOMMENDED to collapse retries.

**Auth scope.** Single `runs:cancel`; the same scope that gates `/v1/runs/{runId}/cancel`. Per-runId authorization MUST still be enforced — a caller without visibility on a runId gets `forbidden` in that result entry (not a top-level `403`).

#### `POST /v1/runs/{runId}:pause` request

```json
{
  "reason": "string (optional, free-form rationale persisted on run.paused payload)",
  "drainPolicy": "immediate | drain-current-node (optional, default 'drain-current-node')"
}
```

`drainPolicy: 'immediate'` snapshots the run between events; `drainPolicy: 'drain-current-node'` lets the executing node reach a terminal (`node.completed` / `node.failed` / `node.suspended`) before the run transitions to `paused`. Hosts MUST persist the chosen policy on the `run.paused` event payload.

Response:

```json
{ "runId": "string", "status": "paused", "pausedAt": "ISO8601" }
```

Status codes:

- `202 Accepted` — pause requested; transition emits `run.paused` event when complete
- `404 Not Found` — run does not exist or caller can't see it
- `409 Conflict` — run is already paused, terminal, or in a state that cannot be paused; `details.runStatus` carries the current state

Idempotency: a `:pause` against a run that is already paused returns `409` (with the existing pause's `pausedAt` in `details`) unless the request carries `Idempotency-Key` matching the original pause, in which case the host returns `202` with the cached response per `idempotency.md`.

#### `POST /v1/runs/{runId}:resume` request

```json
{
  "reason": "string (optional)"
}
```

Resumes a paused run. The next executable event after the `run.paused` is `run.resumed`; execution continues from the position recorded at pause.

Response:

```json
{ "runId": "string", "status": "running", "resumedAt": "ISO8601" }
```

Status codes:

- `202 Accepted` — resume in flight
- `404 Not Found` — run does not exist
- `409 Conflict` — run is not currently paused; `details.runStatus` carries the actual state

Pause/resume is **distinct from** cancel and from suspend-on-interrupt:

- `cancel` is terminal; the run transitions to `cancelled` and cannot resume.
- HITL `suspend` is a workflow-driven wait for a resume event (approval, clarification, etc.); the run is in `waiting-*` not `paused`.
- `:pause` is operator-driven; the run is `paused` and only `:resume` (or explicit cancel) exits the state.

Replay of a run that was paused mid-execution re-folds `run.paused` and `run.resumed` events as no-ops for state-projection purposes; the events are observable in the event log but do not affect the projected state.

### HITL (approvals + suspensions)

| Method | Path | Auth | Scope | Purpose |
|---|---|---|---|---|
| `POST` | `/v1/runs/{runId}/interrupts/{nodeId}` | API key | `approvals:respond` | Resolve a run-scoped interrupt or approval gate |
| `POST` | `/v1/interrupts/{token}` | Signed token | None | Resolve any HITL interrupt via callback URL |
| `GET` | `/v1/interrupts/{token}` | Signed token | None | Inspect an interrupt without resolving |

The signed-token surface (`/v1/interrupts/{token}`) is for asynchronous HITL where the server POSTed a callback URL to an external system at suspension time. Tokens are HMAC-signed by the server with a configurable expiry (recommended default: 30 min). See `interrupt.md` for token format.

### Artifacts

| Method | Path | Auth | Scope | Purpose |
|---|---|---|---|---|
| `GET` | `/v1/runs/{runId}/artifacts/{artifactId}` | API key | `artifacts:read` | Read a run-produced artifact |

### Webhooks

| Method | Path | Auth | Scope | Purpose |
|---|---|---|---|---|
| `POST` | `/v1/webhooks` | API key | `webhooks:manage` | Register a subscription |
| `DELETE` | `/v1/webhooks/{webhookId}` | API key | `webhooks:manage` | Unregister |

### Audit-log integrity (gated on profile)

Hosts that advertise the `openwop-audit-log-integrity` profile per `auth-profiles.md` MUST expose:

| Method | Path | Auth | Scope | Purpose |
|---|---|---|---|---|
| `GET` | `/v1/audit/verify` | API key | `audit:read` | Re-walk the audit-log hash chain over `[fromSeq, toSeq]` and return chain-validity verdict + signed checkpoints + anomalies. See `auth-profiles.md` §`openwop-audit-log-integrity` §4 and `schemas/audit-verify-result.schema.json`. |

## Optional endpoints (transports)

An OpenWOP-compliant server MAY expose additional transports. If exposed, they MUST follow these contracts:

### Server-Sent Events (SSE)

The `GET /v1/runs/{runId}/events` endpoint MUST:
- Set `Content-Type: text/event-stream`
- Honor `Last-Event-ID` request header to resume from the next sequence after that ID
- Emit a comment line (`:keepalive`) at least every 30 seconds to prevent intermediary timeouts
- Auto-close the connection when the run reaches a terminal status (`completed`, `failed`, `cancelled`)
- Stream events with `id:`, `event:`, `data:` fields per the SSE spec

### MCP (Model Context Protocol)

If exposed, the server MUST mount MCP at `/v1/mcp` (platform) or `/v1/mcp/{namespace}` (namespaced). MCP endpoints follow the MCP spec; this openwop spec does not redefine MCP semantics.

### A2A (Agent-to-Agent)

If exposed, the server MUST mount A2A at `/v1/a2a` (platform) or `/v1/a2a/{namespace}` (namespaced). The agent card is at `/v1/a2a/agent.json`.

## Headers

| Header | Direction | Purpose |
|---|---|---|
| `Authorization` | Request | `Bearer <api-key-or-jwt>` |
| `Idempotency-Key` | Request | Per-mutation idempotency token (see `idempotency.md`) |
| `X-Dedup` | Request | `enforce` to opt into cross-host run-claim deduplication |
| `X-Force-Engine-Version` | Request (test-keys-only) | Forces the run to emit events at the specified engine version. Used by the conformance suite to verify forward-compat fold-best-effort. Servers MUST reject on production keys with `403 force_engine_version_forbidden`. See `version-negotiation.md` + F5 in `conformance/fixtures.md`. |
| `Last-Event-ID` | Request (SSE) | Resume from sequence after this ID |
| `Retry-After` | Response | Seconds to wait before retrying (with 409, 429, 503) |
| `traceparent` / `tracestate` | Both | W3C Trace Context propagation (RECOMMENDED) |

## Error response shape

All error responses (REST surface) MUST be JSON:

```json
{
  "error": "<machine_readable_code>",
  "message": "<human_readable>",
  "details": "object (optional, error-specific)"
}
```

The wire shape is locked at exactly these three top-level fields per `schemas/error-envelope.schema.json` (`additionalProperties: false`). Hosts that need to surface contextual data (retry hints, conflict refs, server-side trace IDs, validation field paths) MUST place it under `details`, never at a new top level.

### `details.correlationId` convention (RECOMMENDED for 5xx)

When a host issues a server-side trace ID for a 5xx response so the API consumer can quote it when filing a bug, the canonical home is `details.correlationId`:

```json
{
  "error": "internal_error",
  "message": "An unexpected error occurred.",
  "details": {
    "correlationId": "01H8Z9..."
  }
}
```

Reasoning:

- The schema declares `additionalProperties: false`, so a top-level `correlationId` is non-conformant. Strict validators reject it.
- `details` is the documented contextual-data slot. Existing examples in this spec (`retryAfter`, `activeRunId`, `capability`, `requirement`) follow the same pattern.
- The convention is RECOMMENDED, not REQUIRED. Hosts that don't emit trace IDs are still spec-conformant.

The conformance suite's `errors.test.ts` (suite version 1.15.0+) asserts:
1. No top-level keys outside `{error, message, details}` (additionalProperties:false equivalent).
2. When present, `details.correlationId` MUST be a non-empty string.

Hosts emitting `correlationId` at the top level (or other extras like `hint` / `requestId` / `traceId`) MUST move them under `details`.

Common error codes:
- `unauthenticated`, `forbidden`, `key_expired`, `key_revoked` — see `auth.md`
- `validation_error` — request body/params malformed; `details` enumerates fields
- `not_found` — resource doesn't exist or caller can't see it (do not leak existence)
- `run_already_active` — `X-Dedup` collision
- `recursion_limit_exceeded` — run terminated due to safety cap
- `rate_limited` — too many requests
- `capability_not_provided` — a node's `requires` declared a runtime capability the host has not registered. The `message` MUST name the missing capability id; `details.capability` SHOULD carry the same id machine-readably. The run terminates `failed` and the offending node MUST NOT execute. See `capabilities.md` §"Runtime capabilities".
- `capability_required` — `POST /v1/runs` (or workflow registration) refused a workflow that references a capability-gated reserved typeId (`core.conversationGate`, `core.orchestrator.supervisor`, `core.dispatch`) on a host that does not advertise the gating capability. `details.requiredCapability` SHOULD name the gating capability key (e.g., `"conversationPrimitive"`); `details.offendingTypeId` SHOULD name the typeId that tripped the gate; `details.nodeId` SHOULD identify the workflow node. HTTP status MUST be one of `400` / `404` / `422`. See `capabilities.md` §"Unsupported capability — refusal contract".
- `credential_required` — a node's `requiresSecrets[]` declared a secret but none was resolved. Either the host's `SecretResolver` returned null/undefined for the requested `(id, scope)` OR `RunOptions.configurable.ai.credentialRef` was missing for a `kind: 'ai-provider'` requirement on a BYOK provider. `message` SHOULD name the missing secret id; `details.requirement` SHOULD carry the full `SecretRequirement` shape.
- `credential_forbidden` — caller passed `RunOptions.configurable.ai.credentialRef` for a provider NOT in `Capabilities.aiProviders.byok`. The host doesn't permit BYOK for that provider; the caller must omit the credentialRef and let the host route via platform-managed keys. `details.provider` SHOULD carry the offending provider id.
- `credential_unavailable` — a node declares `requiresSecrets[]` but the host doesn't advertise `Capabilities.secrets.supported = true`. The host fundamentally can't resolve secrets for this run. The run terminates `failed` and the offending node MUST NOT execute. `details.requirement` SHOULD carry the SecretRequirement shape; `details.capability` SHOULD carry `"secrets"` so machine readers can map to the missing capability section.
- `internal_error` — unexpected server failure (no implementation details in `message`)
- `rate_limited` — request rejected because the caller exceeded a per-tenant, per-route, or global rate limit. **Normative envelope:** the response MUST set HTTP status `429`, MUST set the `Retry-After` header (seconds), AND SHOULD carry `details.retryAfterMs` and `details.scope`. See §"`429 Too Many Requests` envelope" below.

### `429 Too Many Requests` envelope (normative)

When a host returns `429`, the response body MUST conform to the canonical `ErrorEnvelope` with `error: "rate_limited"` and SHOULD carry the following keys under `details`:

```json
{
  "error": "rate_limited",
  "message": "Rate limit exceeded for tenant t-abc on /v1/runs.",
  "details": {
    "retryAfterMs": 12500,
    "scope": "tenant" 
  }
}
```

Field semantics:

- `details.retryAfterMs` — milliseconds the caller should wait before retrying. When present, MUST be consistent with the `Retry-After` HTTP header (which carries integer seconds); `retryAfterMs` provides sub-second precision. When the host cannot compute a deterministic backoff, `retryAfterMs` MAY be omitted; the `Retry-After` header remains REQUIRED.
- `details.scope` — closed enum: `"tenant" | "route" | "global" | "key"`. Identifies which limit fired. Clients SHOULD use this to disambiguate retries (a `"tenant"`-scoped limit affects only one customer; `"global"` affects everyone; `"key"` is per-credential).
- `details.limit` — OPTIONAL integer ceiling that fired (e.g., requests per minute). Useful for clients that want to display the limit to operators.
- `details.observedRate` — OPTIONAL integer observed rate at the time of rejection (same units as `limit`).

Hosts MUST NOT introduce additional top-level keys on the envelope (the `error-envelope.schema.json` declares `additionalProperties: false`). Vendor-specific data goes under `details`.

Conformance: `rate-limit-envelope.test.ts` (suite version 1.16.0+) verifies that any `429` response satisfies this shape.

## Legacy deployment aliases

Some deployments may have surfaces that predate openwop and use a slightly different shape. New OpenWOP-compliant deployments SHOULD use the spec'd paths above. Existing deployments MAY continue serving:

- `/v1/canvas-types/{canvasTypeId}/runs` — adds canvas-type scoping in the path. openwop spec moves canvas-type out of the path; servers that want canvas-type filtering SHOULD use a query parameter (`?canvasTypeId=...`) or carry it on the workflow definition.
- `/v1/canvas-types/{canvasTypeId}/manifest` — same shape as above.

These canvas-typed routes MAY be served as aliases that map internally to the spec routes. They are not part of the v1 conformance surface.

---

## Open spec gaps

| # | Gap | Owner |
|---|---|---|
| R1 | ✅ Bulk-cancel endpoint landed in v1.0 (this doc, 2026-05-12). | closed |
| R2 | ✅ Explicit administrative pause/resume endpoints — landed in v1.0 (this doc, 2026-05-10). | closed |
| R3 | ✅ Optional gRPC transport profile landed at `spec/v1/grpc-transport.md` (Phase B, 2026-05-12). REST + SSE remains the REQUIRED wire surface; gRPC is an additional opt-in surface advertised via `capabilities.supportedTransports: ["grpc"]`. Canonical service definition at `api/grpc/openwop.proto`. | closed |
| R4 | ✅ Endpoint coverage manifest landed at `conformance/coverage.md` §"Endpoint Coverage Manifest". Every OpenAPI `operationId` MUST appear there (enforced by `spec-corpus-validity.test.ts`). Auto-generation tooling is a future polish; the manual manifest + the gate already close the gap. | closed |

## References

- `auth.md` — authentication + scopes
- `idempotency.md` — `Idempotency-Key` contract
- `capabilities.md` — `/.well-known/openwop`
- `interrupt.md` — HITL + callback token format
- `replay.md` — fork/replay endpoint
