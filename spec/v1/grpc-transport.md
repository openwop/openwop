# OpenWOP Spec v1 — gRPC Transport Profile

> **Status: Stable · v1.1 (2026-05-12).** Optional alternative transport profile. REST + SSE remains the REQUIRED wire surface for every v1-conforming host (per `rest-endpoints.md`); a host MAY ALSO expose the gRPC surface defined here under `capabilities.supportedTransports: ["grpc"]`. The two surfaces describe the same protocol semantics; gRPC clients can produce byte-equivalent runs against a dual-surface host. Closes R3 in `rest-endpoints.md` §"Open spec gaps". Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

Some deployment classes prefer gRPC over REST for protocol-level reasons:

- **Internal microservice networks** that already standardize on gRPC + Protobuf wire format.
- **Multi-language clients** that benefit from a single `.proto` definition rather than per-language OpenAPI generators.
- **Bidirectional streaming** for the events surface — REST + SSE works but gRPC's native bidi-stream is more ergonomic in some clients.
- **Lower per-request overhead** vs HTTP/1.1 + JSON for high-volume orchestration paths.

The protocol's REST + SSE surface remains the v1 canonical contract. A host that adds gRPC does NOT drop REST; it exposes BOTH surfaces over the same engine. The conformance suite continues to validate REST; gRPC conformance is gated on an additional scenario set that compares per-operation outcomes against the REST surface.

---

## Scope

**In scope:**

- Wire-format canonical: Protobuf 3 over gRPC over HTTP/2.
- Service-name canonical: `openwop.v1.Engine` (one service per protocol version).
- Method names: 1:1 with `api/openapi.yaml` `operationId` values, normalized to PascalCase.
- Error-envelope mapping: `error-envelope.schema.json` → gRPC `Status` proto with `details[]` carrying the `error-envelope` JSON.
- Bidirectional event-stream method (`StreamRunEvents`) replacing SSE.
- Auth: same bearer-token + scope vocabulary, passed via the gRPC `authorization` metadata key.

**Out of scope:**

- Replacing REST. REST + SSE remains the v1-required surface.
- Re-spec'ing semantics. Every gRPC method's behavior is identical to its REST counterpart per `rest-endpoints.md`.
- Streaming primitives beyond `StreamRunEvents` — no bidi for run-create or interrupt-resolve.
- gRPC-Web. Hosts MAY expose gRPC-Web alongside; the conformance scenario validates the canonical gRPC-over-HTTP/2 path.

---

## Service definition

The canonical `.proto` file lives at `api/grpc/openwop.proto` and ships alongside `api/openapi.yaml`. Hosts MAY embed the file or fetch it from the conformance suite distribution at install time.

```protobuf
syntax = "proto3";

package openwop.v1;

// One service per protocol major version. v2 would introduce
// `openwop.v2.Engine` alongside, similar to /v1/ ↔ /v2/ in REST.
service Engine {
  // Discovery — 1:1 with REST `GET /.well-known/openwop`.
  rpc GetCapabilities(GetCapabilitiesRequest) returns (GetCapabilitiesResponse);

  // Workflow + Run lifecycle.
  rpc GetWorkflow(GetWorkflowRequest) returns (GetWorkflowResponse);
  rpc CreateRun(CreateRunRequest) returns (CreateRunResponse);
  rpc GetRun(GetRunRequest) returns (GetRunResponse);
  rpc CancelRun(CancelRunRequest) returns (CancelRunResponse);
  rpc BulkCancelRuns(BulkCancelRunsRequest) returns (BulkCancelRunsResponse);
  rpc ForkRun(ForkRunRequest) returns (ForkRunResponse);
  rpc PauseRun(PauseRunRequest) returns (PauseRunResponse);
  rpc ResumeRun(ResumeRunRequest) returns (ResumeRunResponse);

  // Events — server-streaming replaces SSE.
  // Client cancels by tearing down the stream; host respects.
  rpc StreamRunEvents(StreamRunEventsRequest) returns (stream RunEventEnvelope);

  // HITL — interrupt resolution.
  rpc ResolveInterruptByRun(ResolveInterruptByRunRequest) returns (ResolveInterruptResponse);
  rpc ResolveInterruptByToken(ResolveInterruptByTokenRequest) returns (ResolveInterruptResponse);
  rpc InspectInterruptByToken(InspectInterruptByTokenRequest) returns (InspectInterruptResponse);

  // Artifacts + Webhooks + Audit verify.
  rpc GetArtifact(GetArtifactRequest) returns (GetArtifactResponse);
  rpc RegisterWebhook(RegisterWebhookRequest) returns (RegisterWebhookResponse);
  rpc UnregisterWebhook(UnregisterWebhookRequest) returns (google.protobuf.Empty);
  rpc VerifyAuditLog(VerifyAuditLogRequest) returns (VerifyAuditLogResponse);
}
```

