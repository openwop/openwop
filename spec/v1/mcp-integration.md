# OpenWOP Spec v1 — MCP Integration

> **Status: Stable · v1.2 (2026-08-16 — RFC 0153 MCP 2026-07-28 versioned composition landed as §"MCP 2026-07-28 versioned composition"; the pre-existing body is the `mcp-2025-06-18-legacy` profile).** Worked example of how OpenWOP and the Model Context Protocol (MCP) compose. Non-normative composition pattern; the §"Trust boundary" rules restate normative invariants from `SECURITY/threat-model-prompt-injection.md` (3 RFC 2119 keywords, all citing pre-existing invariants). Graduated DRAFT → FINAL via RFC 0006. See `auth.md` for the status legend.

---

## TL;DR

**OpenWOP runs the workflow. MCP exposes tools to the LLM nodes inside that workflow.** The two protocols compose; they don't compete.

An OpenWOP node that calls an LLM gets its tools from registered MCP servers. The LLM, when it wants to use a tool, emits a tool-call envelope; the OpenWOP host dispatches that to the MCP server; the MCP server returns a result; the host feeds the result back into the next LLM turn.

```text
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

| Layer                      | Owner   | Concerns                                                              |
| -------------------------- | ------- | --------------------------------------------------------------------- |
| Workflow execution + state | openwop | Run lifecycle, events, interrupts, replay, observability, conformance |
| Tool/resource access       | MCP     | Tool catalog, schema, invocation, result shape                        |

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

The §"Concrete example" above covers the _client_ direction — an OpenWOP workflow calling out to a remote MCP server via `ctx.mcp.*`. This section covers the _server_ direction — an OpenWOP host advertising its workflows as MCP tools, resources, and prompts, callable by external MCP-aware LLM clients (Claude Desktop, Cursor, ChatGPT, etc.). It parallels `a2a-integration.md` §"OpenWOP host as A2A agent". Source: [RFC 0020](../../RFCS/0020-host-mcp-server-composition.md).

### 1. Mount

A host MAY expose an MCP-server endpoint over **stdio** (subprocess transport) and/or **streamable-HTTP** (JSON-RPC over HTTP with `Content-Type: application/json` or `text/event-stream` per the connection). When a host advertises `capabilities.mcp.serverMount.supported: true`, it MUST serve the following methods per modelcontextprotocol.io 2025-06-18:

| Method                                                                                                                                                                                                                            | Required                 | Notes                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `tools/list`, `tools/call`                                                                                                                                                                                                        | Required                 | Workflows registered via `core.openwop.mcp.expose-tool` appear here.     |
| `resources/list`, `resources/templates/list`, `resources/read`                                                                                                                                                                    | Required                 | Workflows registered via `core.openwop.mcp.expose-resource` appear here. |
| `resources/subscribe`, `resources/unsubscribe`                                                                                                                                                                                    | Optional                 | For live-update notifications.                                           |
| `prompts/list`, `prompts/get`                                                                                                                                                                                                     | Required                 | Workflows registered via `core.openwop.mcp.expose-prompt` appear here.   |
| `completion/complete`                                                                                                                                                                                                             | Optional                 | For prompt completion hints.                                             |
| `ping`, `logging/setLevel`                                                                                                                                                                                                        | Required                 | Standard MCP lifecycle.                                                  |
| `notifications/tools/list_changed`, `notifications/resources/list_changed`, `notifications/resources/updated`, `notifications/prompts/list_changed`, `notifications/message`, `notifications/progress`, `notifications/cancelled` | Required when applicable | Emitted as workflow / run state changes.                                 |

The reference app (`openwop/openwop-app` repo: `routes/mcp.ts`) ships a JSON-RPC over streamable-HTTP server, env-gated on `OPENWOP_MCP_SERVER_ENABLED=true`.

### 2. State projection: workflow → MCP tool

A workflow exposed via `core.openwop.mcp.expose-tool` (or the host's declarative equivalent) is advertised in the host's `tools/list` response. Each `tools/call` invocation starts a new openwop run with:

- `inputs` derived from `params.arguments`, validated against the tool's declared `inputSchema` _before_ the run starts.
- `runOptions.trustBoundary: 'untrusted'` (tool arguments arrive from an external LLM; the same trust posture as inbound `host.mcp` tool results).
- The MCP server response shape follows this projection:

| OpenWOP run state                | MCP server response                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending` / `running`            | Request blocks; subscribed clients receive `notifications/progress` SSE frames.                                                                   |
| `completed`                      | `CallToolResult { content: [...], isError: false }`                                                                                               |
| `failed`                         | `CallToolResult { content: [error message], isError: true }`                                                                                      |
| `awaiting-input` (clarification) | Out-of-band: bridged via `elicitation/create` callback to the inbound MCP client, NOT a `tools/call` response.                                    |
| `awaiting-input` (approval)      | Same out-of-band path; the client's `elicitation/create` response maps to the openwop interrupt resume payload (`accept` / `decline` / `cancel`). |
| `canceled`                       | `CallToolResult { content: [...], isError: true }` with `tool_canceled` error tag.                                                                |

