# openwop Maintainers

This file is the canonical record of who has merge authority on `github.com/openwop/openwop` and what's expected of them. The maintainer set drives the decision rules in `GOVERNANCE.md` and the RFC process in `RFCS/`.

> Recruitment of additional maintainers is **out of band**: this file documents the criteria and the process. It does not commit to a hiring schedule. The vendor-neutral-org migration tripwire in `ROADMAP.md` activates when this file lists at least one maintainer not affiliated with the original steward.

## Current maintainers

| Name | GitHub | Affiliation | Role | Active since |
|---|---|---|---|---|
| David Tufts | @davidscotttufts | OpenWOP | Lead maintainer | 2026-04 |

The **lead maintainer** is the tiebreaker for unresolved disagreement (per `GOVERNANCE.md` §"Decision making"). The lead-maintainer role is transitional and is replaced by a steering-committee vote once the path-to-working-group conditions in `GOVERNANCE.md` are met.

## Maintainer expectations

A maintainer is expected to:

1. **Respond.** Acknowledge issues and pull requests in their area within five business days. Acknowledgment may be a substantive reply or a "I'll get to this by ~date" — silence is the failure mode this rule exists to prevent.
2. **Gate quality.** Merge only changes that pass the CI gates listed in `CONTRIBUTING.md` §"The CI gate." A failing CI run is never a "fix-forward" rationale on `main`.
3. **Follow the spec change process.** Per `GOVERNANCE.md` §"Spec change process" — editorial / non-normative-addition / normative-addition / breaking each have their own decision rule and comment window. RFCs follow `RFCS/0001-rfc-process.md`.
4. **Disclose conflicts.** Any commercial relationship, funding source, or employment that could bias a decision is disclosed in the PR or RFC thread. Recusal is the default for direct conflicts.
5. **Honor compatibility.** Apply `COMPATIBILITY.md` strictly. v1.x stays additive-only by default; safety/security breaks follow the §3 process; v2 is the parallel track for everything else.
6. **Update governance docs in lockstep.** Changes to maintainer status (additions, removals, role changes) update this file via PR. Changes to `GOVERNANCE.md` decision rules go through the RFC process.

## Promotion process

A contributor becomes a maintainer through these steps:

1. **Sustained contribution.** Six months of substantive review or PR activity on the openwop corpus. "Substantive" means non-trivial spec / schema / SDK / conformance contributions, not just typo fixes.
2. **Nomination.** An existing maintainer opens a PR adding the contributor to this file. The PR explains why the contributor meets the criteria.
3. **Lazy-consensus window.** Seven calendar days during which any existing maintainer may object. Substantive objections move the proposal to a discussion in the PR thread; unresolved objections are settled by lead-maintainer tiebreaker per `GOVERNANCE.md`.
4. **Onboarding.** The new maintainer is added to repository admin, CODEOWNERS for their declared area, the security advisory team (`SECURITY.md`), and announced in `CHANGELOG.md` under `### Governance`.

A contributor may decline maintainer nomination at any time without explanation.

## Stepping down

A maintainer may step down by opening a PR that:

- Moves their entry from "Current maintainers" to "Past maintainers" below.
- Lists their last active month.
- Optionally hands off ownership of any RFCs or open PRs in their queue.

Stepping down is acknowledged by lazy consensus (the PR merges with one approval). Past maintainers are not silently removed — the table preserves the history.

## Removal for cause

A maintainer may be removed by lazy consensus of the remaining maintainers for:

- **Sustained inactivity.** No substantive activity for six months, with no advance notice.
- **Code-of-conduct violation.** Per `CODE_OF_CONDUCT.md`. Removal is by majority of remaining maintainers; the lead maintainer recuses if the violation involves them.
- **Conflict-of-interest violation.** Failure to disclose a conflict that materially affected a decision. Removal follows the code-of-conduct process.

A removed maintainer's entry moves to "Past maintainers" with a brief note on the removal reason. The note is factual; it doesn't repeat any private investigation detail.

## Affiliation policy

Maintainers list their primary affiliation in the table. The affiliation field exists so:

- Cross-organization decision rules (per `GOVERNANCE.md` §"Decision making" — required for breaking changes once multiple orgs are represented) can be evaluated.
- External implementers can assess governance neutrality.
- The vendor-neutral-org migration tripwire in `ROADMAP.md` can be checked mechanically.

A maintainer who changes affiliation updates this file in the same PR. Multiple affiliations may be listed if they're material to recusal decisions.

## Past maintainers

_None yet._

## Recruitment log

The vendor-neutral-org migration tripwire in `ROADMAP.md` activates when this file lists ≥1 maintainer not affiliated with OpenWOP. Recruitment is **out-of-band**: this section tracks attempts (and their outcomes) so the project's recruitment posture is auditable, but it doesn't commit to a hiring schedule.

### External host implementations

Recruitment targets per `docs/recruitment/external-host.md` (drafts ready 2026-05-11; freshness re-confirmed 2026-05-12 — no content drift; outreach not yet sent).

| Target | Outreach sent | First reply | Status | Notes |
|---|---|---|---|---|
| LangChain / LangGraph adapter | — | — | Drafted | Tier 1; cites README's six-borrowed-idioms section. See `docs/recruitment/external-host.md` §"Tier 1". |
| Restate | — | — | Drafted | Tier 2; durable-execution-runtime fit. |
| DBOS | — | — | Drafted | Tier 3; Postgres-native transactional workflows. |
| Inngest | — | — | Drafted | Tier 4; TS-native event-driven runtime. |

