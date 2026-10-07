# External Host Recruitment — Outreach Drafts

> **Status: drafts ready; not sent.** Send all four in the same week. The first positive reply gets the steward's full attention; the rest stay warm.
>
> A recruitment letter is an outbound claim about the project, and it ages like any other. These drafts point at dated, re-derivable measurements (`INTEROP-MATRIX.md`, the published suite) instead of quoting pass rates. Re-check every figure below against the tree on the day you send.

The vendor-neutral-org migration tripwire (`ROADMAP.md` §"Vendor-neutral org migration") fires when `MAINTAINERS.md` lists at least one maintainer not affiliated with OpenWOP. The most credible path there is one non-steward host: a different team running its own OpenWOP v2 server, ideally on a different durable-execution runtime. It adds a third-party row to `INTEROP-MATRIX.md` and turns "very good documentation by one team" into "a protocol other teams trust." The same first non-steward implementation is the cross-host evidence that multi-agent portability claims still lack.

## Candidate tiers

Ordered by narrative leverage × likely receptivity.

### Tier 1 — LangChain / LangGraph adapter

**Why first:** OpenWOP borrowed several of its idioms from LangGraph (stream modes, the `interrupt(payload)` HITL primitive, typed channels with reducers, replay and fork from a checkpoint) and the `configurable` per-run overlay from LangChain. A LangGraph-backed OpenWOP host shows publicly that those idioms carry over, and gives every LangGraph user a portable wire contract.

**Outreach target:** the LangChain team's `langgraph` repo discussions (<https://github.com/langchain-ai/langgraph/discussions>) or `info@langchain.com`.

**Subject:** LangGraph ↔ OpenWOP adapter — proof-of-portability proposal

**Body:**

Hi team,

