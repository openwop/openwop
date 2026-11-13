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
