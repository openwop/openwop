# OpenWOP ↔ MCP: Correspondence Notes

> Informative. This page describes how OpenWOP surfaces that exist **today** line up with nearby Model Context Protocol (MCP) surfaces. It defines no mapping, no bridge behaviour and no conformance obligation, and nothing here is evidence that any host works with any MCP peer. The normative MCP composition is [`spec/v1/mcp-integration.md`](../../spec/v1/mcp-integration.md) (RFC 0020, RFC 0153).

Every table below says "corresponds to" or "nearest field", never "maps to". Where a later RFC is expected to change an OpenWOP surface, the section says so, and the table describes the current wire only.

**Upstream sources checked on 2026-09-22:**

- MCP revision **2026-07-28**: `schema/2026-07-28/schema.ts` in `modelcontextprotocol/modelcontextprotocol` (commit `271ecc9accaf`), plus `docs/specification/2026-07-28/server/tools.mdx`, `client/elicitation.mdx` and `server/prompts.mdx`.
- MCP Apps, **SEP-1865** (status "Stable (2026-01-26)", extension id `io.modelcontextprotocol/ui`): `specification/2026-01-26/apps.mdx` in `modelcontextprotocol/ext-apps` (commit `298e884ec3f0`).
- The IANA media-types registry (`application`, `text`, `image`, `model`).

If upstream changes, the upstream text wins and this page is stale.

---

## 1. `ToolDescriptor` safety fields and MCP `ToolAnnotations`

[`ToolDescriptor`](../../schemas/tool-descriptor.schema.json) ([`tool-catalog.md`](../../spec/v1/tool-catalog.md) §C) and MCP [`ToolAnnotations`](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) both describe what a tool does to the world. They do so on different axes, with different defaults and different trust.

**Three facts to read first:**

1. **The MCP defaults are not "safe".** In `schema.ts`, `readOnlyHint` defaults to `false`, `destructiveHint` to **`true`**, `idempotentHint` to `false`, and `openWorldHint` to **`true`**. A tool with no annotations is therefore described as possibly destructive and open-world. An absent annotation does not mean `safetyTier: "pure"` or `"read"`.
2. **MCP annotations are hints, and MCP says they are untrusted.** The upstream tools page requires clients to consider tool annotations untrusted unless they come from trusted servers. `schema.ts` adds that clients should never base tool-use decisions on annotations received from untrusted servers.
3. **OpenWOP forbids inferring `safetyTier` from anything else.** `tool-catalog.md` §C (the paragraph "`safetyTier` is a host-assigned effect classification, not a derived projection") requires the host to assign `safetyTier` explicitly for each tool. It says that mechanically mapping another tier onto it mis-advertises the catalog. This page therefore gives no inference rule in either direction. A host that projects an MCP server tool (`source: "mcp"`) into its catalog still assigns `safetyTier` itself.

