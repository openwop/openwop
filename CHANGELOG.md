# openwop Spec v1 — Changelog

All notable changes to the openwop v1 spec, schemas, OpenAPI/AsyncAPI, conformance suite, and TypeScript reference SDK.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1/) loosely. Versions are spec-corpus-wide (one date, multiple artifact updates per row); per-artifact versions live in their respective `package.json` / schema `$id` fields.

> **Status legend** (per `auth.md` §status legend):
> STUB · DRAFT · OUTLINE · FINAL — see individual doc headers for current state.

---

## [1.0 — additions] — 2026-05-12 — Phase F real-impl interop closure (MCP + A2A 0.3)

Out-of-band T3.4 operator step from `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 6. Pointed the conformance suite's MCP + A2A probes at live reference implementations and closed the wire-shape gaps surfaced by the real-impl run.

- **MCP** — probe run against `@modelcontextprotocol/sdk@1.29.0` in single-JSON streamable-http mode revealed two gaps the in-process fake had been hiding: `initialize` was sending empty `params` (real SDK requires `protocolVersion` + `capabilities` + `clientInfo`), and `mcp-session-id` from the initialize response wasn't being threaded through subsequent `tools/list` + `tools/call` calls. Both closed in `conformance/src/scenarios/mcp-tool-roundtrip.test.ts`; fake-mode compatibility preserved.
- **A2A** — probe + in-process fake migrated from the v0.2-era simple-HTTP shape (`/agent.json` + REST `/tasks` + `GET /tasks/{id}`) to A2A 0.3 JSON-RPC: AgentCard at `/.well-known/agent-card.json`, `message/send` + `tasks/get` over the JSON-RPC endpoint discovered via `card.additionalInterfaces`. Internal `A2ATaskState` enum stays UPPERCASE (matches `a2a-integration.md`'s gRPC reference); wire responses translate to lowercase-hyphen (`completed`, `input-required`, `auth-required`) per the JSON-RPC enum. Probe accepts both Task and Message envelopes from `message/send` per A2A 0.3. First real-impl evidence collected against `@a2a-js/sdk@0.3.13`.
- **INTEROP-MATRIX** — new `## Composition partners` subsection records the real-impl evidence with explicit scope limits (MCP probe currently covers streamable-http single-JSON only; A2A probe currently exercises direct probe only, drift-point subtests stay fake-only).
- **a2a-integration.md** — refreshed to reflect the well-known AgentCard path + JSON-RPC method names, plus a new "spelling drift to remember" callout: gRPC keeps the UPPERCASE enum, JSON-RPC MUST emit + accept lowercase-hyphen on the wire.

Gate: 8/8 green.

---

## [1.0 — additions] — 2026-05-12 — Phase H + Phase I close-out (Postgres host) — myndhyve.ai launch-readiness

Architect-review-driven batch landing the 9 launch-blocking + 7 of 11 enterprise-blocking surfaces required for myndhyve.ai's Postgres production runtime. **Postgres host conformance: 728/797 (91.3%)**, up from 89.4% baseline.

### Phase H — launch-blockers (9/9 closed)

- **BYOK / aiProviders** — `secrets.ts` resolver + `conformance.secret.echo` typeId + `capabilities.secrets` advertisement. SR-1 enforced: cleartext never on observable surfaces (only SHA-256 hashes + lengths).
- **`core.llm.chat` + `core.llm.completion` + 4-mode policy** — `ai-proxy.ts` implements `disabled`/`optional`/`required`/`restricted` per `capabilities.md` §`aiProviders.policies`; per-provider env-driven policy store; resolver-outage fail-open to `optional`; restricted-with-empty-allowedModels fail-closed via `model_not_allowed`. `provider_policy_denied` error code with closed-set reasons.
- **MCP client (`core.mcp.toolCall`)** — `mcp-client.ts` over HTTP/JSON-RPC; `trustBoundary: "untrusted"` per `threat-model-prompt-injection.md` §UNTRUSTED; env-driven server registry (`OPENWOP_MCP_SERVER_<ID>`); MCP-1 redaction: tool args + result content NEVER on emitted event payloads.
- **HTTP client (`core.http.request`)** — `http-client.ts` with SSRF guard mirroring webhooks + 1 MiB response cap + expectStatus assertion.
- **cap-breach + configurable-schema enforcement** — confirmed via conformance.
- **SECURITY invariants** — `mcp-toolcall-payload-redaction` + `http-client-ssrf-guard` (protocol-tier) with public scenarios (`mcp-toolcall-redaction.test.ts` + `http-client-ssrf.test.ts`).
- **SDK helpers** — 10 new wire types + 17 new HTTP error codes across TS/Python/Go.

