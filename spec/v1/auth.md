# OpenWOP Spec v1 — Authentication and Authorization

> **Status: Stable · v1.1.** Normative authentication, authorization, identity, and error-envelope contract.
>
> **Status legend** (used across all spec/v1/\*.md). Full policy at [/governance/spec-status/](/governance/spec-status/):
>
> - **Stable** — frozen wire surface under v1.x. Required fields, event payloads, endpoint contracts, and package names cannot change without a v2.
> - **Stabilizing** — comprehensive coverage; required-field set and endpoint shapes locked, but optional fields and behavior coverage are still landing additively.
> - **Draft** — open comment window. Section headings and broad shape are stable, but field schemas and event payloads MAY shift on each weekly RFC roll-up.
> - **Experimental** — sketched coverage of an in-flight surface. Implementers SHOULD pin only to what is explicitly written; assume gaps and breaking shape changes inside v1.x. Hosts MUST NOT advertise an Experimental capability via `/.well-known/openwop` outside of an explicit opt-in profile.
>
> Earlier revisions of this corpus used **FINAL**, **STUB**, **DRAFT**, **OUTLINE** as legend labels. The four-tier vocabulary above is the canonical replacement; **Stable ↔ FINAL** is the only direct synonym.

---

## Scope

This document specifies how OpenWOP-compliant servers authenticate and authorize callers of the protocol's wire-level surfaces (REST, MCP, A2A, SSE). It does NOT prescribe identity-provider semantics; an implementation MAY use any identity provider (Firebase Auth, OAuth 2.0, mTLS, etc.) for human callers, and MUST use the API-key surface defined here for machine callers.

## Authentication models

An OpenWOP-compliant server MUST support **at least one** of the following authentication models. It MAY support multiple in parallel.

### 1. API keys (machine callers)

REQUIRED for any server that exposes the openwop wire surface to non-human callers.

- The server MUST accept the API key in the `Authorization` HTTP header using the `Bearer` scheme: `Authorization: Bearer <key>`.
- The server MUST reject requests missing or malformed `Authorization` headers with HTTP `401 Unauthorized`.
- The server MUST validate the key against persisted records and reject unknown, revoked, or expired keys with HTTP `401 Unauthorized`.
- The server MUST verify the key carries the scope required for the requested operation (see "Scopes" below) and reject scope-insufficient requests with HTTP `403 Forbidden`.
- API keys MUST be stored hashed at rest; comparison MUST use a constant-time function (e.g., bcrypt). Plaintext storage is FORBIDDEN.

#### Key format

The spec does not prescribe the visible prefix; reference implementations are encouraged to use a short, recognizable prefix that distinguishes:

- Live keys from sandbox/test keys (e.g., `live_` vs `test_`)
- The implementation's own keys from those of other systems (e.g., a vendor identifier)

Example schemes from real and hypothetical hosts:

- **Steward's reference host** — two-prefix scheme distinguishing live and sandbox keys, bcrypt-hashed, stored under a host-private collection.
- **Hypothetical `acme.example` host** — single `acme_` prefix with embedded environment hint (`acme_prod_`, `acme_staging_`), Argon2id-hashed, stored in a managed secrets vault.

Hosts MAY use any scheme they prefer; the prefix is purely operational.

#### Scopes

An OpenWOP-compliant server MUST support the following scope vocabulary at minimum:

| Scope               | Allows                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest:read`     | Read workflow / canvas-type / endpoint manifests                                                                                                        |
| `runs:create`       | Create new runs                                                                                                                                         |
| `runs:read`         | Read run state and event stream                                                                                                                         |
| `runs:cancel`       | Cancel an in-flight run                                                                                                                                 |
| `artifacts:read`    | Read artifacts produced by runs                                                                                                                         |
| `webhooks:manage`   | Register/unregister webhook subscriptions                                                                                                               |
| `approvals:respond` | Respond to HITL approval gates                                                                                                                          |
| `packs:publish`     | Publish new versions of node-packs to the registry (see `registry-operations.md`)                                                                       |
| `packs:yank`        | Mark a published node-pack version yanked (advisory; existing pins keep resolving)                                                                      |
| `packs:yank-revert` | Reinstate a yanked node-pack version (super-admin)                                                                                                      |
| `audit:read`        | Verify audit-log integrity via `GET /v1/audit/verify`. Gated on the `openwop-audit-log-integrity` profile per `auth-profiles.md`.                       |
| `workspace:read`    | Read agent-workspace files via `GET /v1/host/workspace/files[/{path}]`. Gated on `capabilities.workspace.supported` (RFC 0059).                         |
| `workspace:write`   | Create/replace/delete agent-workspace files via `PUT`/`DELETE /v1/host/workspace/files/{path}`. Gated on `capabilities.workspace.supported` (RFC 0059). |

A server MAY define additional scopes for non-protocol surfaces (e.g., `canvas-types:list`, `projects:list` for platform-level keys). Such extensions MUST NOT shadow the names above.

##### Documented extension scopes

These scopes are used by capability-gated surfaces in `rest-endpoints.md` and are part of the documented vocabulary; `scripts/check-openapi-security.mjs` accepts them beside the table above (RFC 0200 §F.4c).

| Scope           | Allows                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `deploy:*`      | Drive an agent deployment state transition (RFC 0082 §E)                                                        |
| `runs:annotate` | Record a quality annotation on a run (RFC 0056; gated on `capabilities.feedback`)                               |
| `prompts:read`  | Read and render prompt templates (RFC 0027; gated on `capabilities.promptLibrary`)                              |
| `prompts:write` | Create, update and deprecate prompt templates (RFC 0027)                                                        |
| `content:read`  | Read authored content pages and locale settings (RFC 0103)                                                      |
| `content:write` | Create, publish and translate authored content pages (RFC 0103)                                                 |
| `packs:read`    | Fetch a published node-pack tarball or detached signature from the host's registry mirror (`registry-operations.md`) |

A key MAY hold any subset of scopes. The server MUST enforce scope checks at the endpoint level, not at the resource level — i.e., `runs:cancel` does not imply `runs:read`.

### 2. User-bearer tokens (human callers)

OPTIONAL. Servers that expose admin/management surfaces (CLIs, dashboards) typically accept user-bearer tokens issued by an identity provider.

- The server MUST validate the token against the issuing provider before authorizing any operation.
- User tokens MAY map to a richer permission model than API keys (e.g., role-based access control over multiple scope dimensions).
- User tokens MUST NOT bypass workspace/tenant isolation.

Implementation examples include OAuth/OIDC identity providers, managed identity platforms, or mTLS front doors that map the authenticated principal to workspace memberships and role flags.

## Authorization

Beyond scope checks on API keys, an OpenWOP-compliant server MUST enforce:

1. **Tenant isolation.** A caller authenticated for tenant A MUST NOT be able to read or mutate any resource scoped to tenant B. The server MUST verify resource-tenant binding inside the same transaction or query that fetches the resource. (See `idempotency.md` for the run-claim transactional check.)

2. **Scope-resource match.** Even if a key carries `runs:read`, the server MUST verify that the specific run the caller is requesting belongs to a tenant the key is authorized for.

3. **Test-mode segregation.** If the server distinguishes live and test keys (recommended), it MUST NOT permit a test key to read or mutate live data, and vice versa. Resources created by test keys MUST be marked as such.

## Identity claims — tenant · workspace · principal (RFC 0048)

OpenWOP standardizes a small, explicit **identity triple** the host MAY derive from the caller's credential and carry in the auth context. All three are **optional** — single-tenant hosts emit none of them and are unaffected:

| Claim       | Meaning                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `tenant`    | The top-level isolation boundary (the dimension RFC 0011 already narrows discovery by; now named). |
| `workspace` | An **optional** sub-tenant within a tenant — a collaborative scope. A tenant has ≥ 1 workspace.    |
| `principal` | The **acting identity** (a user or an agent) making the request. Opaque id — never PII.            |

The protocol does not prescribe _how_ a host derives these (API key, OIDC token, SAML assertion per RFC 0050, etc.) — only their names and the binding rules below.

- **Run ownership.** When a run is created under an identity triple, the host SHOULD record it as `RunSnapshot.owner` (`{ tenant, workspace?, principal? }`, per `run-snapshot.schema.json`) and echo it, redaction-safe, on the `run.started` event payload.
- **Workspace isolation (normative).** Tenant isolation (§Authorization rule 1) extends to workspace granularity: a `principal` scoped to workspace A MUST NOT read or mutate a run owned by workspace B — within or across tenants. A cross-workspace read MUST fail closed with `run_forbidden` (never silently return another workspace's data). This is the CTI-style guarantee that makes the `workspace` claim enforceable rather than advisory.
- **Workspace-scoped discovery.** RFC 0011's tenant-narrowing of the `/.well-known/openwop` capability view extends to workspace granularity: when the caller's context carries a `workspace` claim, the host MAY present a workspace-scoped subset, and the RFC 0011 authorization-oracle invariant holds at workspace granularity (a workspace-scoped view MUST NOT include an optional capability a strictly-narrower workspace's view lacks). Reuses the `capabilities.discovery.authScoped` advertisement.
- **Identifier opacity (normative).** `RunSnapshot.owner` is echoed on the `run.started` event payload (SSE, webhooks, debug bundles) and persisted in the snapshot, and these fields are **not** redaction-gated. Hosts MUST therefore use an **opaque, non-PII identifier** for `principal` (e.g. a stable internal user/agent id or pseudonymous handle — never a raw email address, legal name, or other personal data); hosts SHOULD do likewise for `tenant` and `workspace`. A host that can only key on PII MUST map it to an opaque id before populating `owner`.

RBAC (RFC 0049), enterprise SSO/provisioning (RFC 0050), and approval gates (RFC 0051) all bind to this triple.

### Anonymous actors (RFC 0132)

RFC 0048 §Unresolved-Q1 deferred a principal-**kind** discriminator. RFC 0132 resolves it for the anonymous case by adding an OPTIONAL `principalKind` sibling to the `owner` triple (`run-snapshot.schema.json`), enum `["user", "agent", "anonymous"]`. It is **EXPLICIT, never inferred**: an absent value keeps today's RFC 0048 behavior; a host that does not distinguish kinds omits it.

An **anonymous actor** (`principalKind: "anonymous"`) represents a caller who authenticated **no identity** against this host — a visitor on a **public agent surface** (an embeddable widget, a marketing-site assistant). Each property is normative:

- **Opaque + non-PII.** The `principal` id MUST be an opaque, host-minted string that neither is nor embeds PII (no IP address, email, device fingerprint, or third-party identity) — the §"Identifier opacity" rule applied with no exception, because there is no user behind it to key on.
- **Origin-bound + ephemeral.** The id MUST be scoped to a single public-surface session, MUST NOT be a stable long-lived handle, MUST NOT be reused to correlate two sessions, and MUST NOT be caller-supplied or caller-influenced (host-minted).
- **Non-cross-linkable.** The id MUST NOT be resolvable — by the host or any wire consumer — to an authenticated `principal`, a `workspace`, or any other anon session. It is a leaf: it owns its session and nothing else.
- **Never an authority source.** An anon actor's authority is **solely** the RFC 0132 §C default-deny per-surface tool grant. It MUST NOT inherit any role (RFC 0049), any RBAC scope, or any default-on tool baseline; a host MUST NOT resolve a role for it and MUST NOT default-allow any action.

A host that advertises `capabilities.anonymousActor` (see `capabilities.md` §`anonymousActor`) and dispatches through a public surface MUST set `owner.principalKind: "anonymous"` on the resulting run so the authorization is observable and auditable. The `user`/`agent` values are, for now, a passive marker (RFC 0132 §Unresolved-Q1); only `anonymous` binds behavior.

### The Subject record (RFC 0165 §B)

`owner.principal` is an opaque string that each authentication lane mints by its own rule,
which is why two lanes can produce two subjects for one human (RFC 0159). `owner.subject`
(`schemas/subject.schema.json`) is the OPTIONAL, issuer-scoped form of the same identity:

<!-- normative-example: subject.schema.json -->
```json
{ "issuer": "https://idp.example.com/entity", "subjectId": "idp-op-8f3a", "tenant": "acme",
  "lane": "saml", "kind": "user", "keyClass": "opaque-idp" }
