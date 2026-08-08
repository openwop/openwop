# RFC 0140: Replay side-effect suppression — a run replayed MUST NOT re-fire its external effects

| Field             | Value                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0140                                                                                                                                                                                                                                                     |
| **Title**         | Replay side-effect suppression — repairing an unconditional MUST that rests on an impossible mechanism, plus the additive `replay.sideEffectSuppression` assurance declaration and the `replay_source_missing` typed failure                              |
| **Status**        | `Active`                                                                                                                                                                                                                                                 |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                           |
| **Created**       | 2026-08-08                                                                                                                                                                                                                                               |
| **Updated**       | 2026-08-08 — `Draft → Active`. Comment window waived per `CONTRIBUTING.md` §"Bootstrap-phase notes" (additive, 7-day window, zero external reviewers). `Active → Accepted` is blocked on gap G1: no host implements §B.4(b)'s default-deny effect-seam guard yet, so no host may honestly advertise `recorded-outcome`. |
| **Affects**       | `schemas/capabilities.schema.json` (first-ever declaration of the root `replay` block, incl. additive `sideEffectSuppression`) · `spec/v1/replay.md` (new §"Side-effect suppression in replay"; caveat-1 repair; internals item 4 reconciliation; status-line correction) · `spec/v1/idempotency.md` (a cross-reference) · `spec/v1/rest-endpoints.md` (`replay_source_missing` registration) · `spec/v1/host-sample-test-seams.md` (effect-counting seam) · new conformance scenario + fixture · RFC 0011 / RFC 0009 / RFC 0041 composition |
| **Compatibility** | `additive` (no `MUST` relaxed — see §Compatibility)                                                                                                                                                                                                      |
| **Supersedes**    | —                                                                                                                                                                                                                                                        |
| **Superseded by** | —                                                                                                                                                                                                                                                        |

## Summary

`replay.md` §"Determinism guarantees" caveat 1 **already** requires, unconditionally,
that a replayed run not call an external system twice. But it discharges that
requirement by delegating to `idempotency.md` Layer 2 — whose key includes
`runId`, which a fork changes — so the named mechanism **provably cannot deliver
the guarantee it is named for**. v1 therefore ships a real normative requirement
resting on an impossible mechanism, with no conformance scenario and no way for a
peer to tell whether a given host honors it.

This RFC repairs that: it keeps the requirement unconditional, replaces the broken
delegation with a mechanism that works (resolve the **source** run's recorded
outcome, or fail closed), normates the `replay_source_missing` typed node failure,
and adds an additive `replay.sideEffectSuppression` capability that lets a host
**declare** the mechanism so it becomes probeable across a federation boundary.
The capability is an assurance declaration, **not** an opt-out.

## Motivation

**The gap is not silence — it is a promise with no working mechanism.** This is the
load-bearing correction to how this problem is usually described.

`replay.md` §"Determinism guarantees" → `replay` mode, caveat 1:

> **Side-effecting nodes** — every NodeModule that calls an external API (LLM,
> payment, message) MUST consult the durable invocation log (see `idempotency.md`
> §"Layer 2: Activity-level idempotency"). On replay, the cached response is
> returned — the external system is NOT called twice.

That is an unconditional MUST, and it says exactly the right thing. The defect is
the parenthetical:

> `idempotency.md` §"Layer 2" derives the engine-internal dedup key from
> `(runId, nodeId, attempt, providerKey)`. `replay.md` §Response specifies that a
> fork returns a **new `runId`**. Therefore every Layer-2 key computed during a
> replay differs from the corresponding key in the source run, and the Layer-2
> cache — which is doing exactly the right job for retries *within* a run —
> provably cannot deduplicate across a fork.

`idempotency.md` compounds it by listing "run is replayed from event log" among the
retry triggers Layer 2 covers. It does not.

**A host following the spec literally re-fires effects.** An implementer who reads
caveat 1, implements Layer 2 exactly as specified, and stops has satisfied the
letter of the spec and still sends the email twice. That is the failure this RFC
exists to prevent, and it is materially worse than a gap — a gap invites you to
think; a broken delegation invites you to stop thinking.

**One part of the corpus already knows the answer.** `replay.md`
§"Replay-from-event-log internals" item 4 says replay-mode invocations consult the
log keyed on `(sourceRunId, …)`. That contradicts `idempotency.md`'s `runId`-keyed
definition, and it is the *correct* half of the contradiction. §B formalizes what
item 4 sketches and reconciles the three sites.

