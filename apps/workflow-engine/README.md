# workflow-engine — Reference Application

> **Status:** Sample / template code. Not production-hardened. Use as a starting template, not a deploy target.
> **SDK version verified against:** `@openwop/openwop` v1.1.1, `@openwop/openwop-conformance` v1.1.0
> **Last verified:** 2026-05-15

A deployable reference application demonstrating the full vertical slice of an OpenWOP host: a Cloud Run-shape TypeScript backend that implements the v1.1 wire contract, paired with a React frontend that consumes it via the published SDK.

## What this sample demonstrates

### Backend (`backend/typescript/`)

- **All four canonical run-lifecycle endpoints** — `POST /v1/runs`, `GET /v1/runs/{id}`, `POST /v1/runs/{id}/cancel`, `POST /v1/runs/{id}:fork`
- **All four interrupt `kind`s** — `approval`, `clarification`, `refinement`, `cancellation` — wired through `POST /v1/runs/{id}/interrupts/{nodeId}` and the signed-token callback `POST /v1/interrupts/{token}`
- **SSE event stream** with the four canonical stream modes (`values` / `updates` / `messages` / `debug`) and `Last-Event-ID` resume
- **Two-layer idempotency** — HTTP `Idempotency-Key` + engine `invocationId`
- **BYOK end-to-end** — node manifest declares `requires.secrets[]`, run options carry `credentialRef`, secret resolves at execute time, secret material is stripped from persisted run-doc / events / errors
- **Pack consumption** — load + verify a pack tarball at boot (SRI + Ed25519)
- **OTel under `openwop.*`** with W3C `traceparent` propagation
- **Cloud Run shape** — single container, `$PORT`, `/health` + `/readiness`, multi-stage Dockerfile with esbuild bundle
- **Conformance harness** — `npm run test:conformance` runs `@openwop/openwop-conformance` against the local service

### Frontend (`frontend/react/`)

- **`@openwop/openwop` SDK consumption from the browser** — same package as the BE for wire types
- **Run lifecycle UI** — create, status, cancel, fork from any event
- **SSE event stream rendering** with `Last-Event-ID` resume across reconnect
- **Interrupt rendering for all four `kind`s** — sample-quality cards demonstrating the host-extension renderer pattern
- **Capability discovery panel** — live render of `GET /.well-known/openwop`
- **BYOK key entry + policy explainer** — visualizes the resolution order

## What this sample is NOT

- **Not a fifth reference host.** Conformance is owned by `examples/hosts/postgres/` (production-profile, 91.9% of 850 scenarios). This sample stubs more and targets ~70%.
- **Not normative.** It is sample/template code, not part of the v1.1 spec corpus.
- **Not coupled to one cloud.** Cloud Run is the deployment archetype called out in the Dockerfile; the code itself runs on any container platform. GCP-specific stand-ins (KMS, Cloud Tasks) are stubbed behind interfaces.
- **Not a fork of the production-grade postgres host.** It deliberately omits the audit-log integrity profile, durable webhook queue, multi-region partition handling, and other production concerns to stay at "starter-template" scope.

## Quickstart

```bash
# Terminal 1 — backend
cd apps/workflow-engine/backend/typescript
npm install
npm run dev          # listens on http://localhost:8080

# Terminal 2 — frontend
cd apps/workflow-engine/frontend/react
npm install
npm run dev          # opens http://localhost:5173
```

The frontend connects to `http://localhost:8080` by default. Override with `VITE_OPENWOP_BASE_URL` in a `.env.local`.

### Smoke test (BE only)

```bash
curl http://localhost:8080/.well-known/openwop | jq
curl -X POST http://localhost:8080/v1/runs \
  -H 'Authorization: Bearer sample-token' \
  -H 'Content-Type: application/json' \
  -d '{"workflowId":"sample.demo.uppercase","tenantId":"demo","inputs":{"text":"hello"}}'
```

### Conformance

```bash
cd apps/workflow-engine/backend/typescript
npm run test:conformance
```

Honest pass-matrix vs. `@openwop/openwop-conformance` v1.1.0:

| Suite | Pass | Skip-equivalent | Reason for skip |
|---|---|---|---|
| `openwop-core` | ✅ all | — | — |
| `openwop-stream-sse` | ✅ all | — | — |
| `openwop-interrupts` | ✅ all | — | — |
| `openwop-replay-fork` | ✅ all | — | — |
| `openwop-node-packs` | ✅ all | — | — |
| `openwop-audit-log-integrity` | — | ❌ all | Stubbed auth; no Ed25519 checkpoint signing |
| `openwop-production-profile` | — | ❌ all | Sample doesn't claim production-profile (no SLA, no claim acquisition) |
| `openwop-durable-webhooks` | partial | partial | Demonstrates HMAC delivery; Cloud Tasks queue stubbed |

## Deploy to Cloud Run

```bash
cd apps/workflow-engine/backend/typescript
gcloud run deploy workflow-engine --source . --region us-central1
```

The Dockerfile is pre-wired for `--source` deploys. For real production:

- Replace the in-memory secret resolver (`src/byok/secretResolver.ts`) with a KMS-backed implementation.
- Replace the sqlite storage adapter (`src/storage/sqlite/`) with Postgres / Firestore / DynamoDB.
- Replace the stub identity resolver (`src/host/identityResolver.ts`) with Firebase Auth / OIDC / your IdP.
- Wire the OTel SDK to your collector (replace the console exporter in `src/observability/tracer.ts`).
- Add the Cloud Tasks dispatch surface (mirror `services/workflow-runtime/src/runDispatch/` from the MyndHyve reference).

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for component diagram, boundary discipline, and the file-by-file map between this sample and `MYNDHYVE-ON-OPENWOP-SHOULD-BE-ANALYSIS.md` §3.

## File map

```
apps/workflow-engine/
├── README.md                              # this file
├── ARCHITECTURE.md
├── backend/
│   └── typescript/
│       ├── Dockerfile                     # multi-stage Node 22-slim + esbuild
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── index.ts                   # express bootstrap
│       │   ├── routes/                    # 7 route modules
│       │   ├── bootstrap/                 # 6 boot-time installers
│       │   ├── host/                      # HostAdapterSuite (15 slots)
│       │   ├── storage/                   # sqlite (default) + memory (tests)
│       │   ├── byok/                      # secret resolver + ephemeral run secrets
│       │   ├── observability/             # OTel tracer + cost emitter
│       │   ├── middleware/                # auth, traceContext, errorEnvelope
│       │   ├── packs/                     # tarball loader + signature verify
│       │   ├── executor/                  # node-module dispatch loop
│       │   └── types.ts
│       ├── conformance/                   # @openwop/openwop-conformance harness
│       ├── scripts/                       # local-dev helpers
│       └── test/                          # vitest unit + integration
└── frontend/
    └── react/
        ├── package.json
        ├── vite.config.ts
        ├── tsconfig.json
        ├── index.html
        └── src/
            ├── main.tsx
            ├── App.tsx
            ├── client/                    # @openwop/openwop wrappers
            ├── runs/                      # run lifecycle UI
            ├── streams/                   # SSE event stream view
            ├── interrupts/                # 4 kinds of interrupt renderers
            ├── byok/                      # key entry + policy explainer
            ├── discovery/                 # capabilities panel
            └── styles/
```

## Adding more languages or frameworks

The `backend/<language>/` and `frontend/<framework>/` shape is intentionally future-proof:

- A future Python Cloud Run reference: `backend/python/`
- A future Go AWS Lambda reference: `backend/go/`
- A future Vue frontend: `frontend/vue/`

When adding, mirror the structure (README + Dockerfile/build config + src/) and update the file map above.

## See also

- `plans/openwop-reference-app-plan.md` — the analysis this sample was built from
- `examples/hosts/postgres/README.md` — the production-profile reference host
- `MYNDHYVE-ON-OPENWOP-SHOULD-BE-ANALYSIS.md` (in the MyndHyve repo) — the should-be guide that informed this sample's scope
