# OpenWOP Governance

> **Status:** Initial maintainer-driven model. It will evolve toward a working group / steering committee as the contributor base grows. RFC 0147 §I lists the standards-readiness gates that depend on this document: two unaffiliated maintainers, working-group activation, retirement of the bootstrap RFC-waiver mechanism, and retrospective cross-organization review of waived cohorts. None has fired.

## Repository

The canonical openwop repository is `github.com/openwop/openwop`, named for the project's incubation under its original steward. A move to a vendor-neutral org (e.g., `openwop-spec`) is on the roadmap and will be announced via a CHANGELOG entry and a redirect on the original URL. The affiliation column in `MAINTAINERS.md` drives the migration tripwire in `ROADMAP.md`.

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

Tiebreaker for unresolved disagreement: the lead maintainer (the first entry in the maintainer list) holds final authority. This is a transitional rule, to be replaced by a steering committee vote once the maintainer set has at least three independent organizations represented.

The replacement working-group charter is [`RFCS/0038-working-group-charter.md`](./RFCS/0038-working-group-charter.md), at `Status: Draft`. It ratifies and replaces this section the moment the tripwire in §"Path to working group" below fires.

## Spec change process

Changes are categorized by impact on the wire contract per `COMPATIBILITY.md`:

| Category | Examples | Process |
| --- | --- | --- |
| **Editorial** | Typo fixes, prose clarifications that don't change normative meaning, link fixes | One maintainer approval. Merge directly. |
| **Non-normative addition** | New examples, new non-normative reference impl notes, new optional capability profiles | One maintainer approval. Merge directly. CHANGELOG entry required. |
| **Normative addition (backward-compatible)** | New optional fields, new SHOULD recommendations, new event types in additive position | RFC + two maintainer approvals + 7-day comment window |
| **Safety-fix break** | A correctness or security fix that cannot be expressed additively | RFC + 90-day public comment window, per `COMPATIBILITY.md` §3 |
| **Breaking change** | Any other change that invalidates an existing conformance pass | New major version, or for v2 a `COMPATIBILITY.md` §3a retirement |

- **Normative addition.** RFC required (see `RFCS/`). Also a CHANGELOG entry, and a conformance suite update if applicable.
- **Safety-fix break.** The 90-day window does not apply under embargoed coordinated disclosure (`SECURITY.md`). The change ships with migration tooling. It is the only exception to v1.x's additive-only rule.
- **Breaking change.** A §3a retirement applies only to an unevidenced v2 surface (RFC 0197). Every breaking change requires a public RFC, a 30-day comment window, and two maintainer approvals from different organizations once that's possible. The v1 contract is **locked**; breaking changes ship as v2.0+ in parallel, not as v1.X.

The formal RFC mechanism is defined in `RFCS/0001-rfc-process.md`. RFCs live at `RFCS/NNNN-short-title.md`; the authoring template is at `RFCS/0000-template.md`.

Every spec change must:

1. Pass the CI gates documented in `CONTRIBUTING.md` (schema validation, OpenAPI/AsyncAPI lint, link check).
2. Update the CHANGELOG.
3. Update `@openwop/openwop-conformance` if the change introduces new testable behavior. Conformance scenarios for new optional surfaces ship as minor releases of the suite against the unchanged protocol major.
4. For normative-addition, safety-fix, and breaking changes: file an RFC per `RFCS/0001-rfc-process.md` before opening the spec PR.

### Acceptance evidence tiers

An RFC's `Active → Accepted` flip is backed by implementation evidence from a host. That evidence comes in three tiers, in increasing order of independence:

1. **Tier 1 — steward-verified.** The steward's own host (a reference host in `openwop-examples`, or the steward-operated demo app) implements and passes the gated scenarios.
2. **Tier 2 — steward-affiliated sibling host.** A separate deployment operated by the same maintainer organization — a genuinely distinct codebase and production environment, but not independent change control. Today this is **MyndHyve** (`api.myndhyve.ai`).
3. **Tier 3 — independent-organization host.** A host built and operated by an organization with no affiliation to the steward.

