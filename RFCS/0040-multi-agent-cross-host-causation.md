# RFC 0040: Multi-agent Phase 3 — cross-host causation linking

| Field | Value |
|---|---|
| **RFC** | 0040 |
| **Title** | Multi-agent execution model Phase 3: cross-host causation linking + W3C tracecontext propagation across composition boundaries + cross-host run-ID resolution |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-22 |
| **Updated** | 2026-05-22 (Draft → Active same-day: Phase 3 spec text + schema + conformance scaffolds landed atomically following the RFC 0034/0037/0039 pattern. `spec/v1/multi-agent-execution.md` gains §"Cross-host causation (RFC 0040 Phase 3, normative)" with the §A causationHostId field contract, §B W3C tracecontext propagation across MCP + A2A composition, and §C ancestry endpoint contract. `schemas/capabilities.schema.json` adds `multiAgent.executionModel.crossHostCausation.{supported, hostId, ancestryEndpointSupported}` sub-block. `schemas/run-event-payloads.schema.json` adds optional `causationHostId` to `coreWorkflowChainEvent`; the additive-on-all-causationId-bearing-payloads convention is documented in spec prose for the remaining payload shapes (additions to each $defs entry deferred to follow-up — pattern is identical). NEW `schemas/run-ancestry-response.schema.json` covers the §C endpoint response shape. `api/openapi.yaml` gains `getRunAncestry` operation (`GET /v1/runs/{runId}/ancestry`). Three conformance scenarios land: `cross-host-causation-shape.test.ts` (advertisement shape probe — always-on when discovery reachable), `cross-host-ancestry-endpoint.test.ts` (behavioral on top-level-run path + 404-on-non-advertise), `cross-host-traceparent-propagation.test.ts` (behavioral gated on `OPENWOP_MCP_REAL_SERVER_URL` / `OPENWOP_A2A_REAL_PEER_URL` env harness). Host wiring (ancestry endpoint implementation + traceparent injection in the reference workflow-engine's MCP + A2A composition) deferred to a follow-up commit owned by the workflow-engine maintainer; protocol-layer contract is complete. Path to `Accepted`: a non-steward host advertises `crossHostCausation.supported: true` + serves the ancestry endpoint + emits causationHostId on cross-host events.) |
| **Affects** | `spec/v1/multi-agent-execution.md` (extends with §"Cross-host causation (Phase 3, normative)") · `spec/v1/observability.md` (extends §"Trust boundary + redaction" with the cross-host case) · `spec/v1/mcp-integration.md` + `spec/v1/a2a-integration.md` (tracecontext propagation across composition) · `schemas/run-event-payloads.schema.json` (additive `causationHostId` field on `agent.*` payload shapes) · `schemas/capabilities.schema.json` (bumps `multiAgent.executionModel.version` ceiling effective range to include `3`; adds optional `crossHostCausation` block) · 3 new conformance scenarios · `INTEROP-MATRIX.md` · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Closes 3 open spec gaps from [RFC 0037](./0037-multi-agent-execution-model.md) §"Open spec gaps":

- **MAE-4** (`causationId cross-host scope`): extends `causationId` to span hosts (currently single-host scope per `spec/v1/replay.md` §"Determinism with non-deterministic agents").
- **MAE-5** (`W3C tracecontext across MCP/A2A`): normates W3C tracecontext propagation across the MCP/A2A composition boundary (partial coverage exists in `RFCS/0023-conformance-agent-event-emitters.md` for OTel; this normates the cross-host case).
- **MAE-6** (`cross-host run-ID resolution`): defines the discoverable identifier chain when host A's run dispatches to host B (e.g., via MCP composition or A2A handoff).

Bumps `multiAgent.executionModel.version` from `2` (Phase 2, RFC 0039) to `3` (Phase 3, this RFC) when implemented. Phase 1 + Phase 2 hosts continue to advertise their existing version. Hosts that implement Phase 3 advertise `version: 3` and conform to additional MUSTs.

## Motivation

RFC 0037 Phase 1 normated the per-host execution loop. RFC 0039 Phase 2 normated confidence escalation + same-host memory lifecycle. Neither addresses what happens when a workflow crosses a host boundary:

- A workflow on host A invokes an MCP tool whose implementation lives on host B; events host B's tool emits ought to chain back to host A's originating run — §A makes that wire-shape explicit.
- An A2A peer on host B sends a message to host A's agent; the receiving agent needs a discoverable path to walk the causation chain back to the sender's originating event — §C's `ancestry` endpoint provides it.
- A `core.subWorkflow` dispatch can target a workflow registered on a different host (per `host-extensions.md` §"Canonical prefixes" + a future cross-host dispatch contract).

Without normated cross-host causation:

- OTel traces don't survive the composition boundary; debug-bundle exports lose causal context.
- Replay-from-fork against a run that touched a cross-host call cannot deterministically reproduce the call's causation chain.
- Cross-host workflow run-IDs are opaque; clients can't discover the parent run when given only a child run-ID from a different host.

The external standards-readiness review of 2026-05-21 finding (3) called out cross-host causality as part of the "multi-agent semantics not fully portable" gap. RFC 0037 Phase 1 closed the per-host half; RFC 0039 Phase 2 closed the same-host-memory half; this RFC closes the cross-host half.

## Proposal — Phased

Like RFC 0037 + 0039, this RFC stages its surface so the comment window can converge.

### §A — `causationHostId` field on cross-host event payloads (normative when Phase 3 advertised)

Add an optional `causationHostId: string` field to every event payload shape that carries `causationId` today. When the causationId points at an event on the SAME host, `causationHostId` is absent (existing semantics). When the causationId points at an event on a DIFFERENT host, `causationHostId` MUST be present and MUST equal the originating host's `/.well-known/openwop` advertisement's `host.id` (a new optional capability field also added by this RFC — see §D below).

Affected payload shapes: `agent.reasoned`, `agent.toolCalled`, `agent.toolReturned`, `agent.handoff`, `agent.decided`, `runOrchestrator.decided`, `core.workflowChain.event`, `core.workflowChain.confidence-escalated`, `prompt.composed`, `agent.promptResolved`. The field is additive on every shape; existing consumers that ignore unknown fields continue to work.

### §B — W3C tracecontext across MCP + A2A composition (normative when Phase 3 advertised)

Extend `spec/v1/mcp-integration.md` §"Trust boundary" with: hosts that dispatch MCP tool calls AND advertise `multiAgent.executionModel.version >= 3` MUST inject the parent run's W3C `traceparent` header into the outbound MCP request envelope. The MCP tool's host MUST honor the inbound `traceparent` as the parent trace for any spans it emits. The same rule applies symmetrically to `a2a-integration.md`: outbound A2A messages MUST carry the parent run's `traceparent`; inbound A2A handlers MUST adopt it as the trace parent.

This extends the per-host trace propagation already covered by RFC 0023 (`otel-trace-propagation-subworkflow.test.ts`) to cross-host composition.

### §C — Cross-host run-ID resolution (normative when Phase 3 advertised)

Define a normative response shape for `GET /v1/runs/{runId}/ancestry` (NEW endpoint) returning the cross-host parent chain:

```jsonc
{
  "runId": "current-host-run-id",
  "hostId": "current-host-id",
  "parent": {
    "runId": "parent-host-run-id",
    "hostId": "parent-host-id",
    "wellKnownUrl": "https://parent.example.com/.well-known/openwop",
    "cause": "mcp-tool-call" | "a2a-message" | "core.subWorkflow"
  } | null
}
```

`parent: null` means the current run is a top-level run (not dispatched from another host). When the parent is on the same host, `wellKnownUrl` is absent (existing single-host case). When the parent is on a different host, `wellKnownUrl` MUST be set so a client can resolve the chain by walking the URLs.

### §D — Capability advertisement

```diff
   "multiAgent": {
     "executionModel": {
       ...,
+      "crossHostCausation": {
+        "type": "object",
+        "additionalProperties": false,
+        "required": ["supported"],
+        "properties": {
+          "supported": { "type": "boolean" },
+          "hostId": {
+            "type": "string",
+            "minLength": 1,
+            "description": "Stable identifier for this host instance, used as the `causationHostId` value on cross-host events. SHOULD be a URL or DNS-style identifier (e.g., `myndhyve.ai/workflow-runtime`)."
+          },
+          "ancestryEndpointSupported": {
+            "type": "boolean",
+            "description": "Host serves the GET /v1/runs/{runId}/ancestry endpoint per §C."
+          }
+        }
+      }
     }
   }
```

Hosts advertising `multiAgent.executionModel.version: 3` MUST also advertise `crossHostCausation.supported: true` and provide a stable `hostId`.

## Compatibility

**Additive.** Hosts advertising `version: 1` or `version: 2` continue unchanged. Hosts upgrading to `version: 3` add:

- A new optional payload field (`causationHostId`) that pre-Phase-3 consumers ignore.
- A new endpoint (`GET /v1/runs/{runId}/ancestry`) that pre-Phase-3 clients don't call.
- A new capability sub-block (`crossHostCausation`) that pre-Phase-3 clients ignore.
- New normative MUSTs on existing endpoints (MCP/A2A tracecontext propagation) — additive in that they only fire when the host dispatches via those surfaces AND advertises version: 3.

## Conformance

3 new conformance scenarios:

- `cross-host-causation-traceparent.test.ts` — capability-gated on `multiAgent.executionModel.version >= 3` AND `OPENWOP_TEST_MCP_REAL_SERVER_URL` set. Drives an MCP tool call from the host and asserts the outbound request carries the parent run's `traceparent`.
- `cross-host-ancestry-endpoint.test.ts` — capability-gated on `crossHostCausation.ancestryEndpointSupported: true`. Creates a run dispatched from a synthetic cross-host fixture; asserts `GET /v1/runs/{runId}/ancestry` returns the parent chain with `wellKnownUrl` set.
- `cross-host-causation-payload.test.ts` — capability-gated. Asserts that when a cross-host event is emitted (e.g., an MCP tool reply), the host's event log entry includes `causationHostId` pointing at the originating host.

## Alternatives considered

1. **Skip `causationHostId` and rely on URL-namespaced `causationId` values (e.g., `https://host-a.example.com/runs/.../events/123`).** Rejected — `causationId` is opaque-string per the existing event-log schema; clients shouldn't need to URL-parse to discover cross-host context. A sibling field is cleaner.
2. **Define a separate cross-host RunEventType (`run.crossHostCausation`) instead of extending existing payload shapes.** Rejected — would force consumers to learn a new event type AND walk through cross-host events to reconstruct chains. Extending the existing payload shapes is denser and preserves consumer code.
3. **Defer to a separate "federation" RFC.** Rejected — cross-host causation is the load-bearing piece of multi-agent portability; deferring it perpetuates the standards-readiness gap.

## Unresolved questions

1. **hostId format.** SHOULD be URL-or-DNS-style but not strictly normated. A future clarification may tighten to a pattern matching `^[a-z0-9]+(\.[a-z0-9-]+)+/[a-z0-9-]+$`.
2. **Ancestry endpoint pagination.** A run dispatched through 10 hosts has a 10-deep parent chain. Should `GET /v1/runs/{runId}/ancestry` return the full chain or just the immediate parent? Defer to comment-window discussion; current proposal returns immediate parent only.
3. **Replay across the cross-host boundary.** Phase 4 (`RFCS/0041`) covers replay-under-nondeterminism; the cross-host-replay-determinism intersection might warrant a dedicated note in the §C ancestry endpoint contract — defer to comment-window discussion.

## Acceptance criteria

- [ ] Spec text merged (this file).
- [ ] `spec/v1/multi-agent-execution.md` extended with §"Cross-host causation (Phase 3, normative)" per §A + §B + §C.
- [ ] `spec/v1/mcp-integration.md` + `spec/v1/a2a-integration.md` extended with §"Tracecontext propagation (RFC 0040)" per §B.
- [ ] `schemas/capabilities.schema.json` extends `multiAgent.executionModel` with the `crossHostCausation` block per §D.
- [ ] `schemas/run-event-payloads.schema.json` adds optional `causationHostId` to all listed payload shapes.
- [ ] `api/openapi.yaml` gains `GET /v1/runs/{runId}/ancestry` endpoint per §C; response schema in `schemas/run-ancestry-response.schema.json` (NEW).
- [ ] 3 new conformance scenarios per §Conformance.
- [ ] At least one reference host advertises `version: 3` + passes the 3 scenarios.
- [ ] `INTEROP-MATRIX.md` updated.
- [ ] CHANGELOG entry under `[Unreleased]`.

Path to `Active → Accepted`: cross-host advertisement evidence per `RFCs/0001-rfc-process.md` §"Promotion to Accepted."

## References

- [`RFCS/0037-multi-agent-execution-model.md`](./0037-multi-agent-execution-model.md) §"Open spec gaps" MAE-4, MAE-5, MAE-6.
- [`RFCS/0039-multi-agent-confidence-and-memory-lifecycle.md`](./0039-multi-agent-confidence-and-memory-lifecycle.md) (Phase 2 — this RFC's predecessor on the multi-agent roadmap).
- [`RFCS/0023-conformance-agent-event-emitters.md`](./0023-conformance-agent-event-emitters.md) (per-host tracecontext propagation; this RFC extends to cross-host).
- [`spec/v1/multi-agent-execution.md`](../spec/v1/multi-agent-execution.md) (the doc this RFC extends).
- [`spec/v1/mcp-integration.md`](../spec/v1/mcp-integration.md) §"Trust boundary" (the surface §B extends).
- [`spec/v1/a2a-integration.md`](../spec/v1/a2a-integration.md) (symmetric §B extension).
- [`spec/v1/replay.md`](../spec/v1/replay.md) §"Determinism with non-deterministic agents" (the contract MAE-4 extends to cross-host scope).
- External standards-readiness review 2026-05-21 — finding (3).
