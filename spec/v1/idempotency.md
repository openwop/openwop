# OpenWOP Spec v1 — Idempotency

> **Status: Stable · v1.2 (2026-08-08).** Comprehensive coverage of both layers: HTTP `Idempotency-Key` (Layer 1) + engine `invocationId` (Layer 2), including Layer 2's scope boundary at a fork. Stable surface for external review. Open gaps in cross-region replication + entropy floor only. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

Workflow execution is full of operations that can be retried — externally (caller retries on `503`, `408`, network blip) and internally (engine retry policy on a node, sub-workflow re-entry, replay). Without an idempotency contract, retries duplicate side effects: a single approval becomes two LLM calls, a single charge becomes two charges, a single message becomes two notifications.

openwop defines a two-layer contract:

1. **HTTP-layer idempotency** — caller-supplied `Idempotency-Key` on mutating requests, dedup'd by the server.
2. **Activity-layer idempotency** — engine-internal dedup of side effects within a node's execution, using a deterministic key derived from `(runId, nodeId, attempt, providerKey)`.

Implementations MUST support layer 1 for any spec-defined mutating endpoint. Implementations MUST support layer 2 for any node executor that performs an external side effect (API call, DB write, message publication).

---

## Layer 1: HTTP `Idempotency-Key`

### Endpoints affected

The header applies to every endpoint that creates, mutates, or causes side effects:

- `POST /v1/runs` — create a run
- `POST /v1/runs/{runId}/cancel`
- `POST /v1/runs/{runId}/approvals/{nodeId}`
- `POST /v1/interrupts/{token}` — resolve any HITL interrupt
- `POST /v1/webhooks` — register
- `DELETE /v1/webhooks/{webhookId}`
- Any future mutating endpoint (`POST`, `PUT`, `PATCH`, `DELETE`)

`GET` endpoints MUST NOT require or honor `Idempotency-Key` (HTTP semantics already make them safe).

### Caller responsibilities

A caller SHOULD:

1. Generate a unique `Idempotency-Key` per logical operation (a UUIDv4 or similar high-entropy value).
2. Reuse the same key when retrying the same logical operation after a transient failure.
3. NOT reuse a key for a different logical operation; doing so is undefined behavior (server MAY return the cached response of the original operation, possibly stale).

Recommended key format: any URL-safe string ≤ 255 characters. UUIDv4 is conventional.

### Server responsibilities

A server receiving an `Idempotency-Key`:

1. MUST cache the response (status, headers excluding `Set-Cookie`, body) under the composite key `(tenantId, endpoint, idempotencyKey)` when the outcome is **final** per rule 6 (RFC 0093).
2. On a duplicate request with the same composite key, MUST return the cached **final** response (status, body), and SHOULD set a `openwop-Idempotent-Replay: true` response header. Retryable-class outcomes are never replayed from cache — see rule 6 (RFC 0093).
3. MUST retain the cache entry for at least 24 hours.
4. SHOULD bound cache size and evict oldest entries on overflow; an evicted entry causes the server to treat the next duplicate request as a fresh request (which MAY produce a different result).
5. MUST NOT cache responses for failed requests where the failure was a malformed key or auth failure (i.e., HTTP `400` `validation_error`, `401`, `403`); those failures aren't idempotent retries to begin with.
6. (RFC 0093) MUST cache **final** outcomes — `2xx` and non-retryable `4xx` — for the dedup window. Retryable-class responses (`429`, `500`, `502`, `503`, `504`) MUST NOT be served from cache to a same-key retry: the retry MUST attempt re-execution (subject to the §"Concurrent duplicates" in-flight rule below), and a later successful execution MUST replace any recorded retryable-class outcome so subsequent duplicates replay the success. Hosts MAY record retryable-class outcomes for observability — recording is not replaying.

### Concurrent duplicates

When two requests with the same composite key arrive concurrently and the first hasn't completed:

- The server MUST process exactly one to completion.
- The other MAY block and receive the same response, or MAY return `409 Conflict` with body `{ error: "idempotency_in_flight", message, details: { retryAfter } }` indicating the caller should retry briefly.
- The server MUST NOT process both as if they were independent.

### Cache key composition

```text
cacheKey = sha256(tenantId || ':' || endpoint || ':' || idempotencyKey)
```

`tenantId` partitioning prevents cross-tenant key collisions even with weak entropy. `endpoint` partitioning means the same `Idempotency-Key` value can be reused across different endpoints (semantically distinct operations).

### Response

The server MUST add `openwop-Idempotent-Replay: true` to any response that was served from the idempotency cache. Callers MAY use this to detect retry-served responses and adjust their own state machine.

