# `vendor.myndhyve.data-integration`

MyndHyve typed-data-source pack. 7 nodes for data ingestion + transformation tied to MyndHyve-registered sources and run variables.

| Pack | `vendor.myndhyve.data-integration` |
| peerDependencies | `host.dataIntegration: supported` |

## Nodes (typeId-preserve)

| typeId | role |
|---|---|
| `data.source.rest` | side-effect (REST source with optional pagination) |
| `data.source.graphql` | side-effect (GraphQL endpoint) |
| `data.source.a2a` | side-effect (A2A peer per `spec/v1/a2a-integration.md`) |
| `data.source.mcp` | side-effect (MCP resource OR tool — discriminated by `operation.kind`) |
| `data.transform` | **pure** (jq / JSONata / host-extension transform expression) |
| `data.variable.compute` | **pure** (derive a run-scoped variable from expression) |
| `data.variable.fetch` | side-effect (read a run-scoped variable; optional `defaultValue` or `variable_not_found` throw) |

## Distinct from other packs

| Need | Use this pack | Use other pack |
|---|---|---|
| Higher-level typed REST source with auth + pagination | `data.source.rest` | — |
| Raw HTTP fetch | — | `core.openwop.http.fetch` |
| Workflow-author MCP tool/resource ops | — | `core.openwop.mcp.*` |
| Pure data utilities (array/string/object/etc.) | — | `core.openwop.data.*` |
| MCP source-of-record (data, not action) | `data.source.mcp` | — |

## Host contract

```typescript
ctx.dataIntegration.fetchRest({ sourceId, method, path?, params?, body?, paginate, idempotencyKey })
  → Promise<{ data, status, pages?, fetchedAt? }>

ctx.dataIntegration.fetchGraphql({ sourceId, operation, operationName?, variables?, idempotencyKey })
  → Promise<{ data, errors?, fetchedAt? }>

ctx.dataIntegration.fetchA2A({ peerId, taskType, payload?, timeoutMs?, idempotencyKey })
  → Promise<{ result?, taskState, error?, taskId? }>

ctx.dataIntegration.fetchMCP({ serverId, operation, args?, idempotencyKey })
  → Promise<{ data, isError?, mimeType? }>

ctx.dataIntegration.transform({ expression, language, data })
  → Promise<{ result }>

ctx.dataIntegration.computeVariable({ variableName, expression, language, context? })
  → Promise<{ value }>

ctx.dataIntegration.fetchVariable({ variableName })
  → Promise<{ found, value? }>
```

## See also

- [`docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md`](https://github.com/openwop/openwop) (in myndhyve)
- `spec/v1/a2a-integration.md` — A2A composition pattern
