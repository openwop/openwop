# `@openwop/openwop-conformance` — Conformance Suite for the Multi-Agent Workflow Orchestration Protocol

**openwop is an open, wire-level protocol for multi-agent workflow orchestration** — a single contract for runs in which LLM agents, deterministic tools, sub-workflows, and human reviewers collaborate, with durable suspend / resume, replay, version negotiation, and observability owned by the protocol itself. This package is the black-box conformance suite: point it at any OpenWOP-compliant server (your own or a third party's) and it issues real HTTP requests against the spec'd endpoints and asserts that responses match.

```bash
npm install @openwop/openwop-conformance
# or run without install:
npx @openwop/openwop-conformance --base-url https://api.example.com --api-key hk_test_...
```

> **Spec:** [github.com/openwop/openwop](https://github.com/openwop/openwop) · See `CHANGELOG.md` below for release history.

The suite is intentionally self-contained — it does NOT depend on the reference implementation. A spec-compliant server written in any language can run this suite against itself by spinning up its server, exporting the env vars, and running `npx vitest run`.

> **Status:** Tracks the FINAL v1 protocol contract. The suite version evolves independently as new scenarios ship (vendor-neutral redaction, cost attribution, post-v1 ecosystem triggers); see [`CHANGELOG.md`](./CHANGELOG.md) for the current release.

---

## Quickstart

Two ways to run: the friendly `openwop-conformance` CLI (recommended for
operators) or `vitest` directly (recommended for CI).

### CLI

```bash
cd conformance
npm install

# Build the CLI binary
npm run build:cli

# Server-free subset (no deployment target needed)
./dist/cli.js --offline

# Full suite against a deployed server
./dist/cli.js \
  --base-url https://api.example.com \
  --api-key hk_test_abc123 \
  --impl acme-openwop-server --impl-version 1.0

# Filter by test-name pattern
./dist/cli.js --base-url ... --api-key ... --filter "discovery|errors"
```

`./dist/cli.js --help` for the full flag reference. Env vars
(`OPENWOP_BASE_URL`, `OPENWOP_API_KEY`, `OPENWOP_IMPLEMENTATION_*`) override CLI
flags only when the flag is unset.

### Direct vitest

```bash
cd conformance
npm install

export OPENWOP_BASE_URL="https://api.example.com"
export OPENWOP_API_KEY="hk_test_..."

npx vitest run                                 # full suite
npx vitest run src/scenarios/discovery.test.ts # single file
```

### Optional environment flags

| Variable | Effect |
|---|---|
| `OPENWOP_REQUIRE_BEHAVIOR=true` | Capability-gated scenarios (audit-log integrity, rate-limit envelope, multi-region idempotency, `configurableSchema`, webhook sig versioning, etc.) FAIL instead of skipping when the host doesn't advertise the profile. Lets a host claim "full coverage" mechanically. See [`coverage.md`](./coverage.md) §"Capability-gated scenarios". |
| `OPENWOP_TEST_PUBLIC_REGISTRY=true` | Runs `registry-public.test.ts` against the hosted registry at `packs.openwop.dev`. Skipped by default so the suite doesn't depend on outbound connectivity. |
| `OPENWOP_OTEL_COLLECTOR=true` | Boots the in-suite OTLP/HTTP-JSON collector for `otel-emission.test.ts`, `otel-trace-propagation.test.ts`, and `metric-emission.test.ts`. Skipped by default. **Run OTel scenarios with `--no-file-parallelism`** — each vitest worker spawns its own collector and only one can bind the same port, so concurrent file execution causes ephemeral-port fallbacks that don't receive the host's OTLP traffic. |
| `OPENWOP_OTEL_COLLECTOR_PORT=14318` | Bind the OTel collector on a specific port (default `4318`). The host MUST be configured with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<port>`. |
| `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true` | Hosts implementing the webhook SSRF guard (rejecting loopback / RFC1918 / link-local destinations) MUST advertise this flag for the loopback test receiver in `webhook-signed-delivery.test.ts` to be accepted. The SQLite reference host honors this env var; the scenario soft-skips when the host rejects the URL. |
| `OPENWOP_MCP_FAKE_SERVER=true` | Boots the synthetic MCP peer for `mcp-tool-roundtrip.test.ts`. |
| `OPENWOP_MCP_REAL_SERVER_URL=<base-url>` | Points the MCP wire-shape probe at a real MCP server. The probe POSTs JSON-RPC and reads a single-JSON response — matches MCP's `streamable-http` transport in single-response mode. **Does NOT support** stdio transport (which is what most `modelcontextprotocol/servers` references default to) or SSE-streamed responses; an operator collecting interop evidence today runs a custom `StreamableHTTPServerTransport`-style server that returns a single JSON body per request. Adding SSE-frame parsing is tracked in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` Track 6. Assertions relax to shape-only. When both this and `OPENWOP_MCP_FAKE_SERVER` are set, the real URL wins. Phase 3 T3.4 interop-evidence path. |
| `OPENWOP_A2A_FAKE_PEER=true` | Boots the synthetic A2A peer for `a2a-task-roundtrip.test.ts`. |
| `OPENWOP_A2A_REAL_PEER_URL=<base-url>` | Points the A2A AgentCard + task-lifecycle probe at a real reference A2A peer. Drift-point subtests (AUTH_REQUIRED / REJECTED) stay fake-peer-only — real peers don't expose a state-forcing API. Phase 3 T3.4 interop-evidence path. |
| `OPENWOP_FORCE_RATE_LIMIT=true` | Signals the host (test-only key) to fabricate a 429 so `rate-limit-envelope.test.ts` can exercise envelope shape deterministically. |

Exit code is non-zero on any failed assertion.

---

## What's Covered

The current suite has 98 scenario files under `src/scenarios/`. This includes 18 Multi-Agent Shift scenarios (Phases 1-5) added 2026-05-10, the `registry-public.test.ts` public-registry healthcheck added 2026-05-11 (opt-in via `OPENWOP_TEST_PUBLIC_REGISTRY=true`), the `replay-llm-cache-key.test.ts` placeholder added 2026-05-11 (three `it.todo()` cases for the cross-host LLM cache-key recipe per `replay.md` §"LLM cache-key recipe"), the two `production-*.test.ts` scenarios added 2026-05-11 for the `openwop-production` profile per RFC 0009 (`production-backpressure.test.ts`, `production-retention-expiry.test.ts`), and the four `auth-*.test.ts` scenarios added 2026-05-11/12 for the production-auth profiles per RFC 0010 (`auth-api-key-rotation.test.ts`, `auth-oauth2-client-credentials.test.ts`, `auth-oidc-user-bearer.test.ts`, `auth-mtls.test.ts` (opt-in via `OPENWOP_TEST_MTLS=1`)). The maintained scenario-to-spec map lives in [`coverage.md`](./coverage.md); this README keeps the operator quickstart and the historical scenario notes below.

High-level coverage includes:

- Server-free corpus checks for fixtures, JSON Schema, OpenAPI, AsyncAPI, and prose status metadata.
- Server-required checks for discovery, auth, error envelopes, run lifecycle, idempotency, cancellation, interrupts, streaming, replay/fork, version negotiation, storage failover, redaction, cost attribution, node-pack registry behavior, and optional profile derivation.
- Fixture-gated checks that skip cleanly unless the host advertises the corresponding fixture IDs.

## Historical Coverage Notes

Server-free (run anywhere, including CI without a deployment target):

| Category | Spec doc | Coverage |
|---|---|---|
| **Fixtures** | [`fixtures.md`](./fixtures.md) | Every fixture JSON in `fixtures/*.json` validates against `../schemas/workflow-definition.schema.json`; `id` matches filename; manual trigger present. (12 assertions) |
| **Spec corpus** | the whole `` tree | JSON Schemas compile under Ajv2020; OpenAPI 3.1 + AsyncAPI 3.1 YAMLs structurally valid + their `$ref`s resolve; every prose `.md` carries a `Status:` legend tag; `fixtures.md` ↔ `fixtures/*.json` round-trip is consistent. (24 assertions) |

Server-required (requires `OPENWOP_BASE_URL` + `OPENWOP_API_KEY` + seeded fixtures):

| Category | Spec doc | Coverage |
|---|---|---|
| **Discovery** | [`capabilities.md`](../spec/v1/capabilities.md) | `/.well-known/openwop` returns valid Capabilities shape with required fields; `Cache-Control` present; non-zero limits. |
| **Discovery** | [`rest-endpoints.md`](../spec/v1/rest-endpoints.md) | `/v1/openapi.json` returns a parseable OpenAPI 3.1 document. |
| **Auth** | [`auth.md`](../spec/v1/auth.md) | Missing/invalid API key returns `401` with canonical error envelope. |
| **Errors** | [`rest-endpoints.md`](../spec/v1/rest-endpoints.md) | All error responses share the `{error, message, details?}` envelope. |
| **Run lifecycle** | [`rest-endpoints.md`](../spec/v1/rest-endpoints.md) + [`fixtures.md`](./fixtures.md) | `POST /v1/runs` with `conformance-noop` fixture reaches terminal `completed` within bounded time. |
| **Idempotency** | [`idempotency.md`](../spec/v1/idempotency.md) | Same `Idempotency-Key` + same body replays (carries `openwop-Idempotent-Replay` header, returns same runId); same key + different body returns 409. |
| **Cancellation** | [`rest-endpoints.md`](../spec/v1/rest-endpoints.md) | `POST /v1/runs/{runId}/cancel` mid-flight on `conformance-cancellable` reaches terminal `cancelled` within 5s. |
| **HITL approval** | [`interrupt.md`](../spec/v1/interrupt.md) | `conformance-approval` suspends at `waiting-approval`; `{action: 'accept'}` resolve drives terminal `completed`. Invalid action and unknown nodeId return 400/422 and 404. |
| **HITL clarification** | [`interrupt.md`](../spec/v1/interrupt.md) | `conformance-clarification` suspends at `waiting-input`; `{answers: {q1: ...}}` resolve drives terminal `completed`. |
| **Failure path** | [`rest-endpoints.md`](../spec/v1/rest-endpoints.md) | `conformance-failure` reaches terminal `failed`; `RunSnapshot.error` is `{code: string, message: string}`. |
| **Identity passthrough** | [`fixtures.md`](./fixtures.md) | `conformance-identity` deep-equals nested JSON input through `inputs.payload` → `variables.payload`. |
| **Multi-node ordering** | [`fixtures.md`](./fixtures.md) | `conformance-multi-node` emits `node.completed` events for nodeIds a, b, c in topological order via `event.sequence`. Exercises `GET /v1/runs/{runId}/events/poll`. |
| **Stream modes** | [`stream-modes.md`](../spec/v1/stream-modes.md) | `updates` mode emits `run.started` + `run.completed` and the server closes on terminal; unsupported `streamMode` returns 400 with `supported` array; `debug` mode event count ≥ `updates` mode. Uses `conformance-delay` and a hand-rolled SSE client. |
| **Replay / fork** | [`replay.md`](../spec/v1/replay.md) | `POST /v1/runs/{runId}:fork` from a finished `conformance-noop` run reaches terminal `completed` in both `replay` and `branch` modes. Validation: negative `fromSeq` → 400; `fromSeq` past source log → 422; `replay` + non-empty overlay → 400; fork on unknown run → 404. |
| **Version negotiation** | [`version-negotiation.md`](../spec/v1/version-negotiation.md) + [`run-event.schema.json`](../schemas/run-event.schema.json) | `Capabilities.protocolVersion` advertised; every persisted event carries the 6 required `RunEventDoc` fields (`eventId`, `runId`, `type`, `payload`, `timestamp`, `sequence`); per-run sequence is strictly monotonic; `events/poll?lastSequence=` past end returns 200+empty (not 4xx). Cross-version compat scenarios deferred — need server-controllable `engineVersion` releases. |

Server-required (added in 1):

| Category | Spec doc | Coverage |
|---|---|---|
| **Cap breach (recursion limit)** | [`run-options.md`](../spec/v1/run-options.md) §recursionLimit + [`observability.md`](../spec/v1/observability.md) §cap.breached | `conformance-cap-breach` with `configurable.recursionLimit: 3`: terminal `failed` with `error.code = "recursion_limit_exceeded"`; `cap.breached {kind: "node-executions", limit, observed, nodeId}` payload; cap.breached precedes run.failed in sequence; exactly `limit` `node.started` events emitted (over-limit node MUST NOT receive node.started). |

Server-required (added in 1.2.0):

| Category | Spec doc | Coverage |
|---|---|---|
| **Sub-workflow dispatch** | [`node-packs.md`](../spec/v1/node-packs.md) §Reserved Core openwop typeIds + [`fixtures.md`](./fixtures.md) §F2 | `conformance-subworkflow-parent` invokes `conformance-subworkflow-child` via `core.subWorkflow` with blocking dispatch + outputMapping. Asserts: parent reaches terminal `completed`; child variable propagates via outputMapping (`childOutcome === "child-completed"`); child run snapshot carries `parentRunId` + `parentNodeId` linkage; child reaches terminal `completed`. |

Server-required (added in 1.3.0):

| Category | Spec doc | Coverage |
|---|---|---|
| **Channel TTL** | [`channels-and-reducers.md`](../spec/v1/channels-and-reducers.md) §append + §TTL | `conformance-channel-ttl` writes 3 entries with `ttlMs: 200`, waits 300ms via `core.delay`, writes a 4th. Asserts: final `variables.events.length === 1`; surviving entry value `"d"`; entry carries numeric `_ts`. Validates the write-time TTL filter drops priors. |

Server-required (added in 1.4.0):

| Category | Spec doc | Coverage |
|---|---|---|
| **SSE buffering** | [`stream-modes.md`](../spec/v1/stream-modes.md) §Aggregation hint | `?bufferMs=` query parameter. Reuses `conformance-delay` fixture. Asserts: server accepts in-range value (0..5000) and emits `event: batch` SSE frames with array data; out-of-range `99999` returns 400 `validation_error`; force-flush on terminal events (run.completed bundled BEFORE the timer would fire); `bufferMs=0` behaves identically to omitting (per-event mode). |

Server-required (added in 1.5.0):

| Category | Spec doc | Coverage |
|---|---|---|
| **SSE mixed mode** | [`stream-modes.md`](../spec/v1/stream-modes.md) §Mixed mode | Comma-separated `?streamMode=` query. Reuses `conformance-delay` fixture. Asserts: server accepts `updates,messages` and emits server-closed stream containing run.completed; `values,updates` returns 400 `unsupported_stream_mode` (values is exclusive); `updates,bogus` returns 400 (partial-unknown lists fail wholesale); union semantics — `updates,debug` includes every event type `updates`-only includes. |

Placeholder (added in 1.6.0, gated on observable-span access):

| Category | Spec doc | Coverage |
|---|---|---|
| **Cost attribution** | [`observability.md`](../spec/v1/observability.md) §Cost attribution attributes | 5 `it.todo()` scenarios documenting the contract for `openwop.cost.*` OTel attributes (allowlist of 6 — provider, model, tokens.input, tokens.output, usd, duration_ms; redaction enforcement). Runs when a deployed reference exposes OTel spans or surfaces cost via the run snapshot. Runtime side + redaction unit tests are shipped. |

Server-required (added in 1.7.0):

| Category | Spec doc | Coverage |
|---|---|---|
| **Redaction** | [`capabilities.md`](../spec/v1/capabilities.md) §"Secrets" + NFR-7 + §"aiProviders" | Vendor-neutral assertions that the server doesn't leak secret material. Three scenario groups: (a) discovery shape contract — `secrets` + `aiProviders` advertisements are well-formed regardless of `secrets.supported`; when `supported === true`, scopes MUST be non-empty + `resolution === 'host-managed'`; `byok ⊆ supported`. (b) bearer-token redaction — invalid Bearer canary in `Authorization` header is not echoed in the 401 response body. (c) credentialRef echo control — gated on `secrets.supported === true`; canary planted in `configurable.ai.credentialRef` MUST NOT appear in any RunEvent payload (poll-based capture; transport-agnostic). Uses runtime-built canary fixtures (`lib/canaries.ts`) that defeat static secret scanners. 6 scenarios. |

Current source tree: 98 scenario files. Use [`coverage.md`](./coverage.md) for current grade/gap tracking.

## Remaining Gaps

| Gap | Why it remains |
|---|---|
| `values` mode `state.snapshot` payload | Schema is implementation-shaped per spec gap S1 (`stream-modes.md`); cross-impl assertions blocked until schema firms up. |
| `messages` mode AI chunks | Needs server-side AI provider mock (fixture spec gap F1 in `fixtures.md`). |
| Cross-version compat | Needs server-controllable `engineVersion` cycle to test forward-fold-best-effort. |
| Capability-limit fixtures | Needs fixtures that deliberately exceed `clarificationRounds` / `schemaRounds` / `envelopesPerTurn` to assert `cap.breached` shape beyond the shipped node-execution cap case. |
| Auth profiles | Capability-shape scenarios for `openwop-auth-api-key-rotation`, `openwop-auth-oauth2-client-credentials`, `openwop-auth-oidc-user-bearer`, and `openwop-auth-mtls` (opt-in) shipped 2026-05-11/12 under RFC 0010, with a synthetic OIDC issuer harness at `conformance/src/lib/oidc-issuer.ts`. Remaining: live-IdP positive-path validation against at least one reference host. |
| Production profile | Capability-shape scenarios shipped 2026-05-11 (`production-backpressure.test.ts`, `production-retention-expiry.test.ts`) under RFC 0009; durability + debug-bundle truncation predicates covered by re-labeled `restart-during-run.test.ts`, `staleClaim.test.ts`, `debug-bundle-truncation.test.ts`. Remaining: end-to-end behavior validation against a host advertising `capabilities.production.supported: true` under `OPENWOP_REQUIRE_BEHAVIOR=true`. |

---

## Repo layout

```
conformance/
  README.md                    — this file
  fixtures.md                  — standardized fixture-workflow contract
  fixtures/                    — canonical WorkflowDefinition JSONs (servers seed verbatim)
    conformance-noop.json
    conformance-identity.json
    conformance-delay.json
    conformance-failure.json
    conformance-approval.json
    conformance-clarification.json
    conformance-multi-node.json
    conformance-idempotent.json
    conformance-cancellable.json
  package.json                 — @openwop/openwop-conformance package manifest
  vitest.config.ts             — test runner config
  tsconfig.json                — strict TypeScript
  src/
    lib/
      driver.ts                — OpenWOP driver class (auth, request helpers, response asserts)
      env.ts                   — env-var validation + defaults
      polling.ts               — pollUntil/pollUntilStatus/pollUntilTerminal helpers
      sse.ts                   — minimal native-fetch SSE client (no eventsource dep)
    scenarios/
      fixtures-valid.test.ts            — fixture JSONs validate against workflow-definition schema (no server)
      discovery.test.ts                 — /.well-known/openwop + /v1/openapi.json
      auth.test.ts                      — 401 / 403 envelopes
      errors.test.ts                    — error envelope shape
      runs-lifecycle.test.ts            — POST /v1/runs + terminal status (uses conformance-noop)
      idempotency.test.ts               — same key replay + body-mismatch 409 (uses conformance-idempotent)
      cancellation.test.ts              — :cancel mid-flight (uses conformance-cancellable)
      interrupt-approval.test.ts        — accept/reject + invalid action + unknown node (uses conformance-approval)
      interrupt-clarification.test.ts   — answers payload resume (uses conformance-clarification)
      failure-path.test.ts              — terminal `failed` + RunSnapshot.error shape (uses conformance-failure)
      identity-passthrough.test.ts      — nested JSON round-trip (uses conformance-identity)
      multi-node-ordering.test.ts       — node.completed sequence in DAG order (uses conformance-multi-node + events/poll)
      stream-modes.test.ts              — updates termination + 400 unsupported-mode + debug ⊇ updates (uses conformance-delay + SSE)
      replay-fork.test.ts               — :fork in replay + branch modes + 4 validation paths (uses conformance-noop)
      version-negotiation.test.ts       — protocolVersion + RunEventDoc shape + monotonic sequence + events/poll forward-compat
      spec-corpus-validity.test.ts      — server-free meta-check that the whole spec corpus is internally consistent
```

---

## How to extend

Add a new scenario file under `src/scenarios/<category>.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver';

describe('my-spec-category', () => {
  it('does the thing per spec section 4.2', async () => {
    const res = await driver.get('/v1/some-endpoint');
    expect(res.status).toBe(200);
    // ... spec-derived assertions
  });
});
```

Each `expect(...)` should have a corresponding spec quote in the assertion message so failures cite the requirement, not just "expected X got Y".

---

## Future: publishable npm package

Once the suite stabilizes, this directory will be extracted to its own repo and published as `@openwop/openwop-conformance`. Until then, `npm install` is run from this subdirectory only — it is intentionally NOT a workspace member of the parent monorepo so its deps don't pollute the impl's lockfile.

## References


- Spec corpus: `../README.md`
- OpenAPI: `../api/openapi.yaml`
- AsyncAPI: `../api/asyncapi.yaml`
- JSON Schemas: `../schemas/`