```

With `issuer` in the key, two trust roots issuing the same identifier are distinct by
construction. A host that emits it:

- **MUST** set `subject.tenant` equal to `owner.tenant`, `subject.subjectId` equal to
  `owner.principal` when both are present, and `subject.kind` equal to `owner.principalKind`
  when both are present (`workload` corresponds to `principalKind` absent).
- **MUST** set `keyClass` when `lane` is `saml` or `scim`, equal to the advertised
  `capabilities.auth.subjectLinkKey` when both identity profiles are advertised (RFC 0163 §A,
  RFC 0164 §A.3).
- **MUST NOT** put an email address, a display name, a token, or a certificate in `subjectId`
  (SECURITY invariant `subject-record-opaque`; the schema forbids `@` and whitespace).
- **MUST** echo the record verbatim on `run.started` (RFC 0048 §C) and copy it verbatim onto a
  fork (`replay.md` §"Fork ownership").
- **MUST** answer reads of runs created before it emitted subjects with a synthesized
  **legacy subject** — `issuer: "urn:openwop:legacy"`, `subjectId: <owner.principal>`,
  `lane: <the lane the host can attest, else "api-key">`, `kind: <principalKind ?? "user">` —
  and **MUST NOT** treat a legacy subject as linkable (`auth-profiles.md` §"Subject linking";
  invariant `subject-legacy-not-linkable`). A run with no `owner.principal` yields no subject.
- MAY carry `subject.actor`: the delegating subject (RFC 0154 §B inverted to the run's point
  of view). Depth **MUST NOT** exceed 4; a deeper chain is refused with `run_forbidden`, never
  truncated. `actor` is provenance, not authorization; a caller **MUST NOT** self-assert it.

The record is optional in v1.x so both hosts populate it before the v2 major requires it and
removes the bare `principal`.

## Role-based authorization (RFC 0049)

A host MAY advertise `capabilities.authorization` to bind an RFC 0048 `principal`'s **role** to **scopes** and make authorization decisions observable, auditable, and conformance-testable. This reuses the existing API-key **scope grammar** (the §Authorization scope vocabulary above) — roles resolve _to_ scopes; no new grammar is introduced.

- **Role → scope binding.** The host advertises its role catalog as `capabilities.authorization.roles: [{ role, scopes[] }]`. A request is authorized when **any** of the principal's role-derived scopes matches the required scope, applying the same scope-match semantics the host already uses for API keys (per-segment wildcards + verb implication). A principal's role is resolved per `(principal, workspace)` — the same principal can hold different roles in different workspaces.
- **Fail-closed (normative).** An absent, unseeded, or unresolvable role MUST deny (a cache miss or resolver error ⇒ `allowed: false`); the host MUST NOT default-allow under any error condition. `capabilities.authorization.failClosed` is `const: true`. This is the SECURITY invariant `authorization-fail-closed`.
- **Decision event.** The host SHOULD emit `authorization.decided { principal, action, resource, allowed, reason }` (per `run-event-payloads.schema.json`) on a decision; every **deny** SHOULD be emitted and SHOULD feed the audit log (the RFC 0009/0010 audit-log integrity profile). The event is redaction-safe — `principal` is an opaque id and `reason` carries no credential material.

A denied REST action returns the existing `forbidden` envelope; the `authorization.decided { allowed: false }` event is the observable, auditable record of _why_.

## Error response shape

Auth failures use the standard JSON-RPC 2.0 error shape on JSON-RPC transports, and the following on REST:

```json
{
  "error": "<short_code>",
  "message": "<human-readable>",
  "scopeRequired": "<scope>"  // present on 403 only
}
```

Codes:

- `unauthenticated` (401) — no credential or invalid credential
- `forbidden` (403) — credential valid but lacks required scope or fails resource binding
- `key_expired` (401)
- `key_revoked` (401)

### Challenges (RFC 0200 §A, §B)

A host advertising `openwop-auth-oauth2-client-credentials` or `openwop-auth-oidc-user-bearer` SHOULD serve RFC 9728 Protected Resource Metadata and send `WWW-Authenticate` challenges exactly as [`spec/v2/core/identity.md`](../v2/core/identity.md) §2.5 defines them, deriving `authorization_servers` from `capabilities.auth.oauth2.issuer` and `capabilities.auth.oidc.issuers[]`. Every host SHOULD send `WWW-Authenticate: Bearer` on a `401` (RFC 9110 §15.5.2), and MAY add `resource_metadata`, `error` and `scope` parameters. `key_expired` and `key_revoked` map to `error="invalid_token"`.

A challenge MUST NOT change a response's status, and a `404` this specification requires for an unknown **or unauthorized** resource — `tool-catalog.md` §`GET /v1/tools/{toolId}`, the RFC 0074/0072/0086/0087 inventory routes, `capabilities-change-detection.md` — MUST NOT carry `error="insufficient_scope"` or a `scope` parameter. A `403` that fails resource binding (`run_forbidden`, `id_tenant_mismatch`) MUST NOT carry `insufficient_scope`, because no scope would cure it. Invariant `auth-challenge-no-oracle`. The body envelope above is unchanged: `scopeRequired` stays, and the header is its standard mirror.

## Rate limiting

An OpenWOP-compliant server SHOULD apply per-key rate limits and SHOULD return:

- HTTP `429 Too Many Requests`
- `Retry-After` header (seconds)
- Body: `{ error: "rate_limited", message, details: { window, limit, current, retryAfterSeconds } }`

Rate-limit decisions MUST be made before scope checks (so a flooded key can be throttled even on endpoints it lacks scope for).

## Workload identity and delegated actor chain (RFC 0154)

> **Status: additive, normative for any host that advertises `capabilities.auth.workloadIdentity` ([RFC 0154](../../RFCS/0154-workload-identity-delegation-telemetry-and-provenance.md)).** The machine-caller counterpart of the identity triple above: how a _workload_ (an agent, a service, a CI job) proves which workload it is, how a request may carry a verified chain of delegation, and what none of that grants. Wire shape: [`workload-identity.schema.json`](../../schemas/workload-identity.schema.json); advertisement: `capabilities.auth.workloadIdentity { supported, schemes[], senderConstraint[], delegation? }` (`capabilities.schema.json`). Seam: [`host-sample-test-seams.md`](./host-sample-test-seams.md) §20. Threat model: [`SECURITY/threat-model-workload-identity.md`](../../SECURITY/threat-model-workload-identity.md).

**Identity is not authorization** (RFC 0147 R12). Everything in this section establishes _who called_ — the §"Authorization" rules and RFC 0049 still decide _what they may do_, at every boundary, after this section has done its work.

### §A — Verify, bind, resolve, fail closed

An authenticated workload identity is projected as `{ scheme, subject, issuer?, audience?, keyBinding? }`:

- `scheme` is one of the closed set the host advertises in `schemes[]` — `spiffe` (SPIFFE ID / SVID), `mtls-san` (verified client-certificate SAN), `cloud-subject` (a cloud-native workload identity such as an instance/service-account subject), `oauth-client` (an OAuth 2.0 client-credentials subject). A scheme the host does not advertise **MUST** be rejected — an unrecognized scheme is a verification path nobody implemented, and accepting the _name_ without the _verification_ is the failure the profile exists to prevent.
- `subject` is an **opaque verified identifier**. Raw certificates, tokens, SVIDs, proofs, and credentials **MUST NOT** enter the object, the run record, an event payload, a span, or a log (SR-1 applies; `threat-model-secret-leakage.md`). `keyBinding` carries the **method** (`mtls` | `dpop`) and a thumbprint _reference_, never the key.
- A host **MUST** (1) **cryptographically verify** the presented identity against the scheme's trust root (SVID chain, client-certificate chain, cloud attestation, OAuth issuer keys); (2) **bind it to the request** — the identity used for authorization is the one verified on _this_ connection or proof, never one asserted in a header or body; forwarded identity headers from an edge are attacker-controlled unless the edge is a trusted terminator the host has been configured to believe, and then only for the fields the terminator vouches for; (3) **check `audience`** — an identity minted for a different host **MUST** be rejected (`audience_mismatch`); (4) **resolve it to an OpenWOP principal** (RFC 0048 `principal`, and the tenant/workspace it binds to) **before** any authorization decision; and (5) **fail closed**: an identity that does not verify, does not resolve, has the wrong audience, or is expired **MUST** be refused with a non-retriable closed reason (`identity_unverified`, `identity_unresolvable`, `audience_mismatch`, `delegation_expired`, `sender_constraint_missing` — seam §20). A resolver error, cache miss, or unreachable trust root is a refusal, never a default-allow.
- The resolved principal **MUST NOT** be the presented `subject` verbatim unless the host genuinely uses that string as its principal id; the mapping is host policy and **MUST** be documented at the host's discovery doc.

### §B — Delegated actor chain: provenance, not authorization

A request MAY carry a verified delegation context, projected as `delegation { chain[ { subject, issuer? } ], audience, expiresAt?, proofRef? }` beside an `actor` (`{ principalId, kind }`) and, when the actor acts for someone, `onBehalfOf` (`{ principalId, kind }`):

- **The chain is provenance.** It records _through whom_ the request arrived; it grants nothing. Every hop **MUST** be verified against the proof the `proofRef` digest references (`sha256:…`, a reference — the proof itself never enters the object). The **effective principal**, tenant, audience, expiry, scopes, and target action **MUST** be authorized at every OpenWOP boundary as if the request had arrived directly — a hop that would not be authorized on its own does not become authorized by appearing in a chain.
- **`onBehalfOf` is never self-asserted.** A caller **MUST NOT** supply its own `onBehalfOf`; it comes only from a verified delegation proof, and a request that asserts one without a verifiable chain **MUST** be refused.
- **Bounds.** A host **MUST** bound chain length (`capabilities.auth.workloadIdentity.delegation.maxChainDepth`, advertised) and **MUST** reject: a chain longer than the bound; a **cycle** (a subject appearing twice); an **expired** proof (`expiresAt` in the past — and a delegation _without_ `expiresAt` is a standing grant, which is not delegation; a host **SHOULD** refuse it or bound it by policy); an **audience** that is not this host; an **unknown issuer**; and **scope amplification** — the effective scopes at any hop **MUST NOT** exceed the scopes of the hop before it or the delegator's own (a hop MAY carry its verified `scopes` on the wire, `workload-identity.schema.json`, so the check is observable). The three chain refusals surface through the §20 seam as `delegation_chain_too_long` / `delegation_chain_cyclic` / `delegation_scope_amplified`, witnessed by `workload-identity-chain-bounds.test.ts` (2026-08-16).
- **Neutralization.** Where a chain's asserted tenant disagrees with the resolved principal's binding, the host **MUST NOT** act in the asserted tenant and **MUST NOT** reveal whether it exists (the RFC 0132 §A.2 rule).

### §C — Sender constraint and token exchange

- High-value machine credentials **SHOULD** be sender-constrained — mTLS or DPoP (or an equivalent verified key binding) — so a credential observed in transit cannot be replayed by the observer. A host advertises what it accepts in `senderConstraint[]`; a request whose scheme requires a constraint the host advertises but that arrives without it **MUST** be refused (`sender_constraint_missing`).
- **Bearer fallback** (a scheme accepted without sender constraint) **MUST** be explicitly advertised (an empty or absent `senderConstraint[]` _is_ that advertisement) and policy-controlled, and **MUST NOT** inherit a sender-constrained assurance claim: audit facts and any assurance label **MUST** distinguish a bearer-verified identity from a key-bound one (invariant `sender-constraint-no-bearer-downgrade`, RFC 0154 §F, registered in `SECURITY/invariants.yaml`).
- **Token exchange / delegation tokens** MAY be used to mint downstream credentials; a downstream credential **MUST NOT** exceed the upstream tenant, audience, scopes, or lifetime.

### §D — Audit facts and telemetry

Every authorization decision made under this profile **MUST** be recordable as a **content-free audit fact**: opaque actor id, effective principal, delegation depth (an integer, not the chain), issuer _class_ (not the issuer URL), audience decision (`match` | `mismatch` | `absent`), scope decision (`allow` | `deny`), and a correlation id. The corpus carrier is `authorization.decided { principal, action, resource, allowed, reason }` (`run-event-payloads.schema.json`) — `principal` is the effective principal (opaque), `reason` carries the closed reason and MAY carry `depth=<n> issuer=<class> audience=<decision>` as content-free tokens, and nothing else. **Raw subject claims MUST NOT be logged**; a host that needs to correlate subjects across facts MAY record a **salted hash** or a host-opaque mapping. **Privacy (RFC 0154 gap G5):** the salt **MUST** be per-tenant and rotatable; a deletion request is satisfied by rotating the salt (prior hashes become unlinkable) rather than by editing an append-only audit log; retention of hashed identifiers follows the host's audit retention and **MUST** be stated in its operational runbook.

Telemetry: the canonical span attributes for this profile are defined in [`observability.md`](./observability.md) §"Identity and delegation attributes (RFC 0154 §D)" — all optional, all content-free, `openwop.*` canonical. W3C `traceparent` / `tracestate` propagate across A2A, MCP, dispatch, compensation, and interrupt boundaries (`observability.md` §"Trace context propagation") and **never** become authorization evidence.

### What this profile does not do

It does not establish provenance attestations for artifacts (RFC 0154 §E spans `openwop-sdks` and `openwop-registry` and is carried); it does not choose a mandatory delegation proof _format_ (RFC 0154 gap G1 — SPIFFE, JWT `act`/`obo` claims, token exchange, and a signed chain envelope are all admissible under §B's rules; the profile pins the projected shape and the checks, not the encoding); and it does not measure DPoP availability across SDKs (gap G2).

**Conformance:** `workload-identity-profile.test.ts` (shape, always-on) and `workload-identity-behavior.test.ts` (capability-gated on `auth.workloadIdentity.supported`, and separately on `.delegation`, via seam §20 — resolution, `audience_mismatch`, `delegation_expired`, non-retriable closed reasons, credential exclusion). No host advertises the profile as of this writing; the behavioural legs resolve to `blocked` per RFC 0148 §A. Registered invariants: `delegation-tenant-audience-bound`, `delegation-chain-bounded` (the narrower name; acyclicity is not yet witnessed). Named by RFC 0154 §F and **not** registered: `workload-identity-cryptographically-bound`, `delegation-provenance-not-authorization`, `delegation-no-scope-amplification`, `delegation-chain-bounded-acyclic`, `sender-constraint-no-bearer-downgrade`, `provenance-attestation-digest-bound` — each stated above as a MUST and awaiting a witness (`docs/RFC-0147-SELF-AUDIT.md`).

## Audit

An OpenWOP-compliant server SHOULD log every authenticated request with at minimum: keyId, scope used, request method+path, timestamp, response status, latency. Logs MUST NOT include the API key value or any credential material.

## Onward hops (RFC 0200 §E)

A host MUST NOT attach a credential it received on an inbound request to any outbound request. Inbound credentials include an `Authorization`, `Cookie` or `Proxy-Authorization` header value, a DPoP proof, an interrupt resume token, an MCP or A2A peer's bearer, and credential material carried inside a request body. Outbound requests include A2A and MCP calls, webhook delivery, `callbackUrl` delivery, `host.httpClient` / `safeFetch`, and connector and tool egress.

Outbound authentication uses only credentials the host holds for that destination (`host-capabilities.md` §`host.credentials` / §`host.oauth`, bound to their audiences by RFC 0079). This does not forbid a verified delegation chain: RFC 0154 §B carries **provenance** — a `proofRef` digest — and never the inbound credential, and a downstream credential minted by RFC 0154 §C token exchange is a host-held credential. Invariant `inbound-credential-no-passthrough`.

This generalizes [`trigger-bridge.md`](./trigger-bridge.md) §F.1, which forbids the same headers passing into run data, to every outbound request. Upstream: MCP 2026-07-28 Security Considerations §"Access Token Privilege Restriction" ("the MCP server MUST NOT pass through the token it received from the MCP client").

---

## References

- `idempotency.md` — idempotency contract for mutating operations
- `rest-endpoints.md` — endpoint catalog with per-route scope requirements
- `auth-profiles.md` — optional production auth profiles for rotation, OAuth2, and mTLS
- `SECURITY/threat-model-auth-profiles.md` — auth-profile threat model
