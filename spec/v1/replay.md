# OpenWOP Spec v1 — Replay and Time-Travel Debugging

> **Status: Stable · v1.2 (2026-08-08).** Comprehensive coverage of `POST /v1/runs/{runId}:fork` for replay and branch-from-past, determinism guarantees, idempotency requirements on side-effecting nodes, side-effect suppression in replay (RFC 0140), and the admin Run Timeline View. Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.
>
> **Correction (2026-08-08), superseding the note this line carried earlier today.** RFC 0140 originally removed "idempotency requirements on side-effecting nodes" from the status line above, on the grounds that no such section existed. **That was wrong** — §"Determinism guarantees" caveat 1 has always carried it, as an unconditional MUST. The claim was true; deleting it was the regression, and it is restored. What v1 actually lacked is narrower and is what RFC 0140 supplies: caveat 1 names the Layer-2 invocation log as the mechanism, and that mechanism **cannot** span a fork (its key includes `runId`, which a fork changes), so the requirement was real, its named mechanism unworkable across a fork, and its conformance coverage nil.

---

## Why this exists

The durable event log makes time-travel debugging nearly free: every meaningful state transition is persisted with a sequence number, so the run state at any point in history can be reconstructed deterministically by folding events up to that sequence.

Without a replay surface, this potential is wasted. Operators and developers who hit a workflow bug currently have to:

- Read raw event docs from the backing event store.
- Mentally fold the events to reconstruct state.
- Make a hypothesis about what fix would change behavior.
- Modify the live workflow definition.
- Wait for new runs to confirm.

The cycle takes hours. openwop defines a `POST /v1/runs/{runId}:fork` endpoint that lets developers re-execute or branch from any historical sequence — debugging cycle drops to minutes.

