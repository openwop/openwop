# RFC 0154: Workload Identity, Delegation, Telemetry, and Provenance Assurance

| Field | Value |
| --- | --- |
| **RFC** | 0154 |
| **Title** | Workload Identity, Delegation, Telemetry, and Provenance Assurance |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-11 |
| **Affects** | `spec/v1/{auth,auth-profiles,observability,capabilities}.md`, NEW identity/delegation schemas, capability schema, run-event audit projection, certification/release/pack provenance, security threat models and invariants |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

This RFC adds optional workload-identity and delegated-actor provenance profiles, requires authorization to remain separate from identity provenance, defines stable OpenWOP-to-OpenTelemetry mappings, and standardizes verifiable provenance for releases, suites, SDKs, packs, and certification bundles. It composes with mTLS, SPIFFE-compatible identities, cloud workload identity, OAuth security BCPs, and SLSA-style attestations without requiring one vendor technology.

## Motivation

OpenWOP has strong bearer-token, tenant, RBAC, mTLS, BYOK, and audit foundations, but lacks a portable machine-workload identity and delegated actor chain. A2A/MCP peers need to state who is acting on whose behalf without turning that provenance into authorization. Current telemetry uses a rich `openwop.*` namespace but lacks a versioned mapping to evolving GenAI conventions. Artifact signing exists in parts of the ecosystem, but release/corpus/suite/certification provenance is not one verifiable chain.

## Proposal

### §A — Workload identity profile

Add capability profile `openwop-workload-identity-v1`:

```diff
 "auth": {
   "profiles": ["oauth2-client-credentials", "mtls"],
+  "workloadIdentity": {
+    "supported": true,
+    "schemes": ["spiffe", "mtls-san", "cloud-subject", "oauth-client"],
+    "senderConstraint": ["mtls", "dpop"]
+  }
 }
```

An authenticated workload identity is `{scheme, subject, issuer?, audience?, keyBinding?}`. `subject` is an opaque identifier; raw certificates, tokens, proofs, and credentials **MUST NOT** enter the object. A host **MUST** cryptographically verify the presented identity, bind it to the request, and resolve it to an OpenWOP principal before authorization. Unresolvable identity fails closed.

### §B — Delegated actor chain

Requests MAY carry a signed/verified delegation context projected as:

```json
{
  "actor": { "principalId": "agent:planner", "kind": "agent" },
  "onBehalfOf": { "principalId": "user:123", "kind": "user" },
  "delegation": {
    "chain": [
      { "subject": "spiffe://example/dispatcher", "issuer": "spiffe://example" }
    ],
    "audience": "openwop-host",
    "expiresAt": "2026-08-11T16:00:00Z",
    "proofRef": "sha256:..."
  }
}
```

The chain is provenance, **not authorization**. Every hop **MUST** be verified; the effective principal, tenant, audience, expiry, scopes, and target action **MUST** be authorized at every OpenWOP boundary. A caller **MUST NOT** self-assert `onBehalfOf`. Hosts **MUST** bound chain length and reject cycles, expired proofs, audience mismatch, unknown issuers, or scope amplification.

### §C — Sender constraint and token exchange

High-value machine credentials **SHOULD** be sender-constrained through mTLS, DPoP, or an equivalent verified key binding. OAuth token exchange/delegation MAY be used, but a downstream token **MUST NOT** exceed the upstream tenant, audience, scopes, or lifetime. Bearer fallback **MUST** be explicitly advertised and policy-controlled; it cannot inherit a sender-constrained assurance claim.

### §D — Audit and telemetry

Authorization decisions **MUST** emit content-free audit facts containing opaque actor, effective principal, delegation depth, issuer class, audience decision, scope decision, and correlation ID. Raw subject claims MAY be hashed or mapped to host-opaque identifiers.

`openwop.*` remains canonical. A versioned mapping document MAY project stable fields into OpenTelemetry GenAI semantic attributes. Experimental OTel attributes **MUST** be labeled with the upstream semantic-convention version and **MUST NOT** be required for core conformance. W3C `traceparent`/`tracestate` propagates across A2A, MCP, dispatch, compensation, and interrupt boundaries without becoming authorization evidence.

