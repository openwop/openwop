# RFC 0109 — Risk register

Likelihood × Impact (H/M/L). Critical/High risks require a named mitigation owner + target date.

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | A host places a BYOK key/secret in `agent.model` (naive implementation) → secret leak on the wire/transcript. | L | H | Med | `additionalProperties:false` on `model` (only `{provider,model}`); the SR-1/secret-leakage invariant + the no-secret conformance assertion; explicit MUST-NOT prose + the negative example. | Security Architect | Open |
| R2 | Dishonest attribution — a host stamps a model it didn't actually use. | L | M | Low | The "MUST be the model that actually produced the turn" honesty rule; `OPENWOP_REQUIRE_BEHAVIOR` honesty for the advertised capability. | Spec Architect | Open |
| R3 | Clients that don't tolerate the new field break. | L | M | Low | OPTIONAL + `additionalProperties:true` already on `agent` (pre-aware clients ignore it); MUST-tolerate-absence client rule. Additive classification. | Compatibility Architect | Open |
| R4 | Replay/fork drift — the field re-resolves on fork and shows the wrong model. | L | M | Low | Recorded-state rule: read verbatim on replay/`:fork`, never re-resolve (RFC 0005 / replay.md). | Spec Architect | Open |
| R5 | Capability advertised but not honored → dishonest wire claim. | L | M | Low | Capability-gated conformance scenario asserts presence when advertised; gate skips non-emitting hosts. | Conformance Architect | Open |
