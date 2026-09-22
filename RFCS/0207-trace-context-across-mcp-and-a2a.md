# RFC 0207: trace context across MCP and A2A, and debug-bundle spans that join the trace

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0207                                                            |
| **Title**         | W3C Trace Context carried in MCP `params._meta` and A2A `Message.metadata.openwop` beside the HTTP header that stays conforming, debug-bundle spans that carry `traceId` / `kind` / `status`, and an optional versioned OTel `mcp.*` projection |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 — `Draft → Active` in the filing PR; **comment window waived** by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: this RFC is observability — it adds a carrier for correlation data that the corpus already says is "never authorization evidence" (`observability.md` §"Trace context across interop boundaries"), and touches no identity, authorization, isolation, idempotency, replay, external-effect or certification surface. · **Updated 2026-09-22 — amended per implementation review** (`review/arch-impl.md` R3, R10; Status unchanged: every Falsifiability id is minted by a file a v2 cut reaches, `v2-interop-trace-context` or the `BOTH_MAJORS` `otel-mcp-semconv-projection`; the §C debug-bundle rows are v1-only and **non-gating**, because v2 has no debug-bundle surface (§C.11), so the acceptance box no longer names `debug-bundle-span-trace`; the carrier rows restate decisions log D4, under which a header-only host passes with detail `header-only` and only a host with neither carrier fails) |
| **Affects**       | `spec/v1/multi-agent-execution.md` §"W3C tracecontext across MCP + A2A composition" (`:128–132`) · `spec/v1/mcp-integration.md` §D (named `_meta` mapping gains its outbound rule) · `spec/v1/a2a-integration.md` (declared `metadata.openwop.*` mappings, `:231`, `:370`) · `spec/v1/observability.md` (new §"MCP semantic-convention projection") · `spec/v1/debug-bundle.md` §"`spans` field" · `schemas/debug-bundle.schema.json` · `spec/v2/core/interop.md` (new §"Trace context") · conformance: `cross-host-traceparent-propagation.test.ts` rewritten; legs added to `debugBundle.test.ts`; two new scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md` — see §Compatibility for the one clarification that could read as stricter |
| **Amends**        | RFC 0040 §B (names the carrier the "header into the outbound MCP request envelope" sentence left undefined); RFC 0154 §D (extends its `gen_ai.*` v0 pattern to `mcp.*`); RFC 0152 §D preamble (one more declared `metadata.openwop.*` mapping) |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

RFC 0040 §B requires a host that dispatches MCP tool calls to "inject the parent run's W3C `traceparent` header into the outbound MCP request envelope", and requires outbound A2A messages to "carry the parent run's `traceparent`". Neither requirement names where the value goes. An MCP request envelope is a JSON-RPC message with no headers, and on stdio there is no header anywhere. MCP 2026-07-28 has since fixed an in-message location: `params._meta.traceparent` (SEP-414, Final). This RFC names the carriers without breaking the one a production host uses today. The HTTP `traceparent` header on the request stays a conforming carrier: MyndHyve injects it there (steward decisions log D4). The in-message carriers, `params._meta.traceparent` for MCP and `Message.metadata.openwop.traceparent` for A2A, SHOULD also be sent, and on stdio `_meta` is the only carrier there is. The RFC also turns the conformance scenario that has sat as two `it.skip` placeholders since suite 1.5.0 into rows that can fail: they accept either carrier and fail when neither is present. Separately, it lets debug-bundle spans join the trace they belong to (`traceId`, plus OTLP `kind` and `status`). It also defines an optional, version-stamped projection of `openwop.mcp.invocation` onto the OTel MCP conventions, which upstream still marks Development, so the projection is a MAY. v2 has no debug-bundle surface, so that half is v1 only.

## Motivation

**The carrier is undefined, and the scenario tests the wrong one.** `spec/v1/multi-agent-execution.md:130` says "header … into the outbound MCP request envelope". `conformance/src/scenarios/cross-host-traceparent-propagation.test.ts:12–13` reads it as an HTTP header ("MUST carry the parent run's W3C `traceparent` header … the MCP peer … records inbound headers", `:46–50`). That reading breaks in three places:

1. **stdio has no headers.** MCP 2026-07-28 requires clients to support stdio or Streamable HTTP (per OTel's summary in `semantic-conventions-genai` `docs/gen-ai/mcp.md` §"Context propagation").
2. **On Streamable HTTP, a header names the transport hop, not the MCP request.** The OTel MCP conventions say so directly: "HTTP trace context propagation only covers the HTTP request, but not the individual messages client and server exchange … MCP and underlying transport (such as HTTP) contexts are independent. One MCP request can be served by multiple HTTP requests." The same page says instrumentation "SHOULD propagate context … by injecting it into the MCP request `params._meta` property bag".
3. **Upstream picked `_meta`.** MCP 2026-07-28 `basic/index` §"General fields › `_meta`": "the keys `traceparent`, `tracestate`, and `baggage` are reserved for OpenTelemetry trace context propagation. When present, their values MUST follow W3C Trace Context and W3C Baggage formats". Changelog 2026-07-28, minor change #2 (SEP-414, Status Final). OpenWOP's own `mcp-integration.md` §D already lists these `_meta` keys as a named mapping. Only the multi-agent MUST and the scenario still say "header".

**A2A has no carrier at all.** The A2A 1.0.1 specification does not mention trace context (verify-CD C-F7(b); review slice D §4.8). `a2a-integration.md:370` allows no `metadata.openwop.*` key beyond `permittedPurposes` and the `interrupt` carrier, and `:395` routes every other inbound `Message.metadata` key to opaque `metadata.a2a.messageMetadata`. So a host that obeyed RFC 0040 §B for A2A had to pick a key, and a receiving OpenWOP host would treat that key as opaque.

**Debug-bundle spans cannot be joined to a trace.** `spec/v1/debug-bundle.md` §"`spans` field" lists `name`, `spanId`, `parentSpanId`, timestamps and `attributes`. There is no `traceId`. The same corpus requires every request to honour W3C Trace Context (`observability.md` §"Trace context propagation"). A bundle exported for a support ticket therefore cannot be matched to the trace in the operator's tracing backend, and it cannot say whether a span failed (`status`) or which side of a call it records (`kind`). (Review slice D F4; verify-CD D-F4, CONFIRMED. The "16-byte" `spanId` prose error is a Phase 1 correction (P1-C), not this RFC.)

**`openwop.mcp.invocation` has no OTel projection.** `observability.md:278` defines a logs-based record. The MCP ecosystem is standardising span attributes in `open-telemetry/semantic-conventions-genai` (`mcp.method.name`, `mcp.protocol.version`, span name `{mcp.method.name} {target}`), and MCP 2026-07-28 deprecates its own Logging feature in favour of OpenTelemetry (SEP-2577). Every one of those attributes is **Development** stability (`docs/registry/attributes/mcp.md` at `4a39b6ef`, 2026-08-05; there is no tagged release), so RFC 0154 §D's rule applies: optional, version-stamped, never required by core conformance (`observability.md:197`).

## Proposal

### §A The MCP carrier (v1: `multi-agent-execution.md`, `mcp-integration.md`)

1. A host that propagates trace context into an MCP request (`tools/call` or any other request or notification it sends) **MUST** carry W3C Trace Context values in at least one of two carriers:
   - (a) that request's `params._meta`, under the unprefixed keys `traceparent` and, when it has one, `tracestate`;
   - (b) on Streamable HTTP, the `traceparent` (and `tracestate`) header of the HTTP request that carries the MCP request.

   It **SHOULD** use (a) in every case. On stdio (a) is the only carrier, so there it is required. It **MAY** carry `baggage` (W3C Baggage) in `_meta` and **MUST NOT** put tenant, principal, credential or run-input material in it.
2. **Why the header stays conforming.** A header names the transport hop, not the MCP request, and one MCP request can span several HTTP requests (OTel `docs/gen-ai/mcp.md`). That is why (a) is recommended. But RFC 0040 §B said "header", and MyndHyve, the only host advertising `multiAgent.executionModel.version >= 3`, injects an HTTP header today (`ExternalApiCallWrapper.ts:178`, read 2026-09-22; decisions log D4). Making `_meta` the only conforming carrier would fail a production host for following the text it was given, so (b) stays conforming.
3. `multi-agent-execution.md:130` is rewritten. The obligation and its gate are unchanged (`multiAgent.executionModel.version >= 3`); only the carrier is named:

   > Hosts that dispatch MCP tool calls AND advertise `multiAgent.executionModel.version >= 3` MUST inject the parent run's W3C trace context into every outbound MCP request, in its `params._meta` (`traceparent`, and `tracestate` when present, per MCP 2026-07-28 §"General fields › `_meta`", SEP-414) or, on Streamable HTTP, in the HTTP `traceparent` header. Hosts SHOULD use `params._meta`, which is the only carrier on stdio and the one that names the MCP request rather than the transport hop. A host acting as the MCP server MUST adopt `params._meta.traceparent`, when present, as the parent of the spans it emits for that request, and otherwise the transport header; it MAY record the transport context as a span link.

4. **Receiver.** When `params._meta.traceparent` and a transport `traceparent` header disagree, the `_meta` value is the parent of the MCP server span, and the transport context **MAY** be recorded as a link (OTel `docs/gen-ai/mcp.md`: "SHOULD, by default, use context extracted from MCP `params._meta` as a parent … and SHOULD link current ambient context"). When only the header is present, the header value is the parent. A malformed value **MUST** be ignored, which starts a new trace, and **MUST NOT** fail the request. This follows W3C Trace Context §3.2, which says an implementation that cannot parse `traceparent` "should restart the trace".

### §B The A2A carrier (v1: `multi-agent-execution.md:132`, `a2a-integration.md`)

5. A host that propagates trace context into an outbound A2A message **MUST** carry it in `Message.metadata.openwop.traceparent` (and, when present, `.tracestate`), or in the `traceparent` header of the HTTP request that carries the message, and **SHOULD** use the metadata carrier. The metadata values are string-valued W3C Trace Context values on the A2A `Message` (`a2a.proto` v1.0.1 `Message.metadata`, a `google.protobuf.Struct`). The carrier sits on the `Message`, not on `SendMessageRequest.metadata`, so it survives into `Task.history[]` and applies equally to `SendStreamingMessage`. The header stays conforming for the reason §A.2 gives.
6. `multi-agent-execution.md:132` becomes:

   > The same rule applies symmetrically to A2A composition (`spec/v1/a2a-integration.md`): outbound A2A messages MUST carry the parent run's trace context in `Message.metadata.openwop.traceparent` (and `.tracestate` when present) or in the HTTP `traceparent` header, and SHOULD use the metadata carrier; inbound A2A handlers MUST adopt it as the trace parent, preferring the metadata value when both are present. A malformed value is ignored, never a request failure.

7. `a2a-integration.md:231` (§"What OpenWOP does NOT specify") and `:370` (D preamble "The only other declared mappings …") each add `metadata.openwop.traceparent` / `.tracestate` (RFC 0207) to their list of declared mappings. The `:395` exception ("**except** the declared `metadata.openwop.*` keys above") then keeps them out of `metadata.a2a.messageMetadata`. A peer that is not OpenWOP ignores them, as A2A requires for unknown metadata.
8. **Not authority.** As `observability.md` §"Trace context across interop boundaries" already states for every boundary, a host **MUST NOT** derive tenant, principal or scope from either carrier. That statement becomes explicit in both carrier sections.

### §C Debug-bundle spans that join the trace (v1 only)

9. Each `spans[]` entry of `GET /v1/runs/{runId}/debug-bundle` gains three optional fields:

| Field | Shape | Rule |
| --- | --- | --- |
| `traceId` | `^[0-9a-f]{32}$`, not all zeros (W3C Trace Context / OTLP 16-byte trace id) | **SHOULD** be present on every span the host recorded in a trace. When present, it **MUST** equal the trace id of the W3C trace the span belongs to. For a run started with an inbound `traceparent` that the host honoured (`observability.md` §"Trace context propagation": "MUST honor"), that is the inbound trace id |
| `kind` | `internal` \| `server` \| `client` \| `producer` \| `consumer` | OTLP `SPAN_KIND_*` 1–5, lowercased. Absent means unspecified |
| `status` | `{ code: "unset" \| "ok" \| "error", message? }`, closed | OTLP `Status` (`STATUS_CODE_*` 0–2). `message` is subject to §"Redaction guarantees" like every attribute |

10. `schemas/debug-bundle.schema.json` `spans.items` declares the three properties (see Compatibility). `redactionApplied` / `redactionMode` semantics are unchanged, and `status.message` and `attributes` are redacted by the same harness (invariant `secret-leakage-debug-bundle`).
11. **v2 has no debug-bundle surface.** `api/v2/openapi.yaml` and `spec/v2/path-manifest.json` carry no debug-bundle operation. `debugBundle.test.ts` and `debug-bundle-truncation.test.ts` are major-1 only (`conformance/scenario-majors.json`). The `production` family's `debugBundle` facet in `spec/v2/declaration.json` and the orphan `schemas/v2/debug-bundle.schema.json` (closed `spans.items`, no `traceId`) describe a read that v2 does not serve. This RFC adds **no** v2 debug-bundle text and **no** v2 schema property, because a field that no host can emit on any wire is unwitnessable (architect P3-H3). Gap G2 hands the orphan schema to `/cleanup`. If a v2 debug-bundle read is ever minted, it inherits §C.9.
    - **§C is non-gating for this RFC's `Accepted` flip** (amended 2026-09-22). `check-accepted-predicate` rule 4 reads only v2 bundles and the corpus ledger, and no v2 cut can reach a major-1 debug-bundle leg. So the §C rows carry no requirement id in the Falsifiability table. The v1 legs still ship in `debugBundle.test.ts`, and a v1 run that exercises them (a local boot of a v1 reference host that emits non-empty `spans[]`) is cited in `Updated` as documented, **un-gated** evidence when one exists. The §C text binds v1 hosts from merge either way.

### §D Optional OTel `mcp.*` projection (v1 `observability.md`, after the `gen_ai.*` table)

12. A host **MAY** project `openwop.mcp.invocation` (and the MCP calls it makes or serves) onto the OpenTelemetry MCP semantic conventions. This is **v0, experimental**, following RFC 0154 §D exactly. A host that emits any `mcp.*` attribute under this projection **MUST** also emit `openwop.otel.mcp_mapping_version: "0"` and `openwop.otel.mcp_semconv_ref: "open-telemetry/semantic-conventions-genai@<commit>"`. Core conformance **MUST NOT** require any `mcp.*` attribute.

| OpenWOP source | OTel (v0 projection; upstream Development) | Rule |
| --- | --- | --- |
| the JSON-RPC method of the call (`tools/call`, …) | `mcp.method.name` | Required by upstream when projecting |
| the tool name | `gen_ai.tool.name`; span name `{mcp.method.name} {gen_ai.tool.name}` | as upstream |
| the negotiated revision (`mcp.revisions[]` / `MCP-Protocol-Version`) | `mcp.protocol.version` | |
| the JSON-RPC `id` | `jsonrpc.request.id` | string form |
| `errorCode` when the peer answered a JSON-RPC error | `rpc.response.status_code` + span status `ERROR` | status description = `JSONRPCError.message`, redacted |
| host as caller / host as mount | span kind `CLIENT` / `SERVER` | |
| — | `mcp.session.id` | **MUST NOT** be emitted for a 2026-07-28 exchange: that revision is stateless and has no session |
| — | `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` (upstream Opt-In) | **MUST NOT** be emitted under this projection. They carry content, and `openwop.mcp.invocation` is content-free |
| `tenantId`, `moduleId`, `uid` | — | stay `openwop.*`; never projected into `mcp.*` or `gen_ai.*` |

### v2 text (proposed, `spec/v2/core/interop.md`, new § before §"Threat model" and after RFC 0202's §"Per-agent cards"; 90 words)

> ## Trace context
>
> A host that propagates W3C Trace Context into an MCP request MUST carry it in that request's `params._meta` (unprefixed `traceparent`, and `tracestate` when present; MCP 2026-07-28 `_meta`, SEP-414) or in the HTTP `traceparent` header, and SHOULD use `_meta`, the only carrier on stdio. Into an A2A message it MUST carry it in `Message.metadata.openwop.traceparent` and `.tracestate` or in the HTTP header, and SHOULD use the metadata. A receiver prefers the in-message value, ignores a malformed one, and MUST NOT derive tenant, principal or scope from either (RFC 0207).

The banner Status line appends `RFC 0207`. **Family homing:** this text is homed in `interop.md` because that document is the normative home of `a2a` and `mcp` (`spec/v2/declaration.json`), and the rule is about those two compositions. `multiAgent`'s v2 normative text stays `spec/v1/multi-agent-execution.md`, which this RFC edits (§A.3, §B.6), so the v1 edit binds both majors for `multiAgent`, while the v2 `a2a`/`mcp` families get the carrier from `interop.md`. Homing `multiAgent` honestly means porting a 5,507-word v1 document (execution loop, handoff, memory lifecycle, causation, replay determinism, context economy, verifier, live dispatch) into v2, far beyond this RFC's scope. A stub that names the family only to collect the RFC 0190 budget grant is the pattern RFC 0191's reciprocal marker exists to make visible. Gap G3.

**Examples.** *Positive:* `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"echo","arguments":{…},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"traceparent":"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"}}}`. An A2A `Message` with `"metadata":{"openwop":{"traceparent":"00-4bf9…-01"}}`. A debug-bundle span `{"name":"openwop.run","traceId":"4bf92f3577b34da6a3ce929d0e0e4736","spanId":"00f067aa0ba902b7","kind":"server","status":{"code":"ok"}, …}`. *Negative:* a stdio MCP request with no `params._meta.traceparent` from a host that propagates (§A.1). A Streamable HTTP request with neither carrier (§A.1). A header-only request is **not** a negative: it conforms (§A.2), and misses only the SHOULD. A debug-bundle `traceId` of 16 hex characters (a span id in the wrong field). `kind: "SPAN_KIND_SERVER"`. A projected span carrying `mcp.session.id` for a 2026-07-28 exchange.

## Compatibility

**Additive**, relying on the COMPATIBILITY §4 row "new normative requirement on a previously-undefined behavior". Clause by clause:

- **§A / §B carriers.** RFC 0040 §B left the carrier undefined, and no reading of "header … into the MCP request envelope" works on stdio. This RFC keeps the HTTP header conforming and adds the in-message carriers beside it, so no host that conforms today stops conforming. **Measured exposure:** `multiAgent.executionModel.version >= 3` is advertised by one host, MyndHyve, and MyndHyve injects `traceparent` as an outbound HTTP header (`packages/workflow-engine/src/services/ExternalApiCallWrapper.ts:178`, `nodes/conformance/mcpInvoke.node.ts`, read-only source read 2026-09-22; steward decisions log D4). That carrier satisfies §A.1(b) and §B.5. The only new MUST is the stdio case, where RFC 0040 §B could not be met at all, so it is a requirement on previously undefined behaviour, not a stricter one. Gap G1 is closed.
- **§B `a2a-integration.md` declared-mapping list.** An inbound `metadata.openwop.traceparent` previously landed in opaque `metadata.a2a.messageMetadata`. Now it is read as trace context. That changes nothing a caller can observe on the wire: the value is correlation, never authority (§B.8).
- **§C debug-bundle schema.** `spans.items` is `additionalProperties: true` today, so declaring `traceId` / `kind` / `status` with shapes rejects a bundle that already emits one of those names in another shape. That is, in form, "stricter validation". Measured exposure: all three v1 reference hosts emit `spans: []` (`openwop-examples` `sqlite/src/server.ts:3433`, `postgres/src/server.ts:4577`, `python/src/openwop_host/server.py:1330`), and no committed bundle carries a non-empty `spans[]`. No known document is newly invalid, so this is the "previously-undefined" row. Risk R2 records it. If a host reports a conflicting `traceId` during `Active`, the fallback is to declare `traceId` as a bare `string` and move the grammar into the scenario (a suite requirement, COMPATIBILITY §2.3).
- **§D.** This section adds only OPTIONAL attributes. Its two MUST NOTs bind only a host that opts into the projection, and nothing previously defined is constrained.
- **v2.** One conditional MUST (the carrier, if a host propagates at all) is added to a family that had no trace text. No v2 schema, operation or facet changes.
- **Certification.** No requirement id enters a floor or profile predicate. The `a2a` / `mcp` / `multiAgent` families keep `floorScenarios: []`.

## Conformance

- **Rewritten** `conformance/src/scenarios/cross-host-traceparent-propagation.test.ts` (major 1). The two `it.skip` placeholders and the "records inbound headers" docstring are replaced by runnable legs that drive the existing fixtures `conformance-mcp-tool-roundtrip` and `conformance-a2a-task-roundtrip` against the in-process fake MCP server and fake A2A peer (`conformance/src/lib/mcp-fake-server.ts` already records params and headers per invocation; the A2A peer records request bodies). The suite starts the run with its own `traceparent` (a fresh 32-hex trace id) on `POST /v1/runs`.
- **New** `v2-interop-trace-context.test.ts` (major 2). The same legs over the v2 runs API, gated on the `mcp` / `a2a` facets and on the seam fixture. It is the gating home of every carrier id: the two outbound carrier rows, and the host-as-server rows (§A.3 adopt `_meta`, §A.4 malformed ignored, §B.6 inbound A2A adopt) against the v2 MCP mount and A2A server that RFC 0208 builds on the v2 reference host. The rewritten major-1 file above mints the same ids as supplementary, non-gating coverage.
- **New** `otel-mcp-semconv-projection.test.ts`, registered for **both majors** (`BOTH_MAJORS` in `conformance/scripts/generate-scenario-majors.mjs`). It is written major-aware from the start (no hard-coded `/v1/` path, no `.supported` gate), because `spec/v1/observability.md` is v1-carried normative text at v2. It reads spans from the suite's OTLP collector.
- **Legs added** to `debugBundle.test.ts` (major 1). They are non-gating (§C.11).
- **Carrier verdict (decisions log D4).** Both carrier legs accept **either** carrier. A host that sends only the HTTP `traceparent` header **passes**, with detail `header-only`. A leg fails only when **no** carrier is present or the trace id differs from the suite's.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1/§A.3 outbound MCP carrier | `openwop.requirement.0207.mcp-traceparent-carried`: the fake server's recorded `tools/call` carries a `traceparent` matching `^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$` in `params._meta` or in the HTTP header, and its trace id equals the suite's. **Sabotage:** a host that sends neither carrier fails, and so does a host that mints a fresh trace (trace-id equality). The row accepts **either** carrier and names in its detail which one it found (`_meta`, header, or both); a header-only host passes (§A.2), with detail `header-only` so the SHOULD stays visible | the suite, gated on `multiAgent.executionModel.version >= 3` + the fixture + the fake server | witnessable — gated |
| §A.3 host-as-server adopts `_meta` | `openwop.requirement.0207.mcp-server-adopts-meta`: the suite calls the host's MCP mount `tools/call` with `_meta.traceparent` (trace T) and a **different** transport `traceparent` header (trace H). The host's exported spans for that call carry trace T, not H | the suite, gated on a v2 MCP server mount (RFC 0208; major 2: `v2-interop-trace-context`) and OTLP export to the suite collector (the `otel-trace-propagation.test.ts` gate); the v1-mount leg is non-gating | witnessable — gated; `inapplicable` where OTLP cannot reach the suite (`REQUIRES_HOST_CALLBACK`) |
| §A.4 malformed value ignored | the same mount call with `_meta.traceparent: "garbage"` returns a normal result, not a JSON-RPC error | the suite, gated as above (spans not needed) | witnessable — gated |
| §B.5/§B.6 outbound A2A carrier | `openwop.requirement.0207.a2a-traceparent-carried`: the fake peer's recorded `SendMessage` carries the suite's trace id in `params.message.metadata.openwop.traceparent` or in the HTTP `traceparent` header. It accepts either carrier and fails when neither is present or the trace id differs, as the MCP row does | the suite, gated on `version >= 3` + `conformance-a2a-task-roundtrip` + the fake peer | witnessable — gated |
| §B.6 inbound A2A handler adopts it | a `SendMessage` into the host's A2A endpoint with `metadata.openwop.traceparent` (trace T). The host's exported spans for the resulting run carry trace T | the suite, gated on the A2A inbound surface and OTLP export | witnessable — gated |
| §A.1/§B.8 never authority | nothing distinguishable. A host that derived tenant from `traceparent` would have to be handed a forged value **and** show a cross-tenant effect, which is `interop-peer-no-authority-escalation`'s territory | — | unwitnessable as a separate row; covered in spirit by the existing invariant |
| §C.9 `traceId` joins the trace (v1 only; leg id `0207.debug-bundle-span-trace` in the major-1 `debugBundle` scenario) | for a run started with the suite's `traceparent`, every bundle span carrying `traceId` validates against the schema, and at least the `openwop.run` span's `traceId` equals the suite's trace id. **Sabotage:** a random per-span trace id fails. A span id copied into `traceId` fails the schema | the suite, gated on `debugBundle.supported` + a **non-empty** `spans[]`, at major 1 | witnessable — gated at major 1 only. A host that returns `spans: []` records `inapplicable` with that reason, **not** pass. **Non-gating** (§C.11): v2 has no debug-bundle surface, so the row carries no requirement id for rule 4 |
| §C.9 `kind` / `status` shape (v1 only) | schema validation of the same bundle | the suite, same gate, at major 1 | witnessable — gated at major 1 only; **non-gating**, as the row above |
| §D.12 version stamp when projecting | `openwop.requirement.0207.mcp-semconv-stamped`: any collector span carrying an `mcp.*` attribute also carries `openwop.otel.mcp_mapping_version: "0"` and a `…semconv_ref` matching `^open-telemetry/semantic-conventions-genai@[0-9a-f]{7,40}$`. No such span carries `mcp.session.id` for a 2026-07-28 exchange or `gen_ai.tool.call.arguments` / `.result` | the suite, only when the host chose to project (both majors: `BOTH_MAJORS`) | witnessable — gated. `inapplicable` (with that reason) when no `mcp.*` span arrives. The projection is optional, so absence is never a failure |

Invariants: **none added.** The carrier rules are observability, and "never authorization evidence" is already stated at `observability.md` §"Trace context across interop boundaries" and enforced by `interop-peer-no-authority-escalation` / `mcp-extension-no-authority`. `secret-leakage-debug-bundle` and `secret-leakage-otel-attribute` gain no new text, because `status.message` falls under their existing redaction scope.

## Alternatives considered

- **Header only.** This matches the scenario's current reading but fails on stdio, contradicts OTel's "MCP and underlying transport … contexts are independent", and diverges from MCP 2026-07-28 `_meta`. Rejected as the *only* carrier; kept as a conforming one.
- **`_meta` only, as a MUST** (this RFC's first draft). It is what upstream points at, but it makes MyndHyve, which injects the header, non-conformant for following RFC 0040's text, and that would turn an observability RFC into a §3 safety fix. Rejected (decisions log D4). Unresolved question 5 asks when the SHOULD can become a MUST.
- **An A2A extension URI** (`https://openwop.dev/a2a/ext/trace-context`) declared in `Message.extensions[]` with the value in `metadata`. This is more A2A-idiomatic, but it adds an extension-negotiation surface for one string, and OpenWOP's A2A mappings already live under `metadata.openwop.*`. Recorded as UQ1 so it can be adopted if A2A standardises trace context itself.
- **`SendMessageRequest.metadata` instead of `Message.metadata`.** Request-level metadata is not retained in `Task.history[]` and has no streaming counterpart. Rejected.
- **Adopt OTLP/JSON `Span` wholesale in the debug bundle** (`startTimeUnixNano`, `attributes` as a `KeyValue` list). That is wire-breaking for every existing bundle consumer. Only the three joinable fields are adopted.
- **A v2 debug-bundle `traceId`.** v2 has no debug-bundle read, so the field would have no witness (architect P3-H3). Rejected.
- **Require the `mcp.*` projection.** Upstream is Development stability with no tagged release, and RFC 0154 §D forbids requiring it. Rejected.
- **Do nothing.** RFC 0040 §B stays unconformable on stdio and untestable everywhere, and its scenario stays a permanent skip.

