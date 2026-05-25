# openwop Spec v1 — Changelog

All notable changes to the openwop v1 spec, schemas, OpenAPI/AsyncAPI, conformance suite, and reference SDKs.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1/) loosely. Versions are spec-corpus-wide (one date, multiple artifact updates per row); per-artifact versions live in their respective `package.json` / schema `$id` fields.

> **Status legend** (per [`/governance/spec-status/`](https://openwop.dev/governance/spec-status/)):
> Stable · Stabilizing · Draft · Experimental — see individual doc headers for current state. The legacy `STUB / DRAFT / OUTLINE / FINAL` vocabulary still appears in older releases below; both are valid in the corpus.

---

## [1.1.4 — unreleased] — docs-sync drift cleanup

### RFC 0046 `host.credentials` — spec + schema + SECURITY invariant + shape/redaction conformance landed (2026-05-24)

First implementation pass on the Tier-1 critical path of the MyndHyve protocol-extension batch (RFCs 0045–0054). RFC 0046 stays `Draft`; this lands the openwop-side contract so a host can implement against it (`Active`/`Accepted` follow maintainer promotion + a non-steward host wiring the vault). All additive.

- **Schema:** new top-level `capabilities.credentials` block (`supported` / `scopes` / `encryptionAtRest` / `rotation` / `sharing`) in `schemas/capabilities.schema.json`; `workspace` appended to the `secrets.scopes` enum (additive). New `schemas/credential-reference.schema.json` (the opaque `{ ref, scope }` wire shape — never the secret). New `CredentialRequirement` $def + node-level `requiredCredentials[]` in `schemas/node-pack-manifest.schema.json`.
- **Spec:** `spec/v1/host-capabilities.md` §host.credentials — resolution contract (sandbox-only injection, fail-closed `credential_forbidden`), two-key-overlap rotation, relationship to `§host.secrets`, advertisement shape.
- **SECURITY:** new protocol-tier invariant `credential-payload-redaction` (sibling to `mcp-toolcall-payload-redaction`) — resolved material MUST NOT appear in inputs, variables, channels, events, debug bundle, or replay state.
- **Conformance:** `credentials-capability-shape.test.ts` (advertisement shape, always runs) + `credential-payload-redaction.test.ts` (adversarial redaction, capability-gated, `POST /v1/host/sample/credentials/echo` seam soft-skips on 404 — mirrors `fs-path-traversal`). Resolve-roundtrip + rotation-overlap scenarios deferred until a host wires the seam.
- **Counts synced:** README invariants 90→91 / protocol-tier 59→60, JSON Schemas 32→33, conformance scenario files 210→212; `docs/PROTOCOL-STATUS.md` regenerated; `coverage.md` gains two rows.

### RFC 0040 promoted Active → Accepted — `version: 3` cross-host causation live on MyndHyve (2026-05-24)

**Milestone — multi-agent execution model Phases 1+2+3 now Accepted end-to-end on a non-steward host.** MyndHyve workflow-runtime advertises `multiAgent.executionModel.{version: 3, crossHostCausation: {supported: true, hostId: 'myndhyve', ancestryEndpointSupported: true}}` live on `https://api.myndhyve.ai/.well-known/openwop` (verified 2026-05-24 via direct curl).

Two coordinated MyndHyve commits land the full Phase 3 surface:

1. **`f281549f` (Cloud Run revision `workflow-runtime-00198-q48`)** — Sessions 5c+5d+5e close-out: sqlite-reference-host MCP peer with distinct `hostId: 'sqlite-reference'` (closes the self-loop tautology that would otherwise have MyndHyve calling itself); `core.conformance.mcp-invoke` conformance node; `version: 3` discovery advertise; outbound `traceparent` injection on every outbound HTTP through `ServerHttpClientAdapter.fetch` (single injection point covers AI provider calls, webhook deliveries, conformance test seams, MCP outbound — closes calling-side §B contract everywhere at once).

2. **`dcf259b1` (revision `00199-4lk`)** — RFC 0041 §C observable-result cache Tier-1 (in-memory, workspace-first-keyed: `workspaceId|runId|nodeId|attempt|llmCacheKey`). 26 unit tests pin the cross-tenant isolation invariant.

**Conformance evidence per MyndHyve's report:**
- `cross-host-causation-shape.test.ts` — PASS (advertises `version: 3` + `crossHostCausation` block; scenario reads + validates shape).
- `cross-host-ancestry-endpoint.test.ts` — PASS. `GET /v1/runs/{runId}/ancestry` endpoint is registered (returns JSON `{"error":"Not found"}` for unknown runId — distinct from bare 404 it returned pre-`f281549f`).
- `cross-host-traceparent-propagation.test.ts` — stays `it.todo` upstream. MyndHyve calling-side + sqlite-reference-host receiving-side both ready; waiting on the cross-host harness driver landing on the openwop side.

Per the bootstrap-phase rule (advertisement + scenarios pass-modulo-honest-skip), the path-to-Accepted bar is met.

**RFC 0041 stays Active.** MyndHyve's §C observable-result cache Tier-1 is live but the `replayDeterminism` capability block stays honestly absent from discovery — §B refusal-divergence emission is missing (engine-side replay-execution path detection deferred to avoid parallel-session collision with `560cfc89`'s `canonicalRuns.ts` work). MyndHyve's honest-capability-advertisement discipline: advertise only what's fully honored. The Tier-2 Firestore-backed cache (cross-instance replay determinism) is also a separate strengthening tier.

**16 scenario flips on MyndHyve's side** (per their report — SKIP-on-404 → PASS after the `60b569de` `registerHostSampleRoutes` wire-up + `f281549f` cross-host surface):

| Scenario | Was | Now |
|---|---|---|
| `prompt-list.test.ts`, `prompt-render-secret-redaction.test.ts`, `prompt-render-trust-marker.test.ts`, `prompt-resolution-chain.test.ts` | SKIP | PASS |
| `ai-envelope-shape.test.ts` (behavioral), 6 `aiEnvelope.*.test.ts` scenarios (universalKinds, contractRefusal, capBreached, redaction, schemaDrift, trustBoundaryPropagation, correlationReplay) | SKIP on 404 | PASS |
| `otel-scrape-seam-shape.test.ts` | n/a | PASS (200 + `{spans:[]}`) |
| `envelope-reasoning-secret-redaction.test.ts` | n/a | PASS vacuously safe (Tier-1 boundary per RFC 0034 §B) |
| `cross-host-causation-shape.test.ts` | SKIP (block absent) | PASS (`version: 3` + `crossHostCausation`) |
| `cross-host-ancestry-endpoint.test.ts` | SKIP | PASS |
| `mcp-tool-roundtrip.test.ts` | SKIP | PASS when `OPENWOP_MCP_REAL_SERVER_URL` points at sqlite-host |

**Notable architectural finds from MyndHyve's session:**
1. RFC 0040 §B closing at `ServerHttpClientAdapter.fetch` — single injection point covers all outbound HTTP. Calling-side §B contract closed everywhere at once.
2. sqlite-reference-host as cross-host test peer — distinct `hostId: 'sqlite-reference'` closes the self-loop tautology where MyndHyve would otherwise call itself.
3. Observable-result cache is workspace-first keyed — `workspaceId|runId|nodeId|attempt|llmCacheKey` encoding makes tenant boundary lexically obvious in logs.
4. Honest capability discipline — `replayDeterminism` block stays absent on discovery despite §C cache being live, because §B emission missing means the host doesn't honor the full §D contract yet.

**Updates landed in this commit:**
- `RFCS/0040-multi-agent-cross-host-causation.md` Status: `Active → Accepted`. 9 of 10 acceptance-criteria items `[ ] → [x]` (remaining: `spec/v1/mcp-integration.md` + `spec/v1/a2a-integration.md` tracecontext cross-link prose — documentation strengthening, not a gate-blocker).
- `INTEROP-MATRIX.md` header date note rewritten to describe the RFC 0040 promotion as the headline.
- `README.md` Accepted (34 → 35 — adds 0040); Active (6 → 5).

### MyndHyve protocol-extension RFC batch 0045–0054 filed as `Draft` (2026-05-24)

Authored ten new RFCs that let MyndHyve (an OpenWOP host) express product surfaces — connectors, the workspace credential vault, OAuth, workspace/RBAC scoping, CMS approval gates, scheduled routines — *through the protocol* rather than as host-private code no other host can interoperate with. All are **additive** to the frozen v1 wire contract (new optional capabilities / events / endpoints / schemas, advertised via `/.well-known/openwop` and skipped by hosts that don't implement them); per each RFC's cross-cutting principles they flip `Draft → Active → Accepted` only as maintainers accept them and a non-steward host lands the implementation + conformance. Source plan: [`plans/myndhyve-protocol-extension-rfcs.md`](plans/myndhyve-protocol-extension-rfcs.md).

- **Tier 1 — connectors & credentials (critical path):** [`RFCS/0046`](RFCS/0046-host-credentials-capability.md) `host.credentials` (portable credential resolution + lifecycle: store-at-rest, workspace sharing, two-key-overlap rotation, new `credential-payload-redaction` SECURITY invariant); [`RFCS/0047`](RFCS/0047-host-oauth-connector-flows.md) `host.oauth` (host-performed authorization-code + refresh, tokens stored as 0046 credentials, closes the `auth.md` authorization-code gap); [`RFCS/0045`](RFCS/0045-connector-pack-manifest-action-model.md) connector pack manifest (optional `connector` block: typed actions + idempotency/rate-limit metadata binding to 0046/0047).
- **Tier 2 — identity & governance:** [`RFCS/0048`](RFCS/0048-tenant-workspace-principal-identity-model.md) tenant·workspace·principal identity triple (extends RFC 0011, adds optional `RunSnapshot.owner`); [`RFCS/0049`](RFCS/0049-rbac-scopes-and-authorization-decisions.md) RBAC role→scope binding + `authorization.decided` event + fail-closed `authorization-fail-closed` invariant; [`RFCS/0050`](RFCS/0050-saml-scim-enterprise-identity-profiles.md) SAML/SCIM (+optional LDAP) enterprise auth profiles (extends RFC 0010); [`RFCS/0051`](RFCS/0051-approval-deployment-gate-primitive.md) `core.openwop.governance.approvalGate` (role-gated, audited approvals composing the quorum + auth-required interrupt profiles).
- **Tier 3 — runtime reliability & tooling:** [`RFCS/0052`](RFCS/0052-scheduling-and-time-based-triggers.md) `host.scheduling` (cron/delayed/calendar, once-per-tick durable execution behind the `schedule` trigger; composes with RFC 0017); [`RFCS/0053`](RFCS/0053-dead-letter-routing-and-failure-sinks.md) `host.deadLetter` + `run.dead_lettered` (fork-eligible failure sink); [`RFCS/0054`](RFCS/0054-run-diff-and-execution-comparison.md) read-only `GET /v1/runs/{runId}:diff?against={otherRunId}` deterministic run comparison (depends on RFC 0011 fork).
- **Doc surfaces synced:** README RFC-status paragraph (44 → 54 RFCs excluding template; Draft 4 → 14), `docs/KNOWN-LIMITS.md` §"RFCs not yet Accepted" gains ten rows, `docs/PROTOCOL-STATUS.md` regenerated via `npm run protocol:status`.

### RFC 0039 Half B fully closed end-to-end — 422 wire-route surface live (2026-05-24)

MyndHyve commit `560cfc89` (Cloud Run revision `workflow-runtime-00362-yoz` now serving 100% on `api.myndhyve.ai`; replaces parallel-session-self-pinned `00196-7mm`) lands the `replay_memory_snapshot_unavailable` 422 wire-route surface that had been the long-standing parallel-session blocker. Three coordinated pieces:

1. **Engine wiring** — `runExecutor.ts` selects `MyndHyveMemoryResolver.forFork(forkedFrom.runId)` for replay-mode dispatches, so `ctx.memory.snapshotAtSeq()` reads the parent run's journal instead of returning `null`.
2. **Route pre-flight** — new exported helper `checkReplayMemorySnapshotPreflight` at the canonical `POST /v1/runs/{runId}:fork`. Uses the SAME `forFork(sourceRunId)` construction the dispatch uses, so the gate truthfully predicts dispatch behavior (no probe-vs-dispatch dishonesty).
3. **Wire-shape envelope locked**:
   ```jsonc
   {
     "error": "replay_memory_snapshot_unavailable",
     "message": "<human>",
     "details": {
       "fromSeq": <number>,
       "sourceRunId": "<string>",
       "reason": "retention_expired" | "event_log_unavailable"
     }
   }
   ```
   The `reason` discriminator splits the two ways a snapshot can be unserveable: `retention_expired` (source past the host's `retention.ts` window; journal may be GC'd) vs `event_log_unavailable` (probe `snapshotAtSeq` returned `null` per degraded infra). Matches `spec/v1/rest-endpoints.md:314` `replay_memory_snapshot_unavailable` envelope contract end-to-end.

Live verification 2026-05-24: `POST /v1/runs/<probe>:fork` returns `401` (route registered + authenticating) — distinct from the `404` it returned pre-`560cfc89`. MyndHyve has a full conformance run against `00362-yoz` in flight; the `multi-agent-memory-lifecycle.test.ts` MAE-3 behavioral assertion stays `it.skip` per the parallel-session RFC 0042 §B experimental-tier carve-out for the broader memory-lifecycle surface — lifting that gate is a separate operator-side decision.

**Vendor-extension event type confirmation.** MyndHyve also confirmed `x-host-myndhyve-memory-written` stays as the canonical wire-shape they emit for SR-1-audit journaling. No canonicalization RFC needed unless we want one upstream. The forward-reference row in INTEROP-MATRIX §"Forward-reference — MyndHyve vendor-extension RunEventTypes" stays as-is.

**Updates:**
- `RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md` path-to-Accepted footer rewritten to document the 422 wire-route closure with the three coordinated pieces + envelope shape. Status stays `Accepted` (Half B work is additive on the already-Accepted RFC; no Status flip).
- `INTEROP-MATRIX.md` header date 2026-05-23 → 2026-05-24; lead note rewritten to describe the 422 closure as the headline.

Status: RFC 0039 Half B is now FULLY wired across discovery + host primitive + route surface + envelope contract. The full multi-agent execution model roadmap (Phases 1-4 = RFCs 0037, 0039, 0040, 0041) has Phases 1 + 2 fully Accepted + wired end-to-end on a non-steward host; Phases 3 + 4 (RFCs 0040, 0041) remain Active pending `version: 3` / `version: 4` advertisements + cross-host harness work.

### Docs-sync drift cleanup (2026-05-24)

- **Docs sync drift cleanup (2026-05-24).** Removed stale RFC 0034 from `docs/KNOWN-LIMITS.md`'s open-RFC table after its 2026-05-23 Active → Accepted promotion, refreshed README document-index word counts from current `spec/v1/*.md`, corrected the implementation-certification badge-generator citation, and made the SQLite historical conformance-full banner cite the exact `@openwop/openwop-conformance@1.5.0` suite version.
- **Validator gate hardening.** Root release tooling now pins `@redocly/cli@2.31.4` + `@asyncapi/cli@4.1.1` as repo-root devDependencies and `scripts/openwop-check.sh` invokes local bins directly instead of `npx -y`, using `--legacy-peer-deps` for the root-only install to avoid AsyncAPI Studio's React peer-resolution loop. This matches the drift-catalog rule for validator-toolchain updates.

### Multi-agent "Phase N" → version-tagged rename for external readability (2026-05-24)

External auditor 2026-05-24 said: "Remove all references to 'phase 4' from our documentation as no one else will know what that is." The repo had accumulated multi-agent "Phase 1-4" labels across spec text, RFC titles, conformance scenarios, and accountability docs — internally meaningful, externally opaque. The canonical machine-readable identifier is the integer `multiAgent.executionModel.version ∈ {1, 2, 3, 4}` already advertised on the wire; this batch rewrites the human-facing prose to lead with that + the RFC's feature name instead of the phase label.

- **File renames** (`git mv` preserves history): `docs/PHASE-4-PROGRESS.md` → `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-PROGRESS.md`; `docs/PHASE-4-CLOSEOUT-2026-05-23.md` → `docs/MULTI-AGENT-BEHAVIORAL-HARNESS-CLOSEOUT-2026-05-23.md`. Each renamed file gains a top-of-file "Renamed 2026-05-24" note explaining the rationale.
- **RFC titles rewritten:** RFC 0039 "Multi-agent Phase 2" → "Multi-agent execution model `version: 2`"; RFC 0040 "Phase 3" → "`version: 3`"; RFC 0041 "Phase 4" → "`version: 4`". RFC 0037's title already named the feature.
- **Spec prose:** `spec/v1/multi-agent-execution.md` status block reframed from "Phase 1 of a four-phase formalization" → "first installment of a four-version formalization" with explicit `version: N` + RFC-number citations. Section headers, version mapping table, and open-spec-gaps table all rewritten with the RFC + version form.
- **Conformance scenarios:** docstrings in `multi-agent-confidence-escalation.test.ts` + `replay-observable-sequence-determinism.test.ts` rewritten to use `version: N` framing.
- **Long-tail body sweep:** 5 current-state docs cleaned (`docs/MULTI-AGENT-BEHAVIORAL-HARNESS-{PROGRESS,CLOSEOUT-2026-05-23}.md`, `docs/KNOWN-LIMITS.md`, `conformance/coverage.md`, `conformance/fixtures.md`) — 18 line-for-line swaps.
- **README link-rot regression-fix.** Per the `feedback_git_add_race` 2026-05-24 fifth-instance lesson: `README.md:130` referenced the old `./docs/PHASE-4-PROGRESS.md` path because the original rename commit unstaged README entirely (to avoid claiming the parallel agent's banner rewrite) — losing my single-line path fix alongside their work. Caught by `spec-corpus-validity.test.ts` link-integrity check; fixed via `git add -p` of just my hunk.
- **`/update-docs` skill expanded 21 → 22 drift modes.** New Drift #22 — "Internal phasing labels in external-facing prose" — inventories the 6 phasing schemes the repo has accumulated (multi-agent, Postgres `Phase H/I`, Multi-Agent Shift, ROADMAP, session, harness-track), spells out the substitution policy per scheme (wire-shape integers + env vars NEVER renamed; multi-agent prose YES; the others left alone unless audited), and lands a 7-step atomic fix recipe. The `feedback_git_add_race` memory also gains a fifth-instance entry documenting the `git add -p` discipline.

**Preserved (never renamed):** wire-shape `multiAgent.executionModel.version: 1-4` integer advertisement, env var `OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4=true`, historical CHANGELOG entries. Explicitly out of this sweep's scope: Postgres host "Phase H/I" launch tracks, ROADMAP "Phase 1 — Credibility / Phase 2 — Adoption / Phase 3 — Ecosystem" marketing-roadmap phasing, "Multi-Agent Shift Phase N" v1.0 agent-extensions-track labels, and dated outreach materials.

---

## [1.1.3] — 2026-05-23 — coordinated SDK release for first cross-host adoption

Closes the workflow-engine reference-host pass-rate inflation that the 2026-05-22 external standards-readiness review flagged, lands first non-steward host adoption of four RFCs, and ships the Phase 4 behavioral harness end-to-end. All wire shapes additive per `COMPATIBILITY.md` §2.1.

- **TypeScript SDK 1.1.3** (`@openwop/openwop`) publishes coordinated `parseRefusal()` + `buildReasoningDirective()` helpers. Python (`openwop-client`) and Go (`openwopclient`) bump in lockstep. No wire-shape changes.
- **Workflow-engine reference host pass-rate 80.9% → 95.5%** via two bundled-path bugfixes (`envelopeAcceptor.ts` schema lookup + `promptStore.ts`/`promptCompose.ts` fixtures lookup) — both cases of `__dirname + '..' × N` overshooting under the esbuild-bundled tree. New shared `_repoPath.ts::locateRepoDir()` helper + 5-test regression guard. The inflated 129-failure number was a cascade from a single `ENOENT` crash, not 129 real conformance gaps.
- **RFC 0041 §B Phase 4 closes** — replay-divergence-at-refusal executor wiring lands the last `it.todo` from the 5-track audit harness. The workflow-engine's `:fork mode: replay` path now emits `replay.divergedAtRefusal` and fails with `error.code: 'replay_diverged_at_refusal'` when an envelope kind diverges between source and replay (both directions). Gated on `OPENWOP_MULTI_AGENT_EXECUTION_MODEL_PHASE_4=true`. RFC 0041 path-to-Accepted opens (gate: second host advertising `multiAgent.executionModel.version: 4`).
- **Phase 4 behavioral harness — Tracks 1/2/5/6/7 + RFC 0042 close.** Three new HTTP test-seam endpoint families on the reference workflow-engine drive five new conformance scenarios: multi-region partition simulator, cross-engine append-ordering harness, sandbox MVP (7-of-8 RFC 0035 §B invariants), secret-leakage OTel-attribute coverage, RFC 0042 experimental-tier shape probe. Suite scenario count 205 → 210. NEW `spec/v1/host-sample-test-seams.md` §6–§8 documents the new seams normatively.
- **First non-steward cross-host adoption.** MyndHyve (`api.myndhyve.ai`) ships Tier-1 advertisements for RFC 0021 (envelope), RFC 0027 (prompt templates with `observability: 'full'`), RFC 0028 (read-only prompt library), RFC 0029 (override hierarchy, node layer), RFC 0034 (OTel test seam, empty-buffer Tier-1), RFC 0039 Half B (memory lifecycle MAE-2 + MAE-3, `crossChildMemoryConcurrency: 'strict'`), RFC 0040 Sub-5b (MCP API-key auth). Verified live against `/.well-known/openwop`.
- **RFC promotions Active → Accepted (5 total this release):** **0027** (prompt templates) — first non-steward `prompts.supported: true` + `observability: 'full'`; **0034** (OTel collector test seam) — first non-steward Tier-1 seam-shape adoption; **0037 Phase 1** (multi-agent execution model) — first vendor-neutral validation signal; **0039 Half A** (multi-agent confidence + memory lifecycle) — cross-host evidence via MyndHyve commit `c4342b5b` against suite v1.5.0; **0044** (confidence-escalation interrupt-kind advertisement, clarification to RFC 0039 §A).
- **NEW Draft RFCs.** **0042** (experimental capability tier — `tier ∈ {stable, experimental}` + `experimentalUntil` ≤ 12-month sunset + derived `openwop-experimental` profile + conformance soft-skip routing under default mode). **0043** (registry + extension policy + IPR posture — consolidates DCO + Apache-2.0 + CC-BY-4.0 + namespace reservation rules).
- **Vendor-namespace pattern locked.** MyndHyve picked Option 1 (`x-host-myndhyve-memory-written`) per `host-extensions.md` §"Canonical prefixes" for host-private SR-1 audit events. Preserves wire-shape compat with strict RunEventType validators; the canonicalize-via-RFC path stays open for any second host that wants the same shape.
- **Honest correction — `registerHostSampleRoutes` wire-up bug.** MyndHyve's `/v1/host/sample/*` routes were deployed for days but never wired into the runtime (404 in production until commit `60b569de`). Four seams affected (RFC 0027 §E compose, RFC 0041 §A cache-key, RFC 0021 envelope-accept, RFC 0034 OTel scrape). All four now exercisable end-to-end; RFC 0027 status stays Accepted (the advertisement was real; the bug was wire-up, not logic).
- **Audit response artifacts.** NEW `docs/AUDIT-RESPONSE-2026-05.md` (point-by-point reply to the 2026-05-22 external review with calendar tripwires). NEW `docs/CONFORMANCE-RUNS-2026-05.md` (re-measurement of all 4 reference hosts against `@openwop/openwop-conformance@1.4.0` + per-failure taxonomy). NEW `docs/PHASE-4-PROGRESS.md` (Phase 4 close-out accountability with closing-commit citations).
- **Conformance suite 1.4.0 → 1.5.0.** RFC 0044 vendor-kind routing relaxation splits one strict-equality assertion into discrete `it()` blocks (+6 tests, +6 passes). Postgres 1473/1564 (94.2%), SQLite 1486/1564 (95.0%), in-memory 1445/1564 (92.4%), Python 1387/1564 (88.7% total / 100% of applicable).
- **Reference workflow-engine + sample-app polish.** Real-LLM default in the builder (`vendor.openwop-sample.chat-responder` replaces the deterministic `mock-ai` node + managed `openwop-free` credential tile by default); Copy/Export buttons on the event-stream view; Cloud Run deploy-plumbing close-out (vendored `schemas/` + dual-mount `conformance-fixtures/` so the bundled host resolves sibling-repo paths under `/app/lib`); `.gitignore` for harness runtime state (`*.db-shm`/`*.db-wal`, `.byok-master-key`, `host-fs/`).
- **Site shipped at openwop.dev** (2026-05-21). 13 new content pages + REST API explorer (Redoc) + AsyncAPI + gRPC transport explorers + JSON-LD `TechArticle` structured data on every spec doc. Star-on-GitHub CTA in the marketing footer.

---

## [1.1.2] — 2026-05-21 — gap-closure batch + envelope-hardening track + ecosystem launches

The first patch release after v1.1.1 closes every gap from the 2026-05-19 → 2026-05-21 batch covering the envelope LLM-contract-hardening RFCs, the prompt-library track, the dispatch primitives, the multi-agent execution model, the agent-pack catalog, and the marketing-site launch at openwop.dev. All wire shapes additive per `COMPATIBILITY.md` §2.1.

- **TypeScript SDK 1.1.2** (`@openwop/openwop`), Python (`openwop-client`), Go (`openwopclient`) all bump in lockstep. Conformance suite `@openwop/openwop-conformance` 1.1.1 → 1.4.0 over the release window (1.2.0 / 1.3.0 / 1.4.0 minor bumps for new behavioral scenario families).
- **Marketing site shipped to openwop.dev** (2026-05-21). First public surface for the protocol. Multi-page spec corpus rendered from `spec/v1/*.md`, demo card, Star-on-GitHub CTA. Companion `app.openwop.dev` workflow-engine sample app deployed in parallel.
- **`spec/v1/ai-envelope.md` DRAFT → FINAL v1.1** (2026-05-18). Closes the AI Envelope specification gap that was the largest remaining v1.0-era hole. Normative for envelope-acceptor wire shape, refusal kinds, capability stacking, and SR-1 secret redaction.
- **Envelope-hardening track (RFCs 0030–0033) filed + promoted Draft → Active → Accepted in 4 days** (2026-05-20 → 2026-05-21). **0030** envelope `reasoning` field + Tier-1 structured-output subset. **0031** envelope variant discrimination + model-capability declarations. **0032** envelope-reliability run-event vocabulary. **0033** envelope-completion contract (truncation vs schema-violation retry routing). Reference-host emission landed in `dispatchStructured()`; conformance scenarios cover all four RFCs end-to-end.
- **Prompt-library track (RFCs 0027 / 0028 / 0029) filed Draft + promoted Active** (2026-05-19 → 2026-05-20). RFC 0027 (prompt templates) reference-host implementation + Phase A wire shape + 4-kind dispatch wiring + `slotIndex` correctness. RFC 0028 (prompt library endpoints) reference-host `/v1/prompts*` endpoints + PromptStore + example prompt pack. RFC 0029 (prompt override hierarchy) four-layer resolver + `/v1/host/sample/prompt/resolve` seam. RFC 0027 §F shared `divergencePoint` schema diff.
- **Multi-agent track filed Draft.** **RFC 0035** (sandbox execution contract), **RFC 0036** (multi-region + cross-engine), **RFC 0037** (multi-agent execution model Phase 1 — first vendor-neutral validation tripwire), **RFC 0039** (multi-agent Phase 2 confidence-floor escalation + memory lifecycle MAE-2/MAE-3), **RFC 0040** (Phase 3 cross-host causation), **RFC 0041** (Phase 4 replay determinism under nondeterministic models). RFC 0037 Phase 1 promoted Draft → Active same day with reference-host wiring + behavioral conformance.
- **RFC 0034 (OTel collector test seam) filed Draft → Active** (2026-05-21). Replaces the failed POST-based shape with a GET-based scrape after the standards-readiness review surfaced the POST→GET reconciliation gap.
- **RFC promotion cohort Active → Accepted (15 RFCs):** **0013** (workflow-chain packs — Draft → Active → Accepted same day on Phase 4 in-tree example landing); **0014–0021** graduation cohort (8 capability RFCs — behavioral conformance via opt-in test seam); **0022** (`core.dispatch` + `core.subWorkflow` runtime variable mapping — Postgres reference impl + dispatch trio); **0023** (conformance agent-event emitters); **0024** (streaming `agent.reasoned` deltas + SDK typed-helper rollout); **0026** (`provider.usage` event — filed Draft → Active → Accepted same day); **0030 / 0031 / 0032 / 0033** envelope-hardening track promoted Active → Accepted at the close of the release window.
- **5 new Draft RFCs filed against the 2026-05-21 standards-readiness review findings.** Each maps to a specific audit finding; full close-out lands in 1.1.3's Phase 4 harness work.
- **Agent pack catalog** (4 tiers, 28 packs total). Phase 1 — Tier 0/1 foundations (9 packs). Phase 2 — Tier 2 productivity skills (5 packs). Phase 3 — Tier 3 vertical agents (10 packs). Phase 4 — Tier 4 crews + skills-bridge (4 packs). Catalog seeded with reference manifests + signing material for downstream registry publication.
- **17 `core.openwop.*` packs published to `packs.openwop.dev`** under steward-internal pre-audit (2026-05-17). First non-trivial registry population. Includes pre-publication triage finding: `core.openwop.http@1.1.2` (idempotency-key generator made deterministic), `core.openwop.data@1.2.1` + `core.openwop.crypto@1.0.2` (correctness fix for nodes mis-declared as `pure`), `core.openwop.ai@1.1.1` + `core.openwop.crypto@1.0.3` (defensive parsing of model output + JWT shapes), `core.openwop.ai@1.1.2` + `core.openwop.mcp@1.1.1` (UNTRUSTED-marker discipline on `ctx.trustBoundary='untrusted'` runs), `core.openwop.agents@1.0.1` (raw-JS tool handler — closes `OPENWOP-AUDIT-2026-003`). Old `core.openwop.ai@1.1.1` + `core.openwop.mcp@1.1.0` marked deprecated.
- **Pack patches: SSRF + JWT alg-confusion fixes (P0.1)** (2026-05-17). Yank-and-republish on the affected versions.
- **Workflow-chain packs (RFC 0013)** — Phases 1–4 land in sequence. Reference example at `examples/branching-workflow/`. Phase 4 in-tree example demonstrates chain-pack composition end-to-end.
- **`apps/workflow-engine@P3`** — Firebase Auth signup + Cloud SQL persistence + KMS-encrypted BYOK (2026-05-17). Production rollout fixes (post-mortem) (2026-05-18). First fully-managed reference deployment serving as the `app.openwop.dev` surface.
- **Workflow-engine sample app — 30+ feature commits** covering: BYOK canary echo node + provisioning, `core.channelWrite` + append-with-TTL reducer, `capability_not_provided` refusal contract, idempotency body-hash mismatch, quorum-aware approval gate, `recursionLimit` + `conversationPrimitive` refusal, `core.subWorkflow` executor + variable mutation seam, JSON content negotiation, `getWorkflow` endpoint + strict `streamMode` validation, bulk-cancel endpoint + idempotency replay header, MCP discovery shape + approval resume validation, fixture input-port → variable resolution, credential-shape redaction, cache hit semantics + debug-bundle endpoint, fs absolute-path rejection + `kv.cas` canonical shape, events/poll `lastSequence` + SSE `bufferMs` aggregation, prompt-library UI staging, managed "Try it free" provider tile, RFC 0022 dispatch cluster, parent/child cancel-cascade interrupt profile, external-event interrupt support, AI chat viewport-lock + Lucide thumbs icons.
- **Storage adapter parity harness** — SQLite vs Postgres via `pg-mem` (2026-05-18) + real Postgres via `@testcontainers/postgresql` for end-to-end behavioral fidelity. Closes the storage-adapter parity gap from the v1.1.0 close-out.
- **Conformance close-outs**: 7 `aiEnvelope.*` scenarios graduated from shape probes to behavioral assertions (2026-05-18); `agent.toolReturned` causationId pairing tightened; envelope-track `it.todo` placeholders drained (sub-tracks E + E2 + A.reasoning-redaction); `OPENWOP_REQUIRE_BEHAVIOR` wired across the prompt-* scenario family; soak-gate close-out (opt-out axes + SQLite artifact stub).
- **Untrusted-content propagation, persisted envelope-correlation dedup, downstream-LLM untrusted-content wrap, envelope-contract capability stacking refusal, approval-gate trust-boundary refusal** — five protocol-tier behavioral hardening rows close in the sample-host (2026-05-19).

---
## [1.1.1] — 2026-05-15 — post-1.1.0 additive cleanup + RFC 0012

Six additive commits landed on `main` after the v1.1.0 release tag. None changes a wire shape; all ship in a 1.1.1 patch when the registry SDKs are next published. Two close adopter-experience footnotes (lockfile demo + community pack re-sign), one closes a conformance-probe scope limit (MCP transports), and three close the RFC-process self-acceptance loop (0008 promotion + node-packs §WASM cross-link, 0001 promotion + CHANGELOG status drift fix).

- **Workspace lockfile demo** (`daeaef5`) — `examples/core-packs-lockfile/openwop-pack-lockfile.json` + README pins the 4 audit-gated core packs (`core.openwop.{ai,http,mcp,triggers}@1.0.0`) using the `pack-lockfile` schema. Demonstrates SRI integrity + Ed25519 signature material for offline / air-gapped resolution. Closes the controllable half of the "build + sign + lockfile in-tree" Phase E task; the audit-blocked half (publication to `packs.openwop.dev`) remains gated on `SECURITY/external-audit-engagement.md` §2.1.
- **`community.openwop-team.demo` re-signed** (`0bf08cc`) — Option-B reconciliation of a 3-way signing-identity drift. The demo pack now ships signed by `community-openwop-team-demo-1` (over canonical `pack.json`) instead of `openwop-registry-root` (over tarball), matching PACKS-MVP-PLAN.md §211's per-tier-key intent and illustrating the per-publisher-identity pattern. New `registry/keys/community-openwop-team-demo-1.pub` + `signingKeys[]` entry in `registry/.well-known/openwop-registry.json` (namespace-scoped to `community.openwop-team.demo` only — cannot sign for `core.*` or `vendor.*`). Canonical verifier (`registry/scripts/verify-signatures.mjs`) passes 29/29.
- **MCP probe scope-limit footnote closed** (`beb5ae6`) — all three MCP transports now verified end-to-end against `@modelcontextprotocol/sdk@1.29.0`. SSE-streamed responses verified via the same SDK without `enableJsonResponse` (probe's existing `readSseUntilId` correlates frames by JSON-RPC id). Stdio transport — HTTP-incompatible by design — exercised via the new `examples/mcp-stdio-bridge/` shim that wraps any newline-delimited-JSON-RPC stdio server as HTTP for the probe (bundled `echo-stdio-server.mjs` + per-session-id child-process lifecycle; 2/2 pass). `INTEROP-MATRIX.md` §"Composition partners" MCP row + `spec/v1/mcp-integration.md` §"Conformance + interop" + `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 6 all updated to retire the previous scope-limit language.
- **RFC 0008 (WASM ABI) promoted Active → Accepted** (`6118cce`, 2026-05-13) — all 8 acceptance-criteria items satisfied. The one previously-stuck gap (`spec/v1/node-packs.md` §"WASM runtime" cross-link) landed in the same commit with a 6-scenario coverage table mapping each `wasm-pack-*.test.ts` to its RFC 0008 anchor. The previously-stale `Open spec gaps` row `NP1 — WASM ABI for language: wasm packs` flipped to ✅ closed. README + CHANGELOG status banners refreshed to reflect 0008/0009/0010/0011 all Accepted.
- **RFC 0001 (RFC process) promoted Active → Accepted** (`20e0d1c`, 2026-05-13) — closes the meta-RFC's self-acceptance loop. All 6 acceptance-criteria items confirmed: `RFCS/README.md` + `0000-template.md` + this file shipped together; `GOVERNANCE.md` cross-references `RFCS/` at five locations; `CHANGELOG.md` records the RFC process landing; `rfc` PR label created in the public repo (`#5319e7` purple, description references the process RFC). Subsequent normative additions land under standard RFC review rather than the bootstrap waiver pattern. Same commit fixed CHANGELOG status drift for RFCs 0009/0010/0011 (had been stale at `Active` even though all three were promoted to `Accepted` 2026-05-12).
- **Final RFC ladder state (2026-05-13):** RFCs 0001–0011 all `Accepted` (11 total). 0000 is the template scaffold; 0012 (memory compaction) is parallel-session `Draft`. Every RFC with a satisfied acceptance checklist is now promoted.
- **RFC 0012 (Memory Compaction Profile) Active → Accepted (2026-05-15)** — comment window waived per `CONTRIBUTING.md` §"Bootstrap-phase notes" (sole-steward repo, no non-steward maintainer of record, no external commenters during the 48h the window was open). All 6 acceptance criteria satisfied at promotion time. RFC ladder state: **0001–0012 all `Accepted` (12 total)**. 0000 is the template scaffold. Future RFCs revert to the canonical 7-day comment window once `MAINTAINERS.md` lists a non-steward maintainer.
- **RFC 0012 (Memory Compaction Profile) Phase 3 prep landed 2026-05-14** (promoted to `Accepted` 2026-05-15 under the bootstrap waiver above):
  - **Reference host** — `examples/hosts/postgres/src/memory-adapter.ts` gains `runCompaction` + `applyCompactionRedaction` + `REFERENCE_COMPACTION_CAPABILITY`. Server.ts conditionally advertises `capabilities.memory.compaction` when `OPENWOP_MEMORY_COMPACTION=true` and exposes the test seam at `POST /v1/test/memory/{seed,compact}` when `OPENWOP_TEST_TRIGGER_COMPACTION=true`. SR-1 carry-forward (RFC 0012 §D) honored by re-substituting `[BYOK:...]` form-leaks + non-canonical `<REDACTED:...>` markers with `[REDACTED:carry-forward-<n>]` BEFORE the derived entry persists. Output entries carry the `compacted-from:<id>` provenance tag per §C.
  - **3 conformance scenarios** — `memory-compaction-event-emitted.test.ts` (canonical §B payload shape), `memory-compaction-sr1-carry-forward.test.ts` (load-bearing §D — replaces the Phase 2 `it.todo()` stub), `memory-compaction-provenance-tag.test.ts` (soft assertion on §C). All three gate on `capabilities.memory.compaction.supported` + test seam reachability. 3/3 pass live against the Postgres reference host.
  - **Host smoke** — `examples/hosts/postgres/test/memory-compaction.test.ts` verifies 7 paths end-to-end (advertisement + seed + compact + outputId readability + SR-1 §D + provenance + empty-noop).
- **RFC 0012 (Memory Compaction Profile) Draft → Active (2026-05-13)** — opens the 7-day public comment window (closes 2026-05-20). New optional `capabilities.memory.compaction` advertisement + `memory.compacted` canonical event + SR-1 carry-forward invariant for any host that distills short-lived `MemoryEntry` rows into longer-lived ones. Additive per `COMPATIBILITY.md` §2.1.
- **Tarball-fetch + signature-verify roundtrip vs `packs.openwop.dev` (2026-05-13)** — `conformance/src/scenarios/registry-public.test.ts` gains a 4th `describe` block that fetches `core.openwop.examples@1.0.0`'s tarball + `.sig` + publisher public key from the live registry, asserts SRI integrity matches a fresh SHA-256 of the tarball bytes, and runs Ed25519 verification per `node-packs.md` §"Signing recipe" (`method=ed25519` signs the whole tarball). Closes `coverage.md` row 34's "Remaining: tarball-fetch + signature-verify roundtrip" gap. 6/6 tests pass against live `packs.openwop.dev`.
- **Strict-mode opt-out signaling (2026-05-13)** — new `OPENWOP_OPTED_OUT_PROFILES=name1,name2` env var consumed by `conformance/src/lib/behavior-gate.ts` distinguishes "host opted out (honest minimal posture)" from "host claims but doesn't deliver (bug)". Strict mode (`OPENWOP_REQUIRE_BEHAVIOR=true`) skips opted-out profiles with a "honest opt-out" log line instead of failing. SQLite + Python reference hosts can now achieve strict-mode green without falsifying capability claims. Advertise + opt-out conflict surfaces a loud warning so typos don't mask real bugs.
- **Batch A — adopter-facing prose refresh (2026-05-13):**
  - `examples/hosts/postgres/conformance-full.md` + `INTEROP-MATRIX.md` re-measured against suite v1.1.0 with conditional-profile env vars: **781/850 (91.9% total, 95.2% of non-todo, 96.4% of applicable)** — up from 728/797 the prior measurement. +53 scenarios + +53 passes net of Phase H/I capability surfaces + 9 stage5 vendor packs. One failure remains: documented `webhook-signed-delivery` flake (passes in isolation; full-suite timing collision).
  - `docs/migration/v1.0-to-v1.1.md` — new adopter-facing "what's new" guide. Documents v1.1 as purely additive per `COMPATIBILITY.md` §2.1: every v1.0 conformance pass remains valid, no code changes required for v1.0 implementations. Per-capability sections walk through Phase H (BYOK / AI providers / MCP / HTTP / cap-breach kinds) + Phase I (memory / agents / auth profiles) + Phase G (spec-corpus close-out) with cross-links to RFCs + conformance scenarios. Linked from `README.md` §"Document index".
  - `ROADMAP.md` §"v1.2 outlook (projected)" — new gate-conditioned projection of v1.2 candidates: RFC 0012 memory compaction, WASM Component Model sub-RFC, Rust SDK v0.1 (demand-gated), 4 audit-gated `core.openwop.*` packs, cross-host SSE replay, mTLS termination on Postgres, multi-region idempotency end-to-end fixture. Each item carries its specific gate (RFC comment window / external audit / capability flag / adopter ask) — no fixed calendar; items move to next minor or `Withdrawn` if no signal.
  - `sdk/python/QUICKSTART.md` + `sdk/go/QUICKSTART.md` — new 5-minute end-to-end walkthroughs that boot the in-memory reference host on your laptop, run a workflow against it, and read the event log. Both READMEs link to the new quickstarts.
- **Batch C — conformance coverage close-outs (2026-05-13):**
  - **Multi-region idempotency convergence-rule resolver** (Track 13) — new `examples/hosts/postgres/src/multi-region.ts` ships the canonical algorithm for `idempotency.md` §"Multi-region idempotency" §"Convergence rule": lex-min(`runId`) wins, losers get `run.cancelled { reason: 'cross_region_dedup_loss' }`, every region's cache redirects to the winning runId. Pure function — same inputs → same outcome regardless of caller order, region, or wall clock; two regions running the resolver independently arrive at the same survivor without coordination. Smoke test (`test/multi-region-idempotency.test.ts`) verifies 6 paths including label-determinism for the operator-tier `openwop.idempotency.cross_region_conflicts_total` counter. Conformance scenario (`multi-region-idempotency.test.ts`) extended to also verify that hosts claiming `crossRegion: 'best-effort'` or `'strict'` advertise the operator metric per §"Operator surface". The Postgres reference host stays single-region (`crossRegion: 'single-region'`); the resolver is operator-adoption-ready for any future multi-region host.
  - **Cross-host trace-context propagation across `core.subWorkflow`** (Track 11 remaining row) — new `conformance/src/scenarios/otel-trace-propagation-subworkflow.test.ts` closes the previously-partial gap on `coverage.md` row 52. Asserts: when a parent run is started with an inbound `traceparent` and contains a `core.subWorkflow` node, the dispatched child run's spans MUST share the parent's traceId. Distributed traces stitch across the dispatch boundary without operator-side correlation hacks. Gates on `capabilities.observability` + `conformance-subworkflow-parent` fixture advertisement + `OPENWOP_OTEL_COLLECTOR=true`. `coverage.md` Observability row + per-scenario row both flipped to **A (full coverage)**.
- **Batch B — Postgres reference host additive surfaces (2026-05-13):**
  - **Phase I.2 reasoning-event emission wiring** — Postgres host's `core.llm.chat` / `core.llm.completion` executors now emit `agent.reasoned` (verbosity-gated per `RunOptions.configurable.reasoningVerbosity` → host default fallback `"summary"` with 512-token cap) + `agent.decided` (confidence ∈ [0,1]) after a successful AI-proxy call. `core.mcp.toolCall` emits `agent.toolCalled` BEFORE the call (carrying `argumentsSha256`) and `agent.toolReturned` AFTER (paired via shared `callId`, with `outcome.{resultSha256,resultLength,isError,durationMs}` on success or `error.{code,message}` on failure). SR-1 + MCP-1 preserved end-to-end: only SHA-256 digests + lengths + outcome flags appear on payloads — never raw tool arguments or result content. Verified by `examples/hosts/postgres/test/reasoning-event-emission.test.ts` via two new host-private fixtures (loaded through the `OPENWOP_EXTRA_FIXTURES_DIR` test seam — these typeIds are implementation-specific and not yet protocol-normative).
  - **Phase I.7 mTLS termination** — Postgres host now claims `openwop-auth-mtls` end-to-end when `OPENWOP_MTLS_CERT_PATH` + `OPENWOP_MTLS_KEY_PATH` are set. HTTP listener switches to `node:https.createServer({ requestCert: true, rejectUnauthorized: OPENWOP_MTLS_REQUIRED !== 'false' })`; `OPENWOP_MTLS_CA_PATH` is optional (when present, only client certs signed by that CA bundle pass the handshake). Discovery emits `capabilities.auth.mtls.{supported: true, required: <bool>, subjectMapping: 'cn'}` only when configured (honesty principle). Verified end-to-end by `test/mtls.test.ts` (advertisement shape + valid-cert 201 + no-cert TLS handshake rejection). The existing `conformance/src/scenarios/auth-mtls.test.ts` now flips from "Not claimed" to a verified positive path when the Postgres host is launched with `OPENWOP_MTLS_*` configured.

---

## [1.1.0] — 2026-05-12 — openwop v1.0 close-out + additive features

The close-out release for v1.0. The protocol contract was frozen on 2026-05-08 (see the spec-freeze entry below) and first published as v1.0.0 on 2026-05-11 (see entry below). This 1.1.0 release closes every controllable gap from the 2026-05-10 deep-dive review and the 2026-05-12 architectural re-evaluation, hardens the Postgres reference host to production-runtime parity, and lands 18 additive feature surfaces (Phase H launch-blockers + Phase I enterprise-blockers).

All changes in this release are **additive per `COMPATIBILITY.md` §2.1** — no existing required fields changed type or optionality, no event-type shape changed, no endpoint contract relaxed, no existing `MUST` weakened. Hosts that were v1.0.0-compliant remain v1.x-compliant; this release just adds new capability surfaces that hosts may now advertise + new conformance scenarios that gate on those advertisements.

Per-track closure status is tracked in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` (archived 2026-05-12); per-host conformance evidence lives in `examples/hosts/*/conformance.md` + `INTEROP-MATRIX.md`.

### Spec corpus state

- **29 prose specs** at `Status: FINAL v1`. Zero `DRAFT` / `STUB` / `OUTLINE` tags remain. New additions since 2026-05-08 freeze: `auth-profiles.md`, `capabilities-change-detection.md`, `grpc-transport.md`, `i18n.md`, `compliance.md`, `host-capabilities.md`, `production-profile.md`, `replay.md` retention/expiry annex, `node-packs.md` lockfile + Component-Model annexes.
- **22 first-class JSON Schemas** under `schemas/`, all JSON Schema 2020-12 with `$id` at `https://openwop.dev/spec/v1/<name>.schema.json` and `additionalProperties: false` on every object. New: `agent-manifest`, `agent-ref`, `memory-entry`, `memory-list-options`, `audit-verify-result`, `pack-lockfile`, `orchestrator-decision`, `dispatch-config`.
- **OpenAPI 3.1** (`api/openapi.yaml`) — every endpoint has `operationId` + `tags` + ≥ 1 error response; every schema referenced via cross-file `$ref`. Lints clean under `redocly lint`. New operations: `verifyAuditLog`, `bulkCancelRuns`.
- **AsyncAPI 3.1** (`api/asyncapi.yaml`) — every channel binds to a message + payload schema reference. Lints clean under `asyncapi validate`.
- **gRPC transport profile** (`api/grpc/openwop.proto` + `spec/v1/grpc-transport.md`) — canonical `openwop.v1.Engine` service; profile-gated via `capabilities.supportedTransports: ["grpc"]`.

### RFCs landed

- **RFC 0001** — RFC process itself (`Accepted`).
- **RFC 0002** — Agent identity + reasoning events (`Accepted`).
- **RFC 0003** — Agent packs (`Accepted`).
- **RFC 0004** — Memory layer + `MemoryAdapter` contract (`Accepted`).
- **RFC 0005** — Conversation as run primitive (`Accepted`).
- **RFC 0006** — Orchestrator-supervisor role (`Accepted`).
- **RFC 0007** — `core.dispatch` core node (`Accepted`).
- **RFC 0008** — WASM ABI (`Accepted` 2026-05-13) + Component-Model variant annex.
- **RFC 0009** — Production-profile conformance (`Accepted` 2026-05-12).
- **RFC 0010** — Auth-profile conformance + v1.0 closure umbrella (`Accepted` 2026-05-12).
- **RFC 0011** — Auth-scoped discovery (`Accepted` 2026-05-12).

### Multi-Agent Shift (RFCs 0002–0007 + RFC 0008)

- Phase 1 — `AgentRef` wire shape; `agent.reasoned` / `agent.toolCalled` / `agent.toolReturned` / `agent.handoff` / `agent.decided` events; `confidence` escalation contract (CP-1); `message` reducer.
- Phase 2 — Agent capability discovery on `/.well-known/openwop`; `pack.json` `agents[]` extension; agent-pack manifests.
- Phase 3 — Agent memory layer: `memoryRef` resolution + redaction (SR-1) + cross-tenant isolation (CTI-1) + host `MemoryAdapter` contract.
- Phase 4 — Conversation as run primitive: `conversation.start` / `conversation.exchange` / `conversation.close` suspend variants.
- Phase 5 — Orchestrator-supervisor: `core.orchestrator.supervisor` typeId + `OrchestratorDecision` schema + `runOrchestrator.decided` event.
- Phase 6 — `core.dispatch` core node: conservative dynamic graph mutation (CP-2); causationId propagation per RFC 0007 §E.
- WASM ABI — RFC 0008 Active; reference Rust pack at `examples/packs/rust-hello/` (28 KiB wasm32); Wasmtime-free loader at `examples/hosts/in-memory/src/wasm-loader.ts`; six conformance scenarios; deliberately-misbehaving packs for memory-cap (`examples/packs/rust-misbehaving-memory/`) and ABI-mismatch (`examples/packs/rust-misbehaving-abi/`) positive-path testing. Schema extension: `capBreached.kind` enum gained `wasm-memory`, `wasm-fuel`, `wasm-execution-time` (RFC 0008 §K). New optional capability `capabilities.nodePackRuntimes.wasm.loadedPacks[]` surfaces accepted pack names; rejected packs (declared ABI not in `abiVersions[]`) MUST be absent — drives the conformance positive path since rejection happens at load time before any node-invoke surface.
- OTLP/gRPC collector (Track 11 closure) — `conformance/src/lib/grpc-framing.ts` (hand-rolled length-prefixed gRPC HTTP/2 framing, zero npm deps) + `OtelCollector.startGrpc()` (parallel `node:http2` server, shared spans/metrics store). New optional capability `capabilities.observability.otel.exportProtocols[]` advertises the supported OTLP transports (`http/json`, `http/protobuf`, `grpc`); `spec/v1/observability.md` gains a §"Export protocols" normative section. New conformance scenario `otel-emission-grpc.test.ts` gates on the array. Opt-in via `OPENWOP_OTEL_COLLECTOR_GRPC=true` (default port 4317).

### Capability surfaces

Hosts advertise optional behaviors at `/.well-known/openwop`. New capability blocks added between 2026-05-08 and 2026-05-12:

- `capabilities.runs.{pauseResume, bulkCancel}` — pause/resume + bulk-cancel endpoints.
- `capabilities.webhooks.{supported, signatureAlgorithms}` — HMAC v1 signing (`{timestamp}.{rawBody}`).
- `capabilities.secrets.{supported, scopes, resolution}` — BYOK secret resolution (host-managed).
- `capabilities.aiProviders.{supported, byok, policies}` — AI provider routing with 4-mode policy enforcement (`disabled` / `optional` / `required` / `restricted`).
- `capabilities.mcpClient.{supported, transports, trustBoundary}` — MCP tool invocation; `trustBoundary: "untrusted"` per `threat-model-prompt-injection.md` §UNTRUSTED.
- `capabilities.httpClient.{supported, methods, ssrfGuard, maxResponseBodyBytes}` — universal `core.http.request` typeId with SSRF guard.
- `capabilities.memory.{supported, maxEntrySizeBytes, ttlSupported}` — `MemoryAdapter` read-side contract per RFC 0004.
- `capabilities.agents.{supported, profile, modelClasses, orchestratorPattern, memoryBackends, orchestrator, dispatch, reasoning}` — Multi-Agent Shift Phase 1–6 advertisement.
- `capabilities.auth.{profiles[], rotation, oauth2, oidc, auditLogIntegrity}` — auth-profile advertisement (rotation; OAuth2-CC; OIDC user-bearer; audit-log integrity).
- `capabilities.discovery.authScoped.{supported, mode}` — RFC 0011 same-endpoint auth-scoped discovery.
- `capabilities.production.{supported, backpressure, retention, debugBundle}` — production-profile claim (RFC 0009).
- `capabilities.observability.{otel, metrics}` — OTel emission with `openwop.{run.backlog, queue.depth, run.duration}` metrics; OTLP/HTTP-JSON + OTLP/HTTP-protobuf encodings supported.

### Reference SDKs at 1.1.0

- **`@openwop/openwop`** (TypeScript, npm) — first-class methods on `OpenwopClient` for every OpenAPI endpoint; `HTTP_ERROR_CODES` catalog with 40+ canonical codes; `RunEventDoc` type + `isTerminalRunStatus` helper; new typed exports added in 1.1.0: `MemoryEntry`, `MemoryListOptions`, `AgentRef`, `AgentsCapability`, `AuthProfileClaim`, `AICredentialRef`, `McpToolCallNodeConfig`, `HttpRequestNodeConfig`.
- **`openwop-client`** (Python, PyPI) — stdlib-only port preserving the same surface; `HTTP_ERROR_CODES` frozenset; matching wire types.
- **`github.com/openwop/openwop/sdk/go`** (Go modules) — same surface; `HTTPErrorCodes` slice; doc comments on every exported symbol; `go vet` clean.
- **Rust SDK** — foundation demand-gated; conformance suite is language-agnostic black-box, so future Rust client tests against the same wire contract.

### Reference hosts

Four reference implementations live under `examples/hosts/`. Conformance evidence per host in `INTEROP-MATRIX.md`:

- **In-memory** (TypeScript, `examples/hosts/in-memory/`) — local-dev fastest-boot; no persistence; claims `openwop-core` + stream profiles.
- **SQLite** (TypeScript, `examples/hosts/sqlite/`) — single-machine durability; **669/731 (91.5%)** conformance pass rate; claims audit-log-integrity + 4 interrupt profiles + auth-api-key-rotation + discovery-auth-scoped.
- **Python in-memory** (Python 3.11 stdlib-only, `examples/hosts/python/`) — cross-language portability proof; **700/788 (100% of applicable, ZERO failures)** conformance pass rate.
- **Postgres** (TypeScript, `examples/hosts/postgres/`) — production durability path; first host claiming `openwop-production`; **730/799 (91.4%)** conformance pass rate. Ships with BYOK + 4-mode AI policy + MCP client + HTTP client (SSRF-guarded) + MemoryAdapter + agents capability + API-key rotation + auth-scoped discovery + OAuth2-CC + OIDC user-bearer JWT validators (RS256 + ES256 with JWKS cache + `alg: "none"` rejection) + cap-breach enforcement + per-workflow configurableSchema validation + subworkflow outputMapping + parent linkage.

### Conformance suite at 1.1.0

- **`@openwop/openwop-conformance`** — 103 scenario files under `conformance/src/scenarios/`. New since the 1.0.0 publish: production-profile (backpressure + retention-expiry), auth profiles (api-key-rotation + OAuth2-CC + OIDC + mTLS shape), audit-log integrity, BYOK roundtrip, MCP/A2A real-impl interop (verified against `@modelcontextprotocol/server-everything` + A2A 0.3 JSON-RPC reference), agent memory (roundtrip + cross-tenant + redaction + TTL), webhook signed delivery, stream-modes (buffer + mixed-mode), bulk-cancel, MCP-toolcall redaction, HTTP-client SSRF, WASM pack ABI-version-rejection + memory-cap positive-path, configurableSchema positive overlay, pause-resume race + drain semantics.
- **Two execution modes**: `npm test` (parallel files, ~95s) and `npm run test:strict` (`--no-file-parallelism` for production-backpressure + OTel envelope coverage).
- **Behavior-gated**: `OPENWOP_REQUIRE_BEHAVIOR=true` flips capability-gated scenarios from skip to fail when the host doesn't advertise the profile.

### SECURITY invariants

- **68 invariants tracked** (`SECURITY/invariants.yaml`):
  - 35 protocol-tier (all with public conformance tests; CI-gated via `scripts/check-security-invariants.sh`).
  - 32 reference-impl tier (verified by each reference impl's own CI).
  - 1 advisory (defense-in-depth, no hard MUST).
- New protocol-tier invariants added between freeze and release: `mcp-toolcall-payload-redaction`, `http-client-ssrf-guard`, `agent-memory-cti-1`, `agent-memory-sr-1-redaction`, `auth-key-rotation-no-canary-echo`.
- Threat-model docs at `SECURITY/threat-model-*.md` (secret-leakage, prompt-injection, provider-policy, node-packs, auth-profiles).
- CNA registration + bug-bounty program annex at `SECURITY/cna.md` + `SECURITY/bug-bounty.md`.

### Wire-shape stability

The wire contract remains **frozen at v1** per `COMPATIBILITY.md` §2 — additive changes only inside v1.x, safety-fix only when correctness or CVE-class issues require it. Breaking changes wait for v2. This 1.1.0 release adds new optional capability surfaces; hosts that advertised the 1.0.0 capability set remain v1.x-compliant without change.

### Domain and package naming

- Canonical domain: `openwop.dev`
- Registry: `packs.openwop.dev` (TLS cert provisioned; live)
- Package names: `@openwop/openwop`, `@openwop/openwop-conformance`, `openwop-client`, `github.com/openwop/openwop/sdk/go` — stable through any v1.x release per `PUBLISHING.md`.

### Verification

`npm run openwop:check` — the 8-step pre-merge gate — passes for every commit on `main`:

1. TypeScript reference SDK builds + emits `dist/`
2. Conformance suite typechecks + server-free scenarios pass
3. Python reference SDK syntax + import smoke clean
4. Go reference SDK `go vet` + tests clean
5. OpenAPI 3.1 `redocly lint` clean
6. AsyncAPI 3.1 `asyncapi validate` clean
7. Publish-metadata + npm-pack-contents + Python/Go release-surface clean
8. SECURITY invariants — every protocol-tier MUST-NOT has a public test

---

## [1.0.0] — 2026-05-11 — openwop v1.0 first publish

First publication of the openwop spec corpus to the package registries. Captures everything that was in scope at the v1 spec freeze (2026-05-08) plus three days of pre-publish hardening: SQLite host conformance fixes, registry TLS provisioning, audit-log integrity profile shipped end-to-end on SQLite, CI gate hardening (NPM_CACHE / GOCACHE cross-platform), recruitment artifacts for first non-steward host + pack-author.

### Published artifacts

- **npm:** `@openwop/openwop@1.0.0` (TypeScript SDK), `@openwop/openwop-conformance@1.0.0` (conformance suite). Published 2026-05-11 05:06–05:09 UTC.
- **PyPI:** `openwop-client@1.0.0` (Python SDK).
- **Go modules:** tagged `sdk/go/v1.0.0` on origin.
- **Tag:** `v1.0.0` on origin at commit `6a637f1`.

### Scope at 1.0.0

- Spec freeze content per `[1.0] — 2026-05-08` entry below — 26 prose specs at FINAL v1; 17 first-class JSON Schemas; OpenAPI 3.1 + AsyncAPI 3.1; three reference SDKs (TS/Python/Go); conformance suite v1.0.0.
- Phase A conformance behavior closure — SQLite host pass rate 91.5% under `OPENWOP_REQUIRE_BEHAVIOR=true`.
- Phase B spec corpus completion — all `DRAFT`/`STUB`/`OUTLINE` tags retired; `host-capabilities.md` promoted; `i18n.md` + `compliance.md` annexes shipped.
- Phase C round 1 — three reference hosts (in-memory, sqlite, python) advertising their respective capability surfaces.
- Phase F — MCP + A2A probe extensions (synthetic fakes).
- Registry — `packs.openwop.dev` live with TLS; 3+ packs published with Ed25519 chains.
- CI — `npm run openwop:check` 8-step gate green.

### Known gaps at 1.0.0 (closed in 1.1.0)

- Postgres reference host had not yet shipped the BYOK / MCP / HTTP / agent-memory / OAuth2-CC / OIDC / API-key-rotation / auth-scoped-discovery surfaces.
- 11 conformance scenarios were shape-graded (not behavior-graded).
- Phase F real-impl interop (against `@modelcontextprotocol/server-everything` + A2A 0.3 reference) was not yet wired.
- Phase H launch-blockers + Phase I enterprise-blockers from the 2026-05-12 architectural re-evaluation were not yet identified.

---

## [1.0] — 2026-05-08 — openwop v1 spec freeze

Protocol contract locked. The spec corpus, schemas, API definitions, reference SDKs, and conformance suite all reach `1.0` artifact versions. This date marks the **freeze** — no breaking wire-shape changes after this point inside v1.x.

The 4-day window between this freeze and the 2026-05-12 release closes every controllable gap from the deep-dive review and hardens reference hosts to production-runtime parity. See the [1.0.0] release entry above for the consolidated record.

### What's locked at freeze

- **Prose specs** — 26 docs at `Status: FINAL v1`: `auth.md`, `capabilities.md`, `channels-and-reducers.md`, `idempotency.md`, `interrupt.md`, `node-packs.md`, `observability.md`, `replay.md`, `rest-endpoints.md`, `run-options.md`, `stream-modes.md`, `version-negotiation.md`, `profiles.md`, `scale-profiles.md`, `debug-bundle.md`, `host-extensions.md`, `a2a-integration.md`, `mcp-integration.md`, and the v1 profile/addendum docs.
- **JSON Schemas** — 17 first-class schemas including agent-ref, agent-manifest, memory-entry, memory-list-options, conversation-turn, conversation-event, and dispatch-config schemas.
- **API definitions** — OpenAPI 3.1 (`api/openapi.yaml`) + AsyncAPI 3.1 (`api/asyncapi.yaml`).
- **Reference SDKs at 1.0** — `@openwop/openwop` (TypeScript), `openwop-client` (Python), `openwopclient` (Go).
- **Conformance suite at 1.0** — `@openwop/openwop-conformance`.
- **CI gating** — `scripts/openwop-check.sh` + `.github/workflows/openwop-spec.yml`.
- **Governance** — `CONTRIBUTING.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `COMPATIBILITY.md`, `SECURITY.md`.

### Multi-Agent Shift (Phases 1-6 landed by freeze)

- **Phase 1 (RFC 0002)** — Agent identity (`AgentRef`), agent reasoning + tool + handoff event family, confidence-escalation contract, `message` reducer.
- **Phase 2 (RFC 0003)** — Agent capability discovery on `/.well-known/openwop` + `pack.json` `agents[]` extension.
- **Phase 3 (RFC 0004)** — Agent memory layer — `memoryRef` resolution, redaction guarantees, host `MemoryAdapter` contract.
- **Phase 4 (RFC 0005)** — Conversation as run primitive — `conversation.start` / `conversation.exchange` / `conversation.close`.
- **Phase 5 (RFC 0006)** — Orchestrator-supervisor role — `core.orchestrator.supervisor` node type.
- **Phase 6 (RFC 0007)** — `core.dispatch` core node — conservative dynamic graph mutation.

### Domain and package naming

- Canonical domain: `openwop.dev`
- Registry: `packs.openwop.dev`
- Package names: `@openwop/openwop`, `@openwop/openwop-conformance`, `openwop-client`, `openwopclient`