**Why this is an interop guarantee, not tidiness.** RFC 0007 dispatch and RFC 0063
sub-run merging let one host's run drive another host's workflow. Today a calling
host cannot tell whether a peer honors caveat 1, because there is nothing to
interrogate and no scenario to point at. "Does replaying this cost me real money?"
is unanswerable across a federation boundary — an interop guarantee by exactly the
argument RFC 0053 §Motivation makes for dead-lettering.

## Proposal

### §A — `capabilities.schema.json`: declare the `replay` block (additive)

**The root `replay` capability is presently undeclared in any schema.** It survives
only on the document root's `additionalProperties: true`, even though
`profiles.md` §`openwop-replay-fork` builds a normative predicate on it and six
conformance scenarios read it. §A therefore **declares the block for the first
time**, with `sideEffectSuppression` as a new optional member:

```json
"replay": {
  "type": "object",
  "description": "Replay / fork surface (RFC 0011; `replay.md`). Predicate source for the `openwop-replay-fork` profile (`profiles.md`).",
  "properties": {
    "supported": { "type": "boolean" },
    "modes": {
      "type": "array",
      "items": { "type": "string", "enum": ["replay", "branch"] },
      "uniqueItems": true
    },
    "fork": {
      "type": "boolean",
      "description": "LEGACY spelling of the advert limitation, retained for existing consumers. `modes` is the authoritative list; a host MUST NOT infer mode support from this flag."
    },
    "sideEffectSuppression": {
      "enum": ["recorded-outcome", "none"],
      "default": "none",
      "description": "RFC 0140. DECLARES the mechanism by which the host discharges `replay.md` §\"Determinism guarantees\" caveat 1 for a `mode:\"replay\"` fork. `recorded-outcome`: a side-effecting node does not execute during a replay — the host reproduces the source run's recorded terminal outcome for the same (nodeId, attempt), or fails the node closed with `replay_source_missing`, and a default-deny guard at every host effect seam fails closed for anything the classifier missed. `none` (default, absent ⇒ this): the host declares NO mechanism. This is NOT permission to re-fire — caveat 1 binds every host unconditionally — it means the guarantee is unprobeable on this host, so the gated scenario soft-skips."
    }
  }
}
```

The block is deliberately left **open** (no `additionalProperties: false`): the
discovery document is a server-emitted shape, and `COMPATIBILITY.md` §2.1
(RFC 0094 schema closure) requires server-emitted shapes to stay open so a v1.x
host can add optional fields. Several existing capability sub-blocks close; they
predate RFC 0094 and are not the pattern to copy.

### §B — `spec/v1/replay.md`: new §"Side-effect suppression in replay" (normative)

**§B.0 — The requirement is unconditional.** For a fork with `mode: "replay"`, a
node that performs an **external side effect** — any operation observable outside
the run's own event log (an outbound network call, a message or notification
delivered to a person, a payment, a write to a third-party system) — MUST NOT
execute that effect. This restates caveat 1; it does not add to it. What follows
replaces caveat 1's inoperative delegation to Layer 2 with a mechanism that works.

**§B.1 — Resolve from the source, not the fork.** The host MUST resolve the node's
outcome from the **source** run's recorded terminal outcome for the same
`(nodeId, attempt)`. The Nth attempt of a node in the replay resolves to the Nth
recorded outcome in the source. Layer 2 MUST NOT be relied on for this: its key
space is disjoint from the source's by construction (§Motivation).

**§B.2 — Fail closed on a missing record.** If the source run has no recorded
outcome for that `(nodeId, attempt)`, the host MUST fail the node closed with
`error.code: "replay_source_missing"` (§C). It MUST NOT execute the effect, and
MUST NOT substitute a synthesized or empty success.

**§B.3 — Pure and LLM nodes re-execute live.** Non-side-effecting nodes (pure
computation, and LLM calls served from the invocation log per §"LLM cache-key
recipe" §C, whose secondary content-addressed key *does* survive a fork) continue
to re-execute live. This is **required, not merely permitted**: §`replay` defines
the mode as re-executing sequences `>= fromSeq` against current code and emitting
`replay.diverged` on mismatch, so short-circuiting pure nodes would make
divergence detection vacuously green — a broken guarantee that reports success.

**§B.4 — The guarantee is whole-run, and needs two mechanisms.** A host MUST NOT
advertise `sideEffectSuppression: "recorded-outcome"` unless **both** hold:

- **(a) Classification** short-circuits known side-effecting nodes *before* they
  execute, per §B.1. This is what keeps a replay **correct** — it reproduces the
  right observable output.
- **(b) A default-deny guard at every host effect seam** fails the node closed per
  §B.2 when a node reaches an effect seam during a replay. This is what keeps a
  replay **safe**.

(a) alone is insufficient and MUST NOT be advertised as `recorded-outcome`.
Classification is a moving target: a retargeted typeId, a pack node that cannot
self-declare, or a newly-added integration silently leaves the classified set, and
the failure is invisible — the replay looks green and the effect fires. The seam
guard is what makes the claim whole-run without requiring the host to enumerate
every effect in its catalogue. Because pure nodes never reach an effect seam, (b)
does not disturb §B.3.

**§B.5 — Cross-host dispatch needs no separate rule.** An RFC 0007 dispatch to a
peer is an outbound network call, hence an external side effect under §B.0. During
a replay the dispatching node therefore reproduces its recorded outcome under §B.1
and **never contacts the peer at all** — so the peer's own advertisement is
irrelevant to the calling host's guarantee, and no propagation rule is needed.

### §C — `replay_source_missing` (normative typed failure)

A node failed under §B.2 MUST carry `error.code: "replay_source_missing"` in its
`node.failed` payload. This is a node-failure code in the run event log; the fork
request itself still returns `201`. No schema change is required — `_errorObject.code`
in `run-event-payloads.schema.json` is an open string — but the code is registered
in `spec/v1/rest-endpoints.md` §"Common error codes" alongside
`replay_diverged_at_refusal` and `replay_memory_snapshot_unavailable`, where every
sibling node-failure code lives.

Negative example — a replay reaching an unrecorded side-effecting node:

```json
{ "type": "node.failed", "nodeId": "send-invoice",
  "payload": { "error": { "code": "replay_source_missing",
    "message": "the source run has no recorded outcome for this node" } } }
