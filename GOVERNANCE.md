# OpenWOP Governance

> **Status:** Initial maintainer-driven model (swept 2026-08-16 under RFC 0147 criterion 11: security-response policy reconciled to `SECURITY.md` §3; SDK locations corrected; evidence-tier rule extended to bundle v2). This will evolve toward a working group / steering committee as the contributor base grows. RFC 0147 §I lists the standards-readiness gates that depend on this document — two unaffiliated maintainers, working-group activation, retirement of the bootstrap RFC-waiver mechanism, and retrospective cross-organization review of waived cohorts — none of which has fired as of 2026-08-16.

## Repository

The canonical openwop repository is `github.com/openwop/openwop`. The host name reflects the project's incubation under its original steward; a move to a vendor-neutral org (e.g., `openwop-spec`) is on the roadmap and will be announced via a CHANGELOG entry and a redirect on the original URL. See `MAINTAINERS.md` for the affiliation column that drives the migration tripwire in `ROADMAP.md`.

## Mission

openwop is a vendor-neutral protocol for declaring, running, streaming, interrupting, replaying, and validating durable AI workflows across hosts. The protocol must remain implementable by any host, including hosts unaffiliated with the original maintainers.

## Roles

### Contributors

Anyone who opens an issue, sends a pull request, files a conformance report, or participates in design discussions. No formal status required.

### Reviewers

Contributors with merge rights on a defined area of the corpus (e.g., a single SDK, a spec section). Appointed by maintainers. Listed in [`.github/CODEOWNERS`](./.github/CODEOWNERS); per-area reviewers are added as the maintainer set grows.

### Maintainers

Contributors with merge rights across the corpus and authority to cut releases. The canonical maintainer record lives in `MAINTAINERS.md`, which also documents the promotion process, expectations, and removal-for-cause rules. This document defers to `MAINTAINERS.md` for the current set.

The **lead maintainer** (first entry in `MAINTAINERS.md`) is the tiebreaker for unresolved disagreement (see "Decision making" below). The lead-maintainer role is transitional and replaced by a steering-committee vote once the path-to-working-group conditions below are met.

New maintainers are appointed by lazy consensus among existing maintainers per `MAINTAINERS.md` §"Promotion process." A maintainer may step down or be removed for cause per `MAINTAINERS.md` §§"Stepping down" and "Removal for cause."

## Decision making

The default decision rule is **lazy consensus**: a proposal is adopted if no maintainer raises a substantive objection within seven calendar days of the proposal being filed as a pull request or RFC.

For decisions that require explicit signoff (see "Spec change process"), the rule is **two maintainer approvals** with no outstanding objections.

Tiebreaker for unresolved disagreement: the lead maintainer (the first entry in the maintainer list) holds final authority. This is a transitional rule and is expected to be replaced by a steering committee vote once the maintainer set has at least three independent organizations represented. **The replacement working-group charter is filed as [`RFCS/0038-working-group-charter.md`](./RFCS/0038-working-group-charter.md) at `Status: Draft`** — it ratifies and replaces this section the moment the tripwire defined at §"Path to working group" below fires.

## Spec change process

Changes are categorized by impact on the wire contract per `COMPATIBILITY.md`:

| Category                                     | Examples                                                                               | Process                                                                                                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Editorial**                                | Typo fixes, prose clarifications that don't change normative meaning, link fixes       | One maintainer approval. Merge directly.                                                                                                                                                                                           |
| **Non-normative addition**                   | New examples, new non-normative reference impl notes, new optional capability profiles | One maintainer approval. Merge directly. CHANGELOG entry required.                                                                                                                                                                 |
| **Normative addition (backward-compatible)** | New optional fields, new SHOULD recommendations, new event types in additive position  | RFC required (see `RFCS/`) + two maintainer approvals + 7-day comment window. CHANGELOG entry. Conformance suite update if applicable.                                                                                             |
| **Safety-fix break**                         | A correctness or security fix that cannot be expressed additively                      | RFC required + 90-day public comment window unless under embargoed coordinated disclosure (`SECURITY.md`). Ships with migration tooling. Per `COMPATIBILITY.md` §3 — the only exception to v1.x's additive-only rule.              |
| **Breaking change**                          | Any other change that invalidates an existing v1 conformance pass                      | New major version. Requires public RFC, 30-day comment window, two maintainer approvals from different organizations once that's possible. The v1 contract is **locked**; breaking changes ship as v2.0+ in parallel, not as v1.X. |

The formal RFC mechanism is defined in `RFCS/0001-rfc-process.md`. RFCs live at `RFCS/NNNN-short-title.md`; the authoring template is at `RFCS/0000-template.md`.

Every spec change must:

1. Pass the CI gates documented in `CONTRIBUTING.md` (schema validation, OpenAPI/AsyncAPI lint, link check).
2. Update the CHANGELOG.
3. Update `@openwop/openwop-conformance` if the change introduces new testable behavior. Conformance scenarios for new optional surfaces ship as minor releases of the suite (`1.X.0`) against the unchanged v1 protocol.
4. For normative-addition, safety-fix, and breaking changes: file an RFC per `RFCS/0001-rfc-process.md` before opening the spec PR.

### Acceptance evidence tiers

An RFC's `Active → Accepted` flip is backed by implementation evidence from a host. That evidence comes in three tiers, in increasing order of independence:

1. **Tier 1 — steward-verified.** The steward's own host (a reference host in `openwop-examples`, or the steward-operated demo app) implements and passes the gated scenarios.
2. **Tier 2 — steward-affiliated sibling host.** A separate deployment operated by the same maintainer organization — a genuinely distinct codebase and production environment, but not independent change control. Today this is **MyndHyve** (`api.myndhyve.ai`), the sibling host whose advertisements drove the RFC 0078–0092 graduations.
3. **Tier 3 — independent-organization host.** A host built and operated by an organization with no affiliation to the steward.

