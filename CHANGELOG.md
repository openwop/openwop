# openwop Spec v1 — Changelog

All notable changes to the openwop v1 spec, schemas, OpenAPI/AsyncAPI, conformance suite, and TypeScript reference SDK.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1/) loosely. Versions are spec-corpus-wide (one date, multiple artifact updates per row); per-artifact versions live in their respective `package.json` / schema `$id` fields.

> **Status legend** (per `auth.md` §status legend):
> STUB · DRAFT · OUTLINE · FINAL — see individual doc headers for current state.

---

## [1.0 — additions] — 2026-05-12 — Replay retention-expiry conformance (Phase C close-out)

- **`conformance/src/scenarios/replay-retention-expiry.test.ts` shipped.** Asserts the normative `replay.md:246` requirement that fork against an expired event range returns `410 Gone` or `422 Unprocessable Entity` with the canonical error envelope. Capability shape (top-level `replay.supported` + `replay.modes[]` non-empty + optional `replay.retention.windowSeconds` typing) runs unconditionally when the profile is advertised. Envelope assertion gated on `OPENWOP_TEST_EXPIRED_REPLAY_RUN_ID` (operator-supplied; no standardized force-expire endpoint per RFC 0009 unresolved question #1). `details.{sourceRunId, fromSeq}` soft-checks fire when present. **No RFC needed** — `replay.md` already normates the response shape; this is purely additive conformance coverage. Scenario count: 98 → 99. `coverage.md` "Replay and fork" row promoted B+ → A; capability-gated table gains a new `openwop-replay-fork` row alongside the existing `audit-log-integrity` / production / auth ones.

## [1.0 — additions] — 2026-05-12 — RFC 0010 reference-host validation + INTEROP-MATRIX

- **SQLite reference host: behavior-mode pass.** Against the SQLite host with `OPENWOP_SECONDARY_API_KEY` supplied, the four production-auth scenarios run `OPENWOP_REQUIRE_BEHAVIOR=true` with 15/17 assertions passing (2 correctly-skipped mTLS opt-ins that require `OPENWOP_TEST_MTLS=1` + cert paths). Rotation profile verified end-to-end: capability shape strict, two-key overlap exercised against the SQLite host's existing dual-candidate `checkAuth` (constant-time comparison against both keys), canary-redaction confirmed. OAuth2-CC + OIDC + mTLS capability-shape strict; behavior portions soft-skip because the SQLite host's `checkAuth` does not parse JWTs or terminate TLS — that's the documented "host-pending behavior" state in `conformance/coverage.md`. SQLite host's discovery payload already advertises all four profiles + per-profile metadata blocks (`auth.rotation`, `auth.oauth2`, `auth.oidc`, `auth.mtls`) per the parallel `feat(phase-A)` commit that landed in `8706e2d`.
- **`INTEROP-MATRIX.md` SQLite row gains four auth profiles.** Compatibility profile claim column lists `openwop-auth-api-key-rotation`, `openwop-auth-oauth2-client-credentials`, `openwop-auth-oidc-user-bearer`, `openwop-auth-mtls` alongside the prior 8 profile claims. The row prose distinguishes "verified end-to-end" (rotation) from "advertised at capability-shape level pending live-IdP / TLS-terminator wiring" (OAuth2-CC + OIDC + mTLS) so the claim is honest about what conformance evidence backs each entry.

## [1.0 — additions] — 2026-05-12 — RFC 0010 Active + auth-profile close-out

- **RFC 0010 promoted `Draft` → `Active`.** Bootstrap-phase steward decision per `CONTRIBUTING.md` §"Bootstrap-phase notes" — the standard 7-day additive comment window was waived because no non-steward maintainer is yet listed in `MAINTAINERS.md`. The four unresolved questions in `RFCS/0010-auth-profile-conformance.md` §"Unresolved questions" remain open and may be revisited as additive sub-RFCs without breaking v1 wire compatibility. Same precedent as RFC 0009.
- **mTLS opt-in scenario landed.** `conformance/src/scenarios/auth-mtls.test.ts` covers capability-shape (always) plus three opt-in behavior assertions (gated on `OPENWOP_TEST_MTLS=1` + cert paths). Uses `undici` Agent dispatcher to thread the client cert through Node's global fetch. Same opt-in precedent as `restart-during-run.test.ts`. Scenario count: 97 → 98.
- **`SECURITY/threat-model-auth-profiles.md` updated.** §3 Adversaries row A1, A2, A3, A4 each get a scenario-binding citation. New A7 adversary added for OIDC IdP impersonation via key spoofing (kid-not-in-JWKS), covered by `auth-oidc-user-bearer.test.ts`. New §4.4 OIDC STRIDE table parallel to §4.1–§4.3. §7 Verification rewritten from "future work" to the four landed scenarios + harness path.
- **`spec/v1/auth-profiles.md` §Discovery guidance updated.** Promotes `capabilities.auth.*` (RFC 0010 formal schema) as the preferred discovery path; `extensions.auth.*` remains valid for legacy clients; clients MUST prefer the new path when both are present.

## [1.0 — additions] — 2026-05-11 — RFC 0010 Draft: auth-profile conformance

- **RFC 0010 opened (Draft).** [`RFCS/0010-auth-profile-conformance.md`](./RFCS/0010-auth-profile-conformance.md) consolidates the four production-auth profiles in `auth-profiles.md` (rotation, OAuth2 client-credentials, OIDC user-bearer, mTLS) into one additive RFC. Proposes formalizing `capabilities.auth` as a top-level schema block with `profiles[]` + per-profile metadata sub-blocks (preserving the existing informal `auth.auditLogIntegrity` advertisement via `additionalProperties: true`). Adds three new conformance scenarios + one opt-in mTLS scenario + a synthetic OIDC issuer harness under `conformance/src/lib/oidc-issuer.ts`. Additive — no v1 wire-shape change. Four unresolved questions captured for review: rotation overlap granularity, OIDC harness key-rotation testing, mTLS subject-mapping ambiguity, OAuth2-CC/OIDC overlap semantics. Same-wave stubs + post-Active host implementation follow the RFC 0009 precedent.
- **RFC 0010 same-wave stubs landed.** `schemas/capabilities.schema.json` gains the additive `auth` block with `profiles[]` + `rotation`/`oauth2`/`oidc`/`mtls` sub-blocks (`additionalProperties: true` preserves existing informal `auditLogIntegrity` advertisement from the audit-log-integrity profile). Three new conformance scenarios shipped: `auth-api-key-rotation.test.ts` (capability shape + secondary-key overlap + canary-redaction), `auth-oauth2-client-credentials.test.ts` (capability shape + malformed-JWT + three harness-minted negative cases), `auth-oidc-user-bearer.test.ts` (capability shape + six harness-driven validation cases). Synthetic OIDC issuer harness landed at `conformance/src/lib/oidc-issuer.ts` — RS256 + ES256 JWS signing via node:crypto stdlib, JWKS export via Node's built-in JWK serialization, no new npm deps. `conformance/coverage.md` and `conformance/README.md` updated; scenario count 94 → 97. mTLS scenario deferred to a separate same-wave commit (opt-in via `OPENWOP_TEST_MTLS=1`). Suite passes `openwop:check` 8/8 green. Stubs revisable during the comment window.

## [1.0 — additions] — 2026-05-11 — RFC 0009 Active + production-profile pass

- **RFC 0009 promoted `Draft` → `Active`.** Bootstrap-phase steward decision per `CONTRIBUTING.md` §"Bootstrap-phase notes" — the standard 7-day additive comment window was waived because no non-steward maintainer is yet listed in `MAINTAINERS.md`. The four unresolved questions remain open and may be revisited as additive sub-RFCs without breaking v1 wire compatibility.
- **Postgres reference host advertises `capabilities.production.supported: true`.** Discovery payload gains the `production` block at `examples/hosts/postgres/src/server.ts` with `backpressure.inflightCap` and `retryAfterSeconds` driven from `OPENWOP_MAX_INFLIGHT` + `OPENWOP_RETRY_AFTER_SECONDS`, `retention.minWindowSeconds` driven from `OPENWOP_EVENT_RETENTION_DAYS * 86400`, `debugBundle.truncationMetadata: true`. `retention.testForceExpire: false` — RFC 0009 Q#1 (force-expire endpoint normation) deferred.
- **`INTEROP-MATRIX.md` Postgres row gains `openwop-production`** in the Compatibility profile claim column. Production profile claim column now cites the mechanical verification path (capability advertisement + 11 assertions passing under `OPENWOP_REQUIRE_BEHAVIOR=true`).
- **Behavior-mode pass.** Against pglite-backed Postgres with `OPENWOP_REQUIRE_BEHAVIOR=true` and `--no-file-parallelism`: 11/11 tests pass across `production-backpressure.test.ts` (3), `production-retention-expiry.test.ts` (2), `debug-bundle-truncation.test.ts` (1), `idempotency.test.ts` (2), `idempotencyRetry.test.ts` (3). The backpressure 503 envelope is validated end-to-end (saturation actually fires). The retention-expiry envelope soft-skips per scenario design (no expired-run-id supplied + `testForceExpire: false`). `production-backpressure.test.ts` adds an `Accept: text/event-stream` header to its SSE slot-holders so hosts with content negotiation on `/events` (Postgres) keep the connection open. Coverage row grade B → A− with status `host-pass`.

## [1.0 — additions] — 2026-05-11 — RFC 0009 Draft: production-profile conformance

- **RFC 0009 opened (Draft).** [`RFCS/0009-production-profile-conformance.md`](./RFCS/0009-production-profile-conformance.md) proposes mechanizing `spec/v1/production-profile.md` via a top-level `capabilities.production` block, two new conformance scenarios (`production-backpressure`, `production-retention-expiry`), and `production-profile.md` co-citations on four existing scenarios (`restart-during-run`, `staleClaim`, `debug-bundle-truncation`, `idempotency` + `idempotencyRetry`). Additive — no v1 wire-shape change. 7-day comment window open. Postgres reference host advertisement + INTEROP-MATRIX claim land after `Status: Active`.
- **RFC 0009 same-wave stubs landed.** `schemas/capabilities.schema.json` gains the additive `production` block; `conformance/src/scenarios/production-backpressure.test.ts` + `production-retention-expiry.test.ts` land as capability-shape scenarios with opportunistic envelope assertions; the five existing scenarios from RFC §D add `production-profile.md` docstring citations. `conformance/coverage.md` records the `openwop-production` row (B grade — capability shape + opportunistic envelope checks). `conformance/README.md` scenario count: 92 → 94. Suite passes `openwop:check` 8/8 green. Stubs are revisable during the comment window.

## [1.0 — additions] — 2026-05-11 — Phase-2 partial: RFC promotions + pause/resume race coverage

Status promotions covering the multi-agent + WASM extension RFCs.

- **RFCs 0002–0007 (multi-agent extensions): Active → Accepted.** The
  integration-seams audit closed in Phase 0 (`docs/MULTI-AGENT-INTEGRATION-GAPS.md`
  archived); conformance scenarios pass against the SQLite reference
  host. Schemas + prose are at the v1.x-stable bar.
- **RFC 0008 (WASM ABI): Draft → Active.** Reference Rust pack
  `vendor.openwop.rust-hello@1.0.0` published to `packs.openwop.dev`;
  six WASM conformance scenarios land at capability-gated state
  (`wasm-pack-load.test.ts` et al.). Spec text frozen for v1.x; full
  Accepted promotion requires reference-host implementation of the
  WASM loader, deferred to v1.2+.
- **`pause-resume.test.ts` extended** with three race-coverage tests:
  pause-idempotency, :pause-on-terminal-returns-409, and the :pause-
  during-suspend race (host MUST NOT silently override an active
  interrupt). Total in this file: 5 tests (was 2).
- **`conformance-full.md` refreshed:** 91 files, 661 tests, 576 passing
  (+26 vs pre-review-fix snapshot).

## [1.0 — additions] — 2026-05-11 — Phase-0 reconciliation pass

Reconciliation pass against `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Phase 0. Closes internal doc drift surfaced by the 2026-05-11 deep-dive review. All changes are additive; existing v1.0 conformance passes remain valid.

- **Registry status reconciled.** `ROADMAP.md` post-v1 ecosystem table now reflects `packs.openwop.dev` as live (verified externally; 3 packs published). New public-registry healthcheck at `conformance/src/scenarios/registry-public.test.ts` (opt-in via `OPENWOP_TEST_PUBLIC_REGISTRY=true`). Suite count: 85 → 86.
- **Multi-agent integration audit closed.** `docs/MULTI-AGENT-INTEGRATION-GAPS.md` is now ARCHIVED — every Phase-1-through-6 surface marked closed with landing-path citations. `PROTOCOL-GAP-CLOSURE-PLAN.md` Track 10 acceptance row updated to reflect that RFCs 0002–0007 are eligible for promotion from `Active` to `Accepted`.
- **Capability-gated scenarios: strict mode.** New `OPENWOP_REQUIRE_BEHAVIOR=true` runner flag converts capability-shape-only skips into hard failures for hosts that want to claim full coverage. New helper at `conformance/src/lib/behavior-gate.ts`; `audit-log-integrity.test.ts` adopts it as the worked example. New §"Capability-gated scenarios" in `conformance/coverage.md` documents the 10 scenarios and their behavior-unlock dependencies.
- **ROADMAP v1.X gap-closure rows reconciled.** Tracks 4 (Interrupt profile), 5 (Replay profile), and 6 (MCP/A2A roundtrip) deliverable cells updated to cite the fixtures and conformance scenarios that already shipped, replacing stale "next add X" wording. Track 4 fully closed; Track 5 remaining = retention-expiry scenario; Track 6 remaining = published cross-impl evidence (operator step). No code change; documentation accuracy only.

## [1.0 — additions] — 2026-05-10 — Gap-closure additions to v1.0

Additive landings inside v1.0 (no minor bump per `COMPATIBILITY.md` §2.1). Closes the highest-priority items from the independent deep-dive review and `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Tracks 10 + 13. All changes are additive; existing v1.0 conformance passes remain valid. Multi-agent extension RFCs are now landed at `Active` status; previous RFC numbering (0007–0012) is replaced by the canonical 0002–0007 range. The v1.0 line stays at v1.0 — there is no v1.1.

### Multi-agent extension RFCs (Track 10)

Six normative RFCs landed in [`RFCS/`](./RFCS/) anchoring schemas that previously shipped without binding spec text:

- [**RFC 0002**](./RFCS/0002-agent-identity-and-reasoning-events.md) — `AgentRef` wire shape; `agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, `agent.decided` event semantics; confidence-escalation contract (§F default 0.7); `ConversationMessage` shape (§G).
- [**RFC 0003**](./RFCS/0003-agent-packs.md) — `agents[]` extension to `node-pack-manifest.schema.json`; namespace scoping; tarball-path safety rules.
- [**RFC 0004**](./RFCS/0004-memory-layer.md) — `MemoryAdapter` interface (list / get / put / delete); run-start snapshot determinism rule; SR-1 redaction invariant; TTL semantics.
- [**RFC 0005**](./RFCS/0005-conversation.md) — Generalized one-shot suspend → multi-turn conversation; `kind: 'conversation'` interrupt; `operation: 'start' | 'exchange' | 'close'`; three new run events.
- [**RFC 0006**](./RFCS/0006-orchestrator.md) — `runOrchestrator` field on `RunSnapshot`; CO-1/CO-2/CO-3 ordering invariants; closed decision-kind enum; terminate vs failed vs cancelled state matrix.
- [**RFC 0007**](./RFCS/0007-dispatch.md) — `core.dispatch` reserved typeId; `DispatchConfig` shape; per-kind dispatch semantics; iteration cap; causation chain.

### Spec surface additions (Track 13)

- **`POST /v1/runs/{runId}:pause` and `:resume`** — operator-driven pause distinct from cancel and HITL suspend. `rest-endpoints.md` + `openapi.yaml`. Closes R2 in `rest-endpoints.md`.
- **Normative `429 Too Many Requests` envelope** — `details.retryAfterMs`, `details.scope`, optional `details.limit` / `details.observedRate`. `rest-endpoints.md`.
- **Append-reducer ordering rule** — intra-engine `sequence`-based total order; cross-engine owner-assigned sequence; `(sequence, eventId)` tie-break. `channels-and-reducers.md`.
- **Per-workflow `configurableSchema`** — discoverable per-workflow JSON Schema for `RunOptions.configurable` accepted keys. `run-options.md` + `workflow-definition.schema.json`.
- **Webhook signature-algorithm versioning** — `X-openwop-Signature-Algorithm: v1` header; absence preserves v1.0 behavior. `webhooks.md`.
- **Multi-region idempotency annex** — partition guarantees + deterministic conflict resolution (lower `runId` wins). `idempotency.md`. Closes I1.
- **Audit-log integrity profile (`openwop-audit-log-integrity`)** — append-only storage + hash chain + signed periodic checkpoints + `GET /v1/audit/verify` endpoint. `auth-profiles.md`. RECOMMENDED prerequisite for Track 9 external security review.

### Conformance fixtures (Track 4)

Four interrupt-profile fixtures landed under `conformance/fixtures/`:

- `conformance-interrupt-quorum.json` — `openwop-interrupt-quorum` (multi-approver, majority rejection).
- `conformance-interrupt-external-event.json` — `openwop-interrupt-external-event` (correlation-matched callback).
- `conformance-interrupt-auth-required.json` — `openwop-interrupt-auth-required` (bearer-token resume).
- `conformance-interrupt-parent-child-cancel.json` + `…-child.json` — `openwop-interrupt-parent-child` (cascade cancellation).

### Documentation

- `README.md` — multi-agent table cross-links resolve to landed RFC files; status note updated to reflect Active multi-agent RFCs.
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` — incorporated independent deep-dive findings (Tracks 10–13, Sequencing section).

### Conformance scenarios (Phase-1 follow-up pass)

Stub scenarios for every spec addition above landed under `conformance/src/scenarios/`. All gate on fixture advertisement or capability discovery so v1.0 hosts continue to pass:

- `interrupt-quorum-resolution.test.ts` — quorum accept path + majority-reject termination.
- `interrupt-external-event-correlation.test.ts` — signed-token resume with correlation matching + rejection on mismatch.
- `interrupt-auth-required-resume.test.ts` — bearer-token resume + insufficient-scope rejection (gated on `OPENWOP_TEST_LOW_SCOPE_KEY`).
- `interrupt-parent-child-cascade.test.ts` — parent `:cancel` cascades to child + post-cascade resolve rejected.
- `pause-resume.test.ts` — `:pause` → `paused` → `:resume` → terminal; `:resume` on non-paused returns 409.
- `rate-limit-envelope.test.ts` — 429 envelope shape validation (top-level-key restriction + `details.scope` enum + `Retry-After` consistency).
- `configurable-schema.test.ts` — manifest surfaces `configurableSchema`; mismatched `configurable` rejected with `validation_error`.
- `append-ordering.test.ts` — `channel.written` events emerge in strict sequence order; projected array length matches event count.
- `webhook-sig-algorithm.test.ts` — discovery surfaces `webhooks.signatureAlgorithms` with `"v1"` included.
- `audit-log-integrity.test.ts` — profile claim surfaces capability fields + `/v1/audit/verify` returns `chainValid: true` on unmodified ranges.
- `multi-region-idempotency.test.ts` — `capabilities.idempotency.crossRegion` value in the closed enum `{single-region, best-effort, strict}`.

### Documentation additions (Phase-1 follow-up)

- `spec/v1/agent-ref-positioning.md` — non-normative addendum comparing `AgentRef` to W3C DIDs, A2A `AgentCard`, and AGNTCY agent identity. Includes the canonical translation table (`agentId` recipe + where each source lives in metadata). Closes the Track 10 remainder.
- `spec/v1/auth-profiles.md` — `openwop-auth-oidc-user-bearer` profile for SSO/OIDC user-bearer auth (distinct from the existing client-credentials profile, which is service-to-service).

### Capability discovery additions (Phase-1 follow-up, 2026-05-10)

`spec/v1/capabilities.md` adds normative blocks for every post-launch v1.0 capability shape introduced above so clients can discover them through the canonical `/.well-known/openwop` handshake:

- `orchestrator` (RFC 0006) — `supported`, `workerIdInterpretation`, `fanOutSupported`.
- `dispatch` (RFC 0007) — `supported`, `models`, `fanOutSupported`, `askUserRoutings`.
- `memory` (RFC 0004) — `supported`, `maxEntrySizeBytes`, `ttlSupported`.
- `runs.pauseResume` — `supported`, `drainPolicies`.
- `idempotency.crossRegion` — closed enum `{single-region, best-effort, strict}`.
- `webhooks.signatureAlgorithms` — array; MUST include `"v1"` when surfaced.
- `auth.profiles`, `auth.auditLogIntegrity`, `auth.oidc` — extension under the existing auth block.

### Observability additions

`spec/v1/observability.md` extends the OTel namespace with metrics that pair with the new spec surfaces:

- **Queue / backlog metrics** — `openwop.queue.depth` (gauge), `openwop.run.backlog` (histogram), `openwop.queue.enqueued` (counter). REQUIRED for hosts claiming the `production` scale tier.
- **Orchestrator decision metrics** (RFC 0006) — `openwop.orchestrator.decisions` (partitioned by decision kind), `openwop.orchestrator.iterations`.
- **Multi-region idempotency metrics** — `openwop.idempotency.cross_region_conflicts_total`, `openwop.idempotency.partition_seconds`.

### RFC 0008 — WASM ABI (Draft)

[`RFCS/0008-wasm-abi.md`](./RFCS/0008-wasm-abi.md) drafts the WebAssembly ABI that `language: wasm` node packs implement, enabling cross-language packs (Rust, Zig, AssemblyScript, TinyGo, etc.) to load portably across any OpenWOP host with a WASM runtime. Specifies required exports (`openwop_abi_version`, `openwop_node_invoke`, …), required imports (`openwop_channel_read`, `openwop_interrupt`, `openwop_now_ms`, …), memory ownership rules, JSON envelope shapes, replay-determinism constraints, capability advertisement, signing, and per-invocation resource limits. Status `Draft` pending implementation prototype; promotion to `Active` gated on a working reference Rust pack.

### Conformance tracker updates

`conformance/coverage.md` adds 8 new rows for the post-launch v1.0 surfaces (pause/resume, rate-limit envelope, configurableSchema, append-ordering, webhook sig-algo, audit-log integrity, multi-region idempotency, interrupt profile cluster) and marks the interrupt-profile gap closure item ✅ done. New P1/P2 gap items track follow-up work (deterministic 429 induction, tamper-detection scenario, cross-engine append-ordering, end-to-end webhook signed-delivery, RFC-citing scenario descriptions).

### Deferred-work pass (2026-05-10)

Implementations landed against the approved gap-closure plan at `~/.claude/plans/compressed-snacking-summit.md`:

- **Phase 2.1 — OTel verification harness.** `conformance/src/lib/otel-collector.ts` (in-process OTLP/HTTP-JSON receiver, no `@opentelemetry/*` deps) + `otel-emission.test.ts` + `otel-trace-propagation.test.ts`. Opt-in via `OPENWOP_OTEL_COLLECTOR=true`; operator points the host at the printed endpoint with `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`.
- **Phase 2.2 — MCP synthetic-peer roundtrip.** `conformance/src/lib/mcp-fake-server.ts` (HTTP+JSON-RPC `initialize` / `tools/list` / `tools/call`) + `mcp-tool-roundtrip.test.ts` + `conformance-mcp-tool-roundtrip.json` fixture. Opt-in via `OPENWOP_MCP_FAKE_SERVER=true`.
- **Phase 2.3 — A2A synthetic-peer roundtrip.** `conformance/src/lib/a2a-fake-peer.ts` (AgentCard + Task lifecycle with state-override) + `a2a-task-roundtrip.test.ts` + `conformance-a2a-task-roundtrip.json` fixture. Exercises documented drift points #3 (`AUTH_REQUIRED → waiting-input`) and #4 (`REJECTED → failed`). Opt-in via `OPENWOP_A2A_FAKE_PEER=true`.
- **Phase 3.1 — Python reference host.** `examples/hosts/python/` (~600 LOC Python 3.11 stdlib-only port of the TS in-memory host). Boots, loads 42 fixtures, runs `core.noop` + `core.delay` end-to-end. Third row added to `INTEROP-MATRIX.md`. First cross-language portability proof.
- **Phase 1.2 — External security review engagement.** `SECURITY/external-audit-engagement.md` drafted (scope, vendor selection criteria, deliverable shape, budget range, status tracker). `SECURITY.md` §9 now links it.
- **Phase 4.1 — `packs.openwop.dev` registry MVP.**
  - **Directory tree** at `registry/` with the four normative endpoint shapes from `node-packs.md` §"Registry HTTP API" + `registry-operations.md`: `.well-known/openwop-registry.json`, `v1/index.json`, `v1/packs/{name}/index.json`, `v1/packs/{name}/-/{version}.{json,tgz,sig}`, `keys/{keyId}.pub`.
  - **Firebase multi-target hosting**: `firebase.json` converted to array-form `hosting:` with two targets — `docs` (preserves existing `public/` → `openwop.dev`) and `packs` (new `registry/` → `packs.openwop.dev`). `.firebaserc` adds the target → site mapping. Rewrites map extensionless URLs `/v1/packs/{name}` and `/.well-known/openwop-registry` to their `.json` files. Per-path cache headers: `*.tgz`/`*.sig` immutable + 1yr, `*.json` 5min + must-revalidate.
  - **Scripts** (Node 20 stdlib only): `registry/scripts/build-index.mjs` recomputes per-pack `index.json` + registry-wide `v1/index.json` from on-disk packs, recomputes sha256 `integrity` from actual `.tgz` bytes, supports `--check` mode. `registry/scripts/serve.mjs` mirrors Firebase rewrites for local development.
  - **CI publish workflow** at `.github/workflows/registry-publish.yml`: validates JSON parsing + `build-index --check` cleanliness + tarball signature presence + sha256 integrity match. Push to `main` deploys via `FirebaseExtended/action-hosting-deploy` to the `packs` target.
  - **Seed entry**: `vendor.openwop.rust-hello@1.0.0` — built (28 KiB stripped wasm32 binary), bundled, Ed25519-signed against the root key, committed (`1.0.0.tgz` + `1.0.0.sig` in the registry tree).
  - **Inaugural deploy verified end-to-end** on `https://packs-openwop-dev.web.app`: discovery → registry index → pack metadata → version manifest → tarball (sha256 matches manifest integrity) → signature (64 bytes Ed25519) → public key → **cryptographic verify with downloaded key + signature returns OK ✓**. The trust chain is the same path a `verified`-mode host would execute.
  - **Discovery-driven URL templates**: Firebase Hosting's `:param` rewrite matcher can't match path segments containing dots (reverse-DNS pack names), so `packMetadata` is served at `/v1/packs/{name}/index.json`. The discovery doc (`endpoints` block) is authoritative; clients SHOULD substitute into the declared templates rather than hardcoding `/v1/packs/{name}`. `spec/v1/node-packs.md` §"Registry HTTP API" gained a non-normative note explaining the alias rule for filesystem-backed registries.
  - **Operator actions completed during this pass**: site provisioning (`firebase hosting:sites:create packs-openwop-dev` + `firebase target:apply hosting packs packs-openwop-dev`), Ed25519 root-key ceremony (private key offline at `~/.openwop-private-keys/`, public key committed at `registry/keys/openwop-registry-root.pub`, fingerprint `206762...b566b4c9`), Rust toolchain install (rustup stable + `wasm32-unknown-unknown`), pack build, tarball + signing, registry index rebuild, deploy.
  - **Custom domain live**: `packs.openwop.dev` wired to `packs-openwop-dev` via Firebase Console (custom-domain flow) + GoDaddy DNS (`A 199.36.158.100` + `TXT hosting-site=packs-openwop-dev` on the `packs` label, old CNAME removed). TLS cert provisioned. End-to-end trust chain verified at the public URL.
  - **Pack catalog expansion (selective publication by security tier).** Architectural decision: the dead schema-`$id` URLs across 8 unpublished packs were not a "missing mirror" problem — they were a symptom of unpublished packs. Solution: collapse "publish pack" + "expose its schemas" into a single operation via a build-time derived schema mirror.
    - **`build-index.mjs` extended** to extract `schemas/*.json` from each signed tarball into `registry/{name}/{version}/<schema>.json` at publish time. Tarball is single source of truth; mirror is automated derived view; cannot drift.
    - **Published this round (low-stakes only)**: `core.openwop.examples@1.0.0` (3 nodes: echo, coin-flip, delay-with-progress) and `community.openwop-team.demo@0.1.0` (1 node: uppercase). Both pure transforms, no I/O, no secrets, no external APIs.
    - **Deferred (high-stakes, audit-gated)**: `core.openwop.ai`, `core.openwop.http`, `core.openwop.mcp`, `core.openwop.triggers`. Added to `SECURITY/external-audit-engagement.md` §2.1 as REQUIRED audit scope before publication — each touches BYOK secrets, external APIs, MCP trust boundary, or webhook signing. Publishing as immutable URLs without audit was rejected.
    - **Deferred (spec-incomplete)**: `core.openwop.agent-examples` (`runtime: remote`) — defer until v1.2+ sharpens the remote-pack contract.
    - **Spec addition**: `spec/v1/node-packs.md` §"Schema `$id` resolution" — source-of-truth contract (tarball canonical, mirror derived), mirror lifecycle (only for packs present in registry; never for unpublished or yanked), and an implementer note explaining the derived-mirror pattern.
    - **Live state after this pass**: registry index lists 3 packs; 12 schema mirror files served at `/{name}/{version}/<schema>.json`; both new packs cryptographically verify end-to-end against the published root public key.
  - **Landing page at registry root.** Followed the derive-from-source-of-truth pattern: `build-index.mjs` now emits `registry/index.html` from the same `docs` array that drives `v1/index.json`. The HTML view of the catalog can't drift from the JSON view by construction. Properties: zero JavaScript, inline CSS only, system font stack (no third-party font loads), HTML-escaped author-controlled strings, `prefers-color-scheme: dark` support, full OG + Twitter Card meta for shareable unfurls. `robots.txt` allows the landing page but disallows `/v1/`, `/keys/`, and `/.well-known/` so search engines don't clutter SERPs with JSON files. Replaces the previous Firebase "Page Not Found" at `/` — `https://packs.openwop.dev/` now returns a 200 HTML response with the live catalog, trust + verification recipe, API endpoint list, publish flow, and namespace policy.
- **Phase 3.2 — WASM loader + reference Rust pack.**
  - **Loader** (`examples/hosts/in-memory/src/wasm-loader.ts`): uses Node 20's built-in `WebAssembly` global; zero new npm deps. Implements RFC 0008 §C imports (channel I/O, variables, interrupts, deterministic time + entropy, logging) and bridges them to host run state. Detects packed-i64 vs multi-value returns at runtime.
  - **Reference pack** (`examples/packs/rust-hello/`): Rust 2021 `crate-type = ["cdylib"]` targeting `wasm32-unknown-unknown`. Exports the seven required ABI functions; one node typeId `vendor.openwop.rust-hello.greet`. Hand-rolled JSON extraction (no serde dep) keeps the stripped binary ~5–10 KiB. Uses packed-i64 returns per RFC 0008 §B amendment.
  - **RFC amendment**: RFC 0008 §B now explicitly allows packed-i64 (`low 32 = ptr, high 32 = len`) as an alternative to native multi-value returns, since stable Rust on `wasm32-unknown-unknown` does not emit multi-value by default. Loaders MUST support both encodings.
  - **Pack registry in the host**: at startup, the in-memory host scans `examples/packs/*/pack.json` and loads any pack whose `runtime.language === "wasm"`. The dispatch switch routes unknown typeIds through the loaded pack registry before failing.
  - **Conformance scenarios** (six per RFC 0008 §Conformance): `wasm-pack-load.test.ts`, `wasm-pack-invoke-completed.test.ts`, `wasm-pack-invoke-suspended.test.ts`, `wasm-pack-replay-determinism.test.ts`, `wasm-pack-memory-cap.test.ts`, `wasm-pack-abi-version-rejection.test.ts`. All gate on `capabilities.nodePackRuntimes.wasm.supported`.
  - **Fixture**: `conformance/fixtures/conformance-wasm-pack-roundtrip.json`.

### Compatibility

All additions are **additive** per `COMPATIBILITY.md` §2.1. Existing v1.0 conformance passes remain valid. New surfaces are gated on capability advertisement (where appropriate) or are optional schema fields.

---

## [1.0] — 2026-05-08 — openwop v1 FINAL

The v1 protocol contract is locked. The spec corpus, schemas, API definitions, reference SDKs, and conformance suite all ship at v1. This release includes the complete Multi-Agent Shift (Phases 1-6).

### What's locked

- **Prose specs** — 26 docs at `Status: FINAL v1`: `auth.md`, `capabilities.md`, `channels-and-reducers.md`, `idempotency.md`, `interrupt.md`, `node-packs.md`, `observability.md`, `replay.md`, `rest-endpoints.md`, `run-options.md`, `stream-modes.md`, `version-negotiation.md`, `profiles.md`, `scale-profiles.md`, `debug-bundle.md`, `host-extensions.md`, `a2a-integration.md`, `mcp-integration.md`, and the v1 profile/addendum docs.
- **JSON Schemas** — 17 first-class schemas including agent-ref, agent-manifest, memory-entry, memory-list-options, conversation-turn, conversation-event, and dispatch-config schemas
- **API definitions** — OpenAPI 3.1 (`api/openapi.yaml`) + AsyncAPI 3.1 (`api/asyncapi.yaml`)
- **Reference SDKs at 1.0** — `@openwop/openwop` (TypeScript), `openwop-client` (Python), `openwopclient` (Go)
- **Conformance suite at 1.0** — `@openwop/openwop-conformance`
- **CI gating** — `scripts/openwop-check.sh` + `.github/workflows/openwop-spec.yml`
- **Governance** — `CONTRIBUTING.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `COMPATIBILITY.md`, `SECURITY.md`

### Multi-Agent Shift (Phases 1-6)

- **Phase 1 (RFC 0002)** — Agent identity (`AgentRef`), agent reasoning + tool + handoff event family, confidence-escalation contract, `message` reducer
- **Phase 2 (RFC 0003)** — Agent capability discovery on `/.well-known/openwop` + `pack.json` `agents[]` extension
- **Phase 3 (RFC 0004)** — Agent memory layer — `memoryRef` resolution, redaction guarantees, host `MemoryAdapter` contract
- **Phase 4 (RFC 0005)** — Conversation as run primitive — `conversation.start` / `conversation.exchange` / `conversation.close`
- **Phase 5 (RFC 0006)** — Orchestrator-supervisor role — `core.orchestrator.supervisor` node type
- **Phase 6 (RFC 0007)** — `core.dispatch` core node — conservative dynamic graph mutation

### Domain and package naming

- Canonical domain: `openwop.dev`
- Registry: `packs.openwop.dev`
- Package names: `@openwop/openwop`, `@openwop/openwop-conformance`, `openwop-client`, `openwopclient`