```

Positive example — the same node with a recorded source outcome resolves to
`node.completed` carrying the source's outputs, and **no** outbound call occurs.

### §D — Scope: `mode: "replay"` only

This RFC deliberately does **not** constrain `mode: "branch"`. A branch is a new
execution with caller-supplied inputs exploring a real alternative ("what would
have happened if we'd approved at step N"), so its effects are effects the operator
asked for. A replay re-executes fixed history, so its effects are duplicates by
definition.

Because that asymmetry is currently silent and surprising, `replay.md` gains an
explicit caution: a `branch` fork **re-fires external effects** for sequences
`>= fromSeq`, and a host SHOULD surface that in its operator-facing fork UI. Hosts
that wish to suppress branch effects too MAY do so, but MUST NOT advertise that as
`sideEffectSuppression` — a future RFC can add a distinct value if implementer
demand appears.

### §E — `spec/v1/idempotency.md` cross-reference (clarifying, non-normative)

Add to §"Layer 2" a note stating the disjoint-key-space consequence, so the next
implementer does not have to rediscover it, and correct the §Layer-2 preamble,
which lists "run is replayed from event log" among the triggers Layer 2 covers:

> **Layer 2 does not survive a fork.** The key includes `runId`, and
> `POST /v1/runs/{runId}:fork` mints a new one, so a replayed run's keys never
> collide with its source's. Cross-fork side-effect suppression is a separate
> mechanism — see `replay.md` §"Side-effect suppression in replay" (RFC 0140).

### §F — `replay.md` status-line and internals corrections

Three sites in `replay.md` need reconciling with §B:

1. **The status line's "Known gap" note (added 2026-08-08) is itself wrong** and is
   removed. It asserts that no side-effecting-node section exists and that "v1
   specifies no constraint on whether a replayed run re-fires its external
   effects" — both are false; caveat 1 is exactly that constraint. The original
   status-line claim of coverage was accurate and is restored, now pointing at §B.
2. **Caveat 1** keeps its MUST and drops the inoperative Layer-2 delegation,
   forward-referencing §B instead.
3. **§"Replay-from-event-log internals" item 4** already describes
   `(sourceRunId, …)`-keyed dedup, contradicting `idempotency.md`. It is the
   correct half; it is reworded to cite §B as its normative basis rather than
   `idempotency.md` §Layer 2.

## Compatibility

**Additive.** The guarantees:

- **No `MUST` is relaxed.** Caveat 1 binds every host before and after this RFC.
  An earlier draft of this RFC made suppression conditional on advertising, with
  an absent capability meaning "a replay MAY re-fire effects" — that would have
  relaxed an existing unconditional MUST and been **breaking** under
  `COMPATIBILITY.md` §2.2. The capability is instead an assurance declaration:
  `none` means "no declared mechanism", never "permitted to re-fire".
- `sideEffectSuppression` is a new optional property. Absent ⇒ `"none"` ⇒ the
  host's advertised shape is byte-identical to today's.
- §A declares a block that was previously unvalidated. It is declared **open**, and
  every field it declares is optional, so every capability document that validates
  today continues to validate.
- `replay_source_missing` is a new value in the open `error.code` string space of
  an existing event payload; consumers already tolerate unknown codes.
- No existing field changes type, optionality, or meaning.

The new conformance scenario is capability-gated, so no host's existing pass is
disturbed; per `COMPATIBILITY.md` §2.3, a host that fails a newly-added scenario
has had a previously-untested gap found, which is not a spec break.

## Conformance

**Existing coverage:** none. `replay-fork.test.ts`, `replayDeterminism.test.ts`,
and `replay-fork-arbitrary.test.ts` all assert on the event log; none asserts that
no external effect occurred.

**New scenario** — `replay-side-effect-suppression.test.ts`, gated via
`behaviorGate` on `capabilities.replay.sideEffectSuppression === "recorded-outcome"`:

1. Run a fixture workflow whose terminal node performs a host-observable effect;
   assert the effect count is exactly one.
2. Fork it `mode: "replay"`; assert the fork reaches terminal.
3. Assert the effect count is **still exactly one** — the load-bearing assertion.
4. Fork a run whose effect node never completed; assert `node.failed` with
   `error.code: "replay_source_missing"` and, again, no new effect.

**The counting surface is the crux.** An event-log-only assertion cannot
distinguish "suppressed" from "fired and recorded identically", which is exactly
the failure mode this RFC exists to prevent. The suite has no effect-counting
surface today — neither a callback sink nor a seam — so this RFC adds one: a
host-sample seam (`spec/v1/host-sample-test-seams.md`) exposing a monotonic count
of effects fired at the host's effect seam, read via `behaviorGatePresent` so
seam-absence soft-skips by default and hard-fails under
`OPENWOP_REQUIRE_BEHAVIOR=true`.

A suite-hosted listener was considered and rejected for this RFC: a seeded fixture
cannot be given an ephemeral `127.0.0.1:<port>` callback URL without a
URL-injection mechanism the suite does not have. The honesty limit of the seam
approach — the host counts its own effects — is documented in `coverage.md`
rather than left implicit. The counter is placed at the **same** effect seam that
§B.4(b) requires the guard to sit on, so the scenario probes the guard directly.

## Alternatives considered

1. **Do nothing.** Leaves a normative MUST resting on an impossible mechanism, and
   leaves "will replaying this cost me money?" unanswerable across a federation
   boundary. Rejected: an implementer who follows the spec literally re-fires
   effects and believes they are conformant.
2. **Extend Layer-2 idempotency to span forks** (e.g. key on the root run id
   instead of `runId`). Rejected: it would change the meaning of an existing
   normative key — a breaking change to `idempotency.md` — and it conflates two
   problems. Layer 2 exists to make *retries* safe; the fork case is about *not
   executing at all*, which no cache key can express.
3. **Make the guarantee conditional on advertising** (absent ⇒ a replay MAY
   re-fire). Rejected as **breaking**: caveat 1 is already an unconditional MUST,
   so gating it would relax an existing MUST under `COMPATIBILITY.md` §2.2. Note
   this inverts the usual intuition — mandatory suppression is the *status quo*,
   and the capability gate would have been the relaxation.
4. **Weaken §B.4 to a per-node-class advertisement.** Rejected: a partial guarantee
   is one an operator cannot reason about, and it is unverifiable across a
   federation boundary — a caller would need the peer's entire node catalogue to
   interpret it. §B.4(b)'s seam guard delivers the whole-run claim without
   requiring exhaustive enumeration.
5. **Declare effects in the node-pack manifest** rather than leave classification
   to the host. Rejected for this RFC, though noted as a possible successor: a
   manifest declaration would have to be **monotonic opt-in** (declaring "I have an
   effect" is safe; the *absence* of a declaration must never be read as "pure", or
   an out-of-date pack silently loses protection). It also overlaps the existing
   `actions[].idempotent` field in `node-pack-manifest.schema.json`, and shipping
   both without stating their relationship would invite hosts to conflate "safe to
   retry" with "has an effect". Those are orthogonal and both need answering
   separately.

## Resolved questions

1. **Enum or boolean?** **Enum.** It costs nothing now and leaves room for a future
   `"deferred"` mode (queue the effect for operator review rather than suppress
   it), which several human-in-the-loop hosts have asked about informally, and for
   a value distinguishing a guarded invariant from best-effort classification
   should §B.4(b) ever be relaxed.
2. **Should §B.4's whole-run guarantee be weakened to per-node-class?** **No** —
   see Alternative 4. Instead §B.4 states *how* whole-run is met (classifier +
   default-deny seam guard), which makes it achievable without enumerating every
   effect.
3. **Does the cross-host case need a propagation rule?** **No** — see §B.5. A
   dispatch is itself a side effect, so a replay never reaches the peer.

## Implementation notes (non-normative) — target design

The reference host (openwop-app) implements **§B.1/§B.2 only** today, via ADR 0326
(P3b, source-run invocation-log fallback) and ADR 0341 (side-effecting node
classification + `replay_source_missing`). §B.4(b) is **not yet built** there; the
shape below is the target, and the gap is tracked in this RFC's risk register.

- **Two mechanisms, not one.** A typeId classifier short-circuits known
  side-effecting nodes *before* they run, so the replay reproduces the correct
  observable output (§B.1). A separate default-deny guard at each host effect seam
  catches anything the classifier missed and fails it closed (§B.2). The first
  keeps replays *correct*; the second keeps them *safe*. A host that implements
  only the first will eventually ship classifier drift — openwop-app's
  `executor/sideEffects.ts` documents exactly this, having once had 55 chain nodes
  silently fall out of protection when a typeId was retargeted, because pack
  `.mjs` nodes cannot self-declare.
- **The backstop needs run-scoped ambient state** — e.g. an `AsyncLocalStorage`
  context established around every node execution. Note this does not survive a
  process/worker boundary: a host that sandboxes node execution out-of-process must
  re-establish the context on the host side of that boundary.
- **Effects already idempotent by deterministic key need no guard.** Where a write
  derives its row key deterministically from run-invariant inputs, a replay is
  already a correct no-op, and adding a fail-closed guard would turn correct
  behavior into an error.

## Acceptance criteria

- [x] Spec text merged (`replay.md` §B + §D caution + §F's three corrections,
      `idempotency.md` §E, `rest-endpoints.md` §C registration).
- [x] `capabilities.schema.json` updated (§A — the `replay` block declared).
- [x] Effect-counting host-sample seam specified in `host-sample-test-seams.md`.
- [x] `replay-side-effect-suppression.test.ts` + fixtures in
      `@openwop/openwop-conformance` (suite `1.64.0 → 1.65.0`), capability-gated;
      `coverage.md` documents the honesty limit of a host-attested counter.
- [x] CHANGELOG entry under the appropriate v1.x version.
- [ ] Reference host implements §B.4(b)'s default-deny effect-seam guard
      (§B.1/§B.2 already land via ADR 0326 P3b + ADR 0341).
- [ ] Reference host advertises `sideEffectSuppression: "recorded-outcome"` and
      passes the new scenario **non-vacuously** (per RFC 0139's adopted standard:
      N fixes need N sabotages).

## References

- `spec/v1/replay.md` §"Two modes", §"Determinism guarantees" (caveat 1 — the
  requirement this RFC repairs), §"LLM cache-key recipe" §C,
  §"Replay-from-event-log internals" item 4
- `spec/v1/idempotency.md` §"Layer 2: Activity-layer idempotency"
- `COMPATIBILITY.md` §2.1 (RFC 0094 schema closure), §2.2 (MUST-relaxation
  prohibition), §2.3 (suite vs spec)
- RFC 0009 (retry), RFC 0011 (fork/replay), RFC 0041 (replay determinism under
  nondeterministic models), RFC 0053 (dead-letter — the same "terminal disposition
  is an interop guarantee" argument), RFC 0094 (schema closure), RFC 0139
  (non-vacuous witness standard)
- openwop-app ADR 0326 (executor durability), ADR 0341 (side-effecting node
  classification)
