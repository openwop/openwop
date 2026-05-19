# RFC 0026: `provider.usage` Event

| Field | Value |
|---|---|
| **RFC** | 0026 |
| **Title** | `provider.usage` event — per-call durable usage record for LLM provider invocations |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-19 |
| **Updated** | 2026-05-19 |
| **Affects** | `schemas/run-event.schema.json`, `schemas/run-event-payloads.schema.json`, `schemas/capabilities.schema.json`, `api/asyncapi.yaml`, `spec/v1/observability.md` §"Provider usage events", `conformance/src/scenarios/provider-usage.test.ts`, `apps/workflow-engine/`, `CHANGELOG.md` |
| **Compatibility** | `additive` per `COMPATIBILITY.md §2.1` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Adds a new optional event type `provider.usage` that hosts MUST emit after every LLM provider invocation, carrying per-call token counts plus optional cost-estimate fields. Pairs with the existing `openwop.cost.*` OTel attribute group (anticipated by `docs/PROTOCOL-GAP-CLOSURE-PLAN.md:265`, landed for O4) but lives in the durable run event log — so replay reads it back deterministically, webhook subscribers receive it live, and external billing reconciliation has a fine-grained audit trail. Old consumers ignore the new event type per `COMPATIBILITY.md §2.1` forward-compat; hosts that don't emit it advertise nothing.

## Motivation

`spec/v1/observability.md` already specifies three cost-related surfaces:

1. `RunSnapshot.metrics.openwopCost` — coarse rollup at the run's terminal state. One value per run; loses node/turn-level granularity.
2. OTel span attributes `openwop.cost.tokens.*` + `openwop.cost.usd` — fine-grained, but observability-only. Not durably persisted; replay can't reconstruct them; webhook subscribers don't see them.
3. `ctx.recordCost()` — in-node helper that writes to (1) and feeds (2). Doesn't itself emit an event.

Three load-bearing use cases the existing surface doesn't cover:

- **Per-call replay determinism.** `replay.md §"LLM cache-key recipe"` (FINAL) lets replay deduplicate the same provider call. But there's no event-log record of the usage that resulted — replay can reconstruct the cache hit but not the cost. Per-run rollup loses the per-call shape.
- **Live cost dashboards.** SSE / webhook subscribers want to react when token counts cross a threshold. Today they read OTel — which the workflow-engine doesn't fan out to subscribers.
- **External billing reconciliation.** An auditor verifying a tenant's monthly bill needs per-call records. The rollup is too lossy; OTel exports aren't part of the protocol contract.

The fix: emit a durable `provider.usage` event after each provider call. The event-log replay machinery preserves per-call records deterministically; subscribers receive them through existing SSE / webhook surfaces.

## Proposal

### §A New event type — `provider.usage`

Added to `schemas/run-event-payloads.schema.json` alongside `agentReasoningDelta`:

```diff
+    "providerUsage": {
+      "type": "object",
+      "description": "Per-call usage record emitted after every LLM provider invocation. Durably persisted in the run event log; consumed by replay, webhook subscribers, billing reconciliation. The OTel `openwop.cost.*` attribute group (per `observability.md §\"Cost attribution attributes\"`) is the observability sibling — this event type is the durable record.",
+      "required": ["provider", "model", "inputTokens", "outputTokens"],
+      "properties": {
+        "provider":         { "type": "string", "minLength": 1, "description": "Canonical provider id (lowercase ASCII, e.g. \"anthropic\", \"openai\", \"google\"). Same value as the `openwop.cost.provider` OTel attribute." },
+        "model":            { "type": "string", "minLength": 1, "description": "Provider-stamped model id as the model expects it. Same value used in the LLM cache-key recipe (per `replay.md §A`)." },
+        "inputTokens":      { "type": "integer", "minimum": 0, "description": "Input/prompt tokens billed for this call. Matches the provider response's input-token count verbatim." },
+        "outputTokens":     { "type": "integer", "minimum": 0, "description": "Output/completion tokens billed for this call. Matches the provider response's output-token count verbatim." },
+        "totalTokens":      { "type": "integer", "minimum": 0, "description": "Convenience sum (inputTokens + outputTokens). Consumers MAY compute themselves; emitters MAY include for readability." },
+        "costEstimateUsd":  { "type": "number", "minimum": 0, "description": "ADVISORY estimate in USD computed by the host's static rate table. MUST NOT be used for billing — real billing is external. Hosts SHOULD omit when no rate is known rather than emit 0." },
+        "currency":         { "type": "string", "pattern": "^[A-Z]{3}$", "description": "ISO 4217 code when `costEstimateUsd` is non-USD; the field name stays `costEstimateUsd` for back-compat but `currency` overrides the implied denomination." },
+        "cacheHit":         { "type": "boolean", "description": "True iff this call was served from the LLM response cache (per `replay.md §\"LLM cache-key recipe\"`). When true, inputTokens/outputTokens reflect the ORIGINAL call's billed values; the cached invocation incurred zero new provider cost." },
+        "nodeId":           { "type": "string", "description": "The node id that initiated the provider call. Required for per-node cost attribution dashboards." },
+        "traceId":          { "type": "string", "description": "OTel trace id linking this event to the matching `openwop.cost.*` span. Lets observability backends correlate event-log entries with traces." }
+      },
+      "additionalProperties": false
+    },
```

Registered as a `RunEventType` enum value in `schemas/run-event.schema.json`:

```diff
   "agent.reasoned",
   "agent.reasoning.delta",