A fourth label, **corpus gate — no host tier**, exists for RFCs whose every normative requirement is a property of the corpus or the suite rather than of a host (for example RFC 0169's declaration file, RFC 0174's governance predicates, RFC 0178's registers).

- Such an RFC's falsifiability rows are `witnessable — unaided (corpus)`. Its evidence is `evidence/corpus-ledger.json`, the per-requirement ledger `scripts/check-spec-coherence.mjs` emits (RFC 0168 §D.1).
- The label MUST appear in the `Updated` field in place of a tier; `scripts/check-accepted-predicate.mjs` accepts `(corpus)` rows only from that ledger.
- It is not a host tier and MUST NOT be cited for any requirement a host can witness.

**Deployed, not merged.** Every tier above says "host", and a host is a thing that serves traffic. Evidence for a criterion phrased as a live-surface claim — *advertises*, *emits*, *refuses* — is a bundle from the DEPLOYED revision, never a merged pull request. A merge is a promise; only a deployment is a witness.

The evidence machinery cannot tell the difference on its own. Gated scenarios record `inapplicable` rather than fail when a shape is absent, so a bundle cut against a host that never deployed the change looks clean while witnessing nothing. RFC 0165's acceptance had to be re-grounded on deployed evidence for exactly this reason (#1222). What catches it is fetching the host.

So an acceptance citing host evidence names the DEPLOYED revision (an image digest, or a commit the deployment records), and the flip is checked against the live `/.well-known/openwop` at the moment of the flip.

Rules:

- An `Active → Accepted` flip **MUST name the tier of its evidence** in the RFC's `Updated` field (and the CHANGELOG graduation entry SHOULD repeat it).
- During the bootstrap phase, **tier-2 evidence is sufficient** to graduate an RFC — it proves the wire shape cross-implements outside the reference tree. But the corpus **MUST NOT describe tier-2 evidence as "non-steward" or "independent"**: a sibling host under the same maintainer org is neither. The honest label is "steward-affiliated sibling host."
- **Re-verification by a tier-3 host remains a `ROADMAP.md` gate** (the "second independent host implementation" line): tier-2 graduations are not retroactively invalidated when a tier-3 host arrives, but the working-group tripwires and the INTEROP-MATRIX "first non-steward row" milestone fire only on tier-3 evidence.
- **Evidence is a bundle, not a sentence (RFC 0148).** From suite `1.114.0` the certification bundle v2 records a disposition per requirement (`executed-pass` / `executed-fail` / `skipped` / `inapplicable` / `blocked`) with a witnessed assertion count, and `--certify` rejects a claim whose floor requirement returned unclassified.
  - An `Active → Accepted` flip that cites host evidence SHOULD cite the host's bundle v2 (or the equivalent ledger output) rather than a pass count.
  - A claim with no v2 bundle is a self-declaration under `INTEROP-MATRIX.md`'s evidence vocabulary.
  - RFC 0147 §A forbids citing an RFC's own `Accepted` status as evidence for anything.

- **A seam-gated requirement may be witnessed on a side revision when the seam is a PRECONDITION, not when it is in the path being asserted on.** Some v2 scenarios need a test seam to establish a state the assertion then examines: `fork-a-v1-run` plants an era-2 log so that there is something to fork, and the code under test is the host's own fork implementation from the same image.
  - A revision differing from production only by an env var that mounts a fixture-planting route measures the same implementation production runs. `host.build` carries the same commit, so the distinction stays visible.
  - **The line is where the seam sits relative to the assertion.** Seeding a log is scaffolding. A seam that answered the fork request itself would be the host measuring its own stub and MUST NOT be cited.
  - A bundle citing a side revision MUST record it in `host.build` and MUST NOT describe it as the production revision.
- **A harness trust anchor is a precondition in the same sense. It is witnessed on a colocated companion of the deployed image, never on the deployed instance.** A requirement whose observation needs the host to trust key material the suite holds (`spec/v2/harness-trust-anchors.json`) cannot be witnessed on a production instance without making that instance accept credentials a test runner can mint.
  - A companion booted from the deployed image digest, trusting the suite's anchor and configured otherwise identically, runs the same verifier code production runs. It satisfies this section for the listed rows **only**, never for a row whose path runs through the served front.
  - It MUST be cut with `--as-colocated-companion`, which puts `host.deployment: "colocated-companion"` inside the signed digest.
  - A companion MUST NOT be reachable from the public internet, and MUST NOT be given production data stores or production credentials other than its own companion signing key. Production discovery publishes that key beside, never instead of, the production bundle key.
  - `check-accepted-predicate.mjs` enforces the row restriction and the pairing with a certified served-host bundle of the same `image-digest` build, key and discovery (RFC 0216 §C). The network and data rule is the operator's obligation.
- **"The seam is not mounted" and "the seam does not exist" are different facts and MUST NOT be recorded as the same one.** A host that has built a seam and declines to mount it in production can witness the requirement on another revision. A host that has never built the seam cannot witness it on any revision; the gap is a **build task**, not a deployment choice. Advertising the seams profile without the canonical `/conformance/seams` surface would claim routes that answer `404` — the advertise-versus-serve gap this corpus already forbids.

> **Reading older records.** Acceptance evidence recorded before 2026-06-11 (the RFC 0021–0092 graduations) often calls MyndHyve a "non-steward host". That wording means **tier-2** evidence under this taxonomy and is not rewritten retroactively.

## Release process

- **Spec corpus** ships as named tags (`v2.0.0`, `v2.1.0`, …). Major versions are reserved for breaking changes.
- **SDKs** (`@openwop/openwop` (npm), `openwop-client` (PyPI), `github.com/openwop/openwop-sdks/go` (Go modules), all in [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks)) ship independently with semantic versioning. SDK majors track the spec major they target.
- **Conformance suite** (`@openwop/openwop-conformance`) ships independently. Suite majors track the spec major; minors add scenarios for the same spec major.

A release requires: passing CI on `main`, a CHANGELOG entry, and a maintainer cutting the tag. The release workflow at `.github/workflows/release.yml` automates package publication once the tag is pushed.

## Security

Security disclosures follow the process documented in `SECURITY.md`, which is the **single** security-response commitment of the project: acknowledgment within 3 business days, triage within 10, remediation timeline within 20 business days of triage, 90-day coordinated disclosure (`SECURITY.md` §3).

The maintainer set is currently a single person (`MAINTAINERS.md`). `SECURITY.md` §3's revised-timeline clause and §10's proactive-revision rule carry that fact; they are not a second, softer policy. Embargoed coordinated disclosure is the default for vulnerabilities that affect deployed implementations.

## Trademark

"openwop" and "Workflow Orchestration Protocol" are not currently registered trademarks. Implementations are encouraged to describe themselves as "openwop-compliant" when they pass a published conformance suite version. If the maintainer set later registers a trademark, the policy will be added to this document with a notice period.

## Path to working group

This document anticipates a transition from maintainer-driven governance to a working-group model once the project meets these conditions:

1. At least three independent organizations have a maintainer in good standing.
2. At least two host implementations (one of which is not the original steward's reference) pass `@openwop/openwop-conformance` for a currently supported major.
3. The maintainer set agrees by lazy consensus that the project has outgrown maintainer-driven governance.

Condition 2 names "a currently supported major" rather than a fixed version, per [RFC 0038](./RFCS/0038-working-group-charter.md) §E. That amendment was made under the two-approval waiver in §"Sole-steward operation".

When those conditions are met, a working group charter will be filed as an RFC and ratified by lazy consensus among the current maintainers. The charter will define voting rules, term limits, and the succession model for the lead-maintainer role.

Working-group activation also ratifies the registry and extension policy in [`RFCS/0043-registry-and-extension-policy.md`](./RFCS/0043-registry-and-extension-policy.md), currently `Draft`. The WG's first ballot is to ratify RFC 0043 §B/§C verbatim or amend, flipping it to `Accepted`. The policy index is [`docs/governance/registry-policy.md`](./docs/governance/registry-policy.md).

## Sole-steward operation

Recorded 2026-09-02, to be retired when the "Path to working group" conditions above are met.

The project currently has **one maintainer and one organization**. The only conforming hosts are the steward's own: tier-1 hosts (`openwop-app` and the v2 reference host) and the steward-affiliated tier-2 host (MyndHyve `workflow-runtime`), per `INTEROP-MATRIX.md`. No independent-organization host, maintainer, or user exists to wait for. So the project operates as follows, and says so rather than performing a review it cannot have:

- **Comment windows may be waived and every waiver is recorded** in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers", including the 30-day breaking-change window for the v2 major. Each such RFC's header carries the RFC 0001 §5 note that the cross-organization approval rule is not yet active, together with any rule the RFC overrides (for example RFC 0147 §A.6).
- **The two-approval requirement in §"Amendments" is waived and recorded while one maintainer exists** (RFC 0174 §B.3), with the same retirement condition as the window waiver. An RFC that amends the decision rule names the waiver in its header, and `scripts/check-waiver-authority.mjs` fails one that does not.
- **Evidence gates are never waived.** `Active → Accepted` remains a witnessed, non-vacuous conformance pass on a deployed host per §"Acceptance evidence tiers"; the tier is stated in the RFC. A status can be waived; a bundle cannot.
- **Adopter-facing machinery is built even though no external adopter exists**: the deprecation register (`COMPATIBILITY.md` §7), migration guides, codemods with negative controls, and dual-major conformance scenarios. A future implementer inherits a protocol that migrated itself on the record.
- **The v1 deprecation clock is the host inventory**, per `COMPATIBILITY.md` §5, with a calendar floor that activates only when an independent host is in the matrix.

## Amendments

This document is amended via the same process as a non-normative addition (one maintainer approval; CHANGELOG entry). Changes that affect the maintainer set or the decision rule require two maintainer approvals **and an RFC** per `RFCS/0001-rfc-process.md`.

## See also

- `MAINTAINERS.md` — current maintainer set, promotion process, removal rules, affiliation policy.
- `RFCS/` — formal RFC mechanism, including `RFCS/0001-rfc-process.md` (the meta-RFC for the process itself) and `RFCS/0000-template.md` (the authoring template).
- `COMPATIBILITY.md` — the compatibility commitment + safety-fix exception that gates breaking changes.
- `SECURITY.md` — vulnerability disclosure process referenced by the safety-fix change category.
- `ROADMAP.md` — vendor-neutral org migration tripwire that depends on the maintainer set.
