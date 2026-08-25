# Assurance status (RFC 0156 §F)

> **Generated** by `scripts/generate-assurance-status.mjs` from the live tree; `docs/ASSURANCE-STATUS.json` is the machine form and `--check` (in `openwop:check`) fails when either disagrees with the sources named in each section. Do not hand-edit — change the source and regenerate.

## Governance

Source: `MAINTAINERS.md`. **1 maintainer(s)** across **1 organization(s)**; cross-organization governance active: **no** (RFC 0038 / RFC 0156 §A tripwire).

| Name | GitHub | Affiliation | Role | Since |
| --- | --- | --- | --- | --- |
| David Tufts | @davidscotttufts | OpenWOP | Lead maintainer | 2026-04 |

## Bootstrap waivers

Source: `RFCS/*.md, RFCS/registers/*`. **41** RFC(s) reached `Accepted` under a waived comment window (0042, 0043, 0050, 0065, 0066, 0067, 0068, 0072, 0076, 0077, 0078, 0079, 0080, 0083, 0084, 0085, 0090, 0091, 0092, 0093, 0094, 0101, 0103, 0105, 0106, 0108, 0109, 0110, 0121, 0124, 0147, 0148, 0149, 0150, 0151, 0152, 0153, 0154, 0155, 0156, 0157); **0** retrospective review(s) completed (RFC 0156 §B).

## Independent security audit

Source: `SECURITY/external-audit-engagement.md §8, SECURITY/external-audit-findings.json`. Engagement: **unscheduled**; findings bundle v1: 0 finding(s), 0 open High/Critical; retest: —; public report: —.

| Step | Done |
| --- | --- |
| Engagement doc drafted | 2026-05-10 |
| Per-vendor outreach drafts ready | 2026-05-11 |
| Vendor outreach sent | — |
| Quotes received | — |
| Vendor selected | — |
| Contract signed | — |
| Repository commit pinned | — |
| Kickoff | — |
| Findings delivered | — |
| Remediation lands | — |
| Public report posted | — |

## Tier-3 evidence

Source: `INTEROP-MATRIX.md`. A host from a different organization publishes valid evidence: **no**.

## Versions

Source: `conformance/package.json, CHANGELOG.md`. Conformance suite **1.139.0**; corpus release **1.10.0** (2026-08-25).

## Open Critical / High program risks

Source: `RFCS/registers/*.risks.md` (130 rows scanned). **71** open across all registers, of which **45** belong to the RFC 0147 program (RFCs ≥ 0147) — the set RFC 0156's claims are gated on. Older registers were never dispositioned; `Open` there means "the mitigation is the normative MUST in the row", not an unaddressed risk:

Of those, **3** are explicitly **transferred** to a named tracked surface (0147/R3, 0147/R12, 0147/R14) — real and open, but dispositioned. A register sweep turns on "Closed **or transferred**", so both are reported; an open row and a transferred row are not the same state and are not reported as one.

