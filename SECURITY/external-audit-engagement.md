# External Security Review — Engagement Document

> **Status: DRAFT, re-scoped for v2 on 2026-11-13. Not sent.** Vendor-neutral scoping document for the external security review referenced in `SECURITY.md` §9. Solicit quotes against this scope; finalize after vendor selection. Embargo terms align with the disclosure SLA in `SECURITY.md` §6. Sending outreach commits the project to spending money, so it needs the steward's explicit go; this re-scope is not that go.
>
> **Re-scope note (2026-11-13).** The May 2026 scope covered the v1 corpus (RFCs 0001–0033, the in-memory, SQLite, Python and Postgres example hosts). v1 reached end of support on 2026-10-04 ([RFC 0234](../RFCS/0234-maintainer-set-v1-end-of-support.md)), so §1, §2.1, §2.2, §2.3 and §5 now describe the v2 protocol. §2.1.1 is unchanged: it records a decision taken in May whose obligations still bind.
>
> **Steward pre-audit publication decision (2026-05-17).** The single steward has elected to publish `core.openwop.*` packs to `packs.openwop.dev` **prior to** the external review reaching `Completed`. The list of publications and the rationale are recorded in §2.1.1 below. This decision does **not** retract the audit requirement — the engagement remains live and the post-audit obligations (§2.1.1, last paragraph) bind every published pack listed.

This document defines what the openwop project asks of an external security review firm. It is written before vendor selection so the same scope can be put to multiple firms, and to make the scope auditable by future readers (what was reviewed; what was deliberately out of scope; what evidence the review will produce).

---

## 1. Why a review

The openwop protocol is at v2 and has no host outside the steward's organization yet. Several invariants the protocol claims — secret redaction, tenant isolation, signed node packs, signed certification bundles, prompt-injection containment — depend on the host honoring them. `SECURITY/invariants.yaml` lists 224 of them, and the conformance suite verifies many end-to-end against two hosts the steward operates. Nobody outside the project has reviewed any of them. An independent review:

- Validates that the documented threat models cover the realistic attack surface.
- Identifies invariants stated in the spec that are _not_ mechanically enforced.
- Catches design errors in cryptographic protocols (webhook HMAC, node-pack signing, audit-log integrity).
- Produces a public report that prospective implementers can read before committing to the protocol.

---

## 2. Scope

### 2.1 In scope

The review covers the v2 protocol corpus and its reference implementations at the commit pinned at kickoff. `spec/v1/` is a frozen tree past end of support and is out of scope. Specifically:

**Documents (v2):**

- `spec/v2/core/identity.md`, `oauth.md` and `security-defaults.md`: the auth lanes (API key, OIDC, session, workload, mTLS), tenant-bound identifiers, the obligation table that binds a protecting behaviour to an advertised surface, and the compensation section.
- `spec/v2/core/interrupt.md`: the `ow2.<alg>.<kid>.<payload>.<mac>` resume-token scheme, approver enforcement, and the token-presentation record (RFC 0259 `resolvedVia`).
- `spec/v2/core/webhooks.md`: signing, replay-resistant verification, secret rotation and the SSRF refusal set.
- `spec/v2/core/idempotency.md` and `replay.md`: Layer-1 and Layer-2 identity, effect suppression on replay and fork, and the multi-region rules.
- `spec/v2/core/packs.md`, `node-pack-runtimes.md` and `workflow-chain-packs.md`: Ed25519 pack signing, install-time fail-closed checks, and pack isolation.
- `spec/v2/core/interop.md`: the MCP 2026-07-28 and A2A 1.0 trust boundaries, untrusted-content discipline, and trace-context propagation.
- `spec/v2/core/storage.md` and `persistence.md`: cross-tenant isolation across the storage surfaces.
- `spec/v2/core/conformance.md`: the signed certification bundle (Ed25519 over `{witnessSha256, host.build, suite.version, discovery.sha256}`) and the colocated-companion pairing rules (RFC 0216).
- The nine threat models in `SECURITY/` (`threat-model-*.md`).
- `SECURITY/invariants.yaml` (224 rows) and the `scripts/check-security-invariants.sh` gate.