## Unresolved questions

1. If A2A later standardises trace context (an extension or a `Message` field), should OpenWOP move its carrier to it with a dual-read period? Yes in principle. The mechanics wait for upstream.
2. Should `baggage` be forwarded across an A2A boundary at all? It can carry arbitrary key/values. This RFC allows it on MCP (a reserved upstream key) and does not define an A2A slot for it.
3. Should a host that is not `version >= 3` be required to propagate trace context at all? No. §A.1 and §B.5 define only the carrier *when* a host propagates. Whether a host propagates is still governed by `observability.md`'s SHOULD ("Servers SHOULD propagate `traceparent` through the engine into … every external API call") and by RFC 0040's gated MUST. Raising that SHOULD to a MUST is a separate question and would be a new obligation.
4. When upstream `mcp.*` reaches Release Candidate or Stable, should the projection become a SHOULD with `mapping_version: "1"`? It would need a follow-up RFC.
5. When every host advertising `version >= 3` sends the in-message carrier, should §A.1(a) and §B.5's metadata carrier become MUST? The `header-only` detail on the two carrier rows measures that; a raise would be a new obligation, filed as its own RFC.

## Implementation notes (non-normative)

See the companion implementation plan (not committed with the RFC). v2 core word delta is about +92 (90 words of section plus the banner cite) with no families homed. It depends on Phase 1 P1-C, the `debug-bundle.md` "16-byte" spanId correction, which edits the same list.

