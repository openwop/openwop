# Tool catalog

> **Status: Stable.**
> **Normative home:** `toolCatalog`.

## Why this exists

A host's tool catalog lists the tools a caller may invoke, with a projection onto MCP `ToolAnnotations`. The shapes are `schemas/v2/tool-descriptor.schema.json` and `schemas/v2/compact-tool-descriptor.schema.json`.

## The catalog

A host advertising `toolCatalog` MUST serve `GET /tools` (a `ToolDescriptor[]`) and `GET /tools/{toolId}`, both read-only.

- The list MUST hold only tools the caller may invoke in its tenant.
- An unknown or unauthorized `toolId` MUST return `404`.
- `toolCatalog.sources` names the sources projected; a consumer MUST tolerate any subset.
- A host SHOULD return tools sorted by `toolId`, so an unchanged catalog reads identically.

## The descriptor

- `toolId` MUST be unique in the catalog and stable for a host version.
- `safetyTier: "exec"` MUST carry `source: "host-extension"`.
- A descriptor MUST NOT carry credential material.
- The host MUST assign `safetyTier`, `replayPolicy` and `egress` itself, and MUST NOT copy them from an MCP server's `annotations`, which are untrusted.
- A `source: "mcp"` tool the host has not classified MUST be `safetyTier: "write"`.

`annotations`, when present, MUST carry all four MCP hints, derived from those fields and not from MCP defaults (upstream, `destructiveHint` and `openWorldHint` default to `true`):

| Hint | True iff |
| --- | --- |
| `readOnlyHint` | `safetyTier` is `pure` or `read` |
| `destructiveHint` | `safetyTier` is `write` or `exec` |
| `idempotentHint` | `replayPolicy` is `deterministic` or `idempotent` |
| `openWorldHint` | `egress` is not `none` |

## Views and sessions

A host advertising `toolCatalog.compactView` MUST answer `?view=compact` on both endpoints with `CompactToolDescriptor`s (the list as `{ tools: [...] }`) carrying the standard view's `toolId` set.

- A compact `inputSchema` MUST NOT use `$ref`, `oneOf`, `allOf`, `anyOf`, `not`, `patternProperties` or `dependentSchemas` at any depth.
- Any other `view`, or a host not advertising it, yields the standard view.

A host advertising `toolCatalog.sessionLifecycle` MAY bracket calls with content-free `tool.session.opened` and `tool.session.closed`; a consumer MUST tolerate their absence.

*Sources: RFC 0078, RFC 0112, RFC 0204.*
