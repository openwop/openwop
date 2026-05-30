# RFC 0085: `openwop-agent-platform` Meta-Profile

| Field | Value |
|---|---|
| **RFC** | 0085 |
| **Title** | Define `openwop-agent-platform` — an **operational annex** profile (a `production-profile.md`-style claim combining a discovery predicate + required runtime conformance scenarios + documentation + a badge, NOT a pure entry in the closed `profiles.md` catalog) that names one coherent "this host behaves like a full agent platform" target aggregating manifest+live agents, tool catalog+hooks, safe-fetch+egress, provider usage, prompt library, memory read/write/attribution, replay/fork-or-nondeterminism-policy, feedback, durable triggers, debug bundle, RBAC/tenant scoping, and conformance evidence — with a `partial` / `full` status |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-29 |
| **Updated** | 2026-05-30 (`Draft → Active` — steward acceptance, comment window waived per `GOVERNANCE.md` single-maintainer lazy consensus after MyndHyve (non-steward) wire-shape review; wire shapes now locked. The **capstone**, flipped LAST in the arc. The hard predicate terms reference only ≥Active constituents (0070/0072/0077/0078/0064/0076/0026/0027/0080/0004/0056/0049/0074/0057/0009/0083/0079 + replay) — all `Active`/`Accepted`; the platform-plus tier (0081/0082/0084) is advisory-RECOMMENDED, NOT a hard term, so the wire lock does not depend on 0082's shape (0082 reaches `Active` via PR #361). All 5 Unresolved questions resolved as proposed: UQ1 `feedback` is a FLOOR term; UQ2 `nondeterminismPolicy.declared` is a bare flag for v1.x; UQ3 eval/deploy/budget promote to hard `full` terms when ≥1 non-steward host advertises each + the scenario passes; UQ4 badge self-hosted now (GOV-3), doesn't block on the leaderboard; UQ5 the "RFC 0077–0084 ≥ Active" gate is pinned as a hard `Active → Accepted` precondition. NEW `spec/v1/agent-platform-profile.md` annex + the `profiles.md` cross-reference (closed catalog unchanged) + the `profiles.ts` `isAgentPlatform{Partial,Full}`/`agentPlatformStatus` helpers + additive `capabilities.nondeterminismPolicy.declared` + `agent-platform-profile.test.ts` + the `public/badge/openwop-agent-platform.svg` badge + the `INTEROP-MATRIX.md` status section landed. The live aggregate-evidence assertion against a reference host (Postgres candidate) + the badge rendering deferred to `Active → Accepted`.) |
| **Affects** | NEW `spec/v1/agent-platform-profile.md` (the operational annex: predicate + required scenarios + partial/full + badge) · `spec/v1/profiles.md` (additive cross-reference in §"Profile semantics" annex list — NOT a new closed-catalog predicate) · `conformance/src/lib/profiles.ts` (the discovery-shape predicate helper + the aggregate-pass derivation) · `conformance/src/scenarios/agent-platform-profile.test.ts` (the aggregating meta-scenario) · `docs/IMPLEMENTATION-CERTIFICATION.md` + `public/badge/` (the `openwop-agent-platform` badge) · `INTEROP-MATRIX.md` (the platform-profile status column) · `CHANGELOG.md` · `conformance/coverage.md` |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop now has *many* optional agent-platform capabilities — manifest + live agent runtime (RFC 0070/0072/0077), a tool catalog + tool hooks (RFC 0078/0064), safe-fetch + egress policy (RFC 0076/0079), provider usage (RFC 0026), a prompt library (RFC 0027/0028), a reconciled memory model (RFC 0004/0057/0080), replay/fork (`replay.md`), feedback (RFC 0056), durable triggers (RFC 0083), a debug bundle (RFC 0009), RBAC + tenant scoping (RFC 0049/0074), and — with Wave 3 — eval (RFC 0081) and deployment (RFC 0082) and budget (RFC 0084). But a demo, an adopter, or a buyer has **no single named target** that says "this host behaves like a full agent platform" — they must hand-check a dozen capability flags. This RFC adds that target **additively**, as an **operational annex** (the `production-profile.md` / `auth-profiles.md` pattern — a claim combining a discovery predicate, required runtime conformance scenarios, documentation, and a badge, explicitly distinct from the *closed pure-predicate* `profiles.md` catalog per its §"Profile semantics"). `openwop-agent-platform` names the coherent capability subset, defines a **`partial`** (the core agent-platform floor) vs **`full`** (the floor + the governance/operability tier) status, adds an aggregating conformance meta-scenario, and ships a badge so `app.openwop.dev` (and any adopter) can show "Agent Platform profile: partial / full." It composes — does not redefine — every constituent. Because it aggregates Wave 1–4 surfaces, it is authored now (`Draft`) but its acceptance is explicitly **gated on RFC 0077–0084 reaching `≥ Active`** so it never references a shifting wire shape.

