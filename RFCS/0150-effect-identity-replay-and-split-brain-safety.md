# RFC 0150: Effect Identity, Replay, and Split-Brain Safety

| Field | Value |
| --- | --- |
| **RFC** | 0150 |
| **Title** | Effect Identity, Replay, and Split-Brain Safety |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** §A keyspace separation — a caller-controlled `Idempotency-Key` could name a host-internal lock; MUST NOT added with a tier-1 host's merged fix as witness (#950). §E v1 inventory: no host implements the Layer-2 recipe, so migration cost is zero (#947). §B logical effect identity v2 — `idempotency.md` v1.1 -> v1.2 retires the `attempt`-bearing composition as a safety-fix, with the `version-negotiation.md` migration runbook, invariant `logical-effect-id-retry-stable`, and `effect-identity-composition.test.ts`; suite `1.77.0`. §D fenced multi-region ownership — `idempotency.md` v1.2 -> v1.3: the separation principle (reconciliation MAY select a record, MUST NOT authorize effects), the fencing-token requirement, `at-least-once-risk` classification, and the vocabulary safety-fix. **Two removals the section did not fully anticipate:** `crossRegion: "strict"` was a read-visibility LATENCY claim in an effect-safety slot, removed rather than renamed to `fenced-effects` so no existing advertisement is promoted into an unsubstantiated claim; and `partitionRecoveryStrategy`'s time-ordered rules violate the annex's own reproducible-survivor MUST, so `first-writer-wins` went with the `last-writer-wins` this section names — removing one would have left the defect under a different label. Invariant `multi-region-stale-owner-no-effect`, `multi-region-effect-vocabulary.test.ts`, suite `1.78.0`. §C semantic request digest v2 — `replay.md` recipe v1 -> v2: the exclusion list forbade `max_tokens`/`stop`/`seed`, which change the completion (a wrong hit, not a miss); the no-JCS fallback prescribed NFC that JCS does not perform, so the two routes disagreed on bytes; and the section still quoted the `attempt`-bearing Layer-2 formula §B retired. Recipe stamped `openwop-semantic-request-v2`; unknown provider options carried in `providerOptions`. Suite `1.85.0`. **Carried forward, not closed:** the cross-language golden vectors for §B/§C, which live in `openwop-sdks`. **These remain wire changes**: `COMPATIBILITY.md` §3 governs landing them, and that is an implementation gate, not a status one. §B cross-scope identity — `idempotency.md` v1.3 -> v1.4: the identity is run-scoped, so an effect also reachable outside any run MUST additionally key on a business identity; a host following §B literally would otherwise reintroduce the duplicate effect it exists to prevent. Reported by a tier-1 host from a shipped node pack; closes G7 as a scope question rather than either reading it posed. Suite `1.82.0`. Gaps G2/G3/G4/G5/G6/G8 open; G9/G10 opened for §B's and §D's witness tiers; G7 closed.) |
| **Affects** | `spec/v1/{idempotency,replay,version-negotiation,observability}.md`, capability and event schemas, conformance vectors, SDK helpers, RFCs 0036/0041/0140 |
| **Compatibility** | `safety-fix` per `COMPATIBILITY.md` §3 |
| **Supersedes** | Retry-attempt-dependent activity identity, incomplete LLM cache recipe, and conflicting multi-region winner prose |
| **Superseded by** | — |

## Summary

This RFC separates stable logical effect identity from retry attempts, versions the replay semantic-request digest, and replaces conflicting split-brain winner rules with fenced effect ownership. It also pins Layer-1 idempotency to authenticated tenant and endpoint scope and defines recoverable pending claims. Existing histories retain their recipe version; hosts migrate through explicit dual-read/version-pinned handling rather than silently reinterpreting keys.

## Motivation

