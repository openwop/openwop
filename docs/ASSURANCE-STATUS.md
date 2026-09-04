# Assurance status (RFC 0156 §F)

> **Generated** by `scripts/generate-assurance-status.mjs` from the live tree; `docs/ASSURANCE-STATUS.json` is the machine form and `--check` (in `openwop:check`) fails when either disagrees with the sources named in each section. Do not hand-edit — change the source and regenerate.

## Governance

Source: `MAINTAINERS.md`. **1 maintainer(s)** across **1 organization(s)**; cross-organization governance active: **no** (RFC 0038 / RFC 0156 §A tripwire).

| Name | GitHub | Affiliation | Role | Since |
| --- | --- | --- | --- | --- |
| David Tufts | @davidscotttufts | OpenWOP | Lead maintainer | 2026-04 |

## Bootstrap waivers

Source: `RFCS/*.md, RFCS/registers/*`. **58** RFC(s) reached `Accepted` under a waived comment window (0042, 0043, 0050, 0065, 0066, 0067, 0068, 0072, 0076, 0077, 0078, 0079, 0080, 0083, 0084, 0085, 0090, 0091, 0092, 0093, 0094, 0101, 0103, 0105, 0106, 0108, 0109, 0110, 0121, 0124, 0147, 0148, 0149, 0150, 0151, 0152, 0153, 0154, 0155, 0156, 0157, 0163, 0164, 0165, 0166, 0167, 0168, 0169, 0170, 0171, 0172, 0173, 0174, 0175, 0176, 0177, 0178, 0179); **0** `ratified` retrospective review(s) — the only outcome that discharges RFC 0156 §B.

Per-RFC outcomes (`docs/WAIVER-RETROSPECTIVE-REGISTER.md`): `not-reviewed` 58. `not-reviewed` is not one of §B's four outcomes — it records the absence of a review, so that silence is stated rather than inferred. §B review is **cross-organization**; with one maintainer listed and the non-steward tripwire unfired, a non-zero open count is the honest state rather than a backlog.

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

Source: `conformance/package.json, CHANGELOG.md`. Conformance suite **2.0.0-rc.15**; corpus release **1.10.0** (2026-08-25).

## Open Critical / High program risks

Source: `RFCS/registers/*.risks.md + RFCS/*.risks.md (RFC 0166 tokens)` (436 rows scanned). **109** open across all registers, of which **59** belong to the RFC 0147 program (RFCs ≥ 0147) — the set RFC 0156's claims are gated on. Older registers were never dispositioned; `Open` there means "the mitigation is the normative MUST in the row", not an unaddressed risk:

Of those, **4** are explicitly **transferred** to a named tracked surface (0147/R2, 0147/R3, 0147/R12, 0147/R14) — real and open, but dispositioned. A register sweep turns on "Closed **or transferred**", so both are reported; an open row and a transferred row are not the same state and are not reported as one.

