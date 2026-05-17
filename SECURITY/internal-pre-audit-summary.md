# Internal Pre-Audit Triage Summary

**Engagement:** Steward-internal review of the 17 `core.openwop.*` pack artifacts published to `packs.openwop.dev` ahead of the external security audit per `SECURITY/external-audit-engagement.md` §2.1.1.

**Status:** First-pass review complete. Findings recorded machine-readably in `SECURITY/internal-pre-audit-findings.json` (CycloneDX-adjacent schema; validates against `SECURITY/external-audit-findings.schema.json`).

**Date:** 2026-05-17

**Reviewer:** steward-internal (the protocol's single steward)

**Engagement commit:** `1c9dba6d791d103b77af0d7dbd8724ec1b246b3c`

---

## Scope as reviewed

All 17 published artifacts, read at the pack-runtime layer (`packs/core.openwop.<name>/index.mjs`), the manifest (`pack.json`), and the JSON Schemas. Cross-referenced against the 10 audit questions in `SECURITY/external-audit-engagement.md` §2.2 plus the protocol-tier invariants in `SECURITY/invariants.yaml`.

| Pack | Version | Surface read |
|---|---|---|
| `core.openwop.a2a` | 1.1.0 | 17 nodes routing `ctx.a2a.*` |
| `core.openwop.agents` | 1.0.0 | agent.run + 11 sub-nodes |
| `core.openwop.ai` | 1.1.0 | 15 nodes routing `ctx.callAI` / `ctx.callAIWithTools` |
| `core.openwop.crypto` | 1.0.0 | 13 `node:crypto`-backed primitives |
| `core.openwop.data` | 1.1.0 | 37 pure utilities (regex, string, json, csv, datetime, number, uuid) |
| `core.openwop.db` | 1.0.0 | 12 SQL / NoSQL / search / vector delegates |
| `core.openwop.files` | 1.0.0 | 19 fs / image / pdf / archive / ftp / sftp / ssh delegates |
| `core.openwop.flow` | 1.0.1 | 29 pure flow-control primitives |
| `core.openwop.hitl` | 1.0.0 | 3 suspend-based HITL primitives |
| `core.openwop.http` | 1.1.0 | 23 transports (fetch, openapi, GraphQL, gRPC, SSE, WebSocket, upload, …) |
| `core.openwop.integration` | 1.1.0 | 7 cross-cutting (email, slack, sms, voice, push) |
| `core.openwop.mcp` | 1.1.0 | 21 MCP client + server-side nodes |
| `core.openwop.messaging` | 1.0.0 | 7 publish / consume / stream delegates |
| `core.openwop.obs` | 1.0.0 | 7 observability emitters |
| `core.openwop.rag` | 1.0.0 | 13 RAG primitives (loaders, splitters, retrievers, vector ops) |
| `core.openwop.storage` | 1.0.0 | 20 kv / table / cache / blob / queue delegates |
| `core.openwop.triggers` | 1.1.0 | 16 trigger surfaces |

---

## Findings count by severity

| Severity | Count | Finding IDs |
|---|---|---|
| Critical | 0 | — |
| High | 3 | 001 (JWT alg-confusion), 002 (SSRF), 003 (agent tool handler arbitrary fn) |
| Medium | 4 | 004 (ReDoS), 005 (MCP marker), 006 (HMAC key length), 008 (RAG header forwarding) |
| Low | 4 | 007 (x509 root selection), 009 (TOTP digits), 010 (HITL decidedBy), 011 (pack error args) |
| Informational | 2 | 012 (cacheable spec gap), 013 (baseline "no Critical found") |

**0 Critical findings.** The 3 High findings are real pack-side bugs that should be patched before the external audit completes. They are not Critical because each has a narrow exploitation precondition (#001 requires the verifier to have the public key under `ctx.inputs.key` with no per-config algorithm constraint; #002 requires deploying these packs on a multi-tenant fabric whose host doesn't enforce egress allow-lists; #003 requires the host to NOT provide `ctx.agentRuntime`).

---

## Cross-reference to the 10 §2.2 audit questions

| § | Question | Coverage in this triage |
|---|---|---|
| 1 | Secret redaction (SR-1) | Finding 011 flags the pattern; no concrete leak path found in the 17 packs |
| 2 | Audit-log integrity | Host-layer concern; out of scope for pack triage |
| 3 | Webhook HMAC | Host-layer + SDK concern; the `core.openwop.http.webhook-verify` pack node was read and uses `timingSafeEqual` correctly |
| 4 | Node-pack signing | All 17 packs verify against `keyId=openwop-team-1` via `registry/scripts/verify-signatures.mjs` |
| 5 | Prompt-injection (MCP) | Finding 005 — pack doesn't enforce `<UNTRUSTED>` marker wrapping |
| 6 | Multi-tenant isolation | Reviewed each pack's pack-side validation; isolation enforced by host surfaces |
| 7 | WASM ABI safety | Out of scope for these 17 packs (all are JS, not WASM) |
| 8 | Replay safety | Pack-side declares `side-effectful + cacheable` consistently; host-layer cache key correctness out of scope |
| 9 | Memory compaction carry-forward | Host-layer concern; no pack handles memory directly |
| 10 | Pack-consumer fail-closed | Host-layer concern; the packs themselves verify their own delegate availability with `host_capability_missing` throws |

---

## Recommended next actions

### Before external audit kickoff (steward, before vendor selection)

1. **Patch finding #001 (JWT alg-confusion).** Add `expectedAlgorithm` field to `jwt-verify.config.json`; reject mismatches before any key material is touched. Bump `core.openwop.crypto` to 1.0.1, re-publish, yank 1.0.0 per `node-packs.md` §"Deprecation and yank". This is a known high-severity pattern with a one-line schema + one-line code fix.
2. **Patch finding #003 (agent tool handler).** Either remove the in-pack fallback loop entirely (require `ctx.agentRuntime`), or refuse runs whose `inputs.tools[].handler` is a function-typed value. Bump `core.openwop.agents` to 1.0.1.

### Carry into the external engagement scope

3. **Findings 002 (SSRF), 004 (ReDoS), 005 (MCP marker), 011 (error args), 012 (cacheable spec gap)** all benefit from external review — they touch deployment context (host egress policy, multi-tenant compute caps), invariant interpretation (MCP markers), and spec-text gaps the steward shouldn't unilaterally resolve.

### Document for advisory disclosure

4. Once the external audit confirms #001 and #003 (or adds Critical findings of its own), the affected versions get a CNA-assigned `openwop-SA-2026-NNNN` advisory ID per `SECURITY.md` §"Advisory IDs", published with the embargo lift.

---

## What the external audit replaces

This internal review is a baseline, NOT a substitute for the external engagement. Specifically:

- This review covered pack-side code. The external review's §2.1 scope explicitly includes the spec corpus, the four reference hosts, the conformance suite, all five threat models, and the three SDKs — none of which were re-reviewed here.
- This review found no Critical issues. The external auditor may identify Critical issues through threat-modeling vectors the steward didn't consider — particularly around composition (one pack's High becomes another pack's Critical when chained).
- The external reviewer's findings populate `SECURITY/external-audit-findings.json` (different file from this internal one); the steward-internal findings stay separately tracked for transparency.

---

## Status update for `SECURITY/external-audit-engagement.md` §2.1.1

Per the post-publication obligations recorded there, the steward commits to:

1. ☐ Patch finding #001 + #003 in a follow-up release (no later than 7 days from this triage)
2. ☐ Submit this internal-findings file to the external auditor at engagement kickoff so they can confirm or upgrade the gradings
3. ☐ No further `core.openwop.*` publications until the external audit triages these 17 (already obligated; this triage is informational, not a substitute)
