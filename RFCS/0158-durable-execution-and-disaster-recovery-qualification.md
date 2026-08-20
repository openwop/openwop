# RFC 0158: Durable Execution and Disaster-Recovery Qualification

| Field             | Value                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| **RFC**           | 0158                                                                     |
| **Title**         | Durable Execution and Disaster-Recovery Qualification                    |
| **Status**        | `Active`                                                                  |
| **Author(s)**     | openwop-app-f4 (host maintainer, reference host)                         |
| **Created**       | 2026-08-18                                                               |
| **Updated**       | 2026-08-20 — §Conformance witness discipline (revised on reference-host review): recovery rows worded on the observable property not the trigger, `kill-after-accept` is a hold-dispatch row, seam gated on an unnamed deployment-time flag (fail-closed) rather than a second env name, declared operator preconditions with `blocked`-not-`inapplicable` disposition, `peer-resume` bundle-witnessed via an opaque per-boot token (no discovery field, §E.10), and acceptance scoped per-claimed-rung so the `durable-single-instance` witness graduates the RFC. · **`Draft → Active`** 2026-08-20 (window-waived, additive per §Compatibility): witness discipline settled and reviewed by the openwop-app reference host, which is witnessing the `durable-single-instance` rung (`kill-during-execution` observed non-vacuously across a real `SIGKILL`); `Accepted` gates on the non-vacuous single-instance bundle. · §Conformance note added: the recovery interval is measured kill → **resumption** (first re-execution observation, e.g. a second `run.started`), never kill → terminal — from a second tier-1 measured failure where time-to-terminal read as a false §B.5 violation. |
| **Affects**       | `spec/v1/replay.md`, `spec/v1/idempotency.md`, `spec/v1/storage-adapters.md`, `capabilities.md`, conformance `durability/*` |
| **Compatibility** | `additive`                                                               |
| **Supersedes**    | —                                                                        |
| **Superseded by** | —                                                                        |

> **Renumbered `0162` → `0158` on 2026-08-19.** This RFC was minted at 0162 against a planned block
> 0158–0161 that was never authored and, on the dossier's own analysis, will not be: 0159 is folded into
> RFC 0150 §D, 0160 restates RFC 0154 §E/UQ3, and 0161 is v2 work. Leaving a four-number hole to reserve
> RFCs that were argued *against* would have made the gap permanent and unexplained. External references
> to "RFC 0162" — reference-host ADRs, branch names, and an open host PR — predate the change and mean
> this document. Nothing about its content moved; it was `Draft` and unreleased when renumbered, so no
> tagged corpus release ever carried the old number.

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

> **These rungs are a THIRD axis, orthogonal to two vocabularies they will be read beside.** Naming them here
> because the next reader will otherwise ask whether this re-mints something the corpus already has — the
> question that folded proposed RFC 0159 into RFC 0150 §D.
>
> - **Scale profiles** (`minimal` / `production` / `high-throughput`) describe *how much load* a host is built
>   for. `production-profile.md` §"Durability" is the very MUST this RFC qualifies, so that document is the most
>   likely to be co-read — and it uses "production" for capacity, not for durability evidence. **A `minimal`
>   host may be `durable-multi-instance`; a `high-throughput` host may be unqualified.**
> - **`capabilities.idempotency.crossRegion`** (`single-region` / `reconciled-records` / `fenced-effects`)
>   describes *what happens to effects across a partition*. `multi-region-qualified` sits one word from
>   `single-region` and means something else: the crossRegion enum is a **safety posture**, this rung is
>   **demonstrated recovery**. A host may be `fenced-effects` and hold no rung, having never run the exercises.
>
> Scale is capacity, `crossRegion` is effect safety, a rung is evidence. A host's position on each says nothing
> about the other two.

A host **MAY** claim a rung only with the evidence named for it. Rungs are cumulative.

| rung | claim | evidence required |
|---|---|---|
| `durable-single-instance` | accepted work survives process death and resumes | kill-after-accept-before-dispatch, and kill-during-execution, both resuming within the declared recovery bound |
| `durable-multi-instance` | a *peer* instance resumes it, not only a restart of the same one | the above, executed with the resuming instance being a different process from the accepting one |
| `multi-region-qualified` | the above across a region boundary, with a stated RPO/RTO | the above plus a restore-from-backup and a region-evacuation exercise |

