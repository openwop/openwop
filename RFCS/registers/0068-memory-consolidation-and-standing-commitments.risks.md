# RFC 0068 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | Consolidation breaks replay determinism if a run's reads depend on pass timing | M | H | High | Unresolved #1 must close before `Active`: model consolidation as a host-managed mutation seen only via the deterministic read-snapshot (RFC 0041 §C); mid-run-triggered consolidation explicitly out of scope at `Draft` | Security Architect | Open — target before `Active` |
| R2 | A naive host puts inferred-intention text or secret-bearing payload on `commitment.fired` | L | H | Med | §C content-free MUST + no-content conformance assertion; intention served SR-1-redacted from the read-side | Security Architect | Open |
| R3 | Consolidation re-exposes a redacted secret in a merged entry | L | H | Med | §D SR-1 carry-forward (same harness as RFC 0012/0062); conformance asserts it | Security Architect | Open |
| R4 | Cross-tenant leak in a consolidation pass or a fired commitment's enqueued run | L | H | Med | CTI-1 binding in §D + schema (`memoryRef` required on both events); composes existing `agent-memory-cti-1` invariant | Security Architect | Open |
| R5 | Vendor-prefixed consolidation/commitment events proliferate if this RFC stalls at `Draft` | M | M | Med | Ship the additive event contract; INTEROP-MATRIX tracks adoption | Conformance Architect | Open |