**Implementation:**

- The v2 reference host, `openwop/openwop-examples` `examples/hosts/v2-reference/` (about 11,000 lines of TypeScript, node:http + better-sqlite3 + node:crypto), at the pinned commit.
- The reference application, `openwop/openwop-app`, backend only: auth and tenant isolation, the idempotency store, interrupt-token issuance and resolution, the MCP server mount, and pack isolation. Deployment configuration stays out of scope (§2.3).
- The conformance suite at `conformance/` at the pinned commit. Review the assertions, not only the protocol surface: a row whose assertions cannot fail is a finding.
- The three SDKs in `openwop/openwop-sdks` (TypeScript, Python, Go) at the pinned commit.

**Spec-canonical `core.openwop.*` node packs (high-stakes, REQUIRED before publication):**
These packs are advertised throughout the spec and will become permanent immutable artifacts on `packs.openwop.dev` once published. The audit MUST cover each before `(name, 1.0.0)` is published. ~~Until then they remain unpublished in this repo (source under `packs/core.openwop.*/`).~~ See §2.1.1 below: the steward elected to publish ahead of audit completion on 2026-05-17.

- `core.openwop.ai` — calls external AI providers (OpenAI, Anthropic, etc.) with BYOK secrets. Threat models touched: `secret-leakage`, `provider-policy`, `prompt-injection`.
- `core.openwop.http` — makes arbitrary outbound HTTP calls. Threat models touched: `secret-leakage` (headers), `provider-policy` (egress allowlists).
- `core.openwop.mcp` — invokes MCP tools across the trust boundary. Threat models touched: `prompt-injection` (UNTRUSTED-marker discipline), `secret-leakage`.
- `core.openwop.triggers` — webhook + schedule + envelope trigger surfaces. Threat models touched: `auth-profiles` (callback-token verification), webhook HMAC signing.
- `core.openwop.agent-examples` — `runtime: remote` pack; spec for `remote` runtime semantics is incomplete in v1, so audit is deferred until the runtime contract sharpens (likely v1.2+).

**Agent-pack catalog batch (added 2026-05-17, in-tree, NOT YET PUBLISHED):**

27 new agent packs landed in-tree on 2026-05-17 against the RFC 0003 surface (in addition to bumping `core.openwop.agent-examples` from 1.0.0 → 1.1.0 with 3 new fixture agents). All 26 of these are pure-agent packs (`runtime.language: "remote"`, no executable runtime); 1 is a hybrid (the skills-bridge pack ships a small JavaScript node). They share the same publication gate as the other in-tree-only core packs above — publication to `packs.openwop.dev` is deferred until the external audit covers them per the rules of this engagement.

Audit scope per pack: validate (a) the `systemPromptRef` body for prompt-injection escape vectors (the prompts are user-facing surfaces in BYOK contexts); (b) the `toolAllowlist` against the published node-pack catalog for least-privilege overreach; (c) the `handoff.{task,return}SchemaRef` JSON Schemas for unsafe `additionalProperties: true` leakage of caller-controlled fields into trusted persistence; (d) for `memoryShape.longTerm: true` agents, that the host's RFC 0004 redaction harness fires on every cross-run write the agent persona could induce. Skills-bridge specifically requires source-review of `packs/core.openwop.skills-bridge/index.mjs` for the SKILL.md parser (untrusted-input parser, runs on host).

Pure-agent packs (`core.openwop.*`, signed by `openwop-team-1`):