9. A host **MUST NOT** claim a rung on the basis of tests **in which no process was actually terminated**.
   Claim semantics asserted without a process death are evidence about **the claim**, not about recovery.

   > Reworded from "unit tests over its storage layer alone", which named the *artifact* rather than the
   > property and was therefore satisfiable by unit-testing a lease helper instead. It also generalises: a host
   > whose durability comes from an external orchestrator has no storage adapter to unit-test, and the earlier
   > wording would have been trivially satisfied rather than meaningfully met.

### §E Advertisement — deferred by design

10. This RFC defines the ladder and its evidence. It **does not** mint a new advertised capability field.

> **Why.** A qualification ladder is **evidence about behaviour that already exists**, so the useful place for
> a rung and a recovery bound is the host's **conformance evidence bundle** (RFC 0148) — where claims already
> live, and where a claim without evidence is already a defect. A discovery field would let a host assert a rung
> with nothing behind it, which is the failure this RFC exists to prevent.
>
> A capability field remains available as a later one-field additive revision if bundle-only publication proves
> insufficient in practice. It is deliberately the smaller, later change, and it would need the falsifiability
> table `RFCS/0000-template.md` requires — which this surface needs more than most: **four of the six rows in
> §Conformance require a process termination the black-box suite cannot cause.**

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

> **What `bound-is-derived` cannot catch** *(added 2026-08-19, from a measured failure on a tier-1 host)*. This
> row checks that the declared number follows from the mechanism. It cannot check that **the mechanism runs.** A
> host whose sweeper wedges — one lane's await never settling, leaving a shared re-entry flag set, with nothing
> logged because nothing threw — has a derivation that stays perfectly correct while the bound is not produced at
> all. A run sat unclaimed for 16 minutes against a derived bound of 12.5, and every isolated check of the
> mechanism passed: the storage query returned the run as claimable, the sweep function reclaimed it on a
> reproduced state, and a fresh daemon reclaimed a seeded orphan in 24 s.
>
> **Only an exercise that actually kills a process and waits out the bound distinguishes the two cases.** That is
> the strongest argument yet for §D.9's insistence on real process termination — and, for the conformance suite,
> for the kill seam the recovery rows need: `bound-is-derived` is a paper check by construction, and no amount of
> strengthening makes it a liveness check. `storage-adapters.md` §"Expiry is authority; the sweeper is the
> exercise of it" carries the normative consequence.

`duplicate-delivery` asserts **invocation counts per identity**, not final state: a legal end state is exactly
what a double-fire produces, so an end-state assertion passes on the defect it exists to catch.

### Witnessing the recovery rows *(added 2026-08-20)*

The three recovery rows — `kill-after-accept`, `kill-during-execution`, `peer-resume` — need a process
termination the black-box suite cannot itself cause (§E), so a host under test exposes a **conformance fixture
seam** the suite drives. The requirements below are written on the **observable property**, not on any
particular trigger: hosts differ in whether a run is served synchronously or accepted asynchronously, so a
requirement phrased on "the request that is killed" would describe one host's mechanism and force another to
fake it. What the suite observes is what is normative.

11. **A real process termination MUST have occurred, and no in-flight work is ever reported complete.** The
    seam performs a genuine `exit` / signal, not a simulated one. **Work that was accepted or executing when
    the process died MUST NOT be observable as completed or successful**, and resumption MUST be observed on a
    **subsequent** observation within the declared recovery bound. How the kill is triggered — a killed request,
    an out-of-band signal to an async worker, a supervisor — is the host's choice; asserting recovery without a
    real death is the "claim semantics asserted without a process death" §D.9 rejects.

    - `kill-during-execution` witnesses a **termination** while work executes.
    - `kill-after-accept` is a **hold-dispatch** row, not a termination-timing row: on hosts where acceptance
      and dispatch are microseconds apart, the seam **MUST hold dispatch**, take the kill during the hold, and
      show the accepted-but-undispatched work dispatching on resume. A seam that races a kill into that window
      cannot reliably hit it and must not pretend to.

    > **The measured interval is kill → *resumption*, never kill → *terminal*** *(added 2026-08-20, from a
    > second measured failure on a tier-1 host)*. §B.4 bounds the interval until another instance becomes
    > eligible to **resume** the work — not until the work **finishes**. Timing `kill → terminal status` adds
    > the work's own execution time to the recovery interval, and a host whose runs do real work will then
    > report an observed figure that exceeds its own derived bound and reads as a §B.5 violation that did not
    > happen. The witness **MUST** record the interval to the **first observation that the work is being
    > re-executed** — a subsequent run-lifecycle re-start on the same run id (a second `run.started`), or any
    > equivalent progress-past-the-pre-kill-point signal — and **MUST NOT** substitute time-to-completion. A
    > resumption observation of this kind needs no seam and no new field; it is exactly the "resumption observed
    > on a **subsequent** observation" item 11 requires. It does **not** discriminate a *peer*: a second
    > `run.started` cannot tell "a different process resumed" from "the same process restarted", so it does not
    > substitute for `peer-resume`'s opaque per-boot token.

