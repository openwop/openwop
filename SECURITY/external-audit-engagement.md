# External Security Review — Engagement Document

> **Status: DRAFT, scope-pinned 2026-05-15.** Vendor-neutral scoping document for the external security review referenced in `SECURITY.md` §9. Solicit quotes against this scope; finalize after vendor selection. Embargo terms align with the disclosure SLA in `SECURITY.md` §6.
>
> **Scope-pin note (SEC-2 close-out, 2026-05-15).** Repo state has advanced since the 2026-05-10 draft: RFC ladder 0001–0012 all `Accepted` (with `Updated:` annotations on each), 0013 remains `Draft`; the Postgres reference host has joined the implementation list and claims `openwop-production` end-to-end; mTLS termination + reasoning-event emission + memory compaction + host-side pack consumption are now mechanically verified on Postgres; high-stakes `core.openwop.{ai,http,mcp,triggers}` packs are built + signed in-tree but remain audit-gated for public publication. The audit engages against the commit pinned in §3 at kickoff.
>
> **Steward pre-audit publication decision (2026-05-17).** The single steward has elected to publish `core.openwop.*` packs to `packs.openwop.dev` **prior to** the external review reaching `Completed`. The list of publications and the rationale are recorded in §2.1.1 below. This decision does **not** retract the audit requirement — the engagement remains live and the post-audit obligations (§2.1.1, last paragraph) bind every published pack listed.

This document defines what the openwop project asks of an external security review firm. It is written before vendor selection so the same scope can be put to multiple firms, and to make the scope auditable by future readers (what was reviewed; what was deliberately out of scope; what evidence the review will produce).

---

## 1. Why a review

The openwop protocol is approaching first non-steward adoption. Several invariants the protocol claims — secret redaction, append-only audit logs, signed node packs, prompt-injection containment — depend on the host honoring them. The conformance suite mechanically verifies many of these end-to-end against the reference host. An independent review:

- Validates that the documented threat models cover the realistic attack surface.
- Identifies invariants stated in the spec that are *not* mechanically enforced.
- Catches design errors in cryptographic protocols (webhook HMAC, node-pack signing, audit-log integrity).
- Produces a public report that prospective implementers can read before committing to the protocol.

---

## 2. Scope

### 2.1 In scope

The review covers the protocol corpus + reference implementations as of the engagement-kickoff date. Specifically:

**Documents:**
- `spec/v1/auth.md` and `spec/v1/auth-profiles.md` (including OAuth2 client-credentials, OIDC user-bearer, mTLS, key rotation, and `openwop-audit-log-integrity` profiles)
- `spec/v1/webhooks.md` (HMAC signing, replay-attack-resistant verification, signature-algorithm versioning)
- `spec/v1/node-packs.md` and `spec/v1/registry-operations.md` (Ed25519 signing, supply-chain controls, registry submission/yank/rotation)
- `spec/v1/mcp-integration.md` (MCP trust boundary, `<UNTRUSTED>` marker discipline)
- `spec/v1/idempotency.md` §"Multi-region idempotency annex" (cross-region conflict resolution)
- All five threat models in `SECURITY/`:
  - `threat-model-auth-profiles.md`
  - `threat-model-secret-leakage.md`
  - `threat-model-prompt-injection.md`
  - `threat-model-node-packs.md`
  - `threat-model-provider-policy.md`
- `SECURITY/invariants.yaml` and the `scripts/check-security-invariants.sh` CI gate

