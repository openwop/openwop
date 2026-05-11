# openwop Spec v1 — Production Profile

> **Status: FINAL v1 (2026-05-11; was PROVISIONAL 2026-05-11 → was FINAL 2026-05-10).** Operational-readiness profile for public OpenWOP hosts. This document is additive: it combines existing v1 contracts into a production claim without changing required wire shapes. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.
>
> **First satisfying host:** `examples/hosts/postgres/` advertises this profile on `INTEROP-MATRIX.md` as of 2026-05-11. Public conformance result: `examples/hosts/postgres/conformance-full.md` (86% pass against the full conformance suite — matches the SQLite reference host's baseline). The PROVISIONAL window closed once the Postgres reference host shipped all six MUSTs (durability + backpressure + retry/idempotency + event retention + debug-bundle redaction + observability logs).
>
> **Steward-published, not yet third-party-validated.** The Postgres host is built by the same team that wrote this spec. A second independent claimant is a tracked recruitment goal in `docs/recruitment/external-host.md`; landing one is what triggers the vendor-neutral-org migration in `ROADMAP.md`. Until that happens, the FINAL claim rests on the steward's own implementation evidence — defensible but worth knowing.

---

## Why this exists

Passing the base protocol proves that a host speaks OpenWOP. Running a public service also requires operational guarantees: durable retries, observable failures, event retention, redaction, and predictable backpressure.

The production profile is the public-release bar for hosted OpenWOP endpoints. It composes `auth.md`, `idempotency.md`, `stream-modes.md`, `storage-adapters.md`, `observability.md`, `debug-bundle.md`, and `scale-profiles.md`.

---

## Requirements

### Compatibility baseline

A production-profile host MUST:

- Pass `openwop-core`.
- Pass `openwop-stream-sse` or `openwop-stream-poll`; public hosts SHOULD pass both.
- Publish the conformance suite version and command used for the pass.
- Document every optional profile it claims.

### Durability

A production-profile host MUST persist run state and event logs outside process memory. In-memory storage MAY be used for local development, but it does not satisfy this profile.

Event logs MUST be replayable after process restart. Storage adapters MUST satisfy `storage-adapters.md` lease and event-log invariants, including stale-claim recovery.

### Backpressure

A production-profile host MUST return `503 Service Unavailable` with `Retry-After` when at capacity. The body MUST use the canonical error envelope:

```json
{
  "error": "service_unavailable",
  "message": "Server at capacity. Retry after 5s.",
  "details": {
    "retryAfter": 5
  }
}
```

The `details.retryAfter` value, when present, MUST equal the `Retry-After` header in seconds.

### Retry and idempotency

A production-profile host MUST retain idempotency records for at least 24 hours and MUST tolerate at least five retries with the same `Idempotency-Key` inside that window.

Transient failures MUST NOT create duplicate runs when the client retries with the same key and body.

### Event retention

A production-profile host MUST document event-log retention. The minimum retention for public claims is 7 days for run snapshots and events, unless the host explicitly labels itself as development-only.

If a run or event log has expired, `GET` endpoints MUST return a canonical `404` or `410` error envelope. Hosts SHOULD use `410 Gone` when expiry is known and intentional.

### Debug bundle behavior

If `debugBundle.supported: true`, the host MUST redact secrets and tokens from exported bundles and MUST document truncation limits for large payloads.

Large debug bundles MAY be truncated, but the truncation MUST be explicit in the bundle metadata.

### Observability

A production-profile host SHOULD export `openwop.*` OTel spans and metrics from `observability.md`. At minimum, host logs MUST include run id, tenant or project id, terminal status, error code, and request correlation id.

---

## Scale relationship

The production profile is an operational-readiness claim. `scale-profiles.md` is a throughput claim. A host can be production-ready at the `minimal` scale tier if it is durable, observable, and honest about capacity.

Public hosted services SHOULD target the `production` scale tier from `scale-profiles.md`.

---

## Conformance gaps to close

| Gap | Needed coverage |
|---|---|
| Backpressure envelope | Assert `503` uses `{error,message,details?}` and `details.retryAfter` matches `Retry-After`. |
| Durable restart | Restart host during a suspended or running workflow and verify stale-claim recovery. |
| Event retention | Verify expired run behavior where the host exposes a controllable retention test mode. |
| Debug-bundle truncation | Add a high-volume fixture and assert explicit truncation metadata. |
| Production report | Generate a machine-readable profile report from conformance results. |