12. **The seam MUST be gated on a deployment-time flag that is unset in production, and MUST be fail-closed.**
    This RFC names no specific environment variable — a host that already gates a test seam (e.g. a boot-read
    flag) rides that gate; minting a second flag for one boundary is itself a hazard, since one gets set in a
    context the other does not and the fail-closed property silently stops holding (the shared-flag failure
    RFC 0144 and `SECURITY/threat-model-secret-leakage.md` name). The gate MUST be a deployment-time property
    (read at boot / per-revision), **not** a per-request toggle: a self-terminating endpoint reachable in
    production is a denial-of-service surface.

The seam is a **non-normative host-extension route** (`host-extensions.md`): it advertises nothing, this RFC
mints no capability field for it (§E.10), and a host that never runs the durability exercises exposes no such
route. It is test infrastructure, not protocol surface — which is why a host may implement it before this RFC
reaches `Accepted` without advertising a claim it cannot yet defend.

**Operator preconditions are declared, not hidden.** These rows do not run against an unattended black-box host
unchanged: `kill-after-accept` / `kill-during-execution` need a **restart supervisor** (a black-box suite
cannot itself restart a killed single instance — something must, e.g. the harness as parent process), and
`peer-resume` needs **two live instances at the moment the kill lands**. A row whose operator precondition is
unmet is **`blocked`** with the precondition **named** (the disposition shape `production-profile.md` uses for
`OPENWOP_WEBHOOK_ALLOW_PRIVATE`), never silently skipped or reported as a pass.

**`peer-resume` disposition and witness.** `peer-resume` is the `durable-multi-instance` discriminator (§D). It
is **not** `inapplicable` to a host with the mechanism — it is **`blocked` on the ≥2-live-instances
precondition**; a host that never claims `durable-multi-instance` simply does not run it. Witnessing that a
*different process* resumed the work needs a per-boot observable, and there is none on the wire today.
Per §E.10's deferral of new discovery fields to a later, smaller revision, **this RFC does NOT add a discovery
field for it**: the resuming instance's opaque per-boot incarnation token (opaque, never a raw pid — a pid
leaks infrastructure) is recorded in the host's **RFC 0148 evidence bundle** alongside `recoveryBoundTerms()`,
together with the continuous-reachability trace that shows the service never went down across the kill. So
`peer-resume` is **bundle-witnessed**, and the table reads it as such; a discovery `processIncarnation` field,
with its own falsifiability table, remains the deferred later revision §E.10 anticipates should black-box
witnessing ever be wanted.

**`bound-is-derived` evidence.** The derivation — the per-class arithmetic, not a single total (Unresolved
Question 1) — is emitted into the host's RFC 0148 evidence bundle, where a reader can recompute it. It is
**not** advertised as a discovery field (§E.10). Per the note above, this row is a paper check and **MUST NOT**
be cited as evidence that the recovery mechanism runs; only the kill rows witness that.

## Alternatives considered

- **Require a fast recovery bound (e.g. ≤ 60s).** Rejected: it selects for an architecture rather than a
  property, and a host that cannot meet it is pushed toward shortening a lease without a liveness signal —
  the exact unsafe fix in Motivation 3.
- **Mint `capabilities.durability.rung` now.** Rejected in favour of bundle-first publication; see §E.
- **Fold this into RFC 0150.** Rejected: 0150 is about effect identity and split-brain *safety*; this is about
  *qualification* — what a host has demonstrated. Merging them would let a host inherit a durability claim from
  an idempotency implementation.

