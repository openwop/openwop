# OpenWOP Reference Application — Cloud Run Workflow-Engine + React UI

> **Status:** Pre-implementation analysis. Not normative. Not yet wired into the openwop docs index.
> **Created:** 2026-05-15
> **Author:** Architecture analysis prior to creating the new in-repo sample-app directory.
> **Authoritative sources:**
> - `/Users/david/dev/openwop/` — published v1.1 protocol corpus
> - `/Users/david/dev/myndhyve/services/workflow-runtime/` — production Cloud Run host (~17K LOC, 30+ src files)
> - `/Users/david/dev/myndhyve/docs/plans/MYNDHYVE-ON-OPENWOP-SHOULD-BE-ANALYSIS.md` — the should-be guide
> - `/Users/david/dev/openwop/examples/hosts/{in-memory,sqlite,postgres,python}/` — existing reference hosts
> - `/Users/david/dev/openwop/sdk/typescript/` — `@openwop/openwop` SDK package

---

## 0. The single-sentence framing

This new sample directory is a **deployable reference application**: a Cloud Run-shaped TypeScript "workflow-engine" that wires `@openwop/openwop` into a real cloud-execution shell, plus a React frontend that consumes its SSE event stream and renders OpenWOP `interrupt` primitives — together demonstrating the *full vertical slice* of "what does it look like to actually ship openwop on a cloud platform with a UI on top."

It is **not** a fifth reference host (the `postgres` host in `examples/hosts/postgres/` already plays that role). It is the first reference *application* — a runnable end-to-end consumer story.

---

## 1. Why a new directory (and what it is not)

### 1.1 What openwop has today

Three artifact tiers exist in the repo:

| Tier | Where it lives | What it is | Deploy-ready? |
|---|---|---|---|
| **SDK** | `sdk/typescript/`, `sdk/python/`, `sdk/go/` | The wire-contract client + types | Library, not deployable |
| **Reference hosts** | `examples/hosts/{in-memory,sqlite,postgres,python}/` | Conformance-test targets; minimal HTTP server per storage adapter | Runnable locally with `npm start`; no Dockerfile, no auth, no UI |
| **Examples** | `examples/{tiny-workflow,streaming-client,approval-workflow,…}` | Single-file demos that *consume* a host | Run as scripts against any host |

### 1.2 The gap

There is no in-repo answer to: **"How do I actually deploy this on a cloud platform, with auth, storage, BYOK, observability, and a UI?"** A new contributor today has to reverse-engineer that from MyndHyve's private codebase.

The new directory closes that gap with one canonical, end-to-end sample:

- **Backend** — a Cloud Run-shaped Express service that wires the SDK + a host adapter suite + bootstrap modules + REST routes, suitable as a starting template for a real deployment.
- **Frontend** — a React app that hits the backend, streams events over SSE, renders interrupts, and demonstrates `@openwop/openwop` SDK usage from the browser.

### 1.3 What this directory is NOT

- **Not a fifth reference host.** Conformance is owned by `examples/hosts/postgres/` (production-profile, 91.9% of 850 scenarios). The new sample reuses the existing reference engine, it does not re-implement it.
- **Not normative.** The directory is sample/template code, not part of the v1.1 spec corpus. It can take dependencies (Express, React, Vite, Docker) that the spec corpus deliberately avoids.
- **Not MyndHyve.** Anything MyndHyve-specific (Firestore, Firebase Auth, `vendor.myndhyve.*` packs, canvas types) MUST stay out. The sample uses neutral substitutes (sqlite for storage, a stubbed identity provider, no canvas concept).
- **Not coupled to one cloud.** The Cloud Run shape (single container, port from `$PORT`, Node 22 slim image) is the *target deployment archetype*, but the code itself runs on any container platform. GCP-specific deps (KMS, Cloud Tasks) are factored behind interfaces and stubbed by default.

---

## 2. The MyndHyve reference: what to copy, what to drop

`/Users/david/dev/myndhyve/services/workflow-runtime/` is the most production-shaped openwop host that exists today. It is 17K LOC across ~30 source files. Almost all of it is reusable in shape; very little of it is reusable in substance.

### 2.1 Architecture pieces to mirror (shape-only)

These structural patterns from `services/workflow-runtime/src/` translate 1:1 into the new sample:

| MyndHyve file | Pattern to copy | Substance to neutralize |
|---|---|---|
| `index.ts` | Express bootstrap, ordered middleware, bootstrap-on-boot calls | Drop `firebase-admin` init, drop `OPENWOP_WEBHOOK_INVOKER_SA` env requirement |
| `nodeBootstrap.ts` | Pre-register NodeModules at boot so first request doesn't pay registration | Register only `core.*` packs from `@openwop/openwop` and one demo pack (no `vendor.myndhyve.*`) |
| `suspendBootstrap.ts` | Install a durable `SuspendManager` impl before any node runs | Use a sqlite-backed `SuspendManager` (or filesystem JSON), not Firestore |
| `eventLogBootstrap.ts` | Install a durable `EventLog` with atomic monotonic sequence | Same — sqlite-backed |
| `invocationLogBootstrap.ts` | Install `InvocationLog` for cross-instance retry idempotency | sqlite-backed |
| `runtimeCapabilityRegistryBootstrap.ts` | Empty registry advertising no runtime capabilities | Direct copy; semantics are universal |
| `nodePackResolverBootstrap.ts` | Wire pack-registry resolver into `NodeRegistry` for async miss path | Direct copy |
| `serverExecutionHost.ts` (1164 LOC) | `ExecutionHost` factory wiring AI providers, secrets, audit, memory, artifact sync, HTTP client, etc. | Stubs for AI providers (echo back), no-op for audit/memory unless requested |
| `runExecutor.ts` (2568 LOC) | `executeRun()` — top-level dispatch loop wrapping `executeNodeModule`, with run-doc reads/writes, capability monitoring, recursion-limit checks | Slim down by 80%; the MyndHyve version carries product-layer concerns the sample doesn't need |
| `routes/canonicalRuns.ts` (3697 LOC) | Canonical `POST /v1/runs`, `GET /v1/runs/{id}`, `POST /v1/runs/{id}/cancel`, `POST /v1/runs/{id}:fork`, `POST /v1/runs/{id}/interrupts/{nodeId}` | Drop the `tenantId ↔ workspaceId` MyndHyve mapping; `tenantId` is just `tenantId` |
| `routes/discovery.ts` | `/.well-known/openwop` advertisement + `/v1/openapi.json` + `Capabilities-Etag` | Honest advertisement of what the sample supports; no `myndhyve.*` extension block |
| `routes/streamModes.ts` | SSE event stream with 4 canonical stream modes (`values`/`updates`/`messages`/`debug`) + `Last-Event-ID` resume | Direct copy; this is pure protocol |
| `routes/health.ts` | `/health` + `/readiness` for Cloud Run liveness/readiness probes | Direct copy |
| `middleware/auth.ts` | Bearer-token auth, principal extraction | Stub: accept any non-empty token, populate a synthetic principal |
| `middleware/traceContext.ts` | W3C `traceparent` propagation into OTel context | Direct copy; this is OTel-standard |
| `byok/byokSecretResolver.ts` | `SecretResolverAdapter` impl resolving `credentialRef` strings | In-memory map for the sample (real deployments wire KMS / Vault / Secrets Manager) |
| `byok/ephemeralRunSecrets.ts` | Per-run secret context with strip-on-persist | Direct copy; the persistence-stripping invariant is what makes BYOK safe |
| `host/index.ts` | `HostAdapterSuite` factory — single seam for the 15 host-adapter slots | Direct shape copy, neutral implementations; documents which slots are stubbed |
| `Dockerfile` | Multi-stage Node 22-slim build, esbuild bundle, `lib/index.js` runtime | Drop the monorepo-relative `COPY src ./src` paths and the `--external:@google-cloud/*` flags |

### 2.2 What to explicitly drop

