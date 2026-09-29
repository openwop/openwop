# Identity

> **Status: Stable.**
> **Normative home:** `auth`, `authorization`, `anonymousActor`.

## Why this exists

The Subject owns every run. Every lane binds to a trust root and a revocation rule, the link and every id have a grammar, and tokens carry a prefix so a host can rotate them. Idempotency-key grammar is in [idempotency.md](idempotency.md).

## 1. The Subject is the owner

### 1.1 Shape (`schemas/v2/subject.schema.json`)

`RunSnapshot.owner` is `{ tenant, workspace?, subject }` with `subject` REQUIRED. `run.started` MUST echo the same block ([runs.md](runs.md), [events.md](events.md)). The Subject is closed (`additionalProperties: false`):

| Field | Rule |
| --- | --- |
| `issuer` | REQUIRED; the lane's trust root (§2.2); `^\S+$`, 1–1024 |
| `subjectId` | REQUIRED; `ids.schema.json#/$defs/subjectId` — issuer-scoped, stable, opaque, never PII |
| `tenant` | REQUIRED; `tenantId` |
| `lane` | REQUIRED; `api-key \| oauth2 \| oidc \| mtls \| saml \| scim \| ldap \| workload \| session \| anonymous` |
| `kind` | REQUIRED; `user \| agent \| anonymous \| workload` |
| `keyClass` | `opaque-idp \| configured-immutable`; MUST be present iff `lane ∈ {saml, scim}` |
| `actor` | OPTIONAL; a nested Subject that acts on this subject's behalf; depth bounded at four |

- `kind: anonymous` REQUIRES `lane: anonymous`, and `lane: anonymous` REQUIRES `kind: anonymous`.
- The `actor` depth bound (4) is a four-level `$ref` chain (`actor1`…`actor4`), not a recursive `$ref`. A fifth level MUST fail validation.
- `session` is a host-native credential the host itself issued (a durable login session, a local password). `anonymous` is a public surface.
- The lane enum grows only under [overview.md](overview.md) §0.

### 1.2 The legacy subject rule

A run created before the host began emitting subjects has a legacy subject:

- On every read, the host MUST stamp `issuer: "urn:openwop:legacy"`, `lane` as attested else `api-key`, and `kind` as recorded else `user`.
- A host MUST stamp the legacy subject at first read and MUST NOT rewrite it later.
- A legacy subject MUST NOT participate in a link (§3), an actor chain, or a delegation decision.

### 1.3 Fork

On fork the host MUST copy `owner` verbatim onto the child: `tenant`, `workspace` and `subject`.

### 1.4 A2A anonymous end users

An end user reaching the host through an A2A peer is `kind: anonymous`, `lane: anonymous`, with the forwarding peer's subject as `actor`. Such a subject MUST NOT be linked.

### 1.5 `anonymousActor`

A public agent surface is an operator-configured entry point for unauthenticated callers. A host advertising `anonymousActor` MUST give a run dispatched through one an anonymous subject.

- **The subject.** Its `subjectId` MUST be host-minted, opaque, PII-free and scoped to one surface session. It MUST NOT correlate two sessions or resolve to another subject, workspace or session.
- **Authority.** The subject's only authority is the surface's explicit tool allowlist. A host MUST NOT resolve a role, scope or default tool baseline for it, or widen it within a session.
- **`failClosed`.** A call whose grant is absent, unresolvable or errors MUST be denied.
- **`tiers`.** A host MUST list only tiers it enforces:
  - `read` — tenant-scoped tools with no egress and no secret or BYOK reach;
  - `bounded-write-egress` — writes or egress behind a control, over the SSRF-guarded egress path, attaching a credential only when its audience covers the destination and policy permits anonymous use.
- **`writeEgressControls`.** REQUIRED when `bounded-write-egress` is listed, and absent otherwise: `hitl` or `rate-limit-session-cap` (a hard rate limit plus a per-session action cap).
- **Audit.** Every anonymous tool call MUST emit `authorization.decided` carrying no PII or credential. A denial's `reason` is `anon-not-granted`, `anon-write-ungated` or `anon-egress-denied`.

`listTools` scoped to the subject reads the effective grant.

## 2. One binding pipeline, every lane

### 2.1 The pipeline

Every lane MUST verify the credential against the lane's trust root; bind the verified identity to the request, never to an asserted header; check audience; resolve to a Subject before any authorization decision; and fail closed.

- On the `oidc` lane an ID token MAY be a bearer only when its `aud` equals the host's configured audience; any other `aud` is `audience_mismatch`.
- The closed reason vocabulary is the family-wide error set in §6.

