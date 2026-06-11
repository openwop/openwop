# Conformance runs — 2026-05-23 (suite v1.5.0 post Phase 4 close-out)

> ## Update 2026-05-25 — Postgres + SQLite re-measurement + RFC 0022 root-cause correction
>
> Re-ran the **Postgres** and **SQLite** hosts against the current `conformance/` suite after closing RFC 0022 on both. (`in-memory`, `python`, and `workflow-engine` were **not** re-measured and remain as of 2026-05-23.)
>
> | Host     | 2026-05-23 | 2026-05-25 (RFC 0058 enforced) | Remaining failures                                                                                           |
> | -------- | ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
> | Postgres | 6 failed   | **0 failed** (of ~1798)        | All closed — RFC 0022 ×4, artifact-auth, model-capability, and RFC 0058 `run-execution-bounds` (note below). |
> | SQLite   | 7 failed   | **0 failed** (of ~1798)        | All closed — same set plus the RFC 0058 run-bound.                                                           |
>
> **RFC 0058 (run-execution-bounds) — now enforced on both hosts (2026-05-25).** Merging `main` grew the suite (RFC 0058/0059/0060 scenarios), surfacing `run-execution-bounds-shape.test.ts` because neither reference host enforced `configurable.runTimeoutMs`. Both hosts now arm a per-run wall-clock deadline (`min(runTimeoutMs, maxRunDurationMs)`), emit `cap.breached { kind: 'run-duration', limit, observed }` + `error.code = 'run_timeout'` on breach, and advertise `capabilities.limits.maxRunDurationMs` (the schema-canonical location). Complements the in-memory host's RFC 0058 work (separate). A handful of `@timing-sensitive` scenarios still flake under full-suite parallelism (pass in isolation).
>
> **The RFC 0022 diagnosis below was wrong on both hosts — but for different reasons.**
>
> - **Postgres:** RFC 0022's mapping logic and the `config.mockDispatchPlan` supervisor-mock both already shipped. The real cause was that this host never registered the canonical **`core.identity`** node (`spec/v1/node-packs.md` §`core.identity`), which every RFC 0022 child fixture uses as its noop body. The children failed `unsupported_node_type`, cascading their parents to `failed`. Registering `core.identity` (a passthrough that folds run inputs into the variable bag) closed all four RFC 0022 failures **plus** a 5th, uncounted `identity-passthrough.test.ts` failure. The RFC 0026 cost-attribution and RFC 0031 model-capability failures the prior taxonomy listed for Postgres had already closed independently (no longer reproduce).
> - **SQLite:** the supervisor-mock gap was **real** here — SQLite's `core.orchestrator.supervisor` emitted a single hard-coded decision and had no `mockDispatchPlan`, its `core.dispatch` honored only `nextWorkerIds[0]` with no mapping fields, and its `core.subWorkflow` had `outputMapping` but no `inputMapping`. The RFC 0022 port added `mockDispatchPlan`, sequential multi-worker dispatch with all four mapping fields (`inputMapping` / `outputMapping` / `perWorker{Input,Output}Mappings`), subWorkflow `inputMapping`, top-level `defaultValue` seeding of run variables, and the `capabilities.agents.dispatchMapping` + `capabilities.subWorkflow.inputMapping` advertisements. The refusal + mid-run-mutation negative paths soft-skip (SQLite exposes no capability-toggle / variable-mutation test seam).
>
> **Two pre-existing, non-RFC-0022 failures were also closed in the same pass:**
>
> - **Postgres `artifact-auth`:** the unauthenticated artifact `GET` returned 404 instead of 401 (no artifact route existed → fell to the catch-all 404, which skips auth). Added an `/v1/runs/{runId}/artifacts/{artifactId}` route that runs `checkAuth` **before** any existence check (401 `unauthenticated` for missing auth; 404 `artifact_not_found` for an authenticated caller, since the host persists no artifacts) — closes the cross-tenant existence-oracle gap.
> - **SQLite `model-capability-insufficient`:** SQLite advertised the `conformance-model-capability-insufficient` fixture (its filter is prefix-only) but had no handler for the `conformance.modelCapability.insufficient` typeId → `unsupported_node_type`. Added the RFC 0031 §B step 4 / §D refusal: emit `model.capability.insufficient` BEFORE `node.failed`, then fail with `capability_not_provided` (no downstream envelope event). This is the first reference host to demonstrate the RFC 0031 refusal end-to-end (Postgres soft-skips by not advertising the fixture — its `SUPPORTED_NODE_TYPES` filter excludes the typeId).

