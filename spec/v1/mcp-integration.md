# openwop Spec v1 — MCP Integration

> **Status: Stable · v1.1 (2026-05-05).** Worked example of how OpenWOP and the Model Context Protocol (MCP) compose. Non-normative composition pattern; the §"Trust boundary" rules restate normative invariants from `SECURITY/threat-model-prompt-injection.md` (3 RFC 2119 keywords, all citing pre-existing invariants). Graduated DRAFT → FINAL via RFC 0006. See `auth.md` for the status legend.

---

## TL;DR

**OpenWOP runs the workflow. MCP exposes tools to the LLM nodes inside that workflow.** The two protocols compose; they don't compete.

An OpenWOP node that calls an LLM gets its tools from registered MCP servers. The LLM, when it wants to use a tool, emits a tool-call envelope; the OpenWOP host dispatches that to the MCP server; the MCP server returns a result; the host feeds the result back into the next LLM turn.

```
[OpenWOP host] ── runs ──> [Workflow]
                         │
                         │  per node:
                         ▼
                       [LLM node]
                         │
                         │  LLM may emit tool-call envelopes
                         ▼
                       [OpenWOP host's MCP client] ── calls ──> [MCP server]
                                                              │ (e.g. file system, search,
                                                              │  vector DB, host-vendor tools)
                                                              ▼
                                                            [Tool result]
                         ◄───── result ───────────────────────┘
                         │
                         ▼
                       [Next LLM turn]
```

---

## Why this composition

openwop standardizes the **execution semantics**: what does it mean to "run" a workflow, "interrupt" it, "stream" its events, "replay" it from the event log? openwop doesn't prescribe what tools an LLM has access to.

MCP standardizes the **tool/resource access**: how does an LLM-app discover and invoke tools, read resources, fetch prompts? MCP doesn't prescribe what runs the LLM-app or what to do with multi-step state.

The two layer naturally:

| Layer | Owner | Concerns |
|---|---|---|
| Workflow execution + state | openwop | Run lifecycle, events, interrupts, replay, observability, conformance |
| Tool/resource access | MCP | Tool catalog, schema, invocation, result shape |

An OpenWOP host announces MCP-compatibility via `/.well-known/openwop` — either at the top-level `mcp` slot or under a vendor namespace like `<vendor>.mcp`. Both are host-implementation-defined; not normative openwop fields. The discovery body itself is the capabilities object (there is no `capabilities` envelope — `replay`, `secrets`, `extensions`, etc. all live at the top level). Workflow authors who depend on MCP tools select hosts that advertise the capability.

---

## Concrete example

A workflow that searches the web and summarizes the results:

```yaml
# Conceptual workflow definition
nodes:
  - id: search
    typeId: core.ai.callPrompt
    config:
      systemPrompt: "Search the web for the user's query and summarize."
      mcpServers: ["web-search"]    # host-extension field
  - id: summarize
    typeId: core.noop
edges:
  - from: search
    to: summarize
```

When this runs:

1. **OpenWOP host** dispatches the `search` node.
2. The node invokes the LLM with the system prompt + the user input from `inputs.query`.
3. **LLM emits a tool-call envelope** asking for the `web-search.search` tool.
4. OpenWOP host's MCP client connects to the `web-search` MCP server, invokes the `search(query)` tool.
5. **MCP server** returns search results.
6. OpenWOP host feeds the result back into the LLM as the next turn's input.
7. LLM returns its summary as a workflow envelope (`summary.create` or similar).
8. OpenWOP host stores the summary as an artifact, advances to the `summarize` node.

The LLM's tool-call envelope follows MCP's tool-call shape; the `summary.create` envelope follows openwop's envelope vocabulary. Each side owns its layer.

---

## Trust boundary

A registered MCP server is **trusted to behave per its manifest** (per `SECURITY/threat-model-node-packs.md` §"Sandbox execution" — the same trust model applies). A compromised MCP server can:

- Return malicious content that prompt-injects the LLM.
- Exfiltrate workflow inputs by returning them in the next tool result.
- Refuse to respect tool-allowlist restrictions.

openwop's response to these risks (per `SECURITY/threat-model-prompt-injection.md`):

- MCP tool responses MUST be wrapped in `<UNTRUSTED tool="...">` markers in the next LLM turn (`prompt-injection-mcp-marker` invariant).
- MCP tool responses MUST NOT advance HITL approval gates (`prompt-injection-mcp-no-approval` invariant).
- LLM-emitted tool-call envelopes MUST be validated against the workflow's declared tool allowlist (`prompt-injection-tool-allowlist` invariant).