The fork mechanism parallels [LangGraph's `update_state(checkpoint, ...)`](https://langchain-ai.github.io/langgraph/concepts/persistence/#update-state) and [`get_state_history`](https://langchain-ai.github.io/langgraph/concepts/persistence/#get-state-history) idioms — chosen for ecosystem familiarity.

---

## Two modes

### `replay`

Re-execute the workflow deterministically from event sequence `fromSeq`, using the _same_ events the original run produced. Used to validate that current code reproduces the original behavior.

- The new run consumes events from the source run for sequences `< fromSeq` (treats them as fixed history).
- For sequences `>= fromSeq`, the new run executes against the _current_ code path, persisting NEW events.
- If the new events match the original sequence-by-sequence, the replay is deterministic.
- If they diverge, the divergence point pinpoints the regression.

### `branch`

Re-execute starting at the _projected state_ at `fromSeq`, but with new caller-supplied inputs / `configurable` overrides. Used for "what-if" debugging: "what would have happened if we'd approved instead of rejected at step N?"

- The projected state at `fromSeq` becomes the initial state of the branched run.
- Caller supplies new `RunOptions` to overlay.
- The branched run is a fully independent run (new `runId`, new event subcollection).
- The original run is unmodified.

---

## Endpoint

```http
POST /v1/runs/{runId}:fork
Authorization: Bearer <api-key with runs:create scope>
Idempotency-Key: <UUID>  (RECOMMENDED)
```

Body:

```json
{
  "fromSeq": 42,
  "mode": "replay" | "branch",
  "runOptionsOverlay": {
    "configurable": { "model": "claude-haiku-4-5" },
    "tags": ["fork:debugging-issue-2456"]
  }
}
```

| Field               | Type                                | Required for | Notes                                                                                                                                                                         |
| ------------------- | ----------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fromSeq`           | `number`                            | branch only  | Inclusive — events `< fromSeq` are fixed history; `>= fromSeq` are re-executed. `0` = full re-execution from start. Optional for `replay` — see "Replay-mode defaults" below. |
| `mode`              | `'replay' \| 'branch'`              | both         | Determines re-execution semantics (above).                                                                                                                                    |
| `runOptionsOverlay` | `RunOptions` (see `run-options.md`) | branch only  | MUST be omitted or empty for `replay` (replay must be deterministic — overlays would break that).                                                                             |

#### Replay-mode defaults

For `mode: "replay"`, `fromSeq` is optional and defaults to `0` — a minimal `{"mode": "replay"}` request body is a valid full-replay probe. The default matches the natural "re-execute everything" semantic and lets conformance probes test replay support without inspecting the source run's event log first.

For `mode: "branch"`, `fromSeq` MUST be supplied — the branch point has no natural default (a branch from sequence 0 is indistinguishable from creating a fresh run, so requiring an explicit value catches caller bugs).

### Response

```json
{
  "runId": "run_xyz789",
  "sourceRunId": "run_abc123",
  "fromSeq": 42,
  "mode": "branch",
  "status": "pending",
  "eventsUrl": "/v1/runs/run_xyz789/events"
}
```

Status codes:

- `201 Created` — fork accepted, new run started
- `400 Bad Request` — invalid `fromSeq` (out of range), `replay` with non-empty `runOptionsOverlay`, etc.
- `404 Not Found` — source `runId` doesn't exist or caller can't see it
- `409 Conflict` — only when `Idempotency-Key` is provided and the request is a duplicate of an in-flight fork
- `422 Unprocessable Entity` — `fromSeq` references a sequence number that doesn't exist in the source run's event log
- Higher codes per standard error response shape (`auth.md`, `idempotency.md`)

---

## Determinism guarantees

### `replay` mode

An OpenWOP-compliant server MUST guarantee determinism of replay subject to the following caveats:

1. **Side-effecting nodes** — every NodeModule that calls an external API (LLM, payment, message) MUST consult the durable invocation log (see `idempotency.md` §"Layer 2: Activity-level idempotency"). On replay, the cached response is returned — the external system is NOT called twice.
2. **`ctx.interrupt(payload)`** — every interrupt with key `K` short-circuits to the persisted `interrupt.resolved` value. The external system is NOT prompted again.
3. **`ctx.getVersion(changeId, min, max)`** — pinned values from the original run are preserved (events `< fromSeq` are fixed history). The branch the original run took is the branch the replay takes.
4. **Time-dependent code** — if a NodeModule reads `Date.now()` directly (not via the engine's logical clock), replay is non-deterministic. NodeModules MUST consume time via `ctx.now()` if available, or accept non-determinism.
5. **Recorded-fact events** — events whose payload records a write that already happened, such as `memory.written` (RFC 0057), are fixed history. On replay against a checkpoint a host MUST re-emit them from the event log and MUST NOT regenerate their identifiers or timestamps (e.g. MUST NOT mint a new `memoryId`). Because such payloads are content-free, they introduce no non-deterministic body to diverge on.

### `branch` mode

`branch` mode is NOT deterministic by design — the caller is changing inputs/config. Determinism guarantees apply only to the events `< fromSeq` that are inherited as fixed history.

> **Caution — a branch re-fires external effects.** §"Side-effect suppression in replay" is scoped to `mode: "replay"` only. A `branch` fork re-executes side-effecting nodes live for sequences `>= fromSeq`, so branching past an already-executed payment or notification will perform it again. This is by design — a branch is a new execution with caller-supplied inputs, so its effects are effects the operator asked for — but it is easy to miss, and a host advertising `sideEffectSuppression: "recorded-outcome"` makes no claim about it. A host SHOULD surface this in any operator-facing fork UI.

### Failure surfaces

If a `replay` mode fork diverges from the original (a node produces a different event than the original at the same sequence), the engine MUST:

1. Continue execution.
2. Emit a `replay.diverged` event with `{ originalEventId, replayEventId, divergencePoint }`.
3. Surface this event in `debug` stream mode and via OTel span attribute `openwop.replay.diverged: true`.

The replayed run continues to completion or further divergence; the `replay.diverged` event is informational, not blocking.

---

## LLM cache-key recipe

Replay determinism for LLM-calling nodes depends on hosts agreeing on the _cache key_ under which a provider response is deduped. Without a canonical recipe, two hosts replaying the same workflow against the same provider can compute different keys, miss the dedup, and call the provider twice.

This section defines the **canonical cache key** that an OpenWOP-compliant host MUST compute for any node that calls an LLM provider through the Layer-2 idempotency surface (`idempotency.md` §"Layer 2: Activity-level idempotency").

### §A Domain

The cache key is computed at invocation time over a closed set of fields. Hosts MUST NOT include host-specific metadata, request IDs, timestamps, or trace headers in the key.

```typescript
interface LLMCacheKeyInput {
  provider: string;          // canonical provider id, lowercase ASCII (e.g. "anthropic", "openai", "google")
  model: string;             // provider-stamped model id as the model expects it (no normalization)
  messages: ReadonlyArray<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{ type: string; [k: string]: unknown }>;
    name?: string;
    toolCallId?: string;
  }>;
  tools?: ReadonlyArray<{
    name: string;
    description?: string;
    parameters: Record<string, unknown>;  // JSON Schema fragment
  }>;
  temperature?: number;
  topP?: number;
  topK?: number;
  responseFormat?: { type: 'text' | 'json' | 'tool_call'; schema?: Record<string, unknown> };

  // ── Added by RFC 0150 §C (recipe v2) ──────────────────────────────────────
  maxOutputTokens?: number;  // decides whether the response is truncated
  stop?: readonly string[];  // decides where generation halts
  seed?: number;             // its entire purpose is to change the output
  safetySettings?: Record<string, unknown>;   // any policy that can alter output
  providerOptions?: Record<string, unknown>;  // closed, namespaced; see §B
}
```

The canonical object is stamped `recipe: "openwop-semantic-request-v2"`, so a digest computed under the retired v1 rules is **distinguishable** rather than silently comparable.

**Transport-only fields MUST NOT influence the digest:** timeout, trace context, request and correlation IDs, retry counters, credential handles, tenant id, run id, and host metadata. The test is whether the field can change what the model returns — not whether it appears in the HTTP request.

> **v1 excluded `max_tokens`, `stop`, and `seed`, and that was the defect (RFC 0150 §C).**
> This section previously read: *"Fields NOT in this set MUST NOT influence the cache key —
> including but not limited to: `max_tokens`, `stop`, `stream`, `metadata`, `user`, `seed`…"*
> Every one of those three **changes the completion**. Two requests differing only in `stop`
> produce different text; `seed` exists to change output; the output bound decides whether a
> response is truncated. Keying them identically does not cause a cache *miss* — it causes a
> **wrong hit**, returning a response the caller never asked for, and doing so deterministically
> rather than intermittently. `stream`, `metadata`, and `user` remain excluded because they are
> transport or bookkeeping and cannot alter the completion.

### §B Computation

Hosts MUST compute the cache key as follows:

1. **Build a canonical object** with the fields above, applying these normalization rules:
   - Omit `tools`, `temperature`, `topP`, `topK`, `responseFormat` when absent (do NOT emit `null` / default placeholders).
   - Sort `tools[]` by `name` ascending.
   - For each tool, sort `parameters.properties` keys ascending recursively (RFC 8785 JCS over the tool definition).
   - Preserve `messages[]` order — order is semantically significant and MUST NOT be reordered.
   - Preserve `messages[i].content` shape verbatim (string or array of content blocks) without coalescing.
   - Place any provider option not named above into a closed, namespaced `providerOptions` object (`vendor.<provider>.<option>`) **before** hashing. **Silently dropping an unknown option is nonconformant** — a dropped option that alters output is exactly the collision this recipe exists to prevent, and dropping it is indistinguishable from the option never having been set.
2. **Canonicalize to bytes** via RFC 8785 JCS (JSON Canonicalization Scheme). Hosts without a JCS library MUST emit JSON with: object keys sorted lexicographically (recursively); no whitespace; no trailing commas; numbers serialized per IEEE 754 round-trip.

   **Implementations MUST NOT apply Unicode normalization outside JCS.** JCS does not perform NFC, so a fallback that adds it produces **different bytes for the same input** whenever a string is not already normalized — which breaks the cross-host portability §D asserts as a normative invariant.

   > **The two routes this step offered used to be mutually incompatible (RFC 0150 §C).** The no-JCS fallback prescribed Unicode NFC for every string, which JCS itself does not do — so a host with a JCS library and a host without one computed different digests for the same request whenever any string was not already normalized. Both were following the same sentence.
3. **Hash** the canonical bytes with SHA-256.
4. **Encode** as lowercase hex.

The resulting 64-character hex string is the **LLM cache key** for that invocation.

### §C Layering with idempotency.md

The LLM cache key is the _content-addressable_ identity of the provider request. It composes with `idempotency.md` Layer 2 as follows:

- The Layer-2 identity is `logicalInvocationId`, a domain-separated digest over `(tenantId, runId, nodeId, logicalInvocationOrdinal, providerKey)` per `idempotency.md` §"Idempotency key composition". It deliberately excludes the retry counter: the `attempt`-bearing composition this section used to quote was retired by RFC 0150 §B as a safety-fix, because a key that changes per retry cannot deduplicate the retry it exists for.
- The LLM cache key is computed in addition, and is the dedup key inside the Layer-2 store for provider-call nodes.
- A Layer-2 lookup that hits on `invocationId` returns the cached response unconditionally; the LLM cache key is the secondary lookup used when a fresh run computes the same provider request as a different (or no) prior run — enabling cross-run sharing of provider responses where the host opts in.

Hosts MUST NOT use the LLM cache key as a security boundary — two different tenants computing the same request will compute the same key. Tenant isolation MUST be enforced at the Layer-2 store level (per-tenant namespacing of the cache).

### §D Determinism property

Two OpenWOP-compliant hosts replaying the same workflow against the same provider request **MUST compute the same LLM cache key**. The recipe is a normative invariant for `replay` mode — divergent cache keys are reportable via the `replay.diverged` event when the cached response differs.

The conformance scenario `replay-llm-cache-key.test.ts` (shipped in conformance suite 1.3.0) exercises this property and backs the security invariant `replay-llm-cache-key-portable`.

### §E Migration

Hosts that have already shipped LLM-calling nodes with a non-canonical cache key MUST either:

1. Switch to the canonical recipe and accept a one-time cache invalidation; OR
2. Continue using their existing key alongside the canonical one for at least 90 days, then retire the legacy form. During the dual-write window, Layer-2 lookups check both keys.

The migration period is host-internal — no wire-shape impact.

---

## Replay determinism under nondeterministic models (RFC 0041 Phase 4, normative)

Per [RFC 0041](../../RFCS/0041-multi-agent-replay-under-nondeterminism.md). Applies only when the host advertises `capabilities.multiAgent.executionModel.version >= 4` AND `capabilities.multiAgent.executionModel.replayDeterminism.supported: true`.

### §A — LLM cache-key recipe: unconditional MUST + observable commitment

The §"LLM cache-key recipe" §A + §B above already establishes a CONDITIONAL MUST: per the intro to that section, hosts MUST compute the cache key per the recipe **for any node that calls an LLM provider through the Layer-2 idempotency surface** (`idempotency.md` §"Layer 2: Activity-level idempotency"). Phase 4 strengthens this in two ways:

1. **Unconditional MUST.** Phase 4 hosts MUST follow the recipe for ALL LLM-calling nodes regardless of whether they use Layer-2 idempotency. The "for Layer-2 idempotency only" conditional in the original §"LLM cache-key recipe" intro does NOT apply when `multiAgent.executionModel.version >= 4`.
2. **Observable commitment.** Phase 4 hosts MUST advertise the recipe they honor via `capabilities.multiAgent.executionModel.replayDeterminism.llmCacheKeyRecipe`. The value `spec-rfc-0041` claims the canonical recipe; vendor recipes use the canonical host-extension namespace `x-host-<host>-<recipe-name>` per `host-extensions.md` §"Canonical prefixes". The advertisement lets cross-host replay rely on byte-identical keys without trial computation.

Closes RFC 0037 §"Open spec gaps" MAE-7.

### §B — Envelope-refusal recovery in replay (MAE-8 closure)

When `mode: replay`, if the original run obtained a valid LLM envelope (e.g., a tool-call decision or structured output) but the replay obtains a refusal (or vice-versa — original refused, replay succeeded), the host MUST NOT silently substitute. Both directions of divergence MUST be observable.

Phase 4 hosts MUST:

1. Emit a `replay.divergedAtRefusal` event (NEW RunEventType per `schemas/run-event.schema.json`) with payload identifying the diverging node, the original-envelope nature (`valid` or `refusal`), and the replay-envelope nature.
2. Fail the replay with `error.code: "replay_diverged_at_refusal"` (NEW error code per `spec/v1/rest-endpoints.md` §"Common error codes").

The `replay.divergedAtRefusal` event MAY be a sibling of the existing `replay.diverged` event (which covers structural divergence — `output` / `missing` / `extra` / `type-mismatch`). When a refusal-divergence is detected, hosts MUST emit `replay.divergedAtRefusal` rather than coercing the signal into `replay.diverged` with `divergenceKind: "output"`. The distinct event type lets operators audit safety-policy shifts without filtering through the generic divergence stream.

Operators receiving `replay_diverged_at_refusal` SHOULD treat it as a safety-policy-shift signal: the underlying model's refusal behavior has changed since the original run, and any branch-mode workflow that depends on the original envelope's content needs re-validation.

### §C — Observable-output-sequence determinism vs bit-equivalent execution (MAE-9 closure)

The replay contract is **observable-output-sequence determinism**, NOT bit-equivalent execution. Specifically:

1. The sequence of `RunEventDoc` records appended to the event log at indices `[0, fromSeq]` MUST be byte-equivalent between original and replay (modulo per-region clock fields per RFC 0036 §E and per-event ULID component-T entropy when ULIDs are minted fresh).
2. `RunSnapshot.variables`, `RunSnapshot.channels`, and `RunSnapshot.status` at each event-log index MUST be byte-equivalent across original and replay.
3. The bytes-on-the-wire of underlying tool/LLM calls MAY differ — e.g., a tool call against a remote stateful API, an LLM call against a model whose weights shifted, a randomized fallback path — AS LONG AS the resulting **observable state** at each index is byte-equivalent.

The load-bearing implication: hosts MUST NOT cache observable state ONLY at the tool-call boundary. They MUST cache the **observable result** (return value + side-effects on workflow state + emitted events) so a replay reproduces the observable sequence even when the underlying call would have produced different bytes. The cache key for LLM-calling nodes is the §"LLM cache-key recipe" §B SHA-256 hash; for other tool-calling nodes the cache key is at host discretion BUT MUST be content-addressable (no host-internal sequence numbers or timestamps).

This rules out bit-equivalent execution determinism as a contract — it would require every nondeterministic call to be cached forever (unbounded memory cost) and would break legitimate use cases like tool calls against remote stateful APIs (`getCurrentTime`, `lookupExternalRecord`).

### Conformance gating

Scenarios verifying §A + §B + §C gate on `capabilities.multiAgent.executionModel.version >= 4 && capabilities.multiAgent.executionModel.replayDeterminism.supported: true`. Hosts at earlier versions skip cleanly.

---

## Side-effect suppression in replay (RFC 0140, normative)

> **Correction (2026-08-08).** This section originally opened by claiming v1
> placed no constraint on a replay's external effects. **That was false.**
> §"Determinism guarantees" caveat 1 has always required, unconditionally, that
> a node calling an external API consult the durable invocation log so "the
> external system is NOT called twice." The requirement predates RFC 0140 and is
> **not relaxed by it**. What follows refines *how* a host demonstrates
> compliance; it does not create the obligation, and a host that advertises
> nothing is still bound by caveat 1.

Caveat 1 states the obligation. The difficulty is that it names a mechanism —
the Layer-2 invocation log — that **cannot deliver it across a fork**.

**Why the named mechanism cannot span a fork.** `idempotency.md`
§"Layer 2" derives the engine dedup key from `(runId, nodeId, attempt,
providerKey)`, and §"Response" above specifies that a fork returns a **new
`runId`**. Every Layer-2 key computed during a replay therefore differs from its
counterpart in the source run, so the Layer-2 cache — correct as it is for
retries *within* a run — never collides across a fork. Suppression is a separate
mechanism.

Hosts advertise it via `replay.sideEffectSuppression` (`capabilities.md`):

`replay.sideEffectSuppression` is an **assurance advertisement** — a declared,
probeable mechanism — **not** permission to re-fire:

| Value | Meaning |
| --- | --- |
| `recorded-outcome` | The host declares the mechanism below: a side-effecting node does not execute during a replay; the host reproduces the source run's recorded outcome for the same `(nodeId, attempt)` or fails the node closed. Probeable by conformance. |
| `none` (default; **absent means this**) | **No mechanism is declared.** The host remains bound by §"Determinism guarantees" caveat 1 exactly as before; conformance simply has nothing to probe and soft-skips. This is NOT a licence to re-fire effects. |

A host MUST NOT read `none` as permission to call the external system twice.
Caveat 1 is unconditional and this capability does not gate it.

### Requirements when a host declares `sideEffectSuppression: "recorded-outcome"`

For a fork with `mode: "replay"`:

1. A node that performs an **external side effect** — any operation observable
   outside the run's own event log (an outbound network call, a message or
   notification delivered to a person, a payment, a write to a third-party
   system) — MUST NOT perform that effect.
2. The host MUST resolve such a node's outcome from the source run's recorded
   terminal outcome for the same `(nodeId, attempt)`. The Nth attempt of a node
   in the replay resolves to the Nth recorded outcome in the source. The lookup
   is keyed on `(sourceRunId, nodeId, attempt)` — **never** on the fork's own
   `runId`, which is exactly why Layer 2 cannot serve it. §"Replay-from-event-log
   internals" item 4 states the same keying from the implementation side; the two
   are one requirement described at two levels, not two mechanisms.
3. If the source run has no recorded outcome for that `(nodeId, attempt)`, the
   host MUST fail the node closed with `error.code: "replay_source_missing"`
   (below). It MUST NOT perform the effect, and MUST NOT substitute a
   synthesized or empty success.
4. The guarantee is **whole-run**. A host MUST NOT advertise `recorded-outcome`
   if any class of side-effecting node in its catalogue can still fire during a
   replay. A partial guarantee is not a weaker promise but an incorrect one: a
   node that fires live derives its outcome from a fresh external call, and that
   outcome flows into `RunSnapshot.variables`, violating §C.2's requirement that
   observable state be byte-equivalent at each event-log index.
5. **The whole-run guarantee requires two mechanisms, not one.** A host MUST NOT
   advertise `recorded-outcome` unless **both** hold:
   - **(a) Classification** short-circuits known side-effecting nodes *before*
     they execute, per requirement 2. This keeps a replay **correct** — it
     reproduces the right observable output.
   - **(b) A default-deny guard at every host effect seam** fails the node
     closed per requirement 3 when a node reaches an effect seam during a
     replay. This keeps a replay **safe**.

   (a) alone MUST NOT be advertised as `recorded-outcome`. Classification is a
   moving target — a retargeted node type, a pack node that cannot self-declare,
   or a newly-added integration silently leaves the classified set — and the
   failure is invisible: the replay looks green and the effect fires. The seam
   guard is what makes the claim whole-run without requiring a host to enumerate
   every effect in its catalogue, and it converts a silent correctness loss into
   a visible `replay_source_missing`. Because pure nodes never reach an effect
   seam, (b) does not disturb the live-re-execution rule below.
6. **Cross-host dispatch needs no separate rule.** A dispatch to a peer host
   (RFC 0007) is an outbound network call, hence an external side effect under
   requirement 1. During a replay the dispatching node therefore reproduces its
   recorded outcome under requirement 2 and **never contacts the peer at all**,
   so the peer's own advertisement does not affect the calling host's guarantee.
   A calling host does not need to interrogate a peer's `sideEffectSuppression`
   before replaying a run that dispatched to it.

Nodes that are **not** side-effecting — pure computation, and LLM calls served
from the Layer-2 invocation log per §"LLM cache-key recipe" — MUST continue to
re-execute live. This is required, not merely permitted: §"Two modes" defines
`replay` as re-execution against current code with `replay.diverged` on
mismatch, so short-circuiting pure nodes would make divergence detection
vacuously green.

### `replay_source_missing` (normative)

A node failed under requirement 3 MUST carry `error.code:
"replay_source_missing"` in its `node.failed` payload. This is a node-failure
code in the run event log, not an HTTP error-envelope code — the fork request
itself still returns `201`.

```json
{ "type": "node.failed", "nodeId": "send-invoice",
  "payload": { "error": { "code": "replay_source_missing",
    "message": "the source run has no recorded outcome for this node" } } }
