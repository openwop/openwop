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
