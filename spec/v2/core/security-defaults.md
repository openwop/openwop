# Security Defaults

> **Status: Stable · RFC 0173 (§A–§E), 0164 §22, 0170 §B.**
> **Normative home:** `sandbox`, `compensation`, `purposePropagation`.

## Why this exists

RFC 0173 replaces v1's opt-in security flags (RFC 0164 §22). This document is the obligation table: which surface binds which behavior, the invariant, and the witness.

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
| an `oauth2` or `oidc` lane | protected-resource metadata and challenges (identity.md §2.5) | witnessable-gated | `auth-challenge-no-oracle` |
| any outbound request | no inbound credential on an onward hop (§Onward hops) | seam-gated | `inbound-credential-no-passthrough` |

### Auth lanes

The obligations are identity.md §2 and bind on advertisement.

### Replay suppression

Stated in replay.md §Suppression and §"The effect-seam manifest"; the `replay-side-effect-suppression` scenario witnesses it.

### Webhook durability

Stated in webhooks.md §Durability; the `webhook-durable-delivery` scenario witnesses it.

### Approver enforcement

Stated in interrupt.md §"Approver enforcement"; the `approver-enforced` scenario witnesses it.

### Sandbox isolation

A host that executes third-party packs MUST enforce the eight `node-pack-sandbox-*` invariants of `SECURITY/invariants.yaml` (`no-process`, `network-gated`, `fs-gated`, `no-env`, `timeout`, `memory-cap`, `isolated-context`, `no-eval`) and MUST advertise `sandbox.isolationModel ∈ wasm | process | container | vm` (`spec/v2/facets/sandbox.schema.json`). `node:vm` is not a value. A host that cannot isolate MUST NOT execute third-party packs; it MAY register and validate them. The `no-eval` row stays reference-impl in `ext/sandbox-runtime-notes` (§D.1). The `pack-isolation` scenario drives the eight legs.

The remaining `sandbox` facets name the bound each invariant already carries: `allowedHostCalls` is the host-call allowlist `network-gated` and `fs-gated` enforce, `memoryLimitBytes` is the ceiling of `memory-cap`, and `wallClockLimitMs` is the ceiling of `timeout`. An advertised bound MUST be enforced; none of the three gates the invariant, which binds whether or not the facet is advertised.

### Compensation

A host that advertises `compensation` MUST serve `GET /runs/{runId}/compensation` (`schemas/v2/compensation-projection.schema.json`), keyed on the node and attempt the operator family uses; a host that does not advertise `compensation` has no obligation.

The facets bind the policy shape (`schemas/v2/compensation-policy.schema.json`): `compensation.orderingModels` MUST list `reverse-completion` and MAY add `dependency-graph`, and a policy naming a model outside it MUST be refused at registration; `compensation.profileVersion` participates in the inverse-action identity, so a policy naming a different one MUST be refused; `compensation.manualIntervention` is the `manual` status above — a host advertising it records the unwind rather than abandoning it.

### Layer-2 effect identity

A host that advertises `idempotency` MUST serve `GET /runs/{runId}/effects`; the keying, provider-key, retention and projection rules are idempotency.md §"Layer 2: effect identity" (RFC 0150 §B).

### Onward hops

A host MUST NOT attach a credential it received inbound (an `Authorization`, `Cookie` or `Proxy-Authorization` value, a DPoP proof, an interrupt token, a peer's bearer, or credential material carried in a body) to any outbound request: A2A, MCP, webhook, callback, `httpClient` or connector. Outbound authentication uses only credentials the host holds for that destination (oauth.md). A verified delegation chain is not a passthrough: it carries provenance, never the inbound credential (identity.md §2.4). One credential is not inbound in this sense: an A2A push-config credential (`authentication.credentials`, `token`) is one the client gave the host for its registered push URL. A host MAY attach it only to a push delivery to that URL's origin, MUST NOT attach it after a redirect or to any other request, MUST discard it when the config is deleted or the task's final push is attempted, and MUST hold it by reference outside the event log, run state, debug bundle and every response (interop.md §"A2A push delivery", RFC 0214).

A host advertising `purposePropagation` MUST re-emit a `permittedPurposes` label it received (A2A `metadata.openwop.permittedPurposes`, `TriggerEvent.permittedPurposes`) on every onward hop of the same data, narrowing and never widening, and MUST treat `[]` as no onward use; `purposePropagation.propagatesOnward` is `false` only on a host with no onward hop. The family advertises propagation, not enforcement.

## Relaxations

A relaxation, where one is legitimate — a development deployment, a single-tenant appliance — is an operator setting, never a discovery field (RFC 0173 §A.2). Every relaxation a host runs under MUST be recorded in its certification bundle as `host.relaxations[]` (`schemas/v2/certification-bundle.schema.json`): `{ obligation, durability, reason }`, `durability ∈ session | deployment | persisted`.

| Durability | Meaning |
| --- | --- |
| `session` | Lost on restart. |
| `deployment` | Set at deploy time. |
| `persisted` | Survives restarts and is auditable. |

A bundle that records a relaxation MUST NOT certify the profile the relaxed obligation belongs to; the `relaxation-recorded` scenario verifies it unaided (conformance.md).

## Three dispositions

Every security obligation in `core/` is exactly one of (RFC 0173 §D.1):

| Disposition | Where | Requirement |
| --- | --- | --- |
| core obligation with a declared witness | this table | MUST name surface, invariant, witness. |
| extension | `spec/v2/ext/` | MUST declare a witness class and both maturity axes. |
| removed | — | No text survives. |

Operation ids in the declaration file are canonical, and aliases are migration
register rows. The provider semantic-option registry is
`spec/v2/ext/provider-idempotency/registry.json`; provider qualification uses a
fixture that rejects a changed idempotency key (§D.2).

## Threat models

The following threat-model artifacts are required:

| Artifact | Requirement |
| --- | --- |
| `SECURITY/threat-model-replay.md` §6 Residual risks | MUST record branch re-fires, seams outside the manifest, and the manifest as a self-declaration. |
| `SECURITY/threat-model-replay.md` §7 Verification, §8 References | MUST name the manifest scenario and `fork-a-v1-run`; a threat model missing a sibling section fails the template gate. |
| `SECURITY/threat-model-interop.md` | MUST cover downgrade, identity, and cross-tenant risks in protocol composition. |

## Migration

Rows `C6.1`–`C6.9` are `spec/v1/migrations.json` entries.

See also: identity.md, replay.md, webhooks.md, capabilities.md, conformance.md.