- **Tier 1 — horizontal patterns (8):** `agents.react`, `agents.supervisor`, `agents.deep-research`, `agents.structured-extractor`, `agents.classifier`, `agents.long-doc-summarizer`, `agents.code-reviewer`, `agents.doc-writer`.
- **Tier 2 — productivity skills (5):** `agents.document-author`, `agents.frontend-designer`, `agents.git-author`, `agents.api-designer`, `agents.test-author`.
- **Tier 3 — horizontal verticals (8):** `agents.sdr`, `agents.sales-coach`, `agents.support-triage`, `agents.support-resolver`, `agents.invoice-extractor`, `agents.expense-categorizer`, `agents.policy-reviewer`, `agents.audit-summarizer`. `longTerm: true` on 4 of these (sdr, sales-coach, support-resolver, audit-summarizer) — verify redaction-harness coverage.
- **Tier 4 — multi-agent crews (3):** `agents.research-crew` (4 agents), `agents.devops-crew` (3 agents — gated on `host.fs` + `host.queueBus`), `agents.support-crew` (3 agents).
- **Hybrid bridge (1):** `skills-bridge` — 1 node (JS runtime, `core.skills-bridge.convert`) + 1 agent (`adapter`). Audit MUST review the SKILL.md parser implementation.

Vendor showcase packs (`vendor.myndhyve.*`, signed by `myndhyve-internal-1`):

- `vendor.myndhyve.market-intel-crew` — wraps 9 `market-intel-*` typeIds into a Research Director persona.
- `vendor.myndhyve.ads-crew` — wraps 14 `ads-*` typeIds into a Creative Director persona with 4 operating modes.

Cross-cutting checks for all 27 + the 3 new fixture agents: (1) every `toolAllowlist` entry resolves to a node typeId that itself has cleared audit; (2) every prompt under `packs/<name>/prompts/` is reviewed against `SECURITY/threat-model-prompt-injection.md` UNTRUSTED-marker discipline; (3) handoff schemas with `oneOf [success, error]` shapes are validated by the host's RFC 0003 §D resolver before persistence; (4) the new conformance scenario `conformance/src/scenarios/agentPackHandoffSchemaValidation.test.ts` (HV-1) passes against the reference Postgres host with these packs installed.

Publication condition: each pack listed above moves from "in-tree" to "published on `packs.openwop.dev`" only when audit findings touching that pack are either (a) marked `informational` only, or (b) remediated and the remediation merged. Aggregate condition for the batch: all 27 + 1 must be cleared together (a single dangling finding holds the batch).

**RFCs (state at engagement kickoff):**

The core documents above own the rules, and an RFC never restates a rule a core document owns. The RFCs below are the security-relevant ones a reviewer should read for rationale and for the threats each one names. Statuses are as of 2026-11-13 and are re-checked at kickoff from `docs/PROTOCOL-STATUS.md`.

- RFC 0167 (the v2 umbrella) and RFC 0170 (v2 identity: lanes, tenant-bound ids).
- RFCs 0148–0150 (non-vacuous certification, machine-contract reconciliation, and effect identity, replay and split-brain safety), the Workstream 1–3 children of RFC 0147.
- RFC 0151 (compensation and partial failure) and RFC 0158 (durable execution and disaster-recovery qualification).
- RFCs 0152 and 0153 (A2A 1.0 and MCP 2026-07-28 composition), RFC 0175 (transports and embedded protocols) and RFC 0204 (the host MCP client).
- RFC 0173 (v2 security defaults, including pack isolation and the effect-seam manifest), RFC 0199 (the outbound OAuth client and credential interrupt) and RFC 0201 (the Standard Webhooks signature scheme and secret rotation).
- RFC 0216 (colocated companion bundles), because it decides which evidence counts and an error there would let an unwitnessed row certify.
- RFC 0259 (`interrupt.resolved.resolvedVia`; `Active`): a forwarded link and a bound link must never be recorded as a signed-in approval.

### 2.1.1 Steward pre-audit publication decision (2026-05-17)

The single steward has elected to publish the following 17 `core.openwop.*` pack artifacts to `packs.openwop.dev` **prior to** the external review reaching `Completed`. All 17 are signed with `keyId=openwop-team-1` (Ed25519 over `pack.json` bytes, per the existing signing recipe).

**Patch-bump publications (existing 1.0.0 stays available alongside the new 1.1.0):**