+  "provider.usage",
```

Mapped in the `eventPayloads` discriminator (same pattern as RFC 0024):

```diff
+  { "if": { "properties": { "type": { "const": "provider.usage" } } },
+    "then": { "properties": { "payload": { "$ref": "#/$defs/providerUsage" } } } },
```

### §B Emission timing (normative)

Hosts that advertise `capabilities.providerUsage.supported: true` MUST emit exactly ONE `provider.usage` event per LLM provider invocation. The event MUST be emitted BEFORE the corresponding `node.completed` event for the calling node — this ordering preserves causal correlation: subscribers can read the usage record and immediately know which node it attributes to via the `nodeId` field + the causationId chain.

When the call was served from the LLM response cache (`cacheHit: true` per `replay.md §"LLM cache-key recipe"`), the event MUST still fire, but `inputTokens` and `outputTokens` MUST reflect the ORIGINAL cached call's billed values. This preserves per-call replay determinism: replaying the same workflow yields the same `provider.usage` events at the same sequence positions.

`costEstimateUsd` MAY be omitted on replay even when the original emission included it — the rate table is local to the host and may have changed between runs. Token counts MUST replay identically.

### §C OTel projection

Hosts that emit `provider.usage` SHOULD ALSO project the same data into the existing `openwop.cost.*` OTel attribute group per `observability.md §"Cost attribution attributes"` (closes O4). The mapping:

| Event field | OTel attribute |
|---|---|
| `provider` | `openwop.cost.provider` |
| `inputTokens` | `openwop.cost.tokens.input` |
| `outputTokens` | `openwop.cost.tokens.output` |
| `totalTokens` | `openwop.cost.tokens.total` |
| `costEstimateUsd` | `openwop.cost.usd` |
| `currency` | `openwop.cost.currency` |

The OTel projection is RECOMMENDED, not REQUIRED — hosts MAY emit only the event (for example, hosts that don't run an OTel exporter). The event is the load-bearing surface for replay determinism + subscribers; OTel is supplementary.

### §D Trust boundary (security)

The `provider.usage` payload MUST NOT carry:

- BYOK `credentialRef` strings (the cleartext key never appeared here; the `ref` MUST NOT leak either)
- Hashed credential identifiers
- Prompt or response substring excerpts
- Tool call arguments or results
- Any field outside the schema's declared shape (`additionalProperties: false` enforces this)

Per `SECURITY/threat-model-secret-leakage.md` §SR-1 + the existing redaction harness across event payloads, hosts MUST sanitize provider responses before emission. This is consistent with the existing OTel `openwop.cost.*` invariant in `observability.md §"Cost attribution attributes"` ("cost attributes MUST NOT include the prompt/response text") — RFC 0026 carries the same invariant into the event-log surface.

A new SECURITY invariant row tracks this:

```yaml
- id: provider-usage-no-credential-leak
  tier: protocol
  severity: high
  threat_model: SECURITY/threat-model-secret-leakage.md
  tests:
    - conformance/src/scenarios/provider-usage.test.ts
  note: |
    RFC 0026 §D: hosts advertising `capabilities.providerUsage.supported`
    MUST NOT include credentialRef strings, hashed credential identifiers,
    or prompt/response substrings in the `provider.usage` event payload.
    The payload schema's `additionalProperties: false` enforces shape;
    this invariant adds the semantic constraint.
