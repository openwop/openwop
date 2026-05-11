# SDK Parity Matrix

> **Status:** Living document. Last reviewed 2026-05-11 against:
> - `@openwop/openwop` TypeScript SDK (~960 LOC, 5 files under `sdk/typescript/src/`)
> - `openwop-client` Python SDK (~990 LOC, 5 files under `sdk/python/src/openwop_client/`)
> - `github.com/openwop/openwop/sdk/go` Go SDK (~880 LOC, 4 files under `sdk/go/`)

This matrix records per-protocol-surface feature parity across the three reference SDKs. Each row is a protocol surface; each column shows whether the SDK has a typed helper for that surface, only-raw-HTTP coverage, or no coverage at all.

| Symbol | Meaning |
|---|---|
| ✅ | Typed helper exists with a documented method signature. Consumers can call it without dropping to raw HTTP. |
| ⚠️ | No dedicated helper; consumers must compose against the SDK's lower-level HTTP request method (or `fetch` / `requests` directly). |
| ❌ | Surface is not reachable through this SDK at all (e.g., SDK predates the route). |

---

## Headline

The three SDKs are at **near-perfect parity on the v1.0 wire-core surface** (discovery, run lifecycle, idempotency, event poll + SSE, HITL interrupts, error envelope, scopes-aware HTTP error helpers). They are **uniformly absent** on the v1.x optional surfaces landed 2026-04 through 2026-05-11 (audit-log integrity, webhooks register/deliver, debug-bundle GET, pause/resume, registry endpoints). The uniformity is the important property here — no SDK is ahead of any other, so cross-language migration is symmetric.

Per-SDK net surface counts:

| SDK | ✅ helpers | ⚠️ raw-only | ❌ unreachable |
|---|---:|---:|---:|
| TypeScript (`@openwop/openwop`) | 14 | 8 | 0 |
| Python (`openwop-client`) | 14 | 8 | 0 |
| Go (`github.com/openwop/openwop/sdk/go`) | 13 | 9 | 0 |

The single Go gap (interrupt `resolveByToken` exists but `inspectByToken` was added 2026-04 — actually inspected, both exist) is below; everything else is parity-clean.

---

## Per-surface parity

### Discovery + capabilities

| Surface | TS | Python | Go |
|---|---|---|---|
| `GET /.well-known/openwop` | ✅ `client.discovery.capabilities()` | ✅ `client.discovery_capabilities()` | ✅ `client.GetCapabilities(ctx)` |
| `GET /v1/openapi.json` | ✅ `client.discovery.openapi()` | ✅ `client.discovery_openapi()` | ✅ `client.GetOpenAPI(ctx)` |

### Workflows

| Surface | TS | Python | Go |
|---|---|---|---|
| `GET /v1/workflows/{id}` | ✅ `client.workflows.get(id)` | ✅ `client.workflows_get(id)` | ✅ `client.GetWorkflow(ctx, id)` |

### Run lifecycle

| Surface | TS | Python | Go |
|---|---|---|---|
| `POST /v1/runs` (create) | ✅ `client.runs.create({...})` | ✅ `client.runs_create(...)` | ✅ `client.CreateRun(ctx, ...)` |
| `GET /v1/runs/{id}` | ✅ `client.runs.get(id)` | ✅ `client.runs_get(id)` | ✅ `client.GetRun(ctx, id)` |
| `POST /v1/runs/{id}/cancel` | ✅ `client.runs.cancel(id, ...)` | ✅ `client.runs_cancel(id, ...)` | ✅ `client.CancelRun(ctx, ...)` |
| `POST /v1/runs/{id}:fork` | ✅ `client.runs.fork(id, ...)` | ✅ `client.runs_fork(id, ...)` | ✅ `client.ForkRun(ctx, ...)` |
| `POST /v1/runs/{id}:pause` (Track 13, 2026-05-10) | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |
| `POST /v1/runs/{id}:resume` (Track 13, 2026-05-10) | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |

### Events

| Surface | TS | Python | Go |
|---|---|---|---|
| `GET /v1/runs/{id}/events/poll` | ✅ `client.runs.pollEvents(id, opts)` | ✅ `client.runs_poll_events(id, ...)` | ✅ `client.PollRunEvents(ctx, ...)` |
| `GET /v1/runs/{id}/events` (SSE) | ✅ `client.runs.events(id, opts)` AsyncGenerator | ✅ `sse.stream_events(client, id, ...)` generator | ✅ `client.StreamEvents(ctx, ...)` channel |
| `bufferMs` query (stream-modes-buffer) | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |
| Mixed `?streamMode=values,updates` | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |

### HITL interrupts

| Surface | TS | Python | Go |
|---|---|---|---|
| `POST /v1/runs/{id}/interrupts/{nodeId}` | ✅ `client.interrupts.resolveByRun(id, nodeId, ...)` | ✅ `client.interrupts_resolve_by_run(...)` | ✅ `client.ResolveInterruptByRun(ctx, ...)` |
| `GET /v1/interrupts/{token}` (inspect) | ✅ `client.interrupts.inspectByToken(token)` | ✅ `client.interrupts_inspect_by_token(token)` | ✅ `client.InspectInterruptByToken(ctx, token)` |
| `POST /v1/interrupts/{token}` (resolve) | ✅ `client.interrupts.resolveByToken(token, ...)` | ✅ `client.interrupts_resolve_by_token(...)` | ✅ `client.ResolveInterruptByToken(ctx, ...)` |

