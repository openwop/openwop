# Identity

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0170, 0165, 0176.**

## Why this exists

v1 carried a `principal` beside an optional Subject, a legacy rule that was advisory, a `SubjectLink` with no schema, and resume tokens with no scheme. v2 makes the Subject the owner of every run, binds every lane to a trust root and a revocation rule, gives the link and every id a grammar, and prefixes tokens so a host can rotate them. Idempotency-key grammar is `idempotency.md`.

## 1. The Subject is the owner (RFC 0170 §A)

### 1.1 Shape (`schemas/v2/subject.schema.json`)

`RunSnapshot.owner` is `{ tenant, workspace?, subject }` with `subject` REQUIRED; `principal` and `principalKind` are removed (`subject.subjectId` and `subject.kind` carry them). `run.started` MUST echo the same block (`runs.md`, `events.md`). The Subject is closed (`additionalProperties: false`):

| Field | Rule |
| --- | --- |
| `issuer` | REQUIRED; the lane's trust root (§2.2); `^\S+$`, 1–1024 |
| `subjectId` | REQUIRED; `ids.schema.json#/$defs/subjectId` — issuer-scoped, stable, opaque, never PII |
| `tenant` | REQUIRED; `tenantId` |
| `lane` | REQUIRED; `api-key \| oauth2 \| oidc \| mtls \| saml \| scim \| ldap \| workload \| session \| anonymous` |
| `kind` | REQUIRED; `user \| agent \| anonymous \| workload` |
| `keyClass` | `opaque-idp \| configured-immutable`; MUST be present iff `lane ∈ {saml, scim}` |
| `actor` | OPTIONAL; a nested Subject that acts on this subject's behalf; depth bounded at four |

`kind: anonymous` REQUIRES `lane: anonymous` and `lane: anonymous` REQUIRES `kind: anonymous`. The `actor` depth bound (4) is a four-level `$ref` chain (`actor1`…`actor4`) rather than a recursive `$ref`; a fifth level MUST fail validation. `session` is a host-native credential the host itself issued (a durable login session, a local password); `anonymous` is an RFC 0132 public surface. The lane enum grows only under `overview.md` §0.

### 1.2 The legacy subject rule (RFC 0170 §A.3)

On every read of a run created before the host began emitting subjects, the host MUST stamp `issuer: "urn:openwop:legacy"`, `lane` as attested else `api-key`, `kind` as recorded else `user`. A host MUST stamp the legacy subject at first read and MUST NOT rewrite it later. A legacy subject MUST NOT participate in a link (§3), an actor chain, or a delegation decision.

### 1.3 Fork (RFC 0170 §A.4)

On fork the host MUST copy `owner` verbatim onto the child: `tenant`, `workspace`, and `subject`. There is no `principal` asymmetry.

### 1.4 A2A anonymous end users (RFC 0170 §A.5)

An end user reaching the host through an A2A peer is `kind: anonymous`, `lane: anonymous`, with the forwarding peer's subject as `actor`; such a subject MUST NOT be linked.

## 2. One binding pipeline, every lane (RFC 0170 §B)

### 2.1 The pipeline (§B.1)

Every lane MUST: verify the credential against the lane's trust root; bind the verified identity to the request, never to an asserted header; check audience; resolve to a Subject before any authorization decision; and fail closed. The closed reason vocabulary is the family-wide error set in §6. Every lane is advertised as one member of the `auth.lanes[]` facet (`spec/v2/facets/auth.schema.json`):

```json
{ "lane": "oidc", "issuers": ["https://idp.example"], "revocation": "exp-and-recheck",
  "revocationWindowSeconds": 300, "minimumAssurance": "sender-constrained",
  "delegationProofs": ["dpop"] }
```

`lane`, `issuers[]` (min 1), `revocation`, and `minimumAssurance` are REQUIRED on each member. `auth.lanes[].issuers[]` is the realm; the v1 `auth.profiles` facet is replaced by it (`capabilities.md`).

### 2.2 Trust roots and revocation (§B.2, §B.3)

Every lane MUST name its trust root as `subject.issuer` and MUST advertise it in `issuers[]`. Revocation exists for every lane; the `revocation` value names the rule.