The current Layer-2 formula hashes `attempt`, so a retry receives a different invocation ID, while later prose requires an identical ID. The replay cache recipe excludes inputs such as `max_tokens`, `stop`, and `seed`, permitting semantically different requests to collide, and combines JCS with a fallback NFC rule JCS does not perform. Multi-region prose names both lexicographic-lowest and last-writer-wins recovery; cancellation cannot undo effects already committed by the loser.

## Proposal

### §A — Layer-1 scope and pending claims

The Layer-1 cache key **MUST** be `(authenticatedTenantId, canonicalEndpointId, callerIdempotencyKey)`. Tenant identity **MUST** come from authenticated context, never the body. A record **MUST** persist `requestDigest`, state (`pending|completed|retryable-failure|terminal-failure`), lease owner/expiry, and terminal response metadata. A crashed or expired pending owner **MAY** be reclaimed atomically. A different request digest under the same scoped key **MUST** fail with the canonical mismatch error and **MUST NOT** return a cached body.

A host **MUST NOT** store host-generated identifiers — internal locks, scheduler fire-once slots, or any key the host mints for itself — in the Layer-1 idempotency store. Caller-supplied and host-generated identifiers **MUST NOT** share a keyspace, whatever the caller's lane is keyed by.

**This does not follow from the tuple above, which is why it is stated separately.** The tuple constrains key *composition* and record *shape*; it does not make the store *exclusive*. A host can key its HTTP lane exactly as required and still keep daemon keys in the same table under a bare primary key, because those keys never entered the tuple's keyspace at all. Reported by a tier-1 host that had precisely this shape: because `Idempotency-Key` is caller-controlled and validated nowhere, any authenticated tenant could send `Idempotency-Key: schedule-fire:<jobId>:<slot>`, win the scheduler's row, and make a scheduled job **skip**. That is privilege escalation through an unvalidated header, not a storage-layout preference.

**The failure semantics make separation forced rather than tidy.** §A already requires the caller lane to distinguish `retryable-failure`, so a failed attempt releases and a retry may re-execute. A fire-once daemon slot needs the opposite: releasing it on failure lets another instance re-fire work the first may have half-performed. Two concepts with contradictory release rules cannot correctly share one table, so a host that merges them is wrong for a second, independent reason.

Key handling is already covered by §F — logs and spans **MUST NOT** expose caller keys and **MAY** expose truncated keyed hashes. That matters more than it looks here: the key is caller-controlled and routinely embeds customer identifiers, because clients derive it from their own domain objects. A per-boot-salted truncated digest is a conforming implementation of §F, and one is deployed.

### §B — Logical effect identity v2

```text
logicalInvocationId = base64url(sha256(
  "openwop:activity:v2\0" ||
  tenantId || "\0" || runId || "\0" || nodeId || "\0" ||
  logicalInvocationOrdinal || "\0" || providerKey
))
```

`logicalInvocationOrdinal` is assigned once when the logical activity is created and **MUST NOT** change across transport/provider retries. `attempt` is separate telemetry and **MUST NOT** participate in the v2 logical ID. Different logical invocations **MUST** use different ordinals even if their inputs match. Providers supporting an idempotency header **MUST** receive the stable logical ID or a documented deterministic derivative.

### §C — Semantic request digest v2

The replay digest **MUST** cover the complete semantic provider request after policy resolution: provider and model identity, messages/content parts, tools and tool-choice, response schema/format, temperature/top-p, maximum output bound, stop conditions, seed, safety/policy settings that can alter output, and all provider-specific outcome-affecting options. Transport-only fields such as timeout, trace ID, retry count, and credential handle are excluded.

Bytes are RFC 8785 JCS over the v2 object followed by SHA-256. Implementations **MUST NOT** add Unicode normalization outside JCS. Unknown provider options **MUST** be placed in a closed, namespaced `providerOptions` object before hashing; silently dropping them is nonconformant.

