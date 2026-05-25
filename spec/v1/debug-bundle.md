# openwop Spec v1 — Run Debug Bundle

> **Status: Stable · v1.1 (2026-05-05).** Defines `GET /v1/runs/{runId}/debug-bundle` — a portable JSON export of a single run's diagnostic state. Additive over v1 per `COMPATIBILITY.md` §2.1: optional endpoint; hosts MAY omit. Graduated DRAFT → FINAL via RFC 0004. See `auth.md` for the status legend. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## Why this exists

When a run misbehaves and an operator needs to file a bug, send context to the host vendor, or reproduce the failure on a different host, today's options are:

- Screenshot the UI (lossy, not machine-readable, leaks secrets).
- `curl` every endpoint and concatenate (incomplete, schema-uncertain).
- Hand the host vendor RAW database access (secret-exposing, not portable).

openwop defines a **portable JSON debug bundle** that captures every diagnostic surface relevant to a single run in one verifiable shape. Two hosts running this contract produce comparable bundles for the same run; vendor-neutral tooling can ingest them; redaction is uniform.

This isn't an audit log (those are host-internal compliance artifacts) or a metric export (those are observability-pipeline concerns). It's the **portable equivalent of a Chrome `chrome://crash` bundle** — what a developer hands a maintainer to debug a specific run.

---

## Endpoint

```
GET /v1/runs/{runId}/debug-bundle
```

| Auth | Cache | Profile gating |
|---|---|---|
| Required (Bearer) | `Cache-Control: no-store` | `openwop-debug-bundle` (advertised in `capabilities.debugBundle.supported: true`) |

A host that doesn't advertise `capabilities.debugBundle.supported: true` returns `404 Not Found` on this endpoint. Hosts that advertise `true` MUST return a bundle that schema-validates against `schemas/debug-bundle.schema.json`.

The endpoint is intentionally separate from `GET /v1/runs/{runId}` (snapshot) and `GET /v1/runs/{runId}/events*` (event stream). The bundle aggregates both plus diagnostic metadata into a single response.

---

## Response shape

```json
{
  "bundleVersion": "1",
  "generatedAt": "2026-05-01T12:34:56.000Z",
  "host": {
    "name": "string",
    "version": "string",
    "vendor": "string"
  },
  "run": {
    "runId": "string",
    "workflowId": "string",
    "status": "completed | failed | cancelled | running | ...",
    "startedAt": "ISO 8601",
    "endedAt": "ISO 8601 | null",
    "error": { "code": "string", "message": "string" } | null,
    "inputs": { },
    "variables": { }
  },
  "events": [
    {
      "sequence": 0,
      "type": "run.started",
      "timestamp": "ISO 8601",
      "nodeId": "string | null",
      "data": { } | null
    }
  ],
  "spans": [
    {
      "name": "openwop.run",
      "spanId": "string",
      "parentSpanId": "string | null",
      "startedAt": "ISO 8601",
      "endedAt": "ISO 8601 | null",
      "attributes": { "openwop.run_id": "...", "openwop.workflow_id": "..." }
    }
  ],
  "metrics": {
    "openwopCost": {
      "usd": 0.0,
      "tokens": { "input": 0, "output": 0 },
      "model": "string",
      "provider": "string",
      "duration_ms": 0
    } | null,
    "nodeCount": 0,
    "eventCount": 0
  },
  "redactionApplied": true,
  "redactionMode": "mask | omit | hash | passthrough"
}
```

---

## Field reference

### Top-level

| Field | Type | Required | Notes |
|---|---|---|---|
| `bundleVersion` | string | MUST | Schema version of the bundle. v1.x bundles are `"1"`; future shape changes bump this independently of the run's own data. |
| `generatedAt` | string | MUST | ISO 8601 timestamp when the host generated this response. |
| `host` | object | MUST | Identifies the host that produced the bundle. Mirrors `capabilities.implementation` shape. |
| `run` | object | MUST | The run snapshot — same shape as `GET /v1/runs/{runId}`. |
| `events` | array | MUST | The full event log for this run, in order. Same shape as `GET /v1/runs/{runId}/events/poll`'s `events`. |
| `spans` | array | SHOULD | OTel-style spans emitted during the run, if the host instruments them. Empty array if the host doesn't emit spans. |
| `metrics` | object | SHOULD | Aggregate metrics for the run. |
| `redactionApplied` | boolean | MUST | `true` if any field in this bundle was masked/omitted/hashed by the host's redaction harness. |
| `redactionMode` | string | MUST | The masking mode in effect per `capabilities.compliance.defaultMode`. One of `mask` / `omit` / `hash` / `passthrough`. |

### `run` field

Mirrors the response shape of `GET /v1/runs/{runId}` exactly. Hosts MUST NOT include fields beyond what `run-snapshot.schema.json` defines.

### `events` field

Mirrors the response shape of `GET /v1/runs/{runId}/events/poll`'s `events` array exactly. Each entry follows `run-event.schema.json`.

### `spans` field

OTel-format spans per `spec/v1/observability.md` §"Span attributes" + §"Span naming." Hosts that emit spans into a tracer (Honeycomb, Datadog, Cloud Trace) re-serialize them into this array. Hosts that don't emit spans return `[]`.

