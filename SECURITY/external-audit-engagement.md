# External Security Review — Engagement Document

> **Status: DRAFT 2026-05-10.** Vendor-neutral scoping document for the external security review referenced in `SECURITY.md` §9. Solicit quotes against this scope; finalize after vendor selection. Embargo terms align with the disclosure SLA in `SECURITY.md` §6.

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
- The conformance suite at `conformance/` AT THE PINNED COMMIT (review the assertions, not just the protocol surface)
- The three reference SDKs (TypeScript, Python, Go) AT THE PINNED COMMIT

**Spec-canonical `core.openwop.*` node packs (high-stakes, REQUIRED before publication):**
These packs are advertised throughout the spec and will become permanent immutable artifacts on `packs.openwop.dev` once published. The audit MUST cover each before `(name, 1.0.0)` is published. Until then they remain unpublished in this repo (source under `packs/core.openwop.*/`).
- `core.openwop.ai` — calls external AI providers (OpenAI, Anthropic, etc.) with BYOK secrets. Threat models touched: `secret-leakage`, `provider-policy`, `prompt-injection`.
- `core.openwop.http` — makes arbitrary outbound HTTP calls. Threat models touched: `secret-leakage` (headers), `provider-policy` (egress allowlists).
- `core.openwop.mcp` — invokes MCP tools across the trust boundary. Threat models touched: `prompt-injection` (UNTRUSTED-marker discipline), `secret-leakage`.
- `core.openwop.triggers` — webhook + schedule + envelope trigger surfaces. Threat models touched: `auth-profiles` (callback-token verification), webhook HMAC signing.
- `core.openwop.agent-examples` — `runtime: remote` pack; spec for `remote` runtime semantics is incomplete in v1, so audit is deferred until the runtime contract sharpens (likely v1.2+).

**RFCs (drafts at engagement kickoff):**
- RFCs 0002–0007 (multi-agent extensions — agent identity, agent packs, memory, conversation, orchestrator, dispatch)
- RFC 0008 (WASM ABI for node packs — likely still `Draft` at kickoff; review the ABI even if implementation is pending)

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
| Vendor outreach | — | TBD |
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