```json
{
  "recipe": "openwop-semantic-request-v2",
  "provider": "example",
  "model": "model-1",
  "request": { "messages": [], "maxOutputTokens": 256, "stop": ["END"], "seed": 7 },
  "providerOptions": { "vendor.example.reasoningEffort": "high" }
}
```

Changing `seed`, `stop`, output bound, tool schema, or provider option **MUST** change the digest.

### §D — Fenced multi-region effect ownership

Run-record reconciliation and permission to issue effects are separate. Lexicographic run-ID reconciliation **MAY** select a surviving record, but **MUST NOT** authorize effects.

A host claiming multi-region effect safety **MUST** obtain a monotonically increasing fencing token from a linearizable ownership service before issuing an external effect. The effect adapter **MUST** reject a stale token or use the stable logical invocation ID at a provider that guarantees duplicate suppression. If neither property is available, the host **MUST NOT** claim strict multi-region effect safety and **MUST** classify the effect as `at-least-once-risk`.

The canonical recovery strategies are:

- `single-region` — no cross-region guarantee;
- `reconciled-records` — records converge but effects may remain at-least-once;
- `fenced-effects` — records converge and every effect is fenced or provider-idempotent.

`last-writer-wins` is removed from the normative strategy vocabulary through the safety-fix migration. Conflict events **MUST** record winner, loser, strategy, and opaque effect IDs without content.

### §E — Versioning and history

Runs **MUST** stamp `activityIdentityRecipe` and `semanticRequestRecipe`. Existing histories remain `v1`; readers **MUST NOT** recompute v1 IDs with v2 rules. A host MAY dual-read v1/v2 cache records during migration but **MUST** write v2 only after enabling the new recipe. Forks inherit source recipe stamps for recorded history and use the target host's selected recipe only for new branch effects.

### §F — Security and observability

Add invariants:

- `idempotency-key-tenant-endpoint-scoped`;
- `idempotency-store-no-host-generated-keys` — a caller-supplied `Idempotency-Key` **MUST NOT** be able to name, claim, or suppress a host-generated lock. **Witness is not black-box:** "shares no keyspace" is a storage-layout property no wire probe can see. The observable projection is that a caller-supplied key MUST NOT affect an operation the caller did not initiate, which needs a host-sample seam to exercise; absent one this lands reference-impl tier, and saying so is preferable to a scenario that passes without executing (RFC 0148 §A). Recorded as gap G8;
- `logical-effect-id-retry-stable`;
- `replay-semantic-digest-complete`; and
- `multi-region-stale-owner-no-effect`.

Keys/digests **MUST NOT** incorporate raw credentials. Logs and spans **MUST NOT** expose caller keys or request content; they MAY expose truncated keyed hashes. Metrics include conflict, reclaim, stale-fence rejection, and suppression counts with bounded attributes.

## Compatibility

This is a correctness safety-fix requiring a 90-day public window. New recipe stamps and capability values are additive; retiring contradictory v1 computation is the safety break. Migration tooling inventories persisted v1 records, adds stamps, tests dual-read, and refuses silent reinterpretation. Suite vectors cover legacy detection and v2 behavior. The CHANGELOG uses a correctness/security section and an advisory ID if security triage classifies cross-tenant or duplicate-effect impact as CVE-class.

## Conformance

New scenarios:

- `idempotency-tenant-endpoint-scope.test.ts`;
- `idempotency-pending-lease-recovery.test.ts`;
- `activity-id-retry-stability.test.ts`;
- `replay-semantic-request-digest-v2.test.ts` with cross-language fixtures;
- `replay-recipe-history-pinning.test.ts`;
- `multi-region-effect-ownership.test.ts`; and
- `multi-region-stale-fence-rejected.test.ts`.

Shape/digest vectors are always-on. Live pending recovery and multi-region behavior gate on their advertised profile, but an advertising host **MUST** execute them in strict certification. Reference hosts include SQLite scope tests and Postgres partition/fencing tests. `INTEROP-MATRIX.md` records recipe and recovery strategy.

## Alternatives considered