| Lane | `subject.issuer` (trust root) | Revocation MUST | `revocation` |
| --- | --- | --- | --- |
| `api-key` | the key realm (`urn:<host>:api-key` or a host-chosen URI) | refuse a revoked key on the next request (`credential_revoked`) | `next-request` |
| `oauth2` | the token issuer | honor `exp`; re-check the issuer within the advertised `revocationWindowSeconds` | `exp-and-recheck` |
| `oidc` | `iss` | as `oauth2` | `exp-and-recheck` |
| `mtls` | the CA subject | check CRL or OCSP, or issue certificates whose lifetime is at most the advertised window | `crl \| ocsp \| short-lived` |
| `saml` | the IdP entityID (`<saml:Issuer>`) | honor `NotOnOrAfter`; consult the SCIM link deny-set when both lanes are advertised (§3) | `not-on-or-after` |
| `scim` | the SCIM connection id bound at configuration to one IdP entityID | bind each client credential to one IdP entityID; refuse an unbound request | `bound-connection` |
| `ldap` | the directory base DN | re-bind on each request or advertise a session window | `rebind` |
| `workload` | the scheme's trust root | enforce `delegation_expired` | `delegation-expiry` |
| `session` | `urn:<host>:session` | refuse a revoked session on the next request (`credential_revoked`) | `next-request` |
| `anonymous` | `urn:<host>:anon-surface` | — | — |

`revocationWindowSeconds` (integer ≥ 1) MUST be advertised wherever the rule names a window (`exp-and-recheck`, `short-lived`, `rebind`).

### 2.3 Minimum assurance (§B.4)

Each lane MUST advertise `minimumAssurance: bearer | sender-constrained | key-bound`. A request below the lane's floor MUST be refused with `sender_constraint_missing`. An audit fact MUST record the assurance actually used. A bearer fallback MUST NOT inherit a sender-constrained label (invariant `sender-constraint-no-bearer-downgrade`, `SECURITY/invariants.yaml`).

### 2.4 Delegation proofs (§B.5)

The proof format is lane-scoped: mTLS key binding or DPoP for the two JWT lanes (`oauth2`, `oidc`), SVID chains for `workload`. A host MUST advertise the proofs it accepts under `auth.lanes[].delegationProofs[]` (`mtls-key-binding | dpop | svid-chain`). A chain with no acceptable proof MUST be refused as `identity_unverified`. The chain rules keep their codes: a chain longer than the bound is `delegation_chain_too_long`, a cyclic chain is `delegation_chain_cyclic`, and a link that widens scope is `delegation_scope_amplified` (invariants `delegation-chain-bounded-acyclic`, `delegation-no-scope-amplification`, `delegation-provenance-not-authorization`).

## 3. The link is a record (RFC 0170 §C; `schemas/v2/subject-link.schema.json`)

```json
{ "a": { "issuer": "…", "subjectId": "…" }, "b": { "issuer": "…", "subjectId": "…" },
  "keyClass": "opaque-idp" | "configured-immutable", "issuer": "<IdP entityID>",
  "tenant": "<tenantId>", "formedAt": "<date-time>", "deniedAt"?: "<date-time>" }
```

The record and both `SubjectRef`s are closed; `a`, `b`, `keyClass`, `issuer`, `tenant`, `formedAt` are REQUIRED. A link MUST be tenant-scoped, MUST join exactly two subjects whose `issuer` values are bound to one IdP entityID (`issuer` on the record), and MUST NOT include a legacy (`urn:openwop:legacy` is schema-rejected) or anonymous subject. Deactivation sets `deniedAt`; the SAML decision path MUST consult it (the leaver contract). The link is a reference, not a merge: nothing rewrites a subject already stamped on a run.

`auth.subjectLinking` is removed (`capabilities.md` row `C2.5`): advertising both `saml` and `scim` lanes implies the contract. Lanes stay separate facets; there is no single "enterprise identity" profile. The `auth.subjectLinkKey` facet (`opaque-idp | configured-immutable`) names the key class the host forms links under. Invariant `subject-link-record-shape` is registered with its scenario.

## 4. Resume tokens (RFC 0170 §E.1; RFC 0176 §B.2)

An interrupt resume token is `ow2.<alg>.<kid>.<payload>.<mac>`: `alg ∈ {hs256}` at the cut (`interrupt.tokenAlgs[]` advertises it), `kid` (`keyId` grammar) selects the verification secret, `payload` and `mac` as in v1. A host MUST refuse a token whose `alg` it does not advertise or whose `kid` it does not hold with `401` `interrupt_token_invalid`. The `{token}` path parameter carries the grammar (`api/v2/openapi.yaml`).

