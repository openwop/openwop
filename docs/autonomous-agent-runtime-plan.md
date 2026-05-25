# Autonomous Agent Runtime — implementation plan

**Status:** Draft · 2026-05-25 · Author: David Tufts (@davidscotttufts)
**Scope:** Close the eight autonomous-agent-runtime feature gaps identified in the `apps/workflow-engine` demo-app audit by composing existing openwop primitives where they exist and adding seven additive RFCs (0058–0064) where they don't.

This document sequences the cohort and maps each RFC to the demo app. Each RFC file under `RFCS/` carries its own normative Proposal / Conformance / Acceptance. (File references here are inline code, not links, to keep them stable across the repo's recursive Markdown link check.)

---

## 1. The architecture being added

openwop v1 is a **request-driven workflow protocol**. This cohort adds an **autonomous-agent runtime layer** on top of the existing run / event-log / capability primitives, without replacing the request-driven core. The unifying move: a *Run* gains a re-entrant, stateful, bounded loop lifecycle, and the agent gains a **durable ground-truth layer** (workspace) beside its **transactional layer** (memory). System-managed time (scheduling, heartbeat) starts and advances loops; safety bounds keep them terminating; tool hooks and sub-run gating keep their side effects auditable and least-privilege.

Two features (Heartbeat, Workspace files) cut against `positioning.md`'s "request-driven" stance. Per the product decision (2026-05-25) they land **as protocol RFCs that expand the architecture** — RFC 0052 (scheduling) already moved that line. RFC 0060 §D adds a bounded-exception note to `positioning.md`; RFC 0059 frames the workspace as a first-class durable layer.

---

## 2. Gap → disposition matrix

| # | Feature | Audit verdict (app) | Disposition | New RFC? |
|---|---|---|---|---|
| 8 | Safety / idempotence / timeouts | Partial (no per-run timeout) | New bounds keys via two new `cap.breached` kinds | RFC 0058 |
| 1 | Agent loop (core) | Partial (no loop semantics) | Re-entrant stateful loop lifecycle | RFC 0061 (+ 0058 cap) |
| 5 | Workspace & persistent memory | Partial (no ground-truth files) | New durable file layer | RFC 0059 |
| 3 | Heartbeat | Absent | New predicate-gated poller capability | RFC 0060 |
| 4 | Dreams (distillation) | Absent (0012 exists, unwired) | Scheduled token-budgeted distillation | RFC 0062 (composes 0012+0052) |
| 6 | Sub-agents & orchestration | Partial (no merge gating) | Sub-run attestation + approval gate | RFC 0063 |
| 7 | Tool hooks & integrations | Partial (MCP-only, no per-tool RBAC) | Generic tool hooks + per-tool auth | RFC 0064 |
| 2 | Scheduler (cron/interval/at) | Absent in app (RFC 0052 Accepted) | App wiring only — no new RFC | — |

**Spec already complete (app catches up): #2 Scheduler.** RFC 0052 (`Accepted`) defines `host.scheduling`; the demo app implements zero time-based firing (`executor/scheduler.ts` is a DAG node scheduler, not a clock). Closing #2 is implementation-only.

---

## 3. Dependency order & delivery sequence

RFCs land **spec text → schema → OpenAPI/AsyncAPI → conformance → SDKs → reference hosts → CHANGELOG/INTEROP-MATRIX**, and the cohort lands in dependency waves:

- **Wave A (foundation):** RFC 0058 (bounds), RFC 0052 scheduler app-wiring, RFC 0059 (workspace, needs RFC 0048 owner triple populated first).
- **Wave B (built on A):** RFC 0061 (loop, needs 0058 + 0059), RFC 0060 (heartbeat, needs 0052), RFC 0062 (dreams, needs 0052 + 0012 + 0059).
- **Wave C (orthogonal hardening):** RFC 0063 (sub-run gating, reuses 0051 + 0049), RFC 0064 (tool hooks, reuses 0046 + 0049).

Each RFC opens a 7-day additive comment window. Waves overlap on the comment clock; they serialize only on the implementation dependency above.

---

## 4. Per-RFC implementation phases (shared checklist)

1. **Spec text + RFC** — normative sections in `spec/v1/`; new `agent-workspace.md` (0059) + `tool-hooks.md` (0064); edits to `multi-agent-execution.md`, `agent-memory.md`, `host-capabilities.md`, `run-options.md`, `node-packs.md`, `positioning.md`, `rest-endpoints.md`.
2. **Wire artifacts** — `capabilities.schema.json` blocks; new `workspace-file.schema.json` (0059); `run-event-payloads.schema.json` event/kind additions; `openapi.yaml` workspace CRUD (0059); `asyncapi.yaml` events; `rest-endpoints.md` error codes.
3. **Conformance** — shape test always-on + capability-gated behavior tests; reuse the RFC 0052 `scheduling/tick` deterministic-clock seam; server-free shape subset <1s.
4. **SDKs** — TS / Python / Go type + method additions; `tsc` strict, `ruff`, `go vet` / `gofmt` clean.
5. **Reference hosts + INTEROP-MATRIX** — `apps/workflow-engine` per-run timeout (0058), loop counter (0061), scheduler firing (0052), tool hooks (0064); `examples/hosts/postgres` distillation (0062) + workspace (0059).

---

## 5. RFC 0058 — landed status (Wave A foundation)

The 0058 wire surface has landed on branch `rfc/autonomous-agent-runtime`:

- **Spec:** `run-options.md` keys `runTimeoutMs` + `maxLoopIterations`; `capabilities.md` §"Engine-enforced limits" resolution + replay clause; `rest-endpoints.md` codes `run_timeout` + `loop_limit_exceeded`; `observability.md` `openwop.cap_kind`.
- **Schema:** `capabilities.schema.json` `limits.{maxRunDurationMs,maxLoopIterations}`; `run-event-payloads.schema.json` `capBreached.kind` += `run-duration`, `loop-iterations` (additive enum extension, RFC 0008 §K precedent — no `eventLogSchemaVersion` bump).
- **Conformance:** `run-execution-bounds-shape.test.ts` (always-on) + `coverage.md`; behavior soft-skips until a host enforces wall-clock timeouts.
- **SDKs:** TS / Python / Go limits fields + `RunConfigurable` keys + error codes.

Status stays `Draft` per the RFC 0052 precedent (landing the implementation does not auto-flip status); the 7-day window + maintainer approval + reference-host *enforcement* remain before `Active`/`Accepted`.

---

## 6. Risk notes

- Cohort size (7 RFCs) — land in waves; each is independently additive + capability-gated.
- `positioning.md` contradiction (heartbeat/workspace) — RFC 0060 §D bounded-exception note; RFC 0052 precedent.
- Replay determinism under per-iteration state reload (0061) — snapshots are as-of-iteration-start + immutable; clock-derived event fields recorded, not recomputed.
- New SECURITY MUST-NOTs (0059 WCT-1, 0063 / 0064 fail-closed) land in `SECURITY/invariants.yaml` **with** their conformance tests at implementation, never at Draft (RFC 0052 precedent).

---

## 7. Next steps

1. `/prd <slug>` per RFC for the five-architect pass — start with 0058 (foundation, done) and 0061 (keystone).
2. Open the 7 PRs in waves.
3. Land demo-app reference wiring in parallel — per-run timeout (0058) is the quickest credibility win.

---

## 8. Findings close-out plan (architect review, 2026-05-25)

All seven RFCs have completed the five-architect pass; findings live in `RFCS/registers/00NN-*.{gaps,risks}.md` (14 files). The architect passes produced **five reframes** (0058 `cap.breached`, 0061 `executionModel v5`, 0062 `memory.compacted`, 0063 `output.harvested` attestation, 0064 extend `agent.tool*`) + one knock-on correction (0058 gate). After the reframes there are **no open CRITICAL findings** — every change is additive, and the wire-shape-duplication risks that were the only critical-adjacent issues are closed. This section consolidates the remaining findings and sequences their close-out.

### 8.1 Consolidated findings (deduplicated across the 14 registers)

| # | Theme | Severity | Source registers | Disposition |
|---|---|---|---|---|
| A | **Additive-extension sign-offs** — four reframes add optional fields to events owned by *Accepted* RFCs: `memory.compacted`+`distillation` (0012), `coreWorkflowChainEvent`+`attestation` (0037), `runOrchestratorDecided`+`iteration` (0037), `agentToolCalled`/`agentToolReturned`+fields (0002). | HIGH | 0061 G·, 0062 G1, 0063 G1, 0064 G1 | Additive per `COMPATIBILITY.md` §2.1; needs a one-line amendment note + Compatibility-maintainer sign-off on each owning RFC. |
| B | **Canonical-serialization unification** — 0063 checksum + 0064 `argsHash` MUST reuse the RFC 8785 JCS recipe already pinned in `replay.md` (RFC 0041). | HIGH | 0063 G2, 0064 G5 | Pin once in `replay.md`; cross-reference from 0063/0064. |
| C | **New vs. reused error codes** — register `token_budget_exceeded` (0062, genuinely new — currently SDK-vocab-only), `workspace_conflict`/`workspace_too_large` (0059); 0064 *reuses* `forbidden`+`rate_limited` (no new code). | MEDIUM | 0062 G2, 0059 (acceptance), 0064 G2 | Register the genuinely-new codes in `rest-endpoints.md` at implementation. |
| D | **"Decide before Active" knobs** — directory semantics (0059 G1), version retention (0059 G2), transcript window (0061 G3), prior-state token (0060 G2), backpressure (0060 G3), token tolerance (0062 G3), archive retention (0062 G6), index format (0062 G4 / 0059 G3), batch approval (0063 G3), `requiredScopes` location (0064 G3 / RFC 0045), non-agent `agentId` convention (0064 G4). | MEDIUM | all gaps registers | A batch of ~11 maintainer decisions; none block `Draft`, all block the relevant RFC's `Active`. |
| E | **SECURITY invariants to land with tests** — `workspace-cross-tenant-isolation` (0059), `subrun-merge-approval-fail-closed` (0063). 0064 reuses RFC 0049's `authorization-fail-closed`; 0062 reuses RFC 0012's SR-1. | HIGH (at impl) | 0059 R1, 0063 R2 | Each protocol-tier MUST-NOT lands its `invariants.yaml` row + public conformance test in the *same* PR as the implementation — never at Draft. |
| F | **Cross-RFC sequencing** — 0061 needs 0059 (workspace snapshot)+0058 (done); 0062 needs 0059 (index file)+0052+0012; 0060 needs 0052 (tick). | MEDIUM | 0061 G7, 0062 G5, 0060 (compose) | Encoded in the Wave A/B/C order (§3). |
| G | **Spec-text + doc-surfacing landing** — new docs `agent-workspace.md` (0059), `tool-hooks.md`/mcp-integration ext (0064); edits to `multi-agent-execution.md` (0061 v5 + extend the version table — 0061 G6; 0063 attestation phase; 0064 authz), `agent-memory.md` (0062), `host-capabilities.md` (0060), `positioning.md` bounded-exception note (0060 G1), `capabilities.md`; README doc-index; INTEROP-MATRIX. | MEDIUM | 0060 G1, 0061 G6, per-RFC acceptance | Lands per RFC at Active→implementation. |
| H | **Reference-host enforcement (Draft→Accepted gate)** — behavior conformance scenarios soft-skip until a host *enforces* each surface (0058 timeout, 0059 workspace CRUD, 0060 heartbeat, 0061 loop, 0062 distillation, 0063 approval gate, 0064 tool authz). | HIGH (for Accepted) | all RFCs' acceptance | Wire one reference host per surface; flip scenarios from soft-skip to live. |

### 8.2 Phased close-out

**Phase 0 — Decision batch (no code; unblocks Active).** Resolve themes A, B, and the ~11 D-knobs as a single maintainer decision pass. Deliverable: a short decisions note appended to each RFC's "Unresolved questions" marking each resolved, plus the one-line additive-extension amendment on RFCs 0002/0012/0037. **Gate:** bootstrap one-approval review (`GOVERNANCE.md`); no `openwop:check` impact (prose only).

**Phase 1 — Comment windows + Active promotion.** Open the cohort PR (below); each RFC gets its 7-day additive comment window (`RFCS/README.md` §Process). Promote `Draft → Active` per RFC as its Phase-0 decisions land. **Gate:** comment window closed + two-maintainer rule once a second org is on `MAINTAINERS.md` (one-approval during bootstrap). README RFC-status counts move Draft→Active as each flips (the `protocol:status` gate enforces the counts).

**Phase 2 — Wire-artifact implementation, in dependency waves** (the landed-0058 pattern): per RFC, **spec text → schema → OpenAPI/AsyncAPI → conformance (shape always-on + gated behavior) → SDK → CHANGELOG**, addressing themes C, F, G.
- **Wave A:** RFC 0059 (workspace) + the RFC 0052 scheduler app-wiring (no new RFC). *(0058 wire surface already landed.)*
- **Wave B:** RFC 0061 (loop, needs 0059), RFC 0060 (heartbeat, needs 0052), RFC 0062 (dreams, needs 0059+0052+0012).
- **Wave C:** RFC 0063 (sub-run gating), RFC 0064 (tool hooks).
- **Gate per RFC:** `npm run openwop:check` 9/9; fixture catalog⟷JSON sync; vendored-fixture sync into `apps/workflow-engine`.

**Phase 3 — SECURITY invariants + reference-host enforcement → Accepted.** Land theme E (the two new invariants + their tests) and theme H (wire one reference host per surface; flip behavior scenarios from soft-skip to live; update each host's `conformance.md` + `INTEROP-MATRIX.md`). **Gate:** `scripts/check-security-invariants.sh` (every protocol-tier MUST-NOT has a public test) + honest host advertisement. Promote `Active → Accepted`.

### 8.3 Decision batch checklist (Phase 0 — copy into the cohort PR)

- [x] **A.** RESOLVED — all four extensions confirmed additive (`COMPATIBILITY.md` §2.1) against the `origin/main` schemas: `memory.compacted` + `agentToolCalled`/`agentToolReturned` are `additionalProperties:true`; `coreWorkflowChainEvent` + `runOrchestratorDecided` are `additionalProperties:false` so the new fields are declared in `properties`; all `required` arrays unchanged; **no `eventLogSchemaVersion` bump**. One-line amendment notes added to RFCs 0002/0012/0037.
- [x] **B.** RESOLVED — pinned to the existing RFC 8785 JCS recipe in `replay.md §"LLM cache-key recipe" §B` (+ no-JCS fallback) then SHA-256; 0063 + 0064 cite it (no new recipe).
- [x] **D1–D11.** RESOLVED — recorded in each RFC's "Phase-0 resolution" block (flat workspace paths; latest-version MUST; host-advertised transcript window; opaque size-capped heartbeat token; `maxPendingEnqueued` backpressure; ±10% token tolerance; advertised archive retention; `MEMORY-INDEX.json`; one-interrupt-per-child; `requiredScopes` in the connector manifest; reserved `core.system` agent id keeping `agentId` required).
- [x] **C.** RESOLVED — `token_budget_exceeded` (0062), `workspace_conflict` + `workspace_too_large` (0059) are the new codes (confirmed absent from `origin/main:rest-endpoints.md`); 0064 reuses `forbidden` + `rate_limited`.
- [x] **E.** RESOLVED — 2 new protocol-tier invariants (0059 `workspace-cross-tenant-isolation`, 0063 `subrun-merge-approval-fail-closed`) land WITH their conformance tests at implementation (per `check-security-invariants.sh`); 0064 reuses RFC 0049's `authorization-fail-closed`; 0062 reuses RFC 0012's SR-1.