| Pack                       | Old version | New version |
| -------------------------- | ----------- | ----------- |
| `core.openwop.ai`          | 1.0.0       | **1.1.0**   |
| `core.openwop.data`        | 1.0.0       | **1.1.0**   |
| `core.openwop.http`        | 1.0.0       | **1.1.0**   |
| `core.openwop.mcp`         | 1.0.0       | **1.1.0**   |
| `core.openwop.triggers`    | 1.0.0       | **1.1.0**   |
| `core.openwop.integration` | 1.0.0       | **1.1.0**   |

**First-time publications:**

| Pack                     | Version | Surface notes                                                                                     |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------- |
| `core.openwop.a2a`       | 1.1.0   | A2A client + server-side nodes. Touches `secret-leakage`, `auth-profiles`.                        |
| `core.openwop.agents`    | 1.0.0   | n8n-style agent composition. Wraps `host.aiProviders`.                                            |
| `core.openwop.crypto`    | 1.0.0   | Pure `node:crypto` primitives. No external I/O.                                                   |
| `core.openwop.db`        | 1.0.0   | SQL / NoSQL / search / vector. Depends on `host.db.*` (RFC 0018) — parametric-only SQL invariant. |
| `core.openwop.files`     | 1.0.0   | `host.fs` (RFC 0014) — path-traversal invariant.                                                  |
| `core.openwop.flow`      | 1.0.1   | Pure flow-control primitives. No external I/O.                                                    |
| `core.openwop.hitl`      | 1.0.0   | Suspends via existing interrupt mechanism.                                                        |
| `core.openwop.messaging` | 1.0.0   | `host.queueBus` (RFC 0017) — cross-tenant message isolation.                                      |
| `core.openwop.obs`       | 1.0.0   | Observability emitters.                                                                           |
| `core.openwop.rag`       | 1.0.0   | Loaders + vector ops. Touches `host.db.vector`.                                                   |
| `core.openwop.storage`   | 1.0.0   | kv / table / cache / blob / queue (RFCs 0015–0019) — cross-tenant isolation.                      |

**Why this decision was made:**

1. **First non-steward adopters need the registry-served packs to integrate.** The reference application (`apps/workflow-engine/`) and the postgres reference host already exercise the pack-consumer + signed-pack-load surface end-to-end with in-tree packs; integration partners need the same packs served from `packs.openwop.dev` to reproduce that flow without checking out this repo. Holding the registry empty while waiting for the audit blocks every external user of the protocol from validating their host implementations.
2. **The surface area being published is overwhelmingly low-risk.** 11 of the 17 publications are first-time packs whose pack-side code is either pure-stdlib (`flow`, `crypto`, `obs`, `data`, `hitl`) or delegates to host capabilities the host MUST already enforce (`storage`, `db`, `files`, `messaging`, `rag`, `agents`, `a2a`). The pack itself ships no novel cryptography, no novel auth flow, and no new credential-handling code paths beyond what the existing `core.openwop.ai@1.0.0` (audit-pending baseline) already established.
3. **Patch bumps are additive node typeIds only.** No `core.openwop.{ai,http,mcp,triggers,data,integration}@1.1.0` removes or modifies an existing 1.0.0 typeId; the 1.0.0 artifacts remain immutable and untouched in the registry. Consumers can pin `@1.0.0` if they want zero pre-audit code surface.
4. **Yank capability is preserved.** Every published artifact may be yanked via the documented PR + registry-redeploy flow if the audit surfaces a finding that requires it. Steward retains direct write access to the registry tree.

**Risks the steward accepts by publishing pre-audit:**

- Any of the 6 patch-bumped packs' new typeIds may carry a defect not caught by in-tree review that an external auditor would have caught.
- Any of the 11 first-time packs may have a host-capability-contract bug that is harder to fix once a host has cached the tarball + verified signature locally.
- Public registry users may treat `packs.openwop.dev`-served packs as audit-blessed; the steward MUST keep the "audit pending" status visible (this document + CHANGELOG + `SECURITY.md` §9).

**Post-publication obligations (binding):**

