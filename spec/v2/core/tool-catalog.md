# Tool catalog

> **Status: Stable · RFC 0204, RFC 0078, RFC 0112.**
> **Normative home:** `toolCatalog`.

## Why this exists

v2 carried the catalog only by pointing at `spec/v1/tool-catalog.md`. This is its v2 contract, plus a projection onto MCP `ToolAnnotations`. The shapes are `schemas/v2/tool-descriptor.schema.json` and `schemas/v2/compact-tool-descriptor.schema.json`.

## The catalog

A host advertising `toolCatalog` MUST serve `GET /tools` (a `ToolDescriptor[]`) and `GET /tools/{toolId}`, both read-only. The list MUST hold only tools the caller may invoke in its tenant, and an unknown or unauthorized `toolId` MUST return `404`. `toolCatalog.sources` names the sources projected; a consumer MUST tolerate any subset. A host SHOULD return tools sorted by `toolId`, so an unchanged catalog reads identically.

## The descriptor

`toolId` MUST be unique in the catalog and stable for a host version. `safetyTier: "exec"` MUST carry `source: "host-extension"`. A descriptor MUST NOT carry credential material. The host MUST assign `safetyTier`, `replayPolicy` and `egress` itself and MUST NOT copy them from an MCP server's `annotations`, which are untrusted; a `source: "mcp"` tool it has not classified MUST be `safetyTier: "write"`.

`annotations`, when present, MUST carry all four MCP hints, derived from those fields and not from MCP defaults (`destructiveHint` and `openWorldHint` default to `true` upstream): `readOnlyHint` is true iff `safetyTier` is `pure` or `read`, `destructiveHint` iff it is `write` or `exec`, `idempotentHint` iff `replayPolicy` is `deterministic` or `idempotent`, and `openWorldHint` unless `egress` is `none`.

## Views and sessions

A host advertising `toolCatalog.compactView` MUST answer `?view=compact` on both endpoints with `CompactToolDescriptor`s (the list as `{ tools: [...] }`) carrying the standard view's `toolId` set; a compact `inputSchema` MUST NOT use `$ref`, `oneOf`, `allOf`, `anyOf`, `not`, `patternProperties` or `dependentSchemas` at any depth. Any other `view`, or a host not advertising it, yields the standard view. A host advertising `toolCatalog.sessionLifecycle` MAY bracket calls with content-free `tool.session.opened` and `tool.session.closed`; a consumer MUST tolerate their absence.