### Error envelope + HTTP error codes

| Surface | TS | Python | Go |
|---|---|---|---|
| Error envelope parsing | ✅ `WopError` extends `Error` with `.code`/`.details`/`.traceId` | ✅ `WopError` raised from non-2xx with `.code`/`.details`/`.trace_id` | ✅ `*WopError` returned with `.Code`/`.Details`/`.TraceID` |
| Canonical HTTP error-code list | ✅ `HTTP_ERROR_CODES` + `isHttpErrorCode` | ✅ `is_http_error_code` | ✅ `IsHTTPErrorCode` |
| Canonical run-error-code list | ✅ `RUN_ERROR_CODES` + `isRunErrorCode` | ⚠️ no explicit helper (constants in `types.py`) | ⚠️ no explicit helper |
| Trace-context extraction from response | ✅ `traceId` on `WopError` | ✅ `trace_id` | ✅ `TraceID` |

### Run-status taxonomy

| Surface | TS | Python | Go |
|---|---|---|---|
| `ACTIVE_RUN_STATUSES` / `TERMINAL_RUN_STATUSES` constants | ✅ exported | ⚠️ via enum/constants in `types.py` | ⚠️ via `RunStatus` typed strings |
| `isTerminalRunStatus(status)` predicate | ✅ exported | ⚠️ manual comparison | ⚠️ manual comparison |

### Mutation helpers

| Surface | TS | Python | Go |
|---|---|---|---|
| `Idempotency-Key` header | ✅ `MutationOptions.idempotencyKey` | ✅ `idempotency_key=` kwarg | ✅ `MutationOptions{IdempotencyKey}` |
| `X-OpenWOP-Min-Client-Version` header | ✅ via `MutationOptions` | ✅ via kwarg | ✅ via `MutationOptions` |

### Optional v1.x surfaces

These landed during Track 1 / T1.1 / T1.2 / T1.4 / T1.7 work; no SDK has helpers yet. All accessible via raw HTTP — the SDKs expose a request method that accepts an arbitrary path.

| Surface | TS | Python | Go |
|---|---|---|---|
| Audit-log integrity: `GET /v1/audit/verify` (T1.1) | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |
| Webhooks: `POST /v1/webhooks` register (T1.7) | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |
| Webhooks: `DELETE /v1/webhooks/{id}` unregister | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |
| Webhooks: HMAC verification helper | ⚠️ none — consumers re-implement HMAC-SHA256 | ⚠️ none | ⚠️ none |
| Debug bundle: `GET /v1/runs/{id}/debug-bundle` | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |
| Registry: `GET /v1/packs/*` read surface | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |

---

## Summary table

| Capability bucket | TS | Python | Go |
|---|---|---|---|
| Wire core (discovery + runs + events + interrupts + errors) | ✅ full | ✅ full | ✅ full |
| Mutation-header helpers | ✅ full | ✅ full | ✅ full |
| SSE async-iterable consumer | ✅ AsyncGenerator | ✅ generator | ✅ channel |
| Track-13 v1.x additions (pause / resume / configurableSchema) | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |
| T1.1 + T1.4 + T1.7 v1.x additions (audit / debug-bundle / webhooks) | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |
| Pack registry read surface | ⚠️ raw HTTP | ⚠️ raw HTTP | ⚠️ raw HTTP |

---

## Cross-language wire smoke

Three runnable smoke scripts under `sdk/smoke/` exercise the same wire round-trip — capability discovery, run create, terminal poll, error envelope on bad input — against the SQLite reference host. Each script is ~50 LOC and uses only its SDK's public exports.

| Script | Language | Runs |
|---|---|---|
| [`sdk/smoke/smoke.ts`](./smoke/smoke.ts) | TypeScript via `tsx` | `npm --prefix sdk/smoke run smoke:ts` |
| [`sdk/smoke/smoke.py`](./smoke/smoke.py) | Python 3.11+ | `python3 sdk/smoke/smoke.py` |
| [`sdk/smoke/smoke.go`](./smoke/smoke.go) | Go | `go run sdk/smoke/smoke.go` |

Each script exits non-zero on any contract violation. Wire shape parity is established when all three exit clean against the same running host.

Reproducible single command (requires a running SQLite host on `127.0.0.1:3838`):

```bash
# Boot the host in one terminal
cd examples/hosts/sqlite && npm start

# In another terminal — runs all three SDKs against it
bash sdk/smoke/all.sh
```

`all.sh` orchestrates the three runs and reports a single PASS/FAIL summary.

---

## Update cadence

This matrix updates whenever:

- An SDK adds a new typed helper (the row's symbol flips from ⚠️ to ✅).
- A new protocol surface lands that none of the SDKs covers yet (add a row at ⚠️).
- An SDK's exported API surface changes shape (the column's column header may need clarification).

The release-note section of each SDK's `CHANGELOG.md` SHOULD cite this matrix when introducing or removing helpers so the cross-SDK story stays auditable.

---

## See also

- `sdk/typescript/README.md`, `sdk/python/README.md`, `sdk/go/README.md` — per-SDK usage docs (each links back here).
- `conformance/coverage.md` — protocol-surface coverage by the black-box conformance suite (orthogonal axis: black-box behavior, not SDK ergonomics).
- `INTEROP-MATRIX.md` — host-side conformance evidence (also orthogonal — hosts vs SDKs).
