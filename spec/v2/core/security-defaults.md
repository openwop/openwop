# Security Defaults

> **Status: Stable.**
> **Normative home:** `sandbox`, `compensation`, `purposePropagation`, `auditLogIntegrity`.

## Why this exists

In v2 a security behavior is not an opt-in flag. This document is the obligation table: which surface binds which behavior, the invariant, and the witness.

## The rule

A security-load-bearing behavior is an obligation of the surface that needs it. Advertising the surface binds the behavior; no discovery field gates it.

- Every obligation in `core/` MUST name a surface, an invariant, and a witness class other than `unwitnessable`. A row that cannot is not in `core/`.
- A host MUST NOT advertise a surface whose obligation it has relaxed.

## The obligation table

| Surface advertised | Obligation | Witness | Invariant |
| --- | --- | --- | --- |
| any lane in `auth.lanes[]` | the lane obligations (§Auth lanes) | unaided or seam-gated per lane | `sender-constraint-no-bearer-downgrade`; per-lane rows |
| both `saml` and `scim` lanes | the leaver contract (mandatory) | seam-gated | `subject-link-leaver-deny`, `subject-link-mandatory-when-both-advertised` |
| `replay` (any mode) | side-effect suppression (§Replay suppression) | witnessable-gated via the effect-seam manifest | `replay-fanout-no-refire`; effect-seam rows registered at Accepted |
| `webhooks` | durable delivery (§Webhook durability) | witnessable-gated (`webhook-signed-delivery` + dead-letter leg) | registered at Accepted |
| `interrupt` with `approversList` or `refKinds` | approver enforcement (§Approver enforcement) | witnessable-gated | registered at Accepted |
| `packs` (pack execution) | isolation (§Sandbox isolation) | witnessable-gated (eight `sandbox-*` scenarios) | `node-pack-sandbox-*` |
| `compensation` | plan, attempt and inverse-action obligations (§Compensation) | witnessable-gated (reads) + seam-gated (operator actions) | `compensation-replay-no-refire`, `compensation-effect-id-retry-stable` |
| `idempotency` | Layer-2 effect identity (§Layer-2 effect identity) | witnessable-gated (fixture provider) | `logical-effect-id-retry-stable` |
| an `oauth2` or `oidc` lane | protected-resource metadata and challenges ([identity.md §2.5](identity.md)) | witnessable-gated | `auth-challenge-no-oracle` |
| any outbound request | no inbound credential on an onward hop (§Onward hops) | seam-gated | `inbound-credential-no-passthrough` |
| `auditLogIntegrity` | a chained, checkpointed, verifiable audit log (§Audit-log integrity) | witnessable-gated | `audit-checkpoint-signed-over-root` |

### Auth lanes

The obligations are [identity.md §2](identity.md) and bind on advertisement:

- the verify → bind → audience → resolve → fail-closed pipeline;
- a named trust root as `subject.issuer`;
- revocation for the lane;
- the advertised `minimumAssurance` floor, with `mtls.required` becoming `key-bound`;
- lane-scoped delegation proof.

### Replay suppression

Side-effect suppression with `recorded-outcome` semantics is the only conforming behavior; `none` is not a value. Stated in replay.md §Suppression and §"The effect-seam manifest"; the `replay-side-effect-suppression` scenario witnesses it.

### Webhook durability

Durable delivery means retries per the advertised policy with backoff, dead-letter on exhaustion, and at-least-once delivery; best-effort is not a conforming delivery mode. Stated in webhooks.md §Durability; the `webhook-durable-delivery` scenario witnesses it.

### Approver enforcement

A resolver not in the list, group, or role MUST be refused; `refKinds[]` stays a facet. Stated in interrupt.md §"Approver enforcement"; the `approver-enforced` scenario witnesses it.

### Sandbox isolation

A host that executes third-party packs:

- MUST enforce the eight `node-pack-sandbox-*` invariants of `SECURITY/invariants.yaml`: `no-process`, `network-gated`, `fs-gated`, `no-env`, `timeout`, `memory-cap`, `isolated-context`, `no-eval`;
- MUST advertise `sandbox.isolationModel ∈ wasm | process | container | vm` (`spec/v2/facets/sandbox.schema.json`). `node:vm` is not a value. `sandbox.isolationModel` names the mechanism and never relaxes the property.

A host that cannot isolate MUST NOT execute third-party packs; it MAY register and validate them. The `no-eval` row stays reference-impl in `ext/sandbox-runtime-notes`. The `pack-isolation` scenario drives the eight legs.

The remaining `sandbox` facets name the bound each invariant already carries: `allowedHostCalls` is the host-call allowlist `network-gated` and `fs-gated` enforce, `memoryLimitBytes` is the ceiling of `memory-cap`, and `wallClockLimitMs` is the ceiling of `timeout`. An advertised bound MUST be enforced; none of the three gates the invariant, which binds whether or not the facet is advertised.

### Compensation

A host that advertises `compensation` MUST serve `GET /runs/{runId}/compensation` (`schemas/v2/compensation-projection.schema.json`), keyed on the node and attempt the operator family uses. The read projection and the operator action family are the canonical wire. A host that does not advertise `compensation` has no obligation.

The facets bind the policy shape (`schemas/v2/compensation-policy.schema.json`):

