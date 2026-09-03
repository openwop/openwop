# RFC 0174: v2 governance — terminal states used, the Accepted predicate as a machine, waiver authority checked at merge, the front door under budget

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0174                                                            |
| **Title**         | v2 governance: the six RFC states are reachable and used (supersession flips the superseded RFC in the same PR; rejections are filed; a number is never reserved without a file); `Active → Accepted` is a machine predicate over the bundle and the registers; waiver authority is checked at merge against the RFC's declared class and a rule takes effect on the RFC that introduces it; register rows are typed data everywhere (the 27 stray register pairs move under `registers/`; a self-referential `carried:` is refused); document `Status:` banners are derived from the owning RFC; the RFC 0158 durability ladder is the maturity template; the front door is the core (`spec/v2/core/` under 25,000 words, the tail in `ext/` with a witness class); "Open spec gaps" tables retire into `gaps.json`; the host-inventory deprecation rule is restated normatively |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167. This RFC changes the decision rule, which `GOVERNANCE.md` §"Amendments" says needs two maintainer approvals and an RFC: one maintainer exists, so the approval count is waived under the same sole-steward paragraph and recorded — the first rule this RFC introduces (§B.2) is tested against this very waiver. Adversarial review recorded below.) · 2026-09-03 (filed) |
| **Affects**       | **Part of: RFC 0167 — child C7.** v1.x process (this PR, non-wire): `RFCS/0001-rfc-process.md` §3 (supersession and rejection rules), §5 (Accepted predicate pointer); `GOVERNANCE.md` §"Sole-steward operation" (approval-count waiver), §"Amendments"; `RFCS/README.md` §"Companion gap & risk registers" (location rule matches the tree); NEW `scripts/check-rfc-status-coherence.mjs` (document `Status:` banners vs owning RFC; self-referential carries; register location); `scripts/check-registers.mjs` (refuse `carried:<self>` on a terminal RFC); NEW `scripts/check-waiver-authority.mjs`; `docs/RETROSPECTIVE-QUEUE.md`; the 27 stray register pairs moved; 11 stale document banners corrected. v2 (Phase 3): `spec/v2/core/` budget gate; `ext/` header rule; `gaps.json` absorbs the 43 prose gap tables |
| **Compatibility** | `breaking` (v2) as an RFC 0167 child; the v1.x items in this PR are process and corpus-hygiene changes — no wire artifact. Moving register files and correcting stale `Status:` banners are editorial; the two new checks and the `carried:<self>` refusal are gates (a gate that bites is a gate, so the first run is recorded, not hidden) |
| **Supersedes**    | — (amends RFC 0001 §3/§5; RFC 0155 §D residue and RFC 0156 G3/R4 are dispositioned) |
| **Superseded by** | —                                                               |

## Summary

164 RFCs and zero `Superseded`, `Withdrawn`, or `Rejected`; an `Active → Accepted` rule that lives in a README sentence with no predicate; a waiver ledger that checks presence and not authority; 27 register pairs outside the directory the README says they live in; a gap row that carries itself and passes; eleven `Status: Draft` documents whose graduation predicate already fired, one of which forbids what its own RFC permits; 43 prose gap tables that the one gap namespace never ingests; a 225,858-word corpus with an 854-word front door that says "read this instead". v2 governance makes each of these a rule with a gate: states are used, Accepted is computed, authority is checked, registers are data in one place, banners are derived, the core is bounded, and the gap tables become rows.

## Motivation