An issued v1 two-segment token MUST remain resolvable under `kid: legacy` until its `expiresAt`; a run suspended on an interrupt at the cut continues under `persistence.md` and its outstanding token resolves the same way. Interrupt semantics are `interrupt.md`.

## 5. Identifier grammars (`schemas/v2/ids.schema.json`)

Every id field in every v2 schema and every `api/v2/openapi.yaml` parameter and response body MUST `$ref` its kind. `x-openwop-minted` records who mints the id: `host` (opaque and checkable), `author` (chosen in a workflow or pack; the v1 grammar stands), or `registry`.

| Kinds | Grammar | Minted |
| --- | --- | --- |
| `runId`, `interruptId`, `subscriptionId`, `deliveryId`, `effectId` | tenant-bound `<tenantId>/<opaque>`: `^[A-Za-z0-9._~-]{1,128}/[A-Za-z0-9._~-]{16,128}$` | host |
| `eventId` | `^[A-Za-z0-9._~-]{16,128}$` | host |
| `tenantId`, `workspaceId` | `^[A-Za-z0-9._~-]{1,128}$` | host |
| `subjectId` | `^[^\s/]{1,256}$` (the issuer's grammar) | host |
| `traceId`, `spanId` | W3C `^[0-9a-f]{32}$`, `^[0-9a-f]{16}$` | host |
| `keyId` | `^[A-Za-z0-9._~-]{1,128}$` (signing keys, resume-token `kid`, bundle signatures) | registry |
| `nodeId`, `workflowId`, `agentId`, `chainId`, `pluginId`, `templateId`, `libraryId` | `^[A-Za-z0-9._~:-]{1,128}$` | author |
| `typeId` | `^[a-z][a-z0-9-]*(\.[a-z][a-zA-Z0-9-]*)+$` | author |

A host MUST reject a tenant-bound id whose tenant segment is not the caller's with `403` `id_tenant_mismatch`. A host-minted opaque segment MUST match `^[A-Za-z0-9._~-]{16,128}$`: no `@`, no whitespace, no `/`. Handle grammars (`memoryRef`, workspace `path`/`etag`, the plugin version token) and their `resolvability` class are specified where each handle is used; an importer MUST re-mint every `host`-scoped handle (`spec/v2/ext/portability/`).

## 6. Identity error codes (`spec/v2/errors.json`)

Every code below is a row with `since: "2.0"`, `retriable: false`, and no `details` contract; the envelope is `errors.md`.

| Code | HTTP | Raised when |
| --- | --- | --- |
| `identity_unverified` | 401 | the credential fails verification against the lane's trust root, or a delegation chain has no acceptable proof |
| `identity_unresolvable` | 401 | a verified identity resolves to no Subject |
| `audience_mismatch` | 401 | the credential's audience is not this host |
| `credential_revoked` | 401 | a revoked key or session is presented (§2.2) |
| `delegation_expired` | 401 | a delegation or workload credential is past its lifetime |
| `sender_constraint_missing` | 401 | the request is below the lane's `minimumAssurance` (§2.3) |
| `delegation_chain_too_long` | 400 | the actor chain exceeds depth 4 |
| `delegation_chain_cyclic` | 400 | the actor chain repeats a subject |
| `delegation_scope_amplified` | 403 | a delegated link claims more scope than its delegator |
| `id_tenant_mismatch` | 403 | a tenant-bound id's tenant segment is not the caller's (§5) |
| `interrupt_token_invalid` | 401 | an unadvertised `alg` or an unheld `kid` (§4) |

`unauthenticated` and `run_forbidden` keep their v1 rows. Every code is a registry member under `overview.md` §0.

## 7. Invariants (RFC 0170 §E.2)

`workload-identity-cryptographically-bound`, `delegation-provenance-not-authorization`, `delegation-no-scope-amplification`, `delegation-chain-bounded-acyclic`, `sender-constraint-no-bearer-downgrade`, `provenance-attestation-digest-bound`, `subject-link-record-shape`, and `subject-required-on-owner` are registered in `SECURITY/invariants.yaml` with their scenarios; an invariant that reaches the cut without a witness is demoted from `protocol` tier and recorded.
