# RFC 0140: Replay side-effect suppression — a run replayed MUST NOT re-fire its external effects

| Field             | Value                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RFC**           | 0140                                                                                                                                                                                                                                                     |
| **Title**         | Replay side-effect suppression — an additive `replay.sideEffectSuppression` capability, the normative MUST it gates, and the `replay_source_missing` typed failure                                                                                        |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                  |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                           |
| **Created**       | 2026-08-08                                                                                                                                                                                                                                               |
| **Updated**       | 2026-08-08 (Draft → **Active**: §A schema, §B/§E/§F spec text, and the conformance scenario landed together; **Active → Accepted** same day on the openwop-app reference-host witness — advert flipped, scenario 2/2 green, and non-vacuity proven by TWO separate sabotages rather than one; see §"Implementation record".)                                                                                                                                                                                                                                               |
| **Affects**       | `schemas/capabilities.schema.json` (additive `replay.sideEffectSuppression`) · `spec/v1/replay.md` (new §"Side-effect suppression", plus a status-line correction) · `spec/v1/idempotency.md` (a cross-reference) · new conformance scenario · RFC 0011 / RFC 0009 composition |
| **Compatibility** | `additive`                                                                                                                                                                                                                                               |
| **Supersedes**    | —                                                                                                                                                                                                                                                        |
| **Superseded by** | —                                                                                                                                                                                                                                                        |

## Summary

`replay.md` promises deterministic re-execution but says nothing about what a
replay does to the *outside world*: nothing in v1 stops a replayed run from
sending the email, charging the card, or posting the webhook a second time. The
obvious candidate mechanism cannot close this — `idempotency.md` Layer 2 keys on
`(runId, nodeId, attempt, providerKey)`, and a fork mints a **new** `runId`, so a
fork's key space is disjoint from its source's *by construction*. This RFC adds
an additive `replay.sideEffectSuppression` capability, the normative MUST it
gates (a replayed side-effecting node reproduces the source run's recorded
outcome or fails closed — never a new effect), and normates the
`replay_source_missing` typed node failure. Absent the capability, hosts behave
exactly as they do today.

## Motivation

Every host that implements `POST /v1/runs/{runId}:fork` with `mode: "replay"`
has this problem, and the spec currently leaves each of them to discover it
privately.

**The gap is real and the spec already half-admits it.** `replay.md`'s status
line advertises "idempotency requirements on side-effecting nodes" — but the
document has no such section. Its §-list runs Determinism guarantees → LLM
cache-key recipe → RFC 0041 Phase 4 → Replay-from-event-log internals. A reader
following that status line finds nothing. That is a doc-honesty defect
independent of the normative gap, and this RFC fixes both.

**Layer-2 idempotency cannot be the answer.** This is the load-bearing argument
for why the spec must change rather than hosts trying harder:

> `idempotency.md` §"Layer 2" derives the engine-internal dedup key from
> `(runId, nodeId, attempt, providerKey)`. `replay.md` §Response specifies that
> a fork returns a **new `runId`**. Therefore every Layer-2 key computed during
> a replay differs from the corresponding key in the source run, and the Layer-2
> cache — which is doing exactly the right job for retries *within* a run —
> provably cannot deduplicate across a fork.

A host that wants the guarantee must therefore reach *outside* the specified
mechanisms: read the **source** run's records while executing the **fork**. That
is precisely what the reference host does (openwop-app ADR 0326 P3a/b for
provider calls, ADR 0341 for node-level effects, ADR 0531 for the fail-closed
backstop) — but it is host-private, unadvertised, and unverifiable by a peer.

**Why that matters for interop, not just tidiness.** RFC 0007 dispatch and RFC
0063 sub-run merging let one host's run drive another host's workflow. A calling
host that replays a run containing a cross-host dispatch has no way to know
whether the remote host will re-send. There is no capability to interrogate and
no conformance scenario to point at. "Does replaying this cost me real money?"
is currently unanswerable across a federation boundary — which is an interop
guarantee, not an implementation detail, by exactly the argument RFC 0053
§Motivation makes for dead-lettering.

## Proposal

### §A — `capabilities.schema.json`: `replay.sideEffectSuppression` (additive)