Message shapes mirror the JSON Schemas. Field names are snake_case per Protobuf convention; the wire-format JSON⇆Protobuf field-name translation follows the Protobuf canonical JSON mapping (proto3 JSON Mapping). Implementations MAY use `json_name` field options to preserve REST-style camelCase across the JSON surface.

---

## Auth

Bearer tokens travel in the gRPC `authorization` metadata key per the standard convention:

```text
authorization: Bearer <token>
```

Same scope vocabulary as REST per `auth.md`. The host validates the bearer token + scope against the gRPC method exactly as it would the REST operation (the method ↔ scope map below is normative).

**Method ↔ required scope:**

| gRPC method                                               | Scope                                         |
| --------------------------------------------------------- | --------------------------------------------- |
| `GetCapabilities`                                         | none (unauthenticated)                        |
| `GetWorkflow`                                             | `manifest:read`                               |
| `CreateRun`                                               | `runs:create`                                 |
| `GetRun` / `StreamRunEvents`                              | `runs:read`                                   |
| `CancelRun` / `BulkCancelRuns` / `PauseRun` / `ResumeRun` | `runs:cancel`                                 |
| `ForkRun`                                                 | `runs:create` + `runs:read`                   |
| `ResolveInterruptByRun`                                   | `approvals:respond`                           |
| `ResolveInterruptByToken` / `InspectInterruptByToken`     | none (signed-token; auth is the token itself) |
| `GetArtifact`                                             | `artifacts:read`                              |
| `RegisterWebhook` / `UnregisterWebhook`                   | `webhooks:manage`                             |
| `VerifyAuditLog`                                          | `audit:read`                                  |

Hosts MAY ALSO accept mTLS (per `auth-profiles.md` §`openwop-auth-mtls`) on the gRPC listener. mTLS is the recommended posture for internal-only gRPC deployments where bearer tokens are operationally expensive.

---

## Error mapping

REST `ErrorEnvelope` ↔ gRPC `Status`:

| REST envelope `error` code                                                   | gRPC `code` (`google.rpc.Code`)                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `unauthenticated`, `key_expired`, `key_revoked`                              | `UNAUTHENTICATED` (16)                                                                         |
| `forbidden`                                                                  | `PERMISSION_DENIED` (7)                                                                        |
| `validation_error`                                                           | `INVALID_ARGUMENT` (3)                                                                         |
| `not_found`, `run_not_found`, `workflow_not_found`                           | `NOT_FOUND` (5)                                                                                |
| `run_already_active`, `idempotency_key_conflict`, `idempotency_key_mismatch` | `ALREADY_EXISTS` (6) — for run dedup; `ABORTED` (10) — for idempotency conflicts               |
| `recursion_limit_exceeded`                                                   | `RESOURCE_EXHAUSTED` (8)                                                                       |
| `rate_limited`                                                               | `RESOURCE_EXHAUSTED` (8) — gRPC has no native `429`; use this code + `retry-after` in metadata |
| `capability_not_provided`, `capability_required`                             | `FAILED_PRECONDITION` (9)                                                                      |
| `credential_required`, `credential_forbidden`, `credential_unavailable`      | `FAILED_PRECONDITION` (9)                                                                      |
| `internal_error`                                                             | `INTERNAL` (13)                                                                                |

Hosts MUST attach the full canonical `ErrorEnvelope` JSON as a `details[]` entry on the gRPC `Status` proto so clients can recover the structured `details.*` fields (e.g., `details.retryAfterMs`, `details.requiredCapability`):

```protobuf
import "google/rpc/status.proto";
import "google/rpc/error_details.proto";

// status.details[].type_url = "openwop.dev/spec/v1/ErrorEnvelope"
// status.details[].value     = <JSON-serialized ErrorEnvelope bytes>
```

Clients SHOULD prefer the structured `details[]` for branching; the textual `message` is for human display only.

---

## Streaming semantics

`StreamRunEvents` replaces REST's `GET /v1/runs/{runId}/events` (SSE) + `/events/poll` (long-poll) with a single server-streaming method:

```protobuf
message StreamRunEventsRequest {
  string run_id = 1;
  // Resume cursor — gRPC equivalent of SSE Last-Event-ID / poll lastSequence.
  int64 last_sequence = 2;
  // Subset of streaming modes per stream-modes.md.
  repeated string stream_modes = 3;
  // Optional buffer hint per S3 in stream-modes.md.
  int32 buffer_ms = 4;
}
```

Hosts MUST emit `RunEventEnvelope` messages in monotonic-sequence order. When the run reaches a terminal status (`completed` / `failed` / `cancelled`), the host closes the stream with `OK` after the terminal event has been delivered. Mid-stream cancellation by the client tears down the gRPC channel; the host treats this as a passive disconnect and does NOT cancel the run.

W3C Trace Context propagation works via the gRPC standard convention: the client passes `traceparent` + `tracestate` in metadata; the host MUST honor them per `observability.md` §"Trace context propagation."

---

## Capability advertisement

A host that exposes the gRPC surface advertises:

```json
{
  "supportedTransports": ["rest", "grpc"],
  "capabilities": {
    "grpc": {
      "supported": true,
      "endpoint": "grpc://api.example.com:50051",
      "service": "openwop.v1.Engine",
      "tls": "required"
    }
  }
}
```

**Field semantics:**

- `supportedTransports: ["grpc"]`: presence required when gRPC is exposed.
- `capabilities.grpc.supported`: boolean toggle (true when the surface is live).
- `capabilities.grpc.endpoint`: full URI `grpc://` (cleartext, intra-trusted-network only) OR `grpcs://` (TLS). Hosts SHOULD require TLS in production.
- `capabilities.grpc.service`: canonical service name. v1 hosts MUST use `openwop.v1.Engine`.
- `capabilities.grpc.tls`: `"required"` / `"optional"` / `"disabled"`. Production hosts MUST set `"required"`.

REST + SSE remains exposed at the host's HTTP endpoint regardless of whether gRPC is advertised. Clients that pre-flight via the REST `/.well-known/openwop` discover the gRPC surface and switch.

---

## Conformance

The `capabilities.grpc` block described in §"Field semantics" above is added to `capabilities.schema.json` by RFC 0094 (in flight), which also adds the capability-gated scenario `conformance/src/scenarios/grpc-transport.test.ts`. Until RFC 0094 lands, the schema does not yet carry the block. Hosts that advertise `capabilities.grpc.supported: true` are expected to pass that scenario, which verifies:

1. `GetCapabilities` returns a payload byte-equivalent to the REST `/.well-known/openwop` response (after Protobuf↔JSON normalization).
2. `CreateRun` + `GetRun` + `StreamRunEvents` round-trip a workflow run with the same event sequence the REST surface produces.
3. Error envelope mapping per the table above — `ErrorEnvelope` JSON attached to `Status.details[]` matches the REST 4xx/5xx body.
4. Auth metadata: missing `authorization` → `UNAUTHENTICATED`; invalid bearer → `UNAUTHENTICATED`; valid bearer w/o scope → `PERMISSION_DENIED`.

Hosts that don't advertise the capability skip-equivalent.

---

## Implementation notes (non-normative)

- The reference TypeScript SDK does NOT yet ship a gRPC client. gRPC clients are SDK-implementation work and follow each language's idiomatic gRPC tooling (`grpc-js` / `@grpc/grpc-js` for Node, `grpcio` for Python, `google.golang.org/grpc` for Go).
- Code-generation: hosts and clients use `protoc` + the official `grpc_tools` per their language. The `.proto` file is hand-maintained alongside `api/openapi.yaml`; future tooling MAY auto-derive one from the other.
- The protocol does NOT specify a gRPC reflection-service requirement. Hosts MAY enable `grpc.reflection.v1.ServerReflection` for tooling ergonomics; the conformance suite does not depend on it.
- Production-profile claimants: gRPC's HTTP/2 framing allows finer-grained backpressure than HTTP/1.1; production hosts SHOULD apply the same `production.backpressure.inflightCap` semantics to the gRPC listener (concurrent in-flight RPCs).

---

## See also

- `rest-endpoints.md` — the canonical REST + SSE surface
- `capabilities.md` §`supportedTransports` — transport advertisement
- `auth.md` — bearer-token authentication and scope vocabulary
- `observability.md` §"Trace context propagation" — W3C trace context applies identically over gRPC metadata
- `error-envelope.schema.json` — error wire-shape (carried in `Status.details[]`)
- `api/grpc/openwop.proto` — canonical service definition (ships with the spec corpus)
