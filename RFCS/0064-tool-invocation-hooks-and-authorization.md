# RFC 0064: Tool invocation hooks & per-tool authorization (`host.toolHooks`)

| Field | Value |
|---|---|
| **RFC** | 0064 |
| **Title** | A `host.toolHooks` capability — content-free `tool.invoked` / `tool.returned` lifecycle events around every external tool/MCP call, fail-closed per-tool authorization scopes (`tool_forbidden`), and optional per-tool rate limiting — generalizing the MCP-specific bridges into one auditable, least-privilege tool surface |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-05-25 |
| **Affects** | `schemas/capabilities.schema.json` (`host.toolHooks` block) · new `spec/v1/tool-hooks.md` (or `mcp-integration.md` extension) · `api/asyncapi.yaml` (`tool.invoked`, `tool.returned` events) · `spec/v1/rest-endpoints.md` (`tool_forbidden`) · `RFCS/0046` (credential resolution) · `RFCS/0049` (RBAC scopes) · new conformance scenarios · proposed SECURITY invariant `tool-authorization-fail-closed` (lands at implementation) |
| **Compatibility** | `additive` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

openwop's tool surface today is MCP-shaped: the reference app exposes/calls tools via MCP (`tools/list`, `tools/call`) with input-schema validation, and bridges `sampling` / `elicitation` as specific hooks. What it lacks is a *generic* tool-call lifecycle — pre/post events around **every** external call regardless of transport — and *per-tool* authorization and rate limiting (today's rate limiting is HTTP-endpoint-level, and the trust boundary is run-global). This RFC adds an additive `host.toolHooks` capability: content-free `tool.invoked` / `tool.returned` events around each tool call, fail-closed per-tool authorization keyed on RFC 0049 scopes (`tool_forbidden`), and optional per-tool rate limiting. It turns "the agent called some tools" into an auditable, least-privilege, rate-aware surface.

## Motivation

The feature set's tool-hooks acceptance criterion: "external calls are logged, rate-limited, and require explicit credentials," with least privilege enforced. The pieces exist but are uneven: credential injection works (BYOK `ctx.secrets`), MCP calls are logged as ordinary run events, and rate limiting exists — but only at the inbound HTTP layer (per-IP / per-session), not per *tool*. There is no `tool.invoked` event a SIEM can key on, no per-tool authorization (a run that may call `search` can also call `delete` if both are mounted), and no per-tool quota. For autonomous agents that call many tools per loop iteration (RFC 0061), "which tool, by which principal, how often, allowed?" must be first-class.

The spec is the right place because the tool-call audit record and the authorization decision are cross-host security guarantees — an agent moved between hosts must be subject to the same per-tool authorization, and a SIEM consuming events from multiple hosts needs one `tool.invoked` shape.

## Proposal

### §A — `capabilities.schema.json`: `host.toolHooks` block (additive)

```diff
   "host": {
     "properties": {
+      "toolHooks": {
+        "type": "object",
+        "description": "RFC 0064. Generic tool-call lifecycle events + per-tool authorization + per-tool rate limiting. Generalizes the MCP-specific bridges.",
+        "required": ["supported"],
+        "additionalProperties": false,
+        "properties": {
+          "supported": { "type": "boolean" },
+          "prePostEvents": { "type": "boolean", "description": "Host emits tool.invoked before / tool.returned after every external tool call." },
+          "perToolAuthorization": { "type": "boolean", "description": "Host enforces per-tool scopes against the run principal (RFC 0049), fail-closed." },
+          "perToolRateLimit": { "type": "boolean", "description": "Host applies a per-(principal,tool) rate limit." }
+        }
+      }
     }
   }
```

### §B — lifecycle events (normative, when `prePostEvents: true`)