### 3. Bidirectional callbacks

The openwop ↔ MCP composition is **bidirectional**: an inbound MCP request can drive a workflow that itself calls _out_ through the MCP client surface, or that asks the _original caller_ for additional input. Two bridges power this:

- **`sampling/createMessage` → `ctx.callAI`.** When a workflow uses `core.openwop.mcp.handle-sampling`, the host MUST bridge inbound `sampling/createMessage` requests into the workflow's `ctx.callAI`. This preserves user consent and BYOK semantics: the _user's_ model runs under the _user's_ key, never the server's. Gated on `capabilities.mcp.serverMount.samplingBridge: true`.
- **`elicitation/create` → `ctx.suspend`.** When a workflow uses `core.openwop.mcp.handle-elicitation`, the host MUST bridge inbound `elicitation/create` requests into `ctx.suspend({kind: 'clarification', profile: 'openwop-mcp-elicitation'})`. The MCP client's response maps to the resume payload along the `accept` / `decline` / `cancel` axis required by MCP's flat-schema constraint. Gated on `capabilities.mcp.serverMount.elicitationBridge: true`.

Conformance: `conformance/src/scenarios/mcp-server-sampling-bridge.test.ts` and `mcp-server-elicitation-bridge.test.ts`.

### 4. Trust boundary

All inbound MCP requests cross an `untrusted` trust boundary, regardless of transport. Hosts MUST:

1. Validate every `tools/call.arguments` against the tool's declared `inputSchema` _before_ starting the workflow run. Malformed or missing-required-field arguments MUST be rejected as a JSON-RPC error (`-32602 invalid params`) OR as a `CallToolResult { isError: true, content: [...] }` — both shapes are spec-conformant. The reference workflow-engine sample uses `-32602` (envelope-correct for pre-workflow validation).
2. Normalize and sandbox resource URIs returned by `resources/read` (no path traversal, no schemes outside the advertised allowlist).
3. Render prompt arguments to text _without_ template-evaluation; arguments MUST NOT be `eval`'d or used to construct shell commands.
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

13/13 assertions pass against the reference app host (`openwop/openwop-app` repo) as of 2026-05-17.

---

## What OpenWOP does NOT specify about MCP

- **Which MCP servers to load.** Host-implementation choice. Some hosts ship a curated set; some allow operator config.
- **MCP transport mechanics.** MCP itself is documented at `https://modelcontextprotocol.io`; openwop doesn't re-specify it. (RFC 0153 §B narrows this at the boundary: header/body agreement, `server/discover`, and version failure are restated in §"MCP 2026-07-28 versioned composition" because they are what a peer can hold an OpenWOP host to.)
- **Tool-discovery format.** MCP defines tool schemas; openwop doesn't override.
- **Result-redaction rules.** Hosts apply their redaction harness to MCP results before persisting them in event payloads (per `SECURITY/threat-model-secret-leakage.md`); the harness shape is host-defined.

---

## MCP 2026-07-28 versioned composition (RFC 0153)

