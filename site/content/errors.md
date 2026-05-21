# Error codes

The canonical OpenWOP error envelope is `{ code, message, details? }` returned with the appropriate HTTP status. This page lists every code defined in the v1 spec corpus with its HTTP status, a one-line meaning, and the spec section that carries the normative definition.

Last reviewed: 2026-05-21. Source of truth: [`rest-endpoints.md` §"Common error codes"](/spec/v1/rest-endpoints.html#common-error-codes).

## Envelope shape

```json
{
  "code": "validation_error",
  "message": "Request body fails schema",
  "details": {
    "field": "workflowId",
    "reason": "missing"
  }
}
```

- `code` — machine-readable identifier. Stable under v1.x compatibility rules; new codes land additively.
- `message` — human-readable explanation. MUST NOT include the offending input verbatim when that input could echo a prompt-injection payload or a credential.
- `details` — optional structured context. Documented per code below.

The HTTP status code carries the primary classification; the `code` field disambiguates within the status class.

## Codes by category

### Authentication &amp; authorization (4xx)

| Code | HTTP | Meaning | Defined in |
|---|---|---|---|
| `unauthenticated` | 401 | Caller did not present a usable credential. Response MUST NOT echo credential material. | [`auth.md`](/spec/v1/auth.html) |
| `forbidden` | 403 | Caller is authenticated but the principal lacks permission for the resource. | [`auth.md`](/spec/v1/auth.html) |
| `key_expired` | 401 | API key was previously valid but has aged out. | [`auth.md`](/spec/v1/auth.html) |
| `key_revoked` | 401 | API key was explicitly revoked. | [`auth.md`](/spec/v1/auth.html) |

### Request validity (4xx)

| Code | HTTP | Meaning | Defined in |
|---|---|---|---|
| `validation_error` | 400 / 422 | Request body or params malformed. `details` enumerates fields. | [`rest-endpoints.md`](/spec/v1/rest-endpoints.html) |
| `not_found` | 404 | Resource does not exist or caller is not permitted to know it exists. | [`rest-endpoints.md`](/spec/v1/rest-endpoints.html) |
| `run_already_active` | 409 | `X-Dedup` collision. `details.activeRunId` carries the colliding run. | [`idempotency.md`](/spec/v1/idempotency.html) |
| `recursion_limit_exceeded` | 422 | Run terminated due to configurable recursion safety cap. | [`rest-endpoints.md`](/spec/v1/rest-endpoints.html) |

### Capability gating (4xx)

| Code | HTTP | Meaning | Defined in |
|---|---|---|---|
| `capability_not_provided` | 422 | Node's `requires` declared a runtime capability the host hasn't registered. `details.capability` names the missing id. | [`capabilities.md`](/spec/v1/capabilities.html) §"Runtime capabilities" |
| `capability_required` | 400 / 404 / 422 | `POST /v1/runs` refused a workflow that references a capability-gated reserved typeId on a host not advertising the gate. `details.requiredCapability` + `offendingTypeId` + `nodeId`. | [`capabilities.md`](/spec/v1/capabilities.html) §"Unsupported capability — refusal contract" |

### BYOK + credentials (4xx)

| Code | HTTP | Meaning | Defined in |
|---|---|---|---|
| `credential_required` | 422 | Node declared `requiresSecrets[]` but the host's resolver returned null OR `RunOptions.configurable.ai.credentialRef` was missing for a BYOK provider. `details.requirement` carries the full SecretRequirement shape. | [`auth.md`](/spec/v1/auth.html) |
| `credential_forbidden` | 422 | Caller passed `credentialRef` for a provider NOT in `capabilities.aiProviders.byok`. `details.provider` names it. | [`auth.md`](/spec/v1/auth.html) |
| `credential_unavailable` | 422 | Node declares `requiresSecrets[]` but the host doesn't advertise `capabilities.secrets.supported`. `details.requirement` + `details.capability = "secrets"`. | [`auth.md`](/spec/v1/auth.html) |

### Envelope validation (4xx) — RFC 0032/0033

| Code | HTTP | Meaning | Defined in |
|---|---|---|---|
| `envelope_invalid` | 422 | Schema-violation retry budget exhausted. Renamed from `envelope_payload_invalid` (2026-05-21). | [`ai-envelope.md`](/spec/v1/ai-envelope.html) §"Validation outcomes" |
| `envelope_truncation_unrecoverable` | 422 | Truncation retry budget exhausted while failure mode remained truncation. Distinct retry strategy from `envelope_invalid`. | [`ai-envelope.md`](/spec/v1/ai-envelope.html) |
| `envelope_refusal` | 422 | Provider returned an explicit refusal (OpenAI `message.refusal`, Anthropic safety-stop, Gemini safety-block). MUST NOT retry. Error `message` MUST NOT include the refusal text. | [`ai-envelope.md`](/spec/v1/ai-envelope.html) |

### Sandbox execution (4xx) — RFC 0035

| Code | HTTP | Meaning | Defined in |
|---|---|---|---|
| `sandbox_memory_exceeded` | 422 | Invocation exceeded `capabilities.sandbox.memoryLimitBytes`. | [`host-capabilities.md`](/spec/v1/host-capabilities.html) §"Sandbox" |
| `sandbox_timeout` | 422 | Invocation exceeded `capabilities.sandbox.wallClockLimitMs`. | [`host-capabilities.md`](/spec/v1/host-capabilities.html) §"Sandbox" |
| `sandbox_capability_denied` | 422 | Sandbox code called a host capability not in `capabilities.sandbox.allowedHostCalls`. Capability-gate-respected invariant in observable form. | [`host-capabilities.md`](/spec/v1/host-capabilities.html) §"Sandbox" |
| `sandbox_escape_attempt` | 422 | Sandbox detected an explicit escape attempt (forbidden syscall, out-of-sandbox-root filesystem access, unauthorized fork/exec). `details.escapeKind`. | [`host-capabilities.md`](/spec/v1/host-capabilities.html) §"Sandbox" |

### Rate limiting + backpressure (429 / 503)

| Code | HTTP | Meaning | Defined in |
|---|---|---|---|
| `rate_limited` | 429 | Caller exceeded a per-tenant, per-route, or global rate limit. Response MUST set `Retry-After`. `details.retryAfterMs` + `details.scope`. | [`rest-endpoints.md`](/spec/v1/rest-endpoints.html) §"`429 Too Many Requests` envelope" |
| `backpressure` | 503 | Production-profile host is shedding load. Response MUST set `Retry-After`. | [`production-profile.md`](/spec/v1/production-profile.html) |

### Server-side failures (5xx)

| Code | HTTP | Meaning | Defined in |
|---|---|---|---|
| `internal_error` | 500 | Unexpected server failure. `message` MUST NOT carry implementation details that could aid an attacker. | [`rest-endpoints.md`](/spec/v1/rest-endpoints.html) |

## Stability guarantees

Per [Versioning &amp; compatibility](/versioning/):

- **New codes** land additively within v1.x. Clients that match an unknown `code` against a known set MUST treat it as the parent HTTP status family.
- **Existing codes** never change their HTTP status mapping or their semantic meaning within v1.x. A code's `details` shape may gain new optional fields.
- **Removed codes** never happen within v1.x. A code that turns out to be redundant is documented as superseded; the old code keeps working.

## What this page is not

This is not the normative source. The error envelope shape is defined in [`rest-endpoints.md`](/spec/v1/rest-endpoints.html); each code's preconditions, the events it pairs with (`envelope.retry.exhausted`, `cap.breached`, etc.), and any SR-1 redaction rules are documented in the spec section linked above. When this page disagrees with the spec, the spec wins.

This page exists as a reference card for client implementers — one place to grep when wiring error handling.
