# openwop Spec v1 — Changelog

All notable changes to the openwop v1 spec, schemas, OpenAPI/AsyncAPI, conformance suite, and reference SDKs.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1/) loosely. Versions are spec-corpus-wide (one date, multiple artifact updates per row); per-artifact versions live in their respective `package.json` / schema `$id` fields.

> **Status legend** (per `auth.md` §status legend):
> STUB · DRAFT · OUTLINE · FINAL — see individual doc headers for current state.

---

## [1.1.1 — unreleased] — 2026-05-13 — post-1.1.0 additive cleanup

Two small additive commits landed on `main` after the v1.1.0 release tag. Neither changes a wire shape; both ship in a 1.1.1 patch when the registry SDKs are next published.

- **Workspace lockfile demo** (`daeaef5`) — `examples/core-packs-lockfile/openwop-pack-lockfile.json` + README pins the 4 audit-gated core packs (`core.openwop.{ai,http,mcp,triggers}@1.0.0`) using the `pack-lockfile` schema. Demonstrates SRI integrity + Ed25519 signature material for offline / air-gapped resolution. Closes the controllable half of the "build + sign + lockfile in-tree" Phase E task; the audit-blocked half (publication to `packs.openwop.dev`) remains gated on `SECURITY/external-audit-engagement.md` §2.1.
- **`community.openwop-team.demo` re-signed** (`0bf08cc`) — Option-B reconciliation of a 3-way signing-identity drift. The demo pack now ships signed by `community-openwop-team-demo-1` (over canonical `pack.json`) instead of `openwop-registry-root` (over tarball), matching PACKS-MVP-PLAN.md §211's per-tier-key intent and illustrating the per-publisher-identity pattern. New `registry/keys/community-openwop-team-demo-1.pub` + `signingKeys[]` entry in `registry/.well-known/openwop-registry.json` (namespace-scoped to `community.openwop-team.demo` only — cannot sign for `core.*` or `vendor.*`). Canonical verifier (`registry/scripts/verify-signatures.mjs`) passes 29/29.

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
- **RFC 0008** — WASM ABI (`Active`) + Component-Model variant annex.
- **RFC 0009** — Production-profile conformance (`Active`).
- **RFC 0010** — Auth-profile conformance + v1.0 closure umbrella (`Active`).
- **RFC 0011** — Auth-scoped discovery (`Active`).

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