> **Status: normative for any host that advertises `capabilities.mcp.protocolVersions` (2026-08-16, [RFC 0153](../../RFCS/0153-mcp-2026-07-28-versioned-composition.md) `Accepted`).** Everything above this heading was written against **MCP 2025-06-18** — the `initialize` / `notifications/initialized` handshake, `Mcp-Session-Id`, `resources/subscribe`, `ping`, `logging/setLevel`, and the two live callback bridges (`sampling/createMessage` → `ctx.callAI`, `elicitation/create` → `ctx.suspend`) — and is, from this date, the definition of the **`mcp-2025-06-18-legacy`** profile. This section defines the **`mcp-2026-07-28`** profile. Pinned to the upstream revision **2026-07-28**: `schema/2026-07-28/schema.ts` and `docs/specification/2026-07-28/**` in `modelcontextprotocol/modelcontextprotocol`, and its [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog). Upstream field and method names are used verbatim; "→" marks an OpenWOP mapping. MCP's intermediate revision `2025-11-25` is **not** an OpenWOP composition profile: a host that speaks it lists the date in `protocolVersions` without a profile (§A).

### §A — Discovery and profiles

```json
"mcp": {
  "supported": true,
  "protocolVersions": ["2026-07-28", "2025-06-18"],
  "preferredVersion": "2026-07-28",
  "profiles": ["mcp-2026-07-28", "mcp-2025-06-18-legacy"],
  "features": ["server-discover", "mrtr", "cacheable-lists", "extensions"],
  "serverMount": { "supported": true, "transports": ["streamable-http"] }
}
```

- `protocolVersions[]` uses MCP's **date form exactly** (`^[0-9]{4}-[0-9]{2}-[0-9]{2}$`); `latest` or `2026-7-28` is unmatchable against a pinned peer. `preferredVersion` **MUST** be listed. Unqualified `supported: true` is deprecated and **cannot substantiate a current-MCP claim**.
- `profiles[]`: **`mcp-2026-07-28`** ⇒ this section in full; **`mcp-2025-06-18-legacy`** ⇒ the pre-existing body of this document. **A profile implies its version, not the reverse** — `mcp-<date>` (or `-legacy`) in `profiles` requires `<date>` in `protocolVersions`; a version MAY be listed without its profile ("I speak it" without "I meet this document's floor for it").
- `features[]` is a **closed** set for the current revision, each a statement the host can be held to: `server-discover` — the host implements `server/discover` (upstream: servers MUST); `mrtr` — the host handles `InputRequiredResult` as a client and emits it as a server where it needs input (§C); `cacheable-lists` — list/read results carry `ttlMs` + `cacheScope` (§D); `extensions` — the host advertises and honours `capabilities.extensions` (§D). **A host claiming `mcp-2026-07-28` MUST list `server-discover`, `mrtr`, and `cacheable-lists`** — they are MUSTs of the upstream revision, so a current-profile host without them is not implementing the revision; `extensions` is optional.
- **Legacy window (RFC 0153 UQ1, resolved for the date).** RFC 0153 §Compatibility fixes the window at 12 months after *current-profile acceptance*; the profile was accepted 2026-08-12, so a host **SHOULD NOT** advertise `mcp-2025-06-18-legacy` after **2027-08-12**, and after that date bare `supported: true` cannot appear in any interop claim. (Upstream's own feature-lifecycle policy also sets a minimum twelve-month deprecation window; the two clocks differ by two weeks and this document uses the RFC's.) The legacy *adopter inventory* (gap G1) is not resolved by a date and stays open. Removal of the legacy code path is v2 or a separately justified upstream-security safety fix.

### §B — Stateless routing and discovery

