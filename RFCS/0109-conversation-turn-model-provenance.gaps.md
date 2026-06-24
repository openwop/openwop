# RFC 0109 — Gap register

Open questions, deferred decisions, and missing inputs beyond the in-RFC Unresolved questions. Each gap has an owner and a resolution path.

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
|---|---|---|---|---|---|
| G1 | Proposal | Nest as `agent.model` vs a sibling `provenance` object on the turn? (RFC Unresolved Q1.) | Spec Architect | Decide in the comment window; `agent.model` recommended for cohesion with `agentId`. Reversible additively before Accepted. | Schema diff freeze → Active |
| G2 | Proposal | Is `provider` a free string or constrained to the RFC 0031 advertised-provider vocabulary? | Schema Architect | Free string recommended (forward-compat with RFC 0108 self-hosted/compat classes); revisit if a closed enum is needed. | Active (schema freeze) |
| G3 | Conformance | The no-secret assertion needs a credential-shaped negative fixture — confirm the fixture catalog has (or add) a turn with a secret-shaped `agent.model` that MUST fail validation. | Conformance Architect | Add the negative fixture to `conformance/fixtures.md`; `additionalProperties:false` on `model` is the structural guard. | Accepted (scenario) |
| G4 | Capability | Is a dedicated `conversationTurnModelProvenance.supported` flag right, or should it ride an existing conversation capability? | Spec Architect | Dedicated flag recommended (honest per-feature advertisement); confirm against `capabilities.md` granularity. | Active (capability text) |
| G5 | INTEROP-MATRIX | Which advertised host beyond openwop-app can dual-witness the capability? | Compatibility Architect | Survey INTEROP-MATRIX; if none, bootstrap-phase steward waiver with openwop-app as reference host. | Accepted (third-party gate) |
