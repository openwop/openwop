# workflow-engine — Architecture

> Companion to [`README.md`](./README.md). This file documents the *shape* of the sample — what each layer is for, what stays neutral, and the boundary discipline that keeps the sample from drifting into a private fork.

## Layers

```
┌────────────────────────────────────────────────────────────────────┐
│  frontend/react/                                                   │
│  React UI — consumes @openwop/openwop SDK, renders interrupts,    │
│  streams events, displays capabilities, handles BYOK input        │
├────────────────────────────────────────────────────────────────────┤
│              ↑ HTTPS + SSE + Bearer auth (wire only)              │
├────────────────────────────────────────────────────────────────────┤
│  backend/typescript/                                               │
│  Express server                                                   │
│    ├── routes/         REST + SSE wire surface                    │
│    ├── middleware/     auth, traceContext, errorEnvelope          │
│    ├── bootstrap/      one-shot boot installers                   │
│    ├── executor/       node-module dispatch loop                  │
│    ├── host/           HostAdapterSuite — 15 neutral adapters     │
│    ├── byok/           secret resolver + ephemeral run secrets    │
│    ├── packs/          tarball loader + SRI/Ed25519 verify        │
│    ├── observability/  OTel tracer + cost emitter                 │
│    └── storage/        sqlite (default) | memory (tests)          │
└────────────────────────────────────────────────────────────────────┘
                          ↓ depends on (npm)
                @openwop/openwop          (wire types + SDK)
                @openwop/openwop-conformance  (test harness)
```

**Dependency direction is strict and downward.** The frontend never imports backend internals. The backend never imports frontend code. Both layers consume `@openwop/openwop` for wire types — same package, different surface.

## What's a "thin host wrapper"?

The MyndHyve `services/workflow-runtime/` is ~17K LOC because it wires a private engine package into a product host with Firebase auth, Firestore storage, KMS BYOK, Cloud Tasks dispatch, MyndHyve canvas types, and 47 vendor packs.

This sample is target ~2–3K LOC because it:

- Implements the wire surface from scratch (like `examples/hosts/postgres/`), since the public `@openwop/openwop` SDK is a *client*, not an engine.
- Stubs auth (any non-empty Bearer token → synthetic principal).
- Stubs storage at sqlite (in-process; one node).
- Stubs BYOK at an in-memory map.
- Stubs Cloud Tasks dispatch with `setImmediate`.
- Registers only `core.*` packs + one demo pack (`local.sample.demo`).
- Has no canvas types, kanban, brand, entities, or product surface.

A real deployment swaps each stub for a real implementation. The route handlers and the executor stay.

## The 15 host adapter slots

Mirrors the MyndHyve `HostAdapterSuite` triage. Each slot has a neutral implementation in this sample:

| Slot | Real wrap (8) | Sample impl |
|---|---|---|
| `tenantResolver` | ✅ | sqlite table `tenants` |
| `scopeResolver` | ✅ | sqlite table `scopes` |
| `workflowCatalog` | ✅ | sqlite table `workflows` + filesystem fallback |
| `principalAuthorizer` | ✅ | role-based, sqlite-backed |
| `identityResolver` | ✅ | stub: any-non-empty-Bearer → synthetic principal |
| `observabilitySink` | ✅ | OTel console exporter |
| `auditSink` | ✅ | sqlite append-only `audit_log` |
| `secretResolver` | ✅ | in-memory map (BYOK) |

| Slot | Minimal wrap (3) | Sample impl |
|---|---|---|
| `artifactResolver` | ✅ | `local-fs:///` URI scheme only |
| `contextProviderRegistry` | ✅ | in-memory `Map` |
| `extensionManifestRegistry` | ✅ | sqlite (empty by default) |

| Slot | Throw-on-use stub (4) | Sample impl |
|---|---|---|
| `enterprisePolicyResolver` | ⛔ | throws `host_capability_missing` |
| `environmentResolver` | ⛔ | throws `host_capability_missing` |
| `connectorInvoker` | ⛔ | throws `host_capability_missing` |
| `providerPolicyResolver` | ⛔ | throws `host_capability_missing` |