| OpenWOP `ToolDescriptor` field | Nearest MCP field | Why the two are not equivalent |
| --- | --- | --- |
| `title` | `annotations.title` (and `Tool.title`) | MCP gives `annotations.title` display precedence over `name`, and marks it as a hint that may be inaccurate. The OpenWOP `title` is a plain display string with no precedence rule. |
| `safetyTier: "pure"` | `readOnlyHint: true` + `openWorldHint: false` | `pure` is defined as having no external side effects, as distinct from `read` ("reads external state"). MCP's closest pair describes "does not modify its environment" plus a closed domain. MCP has no hint that separates reading external state from not touching it. |
| `safetyTier: "read"` | `readOnlyHint: true` | Neither side modifies anything, but `read` is a required, host-assigned classification. `readOnlyHint` is an optional hint that defaults to `false`. |
| `safetyTier: "write"` | `readOnlyHint: false`, with `destructiveHint` unspecified | `write` does not say whether the mutation is additive or destructive. MCP splits these, and because its default is `destructiveHint: true`, a `write` tool carries no additive-only claim. |
| `safetyTier: "exec"` | no counterpart | `exec` is only valid with `source: "host-extension"` (RFC 0069), and it is never protocol-tier. MCP has no arbitrary-command class. The all-defaults annotation set (not read-only, destructive, open-world) describes any unannotated tool, not specifically exec-class tools. |
| `replayPolicy: "idempotent"` | `idempotentHint: true` | `idempotent` means the call is safe under the host's Layer-2 idempotency key ([`idempotency.md`](../../spec/v1/idempotency.md)), so repeat safety comes from the host's key. `idempotentHint` says repeated calls with the same arguments have no further effect, and it is meaningful only when `readOnlyHint` is `false`. |
| `replayPolicy: "deterministic"` / `"non-deterministic"` | no counterpart | Both values describe replay behaviour ([`replay.md`](../../spec/v1/replay.md)), not effect on the environment. MCP annotations do not describe replay. |
| `egress: "none"` | `openWorldHint: false` (partial) | `egress` describes the network route (`none` / `safe-fetch` / `host-mediated` / `host-owned`). `openWorldHint` describes whether the tool deals with an open set of external entities. A tool with `egress: "safe-fetch"` can still work in a closed domain, and the MCP default is `openWorldHint: true`. |
| `approval` | no counterpart | `approval` is on the authorization axis (RFC 0051), and `tool-catalog.md` §C keeps it separate from `safetyTier`. `ToolAnnotations` has no approval field. |
| `source`, `auth`, `costHint`, `latencyHint` | no counterpart in `ToolAnnotations` | These describe origin, credential needs and planning hints. MCP carries none of them in annotations. |

---

## 2. Card and form field vocabulary and MCP elicitation `requestedSchema`

Chat-card `inputs[]` ([`chat-card-packs.md`](../../spec/v1/chat-card-packs.md) §"Input fields") and form-content `fields[]` ([`form-content-packs.md`](../../spec/v1/form-content-packs.md) §"Field types") share one closed field vocabulary. MCP form-mode elicitation (`ElicitRequestFormParams.requestedSchema`) accepts a restricted JSON Schema. It is a flat object whose `properties` are each a `PrimitiveSchemaDefinition`: string, number/integer, boolean, or an enum (single-select, or multi-select as a `type: "array"` of string enums). The upstream elicitation page says nested structures and arrays of objects beyond enums are intentionally unsupported.

**No OpenWOP surface today converts a card or form template into `requestedSchema`.** The current-profile server path in `mcp-integration.md` §C.2 projects an *interrupt payload's* schema into `requestedSchema`, not a pack field list. The table is a vocabulary comparison only. How a bridge would treat fields that fall outside the flat subset (refuse, flatten, or use URL mode) is undecided and is expected to be settled by a separate RFC.

`format` exists on form-content fields only; chat-card `inputs[]` have no `format` attribute.

| OpenWOP `type` (+ `format`) | Nearest `requestedSchema` property | Notes |
| --- | --- | --- |
| `text` | `StringSchema` (`type: "string"`) | MCP adds `minLength` / `maxLength`; OpenWOP has no counterpart. |
| `text` + `format: "email"` / `"uri"` / `"date"` / `"date-time"` | `StringSchema` with the same `format` | The upstream format set is exactly `email`, `uri`, `date`, `date-time`. |
| `text` + `format: "time"` or `x-<format>` | `StringSchema` with no `format` | MCP's format set has no `time` and no extension formats. |
| `longtext` | `StringSchema` (partial) | MCP has no multi-line kind, so the `text` / `longtext` distinction does not carry over. |
| `number` | `NumberSchema` (`type: "number"`) | MCP also has `type: "integer"` and `minimum` / `maximum`; the OpenWOP vocabulary has neither. |
| `boolean` | `BooleanSchema` | — |
| `select` + `options[]` | `UntitledSingleSelectEnumSchema` (`type: "string"`, `enum`) | OpenWOP options are bare strings. MCP's titled variant (`oneOf` of `{const, title}`) has no OpenWOP counterpart. |
| `multiselect` + `options[]` | `UntitledMultiSelectEnumSchema` (`type: "array"`, `items: {type: "string", enum}`) | MCP adds `minItems` / `maxItems`. |
| `file` | no counterpart | `PrimitiveSchemaDefinition` has no binary or content kind. |
| `artifact-ref` | no counterpart | MCP has no reference-to-artifact kind. |
| `vendor.<org>.<kind>` / `x-<kind>` | no counterpart | OpenWOP degrades these to a plain text input; MCP has no extension kinds. |