```

### §E Capability handshake

A new optional capability block:

```diff
+    "providerUsage": {
+      "type": "object",
+      "description": "Hosts that emit `provider.usage` events after every LLM provider invocation per RFC 0026.",
+      "properties": {
+        "supported": { "type": "boolean" },
+        "costEstimates": { "type": "boolean", "description": "When true, the host includes `costEstimateUsd` on `provider.usage` events using its internal rate table. When false/absent, only token counts are emitted." },
+        "currency": { "type": "string", "pattern": "^[A-Z]{3}$", "description": "Default ISO 4217 currency for `costEstimateUsd` values. When absent, USD is assumed." }
+      },
+      "required": ["supported"],
+      "additionalProperties": false
+    }
```

## Compatibility

**Additive** per `COMPATIBILITY.md §2.1`:

- Existing required fields: unchanged (RFC 0026 adds optional fields to optional payload variants)
- Existing optional fields: unchanged
- Existing event types: shape unchanged (`provider.usage` is a NEW type added to the enum; existing types' schemas are untouched)
- Existing endpoints: contract unchanged
- Existing `MUST` requirements: not relaxed — RFC 0026 introduces new MUSTs scoped to the new event type and its emitters
- Existing error codes: unchanged

Forward-compat guarantee per `COMPATIBILITY.md §2.1`: SDK event-loop consumers iterating by event-type string handle unknown types gracefully (tolerate-and-forward). The reference TypeScript / Python / Go SDKs already do this — the new event type slots into the existing dispatch without code changes for old SDK consumers.

## Conformance

New scenario `conformance/src/scenarios/provider-usage.test.ts` with three describe blocks:

1. **Advertisement shape (`capabilities.providerUsage`):** when present, `supported` is boolean; `currency` (when present) is a 3-letter uppercase ISO code.
2. **Schema compile + round-trip:** the new `providerUsage` `$def` compiles under Ajv2020 (covered by existing `spec-corpus-validity.test.ts`); positive and negative payload fixtures roundtrip.
3. **Event presence + shape:** when the host exposes the test seam `POST /v1/host/sample/test/emit-provider-usage`, the suite triggers a synthetic emission and verifies via Thread E.1's `queryTestEvents` helper that exactly one `provider.usage` event appears with the required fields populated and credentialRef-shaped fields ABSENT.

Soft-skips on capability-absent OR seam-absent so non-supporting hosts keep advertisement-shape coverage.

## Alternatives considered

1. **OTel-only (do nothing).** Rejected — observability is not part of the durable run state. Replay loses cost; webhook subscribers don't see it; external billing has no audit trail. The `metrics.openwopCost` rollup is too coarse (one value per run).
2. **`log.appended` events with structured fields.** Rejected — `log.appended` is debug-stream-only per `observability.md §"Structured-log metric records"` and not durably persisted for replay. Misuses the event's semantic.
3. **Embed in `node.completed.payload`.** Rejected — couples cost to node lifecycle. Multi-call nodes (an LLM that retries, or a chat node that makes multiple calls in one execution) lose per-call granularity. The per-call event is the right level.
4. **New top-level RunSnapshot field `costEvents[]`.** Rejected — duplicates the event log. The event log already has replay determinism, ordering, causationId chains; reinventing those in a snapshot field is strictly worse.

## Unresolved questions

1. Should `cacheHit: true` events count against the `provider.usage` event budget if a per-run budget cap exists in the future? Suggest yes (they describe a real provider call's billed values, even if served from cache) but the cache hit was free for THIS run. Defer to a future `capabilities.providerUsage.budget` field if needed.
2. Should `currency` default to USD silently or require explicit emission when `costEstimateUsd` is present? Current proposal: silent default. Spec gap acknowledgment if a host's billing is multi-currency.
3. Should the OTel projection be REQUIRED (MUST) rather than RECOMMENDED (SHOULD)? Current proposal: SHOULD. Hosts without OTel exporters shouldn't be excluded.

## Implementation notes (non-normative)

- Reference impl candidate: `apps/workflow-engine/backend/typescript/src/providers/usageEmitter.ts` (NEW) — pure function `extractUsage(providerResponse, providerId, model): ProviderUsagePayload` + a small static rate table for Anthropic / OpenAI / Gemini.
- Emit site: `providers/dispatch.ts` after each `provider.invoke()` call, via `ctx.emit('provider.usage', payload)`.
- Test seam: `apps/workflow-engine/.../routes/testSeam.ts` — new `POST /v1/host/sample/test/emit-provider-usage { runId, payload }` that synthesizes the event into the existing test event log (Thread E.1's `envelopeEventLog`). Lets conformance verify shape without driving a real LLM call.
- Advertise via `routes/discovery.ts`: `capabilities.providerUsage: { supported: true, costEstimates: true, currency: 'USD' }`.

## Acceptance criteria

- [ ] RFC follows `RFCS/0000-template.md`
- [ ] 7-day comment window: opens with PR; eligible for bootstrap-phase waiver per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers" (pattern from RFCs 0021–0025 in the same release)
- [ ] `provider.usage` added to `RunEventType` enum + `eventPayloads` discriminator
- [ ] `providerUsage` payload schema with required + optional fields; `additionalProperties: false`
- [ ] `capabilities.providerUsage` capability block lands
- [ ] AsyncAPI channel for the new event
- [ ] `provider-usage-no-credential-leak` SECURITY invariant row + matching public test
- [ ] `spec/v1/observability.md` gains §"Provider usage events" prose section
- [ ] Reference impl at `apps/workflow-engine/.../providers/usageEmitter.ts`
- [ ] Conformance scenario at `conformance/src/scenarios/provider-usage.test.ts`
- [ ] CHANGELOG entry under `[Unreleased]`
- [ ] `npm run openwop:check` 9/9 green

## References

- `spec/v1/observability.md §"Cost attribution attributes"` — the existing OTel-only surface this complements
- `spec/v1/replay.md §"LLM cache-key recipe"` — the deterministic key + cacheHit semantics this depends on
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md:265` — anticipated `openwop.cost.*` OTel taxonomy
- `SECURITY/threat-model-secret-leakage.md §SR-1` — the redaction harness `provider.usage` plugs into
- `RFCS/0024-agent-reasoning-streaming.md` — the precedent template for additive new event types
- `RFCS/0025-test-mode-registry-namespace.md` — the precedent for the bootstrap-phase waiver flow