## Motivation

`docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0085" frames it: *there are many optional capabilities; a demo or adopter needs one named target that says "this host behaves like a full agent platform."* Three concrete gaps:

1. **No coherent named target.** The closed `profiles.md` catalog has fine-grained profiles (`openwop-secrets`, `openwop-replay-fork`, …) but nothing that says "a real agent platform." A client choosing a host, or a host advertising readiness, must union-test ~14 capability families with no agreed name for the coherent whole. The thesis of the platform recommendation — *portable, inspectable, governable, replayable, composable agents* — has no single conformance claim.
2. **No partial/full honesty surface.** The demo explicitly wants to show "Agent Platform profile: partial/full" — an honest status that distinguishes a host that runs+inspects agents (the floor) from one that also governs+deploys+budgets them (the full tier). There is no vocabulary for that gradation today, so a host either over-claims ("agent platform!") or under-communicates (a wall of flags).
3. **No aggregate evidence or badge.** Per-capability conformance scenarios exist, but nothing *aggregates* them into "passes the platform bar," and there is no platform badge (the existing badges assert suite-version conformance, not a platform claim). An adopter can't point at one artifact that says "this is a credible agent platform, here's the evidence."

The spec is the right place because *a named platform target* is a cross-ecosystem interop + positioning concern: a registry, an adopter, a buyer, and the reference demo all benefit from one agreed claim + one evidence bar. It is an **operational annex**, not a closed-catalog predicate, precisely because (per `profiles.md` §"Profile semantics") it combines *runtime behavior + documentation + conformance evidence* — not just a discovery-payload predicate. The constituent *implementations* stay host choices; this RFC names the coherent set, the partial/full bar, the aggregate evidence, and the badge — additively.

## Proposal

### §A — The annex form (why not the closed catalog)

`openwop-agent-platform` is defined in a **new operational annex** `spec/v1/agent-platform-profile.md`, alongside `production-profile.md`, `auth-profiles.md`, and `interrupt-profiles.md`. Per `profiles.md` §"Profile semantics": *operational annexes define optional public-release claims; they are separate from this compatibility catalog because they combine runtime behavior, documentation, and conformance evidence rather than pure discovery-payload predicates.* This RFC therefore does **NOT** add a `openwop-agent-platform` entry to the closed `profiles.md` predicate catalog (that catalog stays the fine-grained pure-predicate set); it adds a one-line **cross-reference** in `profiles.md`'s annex list (additive) and the full definition in the annex. The annex has three parts: a **discovery predicate** (§B), a **required-scenario set** (§C), and the **partial/full + badge** contract (§D).

### §B — The discovery predicate (the floor, derivable; `profiles.ts` helper)

The `partial` (floor) predicate ANDs the constituent capability checks — the `profiles.md` derivation style (predicates MAY reference other predicates syntactically, e.g. `openwop-interrupts(c) := openwop-core(c) && …`):

```
openwop-agent-platform-partial(c) :=
     openwop-core(c)
  && c.agents?.manifestRuntime?.supported === true          // RFC 0070/0072 — manifest agents
  && c.agents?.liveRuntime?.supported === true              // RFC 0077 — live agent runtime
  && c.toolCatalog?.supported === true                      // RFC 0078 — portable tool catalog
  && c.toolHooks?.supported === true                        // RFC 0064 — tool authorization/audit
  && c.httpClient?.safeFetch?.supported === true            // RFC 0076 §B — safe egress
  && c.providerUsage?.supported === true                    // RFC 0026 — cost/usage
  && c.prompts?.supported === true                          // RFC 0027/0028 — prompt library
  && c.memory?.supported === true                           // RFC 0004/0080 — memory read/write
  && c.feedback?.supported === true                         // RFC 0056 — feedback
  && (c.replay?.supported === true || c.nondeterminismPolicy?.declared === true)  // replay/fork OR explicit policy
```

The `full` predicate adds the governance/operability tier:

```
openwop-agent-platform-full(c) :=
     openwop-agent-platform-partial(c)
  && c.authorization?.supported === true                    // RFC 0049 — RBAC, fail-closed
  && c.agents?.manifestRuntime?.installScope === 'tenant'   // RFC 0074 — tenant scoping
  && c.memory?.attribution?.supported === true              // RFC 0057 — memory attribution
  && c.production?.debugBundleSupported === true            // RFC 0009 — debug bundle
  && (c.triggerBridge?.supported === true)                  // RFC 0083 — durable triggers
  && c.httpClient?.egressPolicy?.supported === true         // RFC 0079 — egress policy (nested under httpClient)
