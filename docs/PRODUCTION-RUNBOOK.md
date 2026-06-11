# OpenWOP Production-Profile Runbook

> OPS-1 from `plans/openwop-protocol-gap-closure-plan.md`. Operator playbook for booting an OpenWOP host that honors `openwop-production` per [RFC 0009](../RFCS/0009-production-profile-conformance.md). Lets you reproduce the production claim locally before deploying.

The production profile is a behavioral contract, not just a string in your capabilities advertisement. This page is the operator's checklist for satisfying it.

If you're building a new host, see [`docs/IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md) first. This page assumes you've shipped the basics and want to claim `openwop-production`.

---

## What `openwop-production` requires

Per [`spec/v1/production-profile.md`](../spec/v1/production-profile.md) (RFC 0009), a host claiming the profile MUST:

1. **Backpressure with 503 + Retry-After** — when in-flight runs exceed the host's advertised cap, `POST /v1/runs` returns 503 with a `Retry-After` header.
2. **Event-log retention sweeper** — events older than the advertised retention window are eligible for garbage collection per [`replay.md`](../spec/v1/replay.md) §"Retention and garbage collection".
3. **Claim acquisition + crash recovery** — runs are owned by a single host process at a time; orphaned runs are reclaimed by a peer.
4. **Audit-log integrity** — hash-chained event log with Ed25519 checkpoint signatures per [`auth-profiles.md`](../spec/v1/auth-profiles.md) §"openwop-audit-log-integrity".
5. **Production logs** — structured terminal-run logs with `runId` + `status` + `errorCode` + `durationMs`.
6. **Every claimed auth profile passes under strict mode** — no claiming-without-implementing.