> Re-measurement triggered by the 2026-05-22 → 2026-05-23 Phase 4 close-out which landed 5 new behavioral scenarios (+31 tests). Supersedes the same-day 2026-05-22 snapshot at `docs/CONFORMANCE-RUNS-2026-05.md`.
>
> All measurements taken 2026-05-23 against `@openwop/openwop-conformance@1.5.0` (215 test files / 1595 tests) using `--no-file-parallelism`. The "215 test files" count includes 5 lib-level helper tests beyond the 210 in `src/scenarios/`.

## Headline numbers

| Host                                            | Passed | Failed | Skipped | Todo | Total | Pass rate (default) |
| ----------------------------------------------- | -----: | -----: | ------: | ---: | ----: | ------------------: |
| Postgres reference (pglite)                     |   1477 |      6 |      98 |   14 |  1595 |               92.6% |
| SQLite reference                                |   1490 |      7 |      84 |   14 |  1595 |               93.4% |
| In-memory reference                             |   1449 |     48 |      84 |   14 |  1595 |               90.8% |
| Python reference                                |   1391 |     60 |     130 |   14 |  1595 |               87.2% |
| **Workflow-engine reference (exhaustive-mode)** |   1291 |    129 |     161 |   14 |  1595 |               80.9% |

## Delta vs 2026-05-22 same-day snapshot

| Host                | 2026-05-22 (210 / 1564)             | 2026-05-23 (215 / 1595)              | Notes                                                                                                                                                                                                                                                                           |
| ------------------- | ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres            | 1473 / 6 / 69 / 16 / 1564 (94.2%)   | 1477 / 6 / 98 / 14 / 1595 (92.6%)    | +4 pass / +0 fail / +29 skip / −2 todo / +31 total. The +29 skips are the 5 new Phase 4 close-out scenarios soft-skipping for the host that doesn't advertise the matching seams. The −2 todo + +4 pass deltas reflect the workflow-engine wire-shape that other hosts inherit. |
| SQLite              | 1486 / 7 / 55 / 16 / 1564 (95.0%)   | 1490 / 7 / 84 / 14 / 1595 (93.4%)    | Same shape — +4 pass / +29 skip / −2 todo.                                                                                                                                                                                                                                      |
| In-memory           | 1445 / 48 / 55 / 16 / 1564 (92.4%)  | 1449 / 48 / 84 / 14 / 1595 (90.8%)   | Same shape.                                                                                                                                                                                                                                                                     |
| Python              | 1387 / 60 / 101 / 16 / 1564 (88.7%) | 1391 / 60 / 130 / 14 / 1595 (87.2%)  | Same shape.                                                                                                                                                                                                                                                                     |
| **Workflow-engine** | not measured 2026-05-22             | 1291 / 129 / 161 / 14 / 1595 (80.9%) | **First measurement.** Advertises sandbox + multi-region + cross-engine + Phase 4 + secret-leakage seams + RFC 0042 experimental tier — opens up ~300 additional scenarios that the 4 standard hosts soft-skip on.                                                              |

**Headline-rate honesty.** The 4 standard hosts' percentage drops 1–2 pp vs 2026-05-22 because the denominator grew by +31 tests (5 new scenarios) while the numerator grew by only +4. The 4 hosts soft-skip on the new test seams since they don't advertise them — exactly the spec's "honesty principle" working as designed.

## Per-host failure taxonomy

### Postgres reference (pglite-backed) — 6 failures (unchanged from 2026-05-22)

