# OpenWOP Spec v1 — Idempotency

> **Status: Stable · v1.7 (2026-08-21).** Comprehensive coverage of both layers: HTTP `Idempotency-Key` (Layer 1) + engine `logicalInvocationId` (Layer 2). v1.2 retires the v1 Layer-2 composition, which carried the retry counter and so could not deliver the retry deduplication it promised (RFC 0150 §B, safety-fix). v1.3 separates record reconciliation from effect authorization and retires the `strict` / `best-effort` / time-ordered recovery vocabulary (RFC 0150 §D, safety-fix). v1.4 states that Layer-2 identity is run-scoped and requires a business identity in addition where a node effect is also reachable outside any run (RFC 0150 §B, additive). v1.5 lands RFC 0150 §A: the Layer-1 record shape (digest, state, lease), atomic reclaim of an expired pending owner, the keyspace-separation `MUST NOT` for host-generated identifiers, and — new — the canonical **`idempotency_key_mismatch`** error for a same-key/different-body replay, which the spec had never named (SP-03, additive: it names an error hosts already had to return and states a shape they already had to keep). v1.6 states the **recovery-boundary precondition** for Layer-2 identity: the ordinal reproduces across crash-and-resume **iff** the host re-executes the node's logical activities from the start on resume — the precondition RFC 0158's `kill-during-execution` / `duplicate-delivery` witnesses depend on, previously presumed but unstated (RFC 0150 §B, additive). v1.7 states that the Layer-2 invocation-log claim **MUST be atomic** (compare-and-set / insert-if-absent): a non-atomic read-then-write double-fires under **concurrent** duplicate delivery, so exactly-once was never satisfiable without it — the Layer-2 counterpart of the Layer-1 §"Concurrent duplicates" rule, previously explicit only one layer up (RFC 0158 §C.7 / RFC 0150 §B, additive). Stable surface for external review. Open gaps in cross-region replication + entropy floor only. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

Workflow execution is full of operations that can be retried — externally (caller retries on `503`, `408`, network blip) and internally (engine retry policy on a node, sub-workflow re-entry, replay). Without an idempotency contract, retries duplicate side effects: a single approval becomes two LLM calls, a single charge becomes two charges, a single message becomes two notifications.

openwop defines a two-layer contract:

1. **HTTP-layer idempotency** — caller-supplied `Idempotency-Key` on mutating requests, dedup'd by the server.
2. **Activity-layer idempotency** — engine-internal dedup of side effects within a node's execution, using a deterministic key derived from `(tenantId, runId, nodeId, logicalInvocationOrdinal, providerKey)`.

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

### Record shape, digest, and lease (RFC 0150 §A)

The rules above say what a server MUST *do*; this says what it MUST *keep*, because
several of them are unimplementable without it (rule 6 cannot distinguish a
retryable-class outcome from a final one without a state, and the mismatch rule
below cannot fire without a digest).

A Layer-1 record MUST be keyed by `(authenticatedTenantId, canonicalEndpointId,
callerIdempotencyKey)`. **The tenant identity MUST come from the authenticated
context, never from the request body** — a body-supplied tenant lets a caller
address another tenant's records. `canonicalEndpointId` is the routed
operation (e.g. `POST /v1/runs`), not the raw path, so path-parameter spellings
of one operation share a keyspace.

Each record MUST persist:

| Field | Requirement |
| --- | --- |
| `requestDigest` | A digest of the canonicalized request body, sufficient to detect a different body under the same key. |
| `state` | One of `pending`, `completed`, `retryable-failure`, `terminal-failure`. `completed` and `terminal-failure` are the **final** outcomes rule 6 caches; `retryable-failure` MUST NOT be replayed to a same-key retry. |
| lease owner + expiry | Which executor holds a `pending` record and until when. |
| terminal response metadata | Status, headers (excluding `Set-Cookie`), and body for a final outcome. |

