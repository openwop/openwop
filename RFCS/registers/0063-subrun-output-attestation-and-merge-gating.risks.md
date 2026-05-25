# RFC 0063 — Risk Register

Companion to [`RFCS/0063-subrun-output-attestation-and-merge-gating.md`](../0063-subrun-output-attestation-and-merge-gating.md). Likelihood × Impact (H/M/L).

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|
| R1 | (pre-reframe) A new `subRun.attested` event would duplicate the `output.harvested` handoff-state-machine transition. | — | — | **Closed** | Reframed: additive `attestation` field on the existing `core.workflowChain.event`. | Spec Architect | Closed |
| R2 | A naive host applies `outputMapping` before the approval gate, so a bad child artifact enters parent state despite `requireApproval` (fail-open). | M | H | High | §C MUST fail-closed: no `accept`/`edit-accept` ⇒ no merge. Protocol-tier invariant `subrun-merge-approval-fail-closed` + `subrun-approval-fail-closed.test.ts` land WITH implementation. | Security Architect | Open |
| R3 | Cross-host checksum doesn't verify because hosts canonicalize differently. | L | M | Low | MUST reuse the RFC 8785 JCS recipe (RFC 0041); `subrun-checksum-stable.test.ts` asserts host-independence. | Schema Architect | Open |
| R4 | `principalScope` narrowing diverges from RFC 0049 semantics, creating a second authz model. | L | M | Low | References RFC 0049 scopes only; defines no new scopes. | Security Architect | Open |