### §E — Artifact provenance

The project **MUST** publish provenance attestations for spec releases, conformance packages, SDK packages, and official packs. Each attestation binds artifact digest, source revision, builder/workflow identity, build invocation, dependency lock digest, and publication identity. Certification bundle v2 from RFC 0148 **MAY** be wrapped in the same signed attestation format. Verification **MUST** fail closed on digest/signature mismatch but **MUST NOT** imply semantic conformance without the underlying suite witnesses.

### §F — Security invariants

Add:

- `workload-identity-cryptographically-bound`;
- `delegation-provenance-not-authorization`;
- `delegation-no-scope-amplification`;
- `delegation-tenant-audience-bound`;
- `delegation-chain-bounded-acyclic`;
- `sender-constraint-no-bearer-downgrade`; and
- `provenance-attestation-digest-bound`.

SR-1 and CTI-1 apply to all new objects. External audit scope includes confused deputy, replayed delegation proof, issuer confusion, token exchange, DPoP/mTLS binding, provenance signing keys, CI substitution, and telemetry leakage.

## Compatibility

All wire fields and profiles are optional and capability-gated. Existing bearer/mTLS hosts remain conformant but cannot claim the new assurance profile. Unknown delegation/telemetry fields on server-emitted events are ignored under v1 rules. Client-submitted delegation objects are closed and accepted only when the profile is advertised. No existing identity is reinterpreted.

## Conformance

New scenarios:

- `workload-identity-shape.test.ts`;
- `workload-identity-proof-bound.test.ts`;
- `delegation-chain-validation.test.ts`;
- `delegation-no-scope-amplification.test.ts`;
- `delegation-tenant-audience.test.ts`;
- `sender-constraint-downgrade.test.ts`;
- `otel-semconv-mapping.test.ts`; and
- `artifact-provenance-verification.test.ts`.

Shape and provenance fixture verification are server-free. Behavioral identity tests gate on the profile and require a synthetic issuer/workload harness. Fixtures cover valid SPIFFE-style ID, mTLS SAN, cloud subject, expired/cyclic/over-scoped delegation, DPoP/mTLS mismatch, valid/tampered attestations, and redaction canaries.

## Alternatives considered

1. Standardize SPIFFE only. Rejected: technology-specific; SPIFFE remains a first-class mapping.
2. Treat `onBehalfOf` as a role. Rejected: provenance cannot grant authority.
3. Require experimental OTel GenAI fields directly. Rejected: upstream conventions can change.
4. Rely on package signatures without build provenance. Rejected: signatures alone do not explain source/build identity.
5. Do nothing. Rejected: cross-agent machine trust remains ambiguous.

## Unresolved questions

1. Which delegation proof formats are mandatory in profile v1?
2. Is DPoP included at Active or left as an advertised optional sender constraint?
3. Which in-toto/SLSA predicate becomes the canonical provenance envelope?
4. Which OTel GenAI convention version is sufficiently stable for the first mapping?
5. How are privacy deletion requests reconciled with immutable hashed audit identifiers?

## Implementation notes (non-normative)

Reuse the synthetic OIDC issuer and mTLS harness where possible. Keep proof verification pluggable but the normalized wire projection closed. This RFC is SR-7 under RFC 0147 and supplies identity for RFCs 0151–0153.

## Acceptance criteria

- [ ] Identity/delegation schemas, capability profile, and auth prose land.
- [ ] Verification, fail-closed authorization, sender constraint, and negative chain tests pass.
- [ ] OTel mapping is versioned and optional.
- [ ] Release/suite/SDK/pack provenance attestations verify from a clean checkout.
- [ ] Threat models, invariants, audit events, fixtures, interop matrix, and CHANGELOG update.
- [ ] External auditor reviews the identity and provenance implementation.

## References

- RFC 0147 Workstream 6 and RFC 0148 certification evidence
- RFC 9700 OAuth 2.0 Security Best Current Practice
- RFC 8693 OAuth Token Exchange and RFC 9449 DPoP
- [SPIFFE overview](https://spiffe.io/docs/latest/spiffe-about/overview/)
- [SLSA 1.2](https://slsa.dev/spec/v1.2/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)

