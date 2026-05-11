# openwop RFCs

This directory holds **Requests for Comments** — the public design record for normative changes to the openwop protocol.

## When you need an RFC

Per `GOVERNANCE.md` §"Spec change process":

| Change | RFC required? |
|---|---|
| Editorial: typos, prose clarifications, link fixes | No — direct PR |
| Non-normative: new examples, optional reference notes | No — direct PR with CHANGELOG entry |
| **Normative addition (backward-compatible)**: new optional fields, new SHOULD recommendations, additive event types | **Yes** |
| **Breaking change**: anything that invalidates an existing v1 conformance pass | **Yes** — also requires a v2 plan |

Refactors that don't touch wire shapes don't need an RFC. When in doubt, file an RFC and ask in the issue thread.

## Process

1. **Draft.** Copy `0000-template.md` to `RFCS/NNNN-short-title.md` (use the next free number; check `git log` if uncertain). Author against the template; the `Status` field starts at `Draft`.
2. **Open a pull request.** Title: `RFC NNNN: <title>`. The PR is the comment thread.
3. **Comment window.** A normative-addition RFC has a **7-day** comment window after the PR is marked ready for review. A breaking-change RFC has a **30-day** window.
4. **Decision.** Per `GOVERNANCE.md`: lazy consensus by default; two maintainer approvals required for normative changes; two maintainer approvals from different organizations for breaking changes (once the maintainer set has multiple orgs represented).
5. **Status flip.** Maintainer flips `Status` to `Active` (accepted, not yet implemented) on merge, then to `Accepted` once the implementation lands and the conformance suite reflects it. RFCs that are abandoned move to `Withdrawn`. RFCs that are replaced move to `Superseded` with a forward pointer.

## Status states

| Status | Meaning |
|---|---|
| `Draft` | Proposal under active discussion. Wire shapes may shift. |
| `Active` | Accepted by maintainers; implementation pending. Wire shapes are locked unless the RFC explicitly says otherwise. |
| `Accepted` | Implemented and reflected in the spec corpus + conformance suite (where applicable). |
| `Withdrawn` | Author or maintainers withdrew. Reasons recorded in the RFC's PR thread. |
| `Superseded` | Replaced by a later RFC. The successor's number is in the RFC header. |

## Numbering

RFCs are numbered sequentially from `0001`. `0000-template.md` is reserved as the authoring template and is never assigned. Numbers are not reused; a withdrawn RFC keeps its number.

## What the RFC must include

Every RFC follows `0000-template.md` and must answer:

- **Summary.** One paragraph the maintainers can read in 30 seconds.
- **Motivation.** What problem is this solving? Who hits it?
- **Proposal.** The actual change. Wire shapes, schema diffs, prose edits.
- **Compatibility.** Is this additive, breaking, or behavior-only? Trace against `COMPATIBILITY.md`.
- **Conformance.** Which scenarios test this? Are new scenarios needed?
- **Alternatives considered.** What was rejected and why.
- **Unresolved questions.** What needs decision before implementation.

## See also

- `GOVERNANCE.md` — decision rules, maintainer roles, the broader spec change process.
- `COMPATIBILITY.md` — what counts as additive vs breaking.
- `MAINTAINERS.md` — current maintainer set.
- `CONTRIBUTING.md` — per-artifact rules (schemas, OpenAPI, conformance, SDK).