**Field attributes:**

| OpenWOP field attribute | Nearest `requestedSchema` element |
| --- | --- |
| `id` | the property key |
| `label` | `title` |
| `description` (form-content only; card inputs have none) | `description` |
| `required: true` | membership in the top-level `required[]` array (MCP lists required fields at the object level, not per field) |
| `default` | `default` |
| `options[]` | `enum` / `items.enum` |

**Sensitive input.** The upstream elicitation page forbids servers from using form mode to request sensitive information (secrets and credentials that grant access or authorize transactions), and directs them to URL mode (`ElicitRequestURLParams`) instead. The OpenWOP field vocabulary has no secret kind, so nothing in it identifies which fields would fall on either side of that rule.

---

## 3. Front-end plugin packs and MCP Apps (SEP-1865)

[`frontend-plugin-packs.md`](../../spec/v1/frontend-plugin-packs.md) (RFC 0117, amended by RFC 0119) and MCP Apps both let a third party ship interactive UI that a host runs in isolation and talks to through a message channel. The correspondence is conceptual. The two wires differ in envelope, in what is distributed and in how UI is linked to tools, and neither is defined in terms of the other.

A binding between the two surfaces is proposed separately. This section takes no position on whether the `ui-plugin/1` wire should converge with MCP Apps, and it is expected to be revised when that proposal is decided.

| Concern | OpenWOP front-end plugin pack | MCP Apps (SEP-1865) | Difference |
| --- | --- | --- | --- |
| Unit of distribution | a `uiPlugins[]` entry in a signed `kind: "frontend-plugin"` pack; `entry` is an opaque bundle inside the tarball | a UI resource with a `ui://` URI and `mimeType: "text/html;profile=mcp-app"`, fetched with `resources/read` | OpenWOP ships signed bytes through the registry (Ed25519 + SRI). An MCP App is served live by the MCP server. SEP-1865 defines no publisher signature; its security section suggests that hosts hash predeclared resources for review. |
| Where the UI attaches | `surface`: `artifact-viewer`, `route`, `settings-panel`, `canvas-preview` | a tool's `_meta.ui.resourceUri`; the host renders the tool's results in that view | OpenWOP attaches UI to host surfaces and artifact types, while MCP Apps attaches it to tools. |
| Isolation | a mechanism-neutral isolation property; the default is a cross-origin sandboxed iframe whose `sandbox` attribute withholds same-origin privileges (`capabilities.uiPlugins.isolation`) | mandatory iframe sandboxing; a web host wraps the view in a sandbox proxy on an origin different from the host, and the proxy has `allow-scripts` and `allow-same-origin` | Both separate the UI from the host origin, but the iframe permission sets differ. OpenWOP also admits `wasm`, `process`, `container` and `vm` models. |
| Message channel | `ui-plugin/1` over `postMessage`: an OpenWOP envelope (`openwop: "ui-plugin/1"`, `type: request \| response \| event`, integer `id`) | JSON-RPC 2.0 over `postMessage`; the view acts as an MCP client (`ui/initialize`, `ui/notifications/*`, and forwarded `tools/call` / `resources/read`) | The envelopes differ, and so do the method sets. |
| Method authorization | only methods in both the manifest `hostApi` and `capabilities.uiPlugins.hostApi`; anything else gets `method_not_allowed` | tool `visibility` (`model` / `app`); the host rejects app `tools/call` for tools without `app`, and may block or gate other messages | OpenWOP has a closed per-plugin allowlist, while MCP Apps controls visibility per tool. |
| Network egress | `connectSrc[]`: explicit `connect-src` exceptions; if absent, the plugin runs under a deny-egress CSP | `_meta.ui.csp.connectDomains[]`: becomes the CSP `connect-src` directive; if empty or omitted, no external connections | These are the closest pair. MCP Apps also has `resourceDomains`, `frameDomains` and `baseUriDomains`, which have no OpenWOP counterpart. |
| Data access | `artifact.read` / `artifact.write` with an opaque optimistic-concurrency `version` token | tool input and results pushed by `ui/notifications/tool-input` / `tool-result`; further data through forwarded MCP requests | MCP Apps has no artifact or concurrency model. |