- **No handshake, no session.** Under the current profile a host **MUST NOT** require `initialize` / `notifications/initialized` or any `Mcp-Session-Id` for a core request, and **MUST NOT** vary `tools/list` / `prompts/list` / `resources/list` per connection. Cross-call state, when a tool needs it, is an explicit server-minted handle passed as an ordinary tool argument — never a session.
- **Every request is self-describing.** `params._meta` **MUST** carry `io.modelcontextprotocol/protocolVersion` (the revision) and `io.modelcontextprotocol/clientCapabilities`; **SHOULD** carry `io.modelcontextprotocol/clientInfo`; results **SHOULD** carry `io.modelcontextprotocol/serverInfo`. A server needing a client capability the request did not declare **MUST** answer `MissingRequiredClientCapabilityError` (`-32021`, HTTP `400`, `data.requiredCapabilities[]`) rather than proceed.
- **Streamable HTTP headers.** Every POST **MUST** carry `MCP-Protocol-Version` (date form), `Mcp-Method` (= `method`), and — on `tools/call` / `resources/read` / `prompts/get` — `Mcp-Name` (= `params.name` or `params.uri`, Base64-sentinel-encoded when not plain ASCII). **Header values MUST agree with the body:** a `MCP-Protocol-Version` that differs from `_meta`'s revision **MUST** be rejected `400` + `HeaderMismatchError` (`-32020`), and a host **MUST** apply the same fail-closed rule to `Mcp-Method` / `Mcp-Name` disagreement (invariant `mcp-header-body-consistent`, named by RFC 0153 §E — *not yet registered*, see §"Conformance"). A tool parameter annotated `x-mcp-header` **MUST** be mirrored into the named header by a conforming client.
- **`server/discover`.** A current-profile host acting as MCP server **MUST** implement it: result `{ resultType: "complete", supportedVersions[], capabilities, instructions?, ttlMs, cacheScope, _meta.serverInfo }`. `supportedVersions[]` **MUST** equal `capabilities.mcp.protocolVersions` for the interface being described — the OpenWOP discovery document and the MCP discovery answer are two views of one fact and **MUST NOT** disagree. As a client, a host **MAY** call it up front or handle `UnsupportedProtocolVersionError` inline; on stdio the upstream backward-compatibility probe applies.
- **Version selection.** There is no negotiation handshake: each request declares its revision and is accepted or rejected independently. A server that does not implement the requested revision **MUST** answer `UnsupportedProtocolVersionError` (`-32022`, HTTP `400`, `data.supported[]`, `data.requested`). A request without `MCP-Protocol-Version` is, per upstream, at most `2025-03-26`; a host whose `protocolVersions` does not include a pre-header revision **MUST** reject it. Unknown method ⇒ `404` + `-32601`.
- **No silent downgrade (invariant `mcp-version-no-silent-downgrade`, registered).** When the host is the *client* and the server answers `UnsupportedProtocolVersionError`, the host **MUST NOT** proceed under a lower revision while reporting the requested one. It **MUST** either fail closed or select a revision from `data.supported[]` that it also lists in `protocolVersions` and proceed *explicitly*: the `MCP-Protocol-Version` header and `_meta` on every subsequent call to that server **MUST** carry the selected revision, and any OpenWOP-side record (`negotiatedVersion` on the §23 seam; a node output; an audit row) **MUST** report that value. For an authenticated request the default is fail-closed; a policy-forbidden downgrade **MUST** fail closed and **MUST** be audited content-free — the corpus has no dedicated negotiation event; a host advertising `capabilities.authorization` **SHOULD** record `authorization.decided { action: "mcp:negotiate", resource: <server origin>, allowed: false, reason: "version-downgrade-forbidden" }` (gap, as for A2A).
- **Boundary projection.** A revision failure that crosses an OpenWOP boundary **MUST** be projected as **`interop_version_unsupported`** (`rest-endpoints.md` §Error codes), `retriable: false`, `details.protocol: "mcp"`, `details.requested`, `details.supported[]`; the upstream body is not relayed.
- **Streams are per-request.** The current revision removed SSE resumability (`Last-Event-ID`) and the standalone GET stream; a broken response stream loses the in-flight request and the client **MUST** re-issue it with a new JSON-RPC id (§C says how that composes with effect identity). Server-to-client change notifications flow only on an opted-in `subscriptions/listen` stream; request-scoped `notifications/progress` / `notifications/message` flow on the request's own response stream, and `notifications/message` only when the request carried `io.modelcontextprotocol/logLevel`.