| RFC | Risk | Score | Status (head) |
| --- | --- | --- | --- |
| 0058 | R2 — Hosts implement `runTimeoutMs` naively as a hard kill that drops the event log before persisting `cap.breached` + `run.failed`, leaving a run in a non-terminal state on restart. | High | Open |
| 0058 | R3 — Loop-iteration counting diverges across hosts (counts orchestrator turns differently), so a workflow with `maxLoopIterations: 20` terminates at different points on different hosts → non-portable. | High | Open |
| 0061 | R1 — RFC 0058 ships (already pushed) with the wrong `agents.loop.supported` gate; if 0058 is merged before the G1 correction, the `maxLoopIterations` key references a capability no cohort RFC creates → dead gate. | High | Open |
| 0063 | R2 — A naive host applies `outputMapping` before the approval gate, so a bad child artifact enters parent state despite `requireApproval` (fail-open). | High | Open |
| 0068 | R1 — Consolidation breaks replay determinism if a run's reads depend on pass timing | High | Open — target before `Active` |
| 0069 | R4 — Host-extension exec ships without the SHOULD safety controls (the protocol can't enforce a surface it doesn't define) | High | Open (host-owned residual) |
| 0071 | R1 — **Schema-bomb / ReDoS via distributed artifact schemas.** A published artifact-type pack ships a JSON Schema with pathological `$ref` recursion or a catastrophic-backtracking `pattern`; the engine compiles it (Ajv) and is DoS'd at workflow-register or validate time. | High | Open — target before `Active` |
| 0071 | R2 — **Prompt injection through card templates.** Card `prompt.template`/`systemPrompt` interpolate workflow inputs via `placeholderMapping`; untrusted input reaches the LLM and can exfiltrate or coerce structured output. | High | Open — target before Phase 2 `Active` |
| 0089 | R1 — **False sense of certification** — a self-published bundle is read as "certified" when its `host.commit` + results are self-reported and unverified. | High | Open |
| 0095 | R1 — **Credential material leaks into a published connection pack** (an author pastes a client secret / token into a manifest and signs+publishes it to packs.openwop.dev). | High | Open |
| 0095 | R3 — **Provider-id collision / squatting** — two packs claim `provider.id: "github"`; a typosquatted `community.evil.github` shadows the real one and points OAuth at an attacker. | High | Open |
| 0095 | R4 — **MCP endpoint rot** — a Tier-1 pack's `reach.mcp.server.url` goes stale (ecosystem moves monthly); connections silently fail or the provider greys out. | High | Open |
| 0096 | R1 — **Inertness violation** — a non-`applied` proposal influences run resolution/planning/execution (the synthesizer's draft leaks into behavior before review). This is the whole point of the RFC. | High | Open |
| 0096 | R2 — **Trace-derived secret/PII leak** — synthesized `rationale`/provenance echoes a redacted secret or personal datum read from the source run traces. | High | Open |
| 0096 | R3 — **Activation privilege bypass** — a malicious or low-quality synthesized artifact is activated by an under-privileged principal, installing executable behavior. | High | Open |
| 0097 | R1 — **Runaway continuation** — a never-satisfied goal re-engages work forever (cost/iterations unbounded), the unattended-agent nightmare. | High | Open |
| 0097 | R2 — **Judge cost blowup** — a verifier invocation per iteration silently multiplies spend; goals become expensive in a non-obvious way. | High | Open |
| 0097 | R3 — **Client-side completion spoofing** — a client sets `state: satisfied` directly, bypassing the judge and declaring victory falsely. | High | Open |
| 0098 | R1 — **Credential material in a bundle** — an exporter (or a competitor-import adapter) writes a client secret / token / SAML cert into a `connection-ref` payload, and it travels in plaintext. The single highest-severity failure. | High | Open |
| 0098 | R2 — **Destructive overwrite** — a non-idempotent import clobbers existing destination estate (overwrites a live agent/schedule) instead of skip/update. | High | Open |
| 0102 | R1 — **UI-redress / deceptive surface.** A malicious (or untrusted-A2A) agent crafts a surface whose labels misrepresent the action — e.g. a "Confirm time" button that resolves an approval to "send to all." | High | Open — confirm the existing approval-block fully covers the deceptive-label case in threat review (links G6). |
| 0103 | R1 — **Draft content leaks via the public cache.** A draft section is written into a shared/public cache entry and served from a cached `published` response. | High | Open — confirm cache-key scoping in the host implementation + add the SECURITY invariant. |
| 0103 | R2 — **Cross-tenant content disclosure / enumeration oracle.** A request for another tenant's `slug`/`pageId` reveals existence (different status code/timing) or returns content. | High | Open — verify the 404-equivalence in conformance + host. |
| 0106 | R1 — **Scope creep into media transport.** Reviewers/implementers push to standardize WebRTC/gRPC media on the wire, dragging openwop out of its control-plane remit and coupling every host to a media stack. | High | Open → mitigated by §E; watch in comment window |
| 0108 | R2 — A host advertises `selfHosted: ["ollama"]` with **no** endpoint actually configured (dishonest claim) — a client routes to a dead provider and the advertisement becomes meaningless (the exact failure the surface exists to prevent). | High | Open |
| 0118 | R1 — **Replay non-determinism.** Parallel children complete in wall-clock order; if `mergeOrder` is not recorded and re-applied, a forked/replayed run reproduces a *different* parent-variable state when two children map to the same output key — a silent correctness break that the wire's replay guarantee (RFC 0041) forbids. | High | Open — scenario must be green for `Accepted` |
| 0118 | R2 — **Worker-pool exhaustion / self-DoS.** An unbounded fan-out (e.g. 500 `nextWorkerIds`) under `parallel` floods a host's worker pool, starving other runs. | High | Open |
| 0121 | R1 — A host (or an implementer following this RFC) advertises/implements `subscription` mode using the direct-API-under-borrowed-token shape (§C shape 1) for a provider whose consumer ToS actually forbids it, exposing operators and end users to account suspension or legal exposure. | Critical | Open — gating condition, not yet resolved |
| 0121 | R2 — A host advertises `subscription` support and permits binding the resulting credential at tenant/workspace scope, silently sharing one individual's personal, single-seat subscription across a multi-user tenant — both a ToS violation and an unaudited access-sharing surface. | High | Open — mitigation is drafted in the RFC, unverified until a host implements it |
| 0124 | R3 — **Portability regression via the escape hatch.** A host implements deferred mode but leaves an embedded non-prompt `{{params.*}}` token unresolved (skips the "resolve at expansion time" fallback), silently reintroducing the exact non-portable state this RFC exists to prevent. | High | Open |
| 0126 | R1 — **Silent-drop on a naive host** — a host adds `nextWorkerInputs` support incompletely (or ignores the field) and dispatches N children with identical inputs, mailing/processing one item N times and skipping the rest. This is the exact motivating bug, now potentially reintroduced by a partial implementation. | High | Open |
| 0127 | R1 — **Dishonest `stream`/`change` advert** — a host advertises the new sources without behaviorally ingesting them (the exact mislabel-as-`webhook` dishonesty this RFC exists to remove, inverted). | High | Open |
| 0128 | R1 — **Compliance-theater reading** — operators/regulators read `purposePropagation: supported` as "the receiver *enforces* purpose limits" when the wire only promises label *carriage* (internal use is SHOULD/declared-intent, deliberately un-gated §4). Over-claiming here damages the corpus's falsifiability-honesty posture. | High | Open |
| 0132 | R1 — **Over-grant: a host lets the anonymous actor inherit the authenticated default-on tool baseline** (ADR 0315-class), so a logged-out visitor drives an agent with full authenticated tool authority. | High | Open — mitigated by design; behavioral test lands at `Active` |
| 0132 | R2 — **Credential confused-deputy: a tenant BYOK credential attached to a visitor-triggered egress** → exfiltration to an attacker destination. | High | Open — mitigated by composition; test lands at `Active` |
| 0132 | R3 — **Secret / cross-tenant reach: an anon read tool surfaces a secret or another tenant's data.** | High | Open — mitigated by design; test lands at `Active` |
| 0132 | R4 — **Ungated write abuse: a public surface performs an unbounded, un-approved durable write/egress** (spam, resource exhaustion, data poisoning) at visitor scale. | High | Open — mitigated by design + schema; test lands at `Active` |
| 0132 | R5 — **De-anonymization / cross-linkability: a host keys the anon actor on IP / fingerprint or reuses the id across sessions**, turning an "anonymous" actor into a tracked identity (privacy + regulatory exposure). | High | Open — mitigated by design; opacity test lands at `Active` |
| 0133 | R2 — **Cross-tenant child aliasing: a co-registered child is registered under, or reachable from, the wrong tenant**, or two tenants instantiating the same pack converge on one shared child workflow → cross-tenant data reach. | High | Open — mitigated by design; host-pending witness |
| 0137 | R3 — **A registry adds the kind to manifest validation but not to its indexer**, so packs publish green and undiscoverable. Already measured on the reference registry — not hypothetical. | High | Open (tracked, PR drafted) |
| 0138 | R1 — **"Opaque" is read as "stash it for later."** A host retains an unrecognized extension and later renders it, interpolates it into a prompt, or interprets it as markup. Because the value is pack-authored and untrusted, this converts a *loud publication failure* (rejected at registry `PUT`) into a *silent injection surface* (at render) — strictly worse than having no hatch at all. This is the risk the whole RFC turns on. | High | Open (mitigated, not closed) |
| 0138 | R4 — **Extensions become a de-facto capability channel.** A host infers support from an extension's presence, or makes handling of a canonical field depend on one. Packs then stop being portable in practice while remaining portable on paper — the exact failure the RFC exists to prevent, arriving through the door it opened. | High | Open (mitigated, not closed) |
| 0139 | R1 — **The differential is read as proving total opacity.** A green leg 3 gets cited as "MUST-ignore is verified", when it covers install-time sinks only. This RFC would then have replaced an unverified rule with a *falsely* verified one — worse, because nobody looks again. | Critical | Open (mitigated by disclosure, not closable) |
| 0139 | R3 — **A host games the differential by returning a constant projection.** A seam that returns `{}` regardless of input satisfies leg 3 trivially. | High | Open (bounded, not closed) |
| 0139 | R4 — **Only one kind and one host witness a corpus-wide rule.** The artifact-type seam is the only one with a real implementation, so a rule stated for all pack kinds is evidenced by one. | High | Open, deliberate |
| 0140 | R1 — **`none` is read as permission to re-fire.** The enum's default reads like an opt-out, and an implementer who skims the capability table will conclude that not advertising means the guarantee does not apply — reintroducing exactly the MUST-relaxation this RFC was corrected to avoid. The RFC's own first draft made that mistake. | Critical | Open (mitigated by placement, not closable) |
| 0140 | R2 — **The fail-closed witness is read as proving the happy path.** The scenario's positive evidence is `replay_source_missing` on an unrecorded node. That is unforgeable — but it does not observe whether a node *with* a recorded outcome re-fired and recorded identically. | High | Open (disclosed) |
| 0140 | R5 — **Guarding the convenience wrapper instead of the chokepoint.** A host that guards its highest-level egress helper can leave lower-level paths (raw fetch, MCP tool invocation) open while believing it is covered. | High | Open (guidance, not enforceable by spec) |
| 0143 | R1 — **The completeness leg is read as proving "no unfenced ingress exists"** when it proves "no ingress *in §4* is unfenced." A host adds a new content path to the prompt, never updates §4, and a green suite reads as full coverage. | High | Open (disclosed, not closable server-free) |
| 0143 | R2 — **The isolation carve-out is abused** — a host declares a reader "structurally isolated" that can in fact reach model context or egress, and drops the trust tag legitimately-looking. | High | Open (bounded by definition, host-trust) |
| 0147 | R4 — The remediation program expands the corpus further without improving implementability. | High | `open` Target: RFC 0147 `Active`; Open — **Sweep 2026-08-16:** **Mitigated:** §A freeze in force (no new optional wire capability landed since 0147; 0157 is a § |
| 0147 | R5 — A single umbrella RFC obscures incompatible compatibility classes. | High | `open` Target: each child intake; Mitigated by design |
| 0147 | R7 — Tightening discovery schema closure breaks legal v1 extensions. | High | `open` Target: SR-2 `Active`; Open — **Sweep 2026-08-16:** **Mitigated by design** — runtime schemas stay open; only authoring/certification lints landed (`capa |
| 0147 | R8 — Compensation is marketed as rollback or atomicity. | High | `open` Target: SR-4 `Active`; Open — **Sweep 2026-08-16:** **Mitigated in prose** — `compensation.md` names best-effort durable compensation, `partial`/`manual` |
| 0147 | R11 — Dual legacy/current interop profiles create downgrade attacks. | High | `open` Target: SR-5/SR-6 `Accepted`; Open — **Sweep 2026-08-16:** **Mitigated in suite:** `a2a-version-no-silent-downgrade` / `mcp-version-no-silent-downgrade`  |
| 0147 | R15 — Security-audit funding or vendor availability delays the program. | High | `open` Target: contract before SR-3 `Accepted`; Open — **Sweep 2026-08-16:** **Open, externally gated** — no vendor, no start date (`SECURITY.md` §9). |
| 0147 | R17 — Retrospective review reopens many accepted RFCs and destabilizes v1. | High | `open` Target: SR-9 `Accepted`; Open — **Sweep 2026-08-16:** **Open** — retrospective review not started (RFC 0156 G3). |
| 0147 | R18 — Publicly documenting critical defects creates exploitation risk before fixes ship. | High | `open` Target: immediate triage; Open — **Sweep 2026-08-16:** **Mitigated** — no CVE-class detail was published; program defects were spec/verifier defects, not |
| 0147 | R19 — “A-grade” becomes a one-time badge rather than a maintained evidence state. | High | `open` Target: Workstream 9; Open — **Sweep 2026-08-16:** **Open** — evidence expiry undecided (RFC 0156 G5); bundles carry `generatedAt` + suite version, nothi |
| 0147 | R20 — Reference-host success is again mistaken for independent protocol proof. | High | `open` Target: immediate claims policy; Open — **Sweep 2026-08-16:** **Mitigated in text:** `GOVERNANCE.md` tier taxonomy + `INTEROP-MATRIX.md` evidence vocabul |
| 0148 | R1 — Historic claims are materially invalid. | Critical | Open — **Sweep 2026-08-16:** **Realised, precisely scoped, remediated:** Bundle 1 invalidated; four v2 reissues (`docs/CERTIFICATION-BUNDLE-INVENTORY.md`). No b |
| 0148 | R2 — Witnesses leak response or tenant content. | High | Open — **Sweep 2026-08-16:** **Mitigated:** `--certify` scrubs the finished document with the handed credential + `OPENWOP_*` secrets + the SR-1 canary and self |
| 0148 | R5 — A malicious generator fabricates witnesses. | High | Open — **Sweep 2026-08-16:** **Open** — bundles are reproducible and consumer-verifiable but unsigned; provenance depends on RFC 0154 G4. |
| 0149 | R3 — Runtime closure accidentally breaks additive v1 clients. | High | Open — **Sweep 2026-08-16:** **Mitigated by design** — runtime schemas open; only authoring lints; `discovery-canonical-family-no-shadow` binds consumers not ho |
| 0149 | R5 — Version normalization hides a true incompatible host. | High | Open — **Sweep 2026-08-16:** **Closed** — no normalization is performed; `1.0.0` is rejected outright and no deployed host uses it (G3). |
| 0150 | R1 — Migration duplicates an effect across v1/v2 key spaces. | Critical | Open — **Sweep 2026-08-16:** **Closed as moot** — no v1 keys exist (G1); no dual-read needed while that holds. |
| 0150 | R2 — A semantic provider option is omitted and digest collision remains. | High | Open — **Sweep 2026-08-16:** **Open** (G3). |
| 0150 | R3 — Fencing service outage halts effects. | High | Open — **Sweep 2026-08-16:** **Open — no fencing host** (G10). |
| 0150 | R4 — Provider claims idempotency but retention is too short. | High | Open — **Sweep 2026-08-16:** **Open** (G4). |
| 0151 | R1 — Compensation executes twice. | Critical | Open — **Sweep 2026-08-16:** **Mitigated in prose** — inverse-action identity tuple stated; `compensation.md` §C now states the persistence shape, `attempt` out |
| 0151 | R2 — Inverse action worsens the incident. | Critical | Open — **Sweep 2026-08-16:** **Open — unwitnessed** (§E landed 2026-08-16: approval on the plan entry, RFC 0049 binding, four audited override actions; `SECURIT |
| 0151 | R3 — Users interpret compensation as atomic rollback. | High | Open — **Sweep 2026-08-16:** **Mitigated in prose** — best-effort language, `partial` / `manual` states, `compensationStatus: none` default; claims-test unbuilt |
| 0151 | R4 — Replay re-fires inverse effects. | Critical | Open — **Sweep 2026-08-16:** **Mitigated in suite** — `compensation-replay-no-refire` invariant + `compensation-behavior.test.ts` leg (gated; `blocked` until a  |
| 0151 | R5 — Compensation plan captures secrets. | High | Open — **Sweep 2026-08-16:** **Mitigated in schema** — `compensation-policy.schema.json` carries no credential fields; `--certify` scrubs evidence; no host to t |
| 0152 | R1 — Silent downgrade exposes legacy behavior. | High | Open — **Sweep 2026-08-16:** **Mitigated in suite** — `a2a-version-no-silent-downgrade` + `a2a-version-negotiation.test.ts`; host legs `blocked` (no invoke seam |
| 0152 | R2 — Agent Card and runtime drift. | High | Open — **Sweep 2026-08-16:** **Mitigated in suite** — `a2a-card-runtime-consistency.test.ts` (S15, gated on `a2a.profiles ∋ a2a-1.0`). |
| 0152 | R4 — A2A identity is mistaken for OpenWOP authorization. | Critical | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — `a2a-integration.md` §E; `a2a-peer-authority.test.ts` (host-blocked). |
| 0153 | R1 — Silent downgrade re-enables weaker legacy auth/session behavior. | Critical | Open — **Sweep 2026-08-16:** **Mitigated in suite** — `mcp-version-no-silent-downgrade` + `mcp-version-negotiation.test.ts`; host legs `blocked` on current host |
| 0153 | R2 — MRTR work duplicates after timeout/retry. | High | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — MRTR mapping traced against RFC 0150 identity; `mcp-mrtr-roundtrip.test.ts` (client half host-bloc |
| 0153 | R3 — Cache crosses tenant or authorization scope. | Critical | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — §D scoped key; `mcp-cache-tenant-scope.test.ts` (gated). |
| 0153 | R4 — Extension metadata grants unintended authority. | High | Open — **Sweep 2026-08-16:** **Mitigated** — opaque-by-default (G5) + `mcp-extension-opacity.test.ts`. |
| 0154 | R1 — Provenance is mistaken for authorization. | Critical | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — identity ≠ authorization normative; `delegation-tenant-audience-bound` / `delegation-chain-bounded |
| 0154 | R2 — Delegation amplifies scopes or crosses tenants. | Critical | Open — **Sweep 2026-08-16:** **Mitigated in prose + suite** — intersection-only scopes + tenant/audience binding (`auth.md`); same two invariants; no advertiser |
| 0154 | R3 — Bearer downgrade bypasses sender constraint. | Critical | Open — **Sweep 2026-08-16:** **Open** — sender-constraint minimum-assurance policy in prose; downgrade audit leg absent; no advertiser. |
| 0154 | R4 — Signing key compromise blesses malicious artifacts. | High | Open — **Sweep 2026-08-16:** **Open** — no signing (G4). |
| 0154 | R5 — Telemetry leaks workload or user identity. | High | Open — **Sweep 2026-08-16:** **Mitigated in prose** — opaque hashed identifiers, per-tenant salt, content-free telemetry (`observability.md`; threat model §4.4) |
| 0155 | R2 — Extension budget becomes arbitrary gatekeeping. | High | Open — **Sweep 2026-08-16:** **Open** — budget uncalibrated (G1). |
| 0155 | R3 — Registry maturity is self-awarded without evidence. | Critical | Open — **Sweep 2026-08-16:** **Mitigated by gates** — coverage generator + `--check`; maturity flips still need Tier-3/audit evidence that does not exist. |
| 0155 | R4 — Stable core manifest drifts from prose. | High | Open — **Sweep 2026-08-16:** **Mitigated** — generated manifest + bidirectional parity leg; the 2026-08-16 phantom-floor finding (`audit-log-verification.test.t |
| 0156 | R1 — Independent maintainers do not volunteer. | Critical | Open — **Sweep 2026-08-16:** **Open, Critical** — unchanged. |
| 0156 | R2 — Audit is delayed or underfunded. | High | Open — **Sweep 2026-08-16:** **Open** — unchanged. |
| 0156 | R3 — Sponsored Tier-3 host is effectively steward-controlled. | High | Open — **Sweep 2026-08-16:** **Open** — moot until a Tier-3 candidate exists. |
| 0156 | R4 — Retrospective review destabilizes v1. | High | `open` — queue published 2026-09-02 (`docs/RETROSPECTIVE-QUEUE.md`); review itself needs a second organization; the five entries are `provisional` until then. O |
| 0156 | R6 — Governance becomes performative while lead retains de facto control. | Critical | Open — **Sweep 2026-08-16:** **Open, Critical** — single maintainer; every 2026-08 decision was unilateral by construction, recorded publicly in PRs/CHANGELOG. |
| 0159 | R1 — A host implements the link on **email/`userName`** (mutable/PII) → account-takeover join: a caller who sets their IdP email to a victim's inherits the victim's SAML subject | High | Open (mitigated by §A.2 + negative scenario) |
| 0165 | R1 — A v2-aware client selects v2 from `protocolVersions` against a v1.x host that listed a major it does not serve | High | Open |
| 0165 | R2 — A host emits `owner.subject` on new runs but re-owns forks to the forking principal, breaking the same-key invariant the leaver contract depends on | High | Open |
| 0165 | R3 — A host synthesizes a legacy subject with a guessed real issuer and creates an identity that never existed | High | Open |
| 0165 | R5 — The SDKs keep rejecting the spec's `sha256=` form, so a host that dual-emits still fails SDK verification | High | Open |
| 0166 | R1 — A mechanically classified `witness` is read as a reviewed verdict and used to justify a claim | High | `open` |
| 0167 | R1 — Eleven children drift on shared vocabulary (an axis or alias named two ways) | High | `open` |
| 0167 | R5 — Phase 2 ends with children Active and no host able to implement them (the "unimplemented MUST" pattern the charter names as v1's core defect) | High | `open` |
| 0169 | R3 — The declaration file becomes a fifth registry beside the four it replaces | High | `open` |
| 0170 | R1 — Tenant-bound ids change every run id on the wire and break a client that parses ids | High | `open` |
| 0170 | R5 — Registering eight invariants at once at the cut lands with vacuous tests | High | `open` |
| 0176 | R2 — A host installs the adapter at a wrapper and forks read raw v1 rows | High | `open` |
| 0176 | R4 — `schemas/v2/` ships into a v1 image through an unpinned sync | High | `open` |
| 0177 | R1 — The re-publish wave (282 versions) is not done before a host cuts and a v2 host has zero installable packs | High | `open` |
| 0177 | R2 — A mirror or vendor registry installs a `<2.0.0` pack on a v2 host | High | `open` |

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

