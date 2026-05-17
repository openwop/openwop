# RFC 0020: host-side MCP server composition

| Field | Value |
|---|---|
| **RFC** | 0020 |
| **Title** | Host-side MCP server composition |
| **Status** | `Active` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-17 |
| **Updated** | 2026-05-17 |
| **Affects** | `spec/v1/mcp-integration.md` · `schemas/capabilities.schema.json` · new conformance scenarios |
| **Compatibility** | `additive` |

## Summary

Adds a normative §"OpenWOP host as MCP server" section to `spec/v1/mcp-integration.md`, paralleling the existing §"OpenWOP host as A2A agent" treatment in `a2a-integration.md`. Lets an openwop host *mount* its workflows as MCP tools/resources/prompts, with bidirectional `sampling/createMessage` and `elicitation/create` callbacks routed into the existing AI-provider and interrupt mechanisms. Pairs with the 8 `core.openwop.mcp.{server-trigger,expose-*,handle-*,provide-roots}` nodes shipped in `core.openwop.mcp@1.1.0`.

## Motivation

`spec/v1/mcp-integration.md` currently covers only the *client* direction — an openwop workflow calling out to a remote MCP server via `ctx.mcp.*`. The *server* direction — an MCP-aware LLM client (Claude Desktop, Cursor, ChatGPT) discovering and invoking openwop workflows as tools — is unspecified. Track 6 of `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` was closed on the client half only; this RFC closes the server half.

Demand signal: every other workflow editor in the 2026 catalog (Make, n8n, Zapier MCP previews) ships both directions. Without this, openwop workflows are *consumers* of the MCP ecosystem but cannot be *contributors* to it.

## Proposal

### §A New section in `mcp-integration.md`: "OpenWOP host as MCP server"

A normative section mirroring `a2a-integration.md` §"Concrete example: OpenWOP host as A2A agent":

1. **Mount.** A host MAY expose an MCP-server endpoint (stdio subprocess and/or streamable-HTTP). When advertised, the host serves `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read`, `resources/subscribe`, `prompts/list`, `prompts/get`, `completion/complete`, `ping`, `logging/setLevel`, plus the notifications `tools/list_changed`, `resources/list_changed`, `resources/updated`, `prompts/list_changed`, `message`, `progress`, `cancelled` — per modelcontextprotocol.io 2025-06-18.

