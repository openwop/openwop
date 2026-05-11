# OpenWOP Reference Host: In-Memory

Single-process, zero-runtime-deps reference implementation of the OpenWOP v1 wire contract.

> **Reference host.** This host exists to anchor the cross-host portability claim, serve as the runnable example for the "OpenWOP in 10 minutes" tutorial, and drive the `@openwop/openwop-conformance` suite end-to-end. It has no persistence, no multi-tenancy, no real auth, and no production hardening.

## Quick start

```bash
npm install
npm start
```

The server listens on `http://127.0.0.1:3737` by default. Override via env vars:

| Variable | Default | Purpose |
|---|---|---|
| `OPENWOP_HOST` | `127.0.0.1` | Bind address |
| `OPENWOP_PORT` | `3737` | Bind port |
| `OPENWOP_API_KEY` | `openwop-inmem-dev-key` | Bearer token accepted on `Authorization: Bearer <key>` |

## Smoke test

In another terminal:

```bash
# 1. Discovery (no auth required)
curl -s http://127.0.0.1:3737/.well-known/openwop | jq

# 2. Create a noop run
curl -s -X POST http://127.0.0.1:3737/v1/runs \
  -H "Authorization: Bearer openwop-inmem-dev-key" \
  -H "Content-Type: application/json" \
  -d '{"workflowId":"conformance-noop"}' | jq

# 3. Get the snapshot (substitute runId from step 2)
curl -s -H "Authorization: Bearer openwop-inmem-dev-key" \
  http://127.0.0.1:3737/v1/runs/<runId> | jq

# 4. Stream events
curl -N -H "Authorization: Bearer openwop-inmem-dev-key" \
  http://127.0.0.1:3737/v1/runs/<runId>/events
```

## Run conformance against this host

From the repo root, in a second terminal while the host is running:

```bash
cd conformance
OPENWOP_BASE_URL=http://127.0.0.1:3737 OPENWOP_API_KEY=openwop-inmem-dev-key npx vitest run
```

See `conformance.md` for the full per-scenario pass/fail record + the host's profile claim.

## What's implemented

- `GET /.well-known/openwop` — capability discovery per `spec/v1/capabilities.md`. Returns `protocolVersion: 1.0` + minimum required fields.
- `GET /v1/openapi.json` — minimal OpenAPI 3.1 stub (the canonical OpenAPI bundle is `api/openapi.yaml` at the repo root; this host serves enough shape for the discovery scenario).
- `POST /v1/runs` — create a run. Honors `Idempotency-Key` (Layer 1) per `spec/v1/idempotency.md`: same key + same body → cached replay; same key + different body → 409.
- `GET /v1/runs/{runId}` — run snapshot.
- `POST /v1/runs/{runId}/cancel` — request cancellation; the executor checks the abort signal and emits `run.cancelled`.
- `GET /v1/runs/{runId}/events` — SSE event stream. Replays the backlog on connect; closes on terminal event.
- `GET /v1/runs/{runId}/events/poll` — polling event read with `?since=<seq>`.

## What's not implemented (by design)

This host claims **`openwop-core` + `openwop-stream-sse` + `openwop-stream-poll`** per `spec/v1/profiles.md`. Anything outside that profile set is intentionally absent:

- ❌ Interrupts (`openwop-interrupts`) — no `clarification.request` or approval-gate handling.
- ❌ Secrets (`openwop-secrets`) — no BYOK / credential resolution.
- ❌ Provider policy (`openwop-provider-policy`) — no `aiProviders.policies` advertised.
- ❌ Node packs (`openwop-node-packs`) — no registry endpoints.
- ❌ Channels / TTL reducers — `core.delay` / `core.noop` only.
- ❌ Sub-workflows.
- ❌ Replay / fork.
- ❌ Persistence — process restart drops every run.
- ❌ Multi-tenancy — single hardcoded tenant.

The host loads fixture workflows from `conformance/fixtures/*.json` if it can find them (walks up from the source dir until it sees `conformance/fixtures/`). The two it actually executes are `conformance-noop` (single `core.noop` node) and `conformance-cancellable` (single `core.delay` node). Other fixtures load (so `POST /v1/runs` returns 201) but their non-trivial node types fail with `unsupported_node_type`.

## File layout

```
in-memory/
├── package.json       — single entry: tsx src/server.ts
├── tsconfig.json      — strict + exactOptionalPropertyTypes
├── README.md          — this file
├── conformance.md     — per-scenario pass/fail record
└── src/
    └── server.ts      — single-file server (~570 LOC)
```

## How to extend

Adding a node type:

1. Edit `src/server.ts`'s `executeNode` switch.
2. Add a fixture under `conformance/fixtures/` if you want it covered by the suite.
3. Re-run conformance.

Adding interrupt support:

1. Implement `POST /v1/interrupts/{token}` per `spec/v1/interrupt.md`.
2. Add `clarification.request` to `supportedEnvelopes` in the discovery payload.
3. The host then claims `openwop-interrupts`; conformance scenarios in `interrupt-approval.test.ts` and `interrupt-clarification.test.ts` start passing.

This is the "build your own host" demo. Treat the file as a reading exercise, not a production dependency.

## See also

- `../../../spec/v1/profiles.md` — compatibility profiles this host claims.
- `../../../spec/v1/scale-profiles.md` — scale profiles (this host claims `minimal`).
- `../../../INTEROP-MATRIX.md` — cross-host scenario pass/fail table.
- `../../../conformance/README.md` — conformance suite usage.