### §C — MRTR and callback replacement

Upstream 2026-07-28 replaced server-initiated requests (`roots/list`, `sampling/createMessage`, `elicitation/create`) with **Multi Round-Trip Requests**: a server needing input answers the *client's* request with `InputRequiredResult { resultType: "input_required", inputRequests?: { <key>: <request> }, requestState?: <opaque> }`; the client gathers the inputs and **retries the original request** (new JSON-RPC id) with `inputResponses: { <key>: <result> }` and the echoed `requestState`. Only `prompts/get`, `resources/read`, and `tools/call` may return it. Every result now carries `resultType` (`"complete"` | `"input_required"`); a result from a legacy server that omits it **MUST** be read as `"complete"`.

**A current-profile host MUST NOT project the legacy live-callback bridges** (§3 "Bidirectional callbacks" above) as current-profile behaviour and **MUST NOT** silently fall back to them; they exist only under `mcp-2025-06-18-legacy`. Note upstream deprecated Sampling and Roots in this revision (12-month window): a host **SHOULD NOT** add new dependence on either, and **MUST NOT** emit `sampling/createMessage` or `roots/list` in `inputRequests` unless the client declared the capability.

**C.1 OpenWOP as MCP client** — a workflow node calling a tool/prompt/resource that answers `input_required`:

| Element | Rule |
| --- | --- |
| Durable request identity | The initial request and every MRTR retry are **one OpenWOP logical invocation** (RFC 0150 §B `logicalInvocationId`, retry-stable) even though each is a distinct JSON-RPC id. The host **MUST** persist, in the run record for that invocation: the original params digest, `requestState` (byte-exact, opaque — the client **MUST NOT** parse, modify, or infer from it), and the pending `inputRequests` keys. |
| `elicitation/create` in `inputRequests` | → the node suspends with a `clarification` interrupt (`interrupt.md`; `metadata.mcp.inputRequestKey: <key>`, `mode` and `requestedSchema` projected into the interrupt payload). The interrupt's resolution (`accept` / `decline` / `cancel`) becomes `inputResponses[<key>]` = `ElicitResult { action, content? }` on the retry. |
| `sampling/createMessage` in `inputRequests` | → `ctx.callAI` under the run's own provider policy, budget (RFC 0084), and egress rules — **only if** the host declared `sampling` in `clientCapabilities` for that request; the answer becomes `inputResponses[<key>]` = `CreateMessageResult` on the retry. Never a live callback response. A host that does not declare `sampling` will not receive the request (upstream MUST NOT). |
| `roots/list` in `inputRequests` | → the roots the run's policy exposes to that server, or none; declared only if honoured. |
| Retry | Issued **only** after every requested input is resolved (or immediately if `inputRequests` is absent), with a **new** JSON-RPC id, `inputResponses` for every key, and `requestState` echoed exactly (absent if it was absent). Effect identity unchanged (RFC 0150 §B); a Layer-2 idempotency record for the invocation covers initial + retries. |
| Timeout | Owned by the OpenWOP node (node timeout / RFC 0058 run bounds), not by MCP: an unresolved interrupt past the bound fails the invocation; the server has no obligation to remember the pending request (upstream: servers MUST NOT assume a retry). |
| Cancellation | RFC 0094 cancel of the run ⇒ no retry is issued and the pending interrupt is cancelled; nothing is sent to the server. |
| Replay | The retry and its `inputResponses` are **recorded outcomes** — replay **MUST NOT** re-issue the MRTR retry or re-prompt the user (`replay.md`, RFC 0150 replay discharge / `sideEffectSuppression`); a live-effect branch MAY, under explicit authorization. |
| Interim result caching | An `input_required` result and any request carrying `inputResponses` / `requestState` **MUST NOT** be cached (§D). |
| Completion | `resultType: "complete"` → the node output (`CallToolResult` etc.). Missing requested inputs on retry ⇒ the server SHOULD re-issue `input_required`, not error; the host **MUST** bound the number of rounds (host policy) so a server cannot spin a run indefinitely. |