```

A node **with** a recorded source outcome instead reaches `node.completed`
carrying that outcome's outputs, and no outbound call occurs.

### Scope: `replay` mode only

These requirements do not constrain `mode: "branch"`. A branch is a new
execution with caller-supplied inputs exploring a real alternative, so its
effects are effects the operator asked for; a replay re-executes fixed history,
so its effects are duplicates by definition. A host MAY suppress branch effects
too, but MUST NOT report that as `sideEffectSuppression`.


## Replay-from-event-log internals

An engine implementation typically reuses its existing run-recovery machinery (a non-normative example: the reference host's `recoverRunFromEventLog(runId)` helper), built on the `RunEventLogIO` storage-adapter contract (see `storage-adapters.md`):

1. `RunEventLogIO.read(sourceRunId, { fromSequence: 0, limit: fromSeq })` — load events `< fromSeq`.
2. `fold(events) → ProjectedRunState` — derive initial state.
3. New run is initialized with that state, copy-on-write into the new run's event log.
4. For `replay`, side-effecting nodes are resolved from the **source** run's recorded outcomes per §"Side-effect suppression in replay" — keyed on `(sourceRunId, nodeId, attempt)`, never on the fork's own `runId`. LLM invocations additionally consult the durable invocation log via the content-addressed key in §"LLM cache-key recipe" §C. (This item previously cited `idempotency.md` §"Layer 2" as the basis; that mechanism cannot span a fork — see the §"Side-effect suppression in replay" preamble — though the `(sourceRunId, …)` keying it described was already correct.)
5. For `branch`, executor invocations create new invocation log entries keyed on `(newRunId, ...)`.

---

## Run Timeline View (admin panel)

An OpenWOP-compliant server SHOULD expose an admin Run Timeline View that renders `runs/{runId}/events/{eventId}` as a per-node timeline with:

- Event payload inspection (collapsible JSON tree)
- Side-by-side state diffs at each event
- Jump-to-replay-from-here shortcut for any event
- Filter by event type / node / kind

This is the in-app equivalent of LangSmith's run inspection view; building it in-tree avoids vendor + PII-export costs and tailors to the implementation's specific event types and approval-gate semantics.

The Timeline View is OPTIONAL for spec compliance. If implemented, it MUST surface the replay endpoint via deep links.

---

## Use cases

1. **Reproduce a production bug** — replay the failing run; if it fails the same way, the bug is deterministic and a fix can be tested via branch mode.
2. **Validate a refactor** — replay multiple successful runs across the changed code path; if any diverge, investigate.
3. **Test an alternative approval decision** — branch from the approval point with the opposite action.
4. **A/B test prompt variants** — branch with different `configurable.promptOverrides`.
5. **Conformance testing** — black-box test suite branches a known fixture run from various points and asserts expected outputs.

---

## Retention and garbage collection

Replay depends on the source run's event log and, for deterministic `replay` mode, any side-effect invocation records referenced by that log. A host that advertises replay support MUST document retention for:

- Source run snapshots.
- Source run event logs.
- Invocation logs or provider-response caches used for deterministic replay.
- Forked runs created in `replay` or `branch` mode.

If the source run still exists but the event range needed for `fromSeq` has expired, the host MUST reject the fork with `410 Gone` or `422 Unprocessable Entity` using the canonical error envelope. The error `details` SHOULD include `sourceRunId`, `fromSeq`, and the retention boundary when known.

Forked runs MAY have a shorter retention period than ordinary production runs when tagged for debugging, but the host MUST make that policy visible in documentation or debug-bundle metadata.

---

## Privacy and replay

Replay can re-surface data that was present in the original run: prompts, model responses, tool outputs, approval comments, and cached provider responses. Hosts MUST apply the same redaction rules to replayed events, debug bundles, OTel spans, and logs that they apply to original execution.

If a host supports deletion or redaction requests for sensitive data, it MUST define how those requests affect replay:

- If deleted data is required for deterministic replay, the host MUST fail `replay` mode with a canonical error rather than re-exposing deleted material.
- `branch` mode MAY proceed from a redacted projection if the host can construct one safely.
- A replayed run MUST NOT bypass tenant, user, or scope checks that would apply to reading the source run.

Hosts SHOULD record an audit event when a replay or branch is created from a run that contains sensitive or redacted fields.

---

## Determinism scoring

Hosts MAY report a determinism score for replay validation runs. The score is advisory; it does not alter the fork endpoint contract.

A determinism report SHOULD include:

| Field                | Meaning                                            |
| -------------------- | -------------------------------------------------- |
| `sourceRunId`        | Original run used as the baseline.                 |
| `replayRunId`        | New run created in `replay` mode.                  |
| `fromSeq`            | Sequence where replay began.                       |
| `matchedEvents`      | Count of comparable events that matched.           |
| `comparedEvents`     | Count of comparable events considered.             |
| `firstDivergenceSeq` | First divergent sequence, if any.                  |
| `score`              | `matchedEvents / comparedEvents`, from `0` to `1`. |

The conformance suite should treat exact fixture replay as a pass/fail assertion and use scoring only for richer host diagnostics.

---

## Cross-region replay (RFC 0036)

Per [RFC 0036](../../RFCS/0036-multi-region-and-cross-engine-guarantees.md) (`Active` 2026-05-21).

When BOTH `capabilities.idempotency.multiRegion.supported: true` AND `capabilities.eventLog.crossEngineOrdering.supported: true`, a `POST /v1/runs/{runId}:fork` invocation served by a different region than the original run MUST produce a fork whose **observable state at the `fromSeq` boundary** matches a fork served by the original region.

Specifically, the fork's `RunSnapshot.status`, `RunSnapshot.variables`, and the projected event log up to `fromSeq` MUST be byte-equivalent across regions. Per-region wall-clock fields in subsequent events MAY differ (e.g., timestamps embedded in `RunEventDoc.observedAt`, ULID component-T entropy in newly-generated event IDs); a bit-equivalent total comparison is NOT required and is not implementable in the presence of per-region clocks.

Hosts that advertise one of the two capabilities but not the other retain the existing single-region replay contract per `## Determinism scoring` above. Hosts that advertise neither are silently single-region; the cross-region claim does not apply.

