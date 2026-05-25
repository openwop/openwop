# RFC 0064: Tool invocation hooks & per-tool authorization (`host.toolHooks`)

| Field | Value |
|---|---|
| **RFC** | 0064 |
| **Title** | A `host.toolHooks` capability — additive authorization + timing + content-free-argument fields on the existing `agent.toolCalled` / `agent.toolReturned` events (RFC 0002), fail-closed per-tool authorization via RFC 0049 scopes (reusing the `forbidden` error + the `authorization-fail-closed` invariant), and optional per-tool rate limiting (reusing `rate_limited`) — generalizing the MCP bridges into one auditable, least-privilege tool surface without inventing parallel events |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 |
| **Affects** | `schemas/capabilities.schema.json` (`host.toolHooks` block) · `schemas/run-event-payloads.schema.json` (additive optional fields on `agentToolCalled` / `agentToolReturned`) · `spec/v1/mcp-integration.md` (per-tool authorization + rate-limit prose) · `RFCS/0002` (the tool-call events this extends) · `RFCS/0046` (credential resolution) · `RFCS/0049` (RBAC scopes + the `forbidden` error + `authorization-fail-closed` invariant, reused) · new conformance scenarios |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop already has a tool-call lifecycle: `agent.toolCalled` / `agent.toolReturned` (RFC 0002), paired by `callId`. What it lacks is (a) a *content-free* variant safe for SIEM ingestion (today `agent.toolCalled.inputs` carries the full args), (b) *per-tool authorization* (a run that may call `search` can also call `delete` if both are mounted), and (c) *per-tool rate limiting* (today's limiter is HTTP-inbound only). This RFC adds an additive `host.toolHooks` capability that **extends the existing `agent.toolCalled` / `agent.toolReturned` events** with optional `argsHash` / `principal` / `transport` / `status` / `durationMs` fields, enforces fail-closed per-tool scopes via **RFC 0049** (reusing the `forbidden` error + the existing `authorization-fail-closed` invariant), and applies per-`(principal,tool)` rate limiting (reusing `rate_limited`) — rather than inventing parallel `tool.invoked` / `tool.returned` events or a `tool_forbidden` error.

## Motivation

The feature set's tool-hooks acceptance criterion: "external calls are logged, rate-limited, and require explicit credentials," with least privilege. The pieces are uneven: credential injection works (BYOK `ctx.secrets`), tool calls already emit `agent.toolCalled` / `agent.toolReturned`, and rate limiting exists — but only at the inbound HTTP layer (per-IP / per-session), not per *tool*; the existing tool events carry full args (not SIEM-safe) and no authorization outcome; and there is no per-tool authorization between "tool is mounted" and "this principal may call it." For autonomous agents that call many tools per loop iteration (RFC 0061), "which tool, by which principal, how often, allowed?" must be first-class.

The spec is the right place because the tool-call audit record + authorization decision are cross-host security guarantees — an agent moved between hosts must be subject to the same per-tool authorization, and a SIEM consuming events from multiple hosts needs one stable shape (which `agent.toolCalled` / `agent.toolReturned` already are).

## Proposal

### §A — `capabilities.schema.json`: `host.toolHooks` block (additive)

```diff
   "host": {
     "properties": {
+      "toolHooks": {
+        "type": "object",
+        "description": "RFC 0064. Per-tool authorization + rate limiting + content-free tool-call audit fields, layered on the existing agent.toolCalled/agent.toolReturned events. Generalizes the MCP-specific bridges.",
+        "required": ["supported"],
+        "additionalProperties": false,
+        "properties": {
+          "supported": { "type": "boolean" },
+          "prePostEvents": { "type": "boolean", "description": "Host populates argsHash/principal/transport on agent.toolCalled + status/durationMs on agent.toolReturned for every external tool call." },
+          "perToolAuthorization": { "type": "boolean", "description": "Host enforces per-tool scopes against the run principal (RFC 0049), fail-closed." },
+          "perToolRateLimit": { "type": "boolean", "description": "Host applies a per-(principal,tool) rate limit." }
+        }
+      }
     }
   }
```

### §B — additive fields on the existing tool-call events (normative, when `prePostEvents: true`)

For **every** external tool call (MCP `tools/call`, a node's HTTP/API egress, an agent tool invocation), the host extends the existing `agent.toolCalled` / `agent.toolReturned` events (RFC 0002, paired by `callId`) — no new event type:

```diff
   "agentToolCalled": {
     "required": ["agentId", "toolName", "callId"],
     "properties": {
       "inputs": { "...": "RFC 0002, unchanged — full args (omit when emitting content-free)" },
+      "argsHash": { "type": "string", "description": "RFC 0064. SHA-256 of canonicalized args with resolved secrets redacted; the SIEM-safe alternative to `inputs`." },
+      "principal": { "type": "string", "description": "RFC 0064. RFC 0048 principal id the call is attributed to." },
+      "transport": { "type": "string", "enum": ["mcp", "http", "native"], "description": "RFC 0064. How the tool was reached." }
     }
   }
   "agentToolReturned": {
     "required": ["agentId", "toolName", "callId"],
     "properties": {
+      "status":     { "type": "string", "enum": ["ok", "error", "forbidden", "rate_limited"], "description": "RFC 0064. Tool-hooks outcome." },
+      "durationMs": { "type": "integer", "minimum": 0, "description": "RFC 0064. Wall-clock duration; recorded in the event, reused on replay/`:fork`, MUST NOT be recomputed from a clock (`replay.md`). Absent when the call never started (forbidden/rate_limited)." }
     }
   }
```

`argsHash` is over canonicalized args with resolved secrets **already redacted** (SR-1) — raw key material MUST NOT enter the hash input. This mirrors the content-free pattern of RFC 0057.

### §C — per-tool authorization (normative, when `perToolAuthorization: true`)

A tool declares required scopes (in its manifest / mount config). Before invoking it the host MUST check the run principal's RFC 0049 scopes and **fail-closed**, reusing RFC 0049's decision surface:

- Principal holds all required scopes → invoke; emit `agent.toolCalled` then `agent.toolReturned { status: 'ok' }`.
- Principal lacks a scope, **or authorization cannot be evaluated** → do NOT invoke; emit `agent.toolReturned { status: 'forbidden' }`; surface the existing **`forbidden`** error (403) with `details.scope: 'tool'` + `details.toolName` + `details.requiredScopes`. Absence of a decision MUST be treated as denial.

This is already covered by RFC 0049's **`authorization-fail-closed`** protocol-tier invariant (`SECURITY/invariants.yaml`) — per-tool authorization is one more resource-gated action under it. **No new invariant**; a new conformance scenario verifies the per-tool application.

### §D — per-tool rate limiting (normative, when `perToolRateLimit: true`)

The host MUST apply a token bucket keyed on `(principal, toolName)`. On exhaustion it MUST NOT invoke the tool; it emits `agent.toolReturned { status: 'rate_limited' }` and surfaces the existing **`rate_limited`** error (429, `Retry-After`) with `details.scope: 'tool'` — distinct from the existing HTTP-inbound limiter (unchanged), but the same error envelope.

### §E — credentials (normative)

Tool credentials resolve via RFC 0046 `host.credentials` (opaque refs, host-dereferenced). Raw key material MUST NOT cross into the `argsHash` input pre-redaction — args are redacted (SR-1) *before* hashing.

**Positive example.** Loop iteration calls `web.search`; principal holds `web:read`. → `agent.toolCalled { toolName: 'web.search', argsHash, principal, transport: 'mcp' }` → call → `agent.toolReturned { status: 'ok', durationMs: 412 }`.
**Negative example.** Same loop calls `db.delete`; principal lacks `db:write`. → no invocation → `agent.toolReturned { status: 'forbidden' }` + `forbidden` (403, `details.scope: 'tool'`). The destructive call never reaches the tool.

## Compatibility

**Additive.** New optional capability; five new optional fields on two *existing* events (their `required` arrays + `callId` pairing unchanged; `version < toolHooks` consumers ignore them). No new event type, no new error code (reuses `forbidden` + `rate_limited`), no new SECURITY invariant (reuses RFC 0049's `authorization-fail-closed`). Existing MCP `tools/call`, the HTTP rate limiter, credential resolution, and the run-global trust boundary are unchanged. Hosts that don't advertise `host.toolHooks` behave exactly as today. No conformance pass invalidated.

## Conformance

- **`tool-hooks-shape.test.ts`** — block validates; the additive `agent.toolCalled`/`agent.toolReturned` fields validate. (Always-on.)
- **`tool-hooks-content-free.test.ts`** — when `prePostEvents`, a tool call's `agent.toolCalled` carries `argsHash` (raw args absent if content-free) + `agent.toolReturned` carries `status` + `durationMs`. (Gated on `prePostEvents`.)
- **`tool-hooks-authorization-fail-closed.test.ts`** — a principal lacking a tool's scope gets `agent.toolReturned { status: 'forbidden' }` + `forbidden` (403) and the tool is never invoked; an unevaluable authorization also denies. (Gated on `perToolAuthorization`; verifies the per-tool application of RFC 0049's `authorization-fail-closed`.)
- **`tool-hooks-rate-limit.test.ts`** — exhausting a `(principal, tool)` bucket → `agent.toolReturned { status: 'rate_limited' }` + `rate_limited` (429) while a different tool/principal proceeds. (Gated on `perToolRateLimit`.)
- **`tool-hooks-secret-redaction.test.ts`** — a tool arg containing a resolved secret is redacted before hashing; the raw value never appears in any event. (Gated; composes with the redaction suite.)

## Alternatives considered

1. **New `tool.invoked` / `tool.returned` events + a `tool_forbidden` error + a `tool-authorization-fail-closed` invariant** (the author's first draft). Rejected on all three counts — they duplicate the existing `agent.toolCalled` / `agent.toolReturned` events (RFC 0002), the existing `forbidden` error (RFC 0049), and the existing `authorization-fail-closed` invariant (RFC 0049). Extending the existing events + reusing the existing error/invariant is the lower-surface-area path (the RFC 0058 `cap.breached` precedent).
2. **Per-tool RBAC inside RFC 0049 only, no audit fields.** Rejected — authorization without the content-free audit fields leaves the feature set's "logged" criterion unmet; the two belong together on the existing events.
3. **MCP-only hooks (extend the existing bridges).** Rejected — tools reach external systems via more than MCP (node HTTP egress, agent tool calls); the `transport` field makes the existing events transport-agnostic.

## Unresolved questions

1. **Where tools declare required scopes.** MCP tool manifest, node-pack manifest, or host mount policy? Proposed: the mount/manifest carries `requiredScopes[]`; resolve the exact field with RFC 0045 connector-manifest. Resolve before Active.
2. **`argsHash` determinism.** Same canonical-JSON recipe (RFC 8785 JCS) as RFC 0041 replay keys / RFC 0063 checksums, so a hash is comparable across hosts? Proposed yes. Confirm.
3. **Non-agent tool calls.** `agent.toolCalled` is named "agent.*" but the `transport: 'native'`/`'http'` values cover non-agent egress. Confirm reusing the `agent.*` events for non-agent tool calls is acceptable, or whether a `principal`-only (no `agentId`) emission needs an `agentId` convention (e.g. a synthetic system agent). Resolve before Active.

## Phase-0 resolution (architect ruling, 2026-05-25)

Per `docs/autonomous-agent-runtime-plan.md` §8 — Unresolved questions resolved (wire shape pinned; Active-ready pending schema + prose):

1. **Where tools declare `requiredScopes`** → in the connector/tool mount manifest (`actions[].requiredScopes[]`), aligned with RFC 0045 connector-manifest.
2. **`argsHash` determinism** → reuse the RFC 8785 JCS recipe (`replay.md §B`) over redacted args, then SHA-256 (ruling B) — same recipe as RFC 0063 checksums.
3. **Non-agent tool calls** → emit under a reserved synthetic agent id `core.system`; **`agentId` stays `required`** on `agent.toolCalled`/`agent.toolReturned` (making it optional would be a breaking change to an Accepted RFC 0002 event — ruling D11/A); the `transport` field disambiguates the source.

## Implementation notes (non-normative)

- `apps/workflow-engine`: wrap the MCP dispatch path (`mcpServerRouter.ts`) + the provider/egress path with authorize → emit `agent.toolCalled` → invoke → emit `agent.toolReturned { status, durationMs }`; reuse the RFC 0049 authorization layer (already emits `authorization.decided` on denial) and the `ephemeralRunSecrets` view for redaction. Effort: medium.
- No new SECURITY invariant (RFC 0049's `authorization-fail-closed` covers per-tool authz).

## Acceptance criteria

- [ ] `mcp-integration.md` (or a short `spec/v1/tool-hooks.md`) with the per-tool authorization + rate-limit + content-free-audit contract.
- [ ] `host.toolHooks` block + additive optional fields on `agentToolCalled` / `agentToolReturned` (run-event-payloads schema). No new event type, no new error code.
- [ ] Conformance: shape always-on; content-free/authorization/rate-limit/redaction capability-gated; the authorization scenario verifies per-tool application of RFC 0049's `authorization-fail-closed`.
- [ ] CHANGELOG entry under `[1.1.4 — unreleased]`.

## References

- [`RFCS/0002-agent-identity-and-reasoning-events.md`](./0002-agent-identity-and-reasoning-events.md) — the `agent.toolCalled` / `agent.toolReturned` events this extends.
- [`spec/v1/mcp-integration.md`](../spec/v1/mcp-integration.md) — the MCP tool surface this generalizes.
- [`RFCS/0046`](./0046-host-credentials-capability.md) — credential resolution for tool calls.
- [`RFCS/0049`](./0049-rbac-scopes-and-authorization-decisions.md) — the scopes per-tool authorization checks; the reused `forbidden` error + `authorization-fail-closed` invariant.
- [`RFCS/0057-memory-write-attribution-event.md`](./0057-memory-write-attribution-event.md) — the content-free attribution pattern reused for `argsHash`.
- [`spec/v1/replay.md`](../spec/v1/replay.md) — `durationMs` recorded, not recomputed at fork.