| MyndHyve concern | Why it doesn't belong in the sample |
|---|---|
| `firebase-admin`, Firestore | Couples to one cloud + one DB. Sample uses sqlite by default. |
| `@google-cloud/{kms,storage,tasks}` | GCP-specific. Sample stubs these behind interfaces (Cloud Tasks → in-process `setImmediate`; KMS → identity transform). |
| `bcrypt`, `mh_*` API keys, super-admin | MyndHyve product auth model. Sample uses a synthetic Bearer-token principal. |
| `vendor.myndhyve.*` packs (47 of them) | Product surface. Sample registers only `core.*` packs + one demo pack. |
| `metadata["myndhyve.canvasTypeId"]` routing | Canvas types are a MyndHyve product concept, not openwop. |
| `mcpRateLimiter.ts`, `rateLimiter.ts` (271 LOC) | Useful patterns but out of scope for a starter sample. Document as "next step." |
| `serverArtifactSync.ts` (734 LOC) | Coupled to MyndHyve's `artifactRegistry`. Sample exposes an artifact-sync interface and stubs it. |
| `webhookDelivery.ts` durable webhook queue | Demonstrate webhook *emission* (HMAC-signed POST) but skip the durable retry queue (Cloud Tasks dependency). |
| `routes/packs.ts` (2281 LOC) — full pack publish/yank/SBOM/signature surface | Sample documents pack consumption only. Pack publishing is a separate `examples/node-pack-publishing/` story. |
| `routes/internalDispatch.ts` Cloud Tasks runner | Sample dispatches inline; "split dispatcher across instances" is a documented next step. |

### 2.3 Honest scope

The MyndHyve workflow-runtime is **17K LOC**. The sample target is **2–3K LOC**. Cuts:

- Drop everything that's product-layer (canvas, kanban, brand, entities, marketplace, leads, commerce, page-builder).
- Drop everything that's GCP-specific behind a single-line stub.
- Drop pack publishing (consumption only).
- Drop the durable webhook queue and Cloud Tasks dispatch (note as next steps).
- Keep the *shape* of every important wiring point so a real deployer can swap the stub for a real impl.

---

## 3. What the sample MUST demonstrate

Drawn from §3 ("Core Boundary"), §7 ("`host.*` Capability Contract"), §10 ("BYOK"), §12 ("Pure OpenWOP Usage Looks Like") of `MYNDHYVE-ON-OPENWOP-SHOULD-BE-ANALYSIS.md`.

### 3.1 Backend MUST demonstrate

1. **Engine kernel via dependency.** `@openwop/openwop` is consumed as an npm dep, never reached around. The service's "engine" is a thin wrapper around `executeNodeModule` + the registry/suspend/event-log singletons.
2. **`/.well-known/openwop` advertisement** with honest capability claims and an `extensions.<vendor>.*` block (showing the host-extension namespace pattern even if the block is near-empty in the sample).
3. **All four canonical run-lifecycle endpoints**: `POST /v1/runs`, `GET /v1/runs/{id}`, `POST /v1/runs/{id}/cancel`, `POST /v1/runs/{id}:fork`.
4. **All four interrupt `kind`s** wired through `POST /v1/runs/{id}/interrupts/{nodeId}` and the signed-token callback `POST /v1/interrupts/{token}`.
5. **SSE event stream** with the four canonical stream modes (`values`/`updates`/`messages`/`debug`) and `Last-Event-ID` resume.
6. **`Idempotency-Key` HTTP layer + `invocationId` engine layer** — both demonstrably wired, with a runnable test that proves replay-safety.
7. **BYOK flow end-to-end** — node manifest declares `requires.secrets[]`, run options carry `credentialRef`, secret resolves at execute time, secret material is stripped from persisted run-doc / events / errors. The 36 SECURITY MUST-NOT invariants in `SECURITY/invariants.yaml` are the contract.
8. **Pack consumption** — register a pack at boot from a tarball on disk, including SRI + Ed25519 signature verification. (Pack publish stays out of scope.)
9. **OTel instrumentation under the `openwop.*` namespace** with W3C `traceparent` propagation across run-create → dispatch → node execution. Console exporter by default; deployers swap for OTLP.
10. **Cloud Run-shape deployment**: single container, listens on `$PORT`, `/health` + `/readiness` probes, multi-stage Dockerfile with esbuild bundle, runs locally with `npm run dev` and in production with `node lib/index.js`.
11. **Conformance harness wired** — `npm run test:conformance` runs `@openwop/openwop-conformance` v1.1.0 against the local service. Pass matrix is honest (less than the postgres host because the sample stubs more).

### 3.2 Frontend MUST demonstrate