- `compensation.orderingModels` MUST list `reverse-completion` and MAY add `dependency-graph`; a policy naming a model outside it MUST be refused at registration.
- `compensation.profileVersion` participates in the inverse-action identity, so a policy naming a different one MUST be refused.
- `compensation.manualIntervention` is the `manual` status — a host advertising it records the unwind rather than abandoning it.

### Layer-2 effect identity

Layer-2 effect identity is keyed on business identity; the activity recipe is the fallback. A host that advertises `idempotency` MUST serve `GET /runs/{runId}/effects`; the keying, provider-key, retention and projection rules are idempotency.md §"Layer 2: effect identity".

### Onward hops

A host MUST NOT attach a credential it received inbound to any outbound request: A2A, MCP, webhook, callback, `httpClient` or connector. Inbound credentials are an `Authorization`, `Cookie` or `Proxy-Authorization` value, a DPoP proof, an interrupt token, a peer's bearer, or credential material carried in a body.

Outbound authentication uses only credentials the host holds for that destination (oauth.md). A verified delegation chain is not a passthrough: it carries provenance, never the inbound credential ([identity.md §2.4](identity.md)).

One credential is not inbound in this sense: an A2A push-config credential (`authentication.credentials`, `token`) is one the client gave the host for its registered push URL ([interop.md §"A2A push delivery"](interop.md)). A host:

- MAY attach it only to a push delivery to that URL's origin;
- MUST NOT attach it after a redirect or to any other request;
- MUST discard it when the config is deleted or the task's final push is attempted;
- MUST hold it by reference outside the event log, run state, debug bundle and every response.

A host advertising `purposePropagation` MUST re-emit a `permittedPurposes` label it received (A2A `metadata.openwop.permittedPurposes`, `TriggerEvent.permittedPurposes`) on every onward hop of the same data, narrowing and never widening, and MUST treat `[]` as no onward use. `purposePropagation.propagatesOnward` is `false` only on a host with no onward hop. The family advertises propagation, not enforcement.

### Audit-log integrity

A host advertising `auditLogIntegrity` MUST keep an audit log a privileged insider cannot silently rewrite. It:

- MUST keep the log append-only, each entry carrying `prevHash`, the lowercase-hex SHA-256 of the prior entry's canonical JSON ([conformance.md §Canonical JSON](conformance.md)), `null` for the first;
- MUST sign a checkpoint anchoring at most `checkpointIntervalEntries` entries, and anchor an entry within `checkpointIntervalSeconds` of its append. The range, leaves, root and signature are [RFC 0218 §A](https://github.com/openwop/openwop/blob/main/RFCS/0218-audit-checkpoint-preimage.md); the signature is Ed25519 (`checkpointSignatureAlgorithm`) under `checkpointPublicKey`, a key used for no other surface;
- MUST serve `GET /audit/verify` (scope `audit:read`), answering `schemas/v2/audit-verify-result.schema.json` with every checkpoint whose `atSequence` is in the range, ascending, and the anomalies of [RFC 0218 §C](https://github.com/openwop/openwop/blob/main/RFCS/0218-audit-checkpoint-preimage.md). A host that does not advertise the family MAY omit the operation.

The `audit-log-integrity` and `audit-checkpoint-signature` scenarios witness the verify body, each signature, and the cadence. The root is not witnessable from outside, because entries are not on the wire; tamper detection is a host-internal test.

## Relaxations

A relaxation, where one is legitimate — a development deployment, a single-tenant appliance — is an operator setting, never a discovery field. Every relaxation a host runs under MUST be recorded in its certification bundle as `host.relaxations[]` (`schemas/v2/certification-bundle.schema.json`): `{ obligation, durability, reason }`, `durability ∈ session | deployment | persisted`.

| Durability | Meaning |
| --- | --- |
| `session` | Lost on restart. |
| `deployment` | Set at deploy time. |
| `persisted` | Survives restarts and is auditable. |

A bundle that records a relaxation MUST NOT certify the profile the relaxed obligation belongs to; the `relaxation-recorded` scenario verifies it unaided (conformance.md).

## Three dispositions

Every security obligation in `core/` is exactly one of:

| Disposition | Where | Requirement |
| --- | --- | --- |
| core obligation with a declared witness | this table | MUST name surface, invariant, witness. |
| extension | `spec/v2/ext/` | MUST declare a witness class and both maturity axes. |
| removed | — | No text survives. |

Operation ids in the declaration file are canonical, and aliases are migration register rows. The provider semantic-option registry is `spec/v2/ext/provider-idempotency/registry.json`; provider qualification uses a fixture that rejects a changed idempotency key.

## Threat models

| Artifact | Requirement |
| --- | --- |
| `SECURITY/threat-model-replay.md` §6 Residual risks | MUST record branch re-fires, seams outside the manifest, and the manifest as a self-declaration. |
| `SECURITY/threat-model-replay.md` §7 Verification, §8 References | MUST name the manifest scenario and `fork-a-v1-run`. |
| `SECURITY/threat-model-interop.md` | MUST cover downgrade, identity, and cross-tenant risks in protocol composition. |

A threat model missing a sibling section fails the template gate.

## Migration

Rows `C6.1`–`C6.9` are `spec/v1/migrations.json` entries.

See also: identity.md, replay.md, webhooks.md, capabilities.md, conformance.md.

*Sources: RFC 0150, RFC 0163, RFC 0164, RFC 0170, RFC 0173, RFC 0214, RFC 0218, RFC 0224.*
