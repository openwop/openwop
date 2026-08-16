# Threat Model: Workload Identity, Delegation, and Provenance

> **Scope:** RFC 0154 — the `openwop-workload-identity-v1` profile (`capabilities.auth.workloadIdentity`), the delegated actor chain, sender constraint / token exchange, the content-free audit and telemetry projection, and artifact provenance attestations. Prose in `spec/v1/auth.md` §"Workload identity and delegated actor chain (RFC 0154)"; shape in `schemas/workload-identity.schema.json`; witness `workload-identity-behavior.test.ts` via seam §20 of `spec/v1/host-sample-test-seams.md`.
> **Last updated:** 2026-08-16
> **Companion artifacts:** `spec/v1/auth.md` · `spec/v1/auth-profiles.md` · `spec/v1/observability.md` §"Identity and delegation attributes" · `SECURITY/threat-model-auth-profiles.md` · `SECURITY/threat-model-secret-leakage.md` · `SECURITY/invariants.yaml` (`delegation-tenant-audience-bound`, `delegation-chain-bounded`; six further RFC 0154 §F invariants named and not yet registered).
> **Status of evidence:** shape and seam exist; **no host advertises the profile**, so every behavioural invariant below currently resolves to `blocked` (RFC 0148 §A). This document states the threats so the witnesses, when a host arrives, test the right things.

## 1. Why this model

`threat-model-auth-profiles.md` covers *how a caller authenticates* (API key, OAuth2 client credentials, mTLS, OIDC user-bearer). RFC 0154 adds two things that model does not: (a) a **workload** identity that is verified cryptographically and resolved to a principal *before* authorization, and (b) a **chain of delegation** carried with the request. Both are places where "who called" is easy to confuse with "what they may do" — the confused-deputy shape RFC 0147 R12 names — and where a proof that was valid somewhere else can be presented here. The profile's one-sentence rule, **identity is not authorization**, is what this model defends.

## 2. Trust boundaries

```text
[Workload: agent / service / CI job]
        │ T1  SVID · client cert · cloud attestation · OAuth client credential
        │     (+ optional delegation proof, + optional sender-constraint binding)
        ▼
[OpenWOP host: verify → bind → resolve]           ← §A
        │ T2  { scheme, subject(opaque), issuer?, audience?, keyBinding? }
        │     { actor, onBehalfOf?, delegation{ chain, audience, expiresAt, proofRef } }
        ▼
[OpenWOP authorization: tenant · workspace · scopes · audience · policy]   ← RFC 0048/0049
        │ T3  effective principal + decision
        ▼
[Run record · authorization.decided · spans · logs]                        ← §D
        │ T4  content-free facts only
        ▼
[Artifacts: spec release · suite · SDK · packs]                            ← §E (cross-repo)
        T5  digest ⇄ attestation ⇄ signing identity
```

- **T1 Presentation.** Credentials, proofs, and bindings cross the wire. Everything here is attacker-influenced until verified.
- **T2 Verification → projection.** The host verifies against a trust root and projects to the closed shape. What is *not* in the shape (raw material) must not survive T2.
- **T3 Projection → authorization.** The projected identity is an *input* to authorization, never a substitute for it.
- **T4 Decision → observable surfaces.** Audit facts, spans, and logs describe outcomes without subjects, proofs, or credentials.
- **T5 Build → publish.** An artifact's digest is bound to a source revision and builder identity; verification fails closed on mismatch and proves integrity, not conformance.

## 3. Adversaries

| ID  | Adversary                                | Capability                                                                                                                                                                                                 |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Confused-deputy caller                   | Holds a *valid* workload identity for tenant X and asks the host to act in tenant Y, or on a resource its scopes do not cover, betting that "verified" will be read as "authorized". Witness: seam §20 negative legs; `delegation-tenant-audience-bound`. |
| A2  | Proof replayer                           | Captured a delegation proof (or a bearer credential) in transit or from a log and presents it again — later, elsewhere, or as a different principal. Mitigation: `expiresAt`, audience, sender constraint, single-use where required. |
| A3  | Issuer confuser                          | Presents an identity minted by an issuer the host does not trust, or crafts a `subject` that collides with a trusted issuer's namespace (`spiffe://trusted/…` from an untrusted CA). Mitigation: verify against the scheme's trust root; issuer pinning; never accept the *name*. |
| A4  | Chain launderer                          | Builds a long or cyclic delegation chain, or a chain in which a later hop claims broader scopes than an earlier one, so that authority appears to accumulate. Mitigation: `maxChainDepth`, cycle rejection, no scope amplification. |
| A5  | Header forger at a misconfigured edge    | Sends `X-Forwarded-Client-Cert` / identity headers directly to a host that trusts them, bypassing the edge that would have verified. Mitigation: bind to the verified connection/proof; treat forwarded identity as attacker-controlled unless the terminator is configured-trusted. |
| A6  | Self-asserting delegate                  | Adds `onBehalfOf: user:ceo` to its own request. Mitigation: `onBehalfOf` only from a verified proof; refuse otherwise. |
| A7  | Downstream token inflator                | Uses token exchange to mint a downstream credential with a longer lifetime, wider audience, or more scopes than the upstream one. Mitigation: downstream MUST NOT exceed upstream tenant/audience/scopes/lifetime. |
| A8  | Telemetry miner                          | Reads spans, audit logs, or debug bundles to recover subjects, issuers, certificate fingerprints, or proofs. Mitigation: content-free projection (§D); SR-1; salted, rotatable hashes only. |
| A9  | Supply-chain substituter                 | Replaces a published artifact (suite tarball, SDK, pack) or the CI job that builds it, so a consumer verifies a valid signature over the wrong thing. Mitigation: attestation binds digest + source revision + builder identity + invocation + lock digest; verification fails closed. Cross-repo (`openwop-sdks`, `openwop-registry`). |