**C.2 OpenWOP as MCP server** — a run started by `tools/call` (or `prompts/get`, `resources/read`) that reaches `waiting-approval` / `waiting-input`:

| Element | Rule |
| --- | --- |
| Interrupt → `InputRequiredResult` | The in-flight request is answered with `{ resultType: "input_required", inputRequests: { <key>: { method: "elicitation/create", params: { mode: "form", message, requestedSchema ← the interrupt payload's schema } } }, requestState }`. This **replaces** the legacy out-of-band `elicitation/create` callback for the current profile. |
| `requestState` | **Opaque, integrity-protected, bound.** Upstream classes it as attacker-controlled on receipt; the host **MUST** HMAC/sign it and **MUST** bind the authenticated principal, a TTL, and the originating request digest inside it (upstream SHOULD → OpenWOP MUST), and additionally **MUST** bind the `runId` and the RFC 0051 interrupt token. Single use is enforced by consuming the interrupt token — a second retry with the same `requestState` **MUST** fail. |
| Retry with `inputResponses[<key>]` | → resolves the interrupt: `ElicitResult.action` `accept` → the approval/clarification resume payload from `content`; `decline` → the interrupt's decline path; `cancel` → cancel the interrupt. **The resolving principal MUST be authorized as an RFC 0051 approver** — an `inputResponses` entry is the authenticated caller's action bound by the token, not "MCP content advancing a gate" (§E). |
| Sampling bridge | `core.openwop.mcp.handle-sampling` under the current profile **MUST** place `sampling/createMessage` in `inputRequests` **only if** the request's `clientCapabilities` declared `sampling`; otherwise the node **MUST** use the host's own provider path or fail — never emit the request. |
| Retry identity | The retry is a new `tools/call` on the same run (correlated by `requestState`), not a new run: `messageId`-style idempotency is provided by the interrupt token; a retry after the run has advanced past the interrupt ⇒ `input_required` again for the next pending interrupt, or `complete`. |
| Progress | While the run is `running`, request-scoped `notifications/progress` MAY flow on the request's response stream (as before). |

### §D — Cacheable lists and extensions

- **List and read results carry cache hints.** `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read`, and `server/discover` results **MUST** carry `ttlMs` (integer ≥ 0) and `cacheScope` (`"public"` | `"private"`) — the `CacheableResult` interface. Ordering **MUST** be deterministic (upstream SHOULD → OpenWOP MUST: sort by `name` / `uri`), and pagination cursors preserved. **Interim MRTR results and any request carrying `inputResponses` / `requestState` MUST NOT be cached.**
- **`cacheScope` is decided by the tenant boundary.** An OpenWOP host acting as server derives lists from a tenant-scoped registry (RFC 0074), so `cacheScope` **MUST** be `"private"` whenever the result depends on the caller's tenant, workspace, principal, or authorization — which for `tools/list` on a multi-tenant host is always. `"public"` is permitted only when the result is byte-identical for every caller.
- **Cache keys on the client side (invariant `mcp-cache-tenant-scoped`, named — not yet registered).** An OpenWOP host caching MCP results **MUST** key them by `(tenant, workspace, principal, server origin, protocol revision, authorization-relevant discovery context)`; a `"private"` result **MUST NOT** be served across authorization contexts; a `listChanged` notification (via `subscriptions/listen`) invalidates. **RFC 0153 UQ5 / gap G4:** when the caller's authorization scope changes (scope grant/revoke, workspace switch), cached `"private"` results for that principal **MUST** be treated as stale regardless of `ttlMs` — the TTL is a freshness hint about the server's data, not about the caller's rights.
- **Extensions are opaque (invariant `mcp-extension-no-authority`, named — not yet registered).** `capabilities.extensions` (client and server) is a map of extension id → settings; ids follow `_meta` key naming with a mandatory prefix. An extension, and any `_meta` key, **MUST NOT** gain tool authority, secret reach, or approval power merely by appearing; OpenWOP treats every extension as opaque unless a **named mapping** exists in this document. The named mappings today: OpenTelemetry `traceparent` / `tracestate` / `baggage` in `_meta` (propagated per `observability.md`; never used for authorization), and `io.modelcontextprotocol/logLevel` (honoured per request; `notifications/message` only when present). The official `io.modelcontextprotocol/tasks` extension (polling `tasks/get`, `tasks/update`) is **not** mapped — an OpenWOP run is the durable unit and RFC 0100/A2A is the durable-task interop surface; a host MAY implement the extension as a host extension without wire status here (RFC 0153 UQ4: no first-class mapping yet).