## Acceptance criteria

- [x] `Active` — 2026-09-22 (window waived; routine, not an §A.6 override).
- [ ] Spec text merged: v1 prose (multi-agent, mcp-integration, a2a-integration, observability, debug-bundle), the debug-bundle schema, the v2 `interop.md` §, the rewritten scenario, and the three new or extended scenarios, riding the open 2.36.0 suite (decisions log D3). The MyndHyve carrier answer is recorded (gap G1: HTTP header, decisions log D4).
- [ ] `Accepted`: a committed, certified **v2** host bundle carries `openwop.requirement.0207.mcp-traceparent-carried` **and** `openwop.requirement.0207.a2a-traceparent-carried` at `executed-pass` from `v2-interop-trace-context`, nothing relaxed (the v2 reference host, tier-1, is the expected witness). A header-only carrier passes (detail `header-only`, D4). Each row's sabotage (neither carrier, fresh trace) has been run once against the witness. Every other id in the Falsifiability table has an `executed-pass` or a reached, reasoned `inapplicable` row on that bundle. `.mcp-semconv-stamped` is not required to pass. The §C debug-bundle rows are v1-only and not required (§C.11).
- [ ] Amended-by rows on RFC 0040, RFC 0154 and RFC 0152.
- [ ] `coverage.md` honesty note for `cross-host-traceparent-propagation.test.ts` rewritten, since it is no longer `it.skip`.
- [ ] CHANGELOG entry.

