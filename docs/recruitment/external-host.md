# External Host Recruitment — Outreach Drafts

> **Status: drafts ready, not yet sent (2026-05-11).** Send all four in week 1 of the recruitment round in parallel. First positive reply gets the steward's full attention; the rest stay warm.

The vendor-neutral-org migration tripwire in `MAINTAINERS.md` activates when ≥1 maintainer is not affiliated with OpenWOP. The most credible path to that is recruiting one non-steward host implementation: a different team running their own OpenWOP-compliant server, ideally on top of a different durable-execution runtime.

This is **the highest-leverage move in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`** — it unblocks Phase 4 (governance migration), adds a third-party row to `INTEROP-MATRIX.md`, and converts the "very good documentation by one team" framing into "a protocol other teams trust."

## Candidate tiers

Ordered by narrative leverage × likely receptivity.

### Tier 1 — LangChain / LangGraph adapter

**Why first:** `README.md` already cites LangGraph for six borrowed idioms (stream modes, channels-and-reducers, interrupts, `configurable`, replay/fork-from-checkpoint, the four-action approval vocabulary). `spec/v1/positioning.md` says explicitly: "LangGraph can be a client of an OpenWOP host." A LangGraph→OpenWOP adapter validates that claim publicly and gives every LangGraph user a portable wire contract.

**Outreach target:** the LangChain team's `langgraph` repo discussions (https://github.com/langchain-ai/langgraph/discussions) or `info@langchain.com`.

**Subject:** LangGraph ↔ OpenWOP adapter — proof-of-portability proposal

**Body:**

Hi team,

OpenWOP (https://github.com/openwop/openwop) is an open wire-level protocol for multi-agent workflow orchestration. The README cites LangGraph for six borrowed idioms (stream modes, channels-and-reducers, interrupts, `configurable`, replay/fork-from-checkpoint, the four-action approval vocabulary). The positioning doc says explicitly: "LangGraph can be a client of an OpenWOP host."

I'd like to make that real. An OpenWOP host backed by a LangGraph runtime would:

1. Give every LangGraph user a portable wire contract — workflows defined in LangGraph can run on any OpenWOP-compliant host, including LangSmith / LangGraph Cloud.
2. Pass the `@openwop/openwop-conformance` suite as evidence; the SQLite reference host currently passes 576 of 661 tests (87%).
3. Be the first non-steward host in OpenWOP's `INTEROP-MATRIX.md`, which fires our vendor-neutral-org governance migration tripwire and unlocks the path to a working-group governance model.

The adapter would be ~700–1,000 LOC TypeScript modeled on `examples/hosts/sqlite/` (~1,900 LOC, single dep). The big translation chunks: LangGraph's checkpoint store → OpenWOP's `RunEventLogIO`; LangGraph's interrupt → OpenWOP's interrupt protocol (4 kinds, 5-action approval vocab); LangGraph's `Annotated[T, reducer]` → OpenWOP's channels-and-reducers (which OpenWOP borrowed from you).

I'm happy to:
- Write the first cut as a draft PR against a LangGraph adapter repo of your team's choice.
- Support someone on your team who wants to own it; I'll handle the spec questions and the conformance gate.
- Land it under whichever org you prefer; doesn't need to be in the OpenWOP repo.

Even a "we'll watch but not own this" reply is useful — it tells me whether to invest in a steward-owned adapter or wait for community demand.

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Spec: https://github.com/openwop/openwop
Positioning + LangGraph cross-reference: https://github.com/openwop/openwop/blob/main/spec/v1/positioning.md

---

### Tier 2 — Restate

**Why second:** Restate is a durable-execution runtime with operational depth OpenWOP doesn't try to compete with. A Restate-backed OpenWOP host validates the "OpenWOP runs on Temporal-class durability runtimes" claim from `positioning.md`. Restate's team is small enough to commit quickly + their public posture is partnership-oriented.

**Outreach target:** Restate's contact form at https://restate.dev/contact/ or `community@restate.dev`.

**Subject:** OpenWOP host on Restate — durable-execution partnership proposal

**Body:**

Hi Restate team,

OpenWOP (https://github.com/openwop/openwop) is an open wire-level protocol for multi-agent workflow orchestration. The positioning doc names Restate explicitly as one of the durable-execution runtimes OpenWOP composes with cleanly. I'd like to make that concrete.

A Restate-backed OpenWOP host would:

1. Give Restate users a portable wire contract — the same OpenWOP workflows that run on the SQLite reference host run on Restate, with Restate's durability guarantees underneath.
2. Validate OpenWOP's "production-profile" claim (currently Provisional in `spec/v1/production-profile.md`) — Restate has the multi-tenant + backpressure + retry-durability properties the profile requires.
3. Be the first non-steward host in `INTEROP-MATRIX.md`, which fires our governance migration tripwire.

The adapter would be ~800-1,200 LOC TypeScript or Rust (your team's call). The translation: Restate's persistent invocations → OpenWOP's `RunEventLogIO`; Restate's awakeables → OpenWOP's interrupt protocol; Restate's keyed services → OpenWOP's per-run claim acquisition.

I'm happy to:
- Write the first cut as a draft PR against a Restate-OpenWOP-adapter repo your team owns.
- Land it under your org; doesn't need to be in the OpenWOP repo.
- Author the conformance evidence + the INTEROP-MATRIX submission.

Worth a 30-minute scoping call?

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Spec: https://github.com/openwop/openwop

---

### Tier 3 — DBOS

**Why third:** DBOS's transactional-Postgres approach to durable execution maps directly onto OpenWOP's `RunEventLogIO` + `SuspendIO` contracts; their model is closer to a database-native workflow runtime than Temporal's. The DBOS team is small + receptive to OSS partnerships.

**Outreach target:** DBOS contact form at https://www.dbos.dev/contact or peter@dbos.dev (founder).

**Subject:** OpenWOP host on DBOS — durable workflow proposal

**Body:**

Hi DBOS team,

OpenWOP (https://github.com/openwop/openwop) is an open wire-level protocol for multi-agent workflow orchestration. DBOS's transactional-Postgres approach to durable execution maps cleanly onto OpenWOP's storage-adapter contract — your `dbos.workflow()` decorators and OpenWOP's `RunEventLogIO` + `SuspendIO` are isomorphic at the storage layer.

A DBOS-backed OpenWOP host would:

1. Give DBOS users a portable AI-workflow wire contract on top of DBOS's transactional durability.
2. Be the first reference host to use Postgres as the primary storage layer (we have a skeleton at `examples/hosts/postgres/` but it's a single-process reference; DBOS's design naturally extends to multi-process scale-out via Postgres advisory locks).
3. Be the first non-steward host in `INTEROP-MATRIX.md`, which fires our governance tripwire.

The adapter would be ~600-1,000 LOC Python or TypeScript — your team's pick. The translation: DBOS's workflow decorators → OpenWOP's executor; DBOS's communicator → OpenWOP's node-pack pattern; DBOS's transaction-wrapped state → OpenWOP's channels-and-reducers.

I'm happy to:
- Write the first cut as a draft PR against a DBOS-OpenWOP-adapter repo.
- Land it under your org.
- Author the conformance evidence + INTEROP-MATRIX submission.

Worth a 30-minute call?

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Spec: https://github.com/openwop/openwop

---

### Tier 4 — Inngest

**Why fourth:** Inngest's TS-native event-driven runtime is the right shape for OpenWOP's SSE-first wire surface — `inngest.step.run()` maps to OpenWOP nodes, `inngest.step.waitForEvent()` maps to interrupts. Big TS install base, low-friction-adoption profile.

**Outreach target:** hello@inngest.com or via their Discord community.

**Subject:** OpenWOP host on Inngest — TS-native AI-workflow proposal

**Body:**

Hi Inngest team,

OpenWOP (https://github.com/openwop/openwop) is an open wire-level protocol for multi-agent workflow orchestration. Inngest's TS-native event-driven model is the natural shape for OpenWOP's SSE-first wire surface — `inngest.step.run()` lines up with OpenWOP nodes, `inngest.step.waitForEvent()` with OpenWOP interrupts, and Inngest's keyed events with OpenWOP's signed-token callback resume.

An Inngest-backed OpenWOP host would:

1. Give Inngest users a portable wire contract — OpenWOP workflows running on Inngest's durable infrastructure with their existing observability + retry semantics.
2. Be the first non-steward host in `INTEROP-MATRIX.md`, firing our governance migration tripwire.
3. Validate the SSE-first design choice in OpenWOP's `stream-modes.md` against a runtime that's natively event-driven.

The adapter would be ~600-900 LOC TypeScript. The translation: Inngest steps → OpenWOP nodes; Inngest event-keyed resume → OpenWOP signed-token callback; Inngest's persistent step state → OpenWOP's `RunEventLogIO`.

Happy to write the first cut as a draft PR against an Inngest-OpenWOP-adapter repo your team owns.

Worth a quick call?

Thanks,
David Tufts
Lead Maintainer, OpenWOP
GitHub: @davidscotttufts
Spec: https://github.com/openwop/openwop

---

## Send checklist

1. Send all four in the same week (Tuesday/Wednesday for highest reply rate).
2. Track replies in `MAINTAINERS.md` §"Recruitment log".
3. First positive reply → schedule 30-minute scoping call, commit to a 2-week PR draft window.
4. The other three stay warm; reply with a follow-up if 3 weeks pass without contact.

## After a successful recruitment

When a third-party host passes conformance + commits to maintaining:

1. Add the host to `INTEROP-MATRIX.md` as a 5th (or later) row.
2. If their maintainer wants ongoing involvement, add them to `MAINTAINERS.md` as a reviewer (no commit rights) per `GOVERNANCE.md` §"Roles". If they want commit rights to their host's directory, that's the maintainer-promotion path.
3. **Trigger the governance tripwire:** open the vendor-neutral-org migration RFC per `RFCS/0001-rfc-process.md` (Phase 4 in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`).

## See also

- `MAINTAINERS.md` §"Recruitment log" — per-target reply tracking
- `INTEROP-MATRIX.md` — the matrix the new host gets added to
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Phase 3 T3.2 — the planning trail
- `ROADMAP.md` §"Vendor-neutral org migration" — the tripwire definition
