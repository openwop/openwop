# RFC 0262: The `telemetry` family — OTLP export and the OTel GenAI mapping at v2

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0262                                                            |
| **Title**         | The `telemetry` family: a v2 claim that a host exports OTLP traces, with an optional OTel GenAI semantic-conventions mapping |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-11-13                                                      |
| **Updated**       | 2026-11-13 — filed directly as **`Active`, comment window waived by the maintainer** (decision recorded 2026-11-13: "waived", for the Phase 2 RFCs of the protocol-gap program). §E adds a SECURITY invariant (spans MUST NOT carry secrets), a secrets rule, so this is a STEWARD OVERRIDE of RFC 0147 §A.6, recorded in `MAINTAINERS.md`. Lands the `telemetry` family row, `spec/v2/facets/telemetry.schema.json`, `spec/v2/core/telemetry.md`, the invariant row and `v2-telemetry-export` (6 ids). Closes assessment finding P-020 (August 2026) once a host's certified bundle records the legs. |
| **Affects**       | `spec/v2/declaration.json` (new core family `telemetry`; `schemas/v2/capabilities.schema.json` and `spec/v2/profiles.json` regenerated) · `spec/v2/facets/telemetry.schema.json` (new) · `spec/v2/core/telemetry.md` (new core doc, the family's normative home) · `spec/v2/core/conformance.md` (the one SHOULD on `openwop.*` spans points here) · the `observability` metadata description (names `telemetry` as the v2 claim) · `SECURITY/invariants.yaml` (one row) · conformance: new scenario `v2-telemetry-export.test.ts` · CHANGELOG. v1 (`spec/v1/observability.md`) is frozen and not touched. |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.4: a new optional core family. A host that does not advertise it is unaffected; the `observability` metadata key keeps its shape. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

v2 has no observability document. The core says only that a host SHOULD export `openwop.*` spans (`conformance.md`), the `gen_ai.*` mapping lives in the frozen v1 tree, and the v2 `observability` metadata describes itself as "optional v1 hints". No v2 host has a witnessed OTLP export. This RFC adds a core family, `telemetry`, whose presence is the claim that the host exports OTLP traces. When advertised, the host MUST emit one span per run and per node execution under fixed names and attributes, continue an inbound `traceparent`, and keep secrets out of every span. An optional facet, `genAiSemconv`, names the OTel GenAI semantic-conventions version the host maps model calls to. The suite's existing OTLP collector witnesses each rule.

## Motivation

- **Finding P-020** (August 2026 assessment, still open on 13 November): "v2 has no observability document; the `gen_ai.*` mapping exists only in the frozen v1 tree."
- **The v2 export path is unwitnessed** (`docs/KNOWN-LIMITS.md`). The OTel span, export and canary legs (`otel-emission`, `otel-trace-propagation`, `secret-leakage-otel-attribute`, `otel-collector-canary-inspection`) are registered at major 1 only. At major 2 the trace-context rows on the production host's bundle are `inapplicable`.
- **A metadata key cannot carry a claim.** `observability` is `kind: metadata` in `spec/v2/declaration.json`. Metadata has no witness class and binds nothing, so a host can advertise it and emit nothing. A family record is a claim, and a claim binds its rules (`capabilities.md` §2, `security-defaults.md` §"The rule").
- **Operators expect OTLP.** Every durable-execution product in the rubric's benchmark set exports OpenTelemetry. A protocol that standardises execution but not its trace shape leaves cross-host debugging to each vendor.

## Proposal

### §A The family

`telemetry` is a core family (`anchor: core`), homed in a new core document `spec/v2/core/telemetry.md`. Its record is a v2 capability record (`status`, `since`, `witness`, …) with two facets (`spec/v2/facets/telemetry.schema.json`):

- `otlp` — REQUIRED. `{ protocols: [...] }`, a non-empty array of the OTLP transports the host can export over: `"http/protobuf"`, `"http/json"`, `"grpc"`.
- `genAiSemconv` — OPTIONAL. A string naming the OpenTelemetry GenAI semantic-conventions version the host maps model calls to (for example `"1.37.0"`), pattern `^\d+\.\d+\.\d+$`.

### §B Export

A host advertising `telemetry`:

1. MUST export OTLP traces to the endpoint the operator configures through the standard OpenTelemetry exporter configuration (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, and the per-signal variants), over a transport it lists in `otlp.protocols`.
2. MUST emit, for every run, a span named `openwop.run` (or `openwop.run.<phase>`) carrying `openwop.run_id` and `openwop.workflow_id`.
3. MUST emit, for every node execution, a span named `openwop.node.<typeId>` carrying `openwop.run_id`, `openwop.node_id`, `openwop.node_type` and `openwop.node_attempt` (a non-negative integer, the zero-based retry counter).
4. MUST, when `createRun` carries a valid W3C `traceparent`, emit that run's spans in the inbound trace (same `traceId`).
5. SHOULD export the run and node metrics the v1 vocabulary names. Metrics are not part of the claim.

Names and attributes are the ones `spec/v1/observability.md` already defines, so a host that met v1's vocabulary changes nothing. A host MAY emit further spans and attributes outside `openwop.*`.

### §C The GenAI mapping

A host advertising `telemetry.genAiSemconv` MUST put, on the span for each model call a node makes, the `gen_ai.*` attributes that version defines for a chat or completion call. At minimum these are `gen_ai.operation.name`, the provider attribute that version names (`gen_ai.provider.name`, or `gen_ai.system` in versions before it), `gen_ai.request.model`, `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`. A host that does not advertise the facet makes no GenAI claim. The mapping is optional because the conventions are still marked experimental upstream: core correctness never depends on them.

### §D Proposed core text

`spec/v2/core/telemetry.md`, the family's normative home (the integrator lands this text verbatim or tighter):

```markdown
# Telemetry

> **Status: Experimental.**
> **Normative home:** `telemetry`.

## Why this exists

An operator debugging a run needs its trace in their own OpenTelemetry backend. The `telemetry` family is the claim that a host exports one.

## Export

A host advertising `telemetry` MUST export OTLP traces to the endpoint the operator configures with the standard `OTEL_EXPORTER_OTLP_*` settings, over a transport listed in `otlp.protocols`.

- Every run MUST produce a span named `openwop.run` carrying `openwop.run_id` and `openwop.workflow_id`.
- Every node execution MUST produce a span named `openwop.node.<typeId>` carrying `openwop.run_id`, `openwop.node_id`, `openwop.node_type` and `openwop.node_attempt`.
- A run created with a valid W3C `traceparent` MUST emit its spans in that trace.
- A span name, attribute, event or resource attribute MUST NOT carry credential material or a resolved secret ([host-services.md](host-services.md) §`secrets`).
- Metrics SHOULD be exported; they are not part of the claim.

## GenAI mapping

With `genAiSemconv`, each model-call span MUST carry the `gen_ai.*` attributes that version defines for a chat call: operation name, provider, request model and input and output token usage.

*Sources: RFC 0262.*
```

The text is about 175 words. Homing a new core family raises the core budget's cap by 200 words (`scripts/check-core-budget.mjs`), so it pays for itself.

### §E Secrets in telemetry

A host advertising `telemetry` MUST NOT put credential material or a resolved secret in any span name, span attribute, span event, link or resource attribute it exports. This is the export-side instance of `host-services.md` §`secrets` ("Raw key material MUST NOT appear in any … trace"), restated here only as the falsifiable obligation the family binds. It gets a protocol-tier row in `SECURITY/invariants.yaml` (`telemetry-export-no-secret`), whose test is the leg below.

### §F The `observability` metadata

`observability` stays a metadata key with its current shape. Its description changes to say that the `telemetry` family is the v2 claim and that `observability` carries no obligation. Whether to delete it at v3 is Unresolved question 1.

## Compatibility

- **Additive.** A new optional core family and a new optional facet file. No existing field, event, endpoint, error code or MUST changes. A closed v2 discovery root gains one optional property, `telemetry` (`COMPATIBILITY.md` §2.4).
- **Hosts that emit v1 spans** already meet §B.2–§B.3 by name and attribute, so advertising the family costs them nothing beyond §B.4 and §E.
- **Consumers** that validate discovery against an older pinned v2 schema reject a document carrying `telemetry`; consumers pin, as with every additive family.
- **Replay and fork.** No event-log shape changes. A replay fork is a new run and emits its own spans; this RFC says nothing about the trace a fork belongs to (Unresolved question 3).

## Security considerations

- **Secrets in spans** are the main risk, and §E makes the rule falsifiable on the export path rather than the host's own scrape seam.
- **Tenant data in a shared collector.** Run and workflow ids are tenant-bound (`identity.md`), and an operator's collector may serve several tenants. This RFC does not add `openwop.tenant_id` to the MUST set (v1 has it as a MAY); an operator that needs tenant separation routes by resource attributes it controls.
- **Inbound `traceparent`** is caller-controlled. Continuing a trace grants no authority. A host MAY start a new trace for a caller it does not trust and link the inbound context instead; §B.4 then fails for that caller, so such a host does not advertise the family to it. This is Unresolved question 2.

## Conformance

`conformance/src/scenarios/v2-telemetry-export.test.ts`, target major 2. Every host leg is gated on the `telemetry` family record and on the suite's OTLP collector (`OPENWOP_OTEL_COLLECTOR=true`, with the host's exporter pointed at it). It is a host-callback scenario (`REQUIRES_HOST_CALLBACK`): a host in a separate network namespace records `blocked`, not a failure.