---

## Layer 2: Activity-level idempotency

Inside a workflow run, a node executor often makes external API calls (LLM, payment, message). When the node is retried (executor returns retryable error, sub-workflow is re-entered), the executor MUST NOT make duplicate side-effect calls.

> **Scope — Layer 2 is a within-run mechanism.** An earlier revision of this paragraph also listed "run is replayed from event log" among the triggers Layer 2 covers. It does not; see the note below.

### Idempotency key composition

The engine constructs a per-side-effect idempotency key as:

```text
invocationId = sha256(runId || ':' || nodeId || ':' || attempt || ':' || providerKey)
```

Where:

- `runId`: the run ID
- `nodeId`: the node ID within the run
- `attempt`: zero-based retry attempt counter for the side effect
- `providerKey`: a stable identifier for the side effect being made (e.g., `'openai:chat:completions'`, `'stripe:create-charge'`, `'send-email'`)

The `providerKey` is supplied by the executor or the activity wrapper; it MUST be stable across retries of the same side effect.

> **Layer 2 does not survive a fork.** The key includes `runId`, and `POST /v1/runs/{runId}:fork` mints a new one, so a replayed run's keys never collide with its source's — the Layer-2 cache provably cannot deduplicate across a fork, however correctly it is implemented. Cross-fork side-effect suppression is a separate mechanism: see `replay.md` §"Side-effect suppression in replay" (RFC 0140), under which a replayed side-effecting node resolves the **source** run's recorded outcome or fails closed with `replay_source_missing`. LLM-calling nodes are the exception that still works across a fork, via the content-addressed secondary key in `replay.md` §"LLM cache-key recipe" §C.

### Engine guarantees

The engine MUST:

1. Persist the result of each `(invocationId)` to a durable invocation log before returning it to the executor.
2. On a retry that produces the same `invocationId`, return the persisted result without re-invoking the side effect.
3. Persist failures as well as successes — a 4xx from a payment provider should not be retried as if it never happened.
4. Apply a TTL on invocation log entries (recommended 14 days; configurable).

### Provider header injection

When the side effect is an HTTP call to a provider that supports `Idempotency-Key`, the engine SHOULD inject the `invocationId` as the `Idempotency-Key` request header. Known providers:

- OpenAI: `Idempotency-Key` (top-level)
- Anthropic: not yet exposed; safe to inject anyway
- Stripe: `Idempotency-Key` (top-level)
- AWS APIs: `X-Amzn-Idempotency-Token` on some endpoints; engine MAY translate

Engines that don't know the provider's idempotency convention MUST still persist the result internally (so retries are deduplicated server-side even if the provider would have processed both).

### Streaming responses

For streaming responses (SSE, chunked transfer):

- The engine MUST NOT cache streamed bodies in the invocation log (potentially unbounded).
- The engine SHOULD record the request was made and any final result/error.
- On retry, the engine MAY re-invoke the streaming call; this is permissible because streaming responses are typically token-counted by upstream providers and idempotency-keyed at the call boundary, so a duplicate stream is at most a billing inefficiency, not a correctness failure.

---

## Composition: how the layers compose

A typical write flow:

```text
Caller — POST /v1/runs
  Idempotency-Key: <UUID>
        │
        ▼
Server  — Layer 1 dedup: cache lookup by (tenantId, endpoint, key)
        │   miss → continue
        ▼
Server  — Create run, persist run.started event
        │
        ▼
Engine  — Execute node N1
        │   side effect: OpenAI chat completion
        ▼
Engine  — Layer 2: invocationId = sha256(runId:N1:0:openai-chat)
        │   InvocationLog lookup: miss → call provider with invocationId as Idempotency-Key
        │   Persist response under invocationId
        ▼
Engine  — Side effect succeeded, advance to N2
        │
        ▼
Server  — Persist response in Layer 1 idempotency cache, return to caller
```

If the caller retries `POST /v1/runs` with the same Layer-1 key, the Layer-1 cache replays the original response — the run isn't created twice and the executor isn't invoked again.

If the engine retries the OpenAI call internally (transient 503), Layer 2's `invocationId` is identical, so the second call either short-circuits (cache hit) or hits OpenAI's own idempotency cache via the injected header.

---

## Multi-region idempotency (annex)

For deployments that replicate the idempotency cache across geographic regions (multi-region active-active), the v1.0 single-region guarantees relax under partition. This annex defines the relaxation and the conflict-resolution rule.

### Guarantees under partition

For Layer 1 (HTTP `Idempotency-Key`) under multi-region replication:

1. **Same-region replays** preserve the v1.0 guarantee: identical request body → cached response; conflicting body → `409 idempotency_in_flight` until the original completes, then conflict envelope.
2. **Cross-region replays during partition** MAY succeed in both regions independently — the cache has not yet replicated. Hosts MUST detect convergence after the partition heals and SHOULD emit a `dedup.conflict-resolved` operational metric (`openwop.idempotency.cross_region_conflicts_total`) so operators can monitor frequency.
3. **Convergence rule:** when two regions independently created a run under the same `(tenantId, endpoint, key)` tuple, the host MUST resolve to a single survivor. Resolution order:
   - Lower `runId` lexicographic order wins (deterministic without coordination).
   - The losing run is force-cancelled (`run.cancelled` with reason `'cross_region_dedup_loss'`).
   - The losing run's `Idempotency-Key` cache entry is updated to point at the winning `runId`.
   - Subsequent retries with that key return the winning run.

### Operator surface

Hosts SHOULD expose:

- `openwop.idempotency.cross_region_conflicts_total` — counter, labeled by `(tenant, route, region_pair)`.
- `openwop.idempotency.partition_seconds` — gauge of estimated cache divergence in seconds.

### Why "best-effort under partition"

Strict cross-region idempotency requires synchronous replication on every request, which adds inter-region RTT to every mutation. The annex chooses availability + observable convergence over strict consistency. Hosts that need strict cross-region dedup MUST advertise a stricter `capabilities.idempotency.crossRegion: "strict"` value and pay the latency cost; the default value remains `"best-effort"`.

### Capability advertisement

```json
{
  "capabilities": {
    "idempotency": {
      "supported": true,
      "layer1RetentionSeconds": 86400,
      "layer2RetentionSeconds": 1209600,
      "crossRegion": "single-region" | "best-effort" | "strict",
      "multiRegion": {
        "supported": true,
        "replicationLagBoundMs": 5000,
        "partitionRecoveryStrategy": "last-writer-wins"
      }
    }
  }
}
```

Clients SHOULD inspect `capabilities.idempotency.crossRegion` before relying on multi-region guarantees.

### `multiRegion` sub-block (RFC 0036, normative when `multiRegion.supported: true`)

Per [RFC 0036](../../RFCS/0036-multi-region-and-cross-engine-guarantees.md) (`Active` 2026-05-21). The `multiRegion` sub-block is a **granular advertisement** that complements the categorical `crossRegion` claim. A host that advertises `crossRegion: "strict"` SHOULD also advertise `multiRegion.supported: true` with `replicationLagBoundMs: 0` (synchronous replication). A host that advertises `crossRegion: "best-effort"` MAY advertise `multiRegion.supported: true` with a non-zero bound.

When `multiRegion.supported: true`:

- An Idempotency-Key write succeeding in region A MUST be read-visible in region B after waiting `replicationLagBoundMs + safetyMargin`.
- After a partition healed leaves two regions with conflicting idempotency-key records for the same key, the host MUST resolve the conflict deterministically using the advertised `partitionRecoveryStrategy`. The resolution rule MUST be observable: re-running the same conflict input MUST produce the same survivor.
- Conformance asserts both contracts via `multi-region-idempotency.test.ts` against the host's multi-region test simulator (per RFC 0036 §C).

Hosts that do NOT advertise the `multiRegion` block retain the existing best-effort posture documented above.

## Open spec gaps

| #   | Gap                                                                                                                           | Owner       |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- |
| I1  | ✅ Cross-region replication semantics — landed in v1.0 (this doc §"Multi-region idempotency", added 2026-05-10).              | closed      |
| I2  | Garbage-collection guarantees / minimum TTL — currently RECOMMENDED 24h Layer 1 / 14d Layer 2; SHOULD be MUST after telemetry | future      |
| I3  | Streaming response handling — Layer 2 currently doesn't cache; conformance suite should validate this is "safe" not "broken"  | P2-F4       |
| I4  | Idempotency key entropy lower bound — currently no MUST; consider 128 bits                                                    | future v1.x |
| I5  | ✅ Layer-2 scope at a fork — closed by the §"Layer 2" note added 2026-08-08 (RFC 0140); cross-fork suppression lives in `replay.md`. | closed      |

## References

- `auth.md` — auth model
- `rest-endpoints.md` — endpoint catalog (`Idempotency-Key` applies to every mutating endpoint)
- Host implementation notes: Layer 1 belongs at the HTTP/request-store boundary; Layer 2 belongs inside the engine's side-effect wrapper before any external provider call.