> **Implementation note (2026-08-08).** The diff below assumed an existing
> `replay` block to extend. **There was none** — `capabilities.schema.json`
> declared no `replay` property at all, and every host's `{supported, modes,
> fork, retention}` advert validated purely via the document root's
> `additionalProperties: true`. §A therefore *declares the block for the first
> time*, carrying the pre-existing fields exactly as already emitted and
> consumed, with `additionalProperties` left permissive so no host's current
> document is newly invalidated.

```diff
     "replay": {
       "type": "object",
       "properties": {
         "supported": { "type": "boolean" },
         "modes": {
           "type": "array",
           "items": { "enum": ["replay", "branch"] }
         },
-        "fork": { "type": "boolean" }
+        "fork": { "type": "boolean" },
+        "sideEffectSuppression": {
+          "enum": ["recorded-outcome", "none"],
+          "default": "none",
+          "description": "RFC 0140. How the host prevents a `mode:\"replay\"` fork from re-firing external side effects. `recorded-outcome`: a side-effecting node does not execute during a replay — the host reproduces the source run's recorded terminal outcome for the same (nodeId, attempt), or fails the node closed with `replay_source_missing`. `none` (default, absent ⇒ this): the host makes no such guarantee and a replay MAY re-fire effects."
+        }
       }
     }