## 4. STRIDE per surface

### 4.1 Identity verification and resolution (§A)

| Threat                 | Vector                                                                                          | Mitigation (normative home)                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | Scheme name accepted without the scheme's verification; unknown scheme accepted                 | Closed `schemes[]`; verify against the trust root; unadvertised scheme refused (`auth.md` §A; `workload-identity.schema.json` closed enum).                 |
| Spoofing               | Identity minted for another host accepted                                                        | `audience` MUST match this host → `audience_mismatch` (`delegation-tenant-audience-bound`).                                                                |
| Elevation of privilege | Verified identity treated as authorization                                                       | Resolve to a principal, then RFC 0048/0049 authorization at every boundary — identity is an input (`auth.md` §"Authorization"; RFC 0147 R12).                |
| Denial of service      | Trust-root outage turns into default-allow                                                       | Fail closed: unverifiable ⇒ refused, non-retriable closed reason (`auth.md` §A; seam §20).                                                                  |
| Information disclosure | Raw SVID / cert / token / proof enters the projected object, a span, or a log                    | Closed shape forbids credential material; `proofRef` / `thumbprintRef` are digest references (SR-1; `threat-model-secret-leakage.md`).                     |
| Tampering              | Forwarded identity headers trusted from an untrusted edge                                       | Bind to the verified connection/proof; forwarded identity is attacker-controlled unless the terminator is configured-trusted (`auth.md` §A bind rule).       |

### 4.2 Delegated actor chain (§B)

| Threat                 | Vector                                                                          | Mitigation (normative home)                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Elevation of privilege | Chain read as a grant; a hop authorizes what the caller could not               | Chain is provenance; effective principal/tenant/audience/scopes/action authorized at every boundary (`delegation-provenance-not-authorization`, named). |
| Elevation of privilege | Later hop claims broader scopes                                                  | No scope amplification hop-to-hop (`delegation-no-scope-amplification`, named).                                              |
| Spoofing               | Caller self-asserts `onBehalfOf`                                                 | Only from a verified proof; refuse otherwise (`auth.md` §B).                                                                 |
| Repudiation / DoS      | Unbounded or cyclic chain; standing (no-expiry) delegation                        | `maxChainDepth`, cycle rejection, `expiresAt` (`delegation-chain-bounded` registered for length; acyclicity named, unwitnessed). |
| Spoofing               | Replayed proof presented by a different principal or after expiry                | Bind proof to principal + audience + expiry; single-use where the operation requires it (`delegation_expired`, `audience_mismatch`). |
| Information disclosure | Chain's asserted tenant reveals another tenant's existence                       | Neutralize or refuse without disclosure (RFC 0132 §A.2 rule, `auth.md` §B).                                                  |

### 4.3 Sender constraint and token exchange (§C)

| Threat                 | Vector                                                                        | Mitigation (normative home)                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing (replay)      | Observed bearer credential replayed by the observer                           | Sender constraint (mTLS / DPoP) advertised in `senderConstraint[]`; missing constraint refused (`sender_constraint_missing`).      |
| Repudiation            | Bearer-verified identity later described as key-bound                          | Bearer fallback explicitly advertised and never inherits a sender-constrained assurance label; `openwop.identity.sender_constraint: none` (`sender-constraint-no-bearer-downgrade`, named). |
| Elevation of privilege | Token exchange mints a broader/longer downstream credential                    | Downstream MUST NOT exceed upstream tenant, audience, scopes, lifetime (`auth.md` §C).                                            |
| Tampering              | DPoP proof accepted without binding to the request (method/URI/nonce)         | Verify the binding per the mechanism; a proof that binds nothing is bearer (`auth.md` §C).                                        |

### 4.4 Audit and telemetry (§D)

