# RFC 0170: v2 identity — Subject required, one binding pipeline per lane, the link as a typed record, grammars for every id and handle, token agility

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0170                                                            |
| **Title**         | v2 identity: the RFC 0165 Subject is the required owner record and the bare `owner.principal` string is removed; the legacy subject rule is normative on every read of a pre-v2 run; the lane vocabulary gains `session` and `anonymous`; every lane binds a named trust root through RFC 0154's verify → bind → audience → resolve → fail-closed pipeline with the closed reason vocabulary and a per-lane minimum-assurance policy, and a revocation rule exists for every lane; `SubjectLink` is a schema and a registered invariant; one id grammar per id kind (tenant-bound where the invariant needs it), one handle grammar with a declared resolvability scope for the four opaque handles; the idempotency entropy floor and retention minimums become MUSTs; interrupt resume tokens carry a versioned scheme prefix; RFC 0154's six named-but-unregistered invariants are registered or demoted |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-03                                                      |
| **Updated**       | 2026-09-03 (`Draft → Active` in the filing PR. **Comment window waived** under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md`; RFC 0001 §5 cross-org rule not yet active; RFC 0147 §A.6 overridden and named in the parent, RFC 0167 — this child touches identity and authorization directly. Adversarial review recorded below.) · 2026-09-03 (filed) |
| **Affects**       | **Part of: RFC 0167 — child C3.** v2 (Phase 3): `schemas/v2/subject.schema.json` (lane enum +2; `actor` depth bound expressed), `schemas/v2/subject-link.schema.json` (NEW), `schemas/v2/run-snapshot.schema.json` (owner: `subject` required, `principal` removed), `schemas/v2/ids.schema.json` (NEW, one `$defs` entry per id kind and handle), `spec/v2/core/identity.md` (replaces the auth-family binding text with one pipeline per lane), `spec/v2/core/idempotency.md` (entropy + retention MUSTs), `spec/v2/core/interrupt.md` (token scheme), `SECURITY/invariants.yaml` (RFC 0154 §F six + `subject-link-record-shape`; Phase 3 with tests). v1.x (this PR, data only): `spec/v1/migrations.json` rows `openwop.migration.C3.1`–`C3.10`; deprecation row `interrupt-token-unversioned` (`proposed`); register rows |
| **Compatibility** | `breaking` (v2). Nothing in v1.x changes in this PR |
| **Supersedes**    | — (RFC 0048, 0132, 0154, 0159, 0163, 0164, 0165 remain the v1 authorities) |
| **Superseded by** | —                                                               |

## Summary

v1 identity is a bare string that eight lanes mint by eight undocumented rules, a trust root named on the wire by two lanes, no revocation MUST anywhere in the corpus, a leaver contract that exists as prose and a host-internal deny set with no record shape, 305 of 329 id and ref fields with no grammar, four opaque handles that three documents declare non-portable and one document promises are portable, an idempotency key whose only entropy guidance is a client-side suggestion after a real privilege escalation through it, and an interrupt token whose rotation rule references a version discriminator the token format does not contain. v2 makes the Subject the owner record, gives every lane one binding pipeline and a revocation rule, gives the link a schema, gives every id kind and handle a grammar with a declared scope, and gives tokens a scheme prefix.

## Motivation

- **The record exists; the requirement does not.** RFC 0165 landed `subject.schema.json` as optional beside `owner.principal` (`run-snapshot.schema.json:48`, a `minLength: 1` string) because tightening `principal` was a §2.2 break (RFC 0165 §B.4). Both hosts now emit it (openwop-app #3631, MyndHyve #238). v2 is the moment it becomes required and the string is removed.
- **A floor is not a lane.** RFC 0165 G6: neither host's native session credential nor the RFC 0132 anonymous surface has a lane; both use §B.3's `api-key` floor with an honest issuer. The enum needs `session` and `anonymous`, or `lane` is wrong on every such run.
- **Trust roots, revocation, assurance.** Of eight lanes, OIDC and workload name an issuer on the wire; SAML names a configured certificate; api-key, mTLS, SCIM, and LDAP name nothing (`auth-profiles.md:30, 53–56, 136, 148`). A grep for `CRL|OCSP|certificate revocation` across the entire repository returns zero. One lane (workload) has a minimum-assurance policy and its downgrade-audit leg is absent (RFC 0154 R3). RFC 0154's pipeline (`auth.md:210`) is the best text in the family and binds only its own lane.
- **The link is unrepresented.** `grep subjectLink schemas/` finds the advertisement flag and the key class; no schema carries `{a, b, keyClass, issuer, tenant, formedAt, deniedAt}`. The deny set that the leaver contract depends on is host-internal.
- **Grammar.** 305 of 329 `*Id`/`*Ref` field sites carry no `pattern`; 100 of 116 distinct id names are never patterned; `templateId` has two different patterns in two schemas; `memoryRef` is a bare string in two schemas and bounded in a third; `runId` is `minLength 1, maxLength 128` inbound (`openapi.yaml:2477`) and an unconstrained string in six response bodies. `tenantId` and `scopeId` in `workflow-definition.schema.json` are unconstrained strings. The interrupt `token` path parameter has no constraint at all (`openapi.yaml:1744`).
- **Handles.** `memoryRef` (`agent-memory.md:19`), workspace `path`/`etag` (`agent-workspace.md:89`, which contradicts `:9` and `:55` of the same file), the plugin `version` token (`frontend-plugin-packs.md:193`), and `{{params.*}}` (`workflow-chain-packs.md:180`, WCP4) each say "v1.x silent" or "non-portable"; `portability.md` covers none of them.
- **Idempotency.** `idempotency.md:113–120` and RFC 0150 §32 record a real privilege escalation through an unvalidated `Idempotency-Key`; `invariants.yaml:1658` admits the compensating invariant is not black-box witnessable. I4 says "consider 128 bits"; I2 says L2 retention is RECOMMENDED while L1's numbered rule already says MUST.
- **Tokens.** `interrupt.md:389` gives `base64url(payload) + "." + hmac_sha256(secret, payload)`; `:397` says "the token's algorithm-version discriminator selects which verification secret applies." There is no discriminator in the format.

## Proposal

### §A. The Subject is the owner

**§A.1** `RunSnapshot.owner` in v2 is `{ tenant, workspace?, subject }` with `subject` REQUIRED; `principal` and `principalKind` are removed (`subject.subjectId` and `subject.kind` carry them). `run.started` echoes the same block. RFC 0165 §B.2's equalities become tautologies.

**§A.2** `lane` gains `session` (a host-native credential the host itself issued: a durable login session, a local password) and `anonymous` (an RFC 0132 public surface). `kind: anonymous` REQUIRES `lane: anonymous` and vice versa. `keyClass` stays present iff `lane ∈ {saml, scim}`. The `actor` depth bound (4) is expressed in the schema by a four-level `$ref` chain rather than a recursive `$ref`, so a fifth level fails validation rather than prose.

**§A.3** The legacy rule (RFC 0165 §B.3) is normative on every read of a run created before the host began emitting subjects: `issuer: "urn:openwop:legacy"`, `lane` as attested else `api-key`, `kind` as recorded else `user`; a legacy subject MUST NOT participate in a link, an actor chain, or a delegation decision. A v2 host MUST stamp the legacy subject at first read and MUST NOT rewrite it later.

**§A.4** Fork: `owner` is copied verbatim onto the child (tenant, workspace, subject); the RFC 0165 §B.4 asymmetry (`principal` only SHOULD) disappears with `principal`.

**§A.5** A2A anonymous end users (RFC 0165 §B.6): `kind: anonymous`, `lane: anonymous`, the forwarding peer's subject as `actor`; never linked.

### §B. One binding pipeline, every lane

**§B.1** Every lane MUST implement RFC 0154's pipeline (`auth.md:210`): verify against the lane's trust root; bind the verified identity to the request, never to an asserted header; check audience; resolve to a Subject before any authorization decision; fail closed. The closed reason vocabulary is the family-wide error set: `identity_unverified`, `identity_unresolvable`, `audience_mismatch`, `delegation_expired`, `sender_constraint_missing`, `delegation_chain_too_long`, `delegation_chain_cyclic`, `delegation_scope_amplified`, plus `credential_revoked` (new) — registered in C.4's `errors.json`.

**§B.2** Every lane names its trust root as `subject.issuer` and advertises it: `auth.lanes[]` (C.2 facet) carries `{ lane, issuers[], revocation, minimumAssurance }`. Per lane: api-key → the key realm (`urn:<host>:api-key` or a host-chosen URI); oauth2 → the token issuer; oidc → `iss`; mtls → the CA subject; saml → the IdP entityID (`<saml:Issuer>`); scim → the SCIM connection id bound at configuration to an IdP entityID (RFC 0163 §B.1); ldap → the directory base DN; workload → the scheme's trust root; session → `urn:<host>:session`; anonymous → `urn:<host>:anon-surface`.

**§B.3** Revocation exists for every lane: api-key and session MUST refuse a revoked credential on the next request (`credential_revoked`); oidc and oauth2 MUST honor `exp` and MUST re-check the issuer within an advertised `revocationWindowSeconds` (today's SHOULD at `auth-profiles.md:78` becomes MUST with the window advertised); mtls MUST check revocation status (CRL or OCSP, advertised as `revocation: crl | ocsp | short-lived`) or MUST issue certificates whose lifetime is at most the advertised window; saml MUST honor `NotOnOrAfter` and MUST consult the SCIM link deny-set when both profiles are advertised (RFC 0164); scim MUST bind each client credential to one IdP entityID and refuse an unbound request; ldap MUST re-bind on each request or advertise a session window; workload MUST enforce `delegation_expired`.

**§B.4** Minimum assurance per lane is advertised as `minimumAssurance: bearer | sender-constrained | key-bound`; a request below the lane's floor MUST be refused (`sender_constraint_missing`), and an audit fact MUST record the assurance actually used — RFC 0154 R3's downgrade-audit leg is a v2 scenario. Bearer fallback never inherits a sender-constrained label (invariant `sender-constraint-no-bearer-downgrade`, registered §E).

**§B.5** Delegation proof (RFC 0154 G1) is decided: the proof format is lane-scoped — mTLS key binding or DPoP for the two JWT lanes, SVID chains for workload — and a host advertises which it accepts under `auth.lanes[].delegationProofs[]`; a chain with no acceptable proof is `identity_unverified`. DPoP availability (G2) is measured in Phase 3 across the three SDKs and recorded on the extension record.

### §C. The link is a record

**§C.1** `schemas/v2/subject-link.schema.json`: `{ a: SubjectRef, b: SubjectRef, keyClass, issuer, tenant, formedAt, deniedAt? }` with `SubjectRef = { issuer, subjectId }`, closed. A link MUST be tenant-scoped, MUST join exactly two subjects whose `issuer` values are bound to one IdP entityID (RFC 0163 §B.1), and MUST NOT include a legacy or anonymous subject. Deactivation sets `deniedAt`; the SAML decision path consults it (the leaver contract, RFC 0159/0164). The link is a reference, not a merge: nothing rewrites a subject already stamped on a run.

**§C.2** `auth.subjectLinking` is removed (C.2 row C2.5); advertising both `saml` and `scim` lanes implies the contract (RFC 0164). RFC 0164 G4 (fold the two profiles into one?) is decided **here**, not in C.2: no — lanes stay separate facets; the contract is a consequence of advertising both, and a single "enterprise identity" profile would hide which lane a subject came from. RFC 0164 G2 (realm per lane): `auth.lanes[].issuers[]` is the realm.

**§C.3** RFC 0159 G3 is closed (RFC 0163 §A.1, 2026-09-01: classes, not an attribute allow-list); this RFC does not reopen it.

### §D. Grammars

**§D.1** `schemas/v2/ids.schema.json` defines one `$defs` entry per id kind: `runId`, `nodeId`, `interruptId`, `eventId`, `effectId`, `tenantId`, `workspaceId`, `subjectId`, `agentId`, `typeId`, `chainId`, `pluginId`, `templateId`, `libraryId`, `keyId`, `deliveryId`, `subscriptionId`, `traceId`, `spanId`. Every id field in every v2 schema and every OpenAPI parameter and response body `$ref`s its kind. Where the invariant needs it (`runId`, `interruptId`, `subscriptionId`, `deliveryId`, `effectId`), the grammar is tenant-bound: `<tenantId>/<opaque>`, and a host MUST reject an id whose tenant segment is not the caller's. Opacity is checkable: an id kind that is host-minted MUST match `^[A-Za-z0-9._~-]{16,128}$` after the tenant segment (no `@`, no whitespace, no `/`).

**§D.2** Handles: `memoryRef`, workspace `path`/`etag`, the plugin `version` token, and `{{params.*}}` each get one grammar and a declared `resolvability: run | host | portable`. `memoryRef` and `etag` and the plugin token are `host`; workspace `path` is `portable` (its grammar already is); `{{params.*}}` is replaced by C.10's decision (WCP4) and is `run` until then. `portability.md` §Export lists every `host`-scoped handle an export bundle carries and the rule that an importer MUST re-mint them.

**§D.3** Idempotency: `Idempotency-Key` MUST match `^[A-Za-z0-9._~-]{22,128}$` and carry at least 128 bits of entropy (a UUIDv4 in canonical or base64url form satisfies it); a host MUST reject a key outside the grammar with `idempotency_key_invalid`. Layer 1 retention MUST be ≥ 24h and Layer 2 ≥ 14d (I2). The RFC 0150 escalation becomes structurally impossible: a caller-supplied key that names a host-internal keyspace fails the grammar before it reaches a table.

### §E. Token agility and invariants

**§E.1** Interrupt resume tokens are `ow2.<alg>.<kid>.<payload>.<mac>`: `alg ∈ {hs256}` at the cut, `kid` selects the verification secret, `payload` and `mac` as today. A host MUST refuse a token whose `alg` it does not advertise or whose `kid` it does not hold (`interrupt_token_invalid`). Issued v1 two-segment tokens remain resolvable under `kid: legacy` until their `expiresAt` (C.9 disposition). The `token` path parameter gains the grammar.

**§E.2** RFC 0154 §F's six invariants (`workload-identity-cryptographically-bound`, `delegation-provenance-not-authorization`, `delegation-no-scope-amplification`, `delegation-chain-bounded-acyclic`, `sender-constraint-no-bearer-downgrade`, `provenance-attestation-digest-bound`) plus `subject-link-record-shape` and `subject-required-on-owner` are registered in `SECURITY/invariants.yaml` in Phase 3 with their scenarios (RFC 0167 §C rule: not before the tests exist); an invariant that reaches the cut without a witness is demoted from `protocol` tier and recorded.

## Migration table

| Row | Kind | v1 | v2 | Codemod | Persisted data |
| --- | --- | --- | --- | --- | --- |
| `openwop.migration.C3.1` | require | `owner.subject` optional; `owner.principal` bare string | Subject required; `principal` removed | — (the §A.3 legacy stamp, not a rewrite) | legacy-stamped |
| `openwop.migration.C3.2` | remove | `capabilities.auth.subjectLinking` | none — advertising both lanes implies the contract | `openwop.codemod.discovery-document-v2` | not-persisted |
| `openwop.migration.C3.3` | add | none | `subject-link.schema.json`; `SubjectLink` records with `deniedAt` | — | not-persisted (host-internal deny sets are re-expressed as records; no wire artifact existed) |
| `openwop.migration.C3.4` | add | lane enum of 8 | + `session`, `anonymous`; `kind: anonymous` ⇔ `lane: anonymous` | — | legacy-stamped (a v1 subject minted with the `api-key` floor for a session reads back with `lane: session` only if the host attested it; else stays as stamped) |
| `openwop.migration.C3.5` | require | 305 of 329 id/ref sites unpatterned; `runId` unconstrained in six response bodies | `ids.schema.json` kinds; tenant-bound where the invariant needs it | — (ids are minted, not rewritten; a v1 id that fails the v2 grammar is read through the C.9 adapter) | translated |
| `openwop.migration.C3.6` | add | four handles "v1.x silent" | one handle grammar with `resolvability: run \| host \| portable` | — | unchanged |
| `openwop.migration.C3.7` | require | `Idempotency-Key` free-form; L2 retention RECOMMENDED | grammar + 128-bit floor + `idempotency_key_invalid`; L1 ≥ 24h, L2 ≥ 14d MUST | — | drained (cached v1 keys expire under their own retention) |
| `openwop.migration.C3.8` | behavior | `base64url(payload).mac` interrupt token; rotation rule names a nonexistent discriminator | `ow2.<alg>.<kid>.<payload>.<mac>`; v1 tokens resolvable under `kid: legacy` until expiry | — (tokens are issued, never rewritten) | drained |
| `openwop.migration.C3.9` | behavior | trust root named by 2 of 8 lanes; no revocation MUST | every lane advertises `{ issuers[], revocation, minimumAssurance, delegationProofs[] }` and binds through one pipeline | — | not-persisted |
| `openwop.migration.C3.10` | behavior | RFC 0154 §F six invariants named, unregistered | registered with tests, or demoted | — | not-persisted |

## Persisted-data disposition

| Store | v1 artifact | Disposition |
| --- | --- | --- |
| Run rows / documents (openwop-app SQL `runs.metadata.principalKind` + `metadata.anonPrincipal`, projected to the wire `owner` triple — corrected 2026-09-03 by RFC 0176 §D.5: there is no `metadata.owner` key; MyndHyve `RunDoc.subject`) | stamped subjects from RFC 0165 legs | unchanged; pre-stamp rows legacy-stamped at first v2 read and never rewritten |
| Event logs (`run.started` owner echo) | `principal` + optional `subject` | translated by the C.9 reader (the `principal` field is dropped on read; `subject` is the record) |
| Interrupt tokens outstanding at the cut | two-segment HMAC tokens | drained: resolvable under `kid: legacy` until `expiresAt`; new tokens carry the prefix |
| Idempotency caches | free-form keys | drained under their own retention |
| Audit logs (openwop-app `audit_log.principal_id`) | bare principal strings | never-upgraded; audit facts are historical records |
| SubjectLink deny sets (host-internal) | tables/sets | translated to `SubjectLink` records with `deniedAt`; Phase 4 per host |

## Compatibility

`breaking` (v2). This PR changes nothing in v1.x. The v1.x conformance pass is untouched; the v2 shapes land in `schemas/v2/` in Phase 3.

## Conformance

v2 scenarios (suite 2.0.0): `owner-subject-required` (unaided: a snapshot without `subject` fails; `principal` present fails), `legacy-subject-read` (gated on a host with pre-v2 history: the C.9 fork-a-v1-run scenario reads the legacy stamp), `lane-issuer-advertised` (unaided: every advertised lane names issuers, revocation, minimumAssurance), `revocation-honored` (seam-gated per lane; the §20 seam family grows one leg per lane), `assurance-downgrade-audited` (seam-gated; RFC 0154 R3), `subject-link-record` (seam-gated; RFC 0163's SCIM+SAML seams produce a record and a `deniedAt`), `id-grammar` (unaided: every id in every response matches its kind; a foreign-tenant id is refused), `idempotency-key-grammar` (unaided), `interrupt-token-scheme` (unaided: a token without the prefix is refused; a `kid` the host does not hold is refused).

### Falsifiability — one row per normative requirement

| Requirement | Observable | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 subject required, principal absent | snapshot schema validation | the suite, unaided | witnessable — unaided |
| §A.2 lane/kind pairing; actor depth ≤ 4 | schema validation | the suite, unaided | witnessable — unaided |
| §A.3 legacy stamp on pre-v2 reads; never rewritten | fork-a-v1-run scenario | a host with history (C.9) | witnessable — gated |
| §B.1 pipeline reason codes | refusal envelopes | the suite via seams (§20 family) | seam-gated |
| §B.2 issuers advertised per lane | discovery document | the suite, unaided | witnessable — unaided |
| §B.3 revocation per lane | a revoked credential is refused | the suite via a per-lane revoke seam | seam-gated |
| §B.4 assurance floor + downgrade audit | refusal + audit fact | the suite via the workload seam | seam-gated |
| §C.1 link record shape; no legacy/anon in a link | schema + seam | the suite via the SCIM/SAML seams | seam-gated |
| §D.1 id grammar; tenant binding refused | responses; a crafted foreign id | the suite, unaided | witnessable — unaided |
| §D.3 key grammar and entropy floor | `idempotency_key_invalid` | the suite, unaided | witnessable — unaided |
| §E.1 token scheme | refusal of an unprefixed or unknown-kid token | the suite, unaided | witnessable — unaided |
| §E.2 invariants registered with tests at the cut | `check-security-invariants.sh` | the corpus gate | witnessable — unaided (corpus) |

## Adversarial review

1. **The Subject MUST is unenforceable while `runStarted` is `additionalProperties: true`** (`run-event-payloads.schema.json`, 63 of 120 defs open). Disposition: named as a dependency on C.4 §B (closed payload registry); this RFC's `owner-subject-required` scenario validates the snapshot, and the echo leg validates only once C.4's closure lands — recorded in the PR C sequencing (both land together).
2. **RFC 0164 G4 (fold the profiles) is a discovery decision C.2 also owns.** Disposition: decided here (§C.2: no fold) and cross-referenced from RFC 0169's register so both children cite one decision.
3. **"Revocation for every lane" makes mTLS require CRL/OCSP that no host has.** Disposition: §B.3 allows short-lived certificates with an advertised lifetime as the revocation mechanism; the host advertises which; a host with none cannot advertise `mtls`.
4. **Tenant-bound ids (`<tenantId>/<opaque>`) change the shape of `runId` on every path.** Disposition: yes, in v2 only; the C.9 reader maps v1 ids into the v2 form for reads of v1 runs; SDK 2 types carry the kind. Row C3.5 is `translated`.
5. **A 22-character minimum on `Idempotency-Key` breaks clients that send short keys.** Disposition: in v2 they receive `idempotency_key_invalid`, which is the point; the RFC 0150 escalation used a short structured key. UUIDv4 (36) and base64url-128-bit (22) both pass.
6. **The token scheme's `kid: legacy` keeps the old two-segment format alive indefinitely.** Disposition: only until each token's `expiresAt`, which `interrupt.md:393` caps at the interrupt's `timeoutMs`; row C3.8 is `drained`.
7. **Eight invariants registered "in Phase 3 with tests" is the deferral pattern the charter names.** Disposition: RFC 0167 §C's rule; the falsifiability table above names the witness class of each now, and an invariant with no test at the cut is demoted and recorded, not carried.
8. **Charter corrections carried:** RFC 0159 G3 is closed, not open; `runId` has `minLength` inbound (the defect is the six unconstrained response bodies and the missing tenant binding); the grammar counts are 305/329 sites and 100/116 names.

## Alternatives considered

1. Keep `principal` beside `subject` in v2. Rejected: two names for one thing (Axiom 2) and the RFC 0165 §B.4 asymmetry persists.
2. Make `lane` optional with `issuer` authoritative (RFC 0165 G6's second option). Rejected: a consumer needs the lane to know which revocation and assurance rules apply; adding two lanes is the smaller change.
3. Leave revocation to hosts. Rejected: a leaver contract with no revocation MUST on six lanes is a contract with holes in it.
4. Do nothing. Rejected: the RFC 0150 escalation happened.

## Unresolved questions

1. Whether `tenantId` itself needs a grammar beyond `^[A-Za-z0-9._~-]{1,128}$` (host-minted vs operator-chosen). Decided in Phase 3 with the ids schema.
2. Whether `keyClass` extends to `oidc` (a stable `sub` is `opaque-idp` by the same argument). Decided with the C.8 interop threat model.

## Implementation notes (non-normative)

Phase 3 lands the v2 schemas and `spec/v2/core/identity.md`; openwop-app's `host/runOwner.ts` and MyndHyve's `host/ownerSubject.ts` already mint subjects per lane and need only the two new lanes and the `principal` removal in Phase 4. openwop-app's `SamlPrincipal.issuer` and the SCIM trust-root binding (ADR 0623) are the `SubjectLink` record's inputs.

## Acceptance criteria

- [x] `Draft → Active`: RFC text; rows `C3.1`–`C3.10`; deprecation row `interrupt-token-unversioned`; register rows; ledger row; adversarial review. (This PR.)
- [ ] `Active → Accepted` (Phase 3): `schemas/v2/subject.schema.json`, `subject-link.schema.json`, `ids.schema.json`, the v2 snapshot owner; `spec/v2/core/identity.md`; the eight invariants registered with tests or demoted; the nine scenarios in suite 2.0.0; openwop-app passes `owner-subject-required`, `id-grammar`, `idempotency-key-grammar`, `interrupt-token-scheme` unaided.

## References

- RFC 0167 §A (Axioms 1–3, 6), §B.3, §C, §E.1; RFC 0165 §B, G1, G2, G6; RFC 0164 G2, G4; RFC 0163 §A.1, §B.1; RFC 0159; RFC 0154 §A–§F, G1, G2, R3; RFC 0150 §A (the escalation); RFC 0132 §A; RFC 0048.
- `schemas/subject.schema.json`, `run-snapshot.schema.json`, `capabilities.schema.json` (auth), `workload-identity.schema.json`; `spec/v1/auth.md` §"Workload identity", `auth-profiles.md` (every lane), `agent-memory.md` §memoryRef, `agent-workspace.md`, `frontend-plugin-packs.md`, `workflow-chain-packs.md` WCP4, `idempotency.md` I2/I4 and §"Keyspace separation", `interrupt.md` §"Resume tokens"; `SECURITY/invariants.yaml` (`idempotency-store-no-host-generated-keys`, `subject-*`).
