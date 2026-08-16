# RFC 0154: Workload Identity, Delegation, Telemetry, and Provenance Assurance

| Field | Value |
| --- | --- |
| **RFC** | 0154 |
| **Title** | Workload Identity, Delegation, Telemetry, and Provenance Assurance |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-11 |
| **Updated** | 2026-08-16 (§B negative chain legs landed — `workload-identity-chain-bounds.test.ts` (too-long / cyclic / scope-amplified / narrowing-resolves), OPTIONAL per-hop `scopes` on the schema, three closed §20 reasons, `delegation-chain-acyclic` + `delegation-no-scope-amplification` registered; suite `1.127.0 -> 1.128.0`.) 2026-08-16 (§A–§D prose landed: `spec/v1/auth.md` §"Workload identity and delegated actor chain" (verify/bind/resolve/fail-closed, chain-is-provenance rules, sender constraint + token exchange, content-free audit facts + hashed-subject privacy rule (G5)); `spec/v1/observability.md` §"Identity and delegation attributes" — canonical `openwop.*` attributes and a **v0, experimental, optional** GenAI projection labelled with the upstream ref (G3/UQ4: the GenAI conventions moved to `semantic-conventions-genai` and are Development-stability with no tagged release, so no stable version exists to pin); NEW `SECURITY/threat-model-workload-identity.md` (T1–T5, adversaries A1–A9, STRIDE per §). Not landed: §E provenance (cross-repo), the six unregistered invariants, a host advertiser, proof format (G1), DPoP SDK measurement (G2).) 2026-08-12 (`Active` -> `Accepted`; 7-day comment window waived by the steward per `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". **Landed:** RFC text and its gap/risk registers. **Carried forward, not closed:** workload identity, delegation, the OTel mapping, and artifact attestations.) |
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
4. ~~Which OTel GenAI convention version is sufficiently stable for the first mapping?~~ **Resolved 2026-08-16: none is.** The GenAI conventions moved to `open-telemetry/semantic-conventions-genai`; the agent/tool attributes are Development-stability with no tagged release, and core `semantic-conventions@v1.44.0` no longer hosts them. The first mapping is therefore v0, experimental, optional, labelled with the upstream ref, and projects no identity/delegation field (`observability.md` §"Identity and delegation attributes"; gap G3 closed as decided).
5. ~~How are privacy deletion requests reconciled with immutable hashed audit identifiers?~~ **Resolved 2026-08-16:** hashes use a per-tenant, rotatable salt; a deletion request is satisfied by rotating the salt so prior hashes become unlinkable, without editing an append-only log; retention is stated in the host runbook (`auth.md` §D; gap G5).

## Implementation notes (non-normative)

Reuse the synthetic OIDC issuer and mTLS harness where possible. Keep proof verification pluggable but the normalized wire projection closed. This RFC is SR-7 under RFC 0147 and supplies identity for RFCs 0151–0153.

## Acceptance criteria

- [ ] Identity/delegation schemas, capability profile, and auth prose land. (Schema and capability landed — `schemas/workload-identity.schema.json` and `auth.workloadIdentity`, with `workload-identity-profile.test.ts`. **Shape only**; the verify/bind/resolve/fail-closed requirements are behavioral and unproven. 2026-08-16: auth prose landed — `spec/v1/auth.md` §"Workload identity and delegated actor chain" §A–§D. Carried: a host that advertises the profile.) (Formerly: nothing had landed. The RFC text is the only specification of this surface; no schema, no spec prose, no conformance. Status is `Accepted` per the corpus's own bar, which RFC 0147 §A.10 forbids citing as evidence the gap is closed.)
- [ ] Verification, fail-closed authorization, sender constraint, and negative chain tests pass. (**Negative chain tests landed 2026-08-16**: `workload-identity-chain-bounds.test.ts` — too-long / cyclic / scope-amplified refusals through the §20 seam plus the positive that a narrowing chain resolves; per-hop OPTIONAL `scopes` on `workload-identity.schema.json` make amplification observable. Measured on openwop-app main `2d2f78793` (local boot): 0/4 — the host maps every chain refusal to `identity_unverified` and its schema copy predates `scopes`; host follow-up. **The witness exists**: `workload-identity-behavior.test.ts` plus `host-sample-test-seams.md` §20, covering resolution, audience mismatch, expired delegation, non-retriable closed reason codes, and credential exclusion. Carried: a host that advertises `auth.workloadIdentity` and wires the seam — until one does, these resolve to `blocked` per RFC 0148 §A, because §A's requirements are invisible without it.)
- [ ] OTel mapping is versioned and optional. (2026-08-16: landed as `spec/v1/observability.md` §"Identity and delegation attributes (RFC 0154 §D)" — canonical `openwop.*` identity/delegation/authz attributes, all optional and content-free, plus a **v0 experimental** `gen_ai.*` projection that MUST be labelled with `openwop.otel.genai_mapping_version` + `openwop.otel.genai_semconv_ref` and MUST NOT be required by core conformance. No identity/delegation attribute is projected into `gen_ai.*` because upstream has no stable field for them. Carried: revisiting when `semantic-conventions-genai` tags a release with these fields at Stable.)
- [ ] Release/suite/SDK/pack provenance attestations verify from a clean checkout. (Carried — attestation generation spans this repo, `openwop-sdks`, and `openwop-registry`, so it cannot land here alone.)
- [ ] Threat models, invariants, audit events, fixtures, interop matrix, and CHANGELOG update. (2026-08-16 later: `delegation-chain-acyclic` + `delegation-no-scope-amplification` registered at protocol tier against `workload-identity-chain-bounds.test.ts` — four registered, four named. 2026-08-16: threat model landed — `SECURITY/threat-model-workload-identity.md`, indexed in `SECURITY.md`; the two registered invariants now point at it. Carried: the six named-but-unregistered §F invariants (each needs a witness), fixtures, interop matrix rows (no advertiser).)
- [ ] External auditor reviews the identity and provenance implementation. (Externally gated — the audit engagement is unscheduled; `SECURITY/external-audit-findings.json` records the pre-completion state.)

## References

- RFC 0147 Workstream 6 and RFC 0148 certification evidence
- RFC 9700 OAuth 2.0 Security Best Current Practice
- RFC 8693 OAuth Token Exchange and RFC 9449 DPoP
- [SPIFFE overview](https://spiffe.io/docs/latest/spiffe-about/overview/)
- [SLSA 1.2](https://slsa.dev/spec/v1.2/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)