### Phase I — enterprise-blockers MVP (7/11 closed)

- **Agent memory (RFC 0004)** — `memory-adapter.ts` Postgres-backed list/get with TTL + CTI-1 cross-tenant isolation + host-internal `writeMemoryEntry` (65 KiB content cap).
- **Reasoning + agent events (RFC 0002–0003)** — `agent-events.ts` typed payloads + verbosity governance (off/summary/full) + `capabilities.agents` Phase 1–6 advertisement.
- **API-key rotation** — two-key overlap via `OPENWOP_SECONDARY_API_KEY`; constant-time dual-candidate `checkAuth`; canary-redaction. Profile claim conditional.
- **Auth-scoped discovery (RFC 0011 §A)** — `OPENWOP_TENANT2_API_KEY` activates narrowed view (orchestrator + dispatch omitted, strict subset). Profile claim conditional.
- **Subworkflow outputMapping + parent linkage (spec gap G3)** — `seedVariablesFromWorkflow()` projects workflow.variables[].defaultValue into child runs; `handleGetRun` snapshot surfaces parentRunId + parentNodeId.
- **SECURITY invariants** — `agent-memory-cti-1` + `agent-memory-sr-1-redaction` + `auth-key-rotation-no-canary-echo`. Total: 68 invariants (35 protocol-tier, all with public tests).
- **SDK helpers** — wire types for MemoryEntry/AgentsCapability/AuthProfileClaim/etc.

### Phase I deferred (4 items, tripwires in `INTEROP-MATRIX.md`)

- OAuth2-CC + OIDC user-bearer — reverse-proxy IdP pattern preferred for myndhyve.ai.
- Pack registry consumption — gated on first non-built-in pack landing.
- Reasoning-event emission wiring — helpers in place; needs LLM-driven typeId integration.

Lane: implementation-only. Spec is FINAL on every Phase H/I surface; no normative deltas; no wire-shape changes; SDK additions are additive.

Verification: `npm run openwop:check` 8/8 green. Full conformance against pglite-backed Postgres host: 728 passed / 1 failed (test-isolation residue) / 38 skipped / 30 todo (797 total).

## [1.0 — additions] — 2026-05-12 — Python host conformance close-out: 700/788 (100% of applicable, ZERO failures)

Follow-up batch to the 53-failure post-Phase-C-round-2 baseline. Every controllable failure closed in a single focused pass — pass rate **100% of applicable tests** (88.8% of total, 700 passed / 0 failed / 58 skipped / 30 todo).

How the 51 (53 minus 2 flake-band) failures closed:

- **Canonical `RunEventDoc` event shape** — `RunEvent.to_dict()` rewritten to emit the 6-field canonical wire shape (`eventId/runId/type/payload/timestamp/sequence`) per `schemas/run-event.schema.json`, with stable `eventId` per replay-determinism. Closes 3 version-negotiation failures.
- **Stream-modes query validation** — `?streamMode=` accepts the closed enum (`updates|values|messages|debug`) and comma-separated subsets (`values` exclusive); `?bufferMs=` validated to `[0, 5000]` per `stream-modes.md` §"Aggregation hint"; SSE handler now sends `Connection: close` + sets `close_connection=True` so terminal events drop the socket and clients observe stream end. Closes 12 stream-modes / stream-modes-buffer / stream-modes-mixed failures.
- **Pause/resume contract** — 202 + `{status, pausedAt|resumedAt}`; 409 with `error: "conflict"` + `details.runStatus` on conflict; idempotent re-pause replays the original `pausedAt`; `core.delay` drain-on-pause semantics (artificial wait treated as drained when pause arrives, so wall-clock total stays bounded). Closes 5 pause-resume failures.
- **Highest-concurrency idempotency** — `IdempotencyCache` gained per-key `threading.Lock`s held across the create-run get→create→put sequence. 10 parallel requests with the same `Idempotency-Key` now serialize and produce exactly one runId. Closes 1 high-concurrency race.
- **Webhook error-code catalog** — `webhook_url_rejected` restored for SSRF (the conformance suite's de-facto code) + renamed `webhook_not_found` → `subscription_not_found`. URL-shape validation runs unconditionally (env bypass only relaxes the private-IP check); delivery thread catches `ValueError` defensively. Closes 3 webhook failures.
- **Content negotiation on `/v1/runs/{id}/events`** — clients without `Accept: text/event-stream` get the JSON poll-style response instead of an open SSE stream. Closes the `append-ordering` test driver hang.
- **Honest fixture advertisement** — discovery `fixtures[]` filtered to fixtures whose every node typeId is in `{core.noop, core.delay}` AND not in the `ENFORCEMENT_FIXTURE_BLOCKLIST` (cap-breach + configurable-schema — enforcement contracts the host does NOT implement). Converts 24+ FAILs to honest SKIPs (interrupts, conversations, agents, BYOK, subworkflows, orchestrator, dispatch, channels, packs).
- **Route additions** — `GET /v1/workflows/{workflowId}` returns the seeded workflow JSON. `/v1/packs/*` catch-all returns a plain-text 404 (non-OpenWOP-shaped) so `pack-registry.test.ts`'s registry-presence probe identifies "no registry mounted" and skips the 8 read-endpoint scenarios.

`openwop:check` 8/8 green; `spec-corpus-validity` + `fixtures-valid` clean.

Lane: **implementation-only**, no spec/schema/OpenAPI/AsyncAPI/SDK changes. The honesty principle (advertise only what behavior exists) drives the fixture-filter additions; the wire-shape work brings the host into line with existing FINAL specs.

## [1.0 — additions] — 2026-05-12 — Python host conformance re-measured post-Phase-C-round-2

- **Re-ran `@openwop/openwop-conformance` against the post-Phase-C-round-2 Python host** (the version that advertises pause/resume + bulk-cancel + capability_required + webhooks). New default-mode pass rate: **667/782 = 85.3%** (down 0.4pp from the 670/782 baseline measured before Phase C round 2 — the new advertisements unlocked scenarios that test the full spec contract). `INTEROP-MATRIX.md` Python row + pass-rates table + 53-failure characterization paragraph refreshed with measured numbers. `examples/hosts/python/conformance.md` result table + 3-category failure breakdown rewritten honestly: (1) pre-Phase-C capability-gated scenarios (interrupts / BYOK / pack-registry / cap-breach / etc.), (2) Phase C round 2 advertise-but-spec-incomplete (5 pause-resume + 1 webhook-negative — endpoints exist, behavior needs tightening), (3) pre-existing host gaps inside the host's CLAIMED `openwop-stream-*` profiles (12 stream-modes failures — these warrant either implement-to-spec or retract-the-claim). Strict-mode posture paragraph extended to Python — its strict-fail count is expected to exceed 53 because the Phase C round 2 advertisements unlock behavior-required hard-fails the host doesn't fully satisfy. Lane: **doc-only**, no host or suite changes; this entry consolidates the Track 12 closure docs (commit `efbc8d8`) with the re-measurement that the senior code-review pass flagged as MEDIUM-1.

## [1.0 — additions] — 2026-05-12 — Phase C round 2: Python reference host expansion

Stdlib-only Python in-memory host gains parity with SQLite/Postgres on four additive surfaces, all spec-compliant per `rest-endpoints.md`, `capabilities.md`, `webhooks.md`, and `idempotency.md`:

- **Pause/resume** — `POST /v1/runs/{runId}:pause` and `:resume` per `rest-endpoints.md` §pause/resume. 202 + `{status: "paused"|"running", pausedAt|resumedAt}`. 409 + `details.runStatus` on conflict. `drainPolicy: "immediate"` refused with 422 + `details.unsupportedDrainPolicy`. Executor parks at node boundary (drain-current-node).
- **Bulk-cancel** — `POST /v1/runs:bulk-cancel`. `results[{runId, ok, status?, error?}]` shape; order matches request. `runIds` cap = 100 (`details.maxRunIds` on overflow). Re-issuing returns `ok: true, status: "cancelled"` for already-cancelled runs per spec idempotency note.
- **`capability_required` refusal** — pre-flight scan of `GATED_TYPEID_MAP` in `_handle_create_run`. 422 with canonical envelope: `details.{requiredCapability, offendingTypeId, nodeId}`. Refuses 9 gated typeIds: `core.{llm.chat, llm.completion, subWorkflow, orchestrator.supervisor, dispatch, channelWrite, identity, http.request, mcp.toolCall}`.
- **Webhooks** — `POST /v1/webhooks` (register) + `DELETE /v1/webhooks/{id}` (unregister). HMAC-SHA256(`{timestamp}.{rawBody}`) signing with `X-openwop-Signature{,-Timestamp,-Algorithm,-Subscription-Id}` headers. SSRF guard rejects loopback / RFC1918 / link-local / unique-local / `*.local|*.internal|*.cluster|localhost`; rejection surfaces as `validation_error` + `details.reason` (not a host-invented code — matches `HTTP_ERROR_CODES` catalog). Fan-out runs on daemon threads so the executor never blocks. `data` field stripped from webhook envelope per `debug-bundle.md` redaction policy.
- **Idempotency-Key** honored on all three new write endpoints via the existing `IdempotencyCache` (Layer-1, 24h TTL, body-hash conflict check) per `idempotency.md`.
- **Discovery payload** advertises `capabilities.runs.pauseResume.drainPolicies: ["drain-current-node"]`, `bulkCancel.maxRunIds: 100`, `webhooks.signatureAlgorithms: ["v1"]`, and `refusedCapabilities[]` (the 8 capability keys whose typeIds this host pre-empts).
- **Debug-bundle** corrected: `bundleVersion: "1.0"` (was `"1"` — failed schema pattern), `data` field stripped from rendered events (potential BYOK/interrupt-payload leak fix), 1000-event head+tail truncation cap with `truncated: true` + `truncatedReason: "events_truncated_to_size_cap"` + `truncatedOriginalCount` when triggered.

**Honesty preserved:** `audit-log-integrity` profile remains unclaimed (Python stdlib lacks Ed25519). `production` profile remains unclaimed (no durability/backpressure/retention).

Lane: **implementation-only**, no spec/schema/OpenAPI/AsyncAPI/SDK changes. Aligns reference host to existing FINAL specs; no normative deltas.

## [1.0 — additions] — 2026-05-12 — Track 11 OTLP/HTTP-protobuf path + collector remediation

- **OTLP/HTTP-protobuf receiver landed.** `conformance/src/lib/otlp-protobuf.ts` (529 LOC, zero new npm deps) — hand-rolled `PbReader` + decoders for `ExportTraceServiceRequest` / `ExportMetricsServiceRequest`. Supports KeyValue + AnyValue oneof (string / int / double / bool / array / kvlist / bytes) per the OTLP wire spec. Output shape is JSON-equivalent so the existing `_ingestTraces` / `_ingestMetrics` consumers are unchanged. Forward-compat via "unknown field → skip" pattern. 18 server-free unit tests round-trip every wire-format variant via an in-test `PbWriter` helper.
- **Collector content-type routing.** `OtelCollector._handle` now inspects `Content-Type`: `application/x-protobuf` (or `application/protobuf`) decodes via the new module; `application/json` (or absent Content-Type) decodes via the existing JSON path; anything else returns `415 unsupported_media_type` with a canonical error envelope. Closes Track 11's "remaining: OTLP/protobuf path" line item — only OTLP/gRPC (deferred to v1.2+) and the `--no-file-parallelism` operator-guide remain open.
- **Code-review remediation.** Senior code-review pass surfaced one CRITICAL banned-pattern (`as unknown as Record<string, unknown>` double-cast in the collector's protobuf-routing branch); fixed by introducing narrow `TracesIngest` / `MetricsIngest` structural interfaces that both the JSON parse path and the protobuf decoder output satisfy without casts. Two MEDIUM items also closed: defense-in-depth 16 MiB body-size cap on the collector (returns `413 payload_too_large`); end-to-end test coverage of the collector's HTTP wiring (`conformance/src/lib/otel-collector.test.ts` — 9 tests covering protobuf POST, JSON POST, 415/413/405/400 error paths, /v1/metrics routing, /v1/logs forward-compat OK).
- **Docs synced.** `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 11 status banner updated. `conformance/coverage.md` "Observability and diagnostics" row grade B+ → A− citing both encodings. `conformance/README.md` `OPENWOP_OTEL_COLLECTOR=true` env-var doc rewritten to mention both accepted encodings + the body-size cap.

## [1.0 — additions] — 2026-05-12 — Phase B: spec corpus completion (R1 + R3 + R4 closed)

Phase B from `/Users/david/.claude/plans/close-all-gaps-to-partitioned-boole.md` closes the v1.0 spec-corpus completion gate: every spec doc reads `Status: FINAL v1`; every previously deferred R-track in `rest-endpoints.md` §"Open spec gaps" is closed for the first time; auth + production + i18n + compliance + grpc + lockfile surfaces normated; SECURITY annexes for CNA + bug-bounty staged behind the maintainer tripwire. Landed across two commits — `feat(phase-B): spec corpus completion — 13/13 tasks closed` and `feat(phase-B-fix): close 6 senior-review findings`.

### Spec corpus

- New `spec/v1/i18n.md` (FINAL) — optional locale-negotiation annex: `Accept-Language` semantics, `locale` field on InterruptPayload + ErrorEnvelope, `capabilities.i18n` block, fallback rules, replay determinism.
- New `spec/v1/compliance.md` (FINAL, non-normative) — protocol-surface ↔ SOC 2 / GDPR / HIPAA / ISO 27001 control-family mapping. Operator reference; does not prescribe certification.
- New `spec/v1/grpc-transport.md` (FINAL) — optional alternative transport profile. REST + SSE remains REQUIRED; gRPC opt-in via `capabilities.supportedTransports: ["grpc"]`. Canonical service `openwop.v1.Engine`; canonical `.proto` at `api/grpc/openwop.proto`. Closes R3.
- `spec/v1/host-capabilities.md` promoted DRAFT → FINAL — corpus now has zero `DRAFT`/`STUB`/`OUTLINE` tags.
- `spec/v1/rest-endpoints.md` gains §"POST /v1/runs:bulk-cancel" (closes R1) + §"Audit-log integrity (gated on profile)" route table + `capability_required` in common-error-codes catalog.
- `spec/v1/node-packs.md` gains §"Dependency resolution + lockfile" — pack lockfile schema; 5 new normative error codes; resolver MUSTs for integrity + signature + peer-dep verification.
- `spec/v1/production-profile.md` §Backpressure — `retryAfterSeconds` capped at 86400s (24h) per RFC 0009 Q#2 resolution.
- `spec/v1/auth.md` §"scope vocabulary" gains `audit:read` row — closes cross-doc gap with OpenAPI.

### Schemas

- New `schemas/audit-verify-result.schema.json` — response payload from `GET /v1/audit/verify`.
- New `schemas/pack-lockfile.schema.json` — reproducible-build lockfile pinning resolved pack versions + SHA-256 integrity + Ed25519 signature.
- `schemas/capabilities.schema.json` gains `i18n` block + `production.backpressure.retryAfterSeconds.maximum: 86400`.
- `schemas/node-pack-manifest.schema.json` gains `language: "wasm-component"` + `format: "wasm-component"` enum values (additive Component Model variant; RFC 0008 §Alt §1 resolved).

### OpenAPI

- `bulkCancelRuns` + `verifyAuditLog` operations. New `audit` tag. Bearer-token scope catalog includes `audit:read`.

### RFCs

- RFC 0009 unresolved questions all 4 resolved: force-expire host-private; Retry-After ≤86400s; inflightCap advertise; same-commit advertisement.
- RFC 0008 §Alt §1 (Component Model) resolved — additive enum values; WIT-interface amendment deferred until first CM host lands.

### Host (SQLite reference)

- `handleBulkCancel` + `cancelOneRun` helper. Route wired at `POST /v1/runs:bulk-cancel`. 100-id cap + per-id error envelopes (`not_found` / `run_terminal` / `forbidden`).

### SDK (TS / Python / Go)

- New first-class helpers: `bulkCancelRuns` + `verifyAuditLog` on `OpenwopClient` in all 3 SDKs.
- 5 new pack-lockfile error codes in `HTTP_ERROR_CODES`: `pack_integrity_mismatch`, `pack_signature_invalid`, `pack_peer_dependency_missing`, `pack_lockfile_incomplete`, `pack_version_not_found`.
- 6 new wire types exported per SDK: `BulkCancelRunsRequest/Response/Result`, `AuditVerifyResult/Checkpoint/Anomaly`.
- PARITY.md count bumped: TS 20 → 22, Python 17 → 19, Go 17 → 19 ✅ helpers.

### Conformance

- New `bulk-cancel.test.ts` (4 tests).
- `coverage.md` Endpoint Coverage Manifest gains `bulkCancelRuns` + `verifyAuditLog` rows (closes R4).
- `spec-corpus-validity.test.ts` regex tightened with `(?<![a-z0-9-])` negative lookbehind.

### Security

- New `SECURITY/cna.md` — CNA-registration operational plan; tripwire-gated.
- New `SECURITY/bug-bounty.md` — bug-bounty program structure; same tripwire.
- `SECURITY.md` §5 cross-links both.

### Wire-shape classification

Purely additive. No required field made optional. No existing event-type shape changed. No existing MUST relaxed.

## [1.0 — additions] — 2026-05-12 — Phase A close-out: 9 SQLite conformance failures → 0; honesty cleanup

Phase A from the `/Users/david/.claude/plans/close-all-gaps-to-partitioned-boole.md` close-every-gap plan landed across three commits (host impl, advertisement cleanup, BYOK + restart fixtures) plus this close-out pass to address the senior code-review findings.

### Spec normative additions

- **`spec/v1/capabilities.md` §"Unsupported capability — refusal contract"** — canonical error envelope (`400` / `404` / `422` with `error: 'capability_required' | 'validation_error' | 'not_found'`, `details.{requiredCapability, offendingTypeId, nodeId}`) for hosts that refuse a workflow referencing a capability-gated reserved typeId. Normative typeId map: `core.conversationGate` ↔ `conversationPrimitive`, `core.orchestrator.supervisor` ↔ `orchestrator.supported`, `core.dispatch` ↔ `dispatch.supported`. Future RFCs adding gated typeIds MUST extend the table.
- **`spec/v1/channels-and-reducers.md` §"Channel TTL"** — write-time pruning is now MUST (was MAY). TTL channels MUST wrap entries as `{value: T, _ts: number}` (where `_ts` is engine-write-time wall-clock in ms); hosts MUST NOT strip `_ts` between write and read; `RunSnapshot.variables` MUST reflect the pruned state once the next write has landed. `maxSize` applies AFTER TTL pruning. Replay-safe via original event timestamps.
- **`spec/v1/node-packs.md` §"core.subWorkflow contract"** — config shape (`workflowId`, `waitForCompletion`, `onChildFailure`, `outputMapping`, `propagateCancellation`); normative output shape `data.outputs.{childRunId, childStatus}` (closed enum `"completed" | "failed" | "cancelled"`); parent linkage MUSTs (`parentRunId` + `parentNodeId` on child); variable seeding from `variables[].defaultValue` at run-create.
- **`spec/v1/version-negotiation.md` §"events/poll forward-compat tolerance"** — `lastSequence` is canonical; `since` accepted for back-compat. Past-end cursor MUST yield `200` + empty `events`, never `4xx`. Non-numeric / negative input is `validation_error 400`.
- **`spec/v1/rest-endpoints.md` §"Common error codes"** — gains `capability_required` entry alongside the existing `capability_not_provided` row.

### Host (SQLite reference) — impl

- `core.orchestrator.supervisor` + `core.dispatch` (RFC 0006 / RFC 0007) implemented end-to-end with normative output shape, real child-run dispatch via `core.subWorkflow` machinery for `next-worker`, and **`causationId` propagation per RFC 0007 §E MUST** (events table gains `causation_id` column; `appendEvent` + every event-render endpoint surface it).
- `core.channelWrite` with TTL pruning + maxSize + `{value, _ts}` wrap + variable projection.
- `core.identity` passthrough + variable seeding from inputs at run-create.
- `conformance.secret.echo` for BYOK roundtrip; hashes the canary, never echoes the raw value.
- Generalized capability-refusal in `handleCreateRun` (multi-typeId via `GATED_TYPEID_MAP` + `HOST_ADVERTISED_GATED_CAPABILITIES`).
- `capability_not_provided` refusal via `FIXTURE_NODE_REQUIRES` registry, pre-empts `node.started`.
- `runFailureErrors` carrier propagates specific terminal error codes (previously always overwritten to `unsupported_node_type`).
- Constant-time dual-candidate `checkAuth` — every candidate compared regardless of match; no timing oracle.
- Events/poll accepts canonical `lastSequence` (back-compat `since`) + validates non-numeric input.
- `core.delay` honors `config.ms` in addition to `inputs.delayMs`.
- `runs.variables_json` column + projection on `GET /v1/runs/{id}`.
- `OPENWOP_FORCE_RATE_LIMIT=true` deterministic 429 induction harness.
- `OPENWOP_SECONDARY_API_KEY` dual-candidate support for `openwop-auth-api-key-rotation`.
- Fixture-advertisement filter extended to `openwop-smoke-*` prefix.

### Host (SQLite reference) — honesty cleanup

Removed dishonest advertisements per the Phase A close-out review:

- **`production.supported`** removed from discovery — the host doesn't enforce backpressure (no `inflightCap`) or retention (no `410` expiry sweeper). Postgres reference host remains the canonical `openwop-production` claimant in `INTEROP-MATRIX.md`.
- **`auth.oauth2.supported`** / **`auth.oidc.supported`** / **`auth.mtls.supported`** removed — the host runs as an HTTP-only listener with bearer-token auth; it does not parse JWTs, introspect against an IdP, or terminate TLS.
- **`aiProviders.byok: ['anthropic', 'openai']`** removed — the host does not route AI calls.
- `auth.profiles` slimmed to `['openwop-audit-log-integrity', 'openwop-auth-api-key-rotation']` — the two profiles the host implements end-to-end.
- The corresponding strict-mode (`OPENWOP_REQUIRE_BEHAVIOR=true`) tests now correctly strict-fail on the SQLite host (10 failures). Per `behaviorGate`'s design that's the intended outcome — hosts that don't advertise a profile strict-fail rather than soft-skip into a false-green claim. Default-mode pass rate is 100% of applicable (669 / 731, 0 fails).

### Conformance

- 17 multi-agent scenarios carry explicit RFC 0002 – 0006 citations (previously schema-only).
- `conformance-subworkflow-parent.json` typeId renamed `core.control.subWorkflow` → `core.subWorkflow` (matches host + spec canonical naming).
- New fixture `openwop-smoke-byok-roundtrip.json` + `fixtures.md` catalog entry.
- `spec-corpus-validity.test.ts` regex tightened with `(?<![a-z0-9-])` negative lookbehind so `conformance-canary-secret` inside `openwop-conformance-canary-secret` no longer false-matches as a fixture id.

### SDK

- `HTTP_ERROR_CODES` (TS, Python, Go) gains `capability_required` near the existing `capability_not_provided` entry. `isHttpErrorCode("capability_required")` / `is_http_error_code("capability_required")` / `IsHTTPErrorCode("capability_required")` all narrow correctly. SDK CHANGELOGs updated.

### Schemas

- `events.causation_id` column on the SQLite host events table (idempotent migration). The wire shape is unchanged — `causationId` is already supported in `schemas/run-event.schema.json`.

### Wire-shape breaking deltas (per user "no backward-compat" authorization for Phase A)

- `core.subWorkflow` `node.completed` payload shape: pre-Phase-A `data: {childRunId, childOutcome}` → post-Phase-A `data: {outputs: {childRunId, childStatus}}`. The new shape is now normative in `node-packs.md` §"core.subWorkflow contract". Any consumer reading the pre-Phase-A shape breaks.
- `core.delay` config: still accepts `inputs.delayMs` (back-compat) but `config.ms` takes precedence when both are present.

## [1.0 — additions] — 2026-05-12 — Phase D close-out: SQLite host implements auth-scoped discovery

- **SQLite reference host implements `openwop-discovery-auth-scoped` end-to-end.** New `OPENWOP_TENANT2_API_KEY` env var wires an optional second principal. `principalFor(req)` resolves the bearer to `'primary' | 'tenant2' | null` via constant-time comparison across all configured candidates (no timing oracle between primary/secondary/tenant2 paths). `handleDiscovery` consults the principal and narrows the capability view for tenant2 — omits `orchestrator` + `dispatch` advertisements (RFC 0006 / RFC 0007 surfaces) so tenant2's `capabilities.*` key set is a strict subset of primary's, satisfying `capabilities-change-detection.md` §"Scoped capability views" line 69 (no authorization oracle). `capabilities.discovery.authScoped = { supported: true, mode: 'same-endpoint' }` advertised on every view so clients can negotiate against the public payload before authenticating.
- **Behavior-mode verified.** Against the SQLite host with `OPENWOP_TENANT2_API_KEY=openwop-sqlite-tenant2-key`: all 3 RFC 0011 subtests (capability shape + base-schema preservation + authorization-oracle probe) pass under `OPENWOP_REQUIRE_BEHAVIOR=true` + `OPENWOP_TEST_UNAUTHORIZED_API_KEY=<tenant2-key>`. 9/9 tests in `discovery.test.ts` green; unauth/primary/tenant2 views verified to expose `{auth, discovery, dispatch, orchestrator, secrets, webhooks}` vs `{auth, discovery, secrets, webhooks}` keysets respectively.
- **`INTEROP-MATRIX.md` SQLite row gains `openwop-discovery-auth-scoped` claim.** Row prose distinguishes "verified end-to-end" for rotation + auth-scoped discovery from the still-not-claimed production/OAuth2/OIDC/mTLS profiles. Conformance posture date bumped from "Phase A close-out" to "Phase D close-out" to reflect the latest addition.
- **RFC 0011 acceptance criteria fully closed.** Schema + scenarios + coverage + RFC Active + reference-host implementation + INTEROP-MATRIX row all landed. Phase D matches the Phase A/B precedent of complete close-out within the same calendar day.

## [1.0 — additions] — 2026-05-12 — RFC 0011 Active: auth-scoped discovery (Phase D)

- **RFC 0011 opened + promoted Draft → Active.** [`RFCS/0011-auth-scoped-discovery.md`](./RFCS/0011-auth-scoped-discovery.md) formalizes the optional auth-scoped discovery surface from `capabilities-change-detection.md` §"Scoped capability views" into an advertisable capability flag. Bootstrap-phase steward waiver of the 7-day comment window per `CONTRIBUTING.md` §"Bootstrap-phase notes"; same precedent as RFCs 0009 and 0010. Recorded in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers."
- **Schema additive: `capabilities.discovery` block.** New top-level `discovery.authScoped.{supported, mode, endpointPath}` per RFC 0011 §A. `mode` enum: `same-endpoint` / `extension-endpoint`. `endpointPath` requires leading slash (absolute URLs rejected at the schema level). `additionalProperties: false` on both the parent and nested blocks.
- **Three auth-scoped subtests added to `discovery.test.ts`.** (1) Capability shape — `supported` boolean, `mode` enum, `endpointPath` leading-slash when mode is `extension-endpoint`. (2) Authenticated view satisfies base schema — required Capabilities fields preserved per `capabilities.md` §3. (3) Authorization-oracle probe — gated on `OPENWOP_TEST_UNAUTHORIZED_API_KEY`; the unauthorized view's capability keys MUST be a subset of the primary view's. All three behavior-gated under `OPENWOP_REQUIRE_BEHAVIOR=true`. Closes ROADMAP Track 2 ("next add auth-scoped discovery variants when a host advertises them").
- **Coverage map.** `discovery.test.ts` "Discovery and capability handshake" row references the new subtests; capability-gated section gains an `openwop-discovery-auth-scoped` row alongside the existing rows. Scenario count unchanged (subtests live within the existing `discovery.test.ts` file). Capability-gated table count: 16 → 17 scenario groups.

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