| Scenario file                                    | Topic                                              | Closing dependency                                                     |
| ------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `cost-attribution.test.ts` (2 of 5 tests)        | RFC 0026 provider usage event end-to-end roundtrip | Host-side: implement the `conformance.cost.emit` fixture-node handler. |
| `model-capability-insufficient.test.ts` (1 of 6) | RFC 0031 executor refusal path                     | Host-side: complete `executor/modelCapabilityGate.ts` end-to-end.      |
| `dispatch-output-mapping.test.ts` (1 of 3)       | RFC 0022 HVMAP-1b — outputMapping harvest          | Host-side: supervisor-mock extension.                                  |
| `dispatch-input-mapping.test.ts` (1 of 3)        | RFC 0022 HVMAP-1a — inputMapping projection        | Same — pair with HVMAP-1b.                                             |
| `subworkflow-input-mapping.test.ts` (1 of 4)     | RFC 0022 HVMAP-2 — child variable seeding          | Same.                                                                  |
| `dispatch-cross-worker-handoff.test.ts` (1 of 2) | RFC 0022 HVMAP-1c — sequential cross-worker flow   | Same.                                                                  |

**Assessment unchanged from 2026-05-22.** All 6 failures concentrate in two named close-out tracks (RFC 0026 cost-attribution + RFC 0022 supervisor-mock); neither is a wire-shape change; neither blocks any v1 production-profile MUST.

### SQLite reference — 7 failures (unchanged from 2026-05-22)

Same as Postgres + 1 extra failure on `model-capability-insufficient.test.ts` because SQLite doesn't advertise `capabilities.modelCapabilities.supported: true` (Postgres does).

### In-memory reference — 48 failures (unchanged from 2026-05-22)

~10 real bugs (canonical `RunEventDoc` shape carry-forward) + ~38 honest non-claims (scenarios outside the claimed `openwop-core` profile set).

### Python reference — 60 failures (unchanged from 2026-05-22)

100% in the "intentionally unclaimed cross-language portability scope" bucket — multi-agent Phases 2–4, envelope reliability + completion + variant discriminator, OTel collector seam, RFC 0022 dispatch mapping. `OPENWOP_OPTED_OUT_PROFILES` converts these to honest skips.

### Workflow-engine reference (exhaustive-mode) — 129 failures (NEW)

**This host advertises the broadest capability surface in the corpus** — sandbox + multi-region + cross-engine + Phase 4 multi-agent execution + secret-leakage seams + RFC 0042 experimental tier + envelope reliability + envelope completion + envelope variant discriminator + model capabilities + prompts + ... — so the suite exercises ~300 scenarios that the 4 minimal hosts soft-skip on. Of those ~300, ~129 surface as failures because the workflow-engine's underlying implementation has gaps the advertisement doesn't yet fulfill.

Top failure clusters (approximate; full per-scenario inventory would require a longer run with per-test output saved):

| Cluster                                                                                                                      | Approximate count | Closing dependency                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Envelope reliability (RFC 0032) — retry / refusal / truncated / recovery / NL-to-format                                      |               ~35 | Reference workflow-engine has the dispatchStructured loop but several event-emission paths land in todo                                                                                                                                                                                                                                    |
| Envelope completion contract (RFC 0033) — truncation-vs-schema-violation routing + DoS-bound                                 |               ~12 | Same loop wiring as RFC 0032                                                                                                                                                                                                                                                                                                               |
| Envelope variant discriminator (RFC 0031) — substitution + insufficient + fallback                                           |               ~14 | Reference workflow-engine advertises `capabilities.modelCapabilities.supported: true` but the executor's substitution path is partial                                                                                                                                                                                                      |
| Prompt resolution chain — node-wins / agent-intrinsic / fallback-cascade                                                     |                ~9 | Reference workflow-engine implements all 6 `/v1/prompts*` routes but some resolution-chain edges differ from the spec                                                                                                                                                                                                                      |
| RFC 0039 confidence escalation                                                                                               |                ~5 | Host wires RFC 0037 (handoff state machine) + RFC 0039 (confidence escalation) + RFC 0041 (replay determinism) but some confidence-floor edge cases drift                                                                                                                                                                                  |
| Sandbox MVP (`sandbox-no-cross-pack-mutation`, `sandbox-no-host-process-escape`, etc. — the 8 advertisement-shape scenarios) |                ~7 | 7 of 8 the workflow-engine's node:vm sandbox closes BEHAVIORALLY (via the dedicated `sandbox-mvp-behavior.test.ts`); the 8 advertisement-shape scenarios still soft-skip on their behavioral assertions until the underlying tier graduations land (per `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-CLOSEOUT-2026-05-23.md` deferred-graduations) |
| Misc capability surfaces + edge-case wiring                                                                                  |               ~47 | Mixed                                                                                                                                                                                                                                                                                                                                      |