Every lane is advertised as one member of the `auth.lanes[]` facet (`spec/v2/facets/auth.schema.json`):

```json
{ "lane": "oidc", "issuers": ["https://idp.example"], "revocation": "exp-and-recheck",
  "revocationWindowSeconds": 300, "minimumAssurance": "sender-constrained",
  "delegationProofs": ["dpop"] }
```

`lane`, `issuers[]` (min 1), `revocation` and `minimumAssurance` are REQUIRED on each member. `auth.lanes[].issuers[]` is the realm ([capabilities.md](capabilities.md)).

`authorization.failClosed` advertises the fail-closed rule and MUST be `true` when present; it does not gate it (invariant `authorization-fail-closed`). `authorization.roles` is the host role catalog: a request is authorized when any role-derived scope matches the required scope, under the same scope-match semantics this document applies to a credential.

### 2.2 Trust roots and revocation

Every lane MUST name its trust root as `subject.issuer` and MUST advertise it in `issuers[]`. Revocation exists for every lane; the `revocation` value names the rule.

| Lane | `subject.issuer` (trust root) | Revocation MUST | `revocation` |
| --- | --- | --- | --- |
| `api-key` | the key realm (`urn:<host>:api-key` or a host-chosen URI) | refuse a revoked key on the next request (`credential_revoked`) | `next-request` |
| `oauth2` | the token issuer | honor `exp` and re-check the issuer within the advertised `revocationWindowSeconds`; or honor `exp` alone under an enforced lifetime bound (`exp-only`, below) | `exp-and-recheck \| exp-only` |
| `oidc` | `iss` | as `oauth2` | `exp-and-recheck \| exp-only` |
| `mtls` | the CA subject | check CRL or OCSP, or issue certificates whose lifetime is at most the advertised window | `crl \| ocsp \| short-lived` |
| `saml` | the IdP entityID (`<saml:Issuer>`) | honor `NotOnOrAfter`; consult the SCIM link deny-set when both lanes are advertised (§3) | `not-on-or-after` |
| `scim` | the SCIM connection id bound at configuration to one IdP entityID | bind each client credential to one IdP entityID; refuse an unbound request | `bound-connection` |
| `ldap` | the directory base DN | re-bind on each request or advertise a session window | `rebind` |
| `workload` | the scheme's trust root | enforce `delegation_expired` | `delegation-expiry` |
| `session` | `urn:<host>:session` | refuse a revoked session on the next request (`credential_revoked`) | `next-request` |
| `anonymous` | `urn:<host>:anon-surface` | — | — |

- `revocationWindowSeconds` (integer ≥ 1) MUST be advertised wherever the rule names a window: `exp-and-recheck`, `exp-only`, `short-lived`, `rebind`. On every lane it is an upper bound on the interval between a revocation at the trust root and the host's first refusal. A host MUST NOT advertise a window it does not enforce.
- A host MUST NOT advertise a `revocation` value the row above for its lane does not list.
- A consumer meeting an unrecognized value MUST NOT act on it: it MUST read the lane as stating no revocation latency, never as `next-request` or any other member ([overview.md](overview.md) §0).

#### `exp-only`

`exp-only` names a host that honors `exp` and never re-checks revocation: it consults no introspection endpoint, userinfo endpoint, revocation list, or host-side epoch or `validAfter` record. A credential revoked at the trust root is accepted until its own `exp`, so the enforced window is the only bound.

- A host advertising `exp-only` on a lane MUST refuse a credential presented on that lane with `401 credential_lifetime_exceeded` when **either** `exp − iat` (total lifetime) **or** `exp − now` (remaining lifetime) exceeds the advertised `revocationWindowSeconds`.
- A credential carrying no `iat` MUST be refused with the same code (§2.1 fail-closed).
- A host that cannot enforce both bounds MUST NOT advertise `exp-only`.
- `exp-only` SHOULD be advertised with a window of one hour or less. No maximum is set.
- `exp-only` MUST NOT be advertised on the `api-key` or `session` lane; `auth.schema.json` refuses that pairing (invariant `lane-exp-only-lifetime-bounded`).

### 2.3 Minimum assurance

- Each lane MUST advertise `minimumAssurance: bearer | sender-constrained | key-bound`.
- A request below the lane's floor MUST be refused with `sender_constraint_missing`.
- An audit fact MUST record the assurance actually used.
- A bearer fallback MUST NOT inherit a sender-constrained label (invariant `sender-constraint-no-bearer-downgrade`, `SECURITY/invariants.yaml`).

### 2.4 Delegation proofs