Rules:

- An `Active → Accepted` flip **MUST name the tier of its evidence** in the RFC's `Updated` field (and the CHANGELOG graduation entry SHOULD repeat it).
- During the bootstrap phase, **tier-2 evidence is sufficient** to graduate an RFC — it proves the wire shape cross-implements outside the reference tree. But the corpus **MUST NOT describe tier-2 evidence as "non-steward" or "independent"**: a sibling host under the same maintainer org is neither. The honest label is "steward-affiliated sibling host."
- **Re-verification by a tier-3 host remains a `ROADMAP.md` gate** (the "second independent host implementation" line): tier-2 graduations are not retroactively invalidated when a tier-3 host arrives, but the working-group tripwires and the INTEROP-MATRIX "first non-steward row" milestone fire only on tier-3 evidence.
- **Evidence is a bundle, not a sentence (RFC 0148, 2026-08-16).** From suite `1.114.0` the certification bundle v2 records a disposition per requirement (`executed-pass` / `executed-fail` / `skipped` / `inapplicable` / `blocked`) with a witnessed assertion count, and `--certify` rejects a claim whose floor requirement returned unclassified. An `Active → Accepted` flip that cites host evidence SHOULD cite the host's bundle v2 (or the equivalent ledger output) rather than a pass count; a claim with no v2 bundle is a self-declaration under `INTEROP-MATRIX.md`'s evidence vocabulary. RFC 0147 §A additionally forbids citing an RFC's own `Accepted` status as evidence for anything.

> **Historical wording note.** Acceptance evidence recorded before 2026-06-11 (the RFC `Updated` fields and CHANGELOG entries for the RFC 0021–0092 graduations) frequently uses the phrase "non-steward host" for MyndHyve; that wording refers to **tier-2** evidence under this taxonomy and is not rewritten retroactively.

## Release process

- **Spec corpus** ships as named tags (`v1.0.0`, `v1.1.0`, …). Major versions are reserved for breaking changes.
- **SDKs** (`@openwop/openwop` (npm), `openwop-client` (PyPI), `github.com/openwop/openwop-sdks/go` (Go modules) — all in [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks) since 2026-06) ship independently with semantic versioning. SDK majors track the spec major they target.
- **Conformance suite** (`@openwop/openwop-conformance`) ships independently. Suite majors track the spec major; minors add scenarios for the same spec major.

A release requires: passing CI on `main`, a CHANGELOG entry, and a maintainer cutting the tag. The release workflow at `.github/workflows/release.yml` automates package publication once the tag is pushed.

## Security

Security disclosures follow the process documented in `SECURITY.md`, which is the **single** security-response commitment of the project: acknowledgment within 3 business days, triage within 10, remediation timeline within 20 business days of triage, 90-day coordinated disclosure (`SECURITY.md` §3). This section previously read that "firm SLAs are deferred until a maintainer rotation is in place" while `SECURITY.md` §3 already committed to firm targets — two policies, reconciled 2026-08-16 under RFC 0147 §I to the one `SECURITY.md` states. The maintainer set is currently a single person (`MAINTAINERS.md`); `SECURITY.md` §3's revised-timeline clause and §10's proactive-revision rule are how that reality is carried, not a second, softer policy. Embargoed coordinated disclosure is the default for vulnerabilities that affect deployed implementations.

## Trademark

"openwop" and "Workflow Orchestration Protocol" are not currently registered trademarks. Implementations are encouraged to describe themselves as "openwop-compliant" when they pass a published conformance suite version. If the maintainer set later registers a trademark, the policy will be added to this document with a notice period.

## Path to working group

This document anticipates a transition from maintainer-driven governance to a working-group model once the project meets these conditions:

1. At least three independent organizations have a maintainer in good standing.
2. At least two host implementations (one of which is not the original steward's reference) pass `@openwop/openwop-conformance` v1.
3. The maintainer set agrees by lazy consensus that the project has outgrown maintainer-driven governance.

When those conditions are met, a working group charter will be filed as an RFC and ratified by lazy consensus among the current maintainers. The charter will define voting rules, term limits, and the succession model for the lead-maintainer role.

Working-group activation also ratifies the registry and extension policy in [`RFCS/0043-registry-and-extension-policy.md`](./RFCS/0043-registry-and-extension-policy.md) (currently `Draft`, auditable today): the WG's first ballot is to ratify RFC 0043 §B/§C verbatim or amend, flipping it to `Accepted`. The policy index is [`docs/governance/registry-policy.md`](./docs/governance/registry-policy.md).

## Amendments

This document is amended via the same process as a non-normative addition (one maintainer approval; CHANGELOG entry). Changes that affect the maintainer set or the decision rule require two maintainer approvals **and an RFC** per `RFCS/0001-rfc-process.md`.

## See also

- `MAINTAINERS.md` — current maintainer set, promotion process, removal rules, affiliation policy.
- `RFCS/` — formal RFC mechanism, including `RFCS/0001-rfc-process.md` (the meta-RFC for the process itself) and `RFCS/0000-template.md` (the authoring template).
- `COMPATIBILITY.md` — v1.x compatibility commitment + safety-fix exception that gates breaking changes.
- `SECURITY.md` — vulnerability disclosure process referenced by the safety-fix change category.
- `ROADMAP.md` — vendor-neutral org migration tripwire that depends on the maintainer set.
