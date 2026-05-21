# RFC 0038: OpenWOP Working Group charter

| Field | Value |
|---|---|
| **RFC** | 0038 |
| **Title** | OpenWOP Working Group charter |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-21 |
| **Updated** | 2026-05-21 |
| **Affects** | `GOVERNANCE.md` (replaces lead-maintainer-tiebreaker section with steering-committee-vote rule) · `MAINTAINERS.md` (working-group succession addendum) · NEW `docs/working-group/` directory (charter doc + bylaws) · CHANGELOG |
| **Compatibility** | `additive` (governance — does not affect any wire shape) |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Define the OpenWOP Working Group's charter, voting rules, term limits, and succession model. Today, `GOVERNANCE.md:27` documents that the lead-maintainer tiebreaker is "a transitional rule and is expected to be replaced by a steering committee vote once the maintainer set has at least three independent organizations represented." The transition criteria are spelled out at `GOVERNANCE.md:76` — but the charter that actually fires when the tripwire trips does not exist. This RFC lands the charter as **Draft**, ready to ratify the moment the tripwire fires.

## Motivation

Per Google-acceptance review 2026-05-21 finding (7): "Governance is not yet standard-body neutral. This is technical, not popularity: the spec still has a lead-maintainer tiebreaker and future working-group conditions. A company can implement it experimentally, but accepting it as an open standard would require neutral change control and a registry policy for profiles, event types, envelope kinds, and capability names."

The reviewer is correct. The fix is to LAND the charter now so the migration path is mechanical when the tripwire fires (≥3 organizations + ≥2 non-steward hosts passing conformance — per `GOVERNANCE.md:76`).

## Proposal

### §A — Working Group composition

The OpenWOP Working Group (WG) consists of:

- **Steering Committee** (3-5 members) — elected by WG members; one vote each on governance matters.
- **WG Members** — any maintainer in `MAINTAINERS.md` plus any external reviewer (per `docs/recruitment/external-reviewer.md`) actively reviewing RFCs.
- **Working Group Chair** — elected from the Steering Committee; runs meetings, manages the RFC calendar, breaks ties on procedural questions.

The WG replaces the GOVERNANCE.md "lead-maintainer tiebreaker" rule.

### §B — Election rules

1. **Steering Committee election cadence:** annual.
2. **Eligibility:** any WG member who has authored OR reviewed (with merge-influencing approval) at least 2 RFCs in the prior 12 months.
3. **Election mechanism:** approval voting. Each WG member approves N candidates; top 3-5 by approval count win seats.
4. **Independence requirement:** no more than **1/3** of Steering Committee members may share an employer/affiliation (rounded down — e.g., a 3-seat Committee permits no shared affiliation; a 5-seat permits at most 1 pair; a 7-seat permits at most 2). This aligns with W3C TAG + IETF IESG diversity norms; a single org cannot block 2/3 votes. **Bootstrap exception:** for the first elected Committee (3 seats) the independence requirement is relaxed to "at least 1 member is independent of the original steward" — recognizing that the recruitment process per `docs/recruitment/external-host.md` is still in flight. The bootstrap exception lapses at the second election cycle. If election produces a non-compliant Committee, the highest-approval candidates from underrepresented orgs replace the excess until balance is reached.

### §C — Voting rules on RFCs

Replaces `GOVERNANCE.md` §"Decision making":

| RFC category | Vote rule | Window |
|---|---|---|
| Editorial / Non-normative | Lazy consensus (no objection within 3 days) | 3 days |
| Normative additive | Lazy consensus among WG; if any 2 WG members request a vote, simple majority of Steering Committee | 7 days |
| Safety-fix | Simple majority of Steering Committee + Working Group Chair signoff | 90 days OR embargoed disclosure |
| Breaking | 2/3 majority of Steering Committee | 30 days |
| Governance changes (this charter, MAINTAINERS process, registry policy) | 2/3 majority of Steering Committee + WG Chair signoff | 30 days |

### §D — Registry policy ownership

The Working Group governs:

- **Profile names** in `spec/v1/profiles.md`.
- **Event type identifiers** in `schemas/run-event-payloads.schema.json`.
- **Envelope kind names** in `schemas/envelopes/*.schema.json` and `capabilities.supportedEnvelopes`.
- **Capability identifiers** in `schemas/capabilities.schema.json` + `host-capabilities.md` §"Canonical host.* identifiers."
- **Host-extension namespace allocations** per `host-extensions.md` §"Canonical prefixes."