1. **`@openwop/openwop` SDK consumption from the browser.** The same package the backend uses for types/wire-shape. (Currently TS-only; see §6.1 on whether to publish a separate `@openwop/openwop-react` helper.)
2. **Run lifecycle UI** — create a run, view its status, cancel, fork from any event.
3. **SSE event stream rendering** — subscribe via `EventSource`, render events live, demonstrate Last-Event-ID resume across reconnect.
4. **Interrupt rendering for all four `kind`s** — approval card with the 5-action vocabulary, clarification dialog, refinement form, cancellation banner. The card components are sample code, not normative — they show the *shape* of what a host-extension renderer looks like.
5. **Capability discovery UI** — `GET /.well-known/openwop` rendered as a debug panel showing what the connected host supports.
6. **BYOK key entry UI** — paste a key, scope it (tenant/user/run), store it in the host (via the BE's secret-resolver endpoint or local storage). Demonstrates the policy resolution order (`node config → … → platform default`) visually.
7. **Replay/fork debug surface** — pick an event in the log, fork from it, watch the new run diverge.

### 3.3 Boundary discipline (the non-negotiable)

The same boundary rule from `MYNDHYVE-ON-OPENWOP-SHOULD-BE-ANALYSIS.md` §3 applies, restated for sample scope:

- Backend MUST NOT import React. (Trivially satisfied; called out so it stays satisfied.)
- Frontend MUST NOT import backend internals — only the published SDK + REST/SSE.
- Anything sample-specific (auth stub, sqlite storage, demo pack) lives under a clearly-named `local.*` or `sample.*` namespace, never under `core.*` or `openwop.*`.
- The sample is a **template**, not a fork. A real deployer should be able to swap the storage layer / auth provider / secret resolver without touching the route handlers.

---

## 4. Proposed directory shape

The user's stated framing: "BE code in a typescript directory and FE code in a React directory; eventually more than just typescript and react." Two viable layouts; I lean Option A.

### Option A (recommended) — language/framework as second-level, capability as third-level

```
apps/                                          # new top-level
├── README.md                                  # what `apps/` is for; index of samples
└── workflow-engine/                           # the canonical first sample
    ├── README.md                              # end-to-end overview, run instructions
    ├── ARCHITECTURE.md                        # component diagram, boundary discipline
    ├── backend/
    │   └── typescript/                        # initial impl
    │       ├── README.md
    │       ├── Dockerfile
    │       ├── package.json
    │       ├── tsconfig.json
    │       ├── vitest.config.ts
    │       ├── src/
    │       │   ├── index.ts                   # express bootstrap (mirrors MH index.ts)
    │       │   ├── routes/
    │       │   │   ├── discovery.ts           # /.well-known/openwop + /v1/openapi.json
    │       │   │   ├── runs.ts                # POST/GET/cancel/fork
    │       │   │   ├── interrupts.ts          # 4 kinds + signed-token callback
    │       │   │   ├── streams.ts             # SSE w/ 4 stream modes + Last-Event-ID
    │       │   │   ├── webhooks.ts            # subscribe + HMAC-signed delivery
    │       │   │   ├── packs.ts               # read-only pack catalog
    │       │   │   └── health.ts              # /health + /readiness
    │       │   ├── bootstrap/                 # mirror MH bootstrap modules
    │       │   │   ├── nodes.ts
    │       │   │   ├── suspend.ts
    │       │   │   ├── eventLog.ts
    │       │   │   ├── invocationLog.ts
    │       │   │   ├── runtimeCapabilityRegistry.ts
    │       │   │   └── nodePackResolver.ts
    │       │   ├── host/                      # HostAdapterSuite — neutral impls
    │       │   │   ├── index.ts               # factory
    │       │   │   ├── tenantResolver.ts
    │       │   │   ├── scopeResolver.ts
    │       │   │   ├── workflowCatalog.ts
    │       │   │   ├── principalAuthorizer.ts
    │       │   │   ├── identityResolver.ts    # stub: any-non-empty-Bearer
    │       │   │   ├── observabilitySink.ts   # OTel console exporter
    │       │   │   └── auditSink.ts           # sqlite append-only
    │       │   ├── storage/                   # pluggable storage layer
    │       │   │   ├── sqlite/                # default
    │       │   │   └── memory/                # for tests
    │       │   ├── byok/
    │       │   │   ├── secretResolver.ts      # in-memory map; doc real deployments
    │       │   │   └── ephemeralRunSecrets.ts # MH-pattern strip-on-persist
    │       │   ├── observability/
    │       │   │   ├── tracer.ts              # OTel SDK init, console exporter
    │       │   │   └── costEmitter.ts
    │       │   ├── middleware/
    │       │   │   ├── auth.ts
    │       │   │   ├── traceContext.ts
    │       │   │   └── errorEnvelope.ts       # canonical openwop error shapes
    │       │   ├── packs/
    │       │   │   ├── tarballLoader.ts       # SRI + Ed25519 verify
    │       │   │   └── moduleLoader.ts
    │       │   ├── executionHost.ts           # ExecutionHost factory
    │       │   └── runExecutor.ts             # thin wrapper around executeNodeModule
    │       ├── conformance/                   # @openwop/openwop-conformance harness
    │       └── scripts/
    │           ├── seed-demo-data.ts
    │           └── start-local.sh
    └── frontend/
        └── react/                             # initial impl
            ├── README.md
            ├── package.json
            ├── vite.config.ts
            ├── tsconfig.json
            ├── index.html
            ├── public/
            └── src/
                ├── main.tsx
                ├── App.tsx
                ├── client/                    # @openwop/openwop wrapper
                │   ├── runsClient.ts
                │   ├── streamsClient.ts       # EventSource + Last-Event-ID
                │   └── interruptsClient.ts
                ├── runs/
                │   ├── RunCreate.tsx
                │   ├── RunStatus.tsx
                │   └── RunForkButton.tsx
                ├── streams/
                │   └── EventStreamView.tsx
                ├── interrupts/                # 4 kinds, host-extension renderers
                │   ├── ApprovalCard.tsx
                │   ├── ClarificationDialog.tsx
                │   ├── RefinementForm.tsx
                │   └── CancellationBanner.tsx
                ├── byok/
                │   ├── KeyEntryForm.tsx
                │   └── PolicyExplainer.tsx
                ├── discovery/
                │   └── CapabilitiesPanel.tsx
                └── styles/
```

**Why this shape:**
- `apps/<sample-name>/` matches the existing `examples/<sample-name>/` pattern, so the layout is recognizable to anyone who's already navigated `examples/`.
- `backend/typescript/` and `frontend/react/` make adding `backend/python/` or `frontend/vue/` later a no-op naming-wise.
- The `workflow-engine` name lives at the *sample* level (because it's what the sample *is*), not the language level. A future `apps/agent-orchestrator/backend/typescript/` sample would slot in cleanly.

### Option B — flat language directories

```
apps/
└── workflow-engine/
    ├── README.md
    ├── typescript/                # treated as the BE
    │   └── (everything from Option A's backend/typescript/)
    └── react/                     # treated as the FE
        └── (everything from Option A's frontend/react/)
```

Simpler, but conflates two distinct axes (language vs. tier). Adding `apps/workflow-engine/python/` later is ambiguous — is that a Python *backend* or Python frontend? Option A scales better; Option B is fine if the user prefers the lighter nesting.

### 4.1 Naming open questions for the user

1. **Top-level directory name.** `apps/`? `samples/`? `reference-apps/`? `applications/`? `apps/` is shortest and least ambiguous against the existing `examples/` directory. Recommended: **`apps/`**.
2. **Sample name.** `workflow-engine`? `workflow-engine-cloudrun`? `cloudrun-workflow-engine`? The "cloud-run" framing is the deployment target, not the sample's identity. Recommended: **`workflow-engine`** with Cloud Run called out in the README and reflected in the Dockerfile.
3. **Layout: Option A or Option B above.** Recommended: **Option A** for future scalability.

These three answers determine the directory tree before the first file is written.

---

## 5. Storage choice for the sample

The MyndHyve runtime uses Firestore. Reusing Firestore in the sample would couple the sample to GCP and require a Firebase project to run.

Three viable choices for the sample's default storage:

| Option | Pros | Cons |
|---|---|---|
| **sqlite (better-sqlite3)** | Zero-config, single file, fastest local dev, matches `examples/hosts/sqlite/` pattern, conformance-tested adapter shape already exists | Not multi-instance; sample explicitly documents this limitation |
| **pglite (Postgres-on-WASM)** | Matches `examples/hosts/postgres/` pattern (which already passes 91.9% of conformance), in-process so still zero-config | Heavier dep, slower than sqlite for the small-scale sample |
| **In-memory + JSON snapshot to disk** | Simplest possible | Doesn't model production storage shape; misleading as a template |

**Recommendation: sqlite by default, with the storage layer factored behind an interface so a deployer can swap to Postgres / Firestore / DynamoDB by replacing one module.** The sample's `src/storage/sqlite/` is an instance of the interface; `src/storage/memory/` is the test impl. The interface is the deployable contract.

This matches the existing `examples/hosts/sqlite/` adapter shape, so a deployer who reads both gets aligned mental models.

---

## 6. The frontend dependency story

### 6.1 SDK posture

`@openwop/openwop` v1.1.1 ships as ESM, targets Node ≥20, and is currently agnostic about browser usage. Two options:

1. **Use `@openwop/openwop` directly from the browser.** Vite + esbuild can bundle it; the package is small. This is the lowest-friction path.
2. **Publish a thin `@openwop/openwop-react` helper later.** Wraps EventSource + interrupt rendering hooks. *Out of scope for the initial sample;* note as a follow-up if `useRun()` / `useEventStream()` patterns prove useful.

**Recommendation: Option 1 for the initial sample.** Add a `client/` directory inside the React app that exposes `runsClient`, `streamsClient`, `interruptsClient` as thin wrappers. If those wrappers prove reusable, promote them to a published `@openwop/openwop-browser` package in a follow-up.

### 6.2 Build tooling

| Choice | Recommendation | Reason |
|---|---|---|
| Bundler | **Vite** | Fast, current standard, ESM-native, plays well with `@openwop/openwop` ESM |
| Routing | **React Router 7** | Most likely match for openwop's likely contributor base |
| State | **None — local state + URL state only** | The sample is a demonstration, not a production app. Adding Zustand/Redux signals "you need this" which isn't true for the basic surface. |
| Styling | **CSS modules + minimal hand-rolled tokens** | Match the openwop public site (`public/styles.css`) which is hand-rolled. No Tailwind/MUI dependency. |

---

## 7. CI + conformance posture

### 7.1 What the sample's CI MUST do

1. **Typecheck both BE and FE.** `tsc --noEmit` in each directory.
2. **Run BE unit tests.** `vitest run` covering route handlers, executor, host adapters, BYOK strip-on-persist invariant.
3. **Run BE conformance.** `npm run test:conformance` boots the service against in-memory storage and runs `@openwop/openwop-conformance` v1.1.0. Pass-matrix is honest and tracked in the sample's README.
4. **Build the Docker image.** `docker build` at minimum; pushing/deploying is out of scope.
5. **Run FE unit tests.** Optional initially; add when interrupt-renderer logic gets non-trivial.

### 7.2 Where it hooks into the existing `npm run openwop:check`

The root `scripts/openwop-check.sh` runs the eight-step gate over the spec corpus. The new sample is **not** part of that corpus (samples are runnable artifacts, not normative surface). Sample CI runs as a separate workflow step — pass/fail is tracked in the sample, but a sample failure does not block a spec release.

This matches how `examples/hosts/postgres/` is treated today.

### 7.3 What conformance percentage to target

The `postgres` reference host clears 91.9% (781/850 default-mode scenarios). The sample's pass rate will be **lower** because the sample:

- Stubs auth (no auth-profile conformance — `openwop-audit-log-integrity`, etc. won't apply)
- Stubs the durable webhook queue (some webhook scenarios degrade to skip-equivalent)
- Skips the production-profile predicate (`openwop-production-profile` requires 99th-percentile latency claims, etc.)

**Honest target for the initial sample: ~70% with the gaps explicitly listed in the README.** Anything higher requires features that turn the sample into a fork of the postgres host.

---

## 8. Concrete file-creation checklist (next session)

When the user signs off on Option A directory layout + the three naming answers in §4.1, the work to create the directory:

### Phase 1 — scaffolding (1 commit)

- [ ] `apps/README.md` — index, explains what `apps/` is for, links to `workflow-engine/`
- [ ] `apps/workflow-engine/README.md` — overview, BE+FE run instructions, conformance pass-matrix
- [ ] `apps/workflow-engine/ARCHITECTURE.md` — component diagram, boundary discipline restated
- [ ] `apps/workflow-engine/backend/typescript/{Dockerfile,package.json,tsconfig.json,vitest.config.ts}`
- [ ] `apps/workflow-engine/backend/typescript/src/index.ts` — express bootstrap skeleton
- [ ] `apps/workflow-engine/frontend/react/{package.json,vite.config.ts,tsconfig.json,index.html}`
- [ ] `apps/workflow-engine/frontend/react/src/main.tsx` + `App.tsx` skeleton

### Phase 2 — backend wiring (one PR per layer)

- [ ] Bootstrap modules (`bootstrap/{nodes,suspend,eventLog,invocationLog,…}.ts`) — direct copies of MH shape, neutralized backends
- [ ] HostAdapterSuite (`host/index.ts` + 8 real wraps + 3 minimal + 4 stubs) — mirror MH's triage
- [ ] Storage layer (`storage/sqlite/`)
- [ ] Routes (`routes/{discovery,runs,interrupts,streams,webhooks,packs,health}.ts`) — slimmer than MH but same shape
- [ ] BYOK (`byok/{secretResolver,ephemeralRunSecrets}.ts`)
- [ ] OTel (`observability/tracer.ts` with console exporter)
- [ ] Run executor (`runExecutor.ts`) + execution host (`executionHost.ts`)
- [ ] Conformance harness (`conformance/run.ts` invoking `@openwop/openwop-conformance`)

### Phase 3 — frontend wiring (one PR per surface)

- [ ] Client wrappers (`client/{runsClient,streamsClient,interruptsClient}.ts`)
- [ ] Run lifecycle UI (`runs/`)
- [ ] Event stream view (`streams/EventStreamView.tsx`)
- [ ] Interrupt renderers — all 4 `kind`s (`interrupts/`)
- [ ] Capabilities panel (`discovery/CapabilitiesPanel.tsx`)
- [ ] BYOK key entry + policy explainer (`byok/`)

### Phase 4 — documentation + repo wiring

- [ ] Update root `README.md` Document Index to include `apps/workflow-engine/README.md`
- [ ] Update `CHANGELOG.md` `[Unreleased]` with the new sample
- [ ] Decide whether `apps/` deserves a row in `INTEROP-MATRIX.md` (probably no — samples aren't host advertisements)
- [ ] Add a "Try the reference application" section to `QUICKSTART.md`

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sample drifts into "production-ready" framing and gets used as one | Medium | High | README opens with "**This is sample code.** It is not production-hardened. Use as a starting template, not a deploy target." |
| Sample fails conformance after spec changes; nobody updates it | High | Low (sample, not normative) | Tag the sample's `package.json` with the openwop SDK version it was last verified against; document drift in README |
| Frontend SDK consumption blocks on `@openwop/openwop` not being browser-friendly | Medium | Medium | Test browser bundle in the first PR; if breakage, add a `browser:` field or publish a thin browser-targeted entry point |
| MyndHyve concerns leak into the sample (canvas types, vendor packs) | Medium | High (kills the boundary the sample is meant to demonstrate) | Code review checklist: grep for `myndhyve` / `canvas` / `vendor.` in PRs against `apps/`; reject any match |
| `apps/` gets confused with `examples/` | Medium | Medium | `apps/README.md` explicitly distinguishes: `examples/` = single-file demos; `apps/` = full vertical-slice deployable templates |
| Sample takes dependencies (Express, React, sqlite, OTel SDK, Vite) that bloat the repo | Low | Low | The sample's `package.json` is local to `apps/workflow-engine/{backend,frontend}/...`; root `npm install` is unaffected |

---

## 10. Decisions needed from the user before file creation begins

These are the gates between this analysis and Phase 1 of the file-creation checklist in §8.

1. **Top-level directory name** — `apps/` (recommended) vs. `samples/` vs. other?
2. **Sample name** — `workflow-engine` (recommended) vs. another?
3. **Layout — Option A vs. Option B** in §4 — Option A (recommended) splits BE/FE first, language second. Option B treats language as the only second-level axis.
4. **Storage default** — sqlite (recommended) vs. pglite vs. in-memory-with-snapshot?
5. **Cloud-platform stance** — keep Cloud Run as the *target deployment archetype* in the README and Dockerfile (recommended), or stay platform-neutral and document Cloud Run in a separate "deploying" page?
6. **Conformance pass-rate target** — ~70% with explicit gap list (recommended) vs. push toward 90%+ which requires importing more of the postgres host's substance?
7. **Frontend scope** — the seven surfaces in §3.2 (recommended starting set) vs. a smaller initial cut (e.g., just runs + streams + one interrupt kind)?

Once those seven answers are in, Phase 1 of §8 can ship in a single commit.

---

**End of analysis.**
