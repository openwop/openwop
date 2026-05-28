# `vendor.myndhyve.canvas`

First vendor-namespace pack. Ships MyndHyve canvas-coordination nodes.

| Pack name | `vendor.myndhyve.canvas` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| External deps | None — speaks no Firestore directly; routes through `ctx.canvas.*` |
| peerDependencies | `host.canvas: supported` |
| License | Apache-2.0 |

## typeId-preserve strategy

Per `docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md` (in myndhyve repo) §4 "typeId strategy," the typeIds in this pack keep their existing `core.coordination.*` prefixes even though the pack is vendor-namespaced. **Stored MyndHyve workflows that reference these typeIds work without rewriting.**

Pack name scoping (`vendor.myndhyve.*`) controls registry submission + signing identity; typeIds are author-chosen + workflow-author-facing. The two are intentionally decoupled.

## Nodes

| typeId | role | capabilities |
|---|---|---|
| `core.coordination.canvasRead` | `side-effect` | `cacheable`, `side-effectful` |
| `core.coordination.canvasWrite` | `side-effect` | `cacheable`, `side-effectful` |
| `core.coordination.canvasCreate` | `side-effect` | `cacheable`, `side-effectful` |
| `core.coordination.crossCanvasInvoke` | `side-effect` | `cacheable`, `side-effectful` |

All four declare `side-effectful + cacheable`. Engine's Layer-2 cache keyed on `(runId, nodeId, request-hash)` guarantees:
- **Reads:** time-pinned value returned on replay
- **Writes:** effect-once — replays do NOT re-apply mutations
- **Creates:** id-once — replays return the original canvasId, no duplicate canvas
- **Invokes:** child-run-once — replays return the original child runId, no duplicate child runs

### `core.coordination.canvasRead`

```json
{
  "config": { "fields": ["screens", "metadata"], "consistency": "strong" },
  "inputs": { "canvasId": "canvas-abc123" }
}
// outputs: { canvasId, state, canvasTypeId?, version, readAt }
```

Optional projection via `config.fields` reduces wire weight. `consistency: 'strong'` waits for in-flight writes; `'eventual'` reads from replica (faster, may be stale).

### `core.coordination.canvasWrite`

```json
{
  "config": { "expectedVersion": 5, "merge": "deep" },
  "inputs": { "canvasId": "canvas-abc123", "mutation": { "metadata": { "title": "Updated" } } }
}
// outputs: { canvasId, newVersion, writtenAt, idempotencyKey }
```

Optional optimistic-concurrency via `expectedVersion`. Three merge modes: `replace` / `shallow` (default) / `deep`. Deterministic Idempotency-Key prevents duplicate writes on replay.

### `core.coordination.canvasCreate`

```json
{
  "config": { "canvasTypeId": "app-builder", "projectId": "proj-1" },
  "inputs": { "name": "Surf Shop", "initialState": { "stage": "draft" } }
}
// outputs: { canvasId, canvasTypeId, name?, projectId?, createdAt, idempotencyKey }
```

Creates a typed canvas. Replays return the originally-created canvasId — no duplicate canvas allocated.

### `core.coordination.crossCanvasInvoke`

```json
{
  "config": {
    "targetCanvasId": "canvas-xyz",
    "workflowId": "process-order",
    "awaitTerminal": true,
    "timeoutMs": 120000,
    "circuitBreaker": { "failureThreshold": 3, "resetMs": 30000 }
  },
  "inputs": { "args": { "orderId": "o-123" } }
}
// outputs: { childRunId, targetCanvasId, terminalStatus?, result?, error?, circuitOpen?, idempotencyKey }
```

Behavior:
- `awaitTerminal: false` (default) → returns immediately with `childRunId` (fire-and-forget)
- `awaitTerminal: true` → suspends until child reaches terminal status (bounded by `timeoutMs`); returns terminalStatus + result/error
- Circuit breaker: host throttles when same caller-workflow + target combo exceeds `failureThreshold` errors within `resetMs`. Open circuit → `circuitOpen: true`, no child run created.

## Host contract

The pack reads `ctx.canvas.{read, write, create, invoke}`. Per `spec/v1/host-extensions.md` §canonical-prefix table, `host.*` is reserved for host-extension capabilities. Hosts that advertise `host.canvas: supported` MUST expose:

```typescript
ctx.canvas.read(canvasId, { fields?, consistency? })
  → Promise<{ canvasId, state, canvasTypeId?, version }>

ctx.canvas.write(canvasId, mutation, { expectedVersion?, merge?, idempotencyKey })
  → Promise<{ canvasId, newVersion }>

ctx.canvas.create({ canvasTypeId, projectId?, name?, initialState?, metadata?, idempotencyKey })
  → Promise<{ canvasId, canvasTypeId, name?, projectId?, createdAt }>

ctx.canvas.invoke(targetCanvasId, workflowId, args, {
  awaitTerminal?, timeoutMs?, circuitBreaker?, idempotencyKey
}) → Promise<{ childRunId, terminalStatus?, result?, error?, circuitOpen? }>
```

The exact field name for the capability advertisement (`host.canvas` vs other shapes) is host-implementation-defined pending Track 10/13 spec coverage in `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`. The pack manifest declares `peerDependencies: { "host.canvas": "supported" }`.

## See also

- [`docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md`](https://github.com/openwop/openwop) (in myndhyve repo) — full migration plan, Phase 2
- [`spec/v1/host-extensions.md`](../../spec/v1/host-extensions.md) §canonical-prefix
- [`spec/v1/replay.md`](../../spec/v1/replay.md) §"Replay determinism" — Layer-2 cache guarantees
