# External Audit — Outreach Status

**The engagement has not started.** No outreach has been sent to any vendor, no quote has been received, and no vendor has been selected. [`SECURITY/external-audit-findings.json`](../../external-audit-findings.json) is empty because no review has run. This is external-action gate SEC-1 in [`docs/KNOWN-LIMITS.md`](../../../docs/KNOWN-LIMITS.md) §"External-action gates".

The engagement plan, scope, selection weighting and state tracker are in [`SECURITY/external-audit-engagement.md`](../../external-audit-engagement.md). This file holds only the per-vendor detail.

## The scope must be re-cut before anything is sent

The five per-vendor drafts in this directory (`trail-of-bits.md`, `ncc-group.md`, `doyensec.md`, `cure53.md`, `latacora.md`) were written against the v1 corpus, with a scope framed around RFCs 0014–0033. That scope no longer describes the protocol:

- v2 is the current major, and v1 reached end of support on 2026-10-04 ([RFC 0234](../../../RFCS/0234-maintainer-set-v1-end-of-support.md)).
- The normative surface a review should cover is [`spec/v2/core/`](../../../spec/v2/core/), the wire in `api/v2/` and `schemas/v2/`, and [`SECURITY/invariants.yaml`](../../invariants.yaml).
- The packs in scope live in [`openwop/openwop-registry`](https://github.com/openwop/openwop-registry), not this repository.

Before the round is sent, re-cut the scope in `external-audit-engagement.md` for v2, then update each draft to match. Do not send the drafts as they stand.

## Per-vendor status

| Vendor        | Outreach sent | First reply received | Quote received | Range (USD) | Window | Decision | Final status |
| ------------- | ------------- | -------------------- | -------------- | ----------- | ------ | -------- | ------------ |
| Trail of Bits | —             | —                    | —              | —           | —      | —        | Not sent     |
| NCC Group     | —             | —                    | —              | —           | —      | —        | Not sent     |
| Doyensec      | —             | —                    | —              | —           | —      | —        | Not sent     |
| Cure53        | —             | —                    | —              | —           | —      | —        | Not sent     |
| Latacora      | —             | —                    | —              | —           | —      | —        | Not sent     |

Decision values: `selected` / `declined-by-us` / `declined-by-vendor` / `no-response`.

## How to update

Update this file in the same commit that sends outreach or records a reply, so it cannot drift silently.

- **On send:** set `Outreach sent` to the date and `Final status` to `Pending`.
- **On a reply:** fill in `First reply received`, `Quote received`, `Range` and `Window`.
- **With two or more viable quotes:** move `Final status` to `pending-decision`.
- **On decision:** `selected` for the chosen vendor, `declined-by-us` for the rest, `declined-by-vendor` if a vendor passes.

## Selection

Score each quote 1–5 against the weighting in `external-audit-engagement.md` §4:

- Track record on protocol-level reviews: 40%
- LLM, workflow or agent-adjacent experience: 25%
- Schedule fit: 15%
- Public-report quality: 10%
- Cost: 10%

The highest weighted score wins; schedule fit breaks ties.

## After selection

1. Move the `external-audit-engagement.md` §8 tracker forward: vendor selected, contract signed, the repository commit pinned as the audit subject, kickoff date.
2. Send a short courtesy note to each vendor not selected.
3. Record the final decision for every row here. The file is then archival.