- **Terminal states are unreachable in practice.** RFC 0001 §3 lists six states; three have never been used (`RFCS/*.md` status grep: 0). Corrections happen by amendment-in-place, strikethrough, and renumbering (RFC 0158's own header records a `0162 → 0158` renumber).
- **No Accepted predicate.** RFC 0001 §6 mentions "a checklist"; `RFCS/README.md:24` says "once the implementation lands"; `GOVERNANCE.md:70–73` requires a tier and a bundle. Nothing computes it. `spec/v1/self-hosted-runner.md:3` still says "RFC 0122 is `Active`, not `Accepted`: no host may advertise" while `RFCS/README.md:253` records RFC 0122 Accepted with "Hosts MAY now advertise" — the document forbids what the RFC permits. Four of the eleven `Status: Draft` documents cite a graduation predicate that has already fired (RFCs 0097, 0098, 0117, 0122 are Accepted).
- **Waivers are audited for presence, not authority.** `check-waiver-ledger.mjs` derives the waived set from the literal `comment window waived` and checks a ledger row exists; RFC 0147 §A.6 forbade waiving high-risk windows and was itself waived, and `docs/ASSURANCE-STATUS.md:15` counts 48 waived RFCs with 0 ratified retrospectives.
- **Registers are half data.** Tokens and `gaps.json` landed (RFC 0166), but `RFCS/README.md:102` says registers live under `registers/` while 27 pairs (0106–0143) sit in `RFCS/` root; `RFCS/0106-realtime-voice-session-profile.gaps.md:17` reads "CLOSED" in prose and carries `carried:openwop.gap.0106.7` — itself — as its token, which `check-registers.mjs` accepts. 43 `spec/v1/*.md` "Open spec gaps" tables are a second gap namespace `generate-gaps.mjs` never reads; several rows there defer to an `Active → Accepted` whose RFC is already Accepted (`agent-deployment.md:94`, `agent-roster.md:61`, `agent-org-chart.md:64`); `artifact-type-packs.md:195` says a test does not exist that does.
- **The front door is a footnote.** `docs/IMPLEMENT-CORE.md` (854 words) says "read this instead of the corpus"; the two largest documents are a test-seam manual (16,021 words) and `host-capabilities.md` (14,642). `/v1/goals`, `/v1/export`, `/v1/import` are in Accepted RFCs, published schemas, and a security invariant, and absent from `api/openapi.yaml`.
- **Residue.** RFC 0155 §D's budget is repealed (RFC 0166 §C.3) but its UQ1 and an acceptance checkbox still ask whether 12/4 is right. RFC 0156 R4 is open with the queue published and no reviewer.

## Proposal

### §A. States are used

**§A.1** A superseding RFC MUST flip the superseded RFC's `Status` to `Superseded` and add the forward pointer **in the same PR**; `check-rfc-status-coherence.mjs` fails a tree where an RFC names another in `Supersedes` while that RFC is not `Superseded`. **§A.2** A declined proposal is filed as `Rejected` with the reason in `Updated` (RFC 0166 §D.1); a proposal discussed in an issue or a plan and not filed is not a decision. **§A.3** A number is never reserved without a file; a renumber is a `Withdrawn` file at the old number with a forward pointer, never a hole (RFC 0001 §3 already says numbers are not reused; the hole at 0160–0162 is recorded as G1 and left, because filing three `Withdrawn` stubs after the fact would be theatre). **§A.4** Amendment-in-place remains legal for editorial corrections and for register sweeps; a normative change to an Accepted RFC is a new RFC that `Supersedes` the section, never an edit.

### §B. Accepted is a predicate; authority is checked

**§B.1** `Active → Accepted` is computed by `scripts/check-accepted-predicate.mjs` (Phase 3 for v2 RFCs; v1.x RFCs are grandfathered as recorded): every acceptance-criteria box ticked or carrying a stated reason (the existing `rfc-lifecycle-coherence` leg); no `open` gap row (RFC 0166); a tier named in `Updated` (GOVERNANCE §"Acceptance evidence tiers"); a cited bundle whose ledger contains at least one `executed-pass` row for each requirement id the RFC's falsifiability table names (RFC 0148); for a program child, the parent `Active`. A flip that fails the predicate fails the gate.

**§B.2** Waiver authority is checked at merge: `scripts/check-waiver-authority.mjs` reads each waived RFC's `Compatibility` class and the rules it names as overridden, and fails when (a) a `safety-fix` RFC waives the §3 90-day window without an embargo citation, (b) a high-risk RFC (RFC 0147 §A.6 surfaces) waives its window without naming §A.6 as overridden in the header, or (c) an RFC amends the decision rule without naming the approval-count waiver. A rule takes effect on the RFC that introduces it: this RFC is the first tested.

**§B.3** `GOVERNANCE.md` §"Sole-steward operation" gains one sentence: the two-approval requirement in §"Amendments" is waived and recorded while one maintainer exists, with the same retirement condition as the window waiver.

**§B.4** The host-inventory deprecation rule (`COMPATIBILITY.md` §5, 2026-09-02) is restated normatively: v1 support ends at the later of every INTEROP-MATRIX host's non-vacuous v2 bundle plus 90 days, and 18 months from the v2 release if and only if an independent host is in the matrix at release. Phase 5 computes the date from the matrix; nothing else may.

### §C. Registers are data, in one place

**§C.1** Every register pair lives under `RFCS/registers/`; the 27 stray pairs move in this PR (`git mv`, no content change); `check-rfc-status-coherence.mjs` fails a register outside the directory. **§C.2** A `carried:<own id>` on a terminal-status RFC is the RFC 0166 backfill's default and 388 rows carried it at filing; refusing them outright would re-adjudicate 36 registers in one PR. Instead: the count is a **ratchet** (`docs/witness-baseline.json` `selfCarried`, may only fall; `check-rfc-status-coherence.mjs`), a self-carry whose own prose says CLOSED is **refused** (machine and prose must agree — 45 such rows, RFC 0106 G7 among them, are re-tokened `closed` in this PR), and in v2 a carry MUST name a different open row or a tracked surface (`gaps.schema.json`'s "the gap's own id" target is withdrawn for v2 RFCs). **§C.3** RFC 0155 UQ1 and the unticked budget checkbox are closed with a pointer to RFC 0166 §C.3. **§C.4** RFC 0156 R4 stays `open` with the honest note that the queue is published and no second organization exists; this RFC does not pretend otherwise.

