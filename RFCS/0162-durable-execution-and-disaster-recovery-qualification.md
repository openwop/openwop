# RFC 0162: Durable Execution and Disaster-Recovery Qualification

| Field             | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| **RFC**           | 0162                                                                     |
| **Title**         | Durable Execution and Disaster-Recovery Qualification                    |
| **Status**        | `Draft`                                                                  |
| **Author(s)**     | openwop-app-f4 (host maintainer, reference host)                         |
| **Created**       | 2026-08-18                                                               |
| **Updated**       | 2026-08-18                                                               |
| **Affects**       | `spec/v1/replay.md`, `spec/v1/idempotency.md`, `spec/v1/storage-adapters.md`, `capabilities.md`, conformance `durability/*` |
| **Compatibility** | `additive`                                                               |
| **Supersedes**    | —                                                                        |
| **Superseded by** | —                                                                        |

## Summary

Defines what it means for a host to *durably execute* work it has accepted, and a **qualification ladder** —
`durable-single-instance` → `durable-multi-instance` → `multi-region-qualified` — that says which durability
claims a host has actually demonstrated rather than which it believes.

The central normative move is small and cheap: **a host that accepts work MUST declare the bound within which
another instance may resume that work after the accepting instance dies, and MUST NOT leave the bound
unstated.** A slow recovery is a legitimate posture. An unknown one is not.

## Motivation

Three gaps, each observed on a real host rather than reasoned about.