| Threat                 | Vector                                                                          | Mitigation (normative home)                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Information disclosure | Subject, issuer URL, fingerprint, proof, or credential in a fact, span, or log  | Content-free projection: opaque ids, enums, integers only (`auth.md` §D; `observability.md` §"Identity and delegation attributes"). |
| Information disclosure | Hashed subjects re-identified across tenants or after a deletion request        | Per-tenant salt, rotatable; deletion via salt rotation; retention stated (`auth.md` §D, RFC 0154 G5).                             |
| Elevation of privilege | Trace context (`traceparent`/`baggage`) or a span attribute read as authorization | Correlation only; a host MUST NOT derive tenant/principal/scope from them (`observability.md`).                                    |
| Repudiation            | Decision recorded without depth/audience/scope outcome                          | `authorization.decided` + the closed reason tokens (`auth.md` §D).                                                                |

### 4.5 Artifact provenance (§E — cross-repo, carried)

| Threat                 | Vector                                                                    | Mitigation (normative home)                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Tampering              | Published artifact swapped after signing; CI job substituted              | Attestation binds digest + source revision + builder/workflow identity + build invocation + lock digest + publication identity; verify fails closed (`provenance-attestation-digest-bound`, named). |
| Spoofing               | Valid attestation over a different digest presented                        | Digest mismatch ⇒ fail closed.                                                                                                        |
| Repudiation            | Verified provenance read as conformance                                    | Provenance proves integrity, never conformance; suite witnesses remain the evidence (RFC 0154 §E; RFC 0148).                           |

## 5. Relationship to other models

- **`threat-model-auth-profiles.md`** owns credential *mechanics* (rotation, issuer pinning for OAuth2/OIDC, mTLS at the edge). This model starts where that one hands over a verified identity and asks what it may do.
- **`threat-model-secret-leakage.md`** owns SR-1; every object in this profile is designed so that SR-1 has nothing to redact — credential material is excluded by shape, not scrubbed after the fact.
- **`threat-model-prompt-injection.md`** — a delegated *agent* actor is still an agent; its tool calls and outputs remain `untrusted` and cannot advance approval gates.
- **RFC 0132 anonymous actors** — the far end of the same axis: an anonymous principal has *no* verified identity and *no* inherited authority; a workload identity has a verified identity and *still* no inherited authority.

## 6. Residual risks

- **Trust-root compromise.** If a SPIFFE CA, cloud attestation service, or OAuth issuer is compromised, verified-but-forged identities are indistinguishable from real ones; the profile bounds blast radius through audience, tenant binding, and scope evaluation, not by detecting the forgery.
- **Edge configuration.** mTLS and identity headers commonly terminate before the host; a host that is told to trust a terminator that is in fact reachable directly has no protocol-level defence.
- **Proof format heterogeneity.** RFC 0154 gap G1 leaves the mandatory proof *format* undecided; two hosts may verify different envelopes for the same logical delegation, which is an interop risk rather than a security one.
- **No advertiser yet.** Every behavioural row above is untested against a real host; the seam and witness exist so that the first advertiser is tested non-vacuously, and RFC 0148 §A keeps the status honest until then.

## 7. Verification

- **Shape:** `workload-identity-profile.test.ts` — the closed object, credential exclusion, per-section gating (`supported` / `delegation`).
- **Behaviour (gated):** `workload-identity-behavior.test.ts` via `POST /v1/host/sample/test/workload-identity/resolve` (`host-sample-test-seams.md` §20) — resolution, `audience_mismatch`, `delegation_expired`, `sender_constraint_missing`, non-retriable closed reasons, credential exclusion; `workload-identity-chain-bounds.test.ts` (same seam, gated on `delegation.supported`) — `delegation_chain_too_long`, `delegation_chain_cyclic`, `delegation_scope_amplified`, and the positive that a bounded, acyclic, narrowing chain resolves. Soft-skips without an advertiser; hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`.
- **Registered invariants:** `delegation-tenant-audience-bound`, `delegation-chain-bounded`, and (2026-08-16, via `workload-identity-chain-bounds.test.ts` — too-long / cyclic / amplified / a narrowing chain resolves) `delegation-chain-acyclic`, `delegation-no-scope-amplification` (`SECURITY/invariants.yaml`, protocol tier).
- **Named by RFC 0154 §F, not registered** (each needs a witness that exercises the threat, not just the shape): `workload-identity-cryptographically-bound`, `delegation-provenance-not-authorization`, `sender-constraint-no-bearer-downgrade`, `provenance-attestation-digest-bound` (`delegation-no-scope-amplification` registered 2026-08-16; `delegation-chain-bounded-acyclic` is now the conjunction of the registered `delegation-chain-bounded` + `delegation-chain-acyclic`). Registering one against a test that does not verify it converts a known gap into an apparent guarantee (`docs/RFC-0147-SELF-AUDIT.md`).
- **External audit scope** (RFC 0154 §F, unscheduled): confused deputy, replayed delegation proof, issuer confusion, token exchange, DPoP/mTLS binding, provenance signing keys, CI substitution, telemetry leakage — the rows above are its checklist.