1. `0262.shape` — server-free: the facet schema accepts `{otlp:{protocols:["http/protobuf"]}}` and a semver `genAiSemconv`, and refuses an empty `protocols`, an unknown transport and a non-semver version.
2. `0262.run-span` — a `conformance-noop` run produces an `openwop.run` span carrying its `openwop.run_id` and `openwop.workflow_id`.
3. `0262.node-span` — the same run produces an `openwop.node.<typeId>` span carrying `openwop.node_id`, `openwop.node_type` and a non-negative `openwop.node_attempt`.
4. `0262.traceparent-continued` — a run created with a suite-minted `traceparent` emits its spans under that `traceId`.
5. `0262.no-secret-in-spans` — after an `openwop-smoke-byok-roundtrip` run (gated on that fixture), no captured span name, attribute or resource attribute carries the store canary. The scan uses the surfaced digest detector (`lib/secret-scan.ts`) and, when the operator supplies it, the plaintext. A run that captured no span for the run records `blocked`: an empty export cannot pass a leak check.
6. `0262.gen-ai-attributes` — gated on `genAiSemconv` and the `conformance-callai-attempt-accounting` fixture. The model-call span carries `gen_ai.operation.name`, a provider attribute, `gen_ai.request.model` and both usage-token attributes.

Every host leg records `blocked`, not a pass, when the collector captured no span for the run, so a host that advertises the family and exports nothing fails to certify.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A facet shape | schema validation of the `telemetry` facet — `openwop.requirement.0262.shape` | the suite, unaided (server-free) | witnessable — unaided |
| §B.1–§B.2 run span exported | an `openwop.run` span with the run's id at the suite's collector — `openwop.requirement.0262.run-span` | the suite (one `conformance-noop` run) | witnessable — gated (family + collector) |
| §B.3 node span exported | an `openwop.node.<typeId>` span with the four attributes — `openwop.requirement.0262.node-span` | the suite (the same run) | witnessable — gated (family + collector) |
| §B.4 inbound trace continued | the run's spans carry the suite-minted `traceId` — `openwop.requirement.0262.traceparent-continued` | the suite (`createRun` with `traceparent`) | witnessable — gated (family + collector) |
| §E no secret in exported spans | the canary absent from every captured span surface — `openwop.requirement.0262.no-secret-in-spans` | the suite (one BYOK roundtrip run) | witnessable — gated (family + collector + fixture) |
| §C GenAI attributes | the model-call span's `gen_ai.*` attributes — `openwop.requirement.0262.gen-ai-attributes` | the suite (one mock-provider `ctx.callAI` run) | witnessable — gated (facet + collector + fixture) |
| §B.1 configured endpoint honoured | — | the operator, at host boot | claims-check — the suite cannot set a host's environment; legs 2–6 show it was honoured for the suite's collector |