## Unresolved questions

1. ~~Should the recovery bound be a single scalar, or per work class?~~ **Resolved 2026-08-18: PER WORK CLASS,
   and §B.5 already derives it.** "The recovery bound MUST be derived from the mechanism that enforces it" —
   and the corpus has at least two independent enforcing mechanisms (the run/dispatch claim lease,
   `storage-adapters.md` §"Claim acquisition"; the Layer-1 idempotency record's own lease, `idempotency.md`).
   Several mechanisms, therefore several bounds. **A single scalar would have to be the maximum, which
   overstates recovery for every faster class — a lie by aggregation, which is the failure this RFC exists to
   stop.** A host with one mechanism declares one bound; that is the degenerate case, not the general one.
2. ~~Does `multi-region-qualified` require a *tested* evacuation, or a *rehearsed* one?~~ **Resolved
   2026-08-19: TESTED — traffic MUST actually be served from the surviving region, with RPO/RTO MEASURED
   rather than declared.** §D.9 already derives this: it refuses a rung claimed on "tests in which no process
   was actually terminated", so a region that was never left cannot qualify the rung above. A rehearsal that
   moves no traffic is a runbook review, and accepting it would make the ladder inconsistent with its own
   lowest rung.

   **PLANNED is fine; SIMULATED is not.** A scheduled failover drill in which the secondary genuinely serves
   traffic satisfies this; an unplanned outage is not required. The bar is *did the traffic move*, not *did the
   host suffer* — which is also how disaster recovery is qualified in practice.
3. ~~Should §C.8's attempt bound be normative, or host-declared?~~ **Resolved 2026-08-19: HOST-DECLARED, with
   two normative constraints — it MUST be finite, and it MUST be derived from the mechanism that enforces it.**
   §B.6 already settled this pattern for the recovery bound ("a host MAY declare a bound of any length; a long
   bound is conformant, an undeclared or unenforced one is not"), and a fixed number would select for an
   architecture: three attempts is right for expensive external effects, fifty for cheap idempotent work.
   Selecting for an architecture is precisely what this RFC declined to do when it refused to mandate a fast
   recovery bound.

   **The two constraints exist because this bound is NOT symmetric with the recovery bound**, and the asymmetry
   is the whole reason to write them down. A slow recovery bound is harmless — it delays resumption and says so.
   An attempt bound declared as effectively infinite would satisfy a bare declaration requirement while
   reproducing the unbounded-redelivery failure §C.8 exists to stop. Finiteness is the property that matters;
   the §B.5 derivation rule stops a host declaring a number nothing enforces.

## Implementation notes (non-normative)

The reference host satisfies §A today and does not satisfy §B.3: its lease is its only liveness proxy. Its
planned remedy is a heartbeat that renews the lease while work is active, keeping the advertised duration
ceiling unchanged (host ADR 0585). That ordering matters — the heartbeat first, the shorter reclaim threshold
second — and this RFC's §B is written so the reverse ordering is visibly non-conformant.

## Acceptance criteria

- [ ] Spec text, conformance scenarios, and the evidence-bundle fields land.
- [ ] At least one host executes, in strict mode, **every scenario applicable to the rung(s) it claims** (RFC
      0147 requirement 5 — shape-only evidence does not suffice). Witnessing the **`durable-single-instance`**
      rung — `kill-after-accept`, `kill-during-execution`, `duplicate-delivery`, `poison-exhaustion`, and
      `bound-is-derived` — is sufficient to accept this RFC. The higher rungs are **defined-but-unclaimed** until
      a host at that rung witnesses them; because §E.10 mints no capability field, an unwitnessed rung advertises
      nothing and so cannot be a vacuous claim.
- [ ] **Gating the `durable-multi-instance` rung (not this RFC's acceptance):** no host claims that rung until
      `peer-resume` is witnessed by a host running **two processes**, not two workers in one. A host that cannot
      guarantee a second live instance at kill time marks the row `inapplicable` and holds only the lower rung.
- [ ] `docs/KNOWN-LIMITS.md` and `INTEROP-MATRIX.md` updated with each host's declared rung and bound.