A pack that declares `peerDependencies: ["host.connectors"]` will be refused at register-time when its required surface is `throw-on-use`. This is the OpenWOP `host.*` capability contract working as designed (see `spec/v1/host-capabilities.md`).

## Boundary discipline

Three rules, restated for sample scope:

### 1. No frontend imports in the backend, no backend imports in the frontend

The two `package.json`s have disjoint dependency trees. The frontend declares `@openwop/openwop`; the backend declares its server deps + `@openwop/openwop` for wire types only. There is no shared local package between them.

### 2. All sample-local additions live under `local.*` or `sample.*` namespaces

- Demo pack: `local.sample.demo` (NOT `core.*`, NOT `vendor.openwop.*`)
- Demo workflow: `sample.demo.uppercase`
- Discovery's extension block: `extensions.sample.*` only

This protects the `core.*` and `openwop.*` namespaces from sample-driven drift.

### 3. The Cloud Run shape is a deployment archetype, not a coupling

The Dockerfile is multi-stage Node 22-slim + esbuild bundle, listening on `$PORT`, with `/health` + `/readiness` probes — i.e., the canonical Cloud Run shape. But the code itself doesn't import `@google-cloud/*` packages. A deployer who runs the same image on Fly.io / Render / ECS / Kubernetes gets the same behavior.

## Component-by-component map vs. the should-be doc

For each requirement in `MYNDHYVE-ON-OPENWOP-SHOULD-BE-ANALYSIS.md` §3, here's where the sample implements it:

| Should-be requirement | Sample location |
|---|---|
| Engine kernel via `@openwop/openwop` | `src/executor/` (implements wire surface; `@openwop/openwop` consumed for types) |
| `/.well-known/openwop` advertisement | `src/routes/discovery.ts` |
| Run lifecycle endpoints | `src/routes/runs.ts` |
| 4 interrupt kinds + signed-token callback | `src/routes/interrupts.ts` |
| 4 stream modes + Last-Event-ID resume | `src/routes/streams.ts` |
| `Idempotency-Key` + `invocationId` | `src/routes/runs.ts` + `src/executor/invocationLog.ts` |
| BYOK end-to-end with strip-on-persist | `src/byok/` + `src/storage/sqlite/runStore.ts` (strip-on-persist invariant tested) |
| Pack consumption (SRI + Ed25519) | `src/packs/tarballLoader.ts` |
| OTel under `openwop.*` | `src/observability/tracer.ts` |
| Cloud Run shape | `Dockerfile` + `src/index.ts` (`$PORT`, health probes) |
| Conformance harness | `conformance/` |

| Frontend should-be | Sample location |
|---|---|
| `@openwop/openwop` browser consumption | `src/client/` (thin wrappers) |
| Run lifecycle UI | `src/runs/` |
| SSE event stream rendering | `src/streams/EventStreamView.tsx` |
| 4 interrupt renderers | `src/interrupts/` |
| Capability discovery UI | `src/discovery/CapabilitiesPanel.tsx` |
| BYOK key entry + policy explainer | `src/byok/` |

## Failure modes the sample explicitly does NOT guard against

These are valid critiques of the sample as a *production* artifact, but in scope only for the documented "next step" follow-ups:

- **Multi-instance dispatch.** sqlite + in-process executor means one instance, period. Real deployments need claim acquisition (postgres advisory locks) + Cloud Tasks / SQS / Pub/Sub.
- **Webhook durability.** HMAC delivery is wired; the durable retry queue is stubbed (`setImmediate`).
- **Audit-log integrity.** No hash chain, no Ed25519 checkpoint signatures. Use the postgres reference host for that profile.
- **Production SLA claims.** Sample doesn't advertise `openwop-production-profile`.
- **Pack publishing.** Read-only catalog only. Publishing lives in the postgres host's `pack-consumer.ts` story + `examples/node-pack-publishing/`.

When swapping a stub for a real implementation, also update the relevant `capabilities` block in `src/routes/discovery.ts` so the advertisement stays honest.

---

## Surfaces added after the initial scaffolding

### AI chat surface (`frontend/react/src/chat/` + `backend/.../bootstrap/nodes.ts` `vendor.openwop-sample.chat-responder`)