The reference implementation is the Postgres host at [`examples/hosts/postgres/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/postgres). The rest of this page distills its operator-facing surface.

---

## Boot a production claim locally

```bash
# 1. Required production env vars
export OPENWOP_PG_DSN=postgresql://...   # real Postgres OR `pglite` (test only)
export OPENWOP_API_KEY=hk_live_<value>
export OPENWOP_AUDIT_KEY_DIR=/var/lib/openwop/keys

# 2. Optional auth-extension profiles (advertise only what you wire)
export OPENWOP_SECONDARY_API_KEY=hk_rotation_overlap   # advertises openwop-auth-api-key-rotation
export OPENWOP_TENANT2_API_KEY=hk_tenant2              # advertises openwop-discovery-auth-scoped
export OPENWOP_OAUTH2_ISSUER_URL=https://auth.example.com/
export OPENWOP_OAUTH2_AUDIENCE=https://your-host.example.com
export OPENWOP_OIDC_ISSUER_URL=https://accounts.example.com/
export OPENWOP_OIDC_AUDIENCE=https://your-host.example.com
export OPENWOP_MTLS_CERT_PATH=/etc/openwop/mtls/server.crt
export OPENWOP_MTLS_KEY_PATH=/etc/openwop/mtls/server.key
export OPENWOP_MTLS_CA_PATH=/etc/openwop/mtls/ca.bundle
export OPENWOP_MTLS_REQUIRED=true

# 3. Optional capability surfaces
export OPENWOP_MEMORY_COMPACTION=true                  # RFC 0012; only if you implement SR-1 carry-forward
export OPENWOP_AI_POLICY_OPENAI=optional               # 4-mode policy per host-capabilities.md §host.aiProviders
export OPENWOP_AI_POLICY_ANTHROPIC=optional
export OPENWOP_MCP_SERVER_<ID>=https://mcp.example.com # one env var per configured MCP server

# 4. Webhook signing
export OPENWOP_WEBHOOK_SIGNING_SECRET=hk_webhook_secret

# 5. Boot
cd examples/hosts/postgres
npm ci && npm run build && npm start
```

For an SDK quickstart against this host, see [`sdk/python/QUICKSTART.md`](https://github.com/openwop/openwop-sdks/blob/main/sdk/python/QUICKSTART.md) or [`sdk/go/QUICKSTART.md`](https://github.com/openwop/openwop-sdks/blob/main/sdk/go/QUICKSTART.md).

---

## Verify the claim with conformance

```bash
# Strict mode + opt-out the profiles you genuinely don't implement.
OPENWOP_BASE_URL=https://your-host.example.com \
OPENWOP_API_KEY=hk_test_for_conformance \
OPENWOP_REQUIRE_BEHAVIOR=true \
OPENWOP_OPTED_OUT_PROFILES=  \
npx openwop-conformance
```

The scenarios that MUST pass for an `openwop-production` claim:

- `production-backpressure.test.ts` — saturates inflight cap, expects 503 + Retry-After.
- `production-retention-expiry.test.ts` — verifies retention sweep envelope per `replay.md`.
- `audit-log-integrity.test.ts` — `/v1/audit/verify` + checkpoint signature verification.
- Each auth-extension profile scenario you claim (`auth-api-key-rotation.test.ts`, etc.).

Postgres reference numbers: 781 passed / 1 known flake / 38 skipped / 30 todo (850 total) per [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md). 91.9% total; 96.4% of applicable. The one documented failure (`webhook-signed-delivery`) passes in isolation and is a full-suite timing collision, not a host bug.

---

## Operational limits to advertise honestly

The Postgres reference host's discovery payload includes:

| Limit                             |      Default | What it controls                                              |
| --------------------------------- | -----------: | ------------------------------------------------------------- |
| `limits.envelopesPerTurn`         |           50 | Max envelopes in a single turn (anti-runaway-loop).           |
| `limits.maxNodeExecutions`        |         1000 | Hard cap on node executions per run; triggers `cap.breached`. |
| `limits.maxRunDurationSeconds`    |         3600 | Wall-clock cap per run.                                       |
| `limits.inflight.max`             |          100 | Max concurrent in-flight runs before 503 backpressure.        |
| `limits.retentionDays`            |            7 | Event-log retention window.                                   |
| `httpClient.maxResponseBodyBytes` |        1 MiB | SSRF-guard cap on `core.http.request` response bodies.        |
| `aiProviders.maxConcurrentCalls`  | per-provider | Operator-defined; advertise actual value.                     |

These map to env vars (`OPENWOP_LIMITS_*`) — see the Postgres host README for the full list. **Advertise what you actually enforce.**

---

## Strict-mode invocation matrix

The four reference hosts publish their strict-mode postures with explicit opt-outs:

| Host          | Required env for strict-mode green                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **In-memory** | `OPENWOP_OPTED_OUT_PROFILES=openwop-production,openwop-auth-*,openwop-discovery-auth-scoped,openwop-audit-log-integrity` — minimal posture, opts out of everything beyond the wire-core surface.     |
| **SQLite**    | `OPENWOP_OPTED_OUT_PROFILES=openwop-production,openwop-auth-oauth2-client-credentials,openwop-auth-oidc-user-bearer,openwop-auth-mtls,openwop-discovery-auth-scoped,openwop-replay-retention-expiry` |
| **Python**    | `OPENWOP_OPTED_OUT_PROFILES=<21 profiles>` — see INTEROP-MATRIX Python row.                                                                                                                          |
| **Postgres**  | `OPENWOP_REQUIRE_BEHAVIOR=true` with NO opt-outs (claims everything end-to-end).                                                                                                                     |

Production hosts claiming `openwop-production` should match Postgres's "no opt-outs" posture.

---

## Observability you should wire

Per [`observability.md`](../spec/v1/observability.md):

- **OTel traces** under the canonical `openwop.*` namespace. OTLP/HTTP-JSON, HTTP-protobuf, and gRPC all supported.
- **Metrics** (advertised under `capabilities.observability.metrics.names[]`):
  - `openwop.run.backlog`
  - `openwop.queue.depth`
  - `openwop.run.duration`
  - `openwop.idempotency.cross_region_conflicts_total` (only when claiming multi-region)
- **Structured logs**: at minimum a `run.terminal` event per run with `level` / `runId` / `workflowId` / `tenantId` / `status` / `errorCode` / `correlationId` / `timestamp` fields.

---

## What you check daily

- **Backpressure alert**: 503 rate vs your inflight cap.
- **Retention sweep**: events older than `retentionDays` are evicted on schedule.
- **Audit checkpoint cadence**: per the host's `checkpointIntervalEntries` + `checkpointIntervalSeconds` advertisement.
- **Audit-log re-anchor (CF-11)**: export checkpoints via the host's export helper + run `node scripts/verify-audit-checkpoints.mjs <bundle>` from an independent machine. Exit 0 = chain valid.
- **Webhook delivery success**: HMAC verification on the receiver side; circuit-breaker state.
- **SSE longevity (CF-10)**: run `node conformance/soak/sse-longevity.mjs` for 10–30 minutes against the host; alert when `longestQuietSeconds` exceeds the heartbeat interval or `reconnects > 0`.
- **Load profile (OPS-2)**: run `node conformance/soak/load-profile.mjs` against a non-prod replica before each release. Compare `p50`/`p95`/`p99` create-run latency to the prior release's baseline; alert on >2× regression.
- **Strict-mode conformance**: re-run weekly to catch drift.

---

## See also

- [`docs/IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md) — getting started.
- [`docs/PROFILE-DECISION-GUIDE.md`](./PROFILE-DECISION-GUIDE.md) — which profiles to claim.
- [`docs/IMPLEMENTATION-CERTIFICATION.md`](./IMPLEMENTATION-CERTIFICATION.md) — how to publish your evidence.
- [`spec/v1/production-profile.md`](../spec/v1/production-profile.md) — normative production-profile contract.
- [`examples/hosts/postgres/README.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/README.md) — reference host operator guide.
- [`examples/hosts/postgres/conformance-full.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/conformance-full.md) — current production-claim evidence.