A registry-policy RFC (filed separately) defines the format for new namespace requests — out of scope for this charter.

### §E — Tripwire activation

Per `GOVERNANCE.md:76`, the WG charter ratifies the moment all three conditions hold:

1. At least three independent organizations have a maintainer in good standing (per `MAINTAINERS.md`).
2. At least two host implementations (one of which is not the original steward's reference) pass `@openwop/openwop-conformance` v1.
3. The maintainer set agrees by lazy consensus that the project has outgrown maintainer-driven governance.

When the tripwire fires, the current lead maintainer:

1. Posts a public ratification PR amending `GOVERNANCE.md` to replace §"Decision making" with this RFC's §C.
2. Calls a Steering Committee election per §B.
3. Hands the lead-maintainer role to the Steering Committee.

### §F — Vendor-neutral org migration (GOV-8)

Concurrent with the tripwire ratification, the repo migrates from `github.com/openwop/openwop` to a vendor-neutral org owned by the Working Group. The migration is mechanical (a `git remote` re-target + DNS update for `openwop.dev`) — but the WG owns it. See `docs/KNOWN-LIMITS.md:81` for the GOV-8 status.

### §G — Term limits + succession

- **Steering Committee members** serve 1-year renewable terms; max 3 consecutive terms.
- **Working Group Chair** serves a 1-year term; max 2 consecutive terms.
- **Removal for cause** follows `MAINTAINERS.md` §"Removal for cause" — 2/3 majority of remaining Steering Committee.
- **Mid-term replacement** when a member resigns: next-highest-approval candidate from the prior election fills the seat for the remaining term.

## Compatibility

**Additive (governance).** This RFC does not change any wire shape, schema, capability, or conformance scenario. It changes only the project's decision-making process — and only when the tripwire fires.

Until the tripwire fires, this RFC sits at `Draft` status and `GOVERNANCE.md`'s existing lead-maintainer tiebreaker continues to apply.

## Conformance

N/A — governance RFC, not a wire-shape change. No conformance scenarios needed.

## Alternatives considered

1. **Defer until the tripwire fires.** Rejected — that's the current posture, and the absence of the charter is itself a credibility gap per the Google-acceptance review. The charter being ready-to-ratify is better than waiting.
2. **Adopt an existing standards-body charter (e.g., W3C WG, IETF WG, OpenJS Foundation TSC).** Considered — likely the right move for the post-tripwire WG, but each external body's framework requires migration onto their infrastructure (mailing lists, vote tooling, IPR policy). This RFC documents a minimal viable WG that can later move to an external body without changing the in-repo governance docs.
3. **Larger Steering Committee (7+).** Rejected for the first WG cohort — 3-5 is the minimum-viable size; can expand once the WG matures.

## Unresolved questions

1. **IPR policy.** Standards bodies typically require contributor patent grants. Today the project uses DCO + Apache 2.0; this is sufficient for an interim WG but may need formalization when the WG migrates to a standards body. Defer to a follow-up RFC.
2. **Tie-breaking when the WG Chair is absent.** Recommend: the most-senior Steering Committee member (by accumulated term-years) breaks the tie. Defer.
3. **Conflict of interest disclosure.** Should Steering Committee members disclose financial interests in implementations? Recommend yes; defer to a follow-up bylaws RFC.

## Acceptance criteria

- [ ] Spec text merged (this file) — Status: `Draft`.
- [ ] `docs/working-group/` directory created with this charter linked.
- [ ] `GOVERNANCE.md:24-27` updated to add a one-paragraph forward-pointer: "When the tripwire defined at §'Path to working group' fires, the working group governance defined in `RFCS/0038-working-group-charter.md` ratifies and replaces this section."
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] No status flip on Status field — stays `Draft` until tripwire fires (§E).

Path to `Active`: tripwire fires per §E.
Path to `Accepted`: 6 months of WG operation with no major procedural objection.

## References

- `GOVERNANCE.md:27` (the lead-maintainer-tiebreaker section this RFC will eventually replace)
- `GOVERNANCE.md:76` (the path-to-working-group conditions / tripwire)
- `MAINTAINERS.md` (current maintainer state + bootstrap-phase notes)
- `docs/recruitment/external-host.md`, `docs/recruitment/external-pack-author.md`, `docs/recruitment/external-reviewer.md` (the recruitment work that fills the tripwire conditions)
- `docs/KNOWN-LIMITS.md:81` (GOV-8 vendor-neutral org migration)
- Google-acceptance review 2026-05-21 — finding (7)
