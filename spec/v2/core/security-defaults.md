# Security Defaults

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0173 (§A–§E), 0164 §22, 0170 §B.**

## Why this exists

v1 protected a tenant only when a host volunteered a boolean: fourteen auth-family flags, `replay.sideEffectSuppression`, `webhooks.durable`, `interrupt.approverRouting`, and `sandbox.supported` each gated a MUST. RFC 0164 §22 named the pattern — opt-in security is the pattern the corpus keeps regretting — and RFC 0173 applies that ruling to the whole corpus. This document is the obligation table: which surface binds which behavior, the invariant, and the witness.

## The rule

A security-load-bearing behavior is an obligation of the surface that needs it (RFC 0173 §A.1). Advertising the surface binds the behavior; no discovery field gates it. Every obligation in `core/` MUST name a surface, an invariant, and a witness class other than `unwitnessable`; a row that cannot is not in `core/` (§D.1).

A host MUST NOT advertise a surface whose obligation it has relaxed (§A.2).

## The obligation table

| Surface advertised | Obligation (v1 flag it replaces) | Witness | Invariant |
| --- | --- | --- | --- |
| any lane in `auth.lanes[]` | the lane obligations of identity.md: the verify → bind → audience → resolve → fail-closed pipeline (RFC 0170 §B.1); a named trust root as `subject.issuer` (§B.2); revocation for the lane (§B.3); the advertised `minimumAssurance` floor, `mtls.required` becoming `key-bound` (§B.4); lane-scoped delegation proof (§B.5). Replaces the fourteen `auth.*` gates. | unaided or seam-gated per lane | `sender-constraint-no-bearer-downgrade`; per-lane rows (RFC 0170 §E) |
| both `saml` and `scim` lanes | the leaver contract (RFC 0164; already mandatory) | seam-gated (RFC 0163 seams) | `subject-link-leaver-deny`, `subject-link-mandatory-when-both-advertised` |
| `replay` (any mode) | side-effect suppression with `recorded-outcome` semantics as the only conforming behavior; `none` is not a value (replay.md) | witnessable-gated via the effect-seam manifest | `replay-fanout-no-refire`; effect-seam rows registered at Accepted |
| `webhooks` | durable delivery: retries per the advertised policy with backoff, dead-letter on exhaustion, at-least-once; best-effort is not a conforming delivery mode (replaces `webhooks.durable`) | witnessable-gated (`webhook-signed-delivery` + dead-letter leg) | registered at Accepted (RFC 0173) |
| `interrupt` with `approversList` or `refKinds` | enforcement: a resolver not in the list, group, or role MUST be refused (replaces the `approverRouting` gate; `refKinds[]` stays a facet) | witnessable-gated | registered at Accepted (RFC 0173) |
| `packs` (pack execution) | isolation: the eight `node-pack-sandbox-*` invariants bind for pack code; `sandbox.isolationModel` names the mechanism and never relaxes the property (replaces `sandbox.supported`) | witnessable-gated (eight `sandbox-*` scenarios) | `node-pack-sandbox-*` |
| `compensation` | the plan, attempt, and inverse-action obligations with the read projection `GET /runs/{runId}/compensation` and the operator action family as canonical wire (replaces `compensation.supported` with seam-only evidence) | witnessable-gated (reads) + seam-gated (operator actions) | `compensation-replay-no-refire`, `compensation-effect-id-retry-stable` |
| `idempotency` | Layer-2 effect identity keyed on business identity; the activity recipe is the fallback; `GET /runs/{runId}/effects` is the read | witnessable-gated (fixture provider) | `logical-effect-id-retry-stable` |

### Auth lanes

The fourteen gate fields are removed from `schemas/v2/capabilities.schema.json`; `auth.lanes[]` carries `{ lane, issuers[], revocation, minimumAssurance, delegationProofs[] }` as facets. The obligations are stated once in identity.md and bind on advertisement.

### Replay suppression

A host that advertises `replay` MUST suppress external effects during a `replay` fork and MUST publish the effect-seam manifest at `GET /host/effect-seams` (`schemas/v2/effect-seam-manifest.schema.json`, RFC 0173 §C.1). The `replay-side-effect-suppression` scenario asserts every manifest row is suppressed and drives one seam of each kind to observe no re-fire. A host that cannot suppress MUST NOT advertise `replay`. The manifest is a self-declaration: a seam omitted is invisible to the suite, and its completeness is recorded as negative-existence, found by audit rather than witnessed.

### Webhook durability

A host that advertises `webhooks` MUST retry a failed delivery per its advertised `retryPolicy` (`maxAttempts`, `backoff`), MUST route an exhausted delivery to the dead-letter sink, and MUST deliver at least once; subscribers dedup on `(OpenWOP-Webhook-Id, runId, sequence)` (webhooks.md). The `webhook-durable-delivery` scenario observes retry then dead-letter.

### Approver enforcement

A host that surfaces `approversList`, or advertises `refKinds` including `group` or `role`, MUST refuse a resolution from a principal outside the list, group, or role at resolve time. Membership MUST be resolved at decision time and MUST NOT be re-resolved during replay (replay.md). The `approver-enforced` scenario submits a non-listed resolver and observes the refusal.

### Sandbox isolation

