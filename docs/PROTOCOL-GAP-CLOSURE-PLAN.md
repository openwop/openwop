# OpenWOP Protocol Gap Closure Plan

> **Status: archived — v1.0 release reached 2026-05-12; v1.1.0 close-out shipped 2026-05-13.** This document is preserved for traceability. Every controllable track is closed; the residual items are external-action items (vendor-neutral org migration, external security review engagement) tripwire-gated per `ROADMAP.md`. Last reviewed: 2026-05-13.

This document turned the protocol deep-dive review into implementation tracks. It is intentionally operational: each gap has an artifact to change, a compatibility rule, and a concrete acceptance signal. The track-status table below summarizes the closure verdict; each track's section below preserves the original work + acceptance criteria for historical reference.

## Archive status (2026-05-13)

| #   | Track                                 | Status                          | Closure evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Spec Hygiene                          | ✅ **CLOSED**                   | All 23 acceptance checkboxes met. CI-gated by `spec-corpus-validity.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | Capability Handshake Hardening        | ✅ **CLOSED**                   | `capabilities-change-detection.md` annex landed; RFC 0011 §A auth-scoped discovery verified end-to-end on SQLite + Postgres hosts (Phase I.5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | Auth Profile                          | ✅ **CLOSED**                   | `auth-profiles.md` shipped; API-key rotation + OAuth2-CC + OIDC user-bearer verified end-to-end on Postgres host (Phase I.3, I.4, I.6). mTLS profile is spec-FINAL; reverse-proxy deployment pattern documented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4   | Interrupt Profile                     | ✅ **CLOSED**                   | 4 fixtures (quorum / external-event / auth-required / parent-child-cancel) + matching conformance scenarios shipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | Replay and Determinism                | ✅ **CLOSED**                   | `replay.md` retention + privacy + scoring sections shipped; arbitrary-event fork + deterministic replay scenarios pass. LLM cache-key recipe at `replay.md` §"LLM cache-key recipe" §A–§E; placeholder scenario `replay-llm-cache-key.test.ts` at `it.todo()` until first LLM-calling reference-host node lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6   | MCP and A2A Proof                     | ✅ **CLOSED**                   | Phase F real-impl interop closed 2026-05-12 (commits `8a53126` MCP + `57f7871` A2A 0.3). Synthetic fakes + real-impl env vars + INTEROP-MATRIX "Composition partners" row all landed. **Server-side composition closed 2026-05-17 via RFC 0020 + commit `327cbc6`:** `apps/workflow-engine` now mounts an MCP server at `POST /v1/host/sample/mcp` (env-gated on `OPENWOP_MCP_SERVER_ENABLED=true`); all 6 `mcp-server-*.test.ts` conformance scenarios graduated from `it.todo()` to behavioral with 13/13 assertions passing.                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | Node-Pack Registry MVP                | 🟢 **CONTROLLABLE HALF CLOSED** | Registry live at `packs.openwop.dev` with TLS; 3+ packs published with Ed25519 chains verified; WASM ABI RFC 0008 Active; Component-Model annex Active; reference Rust pack + Wasmtime-free loader + 6 conformance scenarios + memory-bomb misbehaving pack + ABI-mismatch misbehaving pack all shipped; lockfile spec at `node-packs.md` §"Dependency resolution + lockfile"; workspace lockfile demo at `examples/core-packs-lockfile/` (commit `daeaef5`) pinning all 4 audit-gated packs to v1.0.0 with SRI + Ed25519; the 4 `core.openwop.{ai,http,mcp,triggers}` packs are **built + signed + lockfile-resolvable in-tree** (Phase E controllable half — `registry/v1/packs/core.openwop.<name>/-/1.0.0.{tgz,sig,json,sbom.json}`). **Remaining (external-blocked):** public publication of the 4 high-stakes packs to `packs.openwop.dev` gated on external security audit per `SECURITY/external-audit-engagement.md` §2.1. |
| 8   | Production Profile                    | ✅ **CLOSED**                   | `production-profile.md` (RFC 0009) + `scale-profiles.md` shipped; Postgres reference host claims + verifies via `production-backpressure.test.ts` + `production-retention-expiry.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 9   | Governance and Interop Evidence       | 🟡 **EXTERNAL-BLOCKED**         | Phase 3 deliverables all ready: 5 per-vendor external-audit outreach drafts at `SECURITY/outreach/external-audit/`, 4-tier non-steward-host recruitment at `docs/recruitment/external-host.md`, pack-author recruitment at `docs/recruitment/external-pack-author.md`. Hosted leaderboard at `site/` rebuilds cleanly. **Bottleneck:** out-of-band outreach + non-steward maintainer tripwire (tracked in `ROADMAP.md` Phase 4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 10  | Multi-Agent Spec Closure              | ✅ **CLOSED**                   | RFCs 0002–0007 at `Accepted` status; AgentRef positioning addendum landed; conformance scenarios cite RFCs in docstrings. Integration-seams audit reconciled (`docs/MULTI-AGENT-INTEGRATION-GAPS.md` archived).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | Observability Verification Harness    | ✅ **CLOSED**                   | OTLP/HTTP-JSON + OTLP/HTTP-protobuf + **OTLP/gRPC** encodings landed (commit `2a1658b` — h2c HTTP/2 + hand-rolled framing at `conformance/src/lib/grpc-framing.ts`, zero new npm deps); `otel-emission.test.ts` + `metric-emission.test.ts` + `otel-trace-propagation.test.ts` + `otel-emission-grpc.test.ts` pass against reference hosts under `--no-file-parallelism`; `capabilities.observability.otel.transports[]` declares the supported wire encodings; `openwop.cost.*` + `openwop.queue.depth` + `openwop.run.backlog` + `openwop.run.duration` normated.                                                                                                                                                                                                                                                                                                                                                                 |
| 12  | SDK Parity and Non-TS Reference Host  | ✅ **CLOSED**                   | `sdk/PARITY.md` matrix shipped; Python reference host verified end-to-end with public conformance result (100% of applicable tests); `PUBLISHING.md` documents the cadence rule. **Deferred:** 4th-language SDK (Rust most likely) — demand-gated, not a normative acceptance criterion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 13  | Spec Surface Additions (Post-v1 Gaps) | ✅ **CLOSED**                   | All 7 acceptance items checked: pause/resume + 429 envelope + multi-region idempotency + append-reducer ordering + `configurableSchema` field + webhook sig-algorithm version + audit-log integrity annex. Conformance scenarios all shipped + capability-gated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Out-of-scope items that DID land (originally deferred per the "Out-of-scope for now" footer)

- ✅ **i18n / locale handling** — landed at `spec/v1/i18n.md` (FINAL v1) + `capabilities.i18n` block + interrupt `locale` field.
- ✅ **Compliance vocabulary** — landed at `spec/v1/compliance.md` (FINAL, non-normative — SOC 2 / GDPR / HIPAA / ISO 27001 mapping).
- ✅ **Bug-bounty program** — landed at `SECURITY/bug-bounty.md` (annex; activation tracked behind the maintainer tripwire).
- ✅ **CNA registration** — landed at `SECURITY/cna.md` (annex; engagement-letter step deferred to the external-audit closure).
- ✅ **Workspace pack lockfile demo** — landed at `examples/core-packs-lockfile/` (commit `daeaef5`, 2026-05-13): air-gapped resolver-and-verify proof for the 4 audit-gated core packs at v1.0.0, validating `schemas/pack-lockfile.schema.json` with SRI integrity hashes + raw Ed25519 signature material.
- ✅ **`capabilities.nodePackRuntimes` schema declaration** — formalized at `schemas/capabilities.schema.json` (commit `09e28fd`, 2026-05-12): strict-mode validators now enforce the shape of `wasm.{supported,abiVersions[],maxMemoryBytes,loadedPacks[]}` + the `wasmComponent` reservation.

### Closure verdict

12 of 13 tracks fully closed; 1 closed on the controllable half (Track 7: 4 high-stakes core packs are built + signed + lockfile-pinned in-tree; only public publication to `packs.openwop.dev` awaits the external security audit). 0 tracks open without a documented external trigger. The protocol is **shipped at v1.1.0** (2026-05-13 release: npm `@openwop/openwop@1.1.0`, npm `@openwop/openwop-conformance@1.1.0`, PyPI `openwop-client@1.1.0`, Go `sdk/go@v1.1.0`).

The phased-delivery details below are preserved in their original 2026-05-10 form for historical traceability. Each track's `Acceptance` block has the closure checkpoints inline; this archive header is the at-a-glance index.

---

## Principles

1. **Do not break v1.** Existing `v1` REST, SSE, schema, and conformance behavior remains valid. New work ships as optional profiles, conformance-suite minors, or clarifying annexes.
2. **Prefer proof over promise.** A feature is not considered closed until it has at least one of: schema coverage, OpenAPI/AsyncAPI coverage, conformance coverage, or public interop evidence.
3. **Keep OpenWOP a protocol.** Runtime internals, queue implementations, storage engines, model SDKs, and UI behavior remain host choices unless the wire contract needs a portable guarantee.
4. **Composition beats duplication.** MCP owns tool/resource/prompt exposure. A2A owns inter-agent task exchange. Temporal, Step Functions, Argo, Airflow, and BPMN remain implementation or integration targets, not things OpenWOP should replace.

## Grade Summary

| Area                                    |          Grade | Closure target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | -------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REST + SSE wire contract                |             A- | Endpoint coverage manifest and stale prose cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Machine-readable artifacts              |             A- | Keep schemas, OpenAPI, AsyncAPI, and prose synchronized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Conformance suite                       |             A- | Expand optional-profile and operation coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Run lifecycle / replay / idempotency    |             B+ | Replay profile hardening and multi-region idempotency guidance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| HITL / interrupts                       |             B+ | Quorum, external-event, parent/child cancellation, and auth-required profile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Auth / security                         |              B | OAuth2, key rotation, optional mTLS, external review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Node packs / registry                   |     A (was A−) | ✅ WASM ABI `RFCS/0008-wasm-abi.md`; ✅ reference Rust pack at `examples/packs/rust-hello/` built + signed (28 KiB wasm32); ✅ Wasmtime-free loader at `examples/hosts/in-memory/src/wasm-loader.ts`; ✅ six conformance scenarios; ✅ registry MVP **live at `https://packs.openwop.dev`** with TLS cert provisioned; ✅ end-to-end cryptographic trust chain verified (discovery → manifest → tarball → signature → Ed25519 verify OK); ✅ 3 packs published (`vendor.openwop.rust-hello`, `core.openwop.examples`, `community.openwop-team.demo`) — selective publication by security tier; ✅ derived schema mirror at `/{name}/{version}/<schema>.json` (12 schemas live, tarball source-of-truth). Remaining: 4 high-stakes `core.openwop.{ai,http,mcp,triggers}` packs gated on external audit (added to `SECURITY/external-audit-engagement.md` §2.1 scope); `core.openwop.agent-examples` (`runtime: remote`); lockfile semantics; ✅ deliberately-misbehaving packs for memory-cap + ABI-mismatch positive paths — `examples/packs/rust-misbehaving-memory/` allocates 1 GiB beyond `memoryPagesMax` (drives `wasm-pack-memory-cap.test.ts` via in-memory loader's `memory.grow` probe + `capBreached.kind` schema extension); `examples/packs/rust-misbehaving-abi/` declares ABI 999 (drives `wasm-pack-abi-version-rejection.test.ts` via new `capabilities.nodePackRuntimes.wasm.loadedPacks[]` discovery field — rejected packs are omitted). Both fixture-only (NOT signed for registry publication). |
| MCP / A2A composition                   |              B | Roundtrip conformance fixtures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Scale / production operations           |             C+ | Production profile for queueing, retention, retries, backpressure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Governance / ecosystem                  |             C+ | Public leaderboard and non-steward implementation evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Multi-agent extensions (RFCs 0002–0007) |  ✅ B (was D+) | Six RFCs landed at `Active` 2026-05-10; promote to `Accepted` once conformance scenarios + reference-host implementation ship.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Observability verification              |  ✅ A (was B−) | ✅ `openwop.cost.*`; queue-depth / backlog / orchestrator-decision / cross-region idempotency metrics landed 2026-05-10. ✅ OTel-emission harness landed (`conformance/src/lib/otel-collector.ts`); ✅ OTLP/gRPC transport landed at commit `2a1658b` (`conformance/src/lib/grpc-framing.ts`, zero new npm deps).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SDK breadth / cross-language hosts      | ✅ A− (was C+) | ✅ Python reference host at `examples/hosts/python/` (~600 LOC stdlib-only) — 100% of applicable scenarios pass. ✅ `sdk/PARITY.md` matrix shipped; ✅ all 3 published SDKs at v1.1.0. Rust SDK demand-gated, not v1.x-blocking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Spec surface additions (post-v1 gaps)   | ✅ A− (was B−) | Landed 2026-05-10/11/12: `pause`/`resume`, normative `429` envelope, multi-region idempotency annex, `append` ordering, `configurableSchema`, webhook sig-algo versioning, audit-log integrity profile, ✅ OIDC user-bearer profile (Phase I.4 — `auth-oidc-user-bearer.test.ts` + synthetic issuer harness at `conformance/src/lib/oidc-issuer.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Track 1: Spec Hygiene

**Goal:** eliminate stale point-in-time language and make the public corpus internally consistent.

**Work:**

- Replace “future,” “forthcoming,” and old implementation-plan references when the schema/spec already landed.
- Keep `README.md`, `ROADMAP.md`, `spec/v1/*.md`, and `schemas/*.schema.json` counts and status language aligned.
- Maintain a short stale-reference scan in release checks.

**Acceptance:**

- No stale references to shipped surfaces such as replay/fork, `interrupt.md`, `observability.md`, or capability optional fields.
- Markdown link check passes.
- `bash scripts/openwop-check.sh` passes.
- ✅ OpenAPI operation IDs are checked against `conformance/coverage.md` in the server-free corpus suite.
- ✅ README document-index count and `spec/v1/*.md` links are checked against the filesystem in the server-free corpus suite.
- ✅ Local Markdown file links are checked across the repo in the server-free corpus suite.
- ✅ `schemas/README.md` is checked against every `schemas/*.schema.json` file in the server-free corpus suite.
- ✅ AsyncAPI named persisted-event messages are checked against `schemas/run-event.schema.json` `RunEventType` values, with documented synthetic stream events excluded.
- ✅ JSON Schema `$id` values and absolute `$ref`s are checked against canonical `https://openwop.dev/spec/v1/*.schema.json` identifiers in the server-free corpus suite.
- ✅ OpenAPI operation IDs are checked for uniqueness and every operation tag must be declared in the top-level tag list.
- ✅ AsyncAPI operation channel references, channel keys, and message names are checked for internal consistency.
- ✅ `conformance/README.md` scenario-file counts are checked against `conformance/src/scenarios/*.test.ts`.
- ✅ `run-event-payloads.schema.json` is checked against `run-event.schema.json` so every `RunEventType` has exactly one indexed payload schema.
- ✅ OpenAPI security overrides and REST endpoint catalog method/path/auth/scope rows are checked for agreement.
- ✅ Protected OpenAPI operations are checked for canonical `401` and `403` auth failure responses.
- ✅ Typed OpenAPI error specializations compose the canonical `ErrorEnvelope` and keep metadata under `details`.
- ✅ REST/auth/idempotency prose and high-concurrency conformance assertions use `details.*` for retry/conflict metadata.
- ✅ TypeScript SDK exposes separate `HTTP_ERROR_CODES` / `isHttpErrorCode` helpers for canonical REST error-envelope codes.
- ✅ Python and Go SDKs expose matching canonical HTTP error-code helpers, guarded by the server-free corpus suite.
- ✅ SDK READMEs document the HTTP error-code helper surface and canonical `details.*` metadata convention.
- ✅ SDK changelogs mention the HTTP error-code helper surface, guarded alongside README docs.
- ✅ TypeScript SDK `dist` artifacts are rebuilt and checked for HTTP error helper exports plus openwop package branding.

## Track 2: Capability Handshake Hardening

**Goal:** make `/.well-known/openwop` a dependable negotiation surface for clients and conformance tools.

**Work:**

- ✅ Specify `Capabilities-Etag` or an equivalent cache validator for capability changes in `spec/v1/capabilities-change-detection.md`.
- ✅ Define how authenticated clients discover per-tenant capability deltas without leaking private features through the public unauthenticated document.
- ✅ Add non-HTTP composition guidance for MCP and A2A discovery.

**Acceptance:**

- ✅ `capabilities.md` links the change-detection annex.
- ✅ Discovery conformance covers base public shape, optional profile shape, and optional capability-change headers.
- ✅ Auth-scoped discovery variants — `discovery-auth-scoped.test.ts` verifies a second principal receives a STRICT subset on Postgres host (RFC 0011 §A, Phase I.5).

## Track 3: Auth Profile

**Goal:** close the gap between basic API-key auth and production identity expectations.

**Work:**

- ✅ Add an optional OAuth2 client-credentials profile in `spec/v1/auth-profiles.md`.
- ✅ Specify API-key rotation/grace-period semantics.
- ✅ Add optional mTLS deployment profile.
- ✅ Clarify webhook HMAC relationship to `webhooks.md` in `SECURITY/threat-model-auth-profiles.md`.

**Acceptance:**

- ✅ New auth profile doc.
- ✅ Threat model updated for rotation and token exchange failure modes.
- ✅ Conformance profile tests gated on advertised auth capabilities — `auth-api-key-rotation.test.ts`, `auth-oauth2-client-credentials.test.ts`, `auth-oidc-user-bearer.test.ts`, `auth-mtls.test.ts` (opt-in via `OPENWOP_TEST_MTLS=1`).

## Track 4: Interrupt Profile

**Goal:** make HITL behavior portable beyond single approval/clarification flows.

**Work:**

- Specify multi-approver quorum behavior and partial vote event semantics.
- Specify parent/child cancellation behavior for sub-workflow interrupts.
- Specify exact external-event correlation matching.
- Add `auth-required` as a profile-level interrupt kind for A2A composition.

**Acceptance:**

- ✅ Fixture workflows for quorum, external-event, auth-required, and parent/child-cancel flows landed under `conformance/fixtures/conformance-interrupt-*.json` (2026-05-10).
- ✅ Conformance scenarios landed: `interrupt-quorum-resolution.test.ts`, `interrupt-external-event-correlation.test.ts`, `interrupt-auth-required-resume.test.ts`, `interrupt-parent-child-cascade.test.ts`. Profile gating: each scenario skips when the corresponding fixture is not advertised.

## Track 5: Replay And Determinism

**Goal:** make replay useful for production debugging, not only happy-path fork tests.

**Work:**

- ✅ Add fork-from-arbitrary-event coverage (`conformance/src/scenarios/replay-fork-arbitrary.test.ts`).
- ✅ Define replay retention and garbage-collection policy hooks in `spec/v1/replay.md`.
- ✅ Define privacy rules for replaying cached LLM/provider responses that may contain later-deleted sensitive data.
- ✅ Add determinism scoring for repeated replay.

**Acceptance:**

- ✅ `replay.md` includes retention, privacy, and scoring sections.
- ✅ Conformance includes arbitrary-event fork and deterministic replay scenarios (mid-fromSeq terminal + mid-fromSeq replay-mode determinism + mid-fromSeq branch-mode terminal with empty overlay).
- ✅ LLM cache-key recipe normated at `spec/v1/replay.md` §"LLM cache-key recipe" (§A cache-relevant fields, §B RFC 8785 JCS + SHA-256 + lowercase hex construction, §C layering with `idempotency.md` Layer 2, §D cross-host determinism invariant, §E migration). Placeholder scenario `conformance/src/scenarios/replay-llm-cache-key.test.ts` landed at `it.todo()` per §D — assertions activate when the first reference host implements LLM-calling nodes (today both reference hosts execute deterministic-noop fixtures only).

## Track 6: MCP And A2A Proof

**Goal:** move integration docs from plausible composition to executable interop.

**Work:**

- ✅ Add `mcp-tool-roundtrip.test.ts` using a synthetic MCP server.
- ✅ Add `a2a-task-roundtrip.test.ts` using a synthetic A2A peer.
- ✅ Real-impl interop env vars landed 2026-05-11 (Phase 3 T3.4): `OPENWOP_MCP_REAL_SERVER_URL` + `OPENWOP_A2A_REAL_PEER_URL` switch the wire-shape probes from the in-process fakes to real reference implementations. Synthetic-peer drift-point subtests stay fake-only since real peers don't expose state-forcing APIs. **Wire-shape scope (MCP) — fully closed 2026-05-13:** the probe handles all three MCP transports end-to-end. `application/json` single-JSON streamable-http verified 2026-05-12 against `@modelcontextprotocol/sdk@1.29.0` `enableJsonResponse: true`. `text/event-stream` SSE-streamed responses verified 2026-05-13 against the same SDK without `enableJsonResponse` (probe's existing `readSseUntilId` correlates frames by JSON-RPC id). Stdio transport — HTTP-incompatible by design — exercised via the bundled HTTP-to-stdio bridge at `examples/mcp-stdio-bridge/` (probe → bridge → `echo-stdio-server.mjs`, 2/2 pass). The honest framing in `spec/v1/mcp-integration.md` §"Conformance + interop" + the Composition partners row in `INTEROP-MATRIX.md` now reflect this.
- ✅ `metadata.openwop.*` projection shape canonicalized in `a2a-integration.md` §"State projection (reverse)" + the four drift-point assertions in `a2a-task-roundtrip.test.ts`.
- ✅ Real-impl interop closed 2026-05-12 (commits `8a53126` MCP + `57f7871` A2A 0.3): probe extensions wired against `@modelcontextprotocol/server-everything` + the A2A 0.3 JSON-RPC reference. `INTEROP-MATRIX.md` §"Composition partners" carries the resulting rows.
- ✅ **Server-side MCP composition closed 2026-05-17** (RFC 0020 + commit `327cbc6`): the `apps/workflow-engine` reference host mounts an MCP server at `POST /v1/host/sample/mcp` (env-gated on `OPENWOP_MCP_SERVER_ENABLED=true`, OFF by default). JSON-RPC over streamable-HTTP per RFC 0020 §A point 1; supports `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, `sampling/createMessage` (bridge to `ctx.callAI`), `elicitation/create` (bridge to `ctx.suspend`). Ajv2020 validates `tools/call.arguments` against per-tool `inputSchema` BEFORE workflow start (`mcp-server-untrusted-args` invariant). All 6 `mcp-server-*.test.ts` conformance scenarios graduated from `it.todo()` to behavioral; 13/13 assertions pass against the live engine.
- ✅ **UNTRUSTED-marker propagation through reference packs closed 2026-05-17** (RFC 0020 §D follow-up): `core.openwop.ai@1.1.2` + `core.openwop.mcp@1.1.1` honor `ctx.trustBoundary === 'untrusted'` by wrapping user-role content in `<UNTRUSTED>...</UNTRUSTED>` (7 AI-call sites) and emitting `outputs.markedContent` on `invoke-tool`. `SECURITY/invariants.yaml` `prompt-injection-{input,mcp}-marker` invariants gain in-tree test coverage (`apps/workflow-engine/backend/typescript/test/untrusted-marker.test.ts`, 14 tests). End-to-end RFC 0020 §D: inbound MCP `tools/call` → `metadata.trustBoundary='untrusted'` → executor surfaces `ctx.trustBoundary` → pack delegates wrap content → LLM sees marked prompt.

**Acceptance:**

- ✅ Hosts advertising MCP/A2A capabilities run and pass the corresponding optional scenarios.
- ✅ `a2a-integration.md` has one canonical metadata example clients can implement.
- 🟡 Cross-impl evidence beyond the steward's own runs is operator-side — first non-steward host running the composition-partner scenarios is tripwire-gated per Track 9 / `ROADMAP.md` Phase 4.

## Track 7: Node-Pack Registry MVP

**Goal:** prove the node-pack ecosystem path with a small public registry.

**Work:**

- ✅ Deploy read-only `packs.openwop.dev` — scaffold landed at `registry/` (2026-05-10): multi-target Firebase Hosting config, all four endpoint shapes (`.well-known/openwop-registry`, `v1/index.json`, `v1/packs/{name}`, `v1/packs/{name}/-/{version}.{json,tgz,sig}`), local-dev server + idempotent index builder, CI publish workflow with integrity + signature validation gates. GCP hosting provisioned; first deploy lands when artifacts are populated.
- Publish one signed example pack — `vendor.openwop.rust-hello@1.0.0` manifests committed; `.tgz` + `.sig` pending Rust toolchain + key ceremony.
- ✅ Document client verification UX and registry failure modes — `registry/README.md` + `registry-operations.md`.
- Specify dependency resolution and lockfile behavior.
- ✅ Draft WASM ABI for `language: wasm` — landed at `RFCS/0008-wasm-abi.md` (Draft, 2026-05-10).

**Acceptance:**

- Public registry returns registry-operation examples from `registry-operations.md`.
- At least one pack can be fetched, verified, and used in a reference host.

## Track 8: Production Profile

**Goal:** let users distinguish toy/demo hosts from production-capable hosts.

**Work:**

- ✅ Specify queueing/backpressure vocabulary in `production-profile.md`.
- ✅ Specify retry durability and delivery expectations.
- ✅ Specify event retention and debug-bundle truncation strategy.
- ✅ Add minimal/high-throughput examples to `scale-profiles.md`.

**Acceptance:**

- ✅ `production-profile.md` and `scale-profiles.md`.
- ✅ `INTEROP-MATRIX.md` records production-profile claims separately from core conformance.
- ✅ Production-profile conformance scenarios — `production-backpressure.test.ts` + `production-retention-expiry.test.ts` verified end-to-end against the Postgres reference host (Phase H/I close-out).

## Track 9: Governance And Interop Evidence

**Goal:** increase trust by showing real independent implementation and review.

**Work:**

- Publish the hosted docs and conformance leaderboard.
- Recruit one non-steward host implementation to pass the public suite. ✅ Outreach drafts ready 2026-05-11 (Phase 3 T3.2) at `docs/recruitment/external-host.md`: 4-tier candidate list (LangGraph / Restate / DBOS / Inngest). Tracked in `MAINTAINERS.md` §"Recruitment log" §"External host implementations". Out-of-band step: send the four emails in parallel.
- Recruit one external pack author. ✅ Recruitment framework + outreach template ready 2026-05-11 (Phase 3 T3.3) at `docs/recruitment/external-pack-author.md`. Out-of-band step: identify 3-5 specific Tier 1 or Tier 2 candidates + customize the template.
- Trigger the vendor-neutral governance migration when `MAINTAINERS.md` criteria are met.
- Commission external security review after auth and registry profiles stabilize. ✅ Engagement scope finalized at `SECURITY/external-audit-engagement.md`. ✅ Per-vendor outreach drafts ready 2026-05-11 (Phase 3 T3.1) at `SECURITY/outreach/external-audit/` for Trail of Bits / NCC Group / Doyensec / Cure53 / Latacora. Status tracker at `SECURITY/outreach/external-audit/STATUS.md`. Out-of-band step: send all five in parallel.

**Acceptance:**

- Public interop matrix has at least one non-steward row.
- Governance migration RFC is opened when the maintainer tripwire fires.
- Security review results are linked from `SECURITY.md`.

**Phase 3 status snapshot (2026-05-11):** every Phase-3 deliverable that doesn't depend on external decisions is ready (engagement doc finalized, 5 per-vendor outreach emails ready-to-send, 4-tier host-recruitment drafts, pack-author recruitment framework, MCP+A2A real-impl interop env vars wired). The four `Out-of-band step` lines above are the bottleneck — they each require the steward to send outreach + wait on reply latency that's not under the project's control.

## Track 10: Multi-Agent Spec Closure

**Goal:** resolve the gap between `README.md`'s "FINAL v1 multi-agent extensions" claim and the lack of normative RFC prose in `RFCS/`. Today the schemas (`agent-manifest.schema.json`, `conversation-event.schema.json`, `orchestrator-decision.schema.json`, `memory-entry.schema.json`, `dispatch-config.schema.json`) ship without binding spec text. README references RFCs 0002–0007 by number, but only `0000-template.md` and `0001-rfc-process.md` exist on disk.

**Work:**

- Write `RFCS/0002-agent-identity-and-reasoning-events.md` — `AgentRef` wire shape, `agent.reasoned` / `agent.toolCalled` / `agent.toolReturned` / `agent.handoff` / `agent.decided` / `runOrchestrator.decided` event semantics, confidence scoring, messaging reducer interaction, replay determinism rules.
- Write `RFCS/0003-agent-packs.md` — extension of `pack.json` with `agents[]`; signing and resolution rules.
- Write `RFCS/0004-memory-layer.md` — `MemoryAdapter` host interface, BYOK redaction guarantees, list/read/write/delete contract, retention hooks.
- Write `RFCS/0005-conversation.md` — generalization of one-shot suspend → multi-turn `conversation`; resume key semantics; cancellation cascade.
- Write `RFCS/0006-orchestrator.md` — `runOrchestrator` field on `WorkflowRunDocument`, orchestrator decision protocol, replay cache-only determinism rules.
- Write `RFCS/0007-dispatch.md` — `core.dispatch` node-pattern semantics, fresh agent context guarantees, sub-workflow invocation envelope.
- Update `README.md` claim status to match landed prose (downgrade to `DRAFT` until RFCs are merged at `Active`, then re-upgrade).
- Add a short positioning addendum comparing `AgentRef` to W3C DID, A2A `AgentCard`, and AGNTCY agent-identity proposals.

**Acceptance:**

- ✅ Six RFC files in `RFCS/` at `Active` status or higher (`0002-agent-identity-and-reasoning-events.md` through `0007-dispatch.md`, landed 2026-05-10).
- ✅ `README.md` multi-agent table cross-links to each RFC by filename.
- ✅ Integration-seams audit reconciled 2026-05-11 — `docs/MULTI-AGENT-INTEGRATION-GAPS.md` is now ARCHIVED with every Phase-1-through-6 surface marked closed with a landing path. RFCs 0002–0007 are eligible for promotion from `Active` to `Accepted`.
- ✅ Conformance scenarios that exercise multi-agent surfaces cite the normative RFC in their top-of-file docstring. Verified 2026-05-12: `dispatchLoop.test.ts` cites RFC 0007; `conversationCapabilityNegotiation.test.ts` / `conversationLifecycle.test.ts` / `conversationReplayDeterminism.test.ts` / `conversationVsLegacySuspend.test.ts` cite `RFCS/0005-conversation.md`; `agentMemoryCrossTenantIsolation.test.ts` / `agentMemoryRedactionContract.test.ts` / `agentMemoryRoundTrip.test.ts` / `agentMemoryTtlExpiry.test.ts` cite `RFCS/0004-memory-layer.md`. Earlier note ("descriptions need updating to reference RFCs") was stale.
- ✅ `AgentRef` positioning addendum landed at `spec/v1/agent-ref-positioning.md` (DID / A2A AgentCard / AGNTCY composition rules + translation table).

## Track 11: Observability Verification Harness — partially closed 2026-05-11, OTLP/protobuf landed 2026-05-12

**Status update (2026-05-11):** SQLite reference host now emits OTLP/HTTP-JSON to `OTEL_EXPORTER_OTLP_ENDPOINT` when configured. Three conformance scenarios pass against it (with `--no-file-parallelism` so the collector port doesn't race across worker threads):

- `otel-emission.test.ts` — span shape contract for `openwop.run` + `openwop.node.<typeId>`
- `metric-emission.test.ts` (new) — `openwop.run.backlog` + `openwop.queue.depth` + `openwop.run.duration` metrics
- `otel-trace-propagation.test.ts` — inbound `traceparent` header threads into emitted spans

**Status update (2026-05-12):** ✅ OTLP/HTTP-protobuf path landed. `conformance/src/lib/otlp-protobuf.ts` is a hand-rolled decoder for the OTLP subset the conformance suite asserts on (ExportTraceServiceRequest + ExportMetricsServiceRequest; AnyValue oneof with string / int / double / bool / array / kvlist / bytes variants; KeyValue attributes; Span trace_id / span_id / parent_span_id / name / start + end fixed64; NumberDataPoint as_double + sfixed64 as_int). Zero new npm dependencies. The collector's `_handle` now routes on `Content-Type`: `application/x-protobuf` (or `application/protobuf`) decodes via the new module; `application/json` (or absent header) decodes via the existing JSON path; other content types return `415` with a canonical envelope. Output shape is JSON-equivalent so `_ingestTraces` / `_ingestMetrics` are unchanged. Unit tests at `conformance/src/lib/otlp-protobuf.test.ts` round-trip 18 cases through a test-only `PbWriter` helper.

**Remaining for full Track 11 closure:**

- ✅ Conformance operator-guide for the `--no-file-parallelism` requirement on OTel scenarios — documented at `conformance/README.md` inside the `OPENWOP_OTEL_COLLECTOR=true` env-var description.
- ✅ OTLP/gRPC path landed 2026-05-12 — `conformance/src/lib/grpc-framing.ts` (length-prefixed frame primitive) + parallel HTTP/2 server inside `OtelCollector.startGrpc()` (h2c, hand-rolled, zero new deps). New `capabilities.observability.otel.exportProtocols[]` discovery field advertises supported transports (`http/json`, `http/protobuf`, `grpc`). New `otel-emission-grpc.test.ts` scenario gates on the array. `observability.md` §"Export protocols" documents the three wire bindings.

## Track 11 (original): Observability Verification Harness

**Goal:** make the `openwop.*` OpenTelemetry namespace a mechanically-verified conformance property, not a documentation claim. Today no harness checks that a conformant host actually emits the spans, attributes, and metrics that `observability.md` lists.

**Work:**

- Add an OTel-collector-based test harness in the conformance suite. The reference host emits to a local collector; the harness asserts presence of required spans (`openwop.run`, `openwop.node`, `openwop.event`) and attributes (`openwop.run_id`, `openwop.workflow_id`, `openwop.tenant_id`, `openwop.node_type`, etc.).
- Add a normative `openwop.cost.*` attribute group for cost attribution (`openwop.cost.usd`, `openwop.cost.tokens.input`, `openwop.cost.tokens.output`, `openwop.cost.provider`).
- Add a normative metric vocabulary for queue depth and backlog (`openwop.queue.depth`, `openwop.run.backlog`).
- Document W3C Trace Context propagation expectations across `runs:fork` and `interrupt:resolve` boundaries.

**Acceptance:**

- New `otel-emission.test.ts` conformance scenario (gated on `capabilities.observability.otel.supported`).
- `observability.md` adds `openwop.cost.*` and queue-depth sections.
- Reference hosts (in-memory + SQLite) pass the new scenario.

## Track 12: SDK Parity And Non-TS Reference Host — closed 2026-05-12

**Status (2026-05-12):** ✅ All three normative acceptance criteria are met. The 4th-language SDK triage is explicitly demand-gated and not blocking.

| Acceptance criterion                                                                                    | Status      | Evidence                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parity matrix in `sdk/README.md` (or each SDK's README)                                                 | ✅ Done     | `sdk/PARITY.md` — 173-line per-protocol-surface matrix across TS / Python / Go. Net counts: TS 22 helpers / 10 raw-only / 0 unreachable; Python 19/13/0; Go 19/13/0. Last reviewed 2026-05-12 with the Phase B `bulkCancel` / `audit.verify` additions.                                                                                                                  |
| Python reference host passes `@openwop/openwop-conformance` end-to-end with a public conformance result | ✅ Done     | `examples/hosts/python/conformance.md` — verified 2026-05-12, 670/782 default-mode pass (85.7%). 50 failures are all capability-gated scenarios outside the claimed profile set (Python honesty-cleanup is a follow-up mirroring SQLite Phase A — does not block the cross-language proof). Pass-rate row recorded in `INTEROP-MATRIX.md` §"External conformance suite". |
| `PUBLISHING.md` documents the cadence rule                                                              | ✅ Done     | `PUBLISHING.md` lines 28-30 — patch / minor / major release rules for all 4 artifacts (TS SDK, conformance suite, Python SDK, Go SDK).                                                                                                                                                                                                                                   |
| 4th-language SDK triage (Rust / Java / Kotlin / .NET)                                                   | ⏸️ Deferred | Out-of-band; demand-gated per the goal statement. Not a normative acceptance criterion.                                                                                                                                                                                                                                                                                  |

**Goal:** prove the protocol's cross-language portability beyond the TypeScript-heavy reference path. Today both reference hosts are Node, the TypeScript SDK has the deepest surface coverage, and Python + Go SDKs ship as v1.0 but have not been audited for parity.

**Work:**

- Audit Python (`sdk/python/`) and Go (`sdk/go/`) SDK feature parity against TypeScript. Publish a parity matrix.
- Stand up a Python reference host that passes the public conformance suite. Add as a third row in `INTEROP-MATRIX.md`.
- Document SDK release cadence relative to spec changes in `PUBLISHING.md`.
- Triage candidate fourth-language SDK (Rust most likely; Java for enterprise reach) for a v1.X minor.

**Acceptance:**

- Parity matrix in `sdk/README.md` (or each SDK's README).
- Python reference host passes `@openwop/openwop-conformance` end-to-end with a public conformance result.
- `PUBLISHING.md` documents the cadence rule.

## Track 13: Spec Surface Additions (Post-v1 Gaps)

**Goal:** close small but operationally important wire-contract gaps that are not blocked by Tracks 1–9. Each item is additive (does not break v1) and ships as a clarifying annex or `v1.x` minor.

**Work:**

- Add `pause/resume` primitive distinct from cancel. Use cases: long-running interrupts, scheduled holds, operator intervention. New endpoints `POST /v1/runs/{runId}:pause` and `POST /v1/runs/{runId}:resume`; new run state `paused`; interaction with `staleClaim` lease.
- Specify a normative `429 Too Many Requests` envelope shape with `details.retryAfterMs` and `details.scope` (per-tenant / per-route / global). Required for any host claiming the production profile.
- Add a multi-region idempotency annex covering eventual-consistency across regions for the 24-hour Layer-1 cache. Document conflict resolution under partition.
- Define ordering semantics for the `append` channel reducer under concurrent writers (probably by `eventSeq`, but make it normative).
- Add a `configurableSchema` field to `WorkflowDefinition` so clients can discover what overlay keys the host accepts. Today `configurable` is open-ended and clients have no pre-flight validation.
- Add a webhook signature-algorithm version field so future signature schemes can be rolled forward without breaking existing subscribers.
- Add an audit-log integrity annex (append-only, signed or hash-chained) — required before commissioning the external security review (Track 9).

**Acceptance:**

- ✅ New endpoints + run state in `rest-endpoints.md` (`POST /v1/runs/{runId}:pause` and `:resume`) and `openapi.yaml` (`pauseRun` / `resumeRun` operations).
- ✅ `429` envelope shape normated in `rest-endpoints.md` (`details.retryAfterMs`, `details.scope`).
- ✅ Multi-region idempotency annex in `idempotency.md`.
- ✅ Append-reducer ordering rule in `channels-and-reducers.md`.
- ✅ `configurableSchema` field in `workflow-definition.schema.json` and `run-options.md`.
- ✅ Webhook signature-algorithm version field in `webhooks.md` (`X-openwop-Signature-Algorithm`).
- ✅ Audit-log integrity annex in `auth-profiles.md` (`openwop-audit-log-integrity` profile with hash-chain + signed checkpoints + `/v1/audit/verify`).
- ✅ Conformance scenario stubs landed: `pause-resume.test.ts`, `rate-limit-envelope.test.ts`, `append-ordering.test.ts`, `configurable-schema.test.ts`, `webhook-sig-algorithm.test.ts`, `audit-log-integrity.test.ts`, `multi-region-idempotency.test.ts`. Scenarios capability-gate when the host doesn't advertise the relevant surface so suite passes are not regressed for v1.0 hosts.

## Track 14: Protocol Integrity And Standards Readiness — opened 2026-08-11

**Goal:** close the correctness, certification, current-interop, compensation, identity, implementability, governance, audit, and independent-adoption gaps identified by the 2026-08-11 industry assessment before OpenWOP makes an A-grade or industry-standard claim.

**RFC program:**

- RFC 0147 — umbrella gates, sequencing, claim restrictions, and exit criteria.
- RFC 0148 — non-vacuous requirement-level certification evidence.
- RFC 0149 — OpenAPI/discovery/example/version reconciliation.
- RFC 0150 — retry-stable effect identity, replay digest v2, and fenced split-brain effects.
- RFC 0151 — additive Saga compensation and partial-failure profile.
- RFC 0152 — A2A 1.0 exact-version composition.
- RFC 0153 — MCP 2026-07-28 exact-version composition.
- RFC 0154 — workload identity, delegation, telemetry mapping, and provenance.
- RFC 0155 — discovery-core/core-standard naming and extension registry.
- RFC 0156 — cross-org governance, external audit, Tier-3 evidence, and claims policy.

**Sequencing:** RFCs 0148–0150 are the safety-critical first tranche. RFCs 0151–0154 depend on that evidence/effect foundation. RFCs 0155–0156 define the stable-core and standards-credibility gates. All ten RFCs remain Draft until their own gap registers permit Active review.

**Acceptance:** every RFC 0147 checkbox is closed; all Critical/High program risks are closed or explicitly accepted by cross-organization governance; the corrected suite, external audit, and Tier-3 host evidence are public and current.

## Sequencing And Phasing

The 13 tracks are not all equally urgent. The sequencing below stack-ranks by _adoption impact_ rather than spec size. Phases are loose calendar buckets, not commitments — each track lists its own acceptance signal.

### Phase 1 — Credibility (≤ 6 weeks from 2026-05-10)

These items are required to make the project's existing public claims defensible.

1. **Track 10 — Multi-Agent Spec Closure.** RFCs 0002–0007 must land or the README claim must be downgraded. Single biggest credibility risk; cheap to fix.
2. **Track 9 — Commission external security review** (kicks off now; result lands in 6–8 weeks). Pre-requisite: Track 13's audit-log integrity annex.
3. **Track 7 — Deploy read-only `packs.openwop.dev`** with at least one signed example pack. Without this, the entire node-pack story is hypothetical.
4. **Track 9 — Publish leaderboard site** (`site/` already scaffolded). One-week deploy.
5. **Track 4 — Conformance fixtures for interrupt profiles** (quorum, external-event, auth-required, parent/child cancel).
6. **Track 8 — Production-profile conformance scenarios.** Convert profile from documentation to mechanically verified property.

### Phase 2 — Adoption (weeks 6–18)

These items convert "very good documentation by one team" into "a protocol other teams trust."

1. **Track 9 — Recruit one non-steward host implementation.** Trips the governance tripwire. Target adapter authors for LangGraph, Inngest, Temporal, Restate, or DBOS.
2. **Track 12 — Python reference host** for cross-language proof.
3. **Track 11 — OTel verification harness** so observability claims are mechanically tested.
4. **Track 6 — MCP and A2A roundtrip conformance fixtures.**
5. **Track 5 — LLM cache-key recipe** ✅ Spec landed at `replay.md` §"LLM cache-key recipe" (§A–§E). Placeholder scenario `replay-llm-cache-key.test.ts` at `it.todo()` per §D — activates when the first reference host implements LLM-calling nodes.
6. **Track 13 — `pause/resume`, `429` envelope, append-ordering, `configurableSchema`** land additively inside v1.0 (no minor bump per `COMPATIBILITY.md` §2.1).

### Phase 3 — Ecosystem (weeks 18–36)

1. **Track 7 — WASM ABI RFC** ✅ Draft landed at `RFCS/0008-wasm-abi.md` (2026-05-10), promoted to `Active` 2026-05-11. ✅ Reference Rust pack at `examples/packs/rust-hello/` (28 KiB wasm32, built + signed). ✅ Wasmtime-free loader at `examples/hosts/in-memory/src/wasm-loader.ts`. ✅ Six conformance scenarios per RFC §Conformance + two deliberately-misbehaving packs (`rust-misbehaving-memory` for the memory cap, `rust-misbehaving-abi` for ABI-version rejection). ✅ `capabilities.nodePackRuntimes.wasm` declared in `schemas/capabilities.schema.json` (commit `09e28fd`).
2. **Track 12 — Postgres reference host** ✅ at `examples/hosts/postgres/` — production-profile-satisfying; Phase H + I close-out brings BYOK / MCP / HTTP / agent-memory / OAuth2-CC / OIDC / API-key-rotation / auth-scoped discovery / pack-registry consumption.
3. **Track 13 — OIDC / SSO user-bearer profile** ✅ landed at `auth-profiles.md` §"openwop-auth-oidc-user-bearer". **Multi-region idempotency annex** ✅ landed at `idempotency.md`. **Webhook signature-algorithm version field** ✅ landed at `webhooks.md`. ✅ Synthetic OIDC issuer harness for conformance at `conformance/src/lib/oidc-issuer.ts` + unit test at `conformance/src/lib/oidc-issuer.test.ts`; consumed by `auth-oidc-user-bearer.test.ts` via `OPENWOP_TEST_OIDC_ISSUER_URL` for the 6 host-side validation cases (valid sub/iss/aud/exp + iss mismatch + aud mismatch + expired + unknown kid + insufficient scope).

### Phase 4 — Standards lifecycle (months 9–18)

1. **Track 9 — Vendor-neutral org migration** once the maintainer tripwire fires (≥1 non-steward maintainer).
2. **Working-group governance model** with public RFC decision log.
3. **v1.x minor consolidation** of all Phase 1–3 additions; no breaking changes.

### Out-of-scope for now

These are real gaps but deferred until Phase 4 or later: internationalization / locale handling for interrupts and messages, formal compliance vocabulary (SOC 2 / GDPR / HIPAA framing), bug-bounty program, CNA registration. None block v1 adoption; all are good post-tripwire work.