1. Keep `attempt` in the ID and retry with attempt zero. Rejected: it conflates two concepts and fails nested retries.
2. Hash only a portable provider subset. Rejected: omitted semantic inputs can replay the wrong result.
3. Resolve split brain by cancelling the loser. Rejected: cancellation does not undo committed effects.
4. Require distributed transactions with every provider. Rejected: unrealistic; fencing/provider idempotency plus compensation is composable.
5. Do nothing. Rejected: duplicates and incorrect replay are correctness failures.

## Unresolved questions

1. ~~Which deployed hosts persist v1 recipe keys and at what volume?~~ **Resolved 2026-08-12** (`docs/EFFECT-IDENTITY-V1-INVENTORY.md`): **none.** No host implements the Layer-2 recipe — the three reference hosts contain zero `invocationId` occurrences, and openwop-app references it only in a comment citing this spec. Migration cost is zero, which takes §E's dual-read machinery off the critical path *while that holds*; the moment any host implements Layer-2 as written it acquires the defect. The survey also found the one production provider-idempotency path (openwop-app → Stripe refunds) derives keys from stable business identifiers with **no `attempt` component** — it independently implements §B's principle, having had to, because following the spec would have produced duplicate refunds. That is adoption evidence for §B rather than argument (new gap G7).
2. What canonical endpoint identifier handles aliases and host-extension routes?
3. Which provider options are semantic versus transport-specific?
4. Is a linearizable fence mandatory for `fenced-effects`, or may a provider's strong idempotency contract independently qualify?
5. What retention period applies to migrated v1 cache records?

## Implementation notes (non-normative)

Publish cross-language golden vectors before host changes. Implement Layer-1 scope migrations before exposing new recipes. Compensation in RFC 0151 is defense for partial failure, not a substitute for duplicate prevention. This RFC is SR-3 under RFC 0147.

## Acceptance criteria

- [ ] Corrected normative formulas and recipe stamps merged. (§B effect identity and §D recovery vocabulary landed in `idempotency.md` v1.3. §C's semantic-digest recipe stamp is carried.)
- [ ] Cross-language v2 vectors pass in TypeScript, Python, and Go. (Vectors published as `conformance/vectors/semantic-request-digest-v2.json` — eleven cases including pairs that pin tool-order irrelevance, message-order significance, and the NFC non-normalization JCS requires. TypeScript passes. Carried: the Python and Go implementations, which live in `openwop-sdks` and consume this file rather than re-reading the prose.)
- [ ] Layer-1 scope and pending lease scenarios pass on SQLite and Postgres hosts. (Carried — §A's keyspace `MUST NOT` landed with a tier-1 host's merged fix as witness, but the pending-lease scenarios are unwritten and the reference hosts live in `openwop-examples`.)
- [ ] Partition tests prove stale owners cannot issue effects under `fenced-effects`. (Carried — gap register row for §D. The existing `simulate-partition` seam covers record convergence only; proving effect fencing needs an observable effect sink, which is itself the record-vs-effect conflation §D exists to end.)
- [ ] v1 inventory, migrator, dual-read tests, and version runbook published. (Inventory landed — `docs/EFFECT-IDENTITY-V1-INVENTORY.md`, and it found the migrator has nothing to operate on: zero hosts implement the v1 recipe. Runbook landed in `version-negotiation.md`. Dual-read tests are carried and currently untestable for the same reason the migrator is unneeded.)
- [ ] Threat models, invariants, OTel vocabulary, CHANGELOG, and interop matrix updated. (Invariants and CHANGELOG landed — three new invariants across §A/§B/§D. OTel vocabulary and interop matrix are carried.)

## References

- RFCs 0036, 0041, 0140, and 0147 Workstream 3
- `spec/v1/idempotency.md`
- `spec/v1/replay.md`
- RFC 8785 JSON Canonicalization Scheme
- Temporal durable execution and Worker Versioning

