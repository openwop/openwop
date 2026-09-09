# OpenWOP Spec v1 — Observability and OpenTelemetry Taxonomy

> **Status: Stable · v1.1 (2026-04-27).** Comprehensive coverage of the canonical `openwop.*` attribute namespace, span naming conventions, and metric kinds. Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

External implementers and operators need a shared vocabulary for tracing and metrics so that:

1. Dashboards built against one openwop server work against another.
2. SDKs can correlate client-side spans with server-side spans without per-vendor mapping tables.
3. Conformance tests can verify "the server emits a span named `openwop.node.<typeId>` with attribute `openwop.node_id`" without ambiguity.

openwop defines the canonical `openwop.*` attribute namespace. Implementations MAY alias to vendor-specific taxonomies (e.g., `langgraph.*` for LangSmith integration, `dd.*` for Datadog) per deployment, but **the spec does not prescribe a mapping**. Vendor bridges are the deployer's responsibility.

---

## Trace context propagation

An OpenWOP-compliant server MUST honor and emit [W3C Trace Context](https://www.w3.org/TR/trace-context/) headers on every HTTP request and SSE event:

| Header        | Direction | Purpose                                         |
| ------------- | --------- | ----------------------------------------------- |
| `traceparent` | Both      | Standard W3C trace + span ID + sampled flag     |
| `tracestate`  | Both      | Vendor-specific trace state (opaque to openwop) |

Servers SHOULD propagate `traceparent` through the engine into:

- Every NodeModule execution span
- Every external API call (AI providers, webhooks)
- Every event log append (so durable events carry the originating trace)

Clients SHOULD include `traceparent` on outbound requests so server-side spans nest under the client's parent span.

---

## Export protocols

Hosts that emit OTLP telemetry MUST support at least `http/json` and `http/protobuf` and MAY additionally support `grpc`. Hosts MAY advertise the supported transports under `capabilities.observability.otel.exportProtocols` (an array drawn from `{"http/json", "http/protobuf", "grpc"}`). Collectors MAY use this to pick a compatible exporter without probing.

| Transport       | Wire                          | Content-Type             | Notes                                                                                                                                                                                                                                                                                               |
| --------------- | ----------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http/json`     | HTTP/1.1 POST                 | `application/json`       | Default. Required of all OTel-emitting hosts.                                                                                                                                                                                                                                                       |
| `http/protobuf` | HTTP/1.1 POST                 | `application/x-protobuf` | Required of all OTel-emitting hosts. Compact binary; same shape as `http/json` decoded.                                                                                                                                                                                                             |
| `grpc`          | HTTP/2 unary RPC (h2c or TLS) | `application/grpc+proto` | Optional. Service paths: `/opentelemetry.proto.collector.trace.v1.TraceService/Export` and `/opentelemetry.proto.collector.metrics.v1.MetricsService/Export`. Messages are length-prefixed protobuf per the [gRPC HTTP/2 protocol](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md). |

The openwop conformance suite ships a collector for all three transports under `conformance/src/lib/otel-collector.ts` (hand-rolled, zero npm-dep). See `conformance/README.md` §"Optional environment flags" for the relevant `OPENWOP_OTEL_COLLECTOR*` env vars.

---

## Span attributes

An OpenWOP-compliant server emitting OTel spans for engine activity MUST use the following canonical attributes. Implementations MAY add their own attributes outside the `openwop.*` namespace; the spec only constrains what's inside it.

### Run-level attributes

Set on every span emitted during a run's lifecycle:

| Attribute                  | Type   | Required | Notes                                     |
| -------------------------- | ------ | -------- | ----------------------------------------- |
| `openwop.run_id`           | string | MUST     | Run ID (e.g., `run_abc123`)               |
| `openwop.workflow_id`      | string | MUST     | Workflow ID the run is executing          |
| `openwop.protocol_version` | string | SHOULD   | Server's openwop protocol version         |
| `openwop.tenant_id`        | string | MAY      | Tenant/workspace scoping (if applicable)  |
| `openwop.scope_id`         | string | MAY      | Project/scope correlation (if applicable) |
| `openwop.actor.kind`       | string | MAY      | RFC 0132. The acting principal's kind (`user` / `agent` / `anonymous`), mirroring `run-snapshot.owner.principalKind`. Content-free — a dashboard signal, not PII. A host MAY set `anonymous` on anon-authorized spans (public-surface dispatch); absent ⇒ unconstrained (today's behavior). |

### Node-level attributes

Set on spans scoped to a single node execution:

| Attribute              | Type   | Required | Notes                                                  |
| ---------------------- | ------ | -------- | ------------------------------------------------------ |
| `openwop.node_id`      | string | MUST     | Node ID within the workflow                            |
| `openwop.node_type`    | string | MUST     | Node typeId (e.g., `core.ai.callPrompt`)               |
| `openwop.node_attempt` | number | MUST     | Zero-based retry counter                               |
| `openwop.event_seq`    | number | SHOULD   | Sequence number of the most recent event for this node |

### Event-level attributes

Set on spans that emit a specific event:

| Attribute            | Type   | Required | Notes                                                    |
| -------------------- | ------ | -------- | -------------------------------------------------------- |
| `openwop.event_type` | string | MUST     | Event type (e.g., `node.completed`, `approval.received`) |
| `openwop.event_seq`  | number | MUST     | Sequence number assigned on append                       |

### HITL attributes

Set on spans involving human-in-the-loop suspensions:

| Attribute                 | Type   | Required | Notes                                                          |
| ------------------------- | ------ | -------- | -------------------------------------------------------------- |
| `openwop.interrupt_kind`  | string | MUST     | One of `approval`, `clarification`, `external-event`, `custom` |
| `openwop.interrupt_id`    | string | MUST     | Suspension ID                                                  |
| `openwop.interrupt_count` | number | SHOULD   | Per-(run, node) counter for replay determinism                 |

### Capability-limit attributes

Set on spans where a `CapabilityLimitExceededError` was thrown:

| Attribute              | Type   | Required | Notes                                                                                                                                                                              |
| ---------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openwop.cap_kind`     | string | MUST     | One of `clarification`, `schema`, `envelopes`, `node-executions`; `wasm-memory` / `wasm-fuel` / `wasm-execution-time` (RFC 0008 §K); `run-duration` / `loop-iterations` (RFC 0058) |
| `openwop.cap_limit`    | number | MUST     | The limit value                                                                                                                                                                    |
| `openwop.cap_observed` | number | MUST     | The observed value when the limit fired                                                                                                                                            |

### Replay / branch attributes

Set on the `openwop.run` span of a run created via `POST /v1/runs/{runId}:fork`:

| Attribute                      | Type   | Required | Notes                                                                             |
| ------------------------------ | ------ | -------- | --------------------------------------------------------------------------------- |
| `openwop.replay.source_run_id` | string | MUST     | RunId of the run this fork was derived from.                                      |
| `openwop.replay.from_seq`      | number | MUST     | Sequence number we forked at (inclusive — events `< from_seq` are fixed history). |
| `openwop.replay.mode`          | string | MUST     | `replay` (re-execute exactly) or `branch` (re-execute with `runOptionsOverlay`).  |

**Span linkage:** the forked run's `openwop.run` span MUST carry an OTel `Link` to the source run's `openwop.run` span (via the source's traceId + spanId). This is the OTel-canonical way to express "this new trace was derived from that other trace without a parent-child causal relationship" — replays are NOT causal children of the original (the user's `:fork` request causes them, not the original run). Trace viewers (Honeycomb, Tempo, Jaeger) render the Link natively.

Operators can answer questions like "show me all replay-mode forks of run X" or "show me runs that diverged at sequence > 100" by aggregating on the three `openwop.replay.*` attributes — no trace-graph query required.

### Privacy classification attributes (closes O5)

Set on spans / events / metric records carrying potentially sensitive data, so observability collectors can apply the deployer's policy (retention, masking, export gating) before forwarding to long-term storage.

| Attribute                  | Type     | Required | Notes                                                                                                                                                                                                                                                                            |
| -------------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openwop.pii_present`      | boolean  | SHOULD   | Computed aggregate. `true` when ANY input, output, variable, channel write, or activity payload on this span / event has a sensitivity marker (per `Privacy classification` §below). Servers SHOULD set on every span where the answer is determinable; MAY omit when uncertain. |
| `openwop.compliance_class` | string   | SHOULD   | Top-level workflow classification from `WorkflowMetadata.complianceClass`. One of `public`, `pii`, `phi`, `pci`, `regulated`. Single string per run — applies to ALL spans the run produces.                                                                                     |
| `openwop.sensitive_fields` | string[] | MAY      | Names of sensitive fields touched by this span (e.g., `["variables.userEmail", "channels.feedback"]`). Useful for fine-grained audit; high cardinality so collectors typically drop in aggregation.                                                                              |

**Aggregate computation rules** for `openwop.pii_present`:

- The engine MUST set `openwop.pii_present: true` on the `openwop.run` span when the workflow declares `metadata.complianceClass !== 'public'` OR any `variable.sensitive`, `channel.sensitive`, or pack-level `node.outputs[port].sensitive` is `true`.
- On `openwop.node.<typeId>` spans: `true` when the node consumes from OR writes to a sensitive variable / channel / output port.
- On `openwop.activity.<provider>` spans: `true` when the activity payload contains a sensitive field (e.g., a `userEmail` flowing into an LLM call).

**Compliance class semantics:**

| Class       | Meaning                                                                                     | Typical retention                                          |
| ----------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `public`    | No sensitivity; default. Trace data may be retained indefinitely.                           | Per deployer's standard policy.                            |
| `pii`       | Personal data per GDPR/CCPA scope (names, emails, behavioral data).                         | Shorter retention; right-to-erasure tooling MUST be aware. |
| `phi`       | Protected Health Information per HIPAA.                                                     | Encrypted at rest; access-logged.                          |
| `pci`       | Payment card data per PCI DSS.                                                              | Tokenized; raw values MUST NOT appear in observability.    |
| `regulated` | Other regulated categories the deployer manages (export-controlled, attorney-client, etc.). | Deployer-defined policy.                                   |

The spec doesn't enforce retention or storage rules — those are the deployer's collector / backend policy. The spec only guarantees the _signal_: a collector inspecting a span's attributes can route / mask / drop based on `openwop.pii_present` + `openwop.compliance_class` without parsing payload contents.

See "Privacy classification" §below in the main `Span attributes` series for the underlying field-marker layer.

### Sub-workflow attributes (closes O2)

Set on the `openwop.run` span of a child run started by a parent workflow's invoke-style node (sub-workflow dispatch, cross-canvas-invoke, etc.):

| Attribute                    | Type   | Required | Notes                                                            |
| ---------------------------- | ------ | -------- | ---------------------------------------------------------------- |
| `openwop.parent.run_id`      | string | MUST     | RunId of the parent run.                                         |
| `openwop.parent.workflow_id` | string | MUST     | WorkflowId of the parent run.                                    |
| `openwop.parent.node_id`     | string | MUST     | NodeId of the invoke node in the parent that spawned this child. |

**Span linkage: parent-child causal nesting.** The child run's `openwop.run` span MUST be set as a _child span_ of the parent's invoke-node `openwop.node.<typeId>` span (via OTel `parentSpanId`). Sub-workflow invocation IS causal — the parent's invoke-node spawns the child — so parent-child nesting is semantically correct AND is what operators want visually. Clicking the parent's invoke-node span in Honeycomb / Tempo / Jaeger drills into the child run, exactly like clicking a function call drills into the function body.

This contrasts with the replay/branch case above (Span Link, sibling-style) because replays are NOT causal children of the source run — the user's `:fork` request is the cause. For sub-workflows, the parent's invoke-node IS the cause.

**Propagation mechanism.** The parent engine emits the invoke-node span with `traceparent` set; when starting the child run (via REST `POST /v1/runs`, MCP `tools/call`, or A2A invoke), the parent MUST forward that `traceparent` to the child engine. The child engine's first span (`openwop.run`) MUST use the forwarded `traceparent` as its parent reference — the same W3C Trace Context propagation flow already specced in §Trace context propagation.

The child engine SHOULD also emit the three `openwop.parent.*` attributes alongside the parent reference — letting dashboards filter / aggregate ("show me all child runs spawned by workflow X" or "show me invoke-node failures by parent.node_id") without graph queries.

Cross-link with `channels-and-reducers.md` §Distributed reducers: a child run's `channel.written` events carry `sourceEngineId` + `sourceRunId` (from C2's cross-engine writes). When operators trace from a parent's `channel-write` trigger fire back to the child write that caused it, the trace's parent-child span structure makes the connection one click — no manual run-ID correlation required.

---

### Identity and delegation attributes (RFC 0154 §D)

> Additive (2026-08-16, RFC 0154 `Accepted`). All OPTIONAL, all **content-free**: every value is an opaque id, an enum, or an integer. `openwop.*` remains canonical; the GenAI projection below is a labelled, versioned, optional mapping that core conformance MUST NOT require.

Set on the `openwop.run` span (and MAY be repeated on `openwop.node` spans that make an authorization decision) when the request that started or acted on the run carried a workload identity (`auth.md` §"Workload identity and delegated actor chain"):

| Attribute                          | Type   | Required | Notes                                                                                                                                                                       |
| ---------------------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openwop.actor.principal`          | string | MAY      | Opaque RFC 0048 principal id of the **effective** actor. Never PII, never the presented `subject` unless the host genuinely uses it as its principal id.                      |
| `openwop.actor.on_behalf_of`       | string | MAY      | Opaque principal id from a **verified** delegation context's `onBehalfOf`. Absent when there is no delegation. Never caller-asserted.                                        |
| `openwop.identity.scheme`          | string | MAY      | `spiffe` \| `mtls-san` \| `cloud-subject` \| `oauth-client` — the closed set from `workload-identity.schema.json`.                                                       |
| `openwop.identity.issuer_class`    | string | MAY      | The *class* of issuer, never the issuer URL: `spiffe` \| `mtls` \| `cloud` \| `oauth` \| `oidc` \| `api-key` \| `anonymous`.                                          |
| `openwop.identity.sender_constraint` | string | MAY    | `mtls` \| `dpop` \| `none`. `none` is the bearer-fallback signal RFC 0154 §C requires to be distinguishable (`sender-constraint-no-bearer-downgrade`).                    |
| `openwop.delegation.depth`         | int    | MAY      | Number of hops in the verified chain; `0` when none. The chain itself is never an attribute.                                                                                 |
| `openwop.authz.audience_decision`  | string | MAY      | `match` \| `mismatch` \| `absent`.                                                                                                                                         |
| `openwop.authz.scope_decision`     | string | MAY      | `allow` \| `deny`. Mirrors `authorization.decided.allowed`.                                                                                                                 |
| `openwop.authz.correlation_id`     | string | MAY      | Host-minted correlation id linking the span to the `authorization.decided` audit fact. Not a trace id.                                                                        |

Rules: `openwop.actor.kind` (RFC 0132, run-level table above) continues to carry the principal's kind. Hosts **MUST NOT** put a raw `subject`, issuer URL, certificate fingerprint, token, proof, or `requestState`-style opaque blob into any of these; a hashed subject, if used for correlation, follows the salt/rotation rule in `auth.md` §D. These attributes describe an *authorization outcome*; a consumer **MUST NOT** treat their presence as authorization evidence — a span is a record, not a grant.

**Trace context across interop boundaries.** `traceparent` / `tracestate` (and `baggage`) propagate across A2A (`a2a-integration.md`), MCP (`mcp-integration.md` §D — the `_meta` keys are the only named MCP extension mapping), dispatch, compensation (`compensation.md`), and interrupt boundaries. They are correlation, **never** authorization evidence, and a host **MUST NOT** derive tenant, principal, or scope from them.

**GenAI semantic-convention projection (RFC 0154 §D, gap G3 / UQ4 — decided as v0, experimental).** The OpenTelemetry GenAI conventions moved to `open-telemetry/semantic-conventions-genai` and, as of 2026-08-16, the agent/tool attributes there carry **Development** stability with no tagged release; the core `semantic-conventions` repo (`v1.44.0`, 2026-08-04) no longer hosts them. Accordingly the first mapping is **v0, optional, and labelled experimental**: a host that emits it **MUST** also emit `openwop.otel.genai_mapping_version: "0"` and `openwop.otel.genai_semconv_ref: "open-telemetry/semantic-conventions-genai@<commit>"`, and core conformance **MUST NOT** require any `gen_ai.*` attribute.

| `openwop.*` (canonical)                                | `gen_ai.*` (v0 projection, Development stability)          | Rule                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `openwop.actor.principal` when `openwop.actor.kind = agent` | `gen_ai.agent.id`                                     | Opaque id only; MUST NOT be a name or a subject.                                            |
| the run's `agent.name` (RFC 0002 `AgentRef`)           | `gen_ai.agent.name`                                        | Only when the run has an `AgentRef`.                                                        |
| `openwop.workflow_id`                                  | `gen_ai.workflow.name`                                     | The workflow id, not a human title.                                                          |
| `openwop.run_id` for a `core.conversation` run         | `gen_ai.conversation.id`                                   | Only for conversation-model runs (RFC 0005).                                                 |

No identity, delegation, or authorization attribute is projected into `gen_ai.*` — the upstream vocabulary has no stable field for them, and inventing one would be exactly the experimental-attribute-as-requirement RFC 0154 §D forbids. Revisit when the GenAI repository tags a release with these fields at Stable.

## Canonical run lifecycle event names

An OpenWOP-compliant server emits run-lifecycle events through the event log (`GET /v1/runs/{runId}/events*`) and through structured logs / OTel spans. The wire-level event-type names form a closed vocabulary that external clients and SDKs can rely on:

| Event type                | When                                                                                                      | Default severity | Required                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `run.started`             | Run transitions from `pending` to `running`                                                               | `info`           | MUST                                                               |
| `run.completed`           | Run reaches terminal `completed`                                                                          | `info`           | MUST                                                               |
| `run.failed`              | Run reaches terminal `failed`                                                                             | `error`          | MUST                                                               |
| `run.cancelled`           | Run reaches terminal `cancelled`                                                                          | `info`           | MUST                                                               |
| `node.started`            | Node execution begins                                                                                     | `debug`          | SHOULD                                                             |
| `node.completed`          | Node execution succeeds                                                                                   | `debug`          | SHOULD                                                             |
| `node.failed`             | Node execution fails (terminal for the node)                                                              | `error`          | SHOULD                                                             |
| `node.cancelled`          | Node execution stops via cancel                                                                           | `info`           | SHOULD                                                             |
| `approval.requested`      | HITL approval gate opens                                                                                  | `info`           | SHOULD (if `openwop-interrupts`)                                   |
| `approval.received`       | HITL approval resolved                                                                                    | `info`           | SHOULD (if `openwop-interrupts`)                                   |
| `clarification.requested` | LLM emits a clarification envelope                                                                        | `info`           | SHOULD (if `openwop-interrupts`)                                   |
| `clarification.resolved`  | Client provides clarification answer                                                                      | `info`           | SHOULD (if `openwop-interrupts`)                                   |
| `cap.breached`            | Engine-enforced limit exceeded                                                                            | `error`          | SHOULD (if `maxNodeExecutions` enforced)                           |
| `channel.written`         | Channel write succeeds                                                                                    | `debug`          | SHOULD (if channels supported)                                     |
| `run.replay.started`      | Replay/fork is initiated                                                                                  | `info`           | SHOULD (if `openwop-replay`)                                       |
| `memory.compacted`        | A `MemoryAdapter` compaction run completes (RFC 0012)                                                     | `info`           | SHOULD (if `capabilities.memory.compaction.supported: true`)       |
| `memory.written`          | A run writes a memory entry; attributes it to the node/agent (identifiers only, never content) (RFC 0057) | `info`           | MUST (if `capabilities.memory.attribution.emitsWriteEvents: true`) |

**Severity vocabulary.** OpenWOP adopts the standard four-tier severity model: `debug` / `info` / `warn` / `error`. Severities are advisory — observability platforms apply their own escalation rules — but the defaults above let a downstream consumer treat unrecognized events with conservative severity policy.

**Closed vocabulary.** Hosts MUST NOT emit additional event types under the `run.`, `node.`, `approval.`, `clarification.`, `cap.`, `channel.`, or `replay.` prefixes without an RFC. Vendor-specific events are permitted under namespaced prefixes (e.g., `openwop.audit.*`) per `spec/v1/host-extensions.md`.

**Terminal events.** A run MUST emit exactly one of `run.completed` / `run.failed` / `run.cancelled` and that event MUST be the last event in the stream. The conformance scenario `eventOrdering.test.ts` pins this contract.

**Terminal status follows the terminal event (clarification, 2026-08-18).** A host **MUST NOT** report a terminal run status — `completed` / `failed` / `cancelled` on `GET /v1/runs/{runId}` or any snapshot projection — before the corresponding terminal event is durably appended to the run's event log. The rule above constrains order *within* the log; this one constrains the boundary *between* the status projection and the log, which is a separate guarantee a host can miss while satisfying the first.

The two are independent because most hosts write the status projection and the event log separately. A host that flips status first opens a window in which a consumer reads a terminal status, reads the log, and finds the terminal event absent — a run that looks finished and unfinished at once. Any consumer that waits on status and then reads the log depends on this, `eventOrdering.test.ts` among them: it polls status to terminal and *then* reads the log, so a host with that window fails the leg while satisfying the prose as previously written. Reported by a tier-2 host (MyndHyve) that carried the window for months; a later change that widened it past the wire is what made it observable.

This is a clarification of an already-load-bearing requirement, not a new constraint: the conformance floor has enforced it since `eventOrdering.test.ts` existed. It relaxes no `MUST`, changes no shape, and adds no capability — `COMPATIBILITY.md` §2.3 (the suite MUST NOT be stricter about wire shape than the spec defines) is the reason it is written down here rather than loosened there.

**Forward-compat.** Clients consuming the event stream MUST treat unknown event types as opaque and continue reading. Hosts MAY add new event types in v1.x if they're additive (no behavior change for clients that ignore the new type) per `COMPATIBILITY.md` §2.1.

---

## Span naming

An OpenWOP-compliant server SHOULD use these canonical span names. Implementations MAY use additional names outside the `openwop.*` prefix.

| Span name                       | When emitted                                                 | Parent                  |
| ------------------------------- | ------------------------------------------------------------ | ----------------------- |
| `openwop.run`                   | Top-level span for an entire run                             | none (or client trace)  |
| `openwop.node.<typeId>`         | Wraps a single node execution                                | `openwop.run`           |
| `openwop.node.<typeId>.attempt` | Wraps one retry attempt within a node                        | `openwop.node.<typeId>` |
| `openwop.event.append`          | Wraps `EventLog.appendAtomic`                                | nearest active span     |
| `openwop.interrupt`             | Wraps a HITL suspension (open until resumed)                 | `openwop.node.<typeId>` |
| `openwop.activity.<provider>`   | Wraps an external API call (e.g., `openwop.activity.openai`) | nearest active span     |

Span names with `<typeId>` substitute the actual node type — e.g., `openwop.node.core.ai.callPrompt`.

---

## Structured-log metric records (lightweight)

In addition to OTel metrics (defined in the next section), an OpenWOP-compliant server SHOULD emit structured-log records with the following `metricKind` field. These are the cheap-to-emit complement: logs-based, ingested by most observability platforms natively, useful for ad-hoc querying when a full metrics pipeline isn't deployed.

| `metricKind`                 | When                                                                              | Required fields                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `openwop.run.created`        | After successful `POST /v1/runs`                                                  | `runId`, `workflowId`, `tenantId?`                                                              |
| `openwop.run.completed`      | On terminal status (`completed`/`failed`/`cancelled`)                             | `runId`, `status`, `durationMs`                                                                 |
| `openwop.run.claim.conflict` | On `X-Dedup` 409 conflict                                                         | `transport`, `projectId`, `activeRunId`, `activeHost`, `retryAfterSeconds`                      |
| `openwop.node.completed`     | Per node completion                                                               | `runId`, `nodeId`, `nodeType`, `status`, `durationMs`, `attempt`                                |
| `openwop.activity.invoked`   | Per external API call                                                             | `runId`, `nodeId`, `provider`, `status`, `latencyMs`, `idempotencyHit?`                         |
| `openwop.cap.exceeded`       | When `CapabilityLimitExceededError` fires                                         | `runId`, `kind`, `limit`, `observed`                                                            |
| `openwop.cost.recorded`      | After every billable AI activity (closes O4; see "Cost attribution attributes" §) | `runId`, `nodeId`, `provider`, `tokensInput`, `tokensOutput`, `usd?`, `currency?`, `estimated?` |
| `openwop.mcp.invocation`     | Per MCP tool call                                                                 | `invocationId`, `tenantId`, `moduleId`, `uid?`, `status`, `errorCode?`, `latencyMs`             |

---

## OpenTelemetry metrics (full)

Format follows [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/general/attribute-naming/) style: each metric declares an `instrument`, `unit` (UCUM code), `description`, applicable `attributes`, recommended histogram boundaries (when applicable), and a `stability` tier.

An OpenWOP-compliant server SHOULD emit all `Stable` metrics. `Experimental` metrics MAY be emitted; consumers MUST tolerate their addition or removal in v1.x patch releases.

### Attribute cardinality conventions

The metric attribute tiers below reuse the canonical `openwop.*` span attributes from §Span attributes. Cardinality bounds:

| Attribute               | Cardinality                                                   | Use as metric attribute?                                                                                                             |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `openwop.run_id`        | UNBOUNDED (1 per run)                                         | NEVER. Use [exemplars](https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exemplars) to link metric points back to traces. |
| `openwop.workflow_id`   | Tenant-bounded (typically <100 per tenant)                    | Recommended.                                                                                                                         |
| `openwop.node_id`       | Workflow-bounded (typically <50 per workflow)                 | Opt-in — may explode at scale. Aggregations SHOULD prefer `openwop.node_type`.                                                       |
| `openwop.node_type`     | Pack-bounded (typically <50 globally; <500 with vendor packs) | Recommended.                                                                                                                         |
| `openwop.tenant_id`     | Platform-bounded (one per tenant)                             | Required for multi-tenant deployments. Consumers MAY drop at aggregation if cardinality budget is tight.                             |
| `openwop.scope_id`      | Tenant-bounded                                                | Opt-in.                                                                                                                              |
| `provider` (activities) | Bounded enum (`openai`, `anthropic`, `google`, …)             | Required for activity metrics.                                                                                                       |

### Run lifecycle metrics

#### `openwop.run.created`

| Field                    | Value                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument               | Counter                                                                                                                                              |
| Unit                     | `1` (count)                                                                                                                                          |
| Description              | Number of runs accepted by `POST /v1/runs`. Increments BEFORE the run begins executing — covers both runs that complete and runs that fail to start. |
| Attributes (Required)    | `openwop.workflow_id`, `openwop.tenant_id` (if multi-tenant)                                                                                         |
| Attributes (Recommended) | `openwop.scope_id`                                                                                                                                   |
| Stability                | Stable                                                                                                                                               |

#### `openwop.run.completed`

| Field                    | Value                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Instrument               | Counter                                                                                             |
| Unit                     | `1` (count)                                                                                         |
| Description              | Number of runs that reached a terminal status. Discriminate via the `openwop.run_status` attribute. |
| Attributes (Required)    | `openwop.run_status` (`completed` \| `failed` \| `cancelled`), `openwop.workflow_id`                |
| Attributes (Recommended) | `openwop.tenant_id`                                                                                 |
| Stability                | Stable                                                                                              |

#### `openwop.run.duration`

| Field                    | Value                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument               | Histogram                                                                                                                                                                                                              |
| Unit                     | `s` (seconds)                                                                                                                                                                                                          |
| Description              | Wall-clock duration from `POST /v1/runs` accept to terminal status. Includes time suspended on HITL interrupts — operators wanting "active execution time only" should pair with `openwop.node.duration` aggregations. |
| Attributes (Required)    | `openwop.run_status`, `openwop.workflow_id`                                                                                                                                                                            |
| Attributes (Recommended) | `openwop.tenant_id`                                                                                                                                                                                                    |
| Recommended buckets (s)  | `[0.5, 1, 2.5, 5, 10, 30, 60, 300, 600, 1800, 3600]` (0.5s — 1h)                                                                                                                                                       |
| Stability                | Stable                                                                                                                                                                                                                 |

#### `openwop.run.active`

| Field                    | Value                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument               | UpDownCounter                                                                                                                                       |
| Unit                     | `1` (count)                                                                                                                                         |
| Description              | Number of in-flight runs (status NOT in `completed`/`failed`/`cancelled`). Increments on `POST /v1/runs` accept; decrements on terminal transition. |
| Attributes (Required)    | `openwop.tenant_id` (if multi-tenant)                                                                                                               |
| Attributes (Recommended) | `openwop.workflow_id`                                                                                                                               |
| Stability                | Stable                                                                                                                                              |

### Node lifecycle metrics

#### `openwop.node.completed`

| Field                    | Value                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Instrument               | Counter                                                                                         |
| Unit                     | `1` (count)                                                                                     |
| Description              | Number of node executions that reached a terminal node status.                                  |
| Attributes (Required)    | `openwop.node_type`, `openwop.run_status` (`completed` \| `failed` \| `skipped` \| `cancelled`) |
| Attributes (Recommended) | `openwop.workflow_id`, `openwop.tenant_id`                                                      |
| Stability                | Stable                                                                                          |

#### `openwop.node.duration`

| Field                    | Value                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Instrument               | Histogram                                                                           |
| Unit                     | `s` (seconds)                                                                       |
| Description              | Per-node execution duration. Per-attempt (a node with 3 retries records 3 samples). |
| Attributes (Required)    | `openwop.node_type`, `openwop.run_status`                                           |
| Attributes (Recommended) | `openwop.node_attempt` (zero-based)                                                 |
| Recommended buckets (s)  | `[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60]` (1ms — 1min)               |
| Stability                | Stable                                                                              |

#### `openwop.node.attempts`

| Field                    | Value                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Instrument               | Counter                                                                                                                          |
| Unit                     | `1` (count)                                                                                                                      |
| Description              | Number of retry attempts on a node. Counts only attempts strictly after the first; a node that succeeds first try contributes 0. |
| Attributes (Required)    | `openwop.node_type`                                                                                                              |
| Attributes (Recommended) | `openwop.workflow_id`                                                                                                            |
| Stability                | Stable                                                                                                                           |

### Activity (external API call) metrics

#### `openwop.activity.invocations`

| Field                    | Value                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Instrument               | Counter                                                                                                             |
| Unit                     | `1` (count)                                                                                                         |
| Description              | Number of external API calls (LLM, payment, webhook). Discriminates by `provider`.                                  |
| Attributes (Required)    | `provider` (e.g., `openai`, `anthropic`, `google`), `openwop.run_status` (`success` \| `error` \| `idempotent_hit`) |
| Attributes (Recommended) | `openwop.node_type`                                                                                                 |
| Stability                | Stable                                                                                                              |

#### `openwop.activity.duration`

| Field                   | Value                                                                    |
| ----------------------- | ------------------------------------------------------------------------ |
| Instrument              | Histogram                                                                |
| Unit                    | `s` (seconds)                                                            |
| Description             | Wall-clock duration of a single external API call.                       |
| Attributes (Required)   | `provider`, `openwop.run_status`                                         |
| Recommended buckets (s) | `[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120]` (10ms — 2min) |
| Stability               | Stable                                                                   |

#### `openwop.activity.tokens`

| Field                    | Value                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Instrument               | Counter                                                                                                                         |
| Unit                     | `{token}` (UCUM custom unit; OTel-style annotated count)                                                                        |
| Description              | LLM tokens billed. Pairs with `observability.md` §Cost attribution attributes (O4) — same numbers, different aggregation level. |
| Attributes (Required)    | `provider`, `direction` (`input` \| `output`)                                                                                   |
| Attributes (Recommended) | `openwop.cost.estimated` (boolean — true when computed server-side rather than provider-returned)                               |
| Stability                | Stable                                                                                                                          |

### Capability-limit metrics

#### `openwop.cap.exceeded`

| Field                    | Value                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Instrument               | Counter                                                                                                                                                                              |
| Unit                     | `1` (count)                                                                                                                                                                          |
| Description              | Number of `CapabilityLimitExceededError` occurrences, broken down by limit kind. Useful for "are we tuning limits too tight?" SLOs.                                                  |
| Attributes (Required)    | `openwop.cap_kind` (`clarification` \| `schema` \| `envelopes` \| `node-executions` \| `wasm-memory` \| `wasm-fuel` \| `wasm-execution-time` \| `run-duration` \| `loop-iterations`) |
| Attributes (Recommended) | `openwop.workflow_id`, `openwop.node_type`                                                                                                                                           |
| Stability                | Stable                                                                                                                                                                               |

### Run-claim metrics

#### `openwop.run.claim.conflicts`

| Field                 | Value                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Instrument            | Counter                                                                                               |
| Unit                  | `1` (count)                                                                                           |
| Description           | Number of `X-Dedup: enforce` 409 conflicts. Useful for "are clients retrying too aggressively?" SLOs. |
| Attributes (Required) | `transport` (`rest` \| `mcp` \| `a2a`), `openwop.tenant_id`                                           |
| Stability             | Stable                                                                                                |

### HITL metrics

#### `openwop.interrupt.requested`

| Field                    | Value                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Instrument               | Counter                                                                                  |
| Unit                     | `1` (count)                                                                              |
| Description              | Number of HITL suspensions emitted.                                                      |
| Attributes (Required)    | `openwop.interrupt_kind` (`approval` \| `clarification` \| `external-event` \| `custom`) |
| Attributes (Recommended) | `openwop.workflow_id`, `openwop.node_type`                                               |
| Stability                | Stable                                                                                   |

#### `openwop.interrupt.duration`

| Field                   | Value                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Instrument              | Histogram                                                                                                                |
| Unit                    | `s` (seconds)                                                                                                            |
| Description             | Wall-clock time from suspension request to resolution (or timeout). Note the wide bucket range — HITL is slow by nature. |
| Attributes (Required)   | `openwop.interrupt_kind`, `openwop.run_status` (`resolved` \| `timeout` \| `cancelled`)                                  |
| Recommended buckets (s) | `[60, 300, 900, 1800, 3600, 14400, 86400, 604800]` (1min — 1week)                                                        |
| Stability               | Stable                                                                                                                   |

### Queue depth and backlog metrics

For hosts that surface their execution queue to OTel — REQUIRED for hosts claiming the `production` scale tier (see `scale-profiles.md`).

#### `openwop.queue.depth`

| Field                    | Value                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument               | Gauge                                                                                                                                    |
| Unit                     | runs                                                                                                                                     |
| Description              | Instantaneous count of runs in the host's pending/runnable queue (excludes `paused`, `waiting-*`, terminal runs). Sample at scrape time. |
| Attributes (Required)    | `openwop.tenant_id` (or sentinel `"all"` for aggregate)                                                                                  |
| Attributes (Recommended) | `openwop.queue_name` (host-defined; e.g., `"default"`, `"priority-high"`)                                                                |
| Stability                | Stable                                                                                                                                   |

#### `openwop.run.backlog`

| Field                 | Value                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument            | Histogram                                                                                                                                                                         |
| Unit                  | seconds                                                                                                                                                                           |
| Description           | Time between `run.created` and `run.started` (queue-wait duration). Captures backlog independent of `openwop.queue.depth` so dashboards see tail latency, not just average depth. |
| Attributes (Required) | `openwop.tenant_id`, `openwop.workflow_id`                                                                                                                                        |
| Recommended buckets   | `[0.05, 0.1, 0.5, 1, 5, 30, 60, 300, 1800]`                                                                                                                                       |
| Stability             | Stable                                                                                                                                                                            |

#### `openwop.queue.enqueued`

| Field                 | Value                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Instrument            | Counter (monotonic)                                                                                     |
| Unit                  | runs                                                                                                    |
| Description           | Cumulative count of runs enqueued. Pair with `openwop.run.completed` (existing) to compute drain ratio. |
| Attributes (Required) | `openwop.tenant_id`                                                                                     |
| Stability             | Stable                                                                                                  |

### Orchestrator decision metrics (RFC 0006)

Gated on `capabilities.orchestrator.supported: true`.

#### `openwop.orchestrator.decisions`

| Field                    | Value                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument               | Counter (monotonic)                                                                                                                                                                                                  |
| Unit                     | decisions                                                                                                                                                                                                            |
| Description              | Count of `runOrchestrator.decided` events emitted, partitioned by `decision.kind`. Lets operators see the orchestrator's behavior shape (mostly delegating, mostly asking the user, mostly terminating) at a glance. |
| Attributes (Required)    | `openwop.tenant_id`, `openwop.workflow_id`, `openwop.orchestrator.decision_kind` ∈ `{"next-worker","ask-user","terminate"}`                                                                                          |
| Attributes (Recommended) | `openwop.orchestrator.agent_id`                                                                                                                                                                                      |
| Stability                | Stable                                                                                                                                                                                                               |

#### `openwop.orchestrator.iterations`

| Field                 | Value                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Instrument            | Histogram                                                                                                                        |
| Unit                  | iterations                                                                                                                       |
| Description           | Per-run distribution of `runOrchestrator.decisionsTaken` at terminal. Operators use this to tune `iterationCap` per RFC 0006 §A. |
| Attributes (Required) | `openwop.tenant_id`, `openwop.workflow_id`                                                                                       |
| Recommended buckets   | `[1, 2, 5, 10, 25, 50, 100, 250]`                                                                                                |
| Stability             | Stable                                                                                                                           |

### Idempotency / cross-region metrics

Gated on `capabilities.idempotency.crossRegion ∈ {"reconciled-records","fenced-effects"}` (RFC 0150 §D; formerly `{"best-effort","strict"}`).

#### `openwop.idempotency.cross_region_conflicts_total`

| Field                 | Value                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument            | Counter (monotonic)                                                                                                                                         |
| Unit                  | conflicts                                                                                                                                                   |
| Description           | Count of cross-region idempotency conflicts resolved per `idempotency.md` §"Multi-region idempotency". A non-zero rate indicates partition-time divergence. |
| Attributes (Required) | `openwop.tenant_id`, `openwop.route`, `openwop.region_pair` (string id like `"us-east:eu-west"`)                                                            |
| Stability             | Stable                                                                                                                                                      |

#### `openwop.idempotency.partition_seconds`

| Field                 | Value                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Instrument            | Gauge                                                                                           |
| Unit                  | seconds                                                                                         |
| Description           | Estimated cache divergence in seconds. Operators alert when this exceeds the route's tolerance. |
| Attributes (Required) | `openwop.region_pair`                                                                           |
| Stability             | Stable                                                                                          |

#### `openwop.idempotency.reclaims_total`

| Field                 | Value                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument            | Counter (monotonic)                                                                                                                                                    |
| Unit                  | reclaims                                                                                                                                                               |
| Description           | RFC 0150 §A/§D — a pending idempotency lease was reclaimed after its owner failed to complete within the lease window. A rising rate is a stuck-owner or lease-too-short signal, not a duplicate-effect signal on its own. |
| Attributes (Required) | `openwop.tenant_id`, `openwop.route`                                                                                                                                   |
| Attributes (Optional) | `openwop.idempotency.scope` (`layer-1` \| `layer-2`)                                                                                                                  |
| Stability             | Experimental (RFC 0150 §F, added 2026-08-16)                                                                                                                           |

#### `openwop.idempotency.stale_fence_rejections_total`

| Field                 | Value                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument            | Counter (monotonic)                                                                                                                                                    |
| Unit                  | rejections                                                                                                                                                             |
| Description           | RFC 0150 §D `fenced-effects` — an effect was refused because the issuing owner's fence token was stale (a losing owner after a partition). Every increment is a duplicate effect that did NOT happen; a host under `reconciled-records` never emits it. |
| Attributes (Required) | `openwop.tenant_id`, `openwop.route`, `openwop.region_pair`                                                                                                             |
| Stability             | Experimental (RFC 0150 §F, added 2026-08-16)                                                                                                                           |

#### `openwop.replay.effect_suppressions_total`

| Field                 | Value                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument            | Counter (monotonic)                                                                                                                                                    |
| Unit                  | suppressions                                                                                                                                                           |
| Description           | RFC 0150 §C — a replay/fork used the recorded outcome of an effect instead of re-issuing it (`replay.md`, `sideEffectSuppression: recorded-outcome`). Emitted per suppressed effect; a host advertising `sideEffectSuppression: none` never emits it. |
| Attributes (Required) | `openwop.tenant_id`, `openwop.workflow_id`, `openwop.replay.mode` (`replay` \| `branch`)                                                                               |
| Stability             | Experimental (RFC 0150 §F, added 2026-08-16)                                                                                                                           |

**Attribute rule for all idempotency / effect-identity telemetry (RFC 0150 §F).** Spans, logs, and metric attributes MUST NOT carry the caller's idempotency key, the effect key, or request content — the key is caller-controlled and routinely embeds customer identifiers. A host MAY carry `openwop.idempotency.key_hash` (a **truncated keyed hash** — keyed with a host secret so it is not reversible by dictionary, truncated so it is not a stable global identifier); it MUST NOT carry the key. The same rule already governs the `redaction` attributes above and `SECURITY/threat-model-secret-leakage.md` SR-1.

### Cost attribution metrics

The cost-attribution metrics below pair with the `openwop.cost.*` attributes (see "Cost attribution attributes" §). Promoted from Experimental → Stable on 2026-04-27 alongside O4 closure.

#### `openwop.cost.usd`

| Field                    | Value                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Instrument               | Counter (monotonic)                                                                                                  |
| Unit                     | `USD`                                                                                                                |
| Description              | Cumulative cost in USD. Use only when the server can derive cost from a published rate card; omit rather than guess. |
| Attributes (Required)    | `provider`, `openwop.cost.estimated`                                                                                 |
| Attributes (Recommended) | `openwop.tenant_id`, `openwop.workflow_id`                                                                           |
| Stability                | Stable                                                                                                               |

---

## Privacy classification (closes O5)

The privacy classification surface gives workflow authors + NodeModule packs explicit ways to mark fields as sensitive. The engine reads those markers to compute the `openwop.pii_present` / `openwop.compliance_class` / `openwop.sensitive_fields` span attributes (defined in §Span attributes above) AND to apply masking when persisting events.

### Workflow-level: `metadata.complianceClass`

`WorkflowMetadata.complianceClass` declares the top-level sensitivity tier of the entire workflow:

```jsonc
{
  "metadata": {
    "complianceClass": "phi"   // 'public' (default) | 'pii' | 'phi' | 'pci' | 'regulated'
  }
}
```

This is the workflow-author's claim about what kind of data flows through. Sets `openwop.compliance_class` on every span the run produces. Persists with the workflow definition; reviewable at workflow-register time.

### Field-level markers

Three places authors can mark individual fields as sensitive:

**1. Workflow variables** — `WorkflowVariable.sensitive: boolean`:

```jsonc
{
  "variables": [
    { "name": "userEmail", "type": "string", "sensitive": true },
    { "name": "totalScore", "type": "number" }
  ]
}
```

When `true`, the engine masks the variable's value in persisted `variable.changed` events, `state.snapshot` projections, and the projected `RunSnapshot.variables` returned by `GET /v1/runs/{runId}`. Reads inside the workflow's NodeModule executors work normally — only persistence and external surfaces mask.

**2. Per-node output overrides** — `WorkflowNode.outputSensitivity`:

```jsonc
{
  "id": "ai-1",
  "typeId": "core.ai.callPrompt",
  "outputSensitivity": {
    "draftEmail": true,
    "tokensUsed": false
  }
}
```

When a normally-non-sensitive node receives sensitive data IN THIS WORKFLOW (e.g., a generic `core.ai.callPrompt` rendering a PHI-bearing prompt template), the workflow author marks specific output ports without changing the underlying NodeModule. Engine masks the marked output-port values in `node.completed` event payloads.

**3. Pack-level output declaration** — pack manifest `nodes[].outputs[<port>].sensitive: boolean`:

```jsonc
{
  "name": "vendor.acme.salesforce-tools",
  "nodes": [
    {
      "typeId": "vendor.acme.salesforce.upsert",
      "outputs": {
        "ssn": { "sensitive": true }
      }
    }
  ]
}
```

When a NodeModule ALWAYS handles sensitive data (a Salesforce upsert always touches PII), the pack author declares it once in the manifest. Workflows using this typeId inherit the markers automatically; `outputSensitivity` overrides at the workflow level if needed.

**4. Channel sensitivity** — `ChannelDeclaration.sensitive: boolean`:

```jsonc
{
  "channels": {
    "phiNotes": { "reducer": "feedback", "sensitive": true }
  }
}
```

When `true`, `channel.written` event payloads have their `value` field masked. The reduced channel state in `RunSnapshot.channels` is also masked when read via the REST surface.

### Masking behavior

The engine's masking mode is server policy, advertised via `Capabilities.compliance.defaultMode`:

| Mode             | Behavior                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `mask` (default) | Replace value with the literal string `"[REDACTED]"`.                                                      |
| `omit`           | Drop the field entirely from the persisted payload.                                                        |
| `hash`           | Replace with `"sha256:<hex>"` so audit trails can detect equality without revealing the value.             |
| `passthrough`    | Record values as-is. Use only when a downstream collector handles masking. NOT recommended for production. |

An OpenWOP-compliant server SHOULD:

1. Default to `mask` for any field marked sensitive.
2. Apply masking BEFORE the event reaches the durable event log (so leaks via the log itself are prevented).
3. Apply the same mode consistently within a single run (so replays produce identical event logs).

Servers MAY allow per-workflow overrides via `metadata.complianceConfig.maskingMode` — useful when a workflow needs hash-based audit but the server default is `mask`.

### Replay implications

Sensitive fields are NOT replay-deterministic by default — replays can't see the original values, so any execution path that branches on a masked field MAY diverge. Authors who need replay-deterministic sensitive data SHOULD:

- Use external secret storage (vault) and re-resolve during replay via a deterministic key.
- OR use `hash` masking mode (audit-only equality) instead of `mask` / `omit` (which lose information).

Replay tooling MUST surface a warning when a `:fork` operation re-executes from a sequence that depended on a masked field — the replay may produce different outputs than the original. The `replay.diverged` event (already in the RunEvent enum) is the structured signal.

### What this is NOT

- The spec does NOT enforce retention or storage rules — those are deployer's collector / backend policy.
- The spec does NOT detect PII automatically. Authors and pack maintainers MUST annotate fields. Auto-detection (regex-based, ML-based) is a vendor-pack feature, not a spec feature.
- The classification class enum is intentionally small (5 values). Industry-specific subdivisions (HIPAA's 18 PHI identifiers, GDPR's "special categories") are NOT modeled at the spec level — those are domain-specific extensions in `metadata.complianceConfig`.

---

## Reference implementation status (non-normative)

> **Non-normative.** This section describes how operators can bridge legacy or host-private attribute names into the canonical `openwop.*` namespace. It does NOT modify the canonical `openwop.*` requirement above. New implementations SHOULD emit `openwop.*` directly.

Deployments consuming traces from a legacy implementation that used dotted attribute names such as `openwop.workflow.id`, `openwop.run.id`, or `openwop.pauseRun.outcome` can apply a per-deployment OTel collector aliasing rule:

```yaml
# OTel collector config — alias host-private attributes to canonical openwop.*
processors:
  attributes/openwop_canonical:
    actions:
      - key: openwop.workflow_id
        from_attribute: openwop.workflow.id
        action: insert
      - key: openwop.run_id
        from_attribute: openwop.run.id
        action: insert
      # ... per-attribute mapping
```

Spec-compliant implementations MUST emit the canonical attributes directly; the aliasing pattern above is for migration only and is not normative.

## Vendor aliasing (out of scope)

Operators who deploy OpenWOP-compliant servers and also use commercial observability platforms (Datadog, Honeycomb, LangSmith, etc.) typically need to alias `openwop.*` attributes to vendor-specific taxonomies. **This is per-deployment configuration, NOT spec'd.** Recommended pattern:

- Run an [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) between the server and the vendor backend.
- Apply an `attributes` processor that copies/renames `openwop.*` to the vendor's namespace.

Example aliasing rule (collector config snippet):

```yaml
processors:
  attributes/aliasing:
    actions:
      - key: langgraph.thread_id
        from_attribute: openwop.run_id
        action: insert
      - key: langgraph.checkpoint_ns
        from_attribute: openwop.workflow_id
        action: insert
```

Spec compliance does NOT require any such mapping. A server that emits only `openwop.*` attributes is fully compliant; the operator chooses whether to bridge.

---

## Implementer guidance

An OpenWOP-compliant server SHOULD:

1. Use a single OTel SDK instance for the lifetime of the process.
2. Configure the OTel resource with `service.name` matching the implementation's published name (e.g., `@your-org/openwop-engine`).
3. Set `service.version` to the published implementation version.
4. Sample spans according to `OTEL_TRACES_SAMPLER` env conventions; default to `parentbased_traceidratio=0.1` (10% sampling).
5. Emit logs at `info` level for `openwop.*` `metricKind` records and `error` level for `CapabilityLimitExceededError` and unhandled failures.

An OpenWOP-compliant client (CLI, SDK) SHOULD:

1. Generate a `traceparent` for every command that issues a request.
2. Display the trace ID in error messages so operators can search backend traces.
3. Surface `openwop.run.claim.conflict` events as user-actionable retry prompts.

---

## Cost attribution attributes (closes O4)

For AI-driven activities (`core.ai.callPrompt`, `core.ai.generateFromPrompt`, `openwop.activity.<provider>` spans), servers SHOULD attach the following attributes when the underlying provider call returns billable usage info:

| Attribute                    | Type    | Required | Notes                                                                                                                                                      |
| ---------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openwop.cost.tokens.input`  | number  | SHOULD   | Input/prompt tokens billed.                                                                                                                                |
| `openwop.cost.tokens.output` | number  | SHOULD   | Output/completion tokens billed.                                                                                                                           |
| `openwop.cost.tokens.total`  | number  | MAY      | Convenience sum; consumers can compute themselves.                                                                                                         |
| `openwop.cost.usd`           | number  | MAY      | Estimated cost in USD. Servers SHOULD use a published rate card per model; if pricing is unavailable, omit rather than guess.                              |
| `openwop.cost.currency`      | string  | MAY      | ISO 4217 code when `openwop.cost.<currency>` is non-USD (default `usd`).                                                                                   |
| `openwop.cost.estimated`     | boolean | MAY      | True when the cost was server-side computed rather than returned by the provider.                                                                          |
| `openwop.cost.provider`      | string  | SHOULD   | Provider name for cost attribution roll-up (e.g., `openai`, `anthropic`, `google`). Same value as the provider in `openwop.activity.<provider>` span name. |

Aggregation guidance: dashboards SHOULD roll up `openwop.cost.tokens.*` and `openwop.cost.usd` by `openwop.workflow_id`, `openwop.tenant_id`, `openwop.scope_id`, and `openwop.cost.provider`. The dimension cardinality is bounded by tenant/project counts and the (small) provider list; safe for OTel histograms.

`metricKind` extension:

| `metricKind`            | When                             | Required fields                                                                                 |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `openwop.cost.recorded` | After every billable AI activity | `runId`, `nodeId`, `provider`, `tokensInput`, `tokensOutput`, `usd?`, `currency?`, `estimated?` |

Privacy: cost attributes MUST NOT include the prompt/response text (use `openwop.cost.tokens.*` for billable counts, never substring excerpts).

Allowlist enforcement: hosts that emit `openwop.cost.*` attributes onto OTel spans MUST route the emission through an allowlist sanitizer that drops any attribute name outside the canonical set enumerated in the table above (`openwop.cost.tokens.input`, `openwop.cost.tokens.output`, `openwop.cost.tokens.total`, `openwop.cost.usd`, `openwop.cost.currency`, `openwop.cost.estimated`, `openwop.cost.provider`). The sanitizer MUST also drop non-primitive values (objects, arrays, null, undefined, functions, symbols) — cost attributes are flat primitives. The intent is defense-in-depth: a buggy upstream that smuggles a credential-shaped value into an unfamiliar key name (e.g., `openwop.cost.leaked_token`) MUST NOT see that value reach observability. Enforced by `SECURITY/invariants.yaml` row `cost-attribution-allowlist-redaction` + the public `cost-attribution.test.ts` conformance scenario.

---

## Provider usage events (RFC 0026)

The OTel `openwop.cost.*` attribute group above is the observability sibling; the durable event-log sibling is the `provider.usage` event type added by [RFC 0026](../../RFCS/0026-provider-usage-event.md). Hosts that advertise `capabilities.providerUsage.supported: true` MUST emit exactly ONE `provider.usage` event per LLM provider invocation, BEFORE the corresponding `node.completed`. The event carries required `{provider, model, inputTokens, outputTokens}` plus optional `{totalTokens, costEstimateUsd, currency, cacheHit, nodeId, traceId}`. Hosts that don't advertise the capability omit the event entirely; old consumers that ignore unknown event types are unaffected per `COMPATIBILITY.md §2.1`.

The event is REPLAY-DETERMINISTIC for `inputTokens` + `outputTokens` (drawn from the cached provider response on replay); `costEstimateUsd` MAY be omitted on replay even when the original emission included it, since the host's rate table may have changed between runs. The OTel projection (§"Cost attribution attributes" above) is RECOMMENDED but NOT REQUIRED — hosts MAY emit only the event when they don't run an OTel exporter.

The payload MUST NOT carry credentialRefs, hashed credential identifiers, or prompt/response substrings — same redaction posture as the OTel attributes per `SECURITY/threat-model-secret-leakage.md §SR-1`. Enforced by `SECURITY/invariants.yaml` row `provider-usage-no-credential-leak`.

---

## Envelope-reliability events (RFC 0032)

Six cross-kind operational `RunEventType` entries standardizing the protocol vocabulary for envelope-emission reliability behavior — retry attempts, retry exhaustion, refusals, truncations, NL-to-Format fallback engagement, and lenient-parsing recovery. Defined in [RFC 0032](../../RFCS/0032-envelope-reliability-events.md); see `ai-envelope.md` §"Envelope-reliability events" for the normative spec.

Hosts that advertise `capabilities.envelopes.reliability.supported: true` MUST emit `envelope.retry.exhausted` and `envelope.refusal` (the two MUST-tier events). The other four (`envelope.retry.attempted`, `envelope.truncated`, `envelope.nlToFormat.engaged`, `envelope.recovery.applied`) are SHOULD/MAY-tier and listed in `events[]` only when the host actually emits them.

### OTel projection (RECOMMENDED)

Hosts SHOULD project the events into the existing OTel attribute group on the envelope-emitting node's span:

| Event                         | OTel attribute group                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `envelope.retry.attempted`    | `openwop.envelope.retry.attempt` (integer) + `openwop.envelope.retry.reason` (string)                                                                          |
| `envelope.retry.exhausted`    | `openwop.envelope.retry.total_attempts` + `openwop.envelope.retry.final_reason`                                                                                |
| `envelope.refusal`            | `openwop.envelope.refusal.safety_category` (string, when present). **`refusalText` is omitted from OTel by default** — see §"Trust boundary + redaction" below |
| `envelope.truncated`          | `openwop.envelope.truncated.stop_reason` + `openwop.envelope.truncated.output_token_count`                                                                     |
| `envelope.nlToFormat.engaged` | `openwop.envelope.nl_to_format.fallback_calls`                                                                                                                 |
| `envelope.recovery.applied`   | `openwop.envelope.recovery.path` + `openwop.envelope.recovery.byte_offset` (when present)                                                                      |

The event log is the load-bearing surface (for replay determinism + webhook subscribers); the OTel projection is supplementary. Hosts that don't run an OTel exporter MAY emit only the events.

### Trust boundary + redaction

Event payloads that carry diagnostic strings (`previousError`, `finalError`, `refusalText`) MUST be passed through the same SR-1 redaction harness applied to envelope payloads per `ai-envelope.md` §"Redaction (SR-1 carry-forward)". The `envelope.refusal.refusalText` field is particularly load-bearing — provider safety-refusal messages can echo offending prompt content. The OTel projection of `envelope.refusal` omits `refusalText` by default; operators who want refusal text in dashboards plumb it through their own pipeline where they own the redaction policy.

SECURITY invariants `envelope-refusal-no-prompt-leak` (high severity) and `envelope-recovery-no-content-leak` (high severity) enforce this discipline (gate timing: lands with reference-host implementation, per the RFC 0027 §G staging precedent).

---

## Envelope-completion retry routing (RFC 0033)

Companion to the envelope-reliability event vocabulary above. [RFC 0033](../../RFCS/0033-envelope-completion-contract.md) normates the retry-routing semantics — specifically the **truncation-vs-schema-violation** distinction that hosts that advertise `capabilities.envelopes.reliability.completion.distinguishesTruncation: true` MUST honor:

- **Truncation** (`stop_reason: max_tokens` or equivalent) → retry with INCREASED output budget (RECOMMENDED 2× multiplier, configurable via `capabilities.envelopes.reliability.completion.truncationBudgetMultiplier`); MUST NOT include a corrective schema fragment in the retry's system prompt.
- **Schema violation** (clean stop + payload doesn't validate) → retry with corrective system fragment describing the validator's failure; MUST NOT increase the output budget.

Both paths count against `capabilities.limits.schemaRounds`. Exhaustion in the truncation path emits `envelope.retry.exhausted { finalReason: "truncation" }` + `cap.breached { kind: "schema" }` + node fails with error code `envelope_truncation_unrecoverable`. Exhaustion in the schema-violation path emits `envelope.retry.exhausted { finalReason: "schema-violation" }` + `cap.breached` + node fails with `envelope_invalid` (renamed from `envelope_payload_invalid` per the 2026-05-21 RFC adoption-feedback amendment). Refusal path (RFC 0032 §B.3) is terminal — NO retry — and fails with `envelope_refusal` (renamed from `envelope_refused_by_provider`).

See `spec/v1/rest-endpoints.md` §"Common error codes" for the two new codes; `ai-envelope.md` §"Envelope-completion criteria" for the normative completion criteria.

---

## OTel collector test seam (RFC 0034)

Per [RFC 0034](../../RFCS/0034-otel-collector-test-seam.md) (`Active` 2026-05-21).

Cross-host conformance scenarios need an introspection endpoint to verify that BYOK canaries do not leak into OTel span attributes or debug-bundle exports. The two protocol-tier SECURITY invariants `secret-leakage-otel-attribute` and `secret-leakage-debug-bundle-otel` (SECURITY/invariants.yaml) graduate from `reference-impl` to `protocol` tier on the strength of this test seam.

The seams live under the `host-extensions.md` §"Canonical prefixes" namespace `/v1/host/sample/test/*` and are NOT part of the v1 wire surface. Production hosts SHOULD return 404 or 403 from the seam unless an env-gate (e.g., `OPENWOP_TEST_OTEL_SCRAPE=true`) is set.

### `GET /v1/host/sample/test/otel/spans?runId=<id>`

When `capabilities.observability.testSeams.otelScrape: true`, the host MUST return `200 OK` with body `{ spans: Array<{ name, attributes, events }> }`. The spans array MUST include every OTel span produced by the host's instrumentation for the named run, including any `openwop.*`-prefixed attributes added to span context. Hosts MAY redact span content using the canonical `[REDACTED:<secretId>]` marker per `agent-memory.md` §"SR-1 secret-redaction invariant" — that's the contract being tested.

### `POST /v1/host/sample/test/debug-bundle/export`

When `capabilities.observability.testSeams.debugBundleExport: true`, the host MUST return `200 OK` with the same payload shape as `GET /v1/runs/{runId}/debug-bundle` per `spec/v1/debug-bundle.md`. The seam exists to give conformance scenarios a synchronous endpoint they can hit without first triggering an interrupt → debug bundle workflow.

### Capability advertisement (normative)

Hosts that implement either seam advertise it under `/.well-known/openwop`:

```jsonc
{
  "observability": {
    "testSeams": {
      "otelScrape": true,
      "debugBundleExport": true
    }
  }
}
```

A host that advertises `testSeams.otelScrape: true` but returns 404 / 5xx from the seam is non-conformant. Hosts that do NOT implement the seam MUST omit the field (or set it to `false`); conformance scenarios skip cleanly when the capability is absent.

## Quality signals (RFC 0056)

Observability above covers _what an agent did_; **annotations** cover _whether a human (or a supervisor agent) judged it good_. RFC 0056 defines a non-blocking quality signal — rating / correction / label / flag — attached to a run, event, or node, recorded via `POST /v1/runs/{runId}/annotations` and surfaced live via the `run.annotated` SSE notification.

Annotations are a **per-run side-resource**, NOT entries in the replayable run event log (so they never enter fork/replay; see `replay.md`). A host that advertises `capabilities.feedback.supported: true` MUST:

- record annotations tenant-scoped — an annotation is visible only within its run's tenant (SECURITY invariant `annotation-cross-tenant-isolation`);
- redact secret-shaped material in `signal.correction` and `note` before persistence, listing, and export, per SR-1 (SECURITY invariant `annotation-content-redaction`);
- audit-log each recording with the acting principal (`auth.md`).

Consumers derive quality metrics (correction rate, mean rating, flag rate) from this surface; they complement — but are distinct from — the `openwop.*` telemetry spans/metrics above. See [`RFCS/0056`](../../RFCS/0056-run-feedback-and-annotation-event.md).

## Open spec gaps

> **Absorbed into `spec/v1/gaps.json` (RFC 0174 §E.3, 2026-09-03).** The 5 row(s) this table carried are now `openwop.gap.spec.observability.<local>` entries with a disposition and a witness class, one namespace with every RFC register (RFC 0166 §B). The table is retired; do not add rows here.

## References

- `auth.md` — auth model + status legend
- `rest-endpoints.md` — endpoint catalog (canonical `traceparent`/`tracestate` headers)
- `idempotency.md` — `openwop.activity.invoked.idempotencyHit?` field
- `capabilities.md` — `CapabilityLimitExceededError` shape (powering `openwop.cap.exceeded`)
- W3C Trace Context: <https://www.w3.org/TR/trace-context/>
- OpenTelemetry semantic conventions: <https://opentelemetry.io/docs/specs/semconv/>
- `schemas/debug-bundle.schema.json` — portable diagnostic export shape