### §D. Banners are derived

**§D.1** A `spec/v1/*.md` `Status:` banner MUST agree with its owning RFC: a document whose graduation predicate names an RFC that is `Accepted` MUST NOT read `Draft` on that ground. `check-rfc-status-coherence.mjs` parses the banner's `RFC NNNN` references and fails on `Draft … graduates when RFC NNNN reaches Accepted` where NNNN is Accepted. The eleven banners are corrected in this PR (four graduate to `Stable`; `self-hosted-runner.md:3` and `:117` are corrected to permit what RFC 0122 permits; the rest keep `Draft` with a predicate that has not fired). **§D.2** A gap-table row that defers to `Active → Accepted` MUST name the RFC; the check fails a deferral whose RFC is Accepted. The stale rows at `agent-deployment.md:94`, `agent-roster.md:61`, `agent-org-chart.md:64`, `artifact-type-packs.md:195`, and `host-capabilities.md:2110` are corrected here.

### §E. Maturity template, front door, gap tables

**§E.1** RFC 0158's ladder (`durable-single-instance → multi-instance → multi-region-qualified`, each rung named with its evidence, no discovery field) is the template for every per-host maturity claim in v2: a rung is evidence, never an advertisement. **§E.2** `spec/v2/core/` is under 25,000 words (`check-core-budget.mjs`, Phase 3); every `spec/v2/ext/<name>/` document declares `witness` and both maturity axes in its header; a MUST with `witness: unwitnessable` may not appear in `core/`; a document whose only witness is "deferred to Active → Accepted" enters `ext/` or is deleted. `/v1/goals`, `/v1/export`, `/v1/import` enter `api/v2/openapi.yaml` or their RFCs' MUSTs are demoted — decided in C.1 with the seams profile. **§E.3** The 43 "Open spec gaps" tables are absorbed into `gaps.json` in Phase 3 (`generate-gaps.mjs` gains `spec/v2/**` as a source with a 2-column adapter) and deleted from prose; a gap citing an artifact that contradicts it fails (C.11).

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C7.1` | behavior | prose "Open spec gaps" tables in 43 documents | rows in `gaps.json` | — (a generator adapter, not a consumer artifact) | not-persisted |
| `openwop.migration.C7.2` | behavior | `Active → Accepted` by README sentence | `check-accepted-predicate.mjs` | — | not-persisted |
| `openwop.migration.C7.3` | behavior | registers in two directories; `carried:<self>` unbounded | one directory; self-carry ratcheted and refused where the prose says CLOSED | — | not-persisted |
| `openwop.migration.C7.4` | behavior | hand-written document `Status:` banners | derived from the owning RFC | — | not-persisted |

## Persisted-data disposition

No persisted host data. Corpus files only: 54 register files move (history preserved by `git mv`); eleven banners and five gap rows are corrected.

## Compatibility

`breaking` (v2) as a child; the v1.x items are process and hygiene: no schema, OpenAPI, AsyncAPI, or prose MUST on the wire changes. Correcting `self-hosted-runner.md:3` **relaxes** a prose prohibition ("no host may advertise") — that prohibition contradicted its own Accepted RFC and `RFCS/README.md:253`; the correction restores the RFC's decision and is recorded as a Class-3 editorial correction under COMPATIBILITY §3's precedent list, not as a relaxed MUST.

## Conformance

Corpus gates, not host scenarios: `check-rfc-status-coherence.mjs` (supersession pairs, register location, banner-vs-RFC, stale deferrals), `check-registers.mjs` (self-carry refusal), `check-waiver-authority.mjs`. Phase 3: `check-accepted-predicate.mjs`, `check-core-budget.mjs`, the `gaps.json` prose adapter.

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 supersession flips in the same PR | `check-rfc-status-coherence.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §B.1 Accepted predicate | `check-accepted-predicate.mjs` (Phase 3) | the corpus gate | witnessable — unaided (corpus) |
| §B.2 waiver authority | `check-waiver-authority.mjs` | the corpus gate; this RFC is the first subject | witnessable — unaided (corpus) |
| §C.1 register location | `check-rfc-status-coherence.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §C.2 self-carry ratchet; CLOSED-prose self-carry refused | `check-rfc-status-coherence.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §D.1 banner agrees with the RFC | `check-rfc-status-coherence.mjs` | the corpus gate | witnessable — unaided (corpus) |
| §E.2 core budget; `ext/` headers | `check-core-budget.mjs` (Phase 3) | the corpus gate | witnessable — unaided (corpus) |
| §B.4 the v1 end date is computed from the matrix | Phase 5 script | the steward | witnessable — gated on the matrix |

