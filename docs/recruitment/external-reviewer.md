# External Reviewer Recruitment

> **Status: framework ready, no candidates contacted (2026-05-21).** New surface created per GOV-5 in `docs/KNOWN-LIMITS.md:78` — "Add at least one external reviewer before maintainer promotion." Distinct from the audit work (`SECURITY/outreach/external-audit/`) and host/pack recruitment — this is an **ongoing technical-review participant**, not a one-shot audit firm.

## Why this matters

The bootstrap-phase rule in `CONTRIBUTING.md` is one-approval-merge until `MAINTAINERS.md` lists a non-steward maintainer. That works for shipping velocity but creates a credibility gap: every normative change in the spec corpus has been reviewed by exactly one person (the steward). A standards review will flag this regardless of how clean the spec text is.

GOV-5 closes the gap **before** any maintainer promotion: invite an external reviewer to be the second pair of eyes on the next 2–3 normative RFCs. The reviewer is not a maintainer (no merge rights, no governance vote) — they are a **named approving reviewer** in the RFC `## Reviewers` section. Their public approval is the artifact.

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
HITL primitives. The project is currently in a "credible incubating
protocol, weak open standard candidate" posture per a recent
standards-acceptance review: technically deep, but every normative
review to date has been single-reviewer.

I'd like to invite you to be the named external reviewer on ONE
specific RFC — the choice depending on your domain interest:

- RFC <NNNN> (Multi-agent execution model) — planner/worker handoff,
  replay determinism under nondeterministic models, cross-host
  causation. ~3,000 words. Estimated review effort: 4-8 hours over
  2 weeks.
- RFC <NNNN> (Sandbox execution contract) — host-side isolation
  guarantees for pack-loaded typeIds. Smaller surface but bigger
  security stakes.
- RFC <NNNN> (Multi-region + cross-engine guarantees) — idempotency
  + replay determinism across regions + multi-engine ordering.

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

_(empty — no outreach sent yet as of 2026-05-21)_
