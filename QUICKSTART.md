# openwop Quickstart

> **Status: FINAL v1 (2026-04-29).** End-to-end developer onboarding guide covering discovery, auth, run lifecycle, live event delivery (SSE + webhooks), time-travel debugging via fork, BYOK + RunOptions, node-pack authoring, conformance, SDKs, and storage adapters. Cross-references the canonical specs for full normative detail. See `auth.md` for the status legend.

> **Audience:** developers integrating with an OpenWOP-compliant server for the first time.
> **Prerequisites:** an API key issued by your OpenWOP host (see [`auth.md`](./spec/v1/auth.md)) and the server's base URL.
> **Time to first run:** ~5 minutes.

This guide walks through the most common OpenWOP workflows end-to-end: calling a server, receiving live events, debugging via fork, building a node pack, and certifying your implementation. Each section links to the canonical spec doc for the full normative detail.

---

## 1. Discovery — what does this server support?

Every openwop server exposes a discovery endpoint at `/.well-known/openwop` that advertises its capabilities, supported transports, limits, and (for hosts that opt in) BYOK + secret-resolution surfaces.

```bash
curl https://your-openwop-server.example/.well-known/openwop
```

Response (abbreviated):

```json
{
  "protocolVersion": "1.0",
  "supportedEnvelopes": ["prd.create", "theme.create"],
  "limits": {
    "clarificationRounds": 3,
    "maxNodeExecutions": 1000
  },
  "extensions": {
    "implementation": { "name": "example-openwop-host", "version": "1.0", "vendor": "example-host" }
  }
}
```

The `protocolVersion: "1.0"` confirms wire-level compatibility. Clients SHOULD verify this before sending any other request.

📖 **Read:** [`capabilities.md`](./spec/v1/capabilities.md) for the full handshake shape, the network-handshake superset (BYOK, runtime capabilities, observability), and the `/v1/openapi.json` self-describing spec endpoint.

---

## 2. Auth — getting your first request through

openwop uses bearer-token auth. The token format is implementation-defined; the reference impl uses `hk_` (production) and `hk_test_` (test-mode) prefixes.

```bash
curl -X POST https://your-openwop-server.example/v1/runs \
  -H "Authorization: Bearer hk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"workflowId": "my-workflow", "tenantId": "your-workspace"}'
```

📖 **Read:** [`auth.md`](./spec/v1/auth.md) for the API-key + scope vocabulary (`manifest:read`, `runs:create`, `runs:read`, `runs:cancel`, `artifacts:read`, `webhooks:manage`, `approvals:respond`).

---

## 3. Create a run and read its snapshot

The canonical run-creation flow is `POST /v1/runs`:

```bash
curl -X POST https://your-openwop-server.example/v1/runs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "campaign-orchestration",
    "tenantId": "ws-acme",
    "scopeId": "campaign-2026-q2",
    "inputs": {"briefId": "brief_42"}
  }'
```

Response: `201 Created` with `{runId, status, eventsUrl}`.

Read the run's projected snapshot at any time:

```bash
curl https://your-openwop-server.example/v1/runs/$RUN_ID \
  -H "Authorization: Bearer $TOKEN"
```

Response: `RunSnapshot` (see [`schemas/run-snapshot.schema.json`](./schemas/run-snapshot.schema.json)) with `runId`, `workflowId`, `status`, `currentNodeId`, `nodeStates`, `variables`, `error?`, `metrics?`.

📖 **Read:** [`rest-endpoints.md`](./spec/v1/rest-endpoints.md) for the full endpoint catalog including cancel (`POST /v1/runs/{runId}/cancel`), interrupt resolve (`POST /v1/runs/{runId}/interrupts/{nodeId}`), and artifact read (`GET /v1/runs/{runId}/artifacts/{artifactId}`).

---

## 4. Receive live events

openwop offers two complementary paths for live-event delivery:

### SSE (browser, CLI, live UI)

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  "https://your-openwop-server.example/v1/runs/$RUN_ID/events?streamMode=updates"
```

Modes: `updates` (default — terminal node transitions, suspensions, run lifecycle), `values` (full `RunSnapshot` after every transition), `messages` (LLM token chunks for chat UIs), `debug` (every event including internals). Mixed-mode supported via comma-separated list (`?streamMode=updates,messages`); `values` MUST NOT combine with another mode.

Optional aggregation: `?bufferMs=100` batches events into `event: batch` SSE deliveries with JSON-array `data:`.

📖 **Read:** [`stream-modes.md`](./spec/v1/stream-modes.md) for the full mode → event mapping table + `bufferMs` aggregation rules + Last-Event-ID resume.

### Webhooks (server-to-server, async integrations)

Register a subscription:

```bash
curl -X POST https://your-openwop-server.example/v1/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://my-app.example/openwop-webhook",
    "events": ["run.completed", "run.failed", "approval.requested"],
    "tenantId": "ws-acme"
  }'
```

Response includes a `secret` returned ONCE. Verify each delivery with:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: Buffer, headers: Record<string,string>, secret: string): boolean {
  const ts = Number(headers['x-openwop-timestamp']);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false; // ±5 min replay window
  const sig = headers['x-openwop-signature']?.replace('sha256=', '') ?? '';
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return expected.length === sig.length &&
         timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
}
```

📖 **Read:** [`webhooks.md`](./spec/v1/webhooks.md) for the full subscription contract, signing scheme, circuit-breaker semantics, and best-effort delivery guarantees.

---

## 5. Time-travel debugging — fork a run

Hit a bug? Fork the run from any point in its event log and re-execute (or branch with edits):

```bash
# Replay deterministically from sequence 5
curl -X POST "https://your-openwop-server.example/v1/runs/$RUN_ID:fork" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fromSeq": 5, "mode": "replay"}'

# Branch with an inputs override (creates a new non-deterministic run)
curl -X POST "https://your-openwop-server.example/v1/runs/$RUN_ID:fork" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromSeq": 5,
    "mode": "branch",
    "runOptionsOverlay": {"configurable": {"temperature": 0.2}}
  }'
```

Replay reads the source's `InvocationLog` so deterministic node outputs are reproduced verbatim — cache misses emit informational `replay.diverged` events. Branch starts fresh execution from the folded state.

Response: `201 Created` with `{runId, sourceRunId, fromSeq, mode, status, eventsUrl}`. Subscribe to the new run's events via the returned `eventsUrl`.

📖 **Read:** [`replay.md`](./spec/v1/replay.md) for determinism guarantees, the `replay.diverged` event semantics, and the Run Timeline View (admin UI for visualizing event logs + jump-to-fork).

---

## 6. Configure runs via `RunOptions.configurable`

Override workflow parameters per-run without changing the workflow definition:

```bash
curl -X POST https://your-openwop-server.example/v1/runs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "campaign-orchestration",
    "tenantId": "ws-acme",
    "configurable": {
      "ai.provider": "anthropic",
      "ai.model": "claude-opus-4-7",
      "ai.credentialRef": "secret_a3b9c2",
      "recursionLimit": 500
    },
    "tags": ["production", "q2-launch"],
    "metadata": {"requestedBy": "alice@acme.example"}
  }'
```

Reserved keys (per [`run-options.md`](./spec/v1/run-options.md)): `recursionLimit`, `model`, `temperature`, `maxTokens`, `promptOverrides`, `mockProvider` (test-keys-only), `ai.provider` / `ai.model` / `ai.credentialRef` (BYOK; gated on `Capabilities.aiProviders.byok`).

The `ai.credentialRef` field is an opaque host-issued reference; raw key material NEVER appears in the protocol surface. Servers reject mismatched-provider refs with `credential_forbidden`.

📖 **Read:** [`run-options.md`](./spec/v1/run-options.md) for the full reserved-keys table + BYOK semantics + tag-filter and metadata semantics.

---

## 7. Write a node pack

Node packs are versioned, signed, distributable bundles of `NodeModule`s. Author one when you want to ship a domain-specific node (Salesforce upsert, Stripe charge, etc.) for other workflows to consume.

Minimum viable manifest (`pack.json`):