```

The Wave-3 governance surfaces — **eval (RFC 0081)**, **deployment (RFC 0082)**, **budget (RFC 0084)** — are **RECOMMENDED for `full`** and surfaced in the annex as a "platform-plus" advisory checklist, but are NOT hard predicate terms in v1.x (a host can be a credible full platform while wiring eval/deploy/budget incrementally; making them hard terms would gate the whole profile on the newest, least-adopted surfaces). The annex states this rationale; a future minor MAY promote them into `full` once adopted. The `replay`-OR-`nondeterminismPolicy` term honors the recommendation's "run replay/fork **or explicit nondeterminism policy**" — a host that is honestly nondeterministic declares it (a new additive `nondeterminismPolicy.declared` flag) rather than failing the floor.

### §C — Required runtime scenarios (the behavior; aggregating meta-scenario)

A host **claims** the profile by satisfying the §B predicate **and passing the constituent profiles' runtime conformance scenarios** (the `profiles.md` "claims vs passes" semantics). The annex enumerates the required scenario set (one per constituent: `agent-manifest-runtime.test.ts`, `agent-live-runtime-*.test.ts`, the tool-catalog/hooks/safe-fetch/provider-usage/prompts/memory/feedback/replay/RBAC/debug-bundle/trigger-bridge scenarios). A new **aggregating meta-scenario** `agent-platform-profile.test.ts` derives the `partial`/`full`/none status from the discovery payload (§B) and asserts that, when `full` is claimed, every required constituent scenario is in the host's passing set for the reported suite version — i.e. the platform claim is *backed by* the per-capability evidence, never asserted on shape alone. It soft-skips (reports `none`) when the floor predicate is unmet.

### §D — `partial` / `full` status + the badge

The annex defines three statuses a host reports (in its `conformance.md` + `INTEROP-MATRIX.md` row): **none** (floor unmet), **partial** (floor met + floor scenarios pass), **full** (full predicate met + governance-tier scenarios pass). A new **`openwop-agent-platform` badge** (`public/badge/`, generated per `docs/IMPLEMENTATION-CERTIFICATION.md`) renders the status + suite version, so `app.openwop.dev` and any adopter can show "Agent Platform profile: partial / full" backed by `INTEROP-MATRIX.md` evidence. The badge asserts the *aggregate* claim; it does not replace the per-capability badges. Honest advertisement (the `production-profile.md` discipline): a host MUST report `partial` (not `full`) until the full-tier scenarios actually pass — over-claiming is non-conformant.

### Examples

**Positive.** A host advertising all §B-partial flags + passing the floor scenarios → reports `openwop-agent-platform: partial`, renders the partial badge, and shows in `INTEROP-MATRIX` as a credible agent-runtime+tooling host. Add `authorization` + `installScope:'tenant'` + `memory.attribution` + `production.debugBundleSupported` + `triggerBridge` + `httpClient.egressPolicy`, pass the governance scenarios → `full`. **Positive (honest nondeterminism).** A host that doesn't support replay but declares `nondeterminismPolicy.declared:true` (documenting its nondeterminism) still satisfies the floor's replay-OR-policy term.

**Negative (over-claim).** A host advertising the full-tier flags but whose `agent-live-runtime` scenario does NOT pass → MUST report `partial`, not `full` (§D); reporting `full` is non-conformant by the aggregate-evidence rule (§C). **Negative (catalog).** Adding `openwop-agent-platform` to the closed `profiles.md` predicate catalog → wrong surface; it's an operational annex (§A), because it requires runtime+evidence, not just a discovery predicate.

## Compatibility

**Additive** (`COMPATIBILITY.md` §2.1). A new operational-annex doc; an additive cross-reference line in `profiles.md` (the closed catalog is **unchanged** — no new catalog predicate); a `profiles.ts` derivation helper + an aggregating conformance scenario (reads existing payloads + existing scenario results, asserts nothing new about the wire); a new badge; one additive optional `nondeterminismPolicy.declared` capability flag (absent ⇒ the replay term must be satisfied by `replay.supported`, today's behavior). **No existing capability, profile, event, endpoint, or constituent RFC is changed — the meta-profile is a *reading over* the constituents plus the partial/full claim + badge.** No conformance pass is invalidated; a host that ignores the profile is exactly as conformant as today. The profile predicate is append-only per `profiles.md` §"Adding a profile" (a new profile MUST NOT cause a previously-passing host to fail an existing one — this one can't, it only *adds* a claim).

## Conformance

- **New scenario:** **`agent-platform-profile.test.ts`** (always-on for the shape/derivation part; the aggregate-evidence assertion gated on the floor predicate): derives `none`/`partial`/`full` from representative discovery payloads (§B), and — when `full` is claimed against a live host — asserts the required constituent scenarios (§C) are in the passing set. Soft-skips the live aggregate when the floor predicate is unmet. The §B predicate helper lands in `conformance/src/lib/profiles.ts` (the annex derivation, alongside the closed-catalog `profiles()` but clearly marked an annex helper).
- **Coverage** per `conformance/coverage.md` (a row noting the annex + its required-scenario set).
- **Reference host.** Deferred (files at `Draft`). The annex + predicate helper + the derivation/shape scenario ship at `Draft → Active`; the live aggregate-evidence assertion against a reference host (and the badge) is the `Active → Accepted` step, naturally gated on a host actually reaching `partial`/`full` (the Postgres reference host is the candidate — it already satisfies `production-profile`).

## Alternatives considered

1. **Add `openwop-agent-platform` to the closed `profiles.md` catalog as a pure predicate.** Rejected — per `profiles.md` §"Profile semantics" the catalog is *pure discovery-payload predicates*; a platform claim requires *runtime behavior + documentation + conformance evidence* (does the live-runtime scenario actually pass?), which is exactly what operational annexes are for (`production-profile.md`). §A.
2. **Make eval/deployment/budget (RFC 0081/0082/0084) hard `full` predicate terms.** Rejected for v1.x — they're the newest, least-adopted surfaces; gating the whole platform claim on them would make `full` unachievable until they're Accepted + adopted. The annex RECOMMENDS them as a "platform-plus" tier (§B) and a future minor MAY promote them once adopted.
3. **One status (in/out), no partial/full.** Rejected — the recommendation explicitly wants "partial/full," and the gradation is honest: running+inspecting agents (floor) is a real, useful platform level distinct from governing+deploying them (full). One bit would either exclude credible floor hosts or dilute the full claim.
4. **No badge (rely on `INTEROP-MATRIX` alone).** Rejected — the recommendation calls for a badge so the public app + adopters can *show* the claim; the matrix is the evidence, the badge is the surfacing (the existing per-host-badge pattern).
5. **Do nothing.** Rejected — Wave 4's capstone is exactly "add the `openwop-agent-platform` profile + badge"; without one named target the dozen optional capabilities have no coherent positioning, which is the whole platform thesis.

## Unresolved questions

**All five resolved at `Draft → Active` (2026-05-30) as proposed below — recorded in `Updated:`.** (The profile's *acceptance* — `Active → Accepted` — remains gated on RFC 0077–0084 ≥ `Active` + ≥1 host reaching `partial`/`full`.) Retained for the rationale trail:

1. **Floor membership — is `feedback` floor or full?** Proposed: floor (a platform you can't give feedback on isn't inspectable). Confirm vs moving it to full.
2. **`nondeterminismPolicy.declared` shape.** A bare boolean, or a structured policy (which nondeterminism sources are declared)? Proposed: a bare additive flag for v1.x (the floor only needs "replay OR an honest declaration"); a structured policy is a future refinement. Confirm.
3. **Eval/deploy/budget tier promotion trigger.** What concrete adoption bar promotes RFC 0081/0082/0084 from RECOMMENDED to hard `full` terms? Proposed: when ≥1 non-steward host advertises each + the scenario passes. Confirm the bar.
4. **Badge hosting.** Self-hosted per `docs/IMPLEMENTATION-CERTIFICATION.md` (the GOV-3 pattern) until the hosted leaderboard lands, or block on the leaderboard? Proposed: self-hosted now (don't block). Confirm.
5. **Acceptance gate wording.** Pin "RFC 0077–0084 ≥ Active" as a hard acceptance precondition in the criteria (so 0085 can't graduate referencing Draft wire shapes). Confirm the exact set (0077/0078/0079/0080 + 0081/0082/0083/0084).

## Implementation notes (non-normative)

- **Sequencing.** Lands LAST in the platform arc — it aggregates Wave 1 (0070/0072/0077), Wave 2 (0076/0078/0079/0080 + 0064/0026/0027/0028/0004/0057/0056/0009/0049/0074 + `replay.md`), and Wave 4 (0083), with Wave 3 (0081/0082/0084) as the recommended platform-plus tier. Authored now (`Draft`) so the target is visible; **acceptance gated on the constituents reaching `≥ Active`** so it never pins a shifting shape (UQ #5).
- **Reference host.** The Postgres reference host (already `production-profile`-satisfying) is the natural first `partial`/`full` candidate; wiring is advertising the floor flags + passing the existing constituent scenarios + the aggregate meta-scenario + rendering the badge.
- **Demo impact** (out of scope): `app.openwop.dev` shows "Agent Platform profile: partial/full"; the public app becomes the reference walkthrough for the profile.
- **Expected effort:** S for the annex + predicate helper + the derivation scenario + the cross-reference + the badge (it's aggregation, not new wire surface); the "effort" is really the constituents landing, which is Waves 1–4.

## Acceptance criteria

Checklist for `Active → Accepted` (files at `Draft`):

- [ ] **RFC 0077–0084 are all `≥ Active`** (the hard precondition — the meta-profile MUST NOT reference Draft wire shapes).
- [ ] `spec/v1/agent-platform-profile.md` operational annex: §A annex rationale, §B partial/full predicate, §C required-scenario set + aggregate-evidence rule, §D partial/full + badge.
- [ ] Additive cross-reference line in `spec/v1/profiles.md` §"Profile semantics" annex list (closed catalog unchanged); additive optional `nondeterminismPolicy.declared` on `capabilities.schema.json`.
- [ ] `conformance/src/lib/profiles.ts` annex predicate helper + `agent-platform-profile.test.ts` (derivation always-on; live aggregate gated) + `coverage.md` row.
- [ ] `openwop-agent-platform` badge in `public/badge/` + the generation note in `docs/IMPLEMENTATION-CERTIFICATION.md`.
- [ ] `INTEROP-MATRIX.md` platform-profile status column (none/partial/full per host).
- [ ] CHANGELOG entry.
- [ ] All five Unresolved questions resolved (recorded in `Updated:`).
- [ ] ≥1 reference host reports `partial` or `full` backed by the aggregate scenario, OR the RFC explicitly defers reference-host implementation.

## References

- `docs/OPENWOP-AI-AGENT-PLATFORM-RECOMMENDATIONS.md` §"RFC 0085" — the source recommendation (the coherent-subset list + the partial/full + badge).
- [`spec/v1/profiles.md`](../spec/v1/profiles.md) §"Profile semantics" (operational annexes vs the closed catalog — the §A basis) + §"Adding a profile" (append-only rule).
- [`spec/v1/production-profile.md`](../spec/v1/production-profile.md) + [`spec/v1/auth-profiles.md`](../spec/v1/auth-profiles.md) — the operational-annex pattern this RFC follows.
- Constituent RFCs aggregated: [`0070`](./0070-agent-manifest-runtime.md)/[`0072`](./0072-agent-inventory-and-dispatch.md)/[`0077`](./0077-agent-run-lifecycle-and-live-manifest-dispatch.md) (agents), [`0078`](./0078-portable-tool-catalog-and-tool-session-contract.md)/[`0064`](./0064-tool-invocation-hooks-and-authorization.md) (tools), [`0076`](./0076-pack-runtime-requirements-and-host-safe-fetch.md)/[`0079`](./0079-credential-provenance-and-egress-policy.md) (egress), [`0026`](./0026-provider-usage-event.md) (usage), [`0027`](./0027-prompt-templates.md)/[`0028`](./0028-prompt-library-endpoints.md) (prompts), [`0004`](./0004-memory-layer.md)/[`0057`](./0057-memory-write-attribution-event.md)/[`0080`](./0080-agent-memory-capability-reconciliation.md) (memory), [`0056`](./0056-run-feedback-and-annotation-event.md) (feedback), [`0009`](./0009-production-profile-conformance.md) (debug bundle), [`0049`](./0049-rbac-scopes-and-authorization-decisions.md)/[`0074`](./0074-tenant-scoped-agent-inventory.md) (RBAC/tenant), [`0083`](./0083-durable-trigger-and-channel-bridge-profile.md) (triggers).
- Recommended platform-plus tier: [`0081`](./0081-agent-evaluation-and-scorecards.md) (eval), [`0082`](./0082-agent-deployment-lifecycle.md) (deployment), [`0084`](./0084-budget-quota-and-cost-policy.md) (budget).
- [`docs/IMPLEMENTATION-CERTIFICATION.md`](../docs/IMPLEMENTATION-CERTIFICATION.md) + [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) — the badge + evidence surfaces.
- [`COMPATIBILITY.md`](../COMPATIBILITY.md) §2.1 — additive-change discipline.