**1. "Recovery" is asserted, never bounded.** RFC 0151's acceptance criterion asked for *"one reference host
demonstrates non-vacuous recovery from a mid-unwind crash"*, which reads as a fast test and thereby implies an
architecture — a compensation runner with its own short lease — that the profile never required. It was amended
(#1085) to *"recovery within a host-declared bound, and the bound is advertised."* **That amended criterion
belongs here**, applied to all accepted work rather than to compensation alone.

**2. A lease is not a liveness signal, and hosts conflate the two.** On the reference host, the run dispatch
lease is set exactly once at dispatch and never renewed:

```
grep -rn 'setRunDispatchLease(' src/   ->   ONE call site
```

So it answers *"could this run still legitimately be running?"*, not *"is the worker alive?"*. It must therefore
be at least as long as the longest legal run, and crash detection takes as long as the maximum run duration —
twelve minutes on that host. This is not a bug in that host; it is the predictable result of a spec that
requires durability without distinguishing **liveness** from **duration**. Temporal separates them for exactly
this reason: a long execution timeout *"would increase the delay before a stuck or crashed worker would be
identified."*

**3. Shortening the lease is unsafe in a way the spec does not warn about.** Without a liveness signal, a
shorter lease declares *live* long-running work dead and re-dispatches it. A host with no effect fencing
(`idempotency.crossRegion: single-region`) then converts a stall into **duplicate external effects** — and where
the work is a compensation inverse, into duplicate refunds. **On such a host the long lease is standing in for
fencing.** A spec that asks for fast recovery without saying this invites the dangerous fix.

## Proposal

### §A Durable acceptance

1. A host that returns a success status for work it has accepted **MUST** have made the intent to perform that
   work durable in the same transaction as the work record. A wakeup, hint, or in-process dispatch **MUST NOT**
   be the only record that the work was accepted.
2. A host **MUST** be able to resume accepted-but-unstarted work after the accepting process dies, without
   client action.

### §B Liveness and duration are separate bounds

3. A host **MUST** distinguish, in its own implementation, the maximum duration a unit of work may legitimately
   run from the interval within which a live worker demonstrates liveness. It **MUST NOT** use the duration
   bound as the sole liveness signal.
4. A host **MUST** declare a **recovery bound**: the maximum interval between an instance ceasing to make
   progress and another instance becoming eligible to resume its work.
5. The recovery bound **MUST** be derived from the mechanism that enforces it, not stated independently of it.
   A declared bound that no mechanism produces is a claim, not a bound.
6. A host **MAY** declare a recovery bound of any length. **A long bound is conformant; an undeclared or
   unenforced one is not.**

> **Non-normative, and the reason §B exists.** Requirement 3 is satisfiable by a heartbeat, by a supervisor, or
> by any other liveness mechanism. It is *not* satisfiable by lengthening a lease. A host that shortens its
> lease to satisfy requirement 4 without satisfying requirement 3 has made itself less safe, not more — see
> Motivation 3.

### §C Duplicate delivery and poison work

7. Duplicate delivery of the same accepted work **MUST NOT** produce duplicate external effects. Hosts **MUST**
   dedupe on an identity that survives redelivery, per RFC 0150 effect identity.
8. Work that fails deterministically **MUST** reach a terminal, operator-visible state within a bounded number
   of attempts, and **MUST NOT** be redelivered indefinitely.

### §D The qualification ladder

A host **MAY** claim a rung only with the evidence named for it. Rungs are cumulative.

| rung | claim | evidence required |
|---|---|---|
| `durable-single-instance` | accepted work survives process death and resumes | kill-after-accept-before-dispatch, and kill-during-execution, both resuming within the declared recovery bound |
| `durable-multi-instance` | a *peer* instance resumes it, not only a restart of the same one | the above, executed with the resuming instance being a different process from the accepting one |
| `multi-region-qualified` | the above across a region boundary, with a stated RPO/RTO | the above plus a restore-from-backup and a region-evacuation exercise |

9. A host **MUST NOT** claim a rung on the basis of unit tests over its storage layer alone. Claim semantics
   asserted against a storage adapter are evidence about **the claim**, not about a live deployment.

### §E Advertisement — deliberately deferred

10. This RFC defines the ladder and its evidence. It **does not** mint a new advertised capability field.

> **Why.** RFC 0147 §A.1 freezes *new non-essential optional wire capabilities* until Workstreams 1–3 are
> Accepted, and that box is unticked. A qualification ladder is **evidence about behaviour that already
> exists**, so authoring it is specification work and is not reached by the freeze — but minting an advert would
> be, and would freeze this RFC behind its own field.
>
> Hosts therefore publish rung and recovery bound in their **conformance evidence bundle** (RFC 0148), where
> claims already live and where a claim without evidence is already a defect. A capability field, if wanted,
> is a one-field additive revision once the freeze lifts — deliberately left as the smaller, later change.

## Compatibility

**Additive.** No existing field changes meaning, no required field is added, and no host becomes non-conformant
by doing nothing. A host that declares no rung is simply unqualified, which is its status today.

The one behavioural requirement that could bite an existing host is §B.4 — declaring a recovery bound. A host
with no liveness mechanism can satisfy it immediately by declaring the bound it *already has* (its duration
ceiling), which is honest and is the point: it makes a twelve-minute recovery visible rather than unknown.

## Conformance

| scenario | asserts |
|---|---|
| `durability/kill-after-accept` | work accepted, process killed before dispatch, resumed within the declared bound |
| `durability/kill-during-execution` | killed mid-execution, resumed within the declared bound, **no duplicate external effect** |
| `durability/peer-resume` | the resuming instance is a *different process* — the `durable-multi-instance` discriminator |
| `durability/duplicate-delivery` | the same accepted work delivered twice fires each effect exactly once, asserted **per effect identity**, not by end state |
| `durability/poison-exhaustion` | deterministic failure reaches a terminal operator-visible state within the attempt bound |
| `durability/bound-is-derived` | the declared recovery bound matches the mechanism that enforces it — a host that states a bound it cannot produce **fails** |

`duplicate-delivery` asserts **invocation counts per identity**, not final state: a legal end state is exactly
what a double-fire produces, so an end-state assertion passes on the defect it exists to catch.

## Alternatives considered

- **Require a fast recovery bound (e.g. ≤ 60s).** Rejected: it selects for an architecture rather than a
  property, and a host that cannot meet it is pushed toward shortening a lease without a liveness signal —
  the exact unsafe fix in Motivation 3.
- **Mint `capabilities.durability.rung` now.** Rejected under RFC 0147 §A.1; see §E.
- **Fold this into RFC 0150.** Rejected: 0150 is about effect identity and split-brain *safety*; this is about
  *qualification* — what a host has demonstrated. Merging them would let a host inherit a durability claim from
  an idempotency implementation.

## Unresolved questions

1. Should the recovery bound be a single scalar, or per work class (run dispatch vs compensation vs outbox)?
   The reference host has different bounds per lane today.
2. Does `multi-region-qualified` require a *tested* evacuation, or a *rehearsed* one with recorded RPO/RTO?
3. Should §C.8's attempt bound be normative, or host-declared like the recovery bound?

## Implementation notes (non-normative)

The reference host satisfies §A today and does not satisfy §B.3: its lease is its only liveness proxy. Its
planned remedy is a heartbeat that renews the lease while work is active, keeping the advertised duration
ceiling unchanged (host ADR 0585). That ordering matters — the heartbeat first, the shorter reclaim threshold
second — and this RFC's §B is written so the reverse ordering is visibly non-conformant.

## Acceptance criteria

- [ ] Spec text, conformance scenarios, and the evidence-bundle fields land.
- [ ] At least one host executes every scenario in strict mode (RFC 0147 requirement 5 — shape-only evidence
      does not suffice).
- [ ] The `peer-resume` scenario is executed by a host running **two processes**, not two workers in one.
- [ ] `docs/KNOWN-LIMITS.md` and `INTEROP-MATRIX.md` updated with each host's declared rung and bound.