OpenWOP (<https://github.com/openwop/openwop>) is an open wire-level protocol for multi-agent workflow orchestration, now at version 2. Several of its idioms come straight from LangGraph: the stream modes, the `interrupt(payload)` HITL primitive, `Annotated[T, reducer]` channels and reducers, and `update_state(checkpoint, ...)` replay and fork. The per-run `configurable` overlay comes from LangChain's `RunnableConfig`.

I'd like to show those idioms carry over. An OpenWOP host backed by a LangGraph runtime would:

1. Give every LangGraph user a portable wire contract: the same workflow runs on any OpenWOP host.
2. Have public evidence: the `@openwop/openwop-conformance` suite (<VERSION — check npm on the send date>) is capability-gated, so a host is measured only against what it advertises. Per-host results, with suite version and date, are in `INTEROP-MATRIX.md`; I'd rather point you at a dated measurement than quote a number that ages.
3. Be the first non-steward host in `INTEROP-MATRIX.md`, which fires our vendor-neutral-org governance tripwire and opens the path to a working group.

A useful first cut is small: the core run surface plus interrupts, as a bridge over the LangGraph runtime. The main translations are LangGraph's checkpoint store to OpenWOP's run event log, LangGraph's interrupt to OpenWOP's interrupt protocol, and `Annotated[T, reducer]` to OpenWOP's channels and reducers (which OpenWOP borrowed from you). The v2 reference host (<https://github.com/openwop/openwop-examples/tree/main/examples/hosts/v2-reference>) shows the full surface.

I'm happy to:

- Write the first cut as a draft PR against a LangGraph adapter repo of your team's choice.
- Support someone on your team who wants to own it; I'll handle the spec questions and the conformance gate.
- Land it under whichever org you prefer; doesn't need to be in the OpenWOP repo.

Even a "we'll watch but not own this" reply is useful — it tells me whether to invest in a steward-owned adapter or wait for community demand. **If interested in a longer conversation, reply with two or three windows that work for a 30-minute call or propose three windows.**

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Spec: <https://github.com/openwop/openwop>
Running OpenWOP on a durable runtime: <https://github.com/openwop/openwop/blob/main/docs/integrations/durable-runtimes.md>

---

### Tier 2 — Restate

**Why second:** Restate is a durable-execution runtime with operational depth OpenWOP doesn't try to compete with. A Restate-backed OpenWOP host tests the claim that OpenWOP runs on Temporal-class durability runtimes ([`docs/integrations/durable-runtimes.md`](../integrations/durable-runtimes.md)). Restate's team is small enough to commit quickly, and its public posture is partnership-oriented.

**Outreach target:** Restate's contact form at <https://restate.dev/contact/> or `community@restate.dev`.

**Subject:** OpenWOP host on Restate — durable-execution partnership proposal

**Body:**

Hi Restate team,

OpenWOP (<https://github.com/openwop/openwop>) is an open wire-level protocol for multi-agent workflow orchestration, now at version 2. Our durable-runtimes guide names Restate as one of the runtimes an OpenWOP host maps onto cleanly. I'd like to make that concrete.

A Restate-backed OpenWOP host would:

1. Give Restate users a portable wire contract: the same OpenWOP workflows that run on our reference hosts run on Restate, with Restate's durability underneath.
2. Be the first OpenWOP host on a dedicated durable-execution runtime, measured by the public conformance suite.
3. Be the first non-steward host in `INTEROP-MATRIX.md`, which fires our governance migration tripwire.

The adapter is TypeScript or Rust, your team's call. The main translations are Restate's journal to OpenWOP's run event log, awakeables to OpenWOP's interrupt protocol, and keyed services to per-run ownership.

I'm happy to:

- Write the first cut as a draft PR against a Restate-OpenWOP-adapter repo your team owns.
- Land it under your org; doesn't need to be in the OpenWOP repo.
- Author the conformance evidence + the INTEROP-MATRIX submission.

**If interested, reply with two or three windows that work for a 30-minute call and I will send an invite — even a "not now but check back in Q3" reply is useful.**

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Spec: <https://github.com/openwop/openwop>
Running OpenWOP on a durable runtime: <https://github.com/openwop/openwop/blob/main/docs/integrations/durable-runtimes.md>

---

### Tier 3 — DBOS

**Why third:** DBOS's transactional-Postgres approach to durable execution maps directly onto an OpenWOP host's run event log and suspend/resume; it is closer to a database-native workflow runtime than Temporal. The DBOS team is small and receptive to open-source partnerships.

**Outreach target:** DBOS contact form at <https://www.dbos.dev/contact> or <peter@dbos.dev> (founder).

**Subject:** OpenWOP host on DBOS — durable workflow proposal

**Body:**

Hi DBOS team,

OpenWOP (<https://github.com/openwop/openwop>) is an open wire-level protocol for multi-agent workflow orchestration, now at version 2. DBOS's transactional-Postgres approach maps cleanly onto an OpenWOP host: your `dbos.workflow()` checkpoints and an OpenWOP run's event log and suspend/resume line up at the storage layer.

A DBOS-backed OpenWOP host would:

1. Give DBOS users a portable AI-workflow wire contract on top of DBOS's transactional durability.
2. Take Postgres-backed OpenWOP past our single-process example host (<https://github.com/openwop/openwop-examples/tree/main/examples/hosts/postgres>) to multi-process scale-out.
3. Be the first non-steward host in `INTEROP-MATRIX.md`, which fires our governance tripwire.

The adapter is Python or TypeScript, your team's pick. The main translations are DBOS workflow functions to OpenWOP runs, DBOS steps to OpenWOP node executions, and transaction-wrapped state to OpenWOP's channels and reducers.

I'm happy to:

- Write the first cut as a draft PR against a DBOS-OpenWOP-adapter repo.
- Land it under your org.
- Author the conformance evidence + INTEROP-MATRIX submission.

**If interested, reply with two or three windows that work for a 30-minute call or propose three windows. Even a "not a fit right now" reply is useful — it sharpens the recruitment shortlist.**

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Spec: <https://github.com/openwop/openwop>

---

### Tier 4 — Inngest

**Why fourth:** Inngest's TypeScript-native, event-driven runtime fits OpenWOP's SSE-first wire surface: `step.run()` maps to OpenWOP nodes and `step.waitForEvent()` to interrupts. Large TypeScript install base, low adoption friction.

**Outreach target:** <hello@inngest.com> or via their Discord community.

**Subject:** OpenWOP host on Inngest — TS-native AI-workflow proposal

**Body:**

Hi Inngest team,

OpenWOP (<https://github.com/openwop/openwop>) is an open wire-level protocol for multi-agent workflow orchestration, now at version 2. Inngest's TS-native event-driven model is the natural shape for OpenWOP's SSE-first wire surface — `inngest.step.run()` lines up with OpenWOP nodes, `inngest.step.waitForEvent()` with OpenWOP interrupts, and Inngest's keyed events with OpenWOP's signed-token callback resume.

An Inngest-backed OpenWOP host would:

1. Give Inngest users a portable wire contract — OpenWOP workflows running on Inngest's durable infrastructure with their existing observability + retry semantics.
2. Be the first non-steward host in `INTEROP-MATRIX.md`, firing our governance migration tripwire.
3. Test OpenWOP's SSE-first event stream (<https://github.com/openwop/openwop/blob/main/spec/v2/core/events.md>) against a natively event-driven runtime.

The adapter is TypeScript. The main translations are Inngest steps to OpenWOP nodes, event-keyed resume to OpenWOP's signed-token callback, and persistent step state to OpenWOP's run event log.

Happy to write the first cut as a draft PR against an Inngest-OpenWOP-adapter repo your team owns.

**If interested, reply with two or three windows that work for a 30-minute call or propose three windows. Even a "interesting but not now" reply helps me sequence the recruitment work.**

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Spec: <https://github.com/openwop/openwop>

---

## Send checklist

1. Send all four in the same week (Tuesday/Wednesday for highest reply rate).
2. Track replies in `MAINTAINERS.md` §"Recruitment log".
3. First positive reply → schedule 30-minute scoping call, commit to a 2-week PR draft window.
4. The other three stay warm; reply with a follow-up if 3 weeks pass without contact.

## After a successful recruitment

When a third-party host passes conformance + commits to maintaining:

1. Add the host to `INTEROP-MATRIX.md`.
2. If their maintainer wants ongoing involvement, add them to `MAINTAINERS.md` as a reviewer (no commit rights) per `GOVERNANCE.md` §"Roles". If they want commit rights to their host's directory, that's the maintainer-promotion path.
3. **Trigger the governance tripwire:** open the vendor-neutral-org migration RFC per `RFCS/0001-rfc-process.md` (`ROADMAP.md` §"Vendor-neutral org migration").

## See also

- `MAINTAINERS.md` §"Recruitment log" — per-target reply tracking
- `INTEROP-MATRIX.md` — the matrix the new host gets added to
- [`docs/integrations/durable-runtimes.md`](../integrations/durable-runtimes.md) — mapping an OpenWOP host onto Temporal, Restate, DBOS or Inngest
- `ROADMAP.md` §"Vendor-neutral org migration" — the tripwire definition