1. The external review documented in this document MUST still run on the published artifacts. The audit's findings tracker (`SECURITY/external-audit-findings.json`) MUST list every finding affecting any of the 17 published artifacts.
2. If the audit surfaces a `Critical` or `High` finding against any published pack, the steward MUST yank the affected version per `node-packs.md` §"Deprecation and yank" within 14 days of finding receipt, and ship a fixed `<name>@<next-patch>` simultaneously.
3. `Medium` or below findings are resolved in the next scheduled release; the deprecation timeline aligns with `SECURITY.md` §6 disclosure SLA.
4. No further `core.openwop.*` pack may be published — patch bumps included — until the audit findings on the 17 listed artifacts have been triaged. (This includes `core.openwop.examples`, `core.openwop.agent-examples`, and any future pack.)
5. The steward decision recorded here MUST be cited in the audit deliverable's "scope as audited" section so reviewers know which artifacts were live on the registry before their review started.

### 2.2 Specific questions the review answers

The deliverable MUST include explicit findings on:

1. **Secret redaction.** Do the spec and both implementations guarantee that BYOK plaintext never reaches persisted state, debug bundles, audit records, event streams or webhook deliveries, under any combination of pack code paths?
2. **Tenant isolation.** Can a tenant influence another tenant's runs through the idempotency store, tenant-bound identifiers, storage surfaces, dead-letter reads, host events or in-flight event streams? Does a foreign-tenant id fail without revealing whether it exists?
3. **Interrupt tokens.** Is the `ow2` HMAC token scheme sound against forgery, key-id confusion and replay? Does a token presentation ever get recorded as an authenticated approval, and can a bound link's binding be forged or transplanted?
4. **Webhook signing.** Is the signing scheme resistant to the documented replay attacks, and does secret rotation's overlap window avoid a downgrade or a window where an old secret still verifies after it should not?
5. **Node-pack signing and isolation.** Is the Ed25519 signing and tarball-integrity model robust against tampering and key-rotation attacks? Does the host refuse to mount a pack that fails any install-time check? Does the pack-isolation runtime contain an untrusted pack's filesystem, network and environment access?
6. **Untrusted content across MCP and A2A.** Does tool and peer output ever merge silently into trusted state? Is trace context propagated without leaking tenant identifiers?
7. **Replay safety.** Does a fork from an arbitrary event preserve secret redaction, idempotency and effect suppression? Can a replay re-fire an external effect, or return a cached result recorded for a different request?
8. **Certification integrity.** Can a host produce a signed bundle that certifies a profile it does not meet: a vacuous row, a transplanted witness, a companion bundle counting rows it may not, or a bundle whose `host.build` does not match the served build?

Each answer names the core-document section and the invariant rows it tested.

### 2.3 Out of scope

- The frozen v1 tree (`spec/v1/`) and the retired v1 example hosts.
- Production deployments (hosting and CDN configuration, DNS, runtime operations). The review covers the protocol and the reference implementations; deployment hardening is the deployer's responsibility.
- Code quality or non-security style review.
- Performance and load testing.
- LLM provider APIs themselves. openwop's wrapper around them is in scope.
- Host extensions under `extensions.<org>.*`, which are the vendor's responsibility.
- Conformance test seams (`/conformance/seams/…`), which no production host serves, except where a seam's existence would let a production host certify falsely (§2.2 question 8).

---

## 3. Deliverable shape

The review produces:

1. **Findings report** (PDF or signed Markdown) listing each issue with:
   - CVSS 3.1 score (severity)
   - CWE classification
   - Reproducible proof-of-concept (when applicable)
   - Affected files + line ranges
   - Suggested remediation
2. **Executive summary** (≤ 3 pages) suitable for posting to the public site.
3. **Threat-model annotations** — the reviewer marks each MUST/MUST-NOT in the nine threat models as either (a) adequately enforced by spec + reference impl, (b) enforced by spec but not mechanically verified, or (c) underspecified.
4. **Remediation tracker** — issue list as machine-readable JSON (`SECURITY/external-audit-findings.json`) so the project can map findings to advisory IDs in the `openwop-SA-YYYY-NNNN` format.
5. **Optional retest** within 90 days after remediation lands.

---