```

### §B — `spec/v1/replay.md`: new §"Side-effect suppression in replay" (normative)

When a host advertises `replay.sideEffectSuppression: "recorded-outcome"`, then
for a fork with `mode: "replay"`:

1. A node that performs an **external side effect** — any operation observable
   outside the run's own event log (an outbound network call, a message or
   notification delivered to a person, a payment, a write to a third-party
   system) — MUST NOT execute that effect.
2. The host MUST instead resolve the node's outcome from the source run's
   recorded terminal outcome for the same `(nodeId, attempt)`. The Nth attempt
   of a node in the replay resolves to the Nth recorded outcome in the source.
3. If the source run has no recorded outcome for that `(nodeId, attempt)`, the
   host MUST fail the node closed with `error.code: "replay_source_missing"`
   (§C). It MUST NOT execute the effect, and MUST NOT substitute a synthesized
   or empty success.
4. The guarantee is **whole-run**: a host MUST NOT advertise
   `recorded-outcome` if any class of side-effecting node in its catalogue can
   still fire during a replay.

Non-side-effecting nodes (pure computation, and LLM calls served from the
Layer-2 invocation log per §"LLM cache-key recipe") continue to **re-execute
live**. This is required, not merely permitted: `replay.md` §`replay` defines
the mode as re-executing against current code and emitting `replay.diverged` on
mismatch, so short-circuiting pure nodes would make divergence detection
vacuously green — a broken guarantee that reports success.

### §C — `replay_source_missing` (normative typed failure)

A node failed under §B.3 MUST carry `error.code: "replay_source_missing"` in its
`node.failed` payload. This is a node-failure code in the run event log, not an
HTTP error-envelope code; the fork request itself still returns `201`.

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
have happened if we'd approved at step N"), so its effects are effects the
operator asked for. A replay re-executes fixed history, so its effects are
duplicates by definition. Hosts that wish to suppress branch effects too MAY do
so, but MUST NOT advertise that as `sideEffectSuppression` — a future RFC can
add a distinct value if implementer demand appears.

### §E — `spec/v1/idempotency.md` cross-reference (clarifying, non-normative)

Add to §"Layer 2" a note stating the disjoint-key-space consequence spelled out
in Motivation, so the next implementer does not have to rediscover it:

> **Layer 2 does not survive a fork.** The key includes `runId`, and
> `POST /v1/runs/{runId}:fork` mints a new one, so a replayed run's keys never
> collide with its source's. Cross-fork side-effect suppression is a separate
> mechanism — see `replay.md` §"Side-effect suppression in replay" (RFC 0140).

### §F — `replay.md` status-line correction

The status line claims coverage of "idempotency requirements on side-effecting
nodes", which no section provides. §B makes the claim true; the status line is
updated in the same change rather than left as a promissory note.

## Compatibility

**Additive.** The guarantees:

- `sideEffectSuppression` is a new optional property on an existing optional
  capability block. Absent ⇒ `"none"` ⇒ exactly today's specified behavior, so
  no existing v1 conformance pass is invalidated.
- The normative MUSTs in §B are **conditioned on advertising**
  `"recorded-outcome"`. A host that does not advertise it is unaffected.
- `replay_source_missing` is a new value in the open `error.code` string space
  of an existing event payload; consumers already tolerate unknown codes.
- No existing field changes type, optionality, or meaning.

A host that already suppresses replay side effects (the reference host does) can
advertise immediately; a host that does not is not made non-conformant.

## Conformance

**Existing coverage:** none. `replay-fork.test.ts`, `replayDeterminism.test.ts`,
and `replay-fork-arbitrary.test.ts` all assert on the event log; none asserts
that no external effect occurred.

**New scenario** — `replay-side-effect-suppression.test.ts`, gated on
`capabilities.replay.sideEffectSuppression === "recorded-outcome"` (skip
otherwise, per the additive-capability rule in `capabilities.md`):

1. Run a fixture workflow whose terminal node performs a host-observable effect
   against the conformance echo/callback endpoint; assert exactly one effect.
2. Fork it `mode: "replay"`; assert the fork reaches terminal.
3. Assert the effect count is **still exactly one** — the load-bearing assertion.
4. Fork a run whose effect node never completed; assert `node.failed` with
   `error.code: "replay_source_missing"` and, again, no new effect.

The counting endpoint is the crux: an event-log-only assertion cannot
distinguish "suppressed" from "fired and recorded identically," which is exactly
the failure mode this RFC exists to prevent.

> **Correction (2026-08-08, during implementation).** The paragraph above is too
> strong, and the shipped scenario is built on the gap it missed. The claim holds
> for the **happy** path — a node replayed from its recorded outcome is indeed
> log-indistinguishable from one that re-fired and recorded the same thing. It
> does **not** hold for the **fail-closed** path: a suppressing host reaching a
> side-effecting node with *no* recorded source outcome MUST emit
> `replay_source_missing` (§B.3), whereas a non-suppressing host executes the
> node and completes it. That asymmetry is unforgeable, so
> `replay-side-effect-suppression.test.ts` asserts on it and needs **no
> out-of-band effect counter and no operator instrumentation** — a materially
> cheaper witness than this section anticipated. The out-of-band counter remains
> the only way to witness the happy path, and is recorded as a known limit rather
> than shipped: it would require the operator-configured fake-peer dance that
> `conformance-a2a-task-roundtrip` uses.

## Alternatives considered

1. **Do nothing.** Leaves every host to discover the Layer-2 disjoint-key
   problem privately, and leaves "will replaying this cost me money?"
   unanswerable across a federation boundary. Rejected: the reference host
   already needed three ADRs to get here, which is evidence the gap is not
   self-solving.
2. **Extend Layer-2 idempotency to span forks** (e.g. key on the root run id
   instead of `runId`). Rejected: it would change the meaning of an existing
   normative key — a breaking change to `idempotency.md` — and it conflates two
   different problems. Layer 2 exists to make *retries* safe; the fork case is
   about *not executing at all*, which no cache key can express.
3. **Make suppression mandatory for all hosts** (an unconditional MUST). Rejected
   as breaking: it would invalidate every existing v1 conformance pass by a host
   that re-fires today. The capability gate gets the same guarantee where it is
   honored without a v2.
4. **Declare effects in the node-pack manifest** rather than leave classification
   to the host. Rejected for this RFC, though noted as a possible successor: a
   manifest declaration would have to be **monotonic opt-in** (declaring "I have
   an effect" is safe; the *absence* of a declaration must never be read as
   "pure", or an out-of-date pack silently loses protection). It also overlaps
   the existing `actions[].idempotent` field in
   `node-pack-manifest.schema.json`, and shipping both without stating their
   relationship would invite hosts to conflate "safe to retry" with "has an
   effect". Those are orthogonal and both need to be answered separately.

## Unresolved questions

1. Should `sideEffectSuppression` be an enum (as proposed) or a boolean? The enum
   costs nothing now and leaves room for a future `"deferred"` mode (queue the
   effect for operator review rather than suppress it), which several
   human-in-the-loop hosts have asked about informally.
2. Should §B.4's whole-run guarantee be weakened to a per-node-class
   advertisement? The reference implementation suggests not — a partial
   guarantee is one an operator cannot reason about — but a host with a large
   third-party catalogue may disagree.
3. Does the cross-host case (RFC 0007 dispatch into a peer that advertises
   `none`) need an explicit propagation rule, or is it sufficient that the
   calling host can read the peer's capability document and refuse?

## Implementation notes (non-normative)

The reference host (openwop-app) implements this today across three ADRs, and
the shape is worth copying because the naive single-mechanism version does not
work:

- **Two mechanisms, not one.** A typeId classifier short-circuits known
  side-effecting nodes *before* they run, so the replay reproduces the correct
  observable output (§B.2). A separate runtime guard at each host effect seam
  catches anything the classifier missed and fails it closed (§B.3). The first
  keeps replays *correct*; the second keeps them *safe*. A host that implements
  only the first will eventually ship the classifier drift that motivated ADR
  0531 (55 nodes silently lost protection when a typeId was retargeted).
- **The backstop needs run-scoped ambient state.** The reference host uses
  `AsyncLocalStorage` established around every node execution. Note this does
  not survive a process/worker boundary — a host that sandboxes node execution
  out-of-process must re-establish the context on the host side of that
  boundary.
- **Effects already idempotent by deterministic key need no guard.** Where a
  write derives its row key deterministically from run-invariant inputs, a
  replay is already a correct no-op, and adding a fail-closed guard would turn
  correct behavior into an error.

## Acceptance criteria

- [x] Spec text merged (`replay.md` §B + §F, `idempotency.md` §E). — 2026-08-08
- [x] `capabilities.schema.json` updated (§A) — and the `replay` block declared for the first time. — 2026-08-08
- [x] `replay-side-effect-suppression.test.ts` in `@openwop/openwop-conformance`,
      capability-gated, plus the `conformance-replay-side-effect` fixture + catalog entry. — 2026-08-08
- [x] CHANGELOG entry under `[Unreleased]`. — 2026-08-08
- [x] Reference host implements the behavior (openwop-app ADR 0341 + ADR 0531;
      the fail-closed backstop and its pack-boundary tripwire are tested).
- [x] Reference host advertises `sideEffectSuppression: "recorded-outcome"` and
      passes the new scenario. — 2026-08-08, openwop-app

## References

- `spec/v1/replay.md` §"Two modes", §"Determinism guarantees", §"LLM cache-key recipe"
- `spec/v1/idempotency.md` §"Layer 2: Activity-layer idempotency"
- RFC 0009 (retry), RFC 0011 (fork/replay), RFC 0041 (replay determinism under
  nondeterministic models), RFC 0053 (dead-letter — the same "terminal
  disposition is an interop guarantee" argument)
- openwop-app ADR 0326 (executor durability), ADR 0341 (side-effecting node
  classification), ADR 0531 (run-scoped effect guard — the reference
  implementation of §B.3)

## Implementation record (2026-08-08)

Landed in one pass; `Draft → Active → Accepted` the same day, with the host
witness taken before the promotion rather than promised after it.

| Criterion | Evidence |
|---|---|
| §A schema | `capabilities.schema.json` — and the `replay` block **declared for the first time** (see the §A implementation note) |
| §B/§E/§F spec text | `replay.md` §"Side-effect suppression in replay"; `idempotency.md` §Layer 2 note; status-line claim made true |
| Conformance | `replay-side-effect-suppression.test.ts` + `conformance-replay-side-effect` fixture + catalog entry; suite `1.64.0 → 1.65.0` |
| CHANGELOG | `[Unreleased]` |
| Reference host implements | openwop-app ADR 0341 + ADR 0531 (openwop-app#3048) |
| Reference host advertises + passes | `replay: { …, sideEffectSuppression: "recorded-outcome" }`; **2/2 green** |

### Non-vacuity: two sabotages, because there are two mechanisms

A green scenario proves nothing on its own, and one combined sabotage would have
proven less than it appeared to. Each suppression path was disabled separately:

| Sabotage | Result | What it establishes |
|---|---|---|
| Remove the ADR 0341 classifier entry **and** the module's `sideEffecting` flag **and** bypass the guarded seam | **RED** — requirement 1 fires (`the side-effecting node MUST NOT complete during a replay`) | The assertion is load-bearing; a non-suppressing host is caught. |
| Remove the classifier entry **and** the module flag, leaving ONLY the ADR 0531 seam backstop | **GREEN** | The backstop alone carries the guarantee — coverage does **not** depend on the typeId allowlist being complete. |

The second row is the one that matters for §B.4. The whole-run guarantee is only
honest if a host can make it without enumerating every side-effecting node in its
catalogue, and that is now **measured** on the reference host rather than argued:
with the allowlist entry gone, the run still fails closed.

### Known limits, restated plainly

- The **happy path** (a node replayed from its recorded outcome) remains weakly
  witnessed — it is log-indistinguishable from a re-fire, which is why the
  fail-closed leg carries the weight. An out-of-band effect counter is the only
  way to close it and would require the operator-configured fake-peer setup
  `conformance-a2a-task-roundtrip` uses; not shipped.
- The scenario exercises the reserved fixture node, not a host's whole catalogue.
  §B.4 is asserted normatively, not measured exhaustively.
- `core.conformance.side-effect` is host-mapped, so the suite measures a
  cooperating host. Consistent with every other host-sample seam; not an
  adversarial control.