These invariants are enforced by the OpenWOP host; the MCP protocol doesn't have to know about them.

---

## Conformance + interop

An OpenWOP host that supports MCP advertises the capability and (per the host's choice) lists supported MCP servers. An OpenWOP client that depends on MCP looks at the discovery payload and confirms the host can execute the workflow.

**Interop today:**

- The **in-memory reference host** does NOT support MCP — its `core.noop` and `core.delay` nodes don't invoke LLMs at all. A workflow that requires MCP tools fails with `unsupported_node_type` against the in-memory host.
- A **third-party host** can implement MCP-compatibility independently; the openwop wire contract is unaffected.

The v1.0 conformance baseline includes `mcp-discoverability.test.ts`, which asserts the shape of any advertised MCP capability: `{supported: boolean, serverUrls: string[]}`. Hosts that don't advertise MCP skip-equivalent. The test accepts both the standard top-level `mcp` slot and vendor-namespaced slots like `<vendor>.mcp` (read from the discovery body root, since there is no `capabilities` envelope).

`mcp-tool-roundtrip.test.ts` extends the discoverability check with an end-to-end tool-call round-trip. Two modes, controlled by env vars:

- **Synthetic peer** (`OPENWOP_MCP_FAKE_SERVER=true`): boots an in-process minimal MCP server (the `mcp-fake-server.ts` library at `conformance/src/lib/`). Asserts deterministic shape — `initialize` + `tools/list` returning an `echo` tool + `tools/call` echoing the input.
- **Real reference impl** (`OPENWOP_MCP_REAL_SERVER_URL=<base-url>`): points the same probe at a real MCP server. Auto-detects the wire shape from the server's `Content-Type` response header:
  - `application/json` — single-JSON response per request (MCP streamable-http transport in single-response mode).
  - `text/event-stream` — SSE stream of JSON-RPC frames; the probe reads frames until it finds one whose `data:` payload matches its request `id`, then returns that frame.

  The stdio transport — the default for [`modelcontextprotocol/servers`](https://github.com/modelcontextprotocol/servers) reference servers — is HTTP-incompatible by design (those servers speak JSON-RPC over stdin/stdout, not HTTP). The openwop tree ships a documented HTTP-to-stdio bridge at `examples/mcp-stdio-bridge/` that wraps any newline-delimited-JSON-RPC stdio server and exposes it as HTTP for the probe. End-to-end verified 2026-05-13 (probe → bridge → bundled `echo-stdio-server.mjs`, 2/2 pass). Operator workflow: boot the bridge with `OPENWOP_MCP_STDIO_CMD=<exe>` + `OPENWOP_MCP_STDIO_ARGS=<json-array>`, then point `OPENWOP_MCP_REAL_SERVER_URL` at the bridge's port (default 4021).

  Assertions in this mode are shape-only: `tools/list` returns ≥ 1 tool, `tools/call` against the first listed tool returns a `result.content` array (valid OR `isError: true`-marked — both spec-conformant).

The real-impl path is the **Phase 3 T3.4 interop-evidence** for `docs/PROTOCOL-GAP-CLOSURE-PLAN.md`. The test logs the tool name + `isError` marker so the interop evidence is visible in the CI output.

---

## OpenWOP host as MCP server

The §"Concrete example" above covers the *client* direction — an OpenWOP workflow calling out to a remote MCP server via `ctx.mcp.*`. This section covers the *server* direction — an OpenWOP host advertising its workflows as MCP tools, resources, and prompts, callable by external MCP-aware LLM clients (Claude Desktop, Cursor, ChatGPT, etc.). It parallels `a2a-integration.md` §"OpenWOP host as A2A agent". Source: [RFC 0020](../../RFCS/0020-host-mcp-server-composition.md).

### 1. Mount

A host MAY expose an MCP-server endpoint over **stdio** (subprocess transport) and/or **streamable-HTTP** (JSON-RPC over HTTP with `Content-Type: application/json` or `text/event-stream` per the connection). When a host advertises `capabilities.mcp.serverMount.supported: true`, it MUST serve the following methods per modelcontextprotocol.io 2025-06-18:

| Method | Required | Notes |
|---|---|---|
| `tools/list`, `tools/call` | Required | Workflows registered via `core.openwop.mcp.expose-tool` appear here. |
| `resources/list`, `resources/templates/list`, `resources/read` | Required | Workflows registered via `core.openwop.mcp.expose-resource` appear here. |
| `resources/subscribe`, `resources/unsubscribe` | Optional | For live-update notifications. |
| `prompts/list`, `prompts/get` | Required | Workflows registered via `core.openwop.mcp.expose-prompt` appear here. |
| `completion/complete` | Optional | For prompt completion hints. |
| `ping`, `logging/setLevel` | Required | Standard MCP lifecycle. |
| `notifications/tools/list_changed`, `notifications/resources/list_changed`, `notifications/resources/updated`, `notifications/prompts/list_changed`, `notifications/message`, `notifications/progress`, `notifications/cancelled` | Required when applicable | Emitted as workflow / run state changes. |

The reference `apps/workflow-engine` sample ships a JSON-RPC over streamable-HTTP server at `routes/mcp.ts`, env-gated on `OPENWOP_MCP_SERVER_ENABLED=true`.

### 2. State projection: workflow → MCP tool

A workflow exposed via `core.openwop.mcp.expose-tool` (or the host's declarative equivalent) is advertised in the host's `tools/list` response. Each `tools/call` invocation starts a new openwop run with:

- `inputs` derived from `params.arguments`, validated against the tool's declared `inputSchema` *before* the run starts.
- `runOptions.trustBoundary: 'untrusted'` (tool arguments arrive from an external LLM; the same trust posture as inbound `host.mcp` tool results).
- The MCP server response shape follows this projection:

| OpenWOP run state | MCP server response |
|---|---|
| `pending` / `running` | Request blocks; subscribed clients receive `notifications/progress` SSE frames. |
| `completed` | `CallToolResult { content: [...], isError: false }` |
| `failed` | `CallToolResult { content: [error message], isError: true }` |
| `awaiting-input` (clarification) | Out-of-band: bridged via `elicitation/create` callback to the inbound MCP client, NOT a `tools/call` response. |
| `awaiting-input` (approval) | Same out-of-band path; the client's `elicitation/create` response maps to the openwop interrupt resume payload (`accept` / `decline` / `cancel`). |
| `canceled` | `CallToolResult { content: [...], isError: true }` with `tool_canceled` error tag. |

### 3. Bidirectional callbacks

The openwop ↔ MCP composition is **bidirectional**: an inbound MCP request can drive a workflow that itself calls *out* through the MCP client surface, or that asks the *original caller* for additional input. Two bridges power this:

- **`sampling/createMessage` → `ctx.callAI`.** When a workflow uses `core.openwop.mcp.handle-sampling`, the host MUST bridge inbound `sampling/createMessage` requests into the workflow's `ctx.callAI`. This preserves user consent and BYOK semantics: the *user's* model runs under the *user's* key, never the server's. Gated on `capabilities.mcp.serverMount.samplingBridge: true`.
- **`elicitation/create` → `ctx.suspend`.** When a workflow uses `core.openwop.mcp.handle-elicitation`, the host MUST bridge inbound `elicitation/create` requests into `ctx.suspend({kind: 'clarification', profile: 'openwop-mcp-elicitation'})`. The MCP client's response maps to the resume payload along the `accept` / `decline` / `cancel` axis required by MCP's flat-schema constraint. Gated on `capabilities.mcp.serverMount.elicitationBridge: true`.

Conformance: `conformance/src/scenarios/mcp-server-sampling-bridge.test.ts` and `mcp-server-elicitation-bridge.test.ts`.

### 4. Trust boundary

All inbound MCP requests cross an `untrusted` trust boundary, regardless of transport. Hosts MUST:

1. Validate every `tools/call.arguments` against the tool's declared `inputSchema` *before* starting the workflow run. Malformed or missing-required-field arguments MUST be rejected as a JSON-RPC error (`-32602 invalid params`) OR as a `CallToolResult { isError: true, content: [...] }` — both shapes are spec-conformant. The reference workflow-engine sample uses `-32602` (envelope-correct for pre-workflow validation).
2. Normalize and sandbox resource URIs returned by `resources/read` (no path traversal, no schemes outside the advertised allowlist).
3. Render prompt arguments to text *without* template-evaluation; arguments MUST NOT be `eval`'d or used to construct shell commands.
4. Propagate `ctx.trustBoundary: 'untrusted'` to every downstream LLM call inside the run. Pack-level UNTRUSTED-marker discipline (per `SECURITY/threat-model-prompt-injection.md` §"UNTRUSTED-marker convention") wraps tool-arg-sourced user content in `<UNTRUSTED>…</UNTRUSTED>` markers when forwarded to `ctx.callAI`.

The existing `prompt-injection-mcp-marker` invariant (`SECURITY/threat-model-prompt-injection.md`) applies symmetrically: outputs from an MCP tool feeding into an LLM downstream remain `untrusted`. The new `mcp-server-untrusted-args` invariant (`SECURITY/invariants.yaml`) verifies argument-schema validation; reference test: `conformance/src/scenarios/mcp-server-untrusted-args.test.ts`.

### 5. Capability advertisement

```json
{
  "mcp": {
    "supported": true,
    "serverMount": {
      "supported": true,
      "transports": ["stdio", "streamable-http"],
      "samplingBridge": true,
      "elicitationBridge": true
    }
  }
}
```

Hosts that don't advertise `serverMount.supported: true` MUST refuse registration of any pack declaring `peerDependencies: { "mcp.serverMount": "supported" }` (e.g., `core.openwop.mcp@1.1.0`'s `server-trigger` + `expose-tool` + `handle-*` nodes) — registration MUST fail with `pack_peer_dependency_missing`.

### 6. Conformance

Six scenarios (all gated on `capabilities.mcp.serverMount.supported`):

- `mcp-server-tool-roundtrip.test.ts` — `tools/list` then `tools/call` against a workflow exposed via `core.openwop.mcp.expose-tool`.
- `mcp-server-resource-roundtrip.test.ts` — `resources/list` then `resources/read`.
- `mcp-server-prompt-roundtrip.test.ts` — `prompts/list` then `prompts/get`.
- `mcp-server-sampling-bridge.test.ts` — inbound `sampling/createMessage` bridges to workflow's `ctx.callAI` (further gated on `samplingBridge: true`).
- `mcp-server-elicitation-bridge.test.ts` — inbound `elicitation/create` bridges to `ctx.suspend` and the accept / decline / cancel path round-trips (further gated on `elicitationBridge: true`).
- `mcp-server-untrusted-args.test.ts` — malformed `arguments` rejected per `inputSchema` before any node executes.

13/13 assertions pass against the reference `apps/workflow-engine` host as of 2026-05-17.

---

## What openwop does NOT specify about MCP

- **Which MCP servers to load.** Host-implementation choice. Some hosts ship a curated set; some allow operator config.
- **MCP transport mechanics.** MCP itself is documented at `https://modelcontextprotocol.io`; openwop doesn't re-specify it.
- **Tool-discovery format.** MCP defines tool schemas; openwop doesn't override.
- **Result-redaction rules.** Hosts apply their redaction harness to MCP results before persisting them in event payloads (per `SECURITY/threat-model-secret-leakage.md`); the harness shape is host-defined.

---

## Future work

- A vendor-neutral way for a host to advertise its supported MCP servers in `/.well-known/openwop`. Currently `capabilities.mcp` is host-implementation-defined; an additive field would let clients query before sending workflows.
- A conformance scenario that drives an MCP round-trip without depending on a specific MCP server, using a synthetic MCP-server fixture.
- A worked node-pack example showing an LLM-using-tools node that integrates MCP.

**Per-tool authorization, rate limiting, and a content-free tool-call audit trail** across transports (`mcp` / `http` / `native`) are specified by RFC 0064 (`host.toolHooks`) — see [host-capabilities.md §host.toolHooks](host-capabilities.md#§hosttoolhooks). It layers `argsHash` / `principal` / `transport` / `status` / `durationMs` onto the existing `agent.toolCalled` / `agent.toolReturned` events and reuses RFC 0049's `forbidden` + `authorization-fail-closed` for the per-tool gate, rather than minting an MCP-specific surface.

---

## See also

- `spec/v1/positioning.md` — why MCP is complementary, not competing.
- `spec/v1/host-extensions.md` — what's in the openwop wire contract vs what's a host extension.
- `SECURITY/threat-model-prompt-injection.md` — invariants on MCP tool responses.
- `SECURITY/threat-model-node-packs.md` — sandbox + trust model that MCP servers fit into.
- Model Context Protocol: https://modelcontextprotocol.io — the canonical MCP source.
