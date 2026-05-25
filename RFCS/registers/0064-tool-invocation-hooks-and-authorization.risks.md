# RFC 0064 — Risk Register

Companion to [`RFCS/0064-tool-invocation-hooks-and-authorization.md`](../0064-tool-invocation-hooks-and-authorization.md). Likelihood × Impact (H/M/L).

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | (pre-reframe) New `tool.invoked`/`tool.returned` events duplicate `agent.toolCalled`/`agent.toolReturned` → double event streams + ambiguous pairing. | — | — | **Closed** | Reframed: extend the existing events (paired by `callId`) with optional fields. | Spec Architect | Closed |
| R2 | (pre-reframe) `tool_forbidden` + a `tool-authorization-fail-closed` invariant duplicate RFC 0049's `forbidden` + `authorization-fail-closed`. | — | — | **Closed** | Reframed: reuse `forbidden` + the existing invariant; a conformance scenario verifies per-tool application. | Security Architect | Closed |
| R3 | A host implements per-tool authz fail-OPEN (invoke when the decision can't be evaluated) → privilege escalation. | L | H | Med | §C MUST treat absent/unevaluable decisions as denial (RFC 0049 `authorization-fail-closed`); `tool-hooks-authorization-fail-closed.test.ts`. | Security Architect | Open |
| R4 | Raw key material enters `argsHash` input pre-redaction → secret leak via the hash/event. | L | H | Med | §E: args redacted (SR-1) BEFORE hashing; `tool-hooks-secret-redaction.test.ts`. | Security Architect | Open |
| R5 | Reusing `agent.*`-named events for non-agent egress (HTTP/native) confuses consumers expecting an `agentId`. | M | L | Low | G4: define an `agentId` convention (synthetic system agent) or relax; `transport` field disambiguates the source. | Spec Architect | Open |
