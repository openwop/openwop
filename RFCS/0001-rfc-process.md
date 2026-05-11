# RFC 0001: The RFC Process

| Field | Value |
|---|---|
| **RFC** | 0001 |
| **Title** | The RFC Process |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-01 |
| **Updated** | 2026-05-01 |
| **Affects** | `GOVERNANCE.md`, `RFCS/`, `CONTRIBUTING.md` |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

This RFC defines how subsequent RFCs are filed, reviewed, and accepted. It is a meta-RFC: it documents the process by ratifying it through the same mechanism it describes. Any future change to the RFC process itself goes through the process this RFC defines.

## Motivation

`GOVERNANCE.md` already references "RFC issue + 7-day comment window" for normative additions and "public RFC + 30-day comment window" for breaking changes, but doesn't define the formal shape of an RFC: where it lives, how it's numbered, what status states exist, or what the template requires.

Without a defined RFC shape:

- Proposers don't know whether to file an issue, a PR, or a doc.
- Maintainers can't audit which proposals are pending vs. accepted vs. abandoned.
- External implementers can't subscribe to upcoming changes ("watch the RFCS/ directory" works only if the directory is canonical).
- Compatibility guarantees (`COMPATIBILITY.md`) rely on a record of what was decided when — and that record is the RFC.

Other protocol communities have solved this with formal RFC processes (Rust RFCs, Python PEPs, IETF RFCs at scale). openwop adopts a lightweight version of the same shape.

## Proposal

### 1. RFCs live in `RFCS/`

The canonical location is `RFCS/NNNN-short-title.md` in the public openwop repository. The directory contains:

- `RFCS/README.md` — process summary.
- `RFCS/0000-template.md` — authoring template; never assigned as a real RFC.
- `RFCS/NNNN-*.md` — accepted, active, withdrawn, or superseded RFCs, numbered sequentially from 0001.

### 2. Numbering

RFCs are numbered sequentially from 0001. Numbers are not reused. A withdrawn or superseded RFC keeps its number; the file remains in `RFCS/` with `Status: Withdrawn` or `Status: Superseded`.

The next free number is the highest existing number + 1. Concurrent PRs that pick the same number rebase on merge order; the second PR bumps to the next free number before re-review.

### 3. Status states

Five states, transitions visible in git history:

| Status | Meaning | Transition rule |
|---|---|---|
| `Draft` | Open PR, under discussion | Initial state when PR is opened |
| `Active` | Accepted, implementation pending | Maintainers flip on PR merge |
| `Accepted` | Implementation landed; conformance updated | Maintainers flip when acceptance criteria met |
| `Withdrawn` | Author or maintainers withdrew | Status flipped via follow-up PR |
| `Superseded` | Replaced by a later RFC | Status flipped when the replacement reaches `Accepted`; forward pointer added |

### 4. Comment windows

Per `GOVERNANCE.md`:

- **Editorial / non-normative-addition** — no RFC required.
- **Normative addition (additive per `COMPATIBILITY.md`)** — 7-day comment window after PR is marked ready for review.
- **Safety-fix break** — 90-day public RFC window unless the change is under embargoed coordinated disclosure (see `SECURITY.md`); in that case the RFC is published when the embargo lifts.
- **Breaking change for v2** — 30-day comment window.

The comment window starts when the PR is marked ready for review (out of draft). Substantive changes during the window restart it. Trivial editorial changes (typos, link fixes) do not.

### 5. Decision rule

Per `GOVERNANCE.md`:

- **Editorial / non-normative-addition** — one maintainer approval.
- **Normative addition** — two maintainer approvals, no outstanding objections.
- **Breaking change** — two maintainer approvals from different organizations, once the maintainer set has multiple organizations represented. Until then, two maintainer approvals + an explicit note that the cross-org rule was not yet active.

The lead maintainer (first entry in `MAINTAINERS.md`) is the tiebreaker for unresolved disagreement, per `GOVERNANCE.md` §"Decision making."

### 6. Template

Every RFC follows `RFCS/0000-template.md`. The template requires:

- Header table (RFC number, title, status, authors, dates, affects, compatibility, supersedes/superseded-by).
- Summary (≤ 5 sentences).
- Motivation.
- Proposal (with concrete schema/spec diffs where applicable).
- Compatibility classification (`additive` / `safety-fix` / `breaking`).
- Conformance (which scenarios cover this; which new scenarios are needed).
- Alternatives considered (≥ 2, including "do nothing").
- Unresolved questions.
- Implementation notes (non-normative).
- Acceptance criteria (checklist for the `Active → Accepted` flip).
- References.

### 7. Pre-RFC patches

Until this RFC reaches `Accepted`, the public repository accepts only:

- Editorial changes (typos, prose clarifications, link fixes).
- Non-normative additions (examples, reference notes).
- The CI/process changes that this LT1 governance track ships.

This guards against accidental normative drift while the RFC process itself is being established. Once this RFC is `Accepted`, the public repository accepts normative additions per the process above.

### 8. RFC PR labelling

Open RFCs in PRs labelled `rfc`. The label is created in the public repository as part of LT1.

## Compatibility

**Additive.** This RFC introduces a process; it does not modify any wire shape. Existing v1 implementations are unaffected. The CHANGELOG entry sits under "Governance" and does not bump any artifact version.

## Conformance

Not applicable — this RFC is process-only and has no conformance scenarios.

## Alternatives considered

1. **Do nothing.** Continue with the loose "RFC issue" reference in `GOVERNANCE.md`. Rejected because the lack of a defined shape makes auditability and external participation hard. Multiple parts of `the public security review plan` (B- / 82 grade) flag governance neutrality as the main blocker to standardization claims.

2. **GitHub Discussions instead of files.** Use GitHub Discussions for proposal threads and merge a one-line CHANGELOG entry on accept. Rejected because Discussions aren't versioned with the spec, can't be cloned offline, and don't survive a future repo migration to a vendor-neutral org.

3. **Heavyweight IETF-style process.** Multi-stage drafts, working-group charter requirements, ballot voting. Rejected because openwop doesn't yet have the maintainer scale to support that ceremony, and `GOVERNANCE.md` already has a path-to-working-group section that activates the heavier process when conditions are met.

4. **Numbered issues instead of numbered files.** Use GitHub issue numbers as the canonical ID. Rejected because issue numbers are shared with bug reports and clutter the namespace; also harder to `git grep` an RFC's history.

## Unresolved questions

1. Should accepted RFCs be promoted into the `spec/v1/` corpus, or remain in `RFCS/` indefinitely as the design record? **Tentative answer:** remain in `RFCS/`. The spec corpus reflects the cumulative protocol; the RFC reflects the proposal. Pointers in both directions (`spec/v1/foo.md` cites RFC NNNN; RFC NNNN's acceptance criteria check spec text exists) are the bridge.

2. How are RFCs that touch SDK shapes (without changing the wire contract) handled? **Tentative answer:** SDK-only changes don't need an RFC; they follow the per-artifact rules in `CONTRIBUTING.md`. SDKs are reference implementations of the wire contract; their internal shape is implementer's call.

3. When the maintainer set has multiple organizations represented, does the cross-org approval rule apply retroactively to RFCs accepted under the single-org rule? **Tentative answer:** No. Accepted is accepted. New RFCs follow the rule current at file time.

## Implementation notes (non-normative)

This RFC is the first one. The acceptance criteria below double as the LT1 deliverables.

## Acceptance criteria

- [x] `RFCS/README.md` exists and documents the process.
- [x] `RFCS/0000-template.md` exists and matches the structure required by §6 above.
- [x] `RFCS/0001-rfc-process.md` (this file) is filed.
- [ ] `GOVERNANCE.md` references `RFCS/` in §"Spec change process" and links to this RFC.
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]` → `### Governance` describing the RFC process landing.
- [ ] An `rfc` PR label is created in the public repository.

## References

- `GOVERNANCE.md` — decision rules; this RFC formalizes the RFC mechanism it references.
- `COMPATIBILITY.md` — change classification used by RFC headers.
- `MAINTAINERS.md` — current maintainer set; this RFC's decision rule depends on it.
- The steward's internal source analysis (non-normative) recommended a public RFC process as a precondition for credible governance neutrality. That recommendation drove this document.
- Rust RFCs: https://github.com/rust-lang/rfcs — pattern adopted here.
- Python PEPs: https://peps.python.org — pattern reviewed but not adopted (heavier process).