### §E — Authorization and tenant binding

- **MCP authentication identifies a peer; it does not authorize.** Every `tools/*`, `resources/*`, `prompts/*` request **MUST** pass OpenWOP authorization (RFC 0049), tenant and workspace binding (RFC 0048), audience, and policy at the OpenWOP boundary before any workflow runs, resource is read, or prompt is rendered. Upstream's authorization discovery (OAuth 2.0 Protected Resource Metadata, Client ID Metadata Documents, `iss` validation) is how the peer authenticates; the outcome is a principal, nothing more.
- **Anonymous MCP principal MUST NOT be the production default for an advertised current profile.** A host that advertises `mcp-2026-07-28` **MUST** require authentication on its MCP endpoint in production, unless it advertises RFC 0132 `anonymousActor` and routes anonymous MCP callers through that surface's rules (default-deny grants, no secret reach, egress-guarded, opaque audit). The legacy env-gated unauthenticated mount is legacy-profile behaviour.
- **Tool arguments and returned content remain `untrusted`** (§"Trust boundary" invariants `prompt-injection-mcp-marker`, `-no-approval`, `-tool-allowlist`). **MCP content MUST NOT advance approval gates.** Under MRTR this is sharpened, not relaxed: an `inputResponses` entry that resolves an approval interrupt is honoured **only** as the authenticated caller's action bound by the interrupt token and authorized as an RFC 0051 approver — content inside it never becomes authority.
- **Peer authority (invariant `mcp-peer-no-authority-escalation`, named — not yet registered).** A remote MCP server's tool result, `_meta`, extension settings, or `requestState` **MUST NOT** widen the calling run's tool allowlist, scopes, or approval state.
- **Invariants.** `mcp-version-no-silent-downgrade` is registered (protocol tier, witnessed by `mcp-version-negotiation.test.ts`). `mcp-header-body-consistent`, `mcp-cache-tenant-scoped`, `mcp-extension-no-authority`, and `mcp-peer-no-authority-escalation` are **named by RFC 0153 §E and not yet registered** — their MUSTs are stated in §B/§D/§E; registering each needs a witness (a header/body mismatch driven at the host, a multi-tenant cache probe, an extension attempting authority, a peer attempting escalation — `docs/RFC-0147-SELF-AUDIT.md`).

### Conformance (RFC 0153)