```json
{
  "name": "vendor.acme.salesforce-tools",
  "version": "1.4.2",
  "engines": { "openwop": ">=1.0 <2.0.0" },
  "nodes": [
    {
      "typeId": "vendor.acme.salesforce.upsert",
      "version": "1.4.2",
      "category": "integration",
      "role": "side-effect",
      "capabilities": ["side-effectful", "mcp-exportable"],
      "configSchemaRef": "schemas/upsert.config.json",
      "inputSchemaRef":  "schemas/upsert.input.json",
      "outputSchemaRef": "schemas/upsert.output.json",
      "requiresSecrets": [
        { "id": "salesforce-oauth", "kind": "oauth-token", "scope": "tenant" }
      ]
    }
  ],
  "runtime": { "language": "javascript", "entry": "dist/index.js", "format": "esm" }
}
```

📖 **Read:** [`node-packs.md`](./spec/v1/node-packs.md) for the full manifest format, runtime languages (JS / Python / Go / WASM / remote), distribution + signing + content-addressing, and the registry HTTP API.

---

## 8. Certify your implementation

The `@openwop/openwop-conformance` package ships ~80 scenarios covering every spec doc. Run them against your server:

```bash
npm install --save-dev @openwop/openwop-conformance
npx openwop-conformance --base-url https://your-openwop-server.example --api-key $TOKEN
```

Scenarios are organized by spec section:
- **Auth + scopes** — `auth.md` enforcement
- **Idempotency** — `Idempotency-Key` semantics
- **Run lifecycle** — create / read / cancel / events / poll
- **HITL** — `interrupt.md` resolve flows
- **SSE** — `stream-modes.md` mode filtering + bufferMs
- **Replay/Fork** — `replay.md` `:fork` + `replay.diverged`
- **Webhooks** — register / fire / verify HMAC
- **Capabilities** — discovery + version-negotiation

📖 **Read:** [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the conformance-suite governance model + how to propose new scenarios.

---

## 9. SDKs

Reference SDKs ship pinned to spec v1 in [`sdk/`](./sdk/):

| Language | Package | Status |
|---|---|---|
| TypeScript | `@openwop/openwop` | ✅ FINAL v1 |
| Python | `openwop_client` | ✅ FINAL v1 |
| Go | `openwopclient` | ✅ FINAL v1 |

Each SDK provides:
- Typed client for `POST /v1/runs`, `GET /v1/runs/{id}`, `POST /v1/runs/{id}/cancel`, etc.
- SSE consumer with mode + bufferMs support; SDKs flatten `event: batch` arrays back into per-event yields.
- Webhook signing helpers (`verifySignature`).

---

## 10. Storage adapters (advanced)

Building an OpenWOP server? The `RunEventLogIO` + `SuspendIO` contracts let any storage backend plug in:

```typescript
// Import path varies by engine implementation. Substitute your engine package.
import { EventLog, InMemoryEventLogIO } from '@your-org/openwop-engine';

// Or your own Postgres / SQLite / Redis adapter conforming to RunEventLogIO
const io = new InMemoryEventLogIO();
const eventLog = new EventLog(io, { engineVersion: 1 });
```

📖 **Read:** [`storage-adapters.md`](./spec/v1/storage-adapters.md) for the contract + compliance checklist + example adapters.

---

## 11. Try the reference application (BE + FE template)

Want a starting template that bundles a single-container backend with a React frontend? See [`apps/workflow-engine/`](./apps/workflow-engine/).

```bash
# Terminal 1 — backend
cd apps/workflow-engine/backend/typescript
npm install
npm run dev          # http://localhost:8080

# Terminal 2 — frontend
cd apps/workflow-engine/frontend/react
npm install
npm run dev          # http://localhost:5173
```

The frontend connects to the backend via `@openwop/openwop` and demonstrates run lifecycle, SSE streaming, all 4 interrupt kinds, capability discovery, and a BYOK key-entry surface. Sample / template code; not production-hardened. See [`apps/workflow-engine/ARCHITECTURE.md`](./apps/workflow-engine/ARCHITECTURE.md) for the boundary discipline.

---

## See also

- [`README.md`](./README.md) — full document index with status legend.
- [`CHANGELOG.md`](./CHANGELOG.md) — version history including the post-v1 ecosystem additions.
- [`ROADMAP.md`](./ROADMAP.md) — v1 stable / v1.X minor / post-v1 ecosystem.
- [`GOVERNANCE.md`](./GOVERNANCE.md) — decision-making and spec change process.

Have a question? Open an issue using the templates at `.github/ISSUE_TEMPLATE/`. Spec contributions go through `CONTRIBUTING.md`.