A host that executes third-party packs MUST enforce the eight `node-pack-sandbox-*` invariants of `SECURITY/invariants.yaml` (`no-process`, `network-gated`, `fs-gated`, `no-env`, `timeout`, `memory-cap`, `isolated-context`, `no-eval`) and MUST advertise `sandbox.isolationModel ∈ wasm | process | container | vm` (`spec/v2/facets/sandbox.schema.json`). `node:vm` is not a value. A host that cannot isolate MUST NOT execute third-party packs; it MAY register and validate them. The `no-eval` row stays reference-impl in `ext/sandbox-runtime-notes` (§D.1). The `pack-isolation` scenario drives the eight legs.

### Compensation

A host that advertises `compensation` MUST serve `GET /runs/{runId}/compensation` (`schemas/v2/compensation-projection.schema.json`): `{ runId, status, plan[], attempts[] }`, the plan carrying `{ nodeId, order, policy?, irreversibleEffect? }` and each attempt `{ nodeId, attempt, outcome, at, reason? }`, keyed on the node and attempt the operator family uses. The trichotomy of §D.1 resolves to core obligation with a declared witness; a host that does not advertise `compensation` has no obligation.

### Layer-2 effect identity

A host that advertises `idempotency` MUST assign a logical effect id once per effect, stable across transport retries, and MUST inject it as the provider's idempotency key (RFC 0150 §B). Where a provider exposes no business key, the v1 activity recipe is the documented fallback. `GET /runs/{runId}/effects` (`schemas/v2/effect-ledger-projection.schema.json`) serves `{ runId, effects[] }`, each `{ effectId, nodeId, attempt, invocationId?, keying: business-identity | activity-recipe, providerKey?, state: claimed | completed | released | escaped, at }`, content-free of provider payloads. Layer-2 retention MUST be at least 14 days (RFC 0170 §D.3). No deployed history holds a v1 recipe key, so no dual-read migration exists (RFC 0147 UQ2).

## Relaxations

A relaxation, where one is legitimate — a development deployment, a single-tenant appliance — is an operator setting, never a discovery field (RFC 0173 §A.2). Every relaxation a host runs under MUST be recorded in its certification bundle as `host.relaxations[]` (`schemas/v2/certification-bundle.schema.json`): `{ obligation, durability, reason }`, `durability ∈ session | deployment | permanent`.

| Durability | Meaning |
| --- | --- |
| `session` | Lost on restart. |
| `deployment` | Set at deploy time. |
| `permanent` | Survives restarts and is auditable. |

A bundle that records a relaxation MUST NOT certify the profile the relaxed obligation belongs to; the `relaxation-recorded` scenario verifies it unaided (conformance.md). RFC 0158's ladder is the model: evidence lives in the bundle, and a field that let a host assert a property with nothing behind it is the failure the ladder prevents.

## Three dispositions

Every security obligation in `core/` is exactly one of (RFC 0173 §D.1):

| Disposition | Where | Requirement |
| --- | --- | --- |
| core obligation with a declared witness | this table | MUST name surface, invariant, witness. |
| extension | `spec/v2/ext/` | MUST declare a witness class and both maturity axes. |
| removed | — | No text survives. |

There is no unimplemented MUST. Compensation and Layer-2 effect identity are core obligations at filing; either MUST move to `ext/` at the cut if its witness does not land. RFC 0150's sub-decisions: operation ids in the declaration file are canonical and aliases are register rows; the provider semantic-option registry is `spec/v2/ext/provider-idempotency/registry.json` with a witness per provider; the qualification test is a fixture provider that rejects a changed key (§D.2).

### RFC 0035

RFC 0035 (Parked) is resolved by the `packs` row: its §B probes become the `packs` obligation, and the RFC flips `Superseded` by RFC 0173 at the cut in the same PR (RFC 0174 §A.1). Its tripwire — a non-steward host fencing untrusted packs — becomes the `adoption: independent` axis, not a status gate.

## Threat models

RFC 0173 §E requires three threat-model artifacts before its dependents flip Accepted:

| Artifact | Requirement |
| --- | --- |
| `SECURITY/threat-model-replay.md` §6 Residual risks | MUST record branch re-fires, seams outside the manifest, and the manifest as a self-declaration. |
| `SECURITY/threat-model-replay.md` §7 Verification, §8 References | MUST name the manifest scenario and `fork-a-v1-run`; a threat model missing a sibling section fails the template gate. |
| `SECURITY/threat-model-interop.md` | MUST exist before RFC 0175 flips Accepted (written by RFC 0175's cut). |

## Migration

| Row | v1 | v2 |
| --- | --- | --- |
| `C6.1` | fourteen `auth.*` gate flags | obligations of the lane; `auth.lanes[]` facets |
| `C6.2` | `replay.sideEffectSuppression: none \| recorded-outcome` | suppression is the only replay behavior; the manifest is the witness |
| `C6.3` | `webhooks.durable` opt-in | durable delivery binds with `webhooks`; undelivered best-effort deliveries are not translated |
| `C6.4` | `interrupt.approverRouting` gate | enforcement binds with the fields |
| `C6.5` | `sandbox.supported` gate | isolation binds with pack execution; `node:vm` not a value |
| `C6.6` | `compensation.supported` with seam-only evidence | core obligation with the read projection; persisted plans and attempts unchanged |
| `C6.7` | unimplemented activity recipe | business-identity keying; `GET /runs/{runId}/effects` |
| `C6.8` | none | `host.relaxations[]` in bundle v3 |
| `C6.9` | five-section replay threat model; no interop model | sibling sections; `threat-model-interop.md` |

See also: identity.md, replay.md, webhooks.md, capabilities.md, conformance.md.
