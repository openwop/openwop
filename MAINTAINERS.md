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

## See also

- `GOVERNANCE.md` — decision rules, role definitions, path to working group.
- `RFCS/0001-rfc-process.md` — formal RFC mechanism that maintainer approvals operate on.
- `COMPATIBILITY.md` — what counts as additive vs. breaking; what maintainers gate.
- `CODE_OF_CONDUCT.md` — behavioral expectations enforced under "Removal for cause."
- `ROADMAP.md` — the vendor-neutral-org migration tripwire that depends on this file.
