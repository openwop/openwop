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

**So zero discharged is the correct number today, not a backlog anyone here can burn down.** (The denominator is not written here because it grows with every waived RFC; `check-waiver-retrospective.mjs` prints the live tally.) It is gated on the
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
| 0174 | v2 governance (RFC 0167 child C.7) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0178 | v2 assurance registers and deprecation machinery (RFC 0167 child C.11) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0170 | v2 identity (RFC 0167 child C.3) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0171 | v2 wire envelope (RFC 0167 child C.4) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0173 | v2 security defaults (RFC 0167 child C.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0175 | v2 transports and embedded protocols (RFC 0167 child C.8) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0176 | v2 persisted data and coexistence (RFC 0167 child C.9) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0177 | v2 registry, packs, and the extension tail (RFC 0167 child C.10) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0168 | v2 evidence and conformance (RFC 0167 child C.1) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0179 | Root `preferredVersion` (v1.x additive) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0180 | Vendor-org registration procedure (`spec/v2/declaration.json` `extensions`) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0181 | Vendor path namespace (`/host/<org>/…` for host-proprietary operations under major 2) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0182 | `listRuns` — portable, tenant-scoped, paginated run list (`GET /runs`, family `runList`) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0183 | `interruptResolved` action fidelity (`action`, `refineFeedback`, `editedArtifactData`) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0184 | Bound-id path projection (`~`-escaped single segment; RFC 0147 §A.6 override named) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0186 | Three payload seats the hosts measured and the corpus lacked (`conversation.exchanged` union, `reason`, `ApprovalData.onTimeout`) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0187 | Four bindings the hosts found (`webhookId` kind, v1-wire pass-through, the census of writers, the legacy writer's mark) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0188 | The webhook delivery dead-letter read: the seat that makes `deliveryId` witnessable, the run/delivery sink split, and the `webhooks` family's first owning RFC | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0189 | The normative-home gate given a contract: home classes, a content predicate, a non-punitive ratchet, and a deadline that can fire | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0190 | The kernel budget measures what the home gate accepts, and its cap grows only as debt is retired | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0191 | The reciprocal normative-home marker, and why no regex over prose decides a semantic claim | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0192 | A facet is advertised by the presence of its key; the 26 descriptions that gated on a retired field | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0193 | A capability record is an object, so a v1 array needs a seat; the three envelope families whose payload the generator dropped in silence | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0194 | a run's terminal event is emitted once and ends its forward execution (replay; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0195 | a certification bundle's declarations are signed, and an unobserved requirement is `blocked` (certification; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0196 | `callbackUrl` refused or delivered under the egress guard; embedded IPv4 judged as IPv4 (external effects; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0197 | v2 surfaces are retired, never reshaped (certification; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0198 | the MCP server mount maps long runs to MCP Tasks, and a disconnect cancels only the run it owns (replay, external effects and isolation; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0199 | the host as an OAuth client, and the `credential` interrupt (identity and authorization; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0200 | the host as an OAuth protected resource (identity and authorization; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0201 | Standard Webhooks as an opt-in companion signature scheme, with a signed delivery id, multi-signature rotation and endpoint verification (external effects and idempotency; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0202 | each inventoried agent is published as an A2A Agent Card (isolation and authorization; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0203 | a remote node-pack runtime may name its MCP server by its registry record (routine waiver; §A.6 stated not to apply) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0204 | the v2 host MCP client returns MCP results (routine waiver; §A.6 stated not to apply) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0205 | run artifacts and conversation content speak A2A Parts (routine waiver; §A.6 stated not to apply) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0206 | locale keys accept the BCP 47 tags the host negotiates (routine waiver; §A.6 stated not to apply) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0207 | trace context across MCP and A2A, and debug-bundle spans that join the trace (routine waiver; §A.6 stated not to apply) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0208 | v2 homes the A2A and MCP operation mappings (isolation; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0209 | v2 A2UI surfaces are A2UI v0.9 (authorization and replay; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0210 | a lane's revocation rule is measured, and a host that only honours `exp` says so (identity and authorization; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0212 | canonical JSON is RFC 8785 JCS, and a certification preimage does not depend on the machine that computed it (certification and replay; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0214 | an A2A push credential is a destination credential, and a push is an egress like any webhook (authorization, external effects and replay; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0211 | an A2A error's details are an ErrorInfo, and an A2A interface never answers in the OpenWOP envelope (isolation; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
| 0213 | three outcomes the v2 core never stated — a resume cursor past the log, the loser of a same-key race, and a resolve after the run ended (replay, idempotency and authorization; Active by steward override of RFC 0147 §A.6) | in-scope-pending-assessment | — | — | `not-reviewed` |