## 4. Vendor selection criteria

Quotes solicited from at least three of:

- Trail of Bits
- NCC Group
- Doyensec
- Cure53
- Latacora

Selection weighting:

- Track record on protocol-level reviews (especially OAuth-adjacent, supply-chain, multi-tenant SaaS): 40%
- Demonstrated experience with workflow / agent / LLM-adjacent systems: 25%
- Schedule fit (engagement within next 90 days): 15%
- Public-report quality (the firm's prior reports are publicly available + well-written): 10%
- Cost: 10%

The project prefers fixed-bid engagements over time-and-materials. Time-and-materials engagements require a documented cap.

---

## 5. Engagement preconditions

The project commits to the following before kickoff:

- Both reference implementations have a current certified v2 bundle committed under `evidence/v2-host-bundles/`, with 0 executed-fail and 0 blocked rows. Reviewers should not pay rates to verify claims that aren't yet mechanically enforced.
- No security-relevant RFC is in its comment window during the review, so the surface does not move under the reviewers.
- The corpus, the reference host and the reference application each pinned at a commit, frozen for the review duration.
- A maintainer is available to answer reviewer questions within 1 business day.

---

## 6. Embargo and disclosure

- All findings under the standard 90-day embargo per `SECURITY.md` §6, extendable to 180 days for safety-fix breaks per `COMPATIBILITY.md` §3.
- The reviewer signs an NDA before access to any non-public artifact. (The protocol itself is public, so the NDA is narrow — it covers findings before public release.)
- Critical-severity findings (CVSS ≥ 9.0) trigger immediate coordinated disclosure with downstream implementers listed in `INTEROP-MATRIX.md`.
- The public report is posted on the project's site after the embargo window closes, regardless of whether all findings are remediated. Open findings carry mitigations documented in the same post.

---

## 7. Budget

Target range: **$15,000 – $40,000 USD** for a fixed-bid engagement covering scope §2.1 and deliverable §3. The range was set in May 2026 against the v1 scope and has not been re-estimated for v2; the steward confirms it before outreach.

- The lower end is realistic for a focused engagement covering only the auth + webhook + node-pack + audit-log layers (~80 hours).
- The upper end covers the full multi-agent + WASM ABI scope (~200 hours), including a retest.

A retest after remediation lands counts as 25% additional cost, capped at $10,000.

---

## 8. Status tracker

| Step                             | Status | Date                                                                                                                                               |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engagement doc drafted           | ✅     | 2026-05-10                                                                                                                                         |
| Per-vendor outreach drafts ready | ✅     | 2026-05-11 — see `SECURITY/outreach/external-audit/` (5 vendors). Per-vendor reply status tracked in `SECURITY/outreach/external-audit/STATUS.md`. |
| Scope re-cut for v2              | ✅     | 2026-11-13 — this document. The five per-vendor drafts still describe the v1 scope and are updated before sending.                                 |
| Vendor outreach sent             | —      | TBD                                                                                                                                                |
| Quotes received                  | —      | TBD                                                                                                                                                |
| Vendor selected                  | —      | TBD                                                                                                                                                |
| Contract signed                  | —      | TBD                                                                                                                                                |
| Repository commit pinned         | —      | TBD                                                                                                                                                |
| Kickoff                          | —      | TBD                                                                                                                                                |
| Findings delivered               | —      | TBD                                                                                                                                                |
| Remediation lands                | —      | TBD                                                                                                                                                |
| Public report posted             | —      | TBD                                                                                                                                                |

This file gets updated as each step completes. The `SECURITY.md` §9 link points here once the engagement starts.

---

## 9. References

- `SECURITY.md` (disclosure SLA, advisory format)
- `COMPATIBILITY.md` §3 (safety-fix exception window)
- `SECURITY/threat-model-*.md` (nine threat models)
- `SECURITY/invariants.yaml` (machine-readable invariants the review verifies)
- `docs/ASSURANCE-STATUS.md` (the claims this review would unlock) and `docs/KNOWN-LIMITS.md` §"External-action gates" (SEC-1)