---

## 4. `exportFormats` identifiers and IANA media types

[`artifact-type-packs.md`](../../spec/v1/artifact-type-packs.md) defines `exportFormats` as short **identifiers** ("the lowercase file-extension / common name"), not media types. The manifest schema pattern rejects `/`, so no media type is a valid `exportFormats` value, and this table changes no value. It lists the IANA registration that each reserved identifier most plausibly names, for readers who need a media type, such as an MCP resource `mimeType`.

This surface is expected to be revised by a separate RFC. Until that happens, the identifier's meaning stays as loosely defined as the spec text above, and this table does not narrow it.

| `exportFormats` identifier | IANA media type | Registration reference |
| --- | --- | --- |
| `pdf` | `application/pdf` | RFC 8118 |
| `pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | vendor tree |
| `docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | vendor tree |
| `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | vendor tree |
| `md` | `text/markdown` | RFC 7763 (the `charset` parameter is required) |
| `html` | `text/html` | W3C |
| `txt` | `text/plain` | RFC 2046 |
| `csv` | `text/csv` | RFC 4180 |
| `json` | `application/json` | RFC 8259 |
| `png` | `image/png` | W3C |
| `svg` | `image/svg+xml` | W3C |
| `jpeg` | `image/jpeg` | RFC 2045 / RFC 2046 |
| `step` | `model/step` | ISO TC 184/SC 4 |
| `stl` | `model/stl` | DICOM |
| `dxf` | `image/vnd.dxf` | vendor tree |

`vendor.*` and `x-*` identifiers have no registry counterpart.

---

## 5. The prompt library and MCP `prompts/list`

**Current fact:** when a host advertises `capabilities.mcp.serverMount.supported`, its MCP `prompts/list` / `prompts/get` expose **workflows registered via `core.openwop.mcp.expose-prompt`** (`mcp-integration.md` §"OpenWOP host as MCP server" §1). They do not expose the prompt library served by `GET /v1/prompts` ([`prompts.md`](../../spec/v1/prompts.md) §"Discovery & distribution"). No OpenWOP text projects a `PromptTemplate` into an MCP `Prompt`.

For readers comparing the two anyway:

- A `PromptTemplate` has a `kind` that includes `system`, while an MCP `PromptMessage.role` is only `user` or `assistant`.
- `PromptVariable` entries are typed, while MCP `prompts/get` arguments are a string-to-string map and `PromptArgument` carries only `name`, `title`, `description` and `required`.

A projection from one to the other would be a new rule and would need its own RFC.

---

## 6. Observability

OpenTelemetry's MCP semantic conventions (`mcp.*`, now kept in `open-telemetry/semantic-conventions-genai`) are at Development stability, and `mcp.session.id` refers to MCP sessions, which the 2026-07-28 revision removed. OpenWOP defines no mapping to them today ([`observability.md`](../../spec/v1/observability.md) says the spec does not prescribe a mapping to vendor taxonomies, and its `openwop.mcp.invocation` span is an OpenWOP attribute set, not an `mcp.*` projection); a projection is proposed under a separate RFC.

---

## See also

- [`spec/v1/mcp-integration.md`](../../spec/v1/mcp-integration.md): the normative client and server composition, and the `mcp-2026-07-28` and `mcp-2025-06-18-legacy` profiles.
- [`spec/v1/tool-catalog.md`](../../spec/v1/tool-catalog.md), [`chat-card-packs.md`](../../spec/v1/chat-card-packs.md), [`form-content-packs.md`](../../spec/v1/form-content-packs.md), [`frontend-plugin-packs.md`](../../spec/v1/frontend-plugin-packs.md), [`artifact-type-packs.md`](../../spec/v1/artifact-type-packs.md), [`prompts.md`](../../spec/v1/prompts.md): the OpenWOP surfaces compared above.
- [`docs/integrations/durable-runtimes.md`](./durable-runtimes.md) and [`serverless-workflow-and-bpmn.md`](./serverless-workflow-and-bpmn.md): the other integration notes.