For **every** external tool call (MCP `tools/call`, a node's HTTP/API egress, an agent tool invocation), the host MUST emit, content-free:

```json
{ "type": "tool.invoked",  "runId": "run-…", "data": { "toolName": "web.search", "argsHash": "sha256:…", "principal": "prn_…", "transport": "mcp" } }
{ "type": "tool.returned", "runId": "run-…", "data": { "toolName": "web.search", "status": "ok"|"error"|"forbidden"|"rate_limited", "durationMs": 412 } }
```

Events carry an **`argsHash`, never raw arguments** (privacy + SR-1: raw key material in arguments MUST NOT appear, even hashed alone-identifiably — the hash is over canonicalized args with resolved secrets already redacted). This mirrors the content-free attribution pattern of RFC 0057.

The clock-derived `durationMs` (and `status`) MUST be recorded in the emitted `tool.returned` event; on replay or `:fork`, the host MUST reuse the recorded value and MUST NOT recompute it from a wall clock, per `replay.md`.

### §C — per-tool authorization (normative, when `perToolAuthorization: true`)

A tool declares required scopes (in its manifest / mount config). Before invoking it the host MUST check the run principal's RFC 0049 scopes and **fail-closed**:

- Principal holds all required scopes → invoke; emit `tool.invoked` then `tool.returned`.
- Principal lacks a scope, **or authorization cannot be evaluated** → do NOT invoke; emit `tool.returned { status: 'forbidden' }`; surface `tool_forbidden` (403). Absence of an authorization decision MUST be treated as denial. (Proposed protocol-tier SECURITY invariant `tool-authorization-fail-closed`, landing with its conformance test at implementation — mirrors RFC 0049's `authorization-fail-closed`.)

### §D — per-tool rate limiting (normative, when `perToolRateLimit: true`)

The host MUST apply a token bucket keyed on `(principal, toolName)`. On exhaustion it MUST NOT invoke the tool; it emits `tool.returned { status: 'rate_limited' }` and surfaces `rate_limited` (429, `Retry-After`) — distinct from the existing HTTP-inbound limiter, which is unchanged.

### §E — credentials (normative)

Tool credentials resolve via RFC 0046 `host.credentials` (opaque refs, host-dereferenced). Raw key material MUST NOT cross into `tool.invoked.argsHash` input pre-redaction — the args are redacted (SR-1) *before* hashing.

**Positive example.** Loop iteration calls `web.search`; principal holds `web:read`. → `tool.invoked { toolName: 'web.search', argsHash }` → call → `tool.returned { status: 'ok', durationMs: 412 }`.
**Negative example.** Same loop calls `db.delete`; principal lacks `db:write`. → no invocation → `tool.returned { status: 'forbidden' }` + `tool_forbidden` (403). The destructive call never reaches the tool.

## Compatibility

**Additive.** New optional capability + two additive events + one error code, all gated on advertisement. Existing MCP `tools/call`, the HTTP rate limiter, credential resolution, and the run-global trust boundary are unchanged; `host.toolHooks` is a strictly-additional enforcement/observability layer a host opts into. Hosts that don't advertise it behave exactly as today. No conformance pass invalidated.

## Conformance

- **`tool-hooks-shape.test.ts`** — block validates. (Always runs.)
- **`tool-hooks-prepost-events.test.ts`** — every tool call emits exactly one `tool.invoked` + one `tool.returned`; `argsHash` present, raw args absent. (Gated on `prePostEvents`.)
- **`tool-hooks-authorization-fail-closed.test.ts`** — a principal lacking a tool's scope gets `tool_forbidden` and the tool is never invoked; an unevaluable authorization also denies. (Gated on `perToolAuthorization`; backs the invariant.)
- **`tool-hooks-rate-limit.test.ts`** — exhausting a `(principal, tool)` bucket returns `rate_limited` while a different tool/principal proceeds. (Gated on `perToolRateLimit`.)
- **`tool-hooks-secret-redaction.test.ts`** — a tool argument containing a resolved secret is redacted before hashing; the raw value never appears in any event. (Gated; composes with the redaction suite.)

## Alternatives considered

1. **Keep tool calls as ordinary run events; rely on the HTTP rate limiter.** Rejected — ordinary events have no uniform `tool.invoked` shape for a SIEM, the HTTP limiter can't distinguish tools, and there is no authorization layer between "tool is mounted" and "this principal may call it."
2. **Per-tool RBAC inside RFC 0049 only, no tool-hook events.** Rejected — authorization without the lifecycle events leaves the audit trail (the feature set's "logged" criterion) unmet; the two belong together.
3. **MCP-only hooks (extend the existing bridges).** Rejected — tools reach external systems via more than MCP (node HTTP egress, agent tool calls); the hook must be transport-agnostic.

## Unresolved questions

1. **Where tools declare required scopes.** In the MCP tool manifest, the node-pack manifest, or a host mount policy? Proposed: the mount/manifest carries `requiredScopes[]`; resolve the exact field with RFC 0045 connector-manifest. Resolve before Active.
2. **argsHash determinism.** Same canonical-JSON recipe as RFC 0041 / 0063 so a hash is comparable across hosts? Proposed yes. Confirm.
3. **Rate-limit observability.** Should bucket state be queryable (a `GET …/tools/limits`) or only surfaced on 429? Proposed 429-only for v1. Decide before Active.

## Implementation notes (non-normative)

- `apps/workflow-engine`: wrap the MCP dispatch path (`mcpServerRouter.ts`) and the provider/egress path with the emit-before / authorize / rate-limit / emit-after sequence; redaction reuses the BYOK `ephemeralRunSecrets` view. Effort: medium.

## Acceptance criteria

- [ ] `spec/v1/tool-hooks.md` (or `mcp-integration.md` extension) with the lifecycle + authorization + rate-limit contract.
- [ ] `host.toolHooks` block + `tool.invoked` / `tool.returned` (AsyncAPI + payload schema) + `tool_forbidden` (`rest-endpoints.md`).
- [ ] Conformance: shape always-on; events/authorization/rate-limit/redaction capability-gated.
- [ ] `tool-authorization-fail-closed` invariant + public test land in `SECURITY/invariants.yaml` at implementation.
- [ ] CHANGELOG entry under `[1.1.4 — unreleased]`.

## References

- [`spec/v1/mcp-integration.md`](../spec/v1/mcp-integration.md) — the MCP tool surface this generalizes.
- [`RFCS/0046`](./0046-host-credentials-capability.md) — credential resolution for tool calls.
- [`RFCS/0049`](./0049-rbac-scopes-and-authorization-decisions.md) — the scopes per-tool authorization checks; the `authorization-fail-closed` sibling invariant.
- [`RFCS/0057-memory-write-attribution-event.md`](./0057-memory-write-attribution-event.md) — the content-free event pattern reused for `tool.invoked`.
- [`spec/v1/replay.md`](../spec/v1/replay.md) — `tool.returned.durationMs` recorded, not recomputed at fork.
