# Bootstrap-waiver retrospective review register

> **Rows are derived; outcomes are not.** `scripts/check-waiver-retrospective.mjs` holds the RFC column in
> agreement with the tree. The **Reviewer org**, **Date**, and **Outcome** columns are the human record and
> are never machine-written — a generated outcome would be the defect this file exists to prevent.

RFC 0156 §B: *"RFCs affecting auth, identity, tenant isolation, secrets, packs, execution sandboxing,
idempotency, replay, external effects, conformance/certification, or governance **MUST** receive
retrospective cross-organization review. Review outcomes are `ratified|corrective-rfc-required|provisional|withdrawn`;
silence **MUST NOT** mean ratified."*

That sentence had no surface. Before this file an outcome could not be recorded even if a review had
happened, and `generate-assurance-status.mjs` derived "reviews completed" from a free-text match —
`/retrospective review (complete|closed|done)/i` over the gap registers — which would have counted a review
whose outcome was `withdrawn` or `corrective-rfc-required` exactly like a `ratified` one. A count that reads
*"we reviewed it and it needs a corrective RFC"* as discharged reports compliance over an open defect.

## What the columns mean

**Outcome** is §B closed vocabulary, plus one token §B does not define:

| Outcome | Meaning | Discharges §B? |
| --- | --- | --- |
| `ratified` | Reviewed; stands as accepted | **yes** |
| `corrective-rfc-required` | Reviewed; a defect needs a follow-up RFC | no — open |
| `provisional` | Reviewed; conditionally accepted pending named work | no — open |
| `withdrawn` | Reviewed; the RFC is retracted | no — resolved, not discharged |
| `not-reviewed` | **No review has occurred.** Not a §B outcome | no |

`not-reviewed` is added deliberately. §B names four *review* outcomes and says silence must not mean
ratified — so the absence of a review needs a token of its own, or absence gets read as one of the four.
It is the default for every row and the only value this register ships with.

**§B scope** records whether an RFC falls under the eleven subject areas §B names. Every row reads
`in-scope-pending-assessment`: **no per-RFC assessment has been made.** Marking an RFC out of scope is a
judgement that discharges a MUST, so it needs a recorded rationale and a reviewer — the same standard §B
sets for the review itself. Absent that, the conservative reading is in-scope, which is "silence MUST NOT
mean ratified" applied one level up. Do not narrow this column mechanically.

## The blocker, stated plainly

§B requires **cross-organization** review. `MAINTAINERS.md` lists one maintainer, and the
≥1-non-steward-maintainer tripwire in `ROADMAP.md` has not fired. A steward self-review is not a
cross-organization review, and recording one as `ratified` would be precisely the substitution the last
clause of §B forbids.

**So 0 of 45 is the correct number today, not a backlog anyone here can burn down.** It is gated on the
same tripwire as the rest of the governance program. What this register changes is that the gap is now
per-RFC and recordable rather than a single aggregate, so the day a reviewer exists the work has somewhere
to land — and until then the zero is visibly a blocked obligation rather than an unstarted chore.

## Register

| RFC | Title | §B scope | Reviewer org | Date | Outcome |
| --- | --- | --- | --- | --- | --- |
| 0042 | experimental capability tier | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0043 | registry and extension policy | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0050 | saml scim enterprise identity profiles | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0065 | workflow node primary output annotation | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0066 | x openwop form vendor extension | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0067 | provider catalog conventions | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0068 | memory consolidation and standing commitments | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0072 | agent inventory and dispatch | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0076 | pack runtime requirements and host safe fetch | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0077 | agent run lifecycle and live manifest dispatch | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0078 | portable tool catalog and tool session contract | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0079 | credential provenance and egress policy | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0080 | agent memory capability reconciliation | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0083 | durable trigger and channel bridge profile | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0084 | budget quota and cost policy | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0085 | agent platform meta profile | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0090 | agent verifier and convergence | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0091 | multimodal perception input | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0092 | agent capability requirements | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0093 | protocol hardening webhooks tokens idempotency | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0094 | wire shape reconciliation | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0101 | multi party group conversation | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0103 | localized content surface | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0105 | speech synthesis adapter | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0106 | realtime voice session profile | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0108 | self hosted openai compatible provider class | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0109 | conversation turn model provenance | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0110 | channel presence | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0121 | subscription provider auth | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0124 | portable per run parameter deferral | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0147 | protocol integrity and standards readiness program | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0148 | non vacuous conformance certification | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0149 | machine contract and version reconciliation | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0150 | effect identity replay and split brain safety | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0151 | compensation and partial failure profile | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0152 | a2a 1 0 versioned composition | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0153 | mcp 2026 07 28 versioned composition | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0154 | workload identity delegation telemetry and provenance | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0155 | core profile and extension discipline | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0156 | governance independent assurance and claims | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0157 | chain fragments carry compensation | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0163 | subject linking hardening | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0164 | mandatory subject linking | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0165 | v2 preparation wire shapes | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0166 | register dispositions terminal states witness classes | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0167 | OpenWOP v2 — the program RFC | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0169 | v2 discovery and capabilities (RFC 0167 child C.2) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0172 | v2 versioning and release (RFC 0167 child C.5) | in-scope-pending-assessment | — | — | `not-reviewed` |
