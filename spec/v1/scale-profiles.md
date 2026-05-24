# openwop Spec v1 — Scale Profiles

> **Status: Stable · v1.1 (2026-05-05).** Defines three scale tiers a host MAY claim. Scale claims are advertised in host documentation and verified at runtime by `@openwop/openwop-conformance` scenarios. No discovery-payload schema change. Graduated DRAFT → FINAL via RFC 0004. See `auth.md` for the status legend. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## Why this exists

openwop doesn't standardize how a host scales — implementation-internal queueing, sharding, and worker-pool design are out of scope. But clients need to be able to choose a host that matches their workload, and hosts need a vocabulary for describing what they can sustain.

A **scale profile** is a named tier of operational guarantees: concurrency floor, queue depth, fan-out cap, retry behavior, and expected latency for canonical scenarios. Three tiers:

- **`minimal`** — appropriate for a development host or a reference example. Single-process, no horizontal scaling.
- **`production`** — appropriate for a small-to-medium-sized production deployment serving real users.
- **`high-throughput`** — appropriate for a deployment that prioritizes sustained throughput over latency.

Scale profiles are independent of compatibility profiles (`profiles.md`). A host MAY satisfy `openwop-core` + `openwop-secrets` at any scale tier; the two axes don't constrain each other.

---

## Profile definitions

| Property | `minimal` | `production` | `high-throughput` |
|---|---|---|---|
| Concurrent runs in flight (per tenant) | ≥ 1 | ≥ 50 | ≥ 500 |
| Concurrent runs in flight (global) | ≥ 1 | ≥ 500 | ≥ 5000 |
| `POST /v1/runs` p50 latency | ≤ 1000 ms | ≤ 250 ms | ≤ 100 ms |
| `POST /v1/runs` p99 latency | ≤ 5000 ms | ≤ 1000 ms | ≤ 500 ms |
| Event-stream delivery delay (p99) | ≤ 5000 ms | ≤ 500 ms | ≤ 200 ms |
| Idempotency cache retention | ≥ 24 h | ≥ 24 h | ≥ 24 h |
| Backpressure mechanism | 503 + Retry-After | 503 + Retry-After + queue | 503 + Retry-After + queue + admission control |
| Fan-out cap (parallel sub-workflows) | ≥ 1 | ≥ 10 | ≥ 100 |
| Run replay (cold-cache) | ≤ 30 s | ≤ 5 s | ≤ 2 s |

The numbers are **floors a host MUST sustain to claim the tier**, not suggested defaults. A host that sustains `production`-tier numbers under typical load but not under sustained burst SHOULD claim `production` and document its burst behavior in its README.

---

## Conformance scenarios

`@openwop/openwop-conformance` includes scenarios that exercise these guarantees against a live host. Scenarios are tagged with the scale profile they target:

- `highConcurrency.test.ts` — covers concurrent-runs-in-flight, p99 latency under load, idempotency under retry storm.
- `streamReconnect.test.ts` — covers event-stream delivery delay during reconnect.
- `staleClaim.test.ts` — covers replay-on-claim-release behavior.

Hosts run the conformance suite and report which scale profile they pass against. The pass record lives in:

- The host's README or compatibility documentation.
- The `INTEROP-MATRIX.md` row for the host.

The scale profile is **not** advertised in `/.well-known/openwop`. There's no protocol-defined endpoint for "what scale profile do you pass." It's a documentation-and-conformance claim, not a wire-level handshake.

---

## Backpressure semantics

A host SHOULD return `503 Service Unavailable` with a `Retry-After` header when the server is at capacity for the current request. The body MUST be the standard error envelope per `auth.md`:

```json
{
  "error": "service_unavailable",
  "message": "Server at capacity. Retry after 5s.",
  "details": {
    "retryAfter": 5
  }
}
```

The `details.retryAfter` value (in seconds), when present, MUST equal the `Retry-After` header value. Clients MAY compute their own backoff but SHOULD respect `Retry-After` as a floor.

A host claiming `production` or `high-throughput` SHOULD additionally implement an in-process queue that absorbs short bursts before returning 503. The queue depth is implementation-defined; the host MAY document the depth in its README.

A host claiming `high-throughput` SHOULD implement admission control: when the queue is at capacity, the host MAY pre-emptively reject low-priority requests (e.g., requests without an `Idempotency-Key` from non-priority tenants) before they enter the queue. Admission control is implementation-defined; the host MUST document the policy if any client could observe a different rejection rate by varying request shape.

---

## Retry semantics

Per `idempotency.md` §"Caller responsibilities," a caller SHOULD retry a transient failure (`503`, `429`, `5xx`, network error) with the same `Idempotency-Key`. This document layers normative retry semantics on top:

- **Floor on retry count.** A host MUST handle at least `5` retries with the same `Idempotency-Key` within the cache-retention window without losing the cached response. A host that retains the cache longer (per its scale profile) accepts more retries by extension.
- **Floor on retry interval.** A host MUST tolerate retries arriving as fast as `100 ms` apart. A host that returns `429` for fast retries MUST set `Retry-After` and MUST NOT reject the request after the indicated wait.
- **Cache-miss on stale retry.** Per `idempotency.md` §"Server responsibilities" #4, a host that has evicted the cache entry MAY treat the next retry as a fresh request. Hosts SHOULD document their cache-eviction policy if it's stricter than the 24-hour minimum.

Hosts claiming `high-throughput` SHOULD support at least `20` retries within the cache-retention window — burst retry storms are common in that tier and clients MUST be able to drive them safely.

---

## Fan-out semantics

A workflow that spawns sub-workflows (per `replay.md` §"Sub-workflows") creates fan-out. The cap on parallel sub-workflows from a single parent is implementation-defined; this document sets minimum floors per profile (see table above).

A host that throttles fan-out below the floor is not in the claimed profile. A host that exceeds the floor is permitted; clients SHOULD NOT depend on parallelism beyond the floor unless the host's documentation guarantees a higher cap.

When fan-out is throttled, the host MUST emit a standard run event that clients can observe and MUST continue the run with sequential execution of the throttled siblings. Hosts MAY use `workflow.stalled`, `node.failed` with a retryable error, or a host-extension event such as `host.fan_out.throttled`; they MUST NOT use `cap.breached` unless the schema has a registered `kind` for that limit. A host MUST NOT silently drop sub-workflow spawns.

---

## Replay semantics

Per `replay.md`, a host MAY support cold-cache replay (re-construct run state from event log on a host that hasn't seen the run before). Replay is OPTIONAL in v1 (advertised via the conformance scenarios for the profile); the scale profile sets a latency floor for hosts that DO support it.

A host claiming `high-throughput` SHOULD implement event-log indexing such that cold-cache replay completes within the floor in the table above. Hosts that don't implement replay MUST either fail the `replayDeterminism.test.ts` scenario explicitly (with a documented out-of-scope marker) or reject `POST /v1/runs:fork` requests with `501 Not Implemented`.

---

## Conformance expectations

A host claims a scale profile by:

1. Running `@openwop/openwop-conformance` with an advertised scale profile and publishing the command/result summary.
2. Passing every scenario tagged with that profile.
3. Documenting the pass result in the host's README + `INTEROP-MATRIX.md` row.

Profile pass results are **per-conformance-suite-version**. A host claiming `production` against suite `1.0.0` MAY fail `production` against suite `1.1.0` if new scenarios were added that the host doesn't yet pass; the suite minor bump doesn't invalidate the earlier pass.

---

## Why these specific numbers

The numbers above derive from observed practice at small-to-medium production OpenWOP deployments and similar workflow-host deployments:

- `minimal`: numbers a development laptop or a single-process reference example sustains without specific tuning.
- `production`: numbers a single managed-container or platform-as-a-service deployment with default autoscaling sustains.
- `high-throughput`: numbers that require deliberate horizontal scaling, sharded queues, or admission control.

Hosts whose workloads don't fit these tiers MAY define their own profile in a follow-up RFC. The closed catalog of three is the v1.x default; profiles MAY be added per `RFCS/0001-rfc-process.md`.

---

## Open spec gaps

| ID | Description |
|---|---|
| SCALE-1 | ✅ Closed in the v1.0 conformance baseline. `--scale-profile=<name>` filters scenarios by their profile tag. |
| SCALE-2 | Latency-percentile measurement methodology (warm-up time, sample size, environment) is not specified here. Each scenario file documents its own. The `highConcurrency.test.ts` scenario seeds the methodology. |
| SCALE-3 | Cross-region replication semantics (a single run originating in one region with replay served from another) is out of scope for v1.x. |

---

## References

- `idempotency.md` — Layer 1 idempotency contract that retry semantics build on.
- `replay.md` — replay/fork mechanism that the replay-latency floor measures.
- `capabilities.md` §"Engine-enforced limits" — `cap.breached` event for registered engine-enforced limits.
- `profiles.md` — compatibility profiles (independent axis from scale profiles).
- `COMPATIBILITY.md` — additive-change discipline that gates new scale profiles.
- `RFCS/0001-rfc-process.md` — RFC mechanism for adding scale profiles.
- `spec/v1/idempotency.md` — companion spec nailing down idempotency+retry semantics for `POST /v1/runs`.