- **Shape (always-on):** `versioned-composition-profiles.test.ts` — the §A fields on `capabilities.mcp`, date form, closed `features`.
- **Behaviour (gated on `mcp.supported && mcp.protocolVersions.length > 0`, hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`):** `mcp-version-negotiation.test.ts` — advertised revisions in date form incl. preferred; outbound `MCP-Protocol-Version` in date form; negotiated revision advertised; unsupported revision fails through the canonical envelope. Driven through the invoke seam catalogued in [`host-sample-test-seams.md`](./host-sample-test-seams.md) §23 against `McpFakeServer` with header capture. **Witnessed live** on openwop-app's production origin for §A/§B; the server-facing legs there are declared `REQUIRES_HOST_CALLBACK` (a hosted origin cannot reach a fake server on the tester's machine).
- **The suite's fake server speaks the legacy handshake.** `conformance/src/lib/mcp-fake-server.ts` implements `initialize` and the 2025-06-18 method set; it captures headers, which is enough for §B's negotiation legs and **not** enough to witness §B's stateless `_meta` rules, `server/discover`, §C MRTR, or §D cache hints. A 2026-07-28-shaped fake server is a suite gap (G6), and a pinned real current peer in CI is externally gated.
- **Legacy-profile scenarios** (`mcp-server-*-roundtrip`, `mcp-server-sampling-bridge`, `mcp-server-elicitation-bridge`, `mcp-server-untrusted-args`) remain gated on `mcp.serverMount.supported` and describe `mcp-2025-06-18-legacy`; a current-profile host passes them only in legacy mode.
- **Named by RFC 0153 §Conformance and absent:** `mcp-2026-07-28-discover`, `mcp-stateless-request`, `mcp-mrtr-roundtrip`, `mcp-cache-tenant-scope`, `mcp-extension-opacity`, `mcp-current-auth-boundary` (per `scripts/rfc-conformance-coverage.mjs`; `mcp-version-header` / `mcp-version-downgrade` are covered under `mcp-version-negotiation`).

### Open spec gaps (RFC 0153)

| # | Gap | Disposition |
| - | --- | ----------- |
| G1 | Legacy adopter inventory | **Open** — the window date is fixed above (2027-08-12); who is on 2025-06-18 is unknown. |
| G2 | Complete MRTR mapping | **Closed** by §C (C.1 client, C.2 server): identity, `requestState`, retry, timeout, cancellation, replay, interrupt composition. |
| G3 | Real current MCP peer for CI | **Externally gated**; the fake server is legacy-shaped. |
| G4 | Authorization-aware cache validators | **Closed** by §D: scope change ⇒ stale regardless of `ttlMs`; `"private"` never crosses authorization contexts; key includes tenant/workspace/principal/origin/revision/discovery context. |
| G5 | Initial mapped extension set | **Decided: none first-class.** OTel `_meta` keys and `logLevel` are the only named mappings; `io.modelcontextprotocol/tasks` is deliberately unmapped (RFC 0100 owns durable interop). |
| G6 | 2026-07-28-shaped fake server + the six named scenarios | **Suite gap** — see §"Conformance (RFC 0153)". |
| G7 | Dedicated content-free negotiation audit event | **Open** — `authorization.decided` recommended as carrier; shared with RFC 0152 G7. |
| G8 | Interop threat-model document | **Open** — shared with RFC 0152 G8. |
| G9 | Bound on MRTR rounds per invocation | **Open** — §C.1 requires a bound and leaves the number to host policy; a normative ceiling may follow evidence. |

---

## Future work

- A vendor-neutral way for a host to advertise its supported MCP servers in `/.well-known/openwop`. Currently `capabilities.mcp` is host-implementation-defined; an additive field would let clients query before sending workflows.
- A conformance scenario that drives an MCP round-trip without depending on a specific MCP server, using a synthetic MCP-server fixture.
- A worked node-pack example showing an LLM-using-tools node that integrates MCP.

**Per-tool authorization, rate limiting, and a content-free tool-call audit trail** across transports (`mcp` / `http` / `native`) are specified by RFC 0064 (`host.toolHooks`) — see [host-capabilities.md §host.toolHooks](host-capabilities.md#hosttoolhooks). It layers `argsHash` / `principal` / `transport` / `status` / `durationMs` onto the existing `agent.toolCalled` / `agent.toolReturned` events and reuses RFC 0049's `forbidden` + `authorization-fail-closed` for the per-tool gate, rather than minting an MCP-specific surface.

---

## See also

- `spec/v1/positioning.md` — why MCP is complementary, not competing.
- `spec/v1/host-extensions.md` — what's in the openwop wire contract vs what's a host extension.
- `SECURITY/threat-model-prompt-injection.md` — invariants on MCP tool responses.
- `SECURITY/threat-model-node-packs.md` — sandbox + trust model that MCP servers fit into.
- Model Context Protocol: <https://modelcontextprotocol.io> — the canonical MCP source.
- MCP **2026-07-28** pin for the `mcp-2026-07-28` profile: <https://modelcontextprotocol.io/specification/2026-07-28> and `schema/2026-07-28/schema.ts` in `modelcontextprotocol/modelcontextprotocol`; changelog <https://modelcontextprotocol.io/specification/2026-07-28/changelog>.