The proof format is lane-scoped: mTLS key binding or DPoP for the two JWT lanes (`oauth2`, `oidc`), SVID chains for `workload`.

- A host MUST advertise the proofs it accepts under `auth.lanes[].delegationProofs[]` (`mtls-key-binding | dpop | svid-chain`).
- A chain with no acceptable proof MUST be refused as `identity_unverified`.
- A chain longer than the bound is `delegation_chain_too_long`, a cyclic chain is `delegation_chain_cyclic`, and a link that widens scope is `delegation_scope_amplified` (invariants `delegation-chain-bounded-acyclic`, `delegation-no-scope-amplification`, `delegation-provenance-not-authorization`).

### 2.5 Protected-resource metadata and challenges

A host advertising an `oauth2` or `oidc` lane MUST serve RFC 9728 metadata, unauthenticated, at the well-known URI formed from its resource identifier (the base URL it serves this API under) with `/.well-known/oauth-protected-resource` inserted before any path: `https://h.example/api` → `https://h.example/.well-known/oauth-protected-resource/api`.

- `resource` MUST equal that identifier.
- `authorization_servers` MUST list exactly the URL-form issuers of those lanes.
- `scopes_supported` MUST list the scopes the host enforces.
- `dpop_bound_access_tokens_required` or `tls_client_certificate_bound_access_tokens` MAY be `true` only where every such lane's `minimumAssurance` requires that binding (§2.3).

Challenges on such a host:

- A `401` MUST carry `WWW-Authenticate: Bearer resource_metadata="<url>"`, adding `error="invalid_token"` when a credential was presented and no error code when none was.
- A `403` for insufficient scope MUST carry `error="insufficient_scope"` with `scope` listing every scope the operation requires. A `403` for resource binding carries no `insufficient_scope`.

Other hosts SHOULD send `WWW-Authenticate: Bearer` on a `401`. A challenge attaches only to a response already `401` or `403` and MUST NOT change a status: where a rule requires `404` for an unknown or unauthorized resource, the `404` stands and carries none (invariant `auth-challenge-no-oracle`).

## 3. The link is a record

A subject link is a `schemas/v2/subject-link.schema.json` record:

```json
{ "a": { "issuer": "…", "subjectId": "…" }, "b": { "issuer": "…", "subjectId": "…" },
  "keyClass": "opaque-idp" | "configured-immutable", "issuer": "<IdP entityID>",
  "tenant": "<tenantId>", "formedAt": "<date-time>", "deniedAt"?: "<date-time>" }
```

The record and both `SubjectRef`s are closed; `a`, `b`, `keyClass`, `issuer`, `tenant`, `formedAt` are REQUIRED. A link:

- MUST be tenant-scoped;
- MUST join exactly two subjects whose `issuer` values are bound to one IdP entityID (`issuer` on the record);
- MUST NOT include a legacy (`urn:openwop:legacy` is schema-rejected) or anonymous subject.

Deactivation sets `deniedAt`; the SAML decision path MUST consult it (the leaver contract). The link is a reference, not a merge: nothing rewrites a subject already stamped on a run.

Advertising both `saml` and `scim` lanes implies the link contract. The `auth.subjectLinkKey` facet (`opaque-idp | configured-immutable`) names the key class the host forms links under.

## 4. Resume tokens

An interrupt resume token is `ow2.<alg>.<kid>.<payload>.<mac>`:

- `alg ∈ {hs256}`, advertised in `interrupt.tokenAlgs[]`;
- `kid` (`keyId` grammar) selects the verification secret;
- `payload` and `mac` are as in v1.

A host MUST refuse a token whose `alg` it does not advertise or whose `kid` it does not hold with `401` `interrupt_token_invalid`. The `{token}` path parameter carries the grammar (`api/v2/openapi.yaml`). Interrupt semantics are in [interrupt.md](interrupt.md).

A token not `ow2.`-prefixed was issued under v1; the rule is the prefix, never a segment count. Such a token MUST remain resolvable under `kid: legacy` until its `expiresAt`. A run suspended on an interrupt at the cut continues under [persistence.md](persistence.md), and its outstanding token resolves the same way.

## 5. Identifier grammars (`schemas/v2/ids.schema.json`)

Every id field in every v2 schema and every `api/v2/openapi.yaml` parameter and response body MUST `$ref` its kind. `x-openwop-minted` records who mints the id: `host` (opaque and checkable), `author` (chosen in a workflow or pack), or `registry`.