| RFC | Risk | Score | Status (head) |
| --- | --- | --- | --- |
| 0058 | R2 — Hosts implement `runTimeoutMs` naively as a hard kill that drops the event log before p… | High | Open |
| 0058 | R3 — Loop-iteration counting diverges across hosts (counts orchestrator turns differently), … | High | Open |
| 0061 | R1 — RFC 0058 ships (already pushed) with the wrong `agents.loop.supported` gate; if 0058 is… | High | Open |
| 0063 | R2 — A naive host applies `outputMapping` before the approval gate, so a bad child artifact … | High | Open |
| 0068 | R1 — Consolidation breaks replay determinism if a run's reads depend on pass timing | High | Open — target before `Active` |
| 0069 | R1 — An independent implementer ships a protocol-tier `core.exec` RCE primitive, reading the… | High | Mitigated by this RFC |
| 0069 | R4 — Host-extension exec ships without the SHOULD safety controls (the protocol can't enforc… | High | Open (host-owned residual) |
| 0071 | R1 — **Schema-bomb / ReDoS via distributed artifact schemas.** A published artifact-type pac… | High | Open — target before `Active` |
| 0071 | R2 — **Prompt injection through card templates.** Card `prompt.template`/`systemPrompt` inte… | High | Open — target before Phase 2 `Active` |
| 0089 | R1 — **False sense of certification** — a self-published bundle is read as "certified" when … | High | Open |
| 0095 | R1 — **Credential material leaks into a published connection pack** (an author pastes a clie… | High | Open |
| 0095 | R3 — **Provider-id collision / squatting** — two packs claim `provider.id: "github"`; a typo… | High | Open |
| 0095 | R4 — **MCP endpoint rot** — a Tier-1 pack's `reach.mcp.server.url` goes stale (ecosystem mov… | High | Open |
| 0096 | R1 — **Inertness violation** — a non-`applied` proposal influences run resolution/planning/e… | High | Open |
| 0096 | R2 — **Trace-derived secret/PII leak** — synthesized `rationale`/provenance echoes a redacte… | High | Open |
| 0096 | R3 — **Activation privilege bypass** — a malicious or low-quality synthesized artifact is ac… | High | Open |
| 0097 | R1 — **Runaway continuation** — a never-satisfied goal re-engages work forever (cost/iterati… | High | Open |
| 0097 | R2 — **Judge cost blowup** — a verifier invocation per iteration silently multiplies spend; … | High | Open |
| 0097 | R3 — **Client-side completion spoofing** — a client sets `state: satisfied` directly, bypass… | High | Open |
| 0098 | R1 — **Credential material in a bundle** — an exporter (or a competitor-import adapter) writ… | High | Open |
| 0098 | R2 — **Destructive overwrite** — a non-idempotent import clobbers existing destination estat… | High | Open |
| 0102 | R1 — **UI-redress / deceptive surface.** A malicious (or untrusted-A2A) agent crafts a surfa… | High | Open — confirm the existing approval-block fully covers the deceptive-label case in threat review (links G6). |
| 0102 | R5 — **Scope creep toward A2UI v1.0 client-to-server RPC.** Pressure to "just add" the RPC c… | High | Mitigated by design — keep the exclusion explicit through the comment window. |
| 0103 | R1 — **Draft content leaks via the public cache.** A draft section is written into a shared/… | High | Open — confirm cache-key scoping in the host implementation + add the SECURITY invariant. |
| 0103 | R2 — **Cross-tenant content disclosure / enumeration oracle.** A request for another tenant'… | High | Open — verify the 404-equivalence in conformance + host. |
| 0103 | R3 — **A second locale mechanism creeps in** (e.g. a `?locale=` shortcut in a host implement… | High | Mitigated by design — hold the exclusion through implementation review. |
| 0147 | R3 — Split-brain hosts duplicate payments/messages before a losing run is cancelled. | Critical | Target: SR-3 `Accepted`; Open — Sweep 2026-08-16: Open — unwitnessed. §D separates ownership from reconciliation on paper; no host fences and no black-box witne |
| 0147 | R4 — The remediation program expands the corpus further without improving implementability. | High | Target: RFC 0147 `Active`; Open — Sweep 2026-08-16: Mitigated: §A freeze in force (no new optional wire capability landed since 0147; 0157 is a §A-compliant err |
| 0147 | R5 — A single umbrella RFC obscures incompatible compatibility classes. | High | Target: each child intake; Mitigated by design |
| 0147 | R7 — Tightening discovery schema closure breaks legal v1 extensions. | High | Target: SR-2 `Active`; Open — Sweep 2026-08-16: Mitigated by design — runtime schemas stay open; only authoring/certification lints landed (`capability-example- |
| 0147 | R8 — Compensation is marketed as rollback or atomicity. | High | Target: SR-4 `Active`; Open — Sweep 2026-08-16: Mitigated in prose — `compensation.md` names best-effort durable compensation, `partial`/`manual` states, no rol |
| 0147 | R11 — Dual legacy/current interop profiles create downgrade attacks. | High | Target: SR-5/SR-6 `Accepted`; Open — Sweep 2026-08-16: Mitigated in suite: `a2a-version-no-silent-downgrade` / `mcp-version-no-silent-downgrade` invariants + ne |
| 0147 | R12 — Workload provenance is mistaken for authorization and creates a confused deputy. | Critical | Target: SR-7 `Accepted`; Open — Sweep 2026-08-16: Mitigated in prose + suite: identity ≠ authorization stated (`auth.md`, `a2a-integration.md` §E, `mcp-integrat |
| 0147 | R14 — Governance requirements cannot be satisfied because no independent maintainers volunteer. | Critical | Target: before RFC 0147 `Accepted`; Open — Sweep 2026-08-16: Open, Critical, externally gated — one maintainer as of 2026-08-16; standards claims stay qualified |
| 0147 | R15 — Security-audit funding or vendor availability delays the program. | High | Target: contract before SR-3 `Accepted`; Open — Sweep 2026-08-16: Open, externally gated — no vendor, no start date (`SECURITY.md` §9). |
| 0147 | R17 — Retrospective review reopens many accepted RFCs and destabilizes v1. | High | Target: SR-9 `Accepted`; Open — Sweep 2026-08-16: Open — retrospective review not started (RFC 0156 G3). |
| 0147 | R18 — Publicly documenting critical defects creates exploitation risk before fixes ship. | High | Target: immediate triage; Open — Sweep 2026-08-16: Mitigated — no CVE-class detail was published; program defects were spec/verifier defects, not exploitable ho |
| 0147 | R19 — “A-grade” becomes a one-time badge rather than a maintained evidence state. | High | Target: Workstream 9; Open — Sweep 2026-08-16: Open — evidence expiry undecided (RFC 0156 G5); bundles carry `generatedAt` + suite version, nothing expires them |
| 0147 | R20 — Reference-host success is again mistaken for independent protocol proof. | High | Target: immediate claims policy; Open — Sweep 2026-08-16: Mitigated in text: `GOVERNANCE.md` tier taxonomy + `INTEROP-MATRIX.md` evidence vocabulary (2026-08-16 |
| 0148 | R1 — Historic claims are materially invalid. | Critical | Open — Sweep 2026-08-16: Realised, precisely scoped, remediated: Bundle 1 invalidated; four v2 reissues (`docs/CERTIFICATION-BUNDLE-INVENTORY.md`). No blanket a |
| 0148 | R2 — Witnesses leak response or tenant content. | High | Open — Sweep 2026-08-16: Mitigated: `--certify` scrubs the finished document with the handed credential + `OPENWOP_*` secrets + the SR-1 canary and self-verifie |
| 0148 | R5 — A malicious generator fabricates witnesses. | High | Open — Sweep 2026-08-16: Open — bundles are reproducible and consumer-verifiable but unsigned; provenance depends on RFC 0154 G4. |
| 0149 | R3 — Runtime closure accidentally breaks additive v1 clients. | High | Open — Sweep 2026-08-16: Mitigated by design — runtime schemas open; only authoring lints; `discovery-canonical-family-no-shadow` binds consumers not hosts. |
| 0150 | R2 — A semantic provider option is omitted and digest collision remains. | High | Open — Sweep 2026-08-16: Open (G3). |
| 0150 | R3 — Fencing service outage halts effects. | High | Open — Sweep 2026-08-16: Open — no fencing host (G10). |
| 0150 | R4 — Provider claims idempotency but retention is too short. | High | Open — Sweep 2026-08-16: Open (G4). |
| 0151 | R1 — Compensation executes twice. | Critical | Open — Sweep 2026-08-16: Mitigated in prose — inverse-action identity tuple stated; `compensation.md` §C now states the persistence shape, `attempt` outside the |
| 0151 | R2 — Inverse action worsens the incident. | Critical | Open — Sweep 2026-08-16: Open — unwitnessed (§E landed 2026-08-16: approval on the plan entry, RFC 0049 binding, four audited override actions; `SECURITY/threat |
| 0151 | R3 — Users interpret compensation as atomic rollback. | High | Open — Sweep 2026-08-16: Mitigated in prose — best-effort language, `partial` / `manual` states, `compensationStatus: none` default; claims-test unbuilt. |
| 0151 | R4 — Replay re-fires inverse effects. | Critical | Open — Sweep 2026-08-16: Mitigated in suite — `compensation-replay-no-refire` invariant + `compensation-behavior.test.ts` leg (gated; `blocked` until a host adv |
| 0151 | R5 — Compensation plan captures secrets. | High | Open — Sweep 2026-08-16: Mitigated in schema — `compensation-policy.schema.json` carries no credential fields; `--certify` scrubs evidence; no host to test. |
| 0152 | R1 — Silent downgrade exposes legacy behavior. | High | Open — Sweep 2026-08-16: Mitigated in suite — `a2a-version-no-silent-downgrade` + `a2a-version-negotiation.test.ts`; host legs `blocked` (no invoke seam on any  |
| 0152 | R2 — Agent Card and runtime drift. | High | Open — Sweep 2026-08-16: Mitigated in suite — `a2a-card-runtime-consistency.test.ts` (S15, gated on `a2a.profiles ∋ a2a-1.0`). |
| 0152 | R4 — A2A identity is mistaken for OpenWOP authorization. | Critical | Open — Sweep 2026-08-16: Mitigated in prose + suite — `a2a-integration.md` §E; `a2a-peer-authority.test.ts` (host-blocked). |
| 0153 | R1 — Silent downgrade re-enables weaker legacy auth/session behavior. | Critical | Open — Sweep 2026-08-16: Mitigated in suite — `mcp-version-no-silent-downgrade` + `mcp-version-negotiation.test.ts`; host legs `blocked` on current hosts. |
| 0153 | R2 — MRTR work duplicates after timeout/retry. | High | Open — Sweep 2026-08-16: Mitigated in prose + suite — MRTR mapping traced against RFC 0150 identity; `mcp-mrtr-roundtrip.test.ts` (client half host-blocked, ser |
| 0153 | R3 — Cache crosses tenant or authorization scope. | Critical | Open — Sweep 2026-08-16: Mitigated in prose + suite — §D scoped key; `mcp-cache-tenant-scope.test.ts` (gated). |
| 0153 | R4 — Extension metadata grants unintended authority. | High | Open — Sweep 2026-08-16: Mitigated — opaque-by-default (G5) + `mcp-extension-opacity.test.ts`. |
| 0154 | R1 — Provenance is mistaken for authorization. | Critical | Open — Sweep 2026-08-16: Mitigated in prose + suite — identity ≠ authorization normative; `delegation-tenant-audience-bound` / `delegation-chain-bounded` invari |
| 0154 | R2 — Delegation amplifies scopes or crosses tenants. | Critical | Open — Sweep 2026-08-16: Mitigated in prose + suite — intersection-only scopes + tenant/audience binding (`auth.md`); same two invariants; no advertiser. |
| 0154 | R3 — Bearer downgrade bypasses sender constraint. | Critical | Open — Sweep 2026-08-16: Open — sender-constraint minimum-assurance policy in prose; downgrade audit leg absent; no advertiser. |
| 0154 | R4 — Signing key compromise blesses malicious artifacts. | High | Open — Sweep 2026-08-16: Open — no signing (G4). |
| 0154 | R5 — Telemetry leaks workload or user identity. | High | Open — Sweep 2026-08-16: Mitigated in prose — opaque hashed identifiers, per-tenant salt, content-free telemetry (`observability.md`; threat model §4.4); no wit |
| 0155 | R2 — Extension budget becomes arbitrary gatekeeping. | High | Open — Sweep 2026-08-16: Open — budget uncalibrated (G1). |
| 0155 | R3 — Registry maturity is self-awarded without evidence. | Critical | Open — Sweep 2026-08-16: Mitigated by gates — coverage generator + `--check`; maturity flips still need Tier-3/audit evidence that does not exist. |
| 0155 | R4 — Stable core manifest drifts from prose. | High | Open — Sweep 2026-08-16: Mitigated — generated manifest + bidirectional parity leg; the 2026-08-16 phantom-floor finding (`audit-log-verification.test.ts`) show |
| 0156 | R1 — Independent maintainers do not volunteer. | Critical | Open — Sweep 2026-08-16: Open, Critical — unchanged. |
| 0156 | R2 — Audit is delayed or underfunded. | High | Open — Sweep 2026-08-16: Open — unchanged. |
| 0156 | R3 — Sponsored Tier-3 host is effectively steward-controlled. | High | Open — Sweep 2026-08-16: Open — moot until a Tier-3 candidate exists. |
| 0156 | R4 — Retrospective review destabilizes v1. | High | Open — Sweep 2026-08-16: Open — not started. |
| 0156 | R6 — Governance becomes performative while lead retains de facto control. | Critical | Open — Sweep 2026-08-16: Open, Critical — single maintainer; every 2026-08 decision was unilateral by construction, recorded publicly in PRs/CHANGELOG. |

## Permitted claims (RFC 0147 §A)

Evaluated against `RFCS/0147-protocol-integrity-and-standards-readiness-program.md §A claim table`. Audit complete: **no**. A claim marked **no** MUST NOT appear on a public surface except negated, quoted, or in a sentence that names its evidence bar; `--check` scans README, ROADMAP, the governance/security/compatibility documents, INTEROP-MATRIX, docs/ and conformance/README for the tokens.

| Claim | Permitted | Requires |
| --- | --- | --- |
| fully-conformant (unqualified) | **no** | exact profile, protocol and suite versions, configuration, run date, executed/skip counts, corrected signed bundle — i.e. only the QUALIFIED form is ever permitted |
| current-A2A compatible | **no** | A2A 1.0 profile AND a real-peer result (RFC 0152 acceptance: real upstream peer in CI is externally gated) |
| current-MCP compatible | **no** | MCP 2026-07-28 profile AND a real-peer result (RFC 0153: pinned real peer externally gated) |
| production multi-region | **no** | live or production-equivalent partition/failover exercise with effect-safety evidence (RFC 0150 R3 open, no fencing host) |
| independently validated | **no** | Tier-3 result plus independent security audit |
| vendor-neutral standard / industry standard / A-grade | **no** | activated cross-org governance plus Tier-3 adoption |
| best-in-class durable orchestration | **no** | correct effect identity/replay plus accepted compensation profile AND production evidence |