A vertical slice from chat input → real provider dispatch → streamed tokens back into the bubble. Components:

- `ChatTab.tsx` — state machine that routes between BYOK wizard (no key) and `ChatSidebar` (key present).
- `ChatSidebar.tsx` + `ChatHeader` + `MessageFeed` + `MessageBubble` + `ChatInput` + `WelcomeCard` — the sidebar UI.
- `useChatSession.ts` — message thread state + per-turn dispatch. Each turn = one `POST /v1/runs` with `workflowId: 'sample.chat.turn'`. Subscribes to SSE; appends `node.message` deltas to the in-flight assistant bubble; on `node.suspended` fetches the open interrupt and renders the matching card via the registry.
- **Card registry** (`chat/registry/`) is the extensibility seam. Adopters call `registerCard({cardType, Component, ...})` from any module to add their own card type. Built-in registrations cover the 4 interrupt kinds (approval / clarification / refinement / cancellation). Cards wrap in `CardErrorBoundary` so a broken third-party card doesn't crash the panel.

BE-side: `vendor.openwop-sample.chat-responder` node calls Anthropic / OpenAI / Google providers via raw `fetch` (no SDK deps). Each token delta becomes a `node.message` event through `ctx.emit()` — strip-on-persist applies automatically.

### Sample-extension HTTP routes (vendor-prefixed)

Per `spec/v1/host-extensions.md` §"Canonical prefixes", anything outside the OpenWOP v1 wire contract MUST be vendor-prefixed. Sample's additions:

- `GET / POST / DELETE /v1/host/sample/byok/secrets[/:ref]` — runtime BYOK key management (replaces the env-only flow).
- `GET /v1/host/sample/runs/:id/interrupts` — authed list of open interrupts with their resume tokens. Necessary because `node.suspended` events strip the token from the public event log so SSE / webhook fanout can't leak a resolution capability. Strong candidate for future RFC promotion — every host that strips tokens needs this surface.

### BYOK persistence (`backend/.../byok/`)

- `secretResolver.ts` delegates to sqlite via new `Storage` methods (`upsertEncryptedSecret` / `getEncryptedSecret` / `deleteSecret` / `listSecretRefs`).
- `encryption.ts` provides AES-256-GCM with master-key resolution: `OPENWOP_BYOK_ENCRYPTION_KEY` env var → auto-generated `data/.byok-master-key` (0600 perms) on first boot.
- Security boundary documented at the top of `encryption.ts`: protects against backup leaks and database extraction; does NOT protect against full filesystem access (master key on disk) or process memory inspection (decrypted plaintext cached in-process). Real KMS swaps both `loadMasterKey()` and the cache policy.

### Pack coverage: all `core.openwop.*` nodes in the builder palette

On boot the server runs three layered pack-loading steps:

1. **`ensureRegistryPacksInstalled()`** — fetches published, Ed25519-signed packs (`core.openwop.ai`, `core.openwop.http`, …) from `packs.openwop.dev` and verifies them per spec. Trust anchor: registry public keys at `<repo>/registry/keys/<keyId>.pub`.
2. **`ensureLocalPacksMounted()`** — dev-mode fallback (`src/bootstrap/mountLocalPacks.ts`). Symlinks every `core.openwop.*` directory from the repo's `packs/` tree into the same `OPENWOP_PACK_DIR` the registry installer writes to. Two refinements:
   - **Skip-if-installed** — never clobbers a registry-installed pack with the same name.
   - **Shadow-if-newer** (default; opt out with `OPENWOP_STRICT_REGISTRY=true`) — when the repo manifest version is greater than the registry-installed version, rename the installed dir aside (`<name>.registry-<oldVersion>`) and symlink the repo dir in its place. Logged loudly; reversible by deleting the symlink and `mv`-ing the `.registry-*` dir back.
3. **`seedDefaultHostSurfaces()`** + **`initInMemorySurfaces({ dataDir })`** — declares the full RFC 0014–0019 surface list with `supported=false` defaults, then wires in-memory adapters (`src/host/inMemorySurfaces.ts`) and flips each wired surface to `supported=true`.

