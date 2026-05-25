# RFC 0064 — Gap Register

Companion to [`RFCS/0064-tool-invocation-hooks-and-authorization.md`](../0064-tool-invocation-hooks-and-authorization.md). Verdict from the reconciliation audit: **reframed** — extend the existing `agent.toolCalled` / `agent.toolReturned` events (RFC 0002) rather than invent `tool.invoked` / `tool.returned`; reuse the `forbidden` error + `rate_limited` error + RFC 0049's `authorization-fail-closed` invariant rather than `tool_forbidden` + a new invariant.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
|---|---|---|---|---|---|
| G1 | §B | **Reframe applied:** additive `argsHash`/`principal`/`transport` on `agentToolCalled` + `status`/`durationMs` on `agentToolReturned` — NOT new `tool.*` events. Confirm RFC 0002 author accepts the additive fields. | Spec Architect | Confirm with RFC 0002. | Active |
| G2 | §C | **Reframe applied:** reuse `forbidden` (403, `details.scope: 'tool'`) not a new `tool_forbidden`; reuse RFC 0049's `authorization-fail-closed` invariant — no new invariant. Confirm with RFC 0049 / Security. | Security Architect | Confirm with RFC 0049. | Active |
| G3 | §C / RFC 0045 | Where a tool declares `requiredScopes[]` — MCP tool manifest, node-pack manifest, or host mount policy. Resolve with RFC 0045 connector-manifest. | Spec Architect | Decision before Active. | Active |
| G4 | §B / Unresolved #3 | `agent.toolCalled` is "agent.*"-named but `transport: 'http'`/`'native'` covers non-agent egress. Define an `agentId` convention for non-agent tool calls (e.g. a synthetic system agent) or relax the requirement. | Spec Architect | Decision before Active. | Active |
| G5 | §B / Unresolved #2 | `argsHash` MUST use the same RFC 8785 JCS recipe as RFC 0041 / RFC 0063 for cross-host comparability. | Schema Architect | Confirm the recipe. | Active |
| G6 | §D | Per-tool rate-limit reuses `rate_limited` (429) with `details.scope: 'tool'` — confirm the envelope discriminator doesn't collide with the HTTP-inbound limiter's envelope. | Schema Architect | Confirm with `rest-endpoints.md`. | Active |
