# RFC 0150 — Gap Register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §E | ~~Deployed v1 key/history inventory is absent.~~ **CLOSED 2026-08-12** — surveyed; **no host implements the Layer-2 recipe**, so no persisted v1 keys exist (reference hosts: zero `invocationId` occurrences; openwop-app: a spec-citing comment only). Migration cost is zero *while that holds*. Published at `docs/EFFECT-IDENTITY-V1-INVENTORY.md`. | Compatibility Architect | Done. | — |
| G7 | §B | The only production provider-idempotency path (openwop-app → Stripe refunds) derives keys from stable business ids (`refund:${orderId}`) with **no `attempt` component** — it independently implements §B's principle and ignored the spec's formula, because following the spec would have produced duplicate refunds. Adoption evidence for §B, but it embodies the principle rather than the `logicalInvocationOrdinal` wire shape. | Spec Architect | Decide whether §B's contract admits a business-identifier derivation or requires the ordinal form; record openwop-app as §B implementation evidence either way. | Active |
| G2 | §A | Canonical endpoint ID alias rules are undecided. | Spec Architect | Derive from OpenAPI operationId plus extension namespace. | Active |
| G3 | §C | Provider semantic-option registry is incomplete. | Provider Maintainer | Build adapter matrix and namespaced fallback rules. | Active |
| G4 | §D | Provider idempotency qualification criteria need a closed test. | Security Architect | Define minimum duplicate-suppression contract and adversarial probe. | Active |
| G5 | §E | v1 cache retention/deletion policy is unset. | Operations Architect | Align with run retention and rollback window. | Accepted |
| G6 | Security | CVE-class triage for cross-tenant and duplicate-effect impact is pending. | Security Maintainer | Private advisory review under SECURITY.md. | Public detail / Active |