The catalog endpoint (`GET /v1/host/sample/node-catalog`) cross-references each node's typeId against `bootstrap/hostSurfaceMap.ts` to compute `requiresHostSurfaces` + `missingHostSurfaces`. The UI dims palette items whose surfaces aren't advertised and shows a warning banner in the inspector; runs of those nodes return a friendly `host_capability_missing` envelope (augmented in `packs/tarballLoader.ts`).

### In-memory host surfaces (demo-grade)

`src/host/inMemorySurfaces.ts` builds one surface bundle per run, scope-bound to `tenantId`:

| Field on `ctx` | Backing impl | Used by packs |
|---|---|---|
| `ctx.storage.kv` | `Map<tenantId, Map<key, entry>>` with TTL | `core.openwop.storage` (kv-*) |
| `ctx.storage.table` | tenant-scoped Map, table namespacing via key prefix | `core.openwop.storage` (table-*) |
| `ctx.storage.cache` | KV under a separate state Map | `core.openwop.storage` (cache-*) |
| `ctx.storage.blob` | Map of base64 blobs, synthetic `presign()` URL | `core.openwop.storage` (blob-*) |
| `ctx.storage.queue` | FIFO array per (tenant, queue) | `core.openwop.storage` (queue-*) |
| `ctx.db.sql` | `better-sqlite3` `:memory:` DB per tenant + parametric heuristic | `core.openwop.db` (sql-*) |
| `ctx.db.vector` | brute-force cosine over an in-memory Map | `core.openwop.db` (vector-*), `core.openwop.rag` (vector-*) |
| `ctx.fs` | sandboxed local fs under `<dataDir>/host-fs/<tenant>/` with path-escape rejection | `core.openwop.files` (read/write/stat/list/delete) |
| `ctx.queueBus` | in-memory publish/ack/nack/streamPublish | `core.openwop.messaging` (publish/ack/nack/stream-*) |
| `ctx.observability` | delegates to the workflow-engine structured logger | `core.openwop.obs` (log/metric/span/alert) |

Surfaces NOT wired (advertised honestly as `supported=false`): `host.mcp`, `host.a2a`, `host.triggers` (subset), `host.db.nosql`, `host.db.search`. The palette badges these as "host?" in the UI and the inspector explains.

### Path to real backends (future Phase 6)

The interface contracts in `src/host/inMemorySurfaces.ts` (`KvSurface`, `TableSurface`, `SqlSurface`, …) are the *same* shapes a real-backend host will satisfy. The `NodeContext` typing in `src/executor/types.ts` (`HostStorageSurfaces`, `HostDbSurfaces`, …) doesn't bind to a specific implementation. To swap any single surface with a real backend:

1. Create `src/host/<name>Backend.ts` exporting a factory that returns the same `KvSurface` / `SqlSurface` / etc. shape.
2. Pass the new factory through `buildHostSurfaceBundle` (today a static `return { … }` — split per-surface if you want hot-swap behavior).
3. Update the registration call in `initInMemorySurfaces()` (or a new sibling `initRealSurfaces()`) so `registerHostSurface()` advertises the new `implementation` tag (e.g. `'postgres'`, `'redis'`, `'s3'`). The capabilities panel + the demo banner read this advertisement — once everything is `supported=true` with a non-`in-memory` implementation, the banner self-hides.
4. Re-run `npm run test:conformance` to ensure the openwop-conformance suite still passes against the new wiring.

The reference for *real* backend wiring lives in `examples/hosts/postgres` — that example already pressures the RFC 0014–0019 contracts against actual services, and is the natural place to ship production-grade adapters before they migrate into this sample's host suite.

### Shared provider catalog (`apps/workflow-engine/providers.json`)

Single source of truth for AI provider + model data. Both BE (`src/providers/catalog.ts` for default-model fallback) and FE (`src/byok/lib/providers.ts` for the wizard) read from the same file. The FE loader includes a runtime validator that fails loud on shape mismatch — better than silent `undefined`/`NaN` rendering.

Edit the JSON to add/remove providers or models. The `_schemaVersion` field hints at versioned schema for future migrations.