## Adversarial review

1. **This RFC changes the decision rule and GOVERNANCE §"Amendments" demands two approvals an RFC cannot supply with one maintainer.** Disposition: named in the header; §B.3 records the approval-count waiver under the sole-steward paragraph with the same retirement condition; §B.2's checker treats an unrecorded approval waiver as a failure, so the rule bites its own introducer first.
2. **Refusing `carried:<self>` on terminal RFCs would fail 388 existing rows** — the RFC 0166 backfill's own default. Disposition: a ratchet plus a contradiction rule, not a blanket refusal; the 35 rows whose prose already said CLOSED are re-tokened here; the remaining 343 fall as registers are swept (G2 records the baseline).
3. **Moving 54 register files breaks `sources[].file` in `gaps.json`.** Disposition: `generate-gaps.mjs --write` regenerates the source paths; `spec/v1/gaps.json` ids are `(rfc, local)`-derived and do not change.
4. **Relaxing "no host may advertise `selfHostedRunner`" is a prose MUST relaxed (§2.2).** Disposition: the prohibition was a document contradicting its own Accepted RFC; restoring the RFC's decision is a correction, recorded under the §3 precedent list, and the register row says so.
5. **Deriving banners from RFC status hides a document that is genuinely still draft after its RFC is Accepted.** Disposition: the check only fails a banner whose *stated predicate* has fired; a document may stay `Draft` with a different, unfired predicate.
6. **The Accepted predicate needs bundle ledger rows per requirement id, and no `gaps.json` row has a `requirementId` today** (558 of 558 null). Disposition: that is C.11's row-binding work; §B.1 is a Phase 3 gate for v2 RFCs and does not re-adjudicate the 158 Accepted v1 RFCs.
7. **The hole at 0160–0162.** Disposition: left as a recorded gap; filing `Withdrawn` stubs for numbers never authored would be a paper trail for nothing.

## Alternatives considered

1. Keep Accepted as a maintainer judgement with a checklist. Rejected: the checklist is unenforced today and the stale banners are the result.
2. Add a `Status:` field to every document that the generator writes. Rejected for v1 (a rewrite of 60 headers); adopted for v2 in `ext/` headers (§E.2).
3. Leave the prose gap tables and index them. Rejected: two namespaces for one thing is the RFC 0166 defect one layer up.
4. Do nothing. Rejected: 0 terminal states in 164 RFCs is the measurement.

## Unresolved questions

1. Whether `check-accepted-predicate.mjs` should also re-run over the 158 v1 Accepted RFCs as an advisory report (not a gate). Recommended: yes, advisory, so the Phase 3 retrospective has a number.

## Implementation notes (non-normative)

This PR: RFC 0001 §3/§5 text; GOVERNANCE sentence; README register-location sentence; `git mv` of 54 files; RFC 0106 G7 re-token; RFC 0155 residue closed; eleven banners and five gap rows corrected; `check-rfc-status-coherence.mjs`, `check-waiver-authority.mjs`, the `check-registers.mjs` self-carry refusal, wired into `openwop:check` step 4. Phase 3: `check-accepted-predicate.mjs`, `check-core-budget.mjs`, the `gaps.json` prose adapter.

## Acceptance criteria

- [x] `Draft → Active`: RFC text; RFC 0001 and GOVERNANCE amendments; register relocation; self-carry refusal with the sweep; the two new checks green; banners and stale deferrals corrected; ledger row; adversarial review. (This PR.)
- [ ] `Active → Accepted` (Phase 3): `check-accepted-predicate.mjs` and `check-core-budget.mjs` in the gate; the 43 prose gap tables absorbed and deleted; `spec/v2/core/` under budget with every `ext/` header declared; §B.4 restated in `spec/v2/core/`.

## References

- RFC 0167 §A (Axiom 4), §B.7, §C, G1; RFC 0001 §3–§6; RFC 0166 §A/§C.3/§D; RFC 0155 §D; RFC 0156 §B, G3, R4; RFC 0158 §D–§E; RFC 0147 §A.6; RFC 0122; `GOVERNANCE.md` §"Acceptance evidence tiers", §"Sole-steward operation", §"Amendments"; `COMPATIBILITY.md` §3, §5; `RFCS/README.md` §"Process", §"Companion gap & risk registers"; `docs/IMPLEMENT-CORE.md`; `docs/RETROSPECTIVE-QUEUE.md`; `docs/WAIVER-RETROSPECTIVE-REGISTER.md`; `scripts/check-waiver-ledger.mjs`, `check-waiver-retrospective.mjs`, `check-registers.mjs`, `generate-gaps.mjs`.