Each span includes:
- `name` (canonical `openwop.*` per observability.md)
- `spanId` (16-byte hex string)
- `parentSpanId` (16-byte hex string or null)
- `startedAt` / `endedAt` (ISO 8601)
- `attributes` (record of attribute key → value)

Attribute redaction follows the same rules as event payloads (see §"Redaction guarantees" below).

### `metrics` field

Aggregate metrics. The optional `openwopCost` matches `RunSnapshot.metrics.openwopCost` per `run-snapshot.schema.json`. `nodeCount` and `eventCount` are bookkeeping for verification:

- `nodeCount` SHOULD equal the number of distinct `nodeId` values across all events.
- `eventCount` MUST equal `events.length`. The conformance scenario asserts this.

---

## Redaction guarantees

The bundle MUST inherit the host's redaction harness:

- **Sensitive fields** (per `spec/v1/observability.md` §"Privacy classification") are masked according to `redactionMode`.
- **Workflow inputs and variables** marked `sensitive: true` apply their masking.
- **Bearer tokens, BYOK credentials, and provider API keys** that may have appeared in event payloads, error messages, or span attributes MUST be sanitized before bundle assembly.
- **Span attributes** outside the canonical `openwop.*` allowlist MUST be either filtered or sanitized (host's choice; the redaction harness covers either path).

The `redactionApplied: true` flag signals that the host applied redaction; `redactionApplied: false` is permitted only when no sensitive data was present and `redactionMode` is `passthrough`.

A host that returns `redactionApplied: true` AND `redactionMode: passthrough` is MALFORMED — pick one or the other. The conformance scenario `debugBundle.test.ts` checks this.

---

## Authorization and scoping

A bundle response MUST NOT reveal:

- Other tenants' data (cross-tenant leakage).
- Other runs' events or spans (cross-run leakage).
- Host-internal infrastructure details (machine names, internal IP addresses, database connection strings).

Bundles are issued under the same auth principal as the run-creation request. Hosts MAY require an additional capability grant (e.g., `debug-bundle.read`) per their RBAC; that's host-implementation choice.

A 401 / 403 response on this endpoint follows the canonical `auth.md` error envelope.

---

## Bundle size limits

A bundle for a typical run is < 1 MB. Hosts MUST cap bundle size at **8 MB** by default; if the run's events / spans would exceed the cap, the host returns the bundle truncated and sets `truncated: true` plus a `truncatedReason` field:

```json
{
  "bundleVersion": "1",
  "...": "...",
  "truncated": true,
  "truncatedReason": "events_truncated_to_size_cap",
  "events": [ /* prefix only */ ]
}
```

Hosts MAY raise the cap via implementation-defined configuration. Clients MUST handle `truncated: true` by either rendering a "this bundle is partial" indicator or fetching the full event stream separately.

Hosts MAY also accept implementation-defined query parameters to lower the cap on a per-request basis (e.g., for conformance tests that need to force the truncation path without driving the bundle past the 8 MB ceiling). The SQLite reference host accepts `?maxEvents=N`; the conformance scenario at `conformance/src/scenarios/debug-bundle-truncation.test.ts` soft-skips against hosts that don't honor it. Any such query parameter MUST be `host.*` namespaced if the host wants to claim spec-canonical compatibility — `maxEvents` works as an undocumented host-implementation extension because it doesn't conflict with any reserved name and the spec leaves "lower the cap" as host choice. Future-spec implementers SHOULD prefer `host.<vendor>.<query>` to avoid this naming collision.

---

## Why this isn't compressed by the protocol

A bundle is JSON. Hosts MAY use HTTP-level compression (`Content-Encoding: gzip`) per standard HTTP. The protocol doesn't mandate it; the JSON itself is verifiable plain-text.

---

## Annotations (RFC 0056)

When a host advertises `capabilities.feedback.supported`, a run's debug bundle SHOULD include the run's annotations — read from the side-store, already secret-redacted per the `annotation-content-redaction` invariant — so a flagged run travels with its reviewer notes. See [`RFCS/0056`](../../RFCS/0056-run-feedback-and-annotation-event.md) §D.

## Open spec gaps

| ID | Description |
|---|---|
| DEBUG-BUNDLE-1 | ✅ Closed in the v1.0 conformance baseline. `capabilities.debugBundle.supported: true` is represented in `schemas/capabilities.schema.json` as an additive optional property. |
| DEBUG-BUNDLE-2 | OTel-span-id format conventions when the bundle is consumed cross-trace are non-normative here — assume W3C trace context per observability.md §"Trace context propagation." |
| DEBUG-BUNDLE-3 | The 8 MB default cap is conservative. A high-throughput host serving long-running runs may need a higher cap or a streaming variant; out of scope for v1.x. |

---

## References

- `spec/v1/observability.md` — span naming, attribute taxonomy, privacy classification.
- `spec/v1/observability.md` §"Canonical run lifecycle event names" — closed event vocabulary.
- `schemas/debug-bundle.schema.json` — wire-shape contract.
- `schemas/run-snapshot.schema.json` — `run` field reuses this.
- `schemas/run-event.schema.json` — `events` field entries reuse this.
- `SECURITY/threat-model-secret-leakage.md` — debug-bundle invariants `secret-leakage-debug-bundle` + `secret-leakage-debug-bundle-otel`.
- `conformance/src/scenarios/debugBundle.test.ts` — conformance contract.
