# `core.openwop.mcp`

Workflow-author-direct MCP operation pack. Four nodes for invoking the Model Context Protocol explicitly from a workflow DAG — complementing the implicit LLM-mediated tool-call path documented in `spec/v1/mcp-integration.md`.

| Pack name | `core.openwop.mcp` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| External deps | None — pack speaks NO MCP protocol; routes through `ctx.mcp.*` |
| peerDependencies | `mcp: supported` |
| License | Apache-2.0 |

## When to use these nodes vs implicit LLM tool calls

| Path | Use case |
|---|---|
| **LLM-mediated** (implicit, inside an AI node per `mcp-integration.md`) | LLM decides which tool to call + when. Free-form agentic behavior. |
| **Explicit** (this pack) | Workflow author knows exactly which tool to call. Deterministic, predictable, replay-traceable. |

Both paths use the same host MCP client + the same registered servers. The difference is whether the call site is the LLM or the DAG.

## Nodes

| typeId | role | capabilities |
|---|---|---|
| `core.openwop.mcp.list-tools` | `side-effect` | `cacheable`, `side-effectful` |
| `core.openwop.mcp.invoke-tool` | `side-effect` | `cacheable`, `side-effectful` |
| `core.openwop.mcp.read-resource` | `side-effect` | `cacheable`, `side-effectful` |
| `core.openwop.mcp.server-status` | `side-effect` | `cacheable`, `side-effectful` |

All declare `side-effectful` because the operations cross a network boundary to an MCP server whose state may change. Layer-2 invocation caching covers replay safety.

### `list-tools`

Lists tools exposed by a registered MCP server. Useful for dynamic tool-discovery workflows + for diagnostics.

```json
{ "config": { "serverId": "web-search" }, "inputs": {} }
// outputs: { tools: [{ name, description, inputSchema }, ...], count: N }
```

### `invoke-tool`

Calls a tool by name with caller-supplied args. The host's MCP client forwards the call; server-side schema mismatch surfaces as `mcp_tool_invalid_args`.

```json
{
  "config": { "serverId": "web-search", "toolName": "search", "timeoutMs": 5000 },
  "inputs": { "args": { "query": "openwop protocol" } }
}
// outputs: { result, isError, untrustedContent?, durationMs }
```

**Security:** when the MCP server returns untrusted content (the host marks it via `prompt-injection-mcp-marker` per `SECURITY/threat-model-prompt-injection.md`), `untrustedContent: true` is propagated to the output. Downstream LLM nodes MUST wrap such results in untrusted markers before passing to the model.

### `read-resource`

Reads a resource by URI (`file:///`, `memo://`, server-defined schemes). Returns content + MIME type.

```json
{ "config": { "serverId": "filesystem", "uri": "file:///workspace/docs/spec.md" } }
// outputs: { content, mimeType, encoding?, uri }
```

### `server-status`

Health check. Returns `available: false` rather than throwing on transport failures or timeouts — the whole point is to probe.

```json
{ "config": { "serverId": "web-search", "timeoutMs": 2000 } }
// outputs: { available, name?, version?, latencyMs, error? }
```

## Host contract

The pack reads `ctx.mcp.{listTools, invokeTool, readResource, serverStatus}`. Per `spec/v1/mcp-integration.md`, MCP advertisement is host-extension (the spec doesn't yet declare a normative `Capabilities.mcp` field; it's host-implementation-defined). Hosts advertising MCP support — via top-level `mcp` slot or vendor namespace — MUST expose these primitives:

```typescript
ctx.mcp.listTools(serverId)
  → Promise<{ tools: Array<{ name, description?, inputSchema? }> }>

ctx.mcp.invokeTool(serverId, toolName, args, { timeoutMs? })
  → Promise<{ result, isError: boolean, untrustedContent?: boolean }>

ctx.mcp.readResource(serverId, uri, { timeoutMs? })
  → Promise<{ content, mimeType, encoding?: 'utf-8' | 'base64' }>

ctx.mcp.serverStatus(serverId, { timeoutMs? })
  → Promise<{ available: boolean, name?, version?, error? }>
```

Hosts that don't expose this throw `host_capability_missing` at runtime (workflow-register-time refusal via `peerDependencies` is the preferred path).

## See also

- [`spec/v1/mcp-integration.md`](../../spec/v1/mcp-integration.md) — composition pattern + invariants
- [`spec/v1/replay.md`](../../spec/v1/replay.md) §"Replay determinism"
- [`examples/mcp-tool/`](../../examples/mcp-tool/) — vendor-extension probe + observability pattern
- [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md) — Phase 1 catalog
