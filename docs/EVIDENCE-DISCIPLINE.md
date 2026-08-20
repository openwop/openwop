# Conformance evidence that means something

> **This document is not about OpenWOP.** It describes a set of practices for
> making a conformance suite's results *mean* what a reader assumes they mean.
> Nothing in it depends on OpenWOP's workflow semantics; it applies to any
> protocol with a test suite and a claim to interoperability.
>
> It is published separately because the practices are the most portable thing
> this project has produced, and because they were each earned by a defect rather
> than designed in advance. Adopt, adapt, or argue with them.

## The defect these exist to prevent

One shape recurs across every instance:

> **The artifact reports, but not on what its reader assumes it measured.**

A green suite where the assertion never ran. A drift guard that silently stopped
guarding. A verifier that rejected the exact header its own specification
mandates. A recovery bound derived perfectly from a mechanism that had stopped
running. **Every one produced a passing signal**, which is why none was caught by
reading the output.

The practices below are the countermeasures, each with the failure that produced
it.

## 1. A pass must be non-vacuous

**Failure:** a scenario asserted inside a loop over events the host emitted none
of. Two hosts with **opposite** behaviour both passed, for months.

**Practice:** record an assertion count per requirement, and treat a pass with
zero assertions as an **unclassified return** rather than a pass. A test that
returned before asserting anything did not measure the host.

## 2. Distinguish the reasons a test did not run

**Failure:** "skipped" covered four different situations — capability not
advertised, seam not wired, operator opt-out, harness error — and a reader could
not tell which.

**Practice:** type the dispositions. `executed-pass`, `executed-fail`,
`skipped`, `inapplicable`, `blocked` are distinguishable, and **anything other
than a pass must carry a reason string.** An unexplained non-result is an outcome
nobody can act on. Publish blocked rows rather than omitting them: `blocked`
means *unobservable*, not *unmet*.

## 3. Derive claims; do not accept declarations

**Failure:** none, because this was designed in — and it is the practice with the
highest leverage.

**Practice:** compute what a host claims **from its own discovery document**,
not from a list it supplies. A host cannot over-claim in a bundle whose claims it
does not author. This removes an entire category of dispute without any
enforcement machinery.

## 4. Ask whether the condition is *causable*, not only whether the property is *observable*

**Failure:** four scenario designs in one day, always in the same direction.
Duplicate external effects are perfectly observable — but a suite cannot make a
host's queue redeliver accepted work, so a client retry witnesses a different
mechanism wearing the same name.

**Practice:** for every requirement, name **the observable** and **who can cause
the condition**, separately. If the condition needs a seam, an operator
precondition, or a process death, say so and gate on it. Do not substitute the
nearest causable thing.

## 5. A negative assertion needs a positive control in the same test

**Failure:** none yet, because the rule was applied first — but the trap is
severe. "Nothing arrived" passes identically when nothing could have arrived: a
wrong URL, a subscription never created, a receiver never reached.

**Practice:** prove presence on the exact wiring before asserting absence, in
**one** test against **one** subject. Splitting them into separate blocks
re-establishes the wiring, and a silent re-establishment failure turns the
negative back into a vacuous pass.

## 6. Verify a sabotage is present before trusting a red — or a green

**Failure:** a patch asserted a unique match on a string occurring three times,
threw, never applied, and the rebuild-and-run passed against **unmodified code**
— one step from reporting "the test does not catch this", the opposite of the
truth.

**Practice:** **a sabotage that silently fails to apply is indistinguishable from
a test that fails to catch.** Both produce a green, and the green is what you are
looking at. Grep for the injected marker before running. Sabotage verification
needs its own positive control, for the same reason the test under it does.

## 7. Where a scenario has a runtime floor, wall-clock refutes disposition

**Failure:** a scenario carrying a 1.5 s grace plus a 6 s quiet window reported a
green in **41 ms**.

**Practice:** a pass faster than the test's own arithmetic minimum did not
happen. This costs nothing, needs no instrumentation, and catches soft-skips that
look like passes.

## 8. Evidence attributes to a build, not to a commit

**Failure:** two builds of one commit, with byte-identical configuration, scored
**283/22 and 303/2** — the container build used a non-lockfile-respecting install,
so the two resolved different dependency trees. Nothing in either result could
distinguish them.

**Practice:** record what actually executed. In rough order of strength: an image
digest (unavailable if evidence is baked before the image exists), a builder id,
or **a digest of the resolved dependency manifest** — which is available exactly
when a baked artifact is written, and addresses the failure directly. Say which
kind you recorded.

## 9. A pointer is a claim, and claims need checking

**Failure:** 79 of 184 invariants cited a threat model that never mentioned them.
Separately, a host's advertised evidence URL returned an HTTP 200 page that was
not the evidence.

**Practice:** check the pointers mechanically. Where the debt is too large to fix
at once, **ratchet**: fail if the count grows, and fail if it shrinks without the
baseline being lowered — the second half is what keeps the number a measurement
rather than a decaying comment.

## 10. Do not let a suite be stricter than the specification

**Failure:** a scenario required a response field the API contract does not
define. A host implementing **only the published contract** failed at the first
assertion; the reference host passed because it happened to return both spellings.

**Practice:** state as policy that the suite may not be stricter about wire shape
than the spec, and treat a conforming-host failure as a suite bug until proven
otherwise. **When a conforming host fails and a lenient one passes, suspect the
oracle before the host** — and note that a reference implementation's
compatibility shim will hide a contract error from everyone who is not equally
lenient.

## 11. Prose beside code has no gate

**Failure:** five instances in one review cycle. A comment claimed a knob reached
call sites it never reached; a docblock named a header the assertion had stopped
checking; a line claimed an explicit record wins, and it won in half the cases.

**Practice:** treat comment-versus-code as a defect class, and note the severity
axis inside it — **a wrong comment that cites its authority is armoured.** The
reader follows the citation, finds a real specification section, and stops there.
It defends the error with the artifact that refutes it. Quote the clause you rely
on rather than naming the section, and when correcting such a comment, record
that the citation was wrong instead of silently repointing it.

---

## What this adds up to

None of these is clever. Each is a small refusal to accept a signal at face
value, and the cumulative effect is a suite whose green means something specific
enough to argue with.

The honest caveat: **these were all learned by being wrong first**, and the list
is certainly incomplete. If you are adopting them, the practice underneath all
eleven is the one worth taking: *when an artifact reports something good, ask
what it would have reported had the thing been bad* — and if the answer is "the
same", the artifact is not evidence.