**Implementation:**
- The TypeScript reference host at `examples/hosts/in-memory/` (~570 LOC) and SQLite reference host at `examples/hosts/sqlite/` (~700 LOC) AT THE PINNED COMMIT
- The Python reference host at `examples/hosts/python/` (~600 LOC) AT THE PINNED COMMIT
- **The Postgres reference host at `examples/hosts/postgres/` (~4300 LOC) AT THE PINNED COMMIT** — first host claiming `openwop-production` end-to-end. Implements MemoryAdapter + agent reasoning events + memory compaction (RFC 0012) + OAuth2-CC + OIDC user-bearer + mTLS termination + API-key rotation + auth-scoped discovery + Ed25519 pack consumption with SRI + signature + lockfile fail-closed enforcement.
- The conformance suite at `conformance/` AT THE PINNED COMMIT (review the assertions, not just the protocol surface)
- The three reference SDKs (TypeScript, Python, Go) AT THE PINNED COMMIT

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
- RFCs 0002–0007 (multi-agent extensions — agent identity, agent packs, memory, conversation, orchestrator, dispatch) — all `Accepted`.
- RFC 0008 (WASM ABI for node packs) — `Accepted`; review the ABI and reference loader/conformance scenarios including the misbehaving-memory + misbehaving-abi packs.
- RFC 0009 (Production-Profile Conformance) — `Accepted`; review the production-profile mechanics on the Postgres reference host (backpressure 503 + retention sweep + audit-log integrity claim).
- RFC 0010 (Auth-Profile Conformance) — `Accepted`; review the four production-auth profile claims (OAuth2-CC, OIDC, mTLS, API-key rotation) and the canary-redaction discipline.
- RFC 0011 (Auth-Scoped Discovery Advertisement) — `Accepted`; review the strict-subset projection logic that prevents the discovery payload from leaking capabilities into a less-privileged principal.
- RFC 0012 (Memory Compaction Profile) — `Accepted` 2026-05-15; review the SR-1 carry-forward invariant (§D) end-to-end (the host's `applyCompactionRedaction` re-applies the BYOK redaction harness to summarization output before persistence; failure mode is silent leakage of secrets the summarizer hallucinated).
- RFC 0013 (Workflow-chain packs) — `Draft`; out of scope unless the RFC advances to `Active` before kickoff.

### 2.1.1 Steward pre-audit publication decision (2026-05-17)

The single steward has elected to publish the following 17 `core.openwop.*` pack artifacts to `packs.openwop.dev` **prior to** the external review reaching `Completed`. All 17 are signed with `keyId=openwop-team-1` (Ed25519 over `pack.json` bytes, per the existing signing recipe).

**Patch-bump publications (existing 1.0.0 stays available alongside the new 1.1.0):**

| Pack | Old version | New version |
|---|---|---|
| `core.openwop.ai` | 1.0.0 | **1.1.0** |
| `core.openwop.data` | 1.0.0 | **1.1.0** |
| `core.openwop.http` | 1.0.0 | **1.1.0** |
| `core.openwop.mcp` | 1.0.0 | **1.1.0** |
| `core.openwop.triggers` | 1.0.0 | **1.1.0** |
| `core.openwop.integration` | 1.0.0 | **1.1.0** |

**First-time publications:**

| Pack | Version | Surface notes |
|---|---|---|
| `core.openwop.a2a` | 1.1.0 | A2A client + server-side nodes. Touches `secret-leakage`, `auth-profiles`. |
| `core.openwop.agents` | 1.0.0 | n8n-style agent composition. Wraps `host.aiProviders`. |
| `core.openwop.crypto` | 1.0.0 | Pure `node:crypto` primitives. No external I/O. |
| `core.openwop.db` | 1.0.0 | SQL / NoSQL / search / vector. Depends on `host.db.*` (RFC 0018) — parametric-only SQL invariant. |
| `core.openwop.files` | 1.0.0 | `host.fs` (RFC 0014) — path-traversal invariant. |
| `core.openwop.flow` | 1.0.1 | Pure flow-control primitives. No external I/O. |
| `core.openwop.hitl` | 1.0.0 | Suspends via existing interrupt mechanism. |
| `core.openwop.messaging` | 1.0.0 | `host.queueBus` (RFC 0017) — cross-tenant message isolation. |
| `core.openwop.obs` | 1.0.0 | Observability emitters. |
| `core.openwop.rag` | 1.0.0 | Loaders + vector ops. Touches `host.db.vector`. |
| `core.openwop.storage` | 1.0.0 | kv / table / cache / blob / queue (RFCs 0015–0019) — cross-tenant isolation. |

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

1. **Secret redaction (SR-1)** — does the spec + reference impl guarantee that BYOK plaintext never reaches persisted state, debug bundles, audit logs, or event streams under any combination of node-pack code paths?
2. **Audit-log integrity** — is the hash chain + signed checkpoint design in `auth-profiles.md` §"Audit-log integrity" sound against the documented threat model (admin-with-storage-write but not signing-key access)?
3. **Webhook HMAC** — is the `{timestamp}.{rawBody}` HMAC scheme resistant to the documented replay attacks; does the algorithm-versioning header preserve forward compatibility without enabling downgrade attacks?
4. **Node-pack signing** — is the Ed25519 signing + tarball-integrity model robust against tampering, key rotation timing attacks, and the documented supply-chain threats in `threat-model-node-packs.md`?
5. **Prompt-injection containment (MCP integration)** — does the `<UNTRUSTED>` marker discipline survive realistic adversarial MCP tool responses? Are there code paths where tool output silently merges into trusted state?
6. **Multi-tenant isolation** — can a tenant influence another tenant's runs via shared idempotency cache, shared registry index, shared signing-key fingerprints, or shared in-flight event streams?
7. **WASM ABI safety** (RFC 0008 §G + §K) — do the deterministic-time / deterministic-random / memory-cap invariants close the obvious side-channel + DoS paths?
8. **Replay safety** — does fork-from-arbitrary-event preserve secret redaction and idempotency invariants? Can a `replay` mode resurrect deleted memory content per RFC 0004 §A?
9. **Memory compaction carry-forward (RFC 0012 §D)** — does the host's redaction-on-derived-content harness actually re-redact summarizer output? Can an adversarial source-entry sequence get the compactor to emit a non-canonical `<REDACTED:...>` form-leak that escapes the canonical `[REDACTED:...]` substitution? Review `examples/hosts/postgres/src/memory-adapter.ts` `applyCompactionRedaction` + the SR-1 carry-forward conformance scenario.
10. **Pack-consumer fail-closed posture** — host-side install-time checks per `node-packs.md` §"Dependency resolution + lockfile" + §"Signing recipe" (SRI integrity, Ed25519 signature, version drift, lockfile parse). Review `examples/hosts/postgres/src/pack-consumer.ts` + the 9-path host smoke; verify the host cannot mount a pack whose any check fails.

### 2.3 Out of scope

- Production deployments (Firebase Hosting config, DNS, runtime ops). The review covers the protocol + reference impl; deployment hardening is the deployer's responsibility.
- Code quality / non-security style review.
- Performance / load testing.
- LLM provider APIs themselves (we trust the providers' own security posture; openwop's wrapper is in scope).
- Code paths flagged "non-normative" or "host extension" — these are vendor responsibility per `host-extensions.md`.

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
3. **Threat-model annotations** — the reviewer marks each MUST/MUST-NOT in the five threat models as either (a) adequately enforced by spec + reference impl, (b) enforced by spec but not mechanically verified, or (c) underspecified.
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

- `openwop-audit-log-integrity` conformance scenarios PASS on the reference host. Reviewers should not pay rates to verify claims that aren't yet mechanically enforced.
- All Phase-1 / Phase-2 work from `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` is landed (no in-flight normative changes during the review window).
- Repository at a pinned commit hash, frozen for the review duration.
- A maintainer is available to answer reviewer questions within 1 business day.

---

## 6. Embargo and disclosure

- All findings under the standard 90-day embargo per `SECURITY.md` §6, extendable to 180 days for safety-fix breaks per `COMPATIBILITY.md` §3.
- The reviewer signs an NDA before access to any non-public artifact. (The protocol itself is public, so the NDA is narrow — it covers findings before public release.)
- Critical-severity findings (CVSS ≥ 9.0) trigger immediate coordinated disclosure with downstream implementers listed in `INTEROP-MATRIX.md`.
- The public report is posted on the project's site after the embargo window closes, regardless of whether all findings are remediated. Open findings carry mitigations documented in the same post.

---

## 7. Budget

Target range: **$15,000 – $40,000 USD** for a fixed-bid engagement covering scope §2.1 and deliverable §3.

- The lower end is realistic for a focused engagement covering only the auth + webhook + node-pack + audit-log layers (~80 hours).
- The upper end covers the full multi-agent + WASM ABI scope (~200 hours), including a retest.

A retest after remediation lands counts as 25% additional cost, capped at $10,000.

---

## 8. Status tracker

| Step | Status | Date |
|---|---|---|
| Engagement doc drafted | ✅ | 2026-05-10 |
| Per-vendor outreach drafts ready | ✅ | 2026-05-11 — see `SECURITY/outreach/external-audit/` (5 vendors). Per-vendor reply status tracked in `SECURITY/outreach/external-audit/STATUS.md`. |
| Vendor outreach sent | — | TBD |
| Quotes received | — | TBD |
| Vendor selected | — | TBD |
| Contract signed | — | TBD |
| Repository commit pinned | — | TBD |
| Kickoff | — | TBD |
| Findings delivered | — | TBD |
| Remediation lands | — | TBD |
| Public report posted | — | TBD |

This file gets updated as each step completes. The `SECURITY.md` §9 link points here once the engagement starts.

---

## 9. References

- `SECURITY.md` (disclosure SLA, advisory format)
- `COMPATIBILITY.md` §3 (safety-fix exception window)
- `SECURITY/threat-model-*.md` (five threat models)
- `SECURITY/invariants.yaml` (machine-readable invariants the review verifies)
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 9 (governance + interop evidence)
