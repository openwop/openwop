# OpenWOP Conformance Coverage Map

> **Status: Living document. Updated 2026-05-11.** This map connects the current scenario files to the protocol surfaces they protect and records the remaining gaps from the protocol deep dive. Scenario names are source-of-truth file names under `conformance/src/scenarios/`.

> **Shape grade vs behavior grade.** Some optional-profile scenarios validate **capability shape** (the host's discovery advertisement is well-formed) without yet exercising **behavior** (the host actually implements the profile end-to-end). The "Current grade" column reflects shape; see §"Capability-gated scenarios: shape vs behavior" below for the dual-grade view and the `OPENWOP_REQUIRE_BEHAVIOR=true` strict-mode runner flag.

---

## Coverage by protocol surface

| Surface | Scenario files | Current grade | Remaining gaps |
|---|---|---|---|
| Discovery and capability handshake | `discovery.test.ts`, `runtime-capabilities.test.ts`, `profileDerivation.test.ts`, `mcp-discoverability.test.ts` | A | `Capabilities-Etag` optional runtime shape is covered; scoped discovery and non-HTTP handoff remain host-advertised follow-ups. |
| Auth and errors | `auth.test.ts`, `errors.test.ts`, `policies.test.ts`, `providerPolicyEnforcement.test.ts` | B | OAuth2, API-key rotation, mTLS, richer scope matrix. |
| Run lifecycle | `runs-lifecycle.test.ts`, `failure-path.test.ts`, `cancellation.test.ts`, `eventOrdering.test.ts`, `restart-during-run.test.ts` | A | Restart-during-run scenario shipped; gated under `openwop-production` profile (RFC 0009). |
| Idempotency and retry | `idempotency.test.ts`, `idempotencyRetry.test.ts`, `highConcurrency.test.ts` | A- | Long retention proof beyond the fast CI window. |
| Interrupts | `interrupt-approval.test.ts`, `interrupt-clarification.test.ts`, `approval-payload.test.ts`, `interruptRace.test.ts`, `interrupt-quorum-resolution.test.ts`, `interrupt-external-event-correlation.test.ts`, `interrupt-auth-required-resume.test.ts`, `interrupt-parent-child-cascade.test.ts` | A− | All four optional profile scenarios landed 2026-05-10. Remaining: positive end-to-end run against a host that advertises every profile. |
| Streaming | `stream-modes.test.ts`, `stream-modes-buffer.test.ts`, `stream-modes-mixed.test.ts`, `streamReconnect.test.ts` | A | Browser/proxy timeout matrix and long-running stream soak. |
| Replay and fork | `replay-fork.test.ts`, `replayDeterminism.test.ts`, `staleClaim.test.ts` | A- | Fork from arbitrary event types and retention-expiry behavior remain uncovered; retention/privacy/scoring semantics are now specified in `replay.md`. |
| Capabilities and limits | `cap-breach.test.ts`, `dispatchLoop.test.ts` | B+ | Clarification/schema/envelope cap-breach fixtures beyond node-execution cap. |
| State channels and reducers | `channel-ttl.test.ts` | B+ | Cross-adapter reducer consistency and conflict cases. |
| Sub-workflows and dispatch | `subworkflow.test.ts`, `multi-node-ordering.test.ts` | B+ | Parallel fan-out floors by scale tier, parent/child cancellation. |
| Node packs and registry | `pack-registry.test.ts`, `pack-registry-publish.test.ts`, `maliciousManifest.test.ts`, `wasm-pack-load.test.ts`, `wasm-pack-invoke-completed.test.ts`, `wasm-pack-invoke-suspended.test.ts`, `wasm-pack-replay-determinism.test.ts`, `wasm-pack-memory-cap.test.ts`, `wasm-pack-abi-version-rejection.test.ts` | A− | RFC 0008 WASM ABI scenarios landed 2026-05-10; gated on `capabilities.nodePackRuntimes.wasm.supported`. Remaining: hosted registry interoperability once `packs.openwop.dev` exists; deliberately-misbehaving pack for memory-cap + ABI-version-rejection positive paths. |
| Secrets and redaction | `redaction.test.ts`, `redactionAdversarial.test.ts`, `byok-roundtrip.test.ts` | A- | Cross-provider BYOK matrix and debug-bundle redaction under high volume. |
| Observability and diagnostics | `cost-attribution.test.ts`, `debugBundle.test.ts`, `otel-emission.test.ts`, `otel-trace-propagation.test.ts` | B+ | OTLP/HTTP-JSON receiver harness now wired; opt-in via `OPENWOP_OTEL_COLLECTOR=true`. Remaining: real-OTLP-protobuf path, metric-emission scenario, debug-bundle truncation. |
| Fixtures and corpus validity | `fixtures-valid.test.ts`, `fixtures-gating.test.ts`, `spec-corpus-validity.test.ts` | A | Keep fixture manifest synchronized as new optional profiles land. |
| Run control — pause/resume | `pause-resume.test.ts` | B | Lifecycle + 409-on-non-paused covered; remaining: pause-during-suspend race, immediate-vs-drain-current-node policy assertion. |
| Rate-limit envelope | `rate-limit-envelope.test.ts` | B− | Shape validation when 429 observed; remaining: deterministic 429-induction harness so the scenario reliably triggers under CI. |
| Per-workflow `configurableSchema` | `configurable-schema.test.ts` | C+ | Negative validation covered; remaining: positive accepted-overlay scenario + `GET /v1/workflows/{id}` schema surface assertion. |
| Append-reducer ordering | `append-ordering.test.ts` | B | Intra-engine sequence-order check; remaining: cross-engine ordering under a multi-engine fixture. |
| Webhook signature algorithms | `webhook-sig-algorithm.test.ts`, `webhook-signed-delivery.test.ts`, `webhook-negative.test.ts` | A− | Discovery shape covered; end-to-end signed delivery with HMAC verification (`webhook-signed-delivery`); negative paths: SSRF guard, validation, unknown-unregister (`webhook-negative`). Remaining: HMAC mismatch + replay-attack rejection on the receiver side (not host-testable from black-box). |
| Audit-log integrity profile | `audit-log-integrity.test.ts` | A− | Profile claim + `/v1/audit/verify` shape + checkpoint-signature verification; chain re-walk with `chainValid` and `checkpointsValid` bits. Tamper detection covered host-internally at `examples/hosts/sqlite/test/audit-tamper.test.ts` (mutate-entry + forge-signature paths). Remaining: cross-host checkpoint export so an out-of-band verifier can re-anchor against the same chain. |
| Multi-region idempotency capability | `multi-region-idempotency.test.ts` | C | Discovery enum coverage; remaining: cross-region partition simulation (requires multi-region harness). |
| Public hosted registry (`packs.openwop.dev`) | `registry-public.test.ts` | A− | Discovery, index, and per-pack manifest assertions against the public registry. Opt-in via `OPENWOP_TEST_PUBLIC_REGISTRY=true` so default conformance runs don't depend on outbound `packs.openwop.dev` reachability. Remaining: tarball-fetch + signature-verify roundtrip. |

---

## Capability-gated scenarios: shape vs behavior

Eleven scenarios (or scenario groups) validate optional profiles where the host's discovery advertisement is well-formed (shape grade) but no reference host yet implements the profile end-to-end (behavior grade is `host-pending`). Default suite runs skip these with a warning; set `OPENWOP_REQUIRE_BEHAVIOR=true` to convert skips into hard failures.

| Scenario | Profile / capability | Shape grade | Behavior grade | Behavior-unlock dependency |
|---|---|---|---|---|
| `audit-log-integrity.test.ts` | `openwop-audit-log-integrity` (`auth-profiles.md`) | A− (discovery + verify endpoint shape) | `host-pending` | Track 1.1 — SQLite host implements hash-chain + signed checkpoints |
| `rate-limit-envelope.test.ts` | normative `429` envelope (`rest-endpoints.md`) | B− (observational — checks shape when 429 fires) | `host-pending` | Deterministic 429-induction harness (e.g., `OPENWOP_FORCE_RATE_LIMIT=true` on a test-only key) |
| `multi-region-idempotency.test.ts` | `capabilities.idempotency.crossRegion` (`idempotency.md`) | C (enum shape only) | `host-pending` | Multi-region host fixture; cross-region partition simulation |
| `configurable-schema.test.ts` | per-workflow `configurableSchema` (`run-options.md`) | C+ (negative validation) | `host-pending` | Positive accepted-overlay scenario + `GET /v1/workflows/{id}` schema surface |
| `webhook-sig-algorithm.test.ts` | `X-openwop-Signature-Algorithm: v1` (`webhooks.md`) | C+ (discovery shape) | `host-pending` | End-to-end signed delivery against a test receiver |
| `pause-resume.test.ts` | `pauseRun` / `resumeRun` lifecycle (`rest-endpoints.md`) | B (lifecycle + 409-on-non-paused) | partial | Pause-during-suspend race; immediate-vs-drain policy assertion |
| `append-ordering.test.ts` | `append` reducer ordering (`channels-and-reducers.md`) | B (intra-engine) | partial | Cross-engine multi-engine fixture |
| `otel-emission.test.ts` | `openwop.*` OTel spans (`observability.md`) | B+ (OTLP/HTTP-JSON only) | partial | OTLP/protobuf path + metric-emission scenario |
| `otel-trace-propagation.test.ts` | W3C trace-context propagation (`observability.md`) | B (trace continuity across `runs:fork` + interrupt resolve) | partial | Cross-host propagation across `core.subWorkflow` invocation |
| `wasm-pack-*.test.ts` (six scenarios) | `capabilities.nodePackRuntimes.wasm` (`RFCS/0008`) | A− (load + invoke + replay + memory cap + ABI version) | partial | Deliberately-misbehaving pack for memory-cap + ABI-version-rejection positive paths |
| `production-backpressure.test.ts`, `production-retention-expiry.test.ts`, `restart-during-run.test.ts`, `staleClaim.test.ts`, `debug-bundle-truncation.test.ts`, `idempotency.test.ts`, `idempotencyRetry.test.ts` (seven scenarios) | `openwop-production` (`production-profile.md`, RFC 0009) | A− (capability shape + 503 envelope under saturation + discovery-exemption; durable-restart + debug-bundle-truncation predicates exercised end-to-end; retention-expiry envelope soft-skipped pending RFC 0009 Q#1) | host-pass | Postgres reference host advertises `capabilities.production.supported: true` since 2026-05-11 and passes all 11 assertions across the 5 non-opt-in scenarios under `OPENWOP_REQUIRE_BEHAVIOR=true` with `--no-file-parallelism` (the backpressure scenario saturates the inflight cap; parallel file execution collides with `idempotencyRetry.test.ts`'s burst). RFC 0009 unresolved questions #1 (force-expire endpoint normation) + #3 (inflightCap vs probing) gate the path to A. |

Strict-mode runner usage:

```bash
OPENWOP_REQUIRE_BEHAVIOR=true npx vitest run
```

The flag is read at scenario startup via `conformance/src/lib/env.ts` → `loadEnv().requireBehavior`. Scenarios use the `behaviorGate(profileName, advertised)` helper from `conformance/src/lib/behavior-gate.ts` so the strict-mode failure message cites the relevant spec section. `audit-log-integrity.test.ts` is the worked example as of 2026-05-11; the remaining nine scenarios will adopt the helper as their host-side profiles land (tracked in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Phase-1 tracks T1.1 onward).

---

## Endpoint Coverage Manifest

Every OpenAPI operation should have:

1. At least one positive scenario.
2. At least one auth failure scenario where auth applies.
3. At least one validation or conflict scenario where the operation accepts input.
4. A cited spec section in each assertion message.

| Operation ID | Positive coverage | Negative / auth / validation coverage | Gap |
|---|---|---|---|
| `getCapabilities` | `discovery.test.ts`, `runtime-capabilities.test.ts`, `profileDerivation.test.ts`, `mcp-discoverability.test.ts` | `discovery.test.ts` covers optional `Capabilities-Etag`; `spec-corpus-validity.test.ts` validates schema shape | Add scoped discovery scenario when a host advertises it. |
| `getOpenApiSpec` | `discovery.test.ts` | `spec-corpus-validity.test.ts` validates OpenAPI refs | Add unavailable/transient error scenario only if host can simulate it. |
| `getWorkflow` | `route-coverage.test.ts`; fixture-dependent lifecycle tests indirectly require seeded workflow IDs | `route-coverage.test.ts` covers unknown workflow `404`/`403` envelope | Good. |
| `createRun` | `runs-lifecycle.test.ts`, `identity-passthrough.test.ts`, `failure-path.test.ts`, fixture scenarios | `auth.test.ts`, `errors.test.ts`, `idempotency.test.ts`, `idempotencyRetry.test.ts` | Strong baseline; add per-field validation matrix. |
| `getRun` | Lifecycle, cancellation, interrupt, replay, and subworkflow tests poll snapshots | `failure-path.test.ts`, `errors.test.ts` | Add explicit unknown-run `404` scenario if not already covered through helper assertions. |
| `streamRunEvents` | `stream-modes.test.ts`, `stream-modes-buffer.test.ts`, `stream-modes-mixed.test.ts`, `streamReconnect.test.ts` | Unsupported mode and invalid buffer assertions | Add long-running proxy timeout soak outside fast CI. |
| `pollRunEvents` | `multi-node-ordering.test.ts`, `version-negotiation.test.ts`, redaction tests | Past-end and validation assertions | Good. Add malformed `lastSequence` if missing. |
| `cancelRun` | `cancellation.test.ts` | Unknown/terminal idempotency cases partial | Add explicit already-terminal cancel behavior. |
| `pauseRun` | Lifecycle scenarios cover paused state via `runs-lifecycle.test.ts` (`run.paused` event projection) | None dedicated yet | Add explicit `pauseRun` route exerciser (running → paused, paused → resumed, error envelope on terminal target). |
| `resumeRun` | Lifecycle scenarios cover resumed state via `runs-lifecycle.test.ts` (`run.resumed` event projection) | None dedicated yet | Add explicit `resumeRun` route exerciser (paused → running, error envelope on running / terminal target). |
| `forkRun` | `replay-fork.test.ts`, `replayDeterminism.test.ts` | Negative `fromSeq`, past-end, unknown source, invalid overlay | Add arbitrary-event fork and retention-expired source. |
| `resolveInterruptByRun` | `interrupt-approval.test.ts`, `interrupt-clarification.test.ts`, `approval-payload.test.ts`, `interruptRace.test.ts` | Invalid action, unknown node, race cases | Add auth-required and quorum profile scenarios. |
| `inspectInterruptByToken` | Interrupt token coverage partial | Missing explicit token-inspect matrix | Add expired, malformed, and already-resolved token cases. |
| `resolveInterruptByToken` | Interrupt token coverage partial | Missing explicit token-resolve matrix | Add expired, malformed, wrong-action, and replayed-token cases. |
| `getArtifact` | Indirect through approval payload fixtures | `route-coverage.test.ts` covers unknown artifact `404`/`403` envelope | Add positive artifact read and explicit scope failure scenarios. |
| `registerWebhook` | Webhook spec exists | `route-coverage.test.ts` covers invalid URL validation envelope | Add positive registration with a test receiver when harness support exists. |
| `unregisterWebhook` | Webhook spec exists | `route-coverage.test.ts` covers unknown subscription behavior | Add full register-then-unregister roundtrip with a test receiver. |

---

## Gap closure plan

| Priority | Work item | Target docs |
|---|---|---|
| P0 | Add production-profile scenarios for backpressure envelope, retry durability, stale-claim recovery, and debug-bundle truncation. | `production-profile.md`, `scale-profiles.md`, `storage-adapters.md`, `debug-bundle.md` |
| P1 | Add auth-profile scenarios for API-key rotation and OAuth2 client-credentials where test issuer metadata is available. | `auth.md`, `auth-profiles.md` |
| ✅ done | Interrupt-profile scenarios for quorum, external-event, auth-required, and parent/child cascade — landed 2026-05-10. | `interrupt.md`, `interrupt-profiles.md` |
| P1 | Convert endpoint manifest into generated coverage evidence from `api/openapi.yaml` operation IDs. | `rest-endpoints.md` |
| ✅ done | MCP and A2A synthetic-peer roundtrip scenarios landed 2026-05-10 (`mcp-tool-roundtrip.test.ts`, `a2a-task-roundtrip.test.ts`); opt-in via `OPENWOP_MCP_FAKE_SERVER=true` / `OPENWOP_A2A_FAKE_PEER=true`. | `mcp-integration.md`, `a2a-integration.md` |
| P2 | Add replay retention and fork-from-arbitrary-event coverage. | `replay.md` |
| P1 | Deterministic 429-induction harness so `rate-limit-envelope.test.ts` triggers reliably under CI (currently observational). | `rest-endpoints.md` |
| P1 | Add tamper-detection scenario for `audit-log-integrity.test.ts` — requires admin write access to the host's audit store. | `auth-profiles.md` |
| P2 | Cross-engine append-ordering scenario (multi-engine fixture). | `channels-and-reducers.md` |
| P2 | End-to-end webhook signed-delivery test exercising `X-openwop-Signature-Algorithm: v1`. | `webhooks.md` |
| P2 | Conformance scenarios that cite normative RFC docs (not just schemas) for the multi-agent surfaces. | RFCS/0002–0007 |