**Honest framing.** The workflow-engine is positioned as the "open-source reference under active development" — advertising more than it implements end-to-end is the intentional incentive to surface gaps. Failures here are a backlog, not a regression vs production-locked v1 contracts. The 22 NEW behavioral assertions from the 2026-05-22 multi-agent behavioral close-out (multi-region 6 + cross-engine 4 + sandbox 9 + secret-leakage 3 — see `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-CLOSEOUT-2026-05-23.md`) all PASS against the workflow-engine; the 129 failures are pre-existing gaps in capability surfaces advertised earlier.

## Pass-rate honesty calibration

| Host            | Total pass-rate |       Applicable pass-rate | Soft-skip risk | Auditor-relevant notes                                                                                                                                                                                                    |
| --------------- | --------------: | -------------------------: | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres        |           92.6% |      ~99.6% of non-skipped | LOW            | Same close-out tracks as 2026-05-22.                                                                                                                                                                                      |
| SQLite          |           93.4% |      ~94.7% of non-skipped | LOW            | Same shape.                                                                                                                                                                                                               |
| In-memory       |           90.8% | n/a (broader skip surface) | MEDIUM         | ~10 real bugs in claimed-profile scenarios; rest are non-claims.                                                                                                                                                          |
| Python          |           87.2% |     **100% of applicable** | LOW            | Every failure is in an explicitly-unclaimed profile per the cross-language portability scope.                                                                                                                             |
| Workflow-engine |           80.9% |      ~88.9% of non-skipped | MEDIUM-HIGH    | The 129 failures are a development backlog, not a contract violation. The host honestly advertises capabilities it hasn't fully wired — exactly the pattern the Phase 4 close-out commits set up to drive future closure. |

## Re-measurement recipe

```bash
# Standard 4 reference hosts (parallel)
node /Users/david/dev/openwop/examples/hosts/in-memory/dist/server.js &      # port 3737
node /Users/david/dev/openwop/examples/hosts/sqlite/dist/server.js &         # port 3838
npx tsx /Users/david/dev/openwop/examples/hosts/postgres/scripts/start-pglite.ts &  # port 3839
cd /Users/david/dev/openwop/examples/hosts/python && PYTHONPATH=src python3 -m openwop_host &  # port 3737 (alternate)

cd /Users/david/dev/openwop/conformance
# per host:
OPENWOP_BASE_URL=http://127.0.0.1:<port> OPENWOP_API_KEY=<key> \
  npx vitest run --reporter=basic --no-file-parallelism

# Workflow-engine exhaustive-mode (all seams):
OPENWOP_API_KEY=conformance-test-key \
  OPENWOP_TEST_SEAM_ENABLED=true \
  OPENWOP_TEST_SANDBOX_MVP=true \
  OPENWOP_TEST_MULTI_REGION_SIMULATOR=true \
  OPENWOP_TEST_CROSS_ENGINE_HARNESS=true \
  OPENWOP_CONFORMANCE_FIXTURES=1 \
  OPENWOP_MULTI_AGENT_EXECUTION_MODEL=true \
  OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_2=true \
  OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4=true \
  PORT=4242 node apps/workflow-engine/backend/typescript/lib/index.js &

OPENWOP_BASE_URL=http://127.0.0.1:4242 OPENWOP_API_KEY=conformance-test-key \
  npx vitest run --reporter=basic --no-file-parallelism
```

## See also

- `INTEROP-MATRIX.md` §"External conformance suite — pass rates" — table source for `docs/PROTOCOL-STATUS.md` regeneration.
- `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-CLOSEOUT-2026-05-23.md` (renamed 2026-05-24 from `docs/PHASE-4-CLOSEOUT-2026-05-23.md`) — audit-facing close-out of the 7 behavioral-harness tracks, with closing commits + behavioral assertions per track.
- `docs/CONFORMANCE-RUNS-2026-05.md` — superseded same-day 2026-05-22 snapshot retained for delta comparison.
- `docs/KNOWN-LIMITS.md` — shape-only vs behavioral coverage taxonomy.
