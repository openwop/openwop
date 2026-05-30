# Conformance runs — 2026-05-30 (suite v1.10.0)

> **What this is.** A fresh cross-host re-measurement of the four `examples/hosts/*` reference hosts against `@openwop/openwop-conformance@1.10.0` — the first re-measurement since the 2026-05-23 v1.5.0 run (`docs/CONFORMANCE-RUNS-2026-05-23.md`). The suite grew **1564 → 2074 tests** (305 scenario files) over that window as the agent-platform arc (RFCs 0077–0087), the agent-memory/agent-pack scenarios, and the autonomous-agent-runtime cohort landed their conformance coverage. This is a **re-measurement** (counts + failure-topic grouping), not a per-failure root-cause/closure pass — failures are grouped by scenario file and characterized at the topic level; individual triage is deferred to the owning host.

## Method

Each reference host was built, started locally, and the full suite was run against it in **default mode** (no `OPENWOP_REQUIRE_BEHAVIOR`). The conformance runner and the TypeScript SDK `dist/` were built first so the server-free `spec-corpus-validity` / `fixtures-valid` scenarios pass (they assert the built SDK surface; without the `dist/` build they report 3 spurious failures unrelated to any host).

| Host | Start command | Port | Suite invocation |
|---|---|---|---|
| in-memory | `tsx src/server.ts` | 3737 | `OPENWOP_BASE_URL=… OPENWOP_API_KEY=openwop-inmem-dev-key vitest run` |
| sqlite | `tsx src/server.ts` | 3838 | `… OPENWOP_API_KEY=openwop-sqlite-dev-key …` |
| postgres | `tsx scripts/start-pglite.ts` (pglite in-process) | 3839 | `… OPENWOP_API_KEY=openwop-postgres-dev-key OPENWOP_WEBHOOK_ALLOW_PRIVATE=true …` |
| python | `python3.11 -m openwop_host` (stdlib-only) | 3740 | `… OPENWOP_API_KEY=openwop-inmem-dev-key …` |

## Results — default mode, suite v1.10.0 (305 files / 2074 tests)

| Host | Passed | Failed | Skipped | Todo | Total | Pass rate (default) |
|---|---:|---:|---:|---:|---:|---:|
| Postgres reference | **1968** | 14 | 92 | 0 | 2074 | **94.9%** total; ~99.3% of non-skipped (pglite + `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true`) |
| SQLite reference | **1966** | 4 | 104 | 0 | 2074 | **94.8%** total; ~99.8% of non-skipped |
| In-memory reference | **1922** | 48 | 104 | 0 | 2074 | **92.7%** total — the minimal-host floor |
| Python reference | **1922** | 2 | 150 | 0 | 2074 | **92.7%** total; **~99.9% of non-skipped**, and 100% of applicable when scoped to the host's claimed `openwop-core` + `openwop-stream-poll` + `openwop-stream-sse` profile set |

`todo` is **0** across all hosts (the v1.5.0-era 14 `it.todo` markers were retired/converted since). `skip` counts vary by host because capability-gated scenarios soft-skip against a host that does not advertise the surface — Python skips the most (150) reflecting its smaller stdlib-only advertised surface; Postgres skips the fewest (92) because it wires more of the agent surface, so more scenarios actually execute (and a few edge-fail).

## Failure-topic taxonomy

All failures below are **capability gaps or behavioral edges in the reference hosts** on surfaces that grew since v1.5.0 — not protocol regressions (the server-free corpus-validity + fixtures-valid scenarios pass on every host, and CI keeps `main` green on the spec gate). Grouped by scenario file with the host(s) that fail it:

### In-memory (48) — minimal-host floor

The in-memory host is the smallest reference and intentionally does not behaviorally implement the advanced surfaces; most failures are scenarios outside its claimed `openwop-core` floor or behavioral edges it advertises but does not fully satisfy.

- **Interrupts (11):** `interrupt-approval` (3), `interrupt-external-event-correlation` (2), `interrupt-parent-child-cascade` (2), `interrupt-quorum-resolution` (2), `interrupt-clarification` (1), `interrupt-auth-required-resume` (1).
- **Stream modes (6):** `stream-modes-buffer` (3), `stream-modes-mixed` (2), `stream-modes` (1).
- **Multi-agent dispatch (4):** `dispatch-cross-worker-handoff`, `dispatch-input-mapping`, `dispatch-output-mapping`, `dispatchLoop` (1 each).
- **Bulk cancel (4):** `bulk-cancel`.
- **Sub-workflow (3):** `subworkflow` (2), `subworkflow-input-mapping` (1).
- **Pack registry (3):** `pack-registry`.
- **BYOK / cost / cap (6):** `byok-roundtrip` (2), `cost-attribution` (2), `cap-breach` (2).
- **Workspace (2):** `workspace-behavior`.
- **Singles (10):** `artifact-auth`, `channel-ttl`, `conversationCapabilityNegotiation`, `identity-passthrough`, `model-capability-insufficient`, `pause-resume`, `route-coverage`, `runtime-capabilities`, `version-negotiation` (events/poll forward-compat tolerance).

### Postgres (14)

- **Agent memory (5):** `agentMemoryRoundTrip`, `agentMemoryRedactionContract`, `agentMemoryTtlExpiry`, `agentMessageReducer`, `agentMetadata` (1 each).
- **Agent packs (3):** `agentPackHandoffSchemaValidation` (2), `agentPackProvenance` (1).
- **AI-envelope cap-breach (3):** `aiEnvelope.capBreached` — see cross-host note below.
- **Singles (3):** `discovery`, `orchestratorConservativePath`, `sql-transaction-atomicity` (1 each; the last is a `@timing-sensitive`-class assertion that the prior run noted flakes under full-suite parallelism).

### SQLite (4)

- **AI-envelope cap-breach (3):** `aiEnvelope.capBreached`.
- **Discovery (1):** `discovery`.

### Python (2)

- `artifact-auth` (1), `run-execution-bounds-shape` (1) — both outside the host's claimed profile set.

### Cross-host signals

- **`aiEnvelope.capBreached` (sqlite ×3, postgres ×3, not in-memory/python):** a scenario added since v1.5.0 that neither persistent host yet satisfies, while the two minimal hosts soft-skip it. The most consistent real gap surfaced by this re-measurement and the best candidate for a focused host fix.
- **`discovery` (sqlite ×1, postgres ×1):** a shared discovery assertion the two persistent hosts miss.
- **`artifact-auth` (in-memory ×1, python ×1):** the 404-vs-401 artifact-auth edge the two minimal hosts share (the prior Postgres run closed its copy in 2026-05-25).

## Not re-measured in this pass

- **Strict mode (`OPENWOP_REQUIRE_BEHAVIOR=true`).** Not re-run; its character is unchanged from the v1.5.0 measurement — the strict-mode "failures" are honest profile opt-outs (`OPENWOP_OPTED_OUT_PROFILES`), not bugs. See `INTEROP-MATRIX.md` for the per-host opt-out lists.
- **Workflow-engine reference (exhaustive mode).** The `apps/workflow-engine` app host was not re-run against v1.10.0 in this pass (it requires the full app harness rather than an `examples/hosts/*` server); its prior v1.5.0 exhaustive-mode reading is retained in `INTEROP-MATRIX.md` and annotated as such.