A `pending` record whose lease has expired — a crashed or stalled owner — **MAY**
be reclaimed. A host that reclaims **MUST** do so atomically (compare-and-set on
the lease owner/expiry): two executors MUST NOT both conclude they own it, which
is the same duplicate-effect failure Layer 1 exists to prevent.

**A different `requestDigest` under the same scoped key MUST fail with
`409 idempotency_key_mismatch` and MUST NOT return the cached body.** Returning
the cached body would answer a question the caller did not ask; treating it as a
fresh request would duplicate the effect. The envelope is the canonical flat
shape — `{ "error": "idempotency_key_mismatch", "message": "…" }`. This is
distinct from `idempotency_in_flight` below: *mismatch* is a different body under
a settled key, *in-flight* is the same key still executing.

> **Naming note (2026-08-18, SP-03).** The spec named no mismatch error until
> now, so implementations diverged: `grpc-transport.md` mapped both
> `idempotency_key_conflict` and `idempotency_key_mismatch` (two spellings, one
> concept, in a single table row), the published TypeScript SDK's
> `HTTP_ERROR_CODES` carried `idempotency_key_mismatch`, the SQLite reference
> host emitted `idempotency_key_conflict`, and a tier-1 host emitted
> `idempotency_key_replay_mismatch`. `idempotency_key_mismatch` is canonical: it
> is the only spelling already present in more than one shipped artifact (the
> gRPC mapping and the published SDK), and it names what actually mismatched.
> `idempotency_key_conflict` is **retired** — "conflict" reads as the in-flight
> case, which has its own code. Hosts emitting either other spelling SHOULD move;
> the suite asserts `idempotency_key_mismatch`.

### Keyspace separation (RFC 0150 §A)

A host **MUST NOT** store host-generated identifiers — internal locks, scheduler
fire-once slots, or any key the host mints for itself — in the Layer-1
idempotency store. Caller-supplied and host-generated identifiers **MUST NOT**
share a keyspace.

This does not follow from the key tuple: a host can key its HTTP lane exactly as
required and still keep daemon keys in the same table under a bare primary key,
because those keys never entered the tuple's keyspace at all. `Idempotency-Key`
is caller-controlled and validated nowhere, so a shared table lets any
authenticated tenant send `Idempotency-Key: schedule-fire:<jobId>:<slot>`, win
the scheduler's row, and make a scheduled job **skip** — privilege escalation
through an unvalidated header, reported by a tier-1 host that had this shape.

The failure semantics force the separation independently: the caller lane MUST
distinguish `retryable-failure` so a failed attempt releases and a retry may
re-execute, while a fire-once daemon slot needs the opposite — releasing it on
failure lets another instance re-fire work the first may have half-performed.
Two concepts with contradictory release rules cannot correctly share one table.

Caller keys are caller-controlled and routinely embed customer identifiers.
Per RFC 0150 §F, logs and spans **MUST NOT** expose them; a truncated,
per-boot-salted keyed hash MAY be exposed instead.

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

Inside a workflow run, a node executor often makes external API calls (LLM, payment, message). When the node is retried (executor returns retryable error, run is replayed from event log, sub-workflow is re-entered), the executor MUST NOT make duplicate side-effect calls.

### Idempotency key composition

The engine constructs one **logical effect identity** per side effect. It identifies the
*effect the workflow intends*, not the attempt that happens to be carrying it, so every
retry of that effect resolves to the same value:

```text
logicalInvocationId = base64url(sha256(
  "openwop:activity:v2\0" ||
  tenantId || "\0" || runId || "\0" || nodeId || "\0" ||
  logicalInvocationOrdinal || "\0" || providerKey
))
```

Where:

- `openwop:activity:v2`: a domain-separation tag, so a Layer-2 identity cannot collide with any other digest the engine computes, and a future v3 composition cannot collide with this one.
- `tenantId`: the authenticated tenant the run belongs to.
- `runId`: the run ID.
- `nodeId`: the node ID within the run.
- `logicalInvocationOrdinal`: a counter over the *logical* side effects a node performs, assigned once when the logical activity is created.
- `providerKey`: a stable identifier for the side effect being made (e.g., `'openai:chat:completions'`, `'stripe:create-charge'`, `'send-email'`).

Fields are joined with a NUL separator (`\0`) and the digest is `base64url`-encoded without
padding. NUL is not representable in any of the field values, so the encoding is injective:
no two distinct field tuples can produce the same preimage.

The `providerKey` is supplied by the executor or the activity wrapper; it MUST be stable
across retries of the same side effect.

`logicalInvocationOrdinal` **MUST NOT** change across transport or provider retries of the
same logical activity. Two distinct logical invocations **MUST** receive different ordinals
even when every other input matches — a node that calls the same provider twice on purpose
is performing two effects, and they MUST NOT deduplicate against each other.

> **Across a recovery boundary.** The retries bounded above are in-process. A
> crash-and-resume is not, and whether the ordinal survives it is a property of *how the
> host resumes*, not of the composition. The ordinal — and therefore the
> `logicalInvocationId` — reproduces across a recovery-boundary resume **if and only if** the
> resumed unit re-executes the node's logical activities from the start, in the same order:
> deterministic re-execution reconstructs the same ordinal sequence, so the durable
> invocation log below suppresses the duplicate effect. A host that resumes *inside* a node —
> skipping already-run logical activities and continuing at ordinal *k* — numbers what a
> from-start re-execution would have numbered differently, shifting every downstream identity
> and defeating Layer-2 dedup on exactly the crash it most needs to survive. A host whose
> durability claim includes suppressing duplicate effects across process death (RFC 0158
> `kill-during-execution`, `duplicate-delivery`) therefore **MUST** re-execute from the node
> start on resume, **or MUST NOT** rely on Layer-2 identity to dedupe across that boundary and
> **MUST** additionally key the effect on a business identity (§"The identity is run-scoped,
> and what that costs"). This adds no field to the composition; it states the resume
> discipline the composition already presumes.

The retry counter **MUST NOT** participate in the identity. `attempt` remains useful
telemetry and hosts SHOULD keep recording it, but an identity that varies per attempt is not
an identity: it hands every retry a fresh key, so the invocation log below never hits, the
injected `Idempotency-Key` differs from the one the provider already saw, and the provider's
own deduplication is defeated along with the engine's. A composition carrying `attempt`
guarantees the duplicate side effect that Layer 2 exists to prevent, on exactly the retry
path it was written for.

`tenantId` is in the preimage because without it two tenants that collide on
`(runId, nodeId, ordinal, providerKey)` share an invocation-log entry, and the second tenant
is served the first tenant's cached provider response.

> **Migration from the v1 composition.** Through v1.0 this section specified
> `sha256(runId ':' nodeId ':' attempt ':' providerKey)`. That composition is retired: it
> could not satisfy the guarantee stated in §"Composition: how the layers compose" below,
> and a host implementing it exactly as written performs duplicate effects. Hosts MUST
> compute the v2 identity for logical activities created after upgrade. Entries already in
> the invocation log under a v1 key MAY be left to expire under their TTL; they cannot
> collide with a v2 identity, which is what the domain tag is for. See
> `version-negotiation.md` §"Layer-2 effect identity v2" for the operator runbook.

> **Layer 2 does not survive a fork (RFC 0140).** `runId` is part of the key, and
> `POST /v1/runs/{runId}:fork` mints a new one — so every key computed during a
> replay differs from its counterpart in the source run, and this cache can never
> deduplicate across a fork. That is by design: Layer 2 exists to make *retries
> within a run* safe, not to stop a replay from re-performing an effect. Suppressing
> a replay's external effects is a separate mechanism — see `replay.md`
> §"Side-effect suppression in replay".

### The identity is run-scoped, and what that costs

`runId` is in the preimage, so a Layer-2 identity is **run-scoped**. The fork note above is
one face of that; this is the other, and it is the one with teeth.

An effect issued **outside any run** has no `runId`, so it cannot produce a Layer-2 identity
at all — and therefore can never collide with one. Layer 2 deduplicates retries of a node's
effect against each other. It does **not** deduplicate a node's effect against the same
logical effect issued through an operator route, an admin action, or a scheduled job.

Where a node's side effect is **also reachable outside any run**, Layer-2 identity is
therefore **insufficient on its own**, and the host **MUST additionally key** that effect on
an identity derived from the business operation — stable across every entry point, and
containing no `runId`, `nodeId`, or ordinal.

This matters because §"Why this exists" requires Layer 2 "for any node executor that
performs an external side effect", and a host reading that literally would use the
composition above and stop. For an effect only a node can perform, that is correct. For one
an operator can also perform, it means an agent refunding order *X* inside a run does not
deduplicate against an operator who refunded order *X* through the API thirty seconds
earlier — two refunds for one logical operation, which is exactly the duplicate-effect class
this layer exists to prevent, on the highest-stakes path it touches.

The business identity does not replace the Layer-2 identity; it constrains a wider scope.
A host MAY use the business key alone where the effect is always cross-entry-point, and
**SHOULD** document which scope each of its effects is keyed at, because the two are not
interchangeable and the failure is silent in both directions.

> Reported by a tier-1 host from a shipped node pack rather than proposed in the abstract:
> a `refund-order` node and three non-run entry points reach one `refundOrder`
> implementation, which is keyed on business identity **deliberately** — because for that
> effect, run scope is the wrong scope.


### Engine guarantees

The engine MUST:

1. Persist the result of each `(logicalInvocationId)` to a durable invocation log before returning it to the executor. The persist that guards the side effect **MUST** be an **atomic claim** — a compare-and-set / insert-if-absent that at most one executor can win — not a non-atomic read-then-write (see "Concurrent duplicates (Layer 2)" below).
2. On a retry that produces the same `logicalInvocationId`, return the persisted result without re-invoking the side effect.
3. Persist failures as well as successes — a 4xx from a payment provider should not be retried as if it never happened.
4. Apply a TTL on invocation log entries (recommended 14 days; configurable).

### Concurrent duplicates (Layer 2)

Two executors can produce the same `logicalInvocationId` **concurrently** — the canonical at-least-once
hazard: an orphaned-run sweep re-dispatches a run whose previous owner is stalled but still alive, two
workers claim the same dispatch, a supervisor restarts a process that has not fully stopped. Both re-execute
the logical activity from the start, so the ordinal reproduces (§"Idempotency key composition", "Across a
recovery boundary") and both mint the **same** identity.

The engine **MUST** ensure at most one of them performs the external effect. Concretely, the persist that
guards the effect (guarantee 1) **MUST** be an atomic claim: exactly one executor wins the compare-and-set /
insert-if-absent and fires, and the other observes the hit and returns the persisted result. A non-atomic
read-then-write does **NOT** satisfy the exactly-once guarantee under concurrent delivery — both executors
miss the read and both fire, producing the duplicate external effect that §"Why this exists" and RFC 0158
§C.7 exist to prevent. This is the Layer-2 counterpart of §"Concurrent duplicates" (Layer 1, above), and it
**MUST** hold within a single-instance deployment — the orphan-sweep-races-the-original case is reachable
without a second host — not only across instances.

### Provider header injection

When the side effect is an HTTP call to a provider that supports `Idempotency-Key`, the engine SHOULD inject the `logicalInvocationId` as the `Idempotency-Key` request header, or a documented deterministic derivative of it where the provider constrains the key's length or alphabet. The value injected MUST be stable across retries for the same logical activity — that stability is the whole point of the injection, since a per-attempt value defeats the provider's deduplication as thoroughly as it defeats the engine's. Known providers:

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
Engine  — Layer 2: logicalInvocationId over (tenant, runId, N1, ordinal 0, openai-chat)
        │   InvocationLog lookup: miss → call provider with it as Idempotency-Key
        │   Persist response under logicalInvocationId
        ▼
Engine  — Side effect succeeded, advance to N2
        │
        ▼
Server  — Persist response in Layer 1 idempotency cache, return to caller
```

If the caller retries `POST /v1/runs` with the same Layer-1 key, the Layer-1 cache replays the original response — the run isn't created twice and the executor isn't invoked again.

If the engine retries the OpenAI call internally (transient 503), Layer 2's `logicalInvocationId` is identical — the retry is a second *attempt* at the same logical activity, and `attempt` is not one of its inputs — so the second call either short-circuits (cache hit) or hits OpenAI's own idempotency cache via the injected header.

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

### Reconciliation does not authorize effects

Run-record reconciliation and permission to issue an external effect are **separate
questions**, and the convergence rule above answers only the first.

Lexicographic run-ID reconciliation **MAY** select a surviving record, but it **MUST NOT
authorize effects**. Picking a survivor is a statement about which row is canonical *after*
the fact; it says nothing about how many times a charge was posted, a message sent, or a
completion billed while the partition was open. Two regions that each executed the effect
have already executed it twice, and cancelling the losing run does not un-send anything.

A host claiming multi-region **effect** safety **MUST**, before issuing an external effect,
obtain a monotonically increasing **fencing token** from a linearizable ownership service.
The effect adapter **MUST** then either reject a stale token, or issue the effect to a
provider that guarantees duplicate suppression under the stable `logicalInvocationId`
(§"Idempotency key composition"). One of those two properties **MUST** hold at the moment
the effect is issued.

If neither is available, the host **MUST NOT** claim `fenced-effects`, and **MUST** classify
the effect as `at-least-once-risk` in its own operator surface. The classification is
required rather than optional because an unquantified duplicate-effect risk is the one
operators cannot plan around: an effect known to be at-least-once can be made safe
downstream by a reconciliation job or a business-level dedup, while an effect *believed* to
be exactly-once cannot, because nobody writes the compensating control.

### Recovery postures

`capabilities.idempotency.crossRegion` is a closed enum of three postures, and the ladder is
about **effects**, not replication latency:

| Value | Records | External effects |
| --- | --- | --- |
| `single-region` | No cross-region claim | No cross-region claim |
| `reconciled-records` | Converge under lex-min(runId) | **MAY remain at-least-once** |
| `fenced-effects` | Converge under lex-min(runId) | Every effect fenced or provider-idempotent |

Hosts advertising `reconciled-records` or `fenced-effects` **MUST** emit
`openwop.idempotency.cross_region_conflicts_total`.

> **`best-effort` and `strict` were removed (RFC 0150 §D, safety-fix).** `best-effort` is
> renamed `reconciled-records`, which states the effect caveat the old name concealed — it
> always meant *records* converge, and a reader could be forgiven for hearing a best effort
> at not duplicating effects. `strict` is removed outright rather than renamed: it promised
> only that read-visibility was bounded by `multiRegion.replicationLagBoundMs`, which is a
> **latency** claim that happened to occupy the top slot of a ladder implementers read as
> effect safety. A host replicating synchronously at 0 ms can still issue duplicate effects
> from two regions, because knowing what the other region wrote is not the same as being
> authorized to act. Renaming it to `fenced-effects` would have promoted every existing
> `strict` advertisement into a claim no host has substantiated. Its latency content is not
> lost — `multiRegion.replicationLagBoundMs` already carries it, and always did.

### Operator surface

Hosts SHOULD expose:

- `openwop.idempotency.cross_region_conflicts_total` — counter, labeled by `(tenant, route, region_pair)`.
- `openwop.idempotency.partition_seconds` — gauge of estimated cache divergence in seconds.

### Why records converge but effects may not

Bounding cross-region replication requires synchronous replication on every request, which
adds inter-region RTT to every mutation. The annex chooses availability plus observable
convergence over synchronous consistency, and `reconciled-records` is the honest name for
that trade: the records converge, and the effects issued while the partition was open did
not un-issue themselves.

Paying the replication cost does **not** buy effect safety on its own — that is what the
removal of `strict` records. Effect safety costs a *different* thing: a linearizable
ownership service on the path of every effect, or a provider that suppresses duplicates.
Hosts that need it advertise `fenced-effects` and pay for a fencing check per effect. The
default posture remains `reconciled-records`.

### Capability advertisement

The `crossRegion` value is one of `single-region`, `reconciled-records`, or `fenced-effects`
(§"Recovery postures"):

```json
{
  "idempotency": {
    "supported": true,
    "layer1RetentionSeconds": 86400,
    "layer2RetentionSeconds": 1209600,
    "crossRegion": "reconciled-records",
    "multiRegion": {
      "supported": true,
      "replicationLagBoundMs": 5000,
      "partitionRecoveryStrategy": "lexicographic-min-run-id"
    }
  }
}
```

Clients SHOULD inspect `capabilities.idempotency.crossRegion` before relying on multi-region guarantees. A client that requires exactly-once external effects **MUST** check for `fenced-effects` specifically; `reconciled-records` does not provide it.

### `multiRegion` sub-block (RFC 0036, normative when `multiRegion.supported: true`)

Per [RFC 0036](../../RFCS/0036-multi-region-and-cross-engine-guarantees.md) (`Active` 2026-05-21), revised by RFC 0150 §D. The `multiRegion` sub-block is a **granular advertisement** that complements the categorical `crossRegion` claim. A host that advertises `crossRegion: "fenced-effects"` SHOULD also advertise `multiRegion.supported: true`. A host that advertises `crossRegion: "reconciled-records"` MAY advertise `multiRegion.supported: true` with a non-zero bound.

`replicationLagBoundMs` is a **record read-visibility** bound and nothing more. It is not an
input to the effect-safety posture: a `0` bound does not make a host `fenced-effects`, and a
non-zero bound does not prevent one. This is the separation that removing `strict` restored —
the two used to be conflated in a single enum value.

When `multiRegion.supported: true`:

- An Idempotency-Key write succeeding in region A MUST be read-visible in region B after waiting `replicationLagBoundMs + safetyMargin`.
- After a partition healed leaves two regions with conflicting idempotency-key records for the same key, the host MUST resolve the conflict deterministically using the advertised `partitionRecoveryStrategy`. The resolution rule MUST be observable: re-running the same conflict input MUST produce the same survivor. A **time-ordered** rule cannot satisfy this — under a partition there is no shared clock, so each region believes it wrote last — which is why `last-writer-wins` and `first-writer-wins` were removed from the vocabulary rather than only the first of the pair.
- Resolving a record **MUST NOT** be treated as authorizing an effect (§"Reconciliation does not authorize effects").
- Conformance asserts both contracts via `multi-region-idempotency.test.ts` against the host's multi-region test simulator (per RFC 0036 §C).

Hosts that do NOT advertise the `multiRegion` block retain the existing best-effort posture documented above.

## Open spec gaps

> **Absorbed into `spec/v1/gaps.json` (RFC 0174 §E.3, 2026-09-03).** The 5 row(s) this table carried are now `openwop.gap.spec.idempotency.<local>` entries with a disposition and a witness class, one namespace with every RFC register (RFC 0166 §B). The table is retired; do not add rows here.

## References

- `auth.md` — auth model
- `rest-endpoints.md` — endpoint catalog (`Idempotency-Key` applies to every mutating endpoint)
- Host implementation notes: Layer 1 belongs at the HTTP/request-store boundary; Layer 2 belongs inside the engine's side-effect wrapper before any external provider call.