---

## Annotations and fork (RFC 0056)

RFC 0056 annotations are a per-run side-resource, **not** event-log entries — so they sit entirely outside the fork/replay model. A fork inherits **zero** annotations (it is a new run with no human judgments yet) and MAY carry a back-reference to the source. `run.annotated` is a live SSE notification, never a persisted/replayed event. This is deliberate: a replayable annotation event would be copied into forks (which replay source events `< fromSeq`), contradicting its side-resource semantics. See [`RFCS/0056`](../../RFCS/0056-run-feedback-and-annotation-event.md) §D.

## Open spec gaps

| #   | Gap                                                                                         | Owner       |
| --- | ------------------------------------------------------------------------------------------- | ----------- |
| RP1 | Bulk fork API — fork many runs at once for batch validation                                 | future      |
| RP2 | Branch-with-edited-event API — modify a specific event in-place rather than overlay options | future v1.x |
| RP3 | ✅ Closed by §"Determinism scoring" for advisory replay reports.                            | v1.x annex  |
| RP4 | ✅ Closed by §"Retention and garbage collection".                                           | v1.x annex  |
| RP5 | ✅ Closed by §"Privacy and replay".                                                         | v1.x annex  |

## References

- `auth.md` — auth model + scope vocabulary (`runs:create`)
- `rest-endpoints.md` — `POST /v1/runs/{runId}:fork` endpoint
- `version-negotiation.md` — event log structure + per-event schema versioning
- `idempotency.md` — Layer 2 invocation log (the determinism backbone for replay)
- `interrupt.md` — interrupt replay semantics
- `run-options.md` — `runOptionsOverlay` shape
- `observability.md` — `openwop.replay.{source_run_id, from_seq, mode}` attributes + OTel `Link` from the forked `openwop.run` span to the source's. See observability.md §Replay / branch attributes (closes O3).
- `stream-modes.md` — `replay.diverged` event in `debug` mode
- LangGraph state history: <https://langchain-ai.github.io/langgraph/concepts/persistence/#get-state-history>
- Host implementation notes: replay typically needs an event-log range query primitive plus a recovery path that can rebuild run state from persisted events.