2. **State projection: workflow → MCP tool.** A workflow that registers via `core.openwop.mcp.expose-tool` (or the host's equivalent declarative shape) is advertised in the host's `tools/list` response. Each `tools/call` invocation starts a new openwop run with:
   - `inputs` from `params.arguments` validated against the tool's `inputSchema`.
   - `runOptions.trustBoundary: 'untrusted'` (mirrors `host.mcp` client-side; tool args arrive from external LLMs).
   - Run reaches terminal state → response body packed as `CallToolResult` with `content[]` text/image/audio parts.

3. **Bidirectional callbacks.** When the workflow uses `core.openwop.mcp.handle-sampling`, the host's MCP server bridges inbound `sampling/createMessage` requests into the workflow's `ctx.callAI` (preserves user consent + BYOK — the user's model under the user's key, never the server's). `core.openwop.mcp.handle-elicitation` similarly bridges `elicitation/create` into `ctx.suspend({kind: 'clarification', profile: 'openwop-mcp-elicitation'})`, returning `accept`/`decline`/`cancel` per the flat-schema constraint.

4. **Trust boundary.** All inbound MCP requests cross an `untrusted` boundary. Tool arguments are validated against the per-tool JSON Schema; resource URIs are sanitized; prompts are rendered without `eval`. The existing `prompt-injection-mcp-marker` invariant from `SECURITY/threat-model-prompt-injection.md` applies symmetrically.

### §B Capability schema additions

```diff
   "mcp": {
     "type": "object",
     "properties": {
       "supported": { "type": "boolean" },
+      "serverMount": {
+        "type": "object",
+        "description": "Host advertises an MCP-server endpoint (workflows can be exposed as MCP tools / resources / prompts).",
+        "properties": {
+          "supported": { "type": "boolean" },
+          "transports": { "type": "array", "items": { "type": "string", "enum": ["stdio", "streamable-http"] } },
+          "samplingBridge": { "type": "boolean", "description": "Host bridges inbound sampling/createMessage into the workflow's ctx.callAI." },
+          "elicitationBridge": { "type": "boolean", "description": "Host bridges inbound elicitation/create into ctx.suspend." }
+        },
+        "additionalProperties": false
+      }
     }
   }
```

### §C State projection table

| OpenWOP run state | MCP server response |
|---|---|
| `pending` / `running` | (request blocks; SSE progress events emit `notifications/progress` if subscribed) |
| `completed` | `CallToolResult { content: [...], isError: false }` |
| `failed` | `CallToolResult { content: [error message], isError: true }` |
| `awaiting-input` (clarification) | (out-of-band: bridged via `elicitation/create` callback, NOT a `tools/call` response) |
| `awaiting-input` (approval) | Same — bridged via `elicitation/create` with accept/decline/cancel mapping |
| `canceled` | `CallToolResult { content: [...], isError: true }` with `tool_canceled` |

### §D Trust boundary

- Inbound MCP requests cross an `untrusted` boundary regardless of transport. `tools/call.arguments` MUST validate against the declared `inputSchema`; resource URIs MUST be normalized + sandboxed; prompt arguments MUST NOT be template-evaluated.
- The existing `prompt-injection-mcp-marker` invariant (`SECURITY/threat-model-prompt-injection.md`) applies. Outputs from an MCP tool feeding into an LLM downstream remain `trustBoundary: 'untrusted'`.

### §E What openwop does NOT specify

Same posture as `mcp-integration.md` §"What openwop does NOT specify about MCP":
- Wire encoding details — those are the MCP spec.
- Specific transports beyond advertising which are supported.
- Tool authoring beyond the openwop pack contribution surface.

## Compatibility

**Additive.** New optional `capabilities.mcp.serverMount` block. Existing clients that don't read it see unchanged behavior. Hosts that don't advertise it MUST NOT accept inbound MCP requests; `core.openwop.mcp.server-trigger` registration MUST refuse with `pack_peer_dependency_missing`.

## Conformance

New scenarios (capability-gated on `capabilities.mcp.serverMount.supported`):
- `mcp-server-tool-roundtrip.test.ts` — `tools/list` then `tools/call` against a workflow exposed via `core.openwop.mcp.expose-tool`.
- `mcp-server-resource-roundtrip.test.ts` — `resources/list` then `resources/read`.
- `mcp-server-prompt-roundtrip.test.ts` — `prompts/list` then `prompts/get`.
- `mcp-server-sampling-bridge.test.ts` — inbound `sampling/createMessage` reaches workflow's `ctx.callAI` (gated on `samplingBridge`).
- `mcp-server-elicitation-bridge.test.ts` — inbound `elicitation/create` reaches `ctx.suspend` and the accept/decline/cancel path round-trips (gated on `elicitationBridge`).
- `mcp-server-untrusted-args.test.ts` — malformed `arguments` rejected per `inputSchema`.

## Alternatives considered

1. **Pack-side only.** Ship the `core.openwop.mcp.server-*` nodes without an RFC, treating server-mount as a host extension. Rejected: the bidirectional sampling/elicitation flow needs spec-level state projection because it sits at the intersection of `aiProviders` (BYOK consent) and `interrupt` (suspension semantics) — both of which are normatively openwop's.
2. **Defer to v1.2.** Rejected: 8 pack nodes already ship in `core.openwop.mcp@1.1.0` and would otherwise be unspecified. Better to land the spec at Draft now and lock the wire shape early.

## Unresolved questions

1. Should `samplingBridge` and `elicitationBridge` be independently advertisable (current proposal) or a single `bidirectional: true` flag? Independent feels cleaner because hosts may want to expose only one.
2. Authentication for MCP server endpoint: same `auth.profiles.*` surface, or MCP-specific (the MCP spec defines its own OAuth2 flow for streamable-http)? Spec the link, defer the choice to host.

## Implementation notes (non-normative)

- Schema diff in §B lands in `capabilities.schema.json` on Active promotion, not at Draft.
- New SECURITY invariant proposed: `mcp-server-untrusted-args` (tool args MUST validate against `inputSchema` before workflow start). Lands alongside the matching `mcp-server-untrusted-args.test.ts` at Active.
- Reference impl candidate: extend `examples/hosts/postgres/` with an optional MCP-server mount behind `OPENWOP_MCP_SERVER_PORT=…` env var.

## Acceptance criteria

- [ ] `mcp-integration.md` §"OpenWOP host as MCP server" added (mirrors the A2A treatment).
- [ ] `capabilities.serverMount` block in `capabilities.schema.json`.
- [ ] SECURITY invariant `mcp-server-untrusted-args` + matching test.
- [ ] 6 conformance scenarios above (capability-gated).
- [ ] Reference host implementation OR explicit deferral.
- [ ] CHANGELOG entry.

## References

- `spec/v1/mcp-integration.md` (existing client-side coverage; this RFC adds the server-side section).
- `spec/v1/a2a-integration.md` (template for server-side composition prose).
- `core.openwop.mcp@1.1.0` pack (8 mcp.server-* nodes that this RFC normates).
- modelcontextprotocol.io 2025-06-18 spec (canonical wire reference).
- `SECURITY/threat-model-prompt-injection.md` (untrusted-boundary invariants).