## Alternatives considered

1. **Turn the `observability` metadata into a family.** Rejected: a family record carries `status`, `since` and `witness`. Re-shaping an existing root key would break every v2 discovery document that carries it today, which is breaking under `COMPATIBILITY.md` §2.4.
2. **Leave telemetry a SHOULD in `conformance.md`.** Rejected: a SHOULD binds nothing and the v2 export path stays unwitnessed (P-020).
3. **Make the GenAI mapping part of the base claim.** Rejected: the upstream conventions are experimental and renamed attributes between versions (`gen_ai.system` → `gen_ai.provider.name`). Pinning the version in a facet lets a host claim exactly what it maps.
4. **Witness through a host scrape seam** (v1's `GET /v1/host/sample/test/otel/spans`). Rejected: a seam shows what the host says it emitted, not what reached a collector. The suite already owns an OTLP receiver (`lib/otel-collector.ts`, HTTP/JSON, HTTP/protobuf and gRPC).

## Unresolved questions

1. Delete the `observability` metadata at v3, or keep it as hints? It carries no obligation after §F.
2. A host that does not continue an untrusted caller's `traceparent` (§Security): add a facet member `traceparent: "continue" | "link"`, or leave §B.4 unconditional?
3. Should a replay fork's spans link to the source run's trace?
4. Should metrics join the claim once a v2 metric vocabulary exists?

## Implementation notes (non-normative)

- openwop-app already registers a MeterProvider and exports traces in production; advertising the family needs §B.4 and the span names checked against its exporter.
- The v2 reference host (`openwop/openwop-examples`) needs an OTLP exporter; node:http plus the OTLP/HTTP-JSON encoding is enough for §B.
- The production certify run needs the host's exporter pointed at the suite's collector, which is the same host-callback pattern as the webhook receiver (a public front for a deployed host).

## Acceptance criteria

- [x] Comment window run (`Draft → Active`; RFC 0147 §A.6). *(Waived by the maintainer, 2026-11-13.)*
- [ ] Family row, facet schema and `spec/v2/core/telemetry.md` merged; capabilities schema and profiles regenerated.
- [ ] `SECURITY/invariants.yaml` row `telemetry-export-no-secret` with `v2-telemetry-export.test.ts` as its test.
- [ ] `v2-telemetry-export.test.ts` in a published suite.
- [ ] CHANGELOG entry.
- [ ] A certified host bundle records `0262.run-span`, `0262.node-span`, `0262.traceparent-continued` and `0262.no-secret-in-spans` `executed-pass` (and `0262.gen-ai-attributes` if the host advertises `genAiSemconv`), each with a sabotage record that ran red.
- [ ] Register sweep (`RFCS/registers/0262-*.gaps.md`, `.risks.md`).

## References

- `spec/v1/observability.md` (frozen): span names, run- and node-level attributes, the GenAI mapping table.
- `spec/v2/core/conformance.md` (the SHOULD this replaces as the v2 claim), `host-services.md` §`secrets`, `security-defaults.md` §"The rule".
- `docs/KNOWN-LIMITS.md` §"Shape-only conformance coverage" (OTel legs major 1 only).
- `conformance/src/lib/otel-collector.ts`, `otlp-protobuf.ts`, `trace-context.ts`, `secret-scan.ts`.
- OpenTelemetry Protocol (OTLP) specification; OpenTelemetry semantic conventions for generative AI systems; W3C Trace Context.
- August 2026 OpenWOP assessment, finding P-020.
