# OpenWOP Conformance Coverage Map

> **Status: Living document. Updated 2026-05-10.** This map connects the current scenario files to the protocol surfaces they protect and records the remaining gaps from the protocol deep dive. Scenario names are source-of-truth file names under `conformance/src/scenarios/`.

---

## Coverage by protocol surface

| Surface | Scenario files | Current grade | Remaining gaps |
|---|---|---|---|
| Discovery and capability handshake | `discovery.test.ts`, `runtime-capabilities.test.ts`, `profileDerivation.test.ts`, `mcp-discoverability.test.ts` | A | `Capabilities-Etag` optional runtime shape is covered; scoped discovery and non-HTTP handoff remain host-advertised follow-ups. |
| Auth and errors | `auth.test.ts`, `errors.test.ts`, `policies.test.ts`, `providerPolicyEnforcement.test.ts` | B | OAuth2, API-key rotation, mTLS, richer scope matrix. |
| Run lifecycle | `runs-lifecycle.test.ts`, `failure-path.test.ts`, `cancellation.test.ts`, `eventOrdering.test.ts` | A- | Restart-during-run production scenario. |
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
| Webhook signature algorithms | `webhook-sig-algorithm.test.ts` | C+ | Discovery shape covered; remaining: end-to-end signed delivery exercising `X-openwop-Signature-Algorithm: v1`. |
| Audit-log integrity profile | `audit-log-integrity.test.ts` | C+ | Profile claim + `/v1/audit/verify` shape covered; remaining: tamper-detection scenario (requires admin access to host's audit store) + multi-checkpoint chain verification. |
| Multi-region idempotency capability | `multi-region-idempotency.test.ts` | C | Discovery enum coverage; remaining: cross-region partition simulation (requires multi-region harness). |

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
