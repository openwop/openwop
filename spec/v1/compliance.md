# openwop Spec v1 — Compliance Vocabulary

> **Status: FINAL v1 (2026-05-12).** Non-normative — this document doesn't constrain any conforming openwop implementation. The few MUST / SHOULD keywords in this file are advisory to operators evaluating openwop in a regulated deployment, NOT requirements on conforming hosts; the protocol-level conformance contract lives in `spec/v1/*.md` + `RFCS/` + the conformance suite. Maps openwop's existing protocol-level guarantees onto common compliance vocabularies (SOC 2, GDPR, HIPAA, ISO 27001) so operators have a shared reference. See `auth.md` for the status legend.

---

## Why this exists

Operators in regulated industries (financial services, healthcare, public sector, EU-resident services) evaluate every infrastructure choice through compliance lenses. "Does openwop support audit-log retention?" is the wrong question — openwop is a protocol, not a deployed service. The right question: "What guarantees does the protocol surface, and which compliance controls do those guarantees satisfy when an operator runs a host that passes the openwop conformance suite inside their certified perimeter?"

This document maps protocol-level surfaces onto common control vocabularies. It does NOT prescribe certification (certification is the deployer's responsibility) and does NOT make legal claims about regulatory adequacy (compliance is a context-specific judgment that requires a qualified auditor + counsel). It does describe what the protocol gives an operator to work with.

---

## Scope and non-claims

**In scope:**

- Mapping protocol-level guarantees (in `auth.md`, `auth-profiles.md`, `replay.md`, `webhooks.md`, `observability.md`, `production-profile.md`, `SECURITY/`) onto control families in SOC 2 Trust Services Criteria, GDPR articles, HIPAA Security Rule safeguards, and ISO 27001:2022 Annex A.
- Identifying which protocol surfaces an auditor would inspect to verify a given control.

**Out of scope:**

- Deployment-specific posture (key management, employee access, physical security, data-residency arrangements). These are the operator's responsibility.
- Certification or attestation. The protocol can be used inside a certified environment; the protocol itself is not certified.
- Legal advice. This document is technical reference, not regulatory guidance.

**Non-claims:**

- openwop does NOT claim to be "SOC 2 compliant," "HIPAA compliant," or "GDPR compliant." A protocol cannot hold those certifications. Deployments hold them; the protocol is one input.
- Operators MUST consult qualified legal and compliance professionals before claiming any regulatory status based on protocol surfaces.

---

## Trust Services Criteria (SOC 2)

| Criterion | Protocol surface | Inspection target |
|---|---|---|
| **CC6.1** — Logical access controls | `auth.md` §Bearer tokens + scopes; `auth-profiles.md` §OAuth2-CC / OIDC / mTLS | Auditor inspects: `/.well-known/openwop` `auth.profiles[]` advertisement, scope vocabulary, scope-to-route mapping table in `rest-endpoints.md`. |
| **CC6.6** — Boundary protections | `auth.md` §Tenant isolation; `agent-memory.md` §CTI-1 cross-tenant invariant | Auditor inspects: tenant scoping on `RunOptions`, cross-tenant memory probe scenario `agentMemoryCrossTenantIsolation.test.ts`. |
| **CC6.7** — Data classification + handling | `SECURITY/threat-model-secret-leakage.md` §SR-1; `observability.md` §Redaction; `auth-profiles.md` §`openwop-audit-log-integrity` | Auditor inspects: `redaction.test.ts` / `redactionAdversarial.test.ts` / `byok-roundtrip.test.ts`; canary leak detector in `lib/canaries.ts`. |
| **CC7.1** — System operations monitoring | `observability.md` §Spans + metrics; `production-profile.md` §Observability | Auditor inspects: OTel span/metric vocabulary, `otel-emission.test.ts`, host-emitted span attributes per `openwop.*` namespace. |
| **CC7.2** — Anomaly detection | `auth-profiles.md` §`openwop-audit-log-integrity` §4 verification endpoint | Auditor inspects: `audit-log-integrity.test.ts`, `/v1/audit/verify` chain re-walk + checkpoint signature verification. |
| **CC7.3** — Evaluation of security events | `webhooks.md` §HMAC signing + replay-attack-resistant verification | Auditor inspects: webhook signing recipe + circuit-breaker semantics. |
| **A1.2** — Availability | `production-profile.md` §Backpressure + §Event retention; `idempotency.md` | Auditor inspects: backpressure 503 envelope + Retry-After bound (≤24h per RFC 0009 Q#2 resolution), event-retention minimum (7d), idempotency-record retention (≥24h). |
| **A1.3** — Recovery from incidents | `replay.md` §Retention and garbage collection; `storage-adapters.md` §Stale-claim recovery | Auditor inspects: `restart-during-run.test.ts`, `staleClaim.test.ts`, `replay-fork.test.ts`. |

---

## GDPR (EU 2016/679)

| Article | Protocol surface | Inspection target |
|---|---|---|
| **Art. 5(1)(c)** — Data minimization | `agent-memory.md` §SR-1 redaction; `debug-bundle.md` §Redaction guarantees | Auditor inspects: memory entries surface as `[REDACTED:<id>]` for BYOK plaintext; debug-bundle export excludes raw secrets per the redaction harness. |
| **Art. 5(1)(e)** — Storage limitation | `replay.md` §Retention; `production-profile.md` §Event retention | Auditor inspects: retention-window advertisement (`capabilities.production.retention.minWindowSeconds`), expired-run 410/404 envelope. |
| **Art. 5(2)** — Accountability | `auth-profiles.md` §`openwop-audit-log-integrity` | Auditor inspects: append-only audit log + hash chain + signed checkpoints; `/v1/audit/verify` makes the log inspectable by data-protection officers. |
| **Art. 17** — Right to erasure | `replay.md` §Privacy rules for replaying cached LLM responses | Auditor inspects: deletion semantics across the run + event log + cached provider responses. **Protocol does NOT mandate erasure UX** — operators expose erasure to data subjects through host-specific tooling. |
| **Art. 25** — Data protection by design | `SECURITY/threat-model-secret-leakage.md`; `SECURITY/threat-model-prompt-injection.md` | Auditor inspects: threat models published as part of the protocol; conformance scenarios that exercise the documented invariants. |
| **Art. 30** — Records of processing | `observability.md` §Trace context propagation; canonical `openwop.tenant_id` / `openwop.scope_id` span attributes | Auditor inspects: every run carries tenant + scope identifiers; OTel propagation makes downstream processing traceable. |
| **Art. 32** — Security of processing | `auth.md` §Bearer tokens; `auth-profiles.md` §OAuth2-CC / OIDC / mTLS; `webhooks.md` §HMAC | Auditor inspects: advertised auth profiles + the host's actual implementation per `INTEROP-MATRIX.md`. |
| **Art. 33** — Personal data breach notification | `SECURITY.md` §Coordinated disclosure | Auditor inspects: protocol-level disclosure SLA; operator wraps with deployment-specific notification process. |
| **Art. 44–49** — Cross-border transfers | `auth.md` §Tenant isolation; host-deployment surface (out of protocol scope) | Auditor inspects: tenant scoping primitives; cross-border posture is deployment-level, not protocol-level. |

---

## HIPAA Security Rule (45 CFR Part 164)

| Safeguard | Protocol surface | Inspection target |
|---|---|---|
| **§164.308(a)(1)(ii)(D)** — Information system activity review | `auth-profiles.md` §`openwop-audit-log-integrity` | Auditor inspects: audit log + verify endpoint; chain-validity proof. |
| **§164.308(a)(3)(ii)(A)** — Authorization and supervision | `auth.md` §Scopes; `auth-profiles.md` §`openwop-auth-api-key-rotation` | Auditor inspects: scope vocabulary + rotation grace-window advertisement. |
| **§164.308(a)(5)(ii)(C)** — Login monitoring | `observability.md` §Trace context; per-request `traceparent` | Auditor inspects: login attempts traceable via host-side audit-log entries (host-specific implementation; protocol surfaces the trace primitive). |
| **§164.310(b)** — Workstation use | Out of protocol scope — deployment concern | n/a |
| **§164.312(a)(1)** — Access control | `auth.md` §Bearer tokens + scopes | Auditor inspects: authorization gating on every protected route. |
| **§164.312(b)** — Audit controls | `auth-profiles.md` §`openwop-audit-log-integrity` | Auditor inspects: append-only audit storage, hash chain, signed checkpoints, verification endpoint. |
| **§164.312(c)(1)** — Integrity | Same as §164.312(b) | Same as above. |
| **§164.312(d)** — Person or entity authentication | `auth-profiles.md` §`openwop-auth-oidc-user-bearer` | Auditor inspects: end-user OIDC bearer when host claims the profile. |
| **§164.312(e)(1)** — Transmission security | `auth-profiles.md` §`openwop-auth-mtls`; deployment TLS (out of protocol scope) | Auditor inspects: mTLS advertisement + deployment TLS posture (front-end terminator). |

**Note on PHI (Protected Health Information):** The protocol does not define a "PHI" data class. Operators that route PHI through openwop SHOULD use the `[REDACTED:<id>]` pattern in `agent-memory.md` §SR-1 to keep PHI out of observable channels, plus deployment-specific encryption-at-rest controls.

---

## ISO/IEC 27001:2022 Annex A

| Control family | Protocol surface | Inspection target |
|---|---|---|
| **A.5.1** — Policies for information security | This document + `SECURITY.md` + threat models | Auditor inspects: published threat models, disclosure policy. |
| **A.5.7** — Threat intelligence | `SECURITY/threat-model-*.md` (5 published models) | Auditor inspects: documented adversary classes + invariants. |
| **A.5.15** — Access control | `auth.md` §Scopes | Auditor inspects: route-to-scope mapping. |
| **A.8.2** — Privileged access rights | `auth-profiles.md` §`openwop-auth-api-key-rotation` | Auditor inspects: dual-key rotation grace window. |
| **A.8.3** — Information access restriction | `auth.md` §Tenant isolation; CTI-1 cross-tenant invariant | Auditor inspects: cross-tenant probe scenario. |
| **A.8.6** — Capacity management | `production-profile.md` §Backpressure | Auditor inspects: `inflightCap` advertisement + saturation envelope. |
| **A.8.7** — Protection against malware | `node-packs.md` §Pack signing (Ed25519); `SECURITY/threat-model-node-packs.md` | Auditor inspects: pack signature verification + signing-key rotation policy. |
| **A.8.10** — Information deletion | `replay.md` §Retention; `production-profile.md` §Event retention | Auditor inspects: retention-window advertisement + expired-run envelope. |
| **A.8.11** — Data masking | `agent-memory.md` §SR-1; `observability.md` §Redaction | Auditor inspects: redaction harness + canary leak detector. |
| **A.8.15** — Logging | `auth-profiles.md` §`openwop-audit-log-integrity`; `observability.md` | Auditor inspects: hash-chained audit log + OTel span/metric vocabulary. |
| **A.8.16** — Monitoring activities | `observability.md` §Spans + metrics | Auditor inspects: OTel emission scenarios. |
| **A.8.24** — Use of cryptography | `webhooks.md` §HMAC signing; `node-packs.md` §Ed25519; `auth-profiles.md` §audit-log integrity (Ed25519 checkpoints) | Auditor inspects: documented algorithms (HMAC-SHA-256 webhooks, Ed25519 signatures) — all are standard and FIPS-acceptable. |

---

## Compliance-relevant protocol primitives

The following surfaces are most often cited in compliance reviews. They are normative parts of the openwop spec; this doc is the cross-reference.

- **Authentication / authorization.** `auth.md`, `auth-profiles.md`.
- **Audit log + integrity verification.** `auth-profiles.md` §`openwop-audit-log-integrity`, `/v1/audit/verify`.
- **Secret redaction.** `SECURITY/threat-model-secret-leakage.md` §SR-1, `agent-memory.md`, `observability.md` §Redaction.
- **Tenant isolation.** `auth.md` §Tenant isolation, `agent-memory.md` §CTI-1.
- **Retention + expiry.** `production-profile.md` §Event retention, `replay.md` §Retention and garbage collection.
- **Encryption-in-transit.** `auth-profiles.md` §`openwop-auth-mtls` for client→host; webhooks use TLS to subscriber endpoints per `webhooks.md`.
- **Encryption-at-rest.** Out of protocol scope — deployment concern. Operators wire to KMS / database TDE / object-store SSE.
- **Observability + traceability.** `observability.md` (W3C Trace Context + `openwop.*` OTel namespace).
- **Provenance.** `auth-profiles.md` §`openwop-audit-log-integrity` audit log records actor + action + target.

---

## How to use this document

1. **Pick a compliance framework** (SOC 2, GDPR, HIPAA, ISO 27001) that applies to your deployment.
2. **Identify the controls** your auditor cares about — your compliance team can produce this list.
3. **Cross-reference here** to find which protocol surface each control inspects.
4. **Verify the host you're using actually implements that surface** by consulting `INTEROP-MATRIX.md` — claim ≠ conformance evidence; the matrix records what each host has actually demonstrated.
5. **Layer the deployment-specific controls** (key management, employee access, data residency) that the protocol cannot provide.

If a compliance control you need isn't reflected here, file an issue. The intent is that this document grows with every new compliance framework that openwop deployments encounter.

---

## See also

- `auth.md` — bearer-token authentication and scope vocabulary
- `auth-profiles.md` — optional production-auth profiles (rotation, OAuth2-CC, OIDC, mTLS, audit-log integrity)
- `agent-memory.md` — memory layer + SR-1 secret redaction + CTI-1 cross-tenant isolation
- `production-profile.md` — public-release operational profile (durability, backpressure, retention)
- `replay.md` §Retention and garbage collection — replay history retention semantics
- `observability.md` — `openwop.*` OTel namespace, W3C Trace Context propagation
- `SECURITY.md` — coordinated disclosure process
- `SECURITY/threat-model-*.md` — five published threat models (auth, packs, prompt-injection, provider-policy, secret-leakage)
- `INTEROP-MATRIX.md` — per-host conformance evidence