When a target replies positively + commits to a draft adapter PR within 30 days, move their row's status to `in-progress`. When their host appears on `INTEROP-MATRIX.md`, status → `live`.

### External pack authors

Recruitment targets per `docs/recruitment/external-pack-author.md` (drafts ready 2026-05-11; freshness re-confirmed 2026-05-12 — no content drift; outreach not yet sent). Initial Tier-1 shortlist below; the recruitment doc's criteria gate adding more.

| Target | Outreach sent | First reply | Status | Notes |
|---|---|---|---|---|
| Linear (Issues / Cycles API → `vendor.linear.workflows`) | — | — | Pending outreach | Tier 1: dev-tools vendor with workflow-shaped public API. Best fit: Linear's GraphQL `issueCreate` + `cycleCreate` mutations as openwop nodes. |
| Sourcegraph (Code Search / Cody → `vendor.sourcegraph.code-search`) | — | — | Pending outreach | Tier 1: code-intelligence vendor; an existing MCP server can be wrapped as an openwop pack for the workflow surface. |
| Vercel (Build / Edge Functions → `vendor.vercel.deploy`) | — | — | Pending outreach | Tier 1: deploy-on-workflow-event is a common HITL pattern. |
| Resend (transactional email → `vendor.resend.send`) | — | — | Pending outreach | Tier 1: smallest possible pack scope (1 node, 1 envelope); good first-pack proof point. |
| Stripe (payment workflows → `vendor.stripe.charge` / `vendor.stripe.refund`) | — | — | Pending outreach | Tier 1: payment-with-HITL-approval is the canonical openwop use case from `interrupt.md` §"approval". |

When a target replies, fill in `Outreach sent` + `First reply`, advance `Status` through `in-discussion` → `pack-drafted` → `published`. When their pack lands on `packs.openwop.dev`, status → `live`.

> **Follow-up cadence:** Day +5 / +12 / +28 nudges per `docs/recruitment/follow-up-cadence.md`. After Day +28 with no reply, the lead is cold — re-contact only on a real trigger (new release, new endorsement, new evidence) at Day +90.

### Governance migration trigger

When the first non-steward maintainer is added to the "Current maintainers" table above:
1. Add the recruitment log row that produced them.
2. Open the vendor-neutral-org migration RFC per `RFCS/0001-rfc-process.md` (Phase 4 T4.1 in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`).

## Bootstrap-phase RFC waivers

Per `CONTRIBUTING.md` §"Bootstrap-phase notes," additive RFCs MAY be promoted Draft → Active by steward decision when the comment window would only serve as a delay against zero external reviewers. This section tracks every RFC that has used the waiver so future maintainers can audit the velocity of bootstrap-phase decisions. The waiver is retired automatically when the first non-steward maintainer joins.

| RFC | Title | Draft date | Active date | Comment-window duration | Waiver rationale |
|---|---|---|---|---|---|
| 0009 | Production-Profile Conformance | 2026-05-11 | 2026-05-11 | < 1 day | Additive; INTEROP-MATRIX Postgres row already claimed `production-profile.md` without mechanical evidence — closing the gap was higher-value than the 7-day delay |
| 0010 | Auth-Profile Conformance | 2026-05-11 | 2026-05-12 | < 1 day | Additive; consolidates four production-auth profile claims from `auth-profiles.md` (FINAL v1) into mechanical conformance — same posture as RFC 0009 |
| 0011 | Auth-Scoped Discovery Advertisement | 2026-05-12 | 2026-05-12 | < 1 day | Additive; closes ROADMAP Track 2 "next add auth-scoped discovery variants when a host advertises them" by formalizing `capabilities.discovery.authScoped` as a capability flag and adding the three conformance subtests called out in `capabilities-change-detection.md` §"Conformance expectations" |
| 0012 | Memory Compaction Profile | 2026-05-13 | 2026-05-15 | < 2 days | Additive; closes the SR-1 carry-forward gap for host-managed memory compaction and shipped with Postgres reference behavior plus conformance scenarios before external reviewers existed |
| 0022 | `core.dispatch` + `core.subWorkflow` runtime variable mapping | 2026-05-18 | 2026-05-18 | < 1 day | Additive; closes the symmetric input-mapping gap on both workflow-invocation primitives, identified via the MyndHyve Launch Studio production rebuild. Ships with schema deltas (`dispatch-config.schema.json` + `capabilities.schema.json`), spec prose update (`node-packs.md` §"`core.subWorkflow` contract"), and four `it.todo()` conformance placeholders capability-gated on `agents.dispatchMapping` + `subWorkflow.inputMapping`. No reference host implements yet; promotes to `Accepted` when the placeholders graduate to live behavioral tests. |

When the count gets uncomfortable (e.g., > 5 waivers within a 30-day window, or > 15 total before the first non-steward maintainer joins), that's a signal to slow down and stage at least one RFC through a real 7-day window even without external reviewers — exercising the process is itself a credibility surface.

## See also

- `GOVERNANCE.md` — decision rules, role definitions, path to working group.
- `RFCS/0001-rfc-process.md` — formal RFC mechanism that maintainer approvals operate on.
- `COMPATIBILITY.md` — what counts as additive vs. breaking; what maintainers gate.
- `CODE_OF_CONDUCT.md` — behavioral expectations enforced under "Removal for cause."
- `ROADMAP.md` — the vendor-neutral-org migration tripwire that depends on this file.
- `docs/recruitment/external-host.md` — per-target host-recruitment outreach drafts.
- `docs/recruitment/external-pack-author.md` — external pack-author recruitment.
