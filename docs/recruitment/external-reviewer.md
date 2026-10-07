# External Reviewer Recruitment

> **Status: framework ready; no candidates contacted.** Closes the governance limit in [`docs/KNOWN-LIMITS.md`](../KNOWN-LIMITS.md): "Add at least one external reviewer before maintainer promotion." Distinct from the security audit (`SECURITY/outreach/external-audit/`) and from host and pack recruitment: this is an **ongoing technical-review participant**, not a one-shot audit firm.

## Why this matters

Until `MAINTAINERS.md` lists a non-steward maintainer, the project runs under `GOVERNANCE.md` §"Sole-steward operation": one approval merges. That keeps shipping fast but leaves a credibility gap. Every normative change in the corpus, including the v2 core (30 documents under `spec/v2/core/`) and the 228 `Accepted` RFCs, has been reviewed by one person, the steward. A standards review will flag this however clean the spec text is.

An external reviewer closes the gap **before** any maintainer promotion: invite an external reviewer to be the second pair of eyes on the next 2–3 normative RFCs. The reviewer is not a maintainer (no merge rights, no governance vote) — they are a **named approving reviewer** in the RFC `## Reviewers` section. Their public approval is the artifact.

The external standards-readiness review explicitly flagged governance neutrality (GOVERNANCE.md §"Path to working group") as a blocker. An external reviewer on record is the cheapest non-trivial move toward that neutrality without requiring a full maintainer promotion or vendor-neutral-org migration.

## Candidate profile

- Technical credibility in one of: durable execution systems, multi-agent orchestration, security/BYOK, JSON Schema discipline, OTel/observability spec work.
- Public-facing (LinkedIn / GitHub / personal blog with verifiable work).
- Willing to spend ~4–8 hours over 2 weeks reviewing one RFC.
- Not currently employed by the steward's company.

## Candidate list

Tier 1 — durable execution + workflow spec experience:

- _(TBD — fill in 3-5 names from the durable-execution community before sending)_

Tier 2 — multi-agent + protocol spec experience:

- _(TBD — fill in 3-5 names)_

Tier 3 — security/BYOK spec experience:

- _(TBD — fill in 3-5 names from the BYOK + secret-redaction community)_

## Outreach template

Subject: `OpenWOP external RFC review — would you be open to a single-RFC review pass?`

```text
Hi <Name>,

I'm the steward of OpenWOP (https://openwop.dev) — an open wire-protocol
for durable workflow orchestration with first-class multi-agent +
HITL primitives. Version 2 of the protocol is released, with a public
conformance suite and certified reference hosts, but every
normative review to date has been single-reviewer.

I'd like to invite you to be the named external reviewer on ONE
open RFC, chosen by your domain interest:

- RFC <NNNN> (<title>) — <one-line scope>. Estimated review
  effort: 4-8 hours over 2 weeks.
- RFC <NNNN> (<title>) — <one-line scope>.
- RFC <NNNN> (<title>) — <one-line scope>.

You would NOT be a maintainer (no merge rights, no governance vote).
You would be a named approving reviewer in the RFC's `## Reviewers`
section. Your public approval signals to other reviewers that the
RFC has been seen by an independent pair of expert eyes.

If you're open to it, reply with a domain preference and I'll send
the RFC + a 30-minute prep call invite.

Thanks,
David Tufts
```

## How to update

When you contact a candidate:

1. Add them to the appropriate tier above with name + affiliation (or `(independent)`) + GitHub handle.
2. Add a one-line entry to a `## Outreach log` section below (date sent, candidate name, RFC offered).

When a reply comes in:

1. Note `accepted` / `declined` / `no response` next to their name + date.
2. On acceptance: amend the target RFC to add a `## Reviewers` section naming them + the agreed review-deliverable date.

## Outreach log

_(empty — no outreach sent yet)_