## References

- MCP 2026-07-28 `docs/specification/2026-07-28/basic/index.mdx` §"General fields › `_meta`" (OpenTelemetry trace context); changelog 2026-07-28 minor change #2; SEP-414 `seps/414-request-meta.md` (Status: Final), all at `github.com/modelcontextprotocol/modelcontextprotocol` `main`, fetched 2026-09-22.
- OpenTelemetry `semantic-conventions-genai` `docs/gen-ai/mcp.md` §"Context propagation", §Client span (Status: Development), and `docs/registry/attributes/mcp.md`, last changed at commit `4a39b6ef` (2026-08-05). The core `semantic-conventions` `docs/gen-ai/mcp.md` now reads "Moved".
- OTLP `opentelemetry/proto/trace/v1/trace.proto`: `SpanKind` 0–5, `Status.StatusCode` 0–2. W3C Trace Context (https://www.w3.org/TR/trace-context/), W3C Baggage.
- A2A v1.0.1 `specification/a2a.proto` (`Message.metadata`, `SendMessageRequest.metadata`); `docs/specification.md` (no trace-context text).
- RFC 0040 §B; RFC 0154 §D; RFC 0152 §D; RFC 0153 §D; RFC 0023; RFC 0042 §B; `spec/v1/observability.md` §"Trace context propagation", §"Trace context across interop boundaries", §"GenAI semantic-convention projection", `:278`; `spec/v1/debug-bundle.md`; `spec/v2/core/interop.md`.
- Review slice D F3, F4, D19–D21, §4.8; `review/verify-CD.md` C-F7(b), D-F3, D-F4; `review/arch-P3.md` P3-H3, P3-M4.