| Kinds | Grammar | Minted |
| --- | --- | --- |
| `runId`, `interruptId`, `subscriptionId`, `deliveryId`, `effectId` | tenant-bound: `^(anon:)?[A-Za-z0-9._~-]{1,128}/[A-Za-z0-9._~-]{16,128}$` | host |
| `eventId` | `^[A-Za-z0-9._~-]{16,128}$` | host |
| `tenantId`, `workspaceId` | `^[A-Za-z0-9._~-]{1,128}$` | host |
| `subjectId` | `^[^\s/]{1,256}$` (the issuer's grammar) | host |
| `traceId`, `spanId` | W3C `^[0-9a-f]{32}$`, `^[0-9a-f]{16}$` | host |
| `keyId` | `^[A-Za-z0-9._~-]{1,128}$` (signing keys, resume-token `kid`, bundle signatures) | registry |
| `nodeId`, `workflowId`, `agentId`, `chainId`, `pluginId`, `templateId`, `libraryId` | `^[A-Za-z0-9._~:-]{1,128}$` | author |
| `typeId` | `^[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$`, maxLength 256 | author |

`spec/v2/id-field-bindings.json` sorts every `*Id` property in a v2 schema into two sets: it **is** a kind above (and MUST `$ref` it), or nothing here governs it (reason recorded).

- A host MUST reject a tenant-bound id whose tenant segment is not the caller's with `403` `id_tenant_mismatch`.
- A host-minted opaque segment MUST match `^[A-Za-z0-9._~-]{16,128}$`.
- Ids in documents and bodies are bound, always. A client MAY bind at its request seam.
- Handle grammars (`memoryRef`, workspace `path`/`etag`, the plugin version token) and their `resolvability` class are specified where each handle is used. An importer MUST re-mint every `host`-scoped handle ([portability.md](portability.md)).

### Wire form

On the wire a tenant-bound id is one path segment, projected: every UTF-8 byte outside `[A-Za-z0-9._-]` becomes `~` plus two uppercase hex digits, so `acme/r-9f3c…` travels as `acme~2Fr-9f3c…`.

- A host MUST emit the projected form in every link and MUST accept it on every tenant-bound parameter.
- It MUST still accept `tenant%2Fopaque`, and MUST decode either form before matching the grammar.
- A host MUST NOT mint a tenant-bound id containing `~`; ids already minted MUST still resolve.
- A host MUST project exactly once, where an id leaves it, and MUST NOT re-encode its own output.

### Bare ids during the v1 overlap

Through the overlap the bare form is admitted on a major-2 path parameter.

- A parameter carrying only the opaque segment (what a `/v1/` create hands out) MUST resolve under the caller's tenant and never another's, and the response MUST name the resource bound ([versioning.md](versioning.md) §5). The credential supplies the segment the `403` check would read.
- Once a host advertises no `1.x` member it MUST refuse the bare form `400 validation_error` (not `id_tenant_mismatch`, not `not_found`).

## 6. Identity error codes (`spec/v2/errors.json`)

Every code below is a row with `retriable: false` and no `details` contract; the envelope is in [errors.md](errors.md).

| Code | HTTP | Raised when |
| --- | --- | --- |
| `identity_unverified` | 401 | the credential fails verification against the lane's trust root, or a delegation chain has no acceptable proof |
| `identity_unresolvable` | 401 | a verified identity resolves to no Subject |
| `audience_mismatch` | 401 | the credential's audience is not this host |
| `credential_revoked` | 401 | a revoked key or session is presented (§2.2) |
| `credential_lifetime_exceeded` | 401 | a credential on an `exp-only` lane exceeds the advertised lifetime bound, or carries no `iat` (§2.2) |
| `delegation_expired` | 401 | a delegation or workload credential is past its lifetime |
| `sender_constraint_missing` | 401 | the request is below the lane's `minimumAssurance` (§2.3) |
| `delegation_chain_too_long` | 400 | the actor chain exceeds depth 4 |
| `delegation_chain_cyclic` | 400 | the actor chain repeats a subject |
| `delegation_scope_amplified` | 403 | a delegated link claims more scope than its delegator |
| `id_tenant_mismatch` | 403 | a tenant-bound id's tenant segment is not the caller's (§5) |
| `interrupt_token_invalid` | 401 | an unadvertised `alg` or an unheld `kid` (§4) |

`unauthenticated` and `run_forbidden` also apply. Every code is a registry member under [overview.md](overview.md) §0.

## 7. Invariants

The identity invariants are registered in `SECURITY/invariants.yaml` with their scenarios. An invariant without a witness is demoted from `protocol` tier.

*Sources: RFCs 0132, 0165, 0170, 0176, 0184, 0200, 0210.*
