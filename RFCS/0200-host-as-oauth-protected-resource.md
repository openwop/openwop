# RFC 0200: the host as an OAuth protected resource

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0200                                                            |
| **Title**         | the host as an OAuth protected resource |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 — filed `Draft → Active`; **comment window waived** by the steward on 2026-09-22 under GOVERNANCE.md §"Sole-steward operation" — an explicit **steward override of RFC 0147 §A.6** (precedent: RFC 0194), which forbids bootstrap waiver language from shortening the window for an RFC of this risk class; it is outside the `MAINTAINERS.md` waiver grant, recorded there as an override, not as a routine waiver (this RFC affects identity and authorization: which tokens a host accepts, what its refusals disclose, and what credential may leave it). Acceptance under this override is provisional and the §B review is owed (RFC 0156 register, `docs/WAIVER-RETROSPECTIVE-REGISTER.md`). **Updated 2026-09-22 — amended per implementation review** (`review/arch-impl.md` R2, R3; Status unchanged): `.mcp-mount-prm` is minted at major 2 against the v2 MCP mount RFC 0208 builds; §C's `oauth2cc-wrong-aud-401` is a v1-only, non-gating row (v2's audience rule is the pre-existing `identity.md` §2.1); a MyndHyve deploy of §A/§B must precede its first cut on the suite that ships these scenarios. **Updated 2026-09-22 — dependency recorded (Status unchanged):** RFC 0210 (`Draft`, comment window to 2026-09-29) adds the `exp-only` revocation rule and makes a lane's advertised rule measurable. It does **not** block this RFC: MyndHyve advertises an `oidc` lane today and is therefore bound by §A/§B either way, so §A/§B has a production witness. What RFC 0210 changes is that the witness becomes sound — MyndHyve currently reaches this RFC's lane gate through an advertisement `identity.md` §2.2 does not sanction (`INTEROP-MATRIX.md` §"Advertised revocation rule per lane"). **This RFC's first certifying cut waits for RFC 0210's comment window to close**, and the MyndHyve deploy this header already requires should carry both changes in one push. The §Examples lane shape is caveated in place; nothing normative here changes. |
| **Affects**       | `spec/v2/core/identity.md` (new §2.5; one sentence in §2.1's lane text) · `spec/v2/core/security-defaults.md` (two obligation rows, new §Onward hops; homes `purposePropagation`) · `spec/v2/core/headers.md` (generated) · `spec/v2/declaration.json` · `spec/v1/auth.md` (§Error response shape; new §Onward hops) · `spec/v1/auth-profiles.md` (`openwop-auth-oauth2-client-credentials`; §Discovery guidance) · `spec/v1/mcp-integration.md` §E · `spec/v1/trigger-bridge.md` §F.1 (pointer) · `spec/v1/a2a-integration.md` §AgentCard (informative derivation note) · `api/openapi.yaml` + `api/v2/openapi.yaml` (derived) `securitySchemes`, per-operation `security`, `WWW-Authenticate` on the shared `401`/`403` responses · `SECURITY/invariants.yaml` (+2) · a new gate `scripts/check-openapi-security.mjs` · conformance (four new scenarios, two extended) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` (§4 "New normative requirement on a previously-undefined behavior"; lane-gated; see §Compatibility) |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

An OpenWOP host authenticates callers through OAuth 2.0 and OIDC lanes, but it gives a generic OAuth client no way to discover that it is protected or what it needs. It serves no RFC 9728 Protected Resource Metadata and sends no `WWW-Authenticate` challenge anywhere in the corpus (0 hits across `spec/`, `schemas/`, `api/`, `SECURITY/`, `RFCS/`). It declares only an API-key scheme in OpenAPI and keeps its scopes in prose.

This RFC makes a host that advertises an `oauth2` or `oidc` lane serve that metadata and send those challenges, derived from the lanes it already advertises. A challenge may never replace a response the corpus requires to be a non-disclosing `404`. The RFC adds three more rules:
- a host MUST reject a client-credentials token minted for another audience;
- an ID token MAY be a bearer only when its `aud` is the host's own audience, which keeps Firebase-style deployments working;
- a credential the host received MUST NOT leave it on any outbound request.

Finally, it declares the OAuth2, OIDC and mTLS lanes and per-operation scopes in OpenAPI, so that an A2A card's `securitySchemes` can be generated rather than hand-kept. The scope is inbound only. RFC 0199 covers the host as an OAuth *client*.

## Motivation

Findings from the 2026-09-22 review (slice E), re-verified on `origin/main` `faedeb6b` (`review/verify-EF.md`):

1. **No resource-server discovery and no challenge** (#5 / E-F1 + E-F2, CONFIRMED).
   - OpenWOP publishes issuer and audience in two places: `capabilities.auth.oauth2` / `.oidc` (v1, `auth-profiles.md` §Discovery guidance) and v2 `auth.lanes[].issuers[]` (`identity.md` §2.1). Neither is a document a generic OAuth or MCP client reads.
   - MCP: "MCP servers **MUST** implement OAuth 2.0 Protected Resource Metadata … MCP clients **MUST** use OAuth 2.0 Protected Resource Metadata for authorization server discovery" (Authorization §Overview 4).
   - `mcp-integration.md` §E already names PRM as "how the peer authenticates" on the host's MCP mount, and nothing verifies that the mount serves it.
   - Live, 2026-09-22: `app.openwop.dev/.well-known/oauth-protected-resource` returns `404`.
   - HTTP itself: "The server generating a 401 response MUST send a WWW-Authenticate header field" (RFC 9110 §15.5.2). OpenWOP's `401`s carry none.
2. **The OAuth2 client-credentials profile never says to reject a wrong-audience token** (#6 / E-F3, CONFIRMED). `auth-profiles.md:39-41` says only that the audience "is documented" and that wrong-audience tokens "use the canonical error envelope". The v1 schema description of `capabilities.auth.oauth2.audience` ("Tokens MUST carry a matching `aud` claim") and the suite (`auth-oauth2-client-credentials.test.ts:158`, harness-gated) both already assume the rejection. The profile text does not state it.
3. **ID tokens as bearers.** `auth-profiles.md:68` admits `<id-token-or-access-token>`. Retiring ID tokens would break both production hosts (verify-EF #6, `review/arch-P4.md`):
   - MyndHyve's committed v2 bundle has an `oidc` lane with issuers `https://securetoken.google.com/myndhyve-prod` and `https://accounts.google.com`;
   - openwop-app verifies Firebase ID tokens (`oidcVerifier.ts:1-2`).

   The actual risk is an ID token minted *for some other client* being accepted (the audience substitution in `threat-model-auth-profiles.md` A2). A Firebase ID token's `aud` is the project id, which is the audience these hosts configure.
4. **No rule stops a host forwarding the caller's credential** (#13 / E-F7, CONFIRMED absent).
   - MCP: "The MCP server **MUST NOT** pass through the token it received from the MCP client" (Security Considerations §Access Token Privilege Restriction). Its best-practices document: "Token passthrough is explicitly forbidden".
   - The only OpenWOP analogue is `trigger-bridge.md` §F.1: "the host MUST NOT pass through `Authorization`, `Cookie`, `Proxy-Authorization`, or any header carrying credential material". It covers inbound webhook headers *into run data*, not egress.
   - RFC 0079 binds host-issued credentials to their audiences at egress. It says nothing about the caller's own credential.
5. **OpenAPI cannot express the lanes the corpus defines** (E-F4, CONFIRMED). `api/openapi.yaml` (the `securitySchemes` block near `:2457`) and `api/v2/openapi.yaml` (near `:3126`) declare only `ApiKeyAuth` (`http`/`bearer`). The global `security` is `- ApiKeyAuth: []`, and scopes live only in `rest-endpoints.md` tables. `a2a-integration.md` §AgentCard requires the card's `securitySchemes{}` / `securityRequirements[]` to list "the auth the endpoint **actually enforces**". Today that list can only be kept by hand, which leaves invariant `a2a-card-runtime-consistent` with no generated source.

**Who hits it.**
- Any generic OAuth or MCP client pointed at an OpenWOP host.
- Every host with an `oidc` or `oauth2` lane: MyndHyve in v2, and openwop-app in v1, whose v1 discovery advertises `openwop-auth-oidc-user-bearer` with audience `openwop-dev`.
- Every host that calls out to MCP, A2A or webhook targets on a caller's behalf.

## Proposal

### §A — Protected Resource Metadata (v2 `identity.md` §2.5; v1 SHOULD)

1. **Gate.** A host advertising an `auth.lanes[]` member with `lane` ∈ {`oauth2`, `oidc`} MUST serve RFC 9728 metadata. A host advertising neither lane is not bound by §A. Serving it anyway is RECOMMENDED where the host can derive §A.3 truthfully.
2. **Location.** The resource identifier is the base URL the host serves its API under: the deployed server URL of `api/v2/openapi.yaml`, with no `/v1` or `/v2` segment. The metadata is served at the well-known URI RFC 9728 §3 forms from it. `/.well-known/oauth-protected-resource` is inserted between the host component and any path, with a terminating slash after the host removed.
   - For a root-mounted host: `https://h.example` → `https://h.example/.well-known/oauth-protected-resource`.
   - For a sub-path host such as openwop-app: `https://app.openwop.dev/api` → `https://app.openwop.dev/.well-known/oauth-protected-resource/api` (RFC 9728 §3.1).
   - The document is served without authentication.
3. **Derivation.** The metadata is a projection of `auth.lanes[]`, not a second declaration:
   - `resource` MUST be identical to the resource identifier used to form the URL (RFC 9728 §3.3).
   - `authorization_servers` MUST list exactly the `https` URL members of `issuers[]` across the host's `oauth2` and `oidc` lanes.
   - `scopes_supported` MUST list the scopes the host enforces (`auth.md` §Scopes, plus any `authorization.roles` scope).
   - `dpop_bound_access_tokens_required` and `tls_client_certificate_bound_access_tokens` MAY be `true` only where every such lane's `minimumAssurance` and `delegationProofs[]` require that binding (`identity.md` §2.3–§2.4). A bearer lane MUST NOT be advertised as sender-constrained, the rule of `sender-constraint-no-bearer-downgrade`.
   - Other RFC 9728 fields are OPTIONAL.
4. **The MCP mount** (v1 `mcp-integration.md` §E; v2 as a row in RFC 0208's `spec/v2/interop-map.json` `mcp.authorization` group). A host whose MCP server mount requires OAuth-lane authentication MUST implement one of MCP's two discovery mechanisms for the mount's own resource identifier, the mount URL: the `401` `resource_metadata` challenge, or the well-known URI with the mount path inserted.
   - This restates the upstream MUST that a host advertising `mcp-2026-07-28` has already taken on (Authorization Server Discovery §Protected Resource Metadata Discovery Requirements: "MCP servers **MUST** implement one of the following discovery mechanisms").
5. **v1.** A host advertising `openwop-auth-oauth2-client-credentials` or `openwop-auth-oidc-user-bearer` SHOULD serve §A's metadata, derived from `capabilities.auth.oauth2.issuer` and `capabilities.auth.oidc.issuers[]`. v1 gains no new MUST here (`review/arch-P3.md` P3-L1, v2-first). §A.4 is the exception: it is a v1 MUST because the mount exists only in v1.

### §B — Challenges (v2 `identity.md` §2.5; v1 `auth.md` §Error response shape)

1. On a host bound by §A.1:
   - A `401` MUST carry `WWW-Authenticate: Bearer resource_metadata="<§A.2 URL>"`. It MUST add `error="invalid_token"` when a credential was presented and refused, and MUST NOT add an error code when none was presented (RFC 6750 §3.1).
   - A `403` for insufficient scope MUST carry `WWW-Authenticate: Bearer error="insufficient_scope", scope="<s1 s2 …>", resource_metadata="<url>"`, where `scope` lists **every** scope the operation requires, space-delimited (RFC 6750 §3). Upstream: "servers **SHOULD** include all scopes required for the current operation in a single challenge" (MCP Authorization §Runtime Insufficient Scope Errors). OpenWOP makes it MUST where it applies, because `runs:cancel` does not imply `runs:read` (`auth.md` §Scopes), so a single-scope hint can be wrong.
   - A `403` for **resource binding** (`run_forbidden`, `id_tenant_mismatch`, a workspace mismatch) MUST NOT carry `insufficient_scope`, because no scope would cure it.
2. Every other host SHOULD send `WWW-Authenticate: Bearer` on a `401` (RFC 9110 §15.5.2), and MAY add the §B.1 parameters.
3. **Challenges never create an oracle** (invariant `auth-challenge-no-oracle`; P3-C4). A challenge attaches only to a response that is **already** `401` or `403` under the rules that apply without this RFC. It MUST NOT change any response's status. Where a rule requires `404` for an unknown **or unauthorized** resource, the `404` stands and MUST NOT carry `insufficient_scope` or `scope`. Those rules are:
   - `tool-catalog.md` §`GET /v1/tools/{toolId}` (v2: `spec/v2/core/tool-catalog.md` §"The catalog", RFC 0204);
   - the RFC 0074 agent inventory (`api/openapi.yaml` `getAgent`: "404s identically to 'not installed'");
   - the RFC 0072/0086/0087 inventory routes;
   - `capabilities-change-detection.md` ("Hosts MUST NOT let scoped discovery become an authorization oracle").
4. The body envelope is unchanged. `scopeRequired` stays, and the header is the standard mirror of it. `key_expired` and `key_revoked` map to `error="invalid_token"`.

### §C — OAuth2 client-credentials audience (v1 `auth-profiles.md`)

1. A host advertising `openwop-auth-oauth2-client-credentials` MUST reject, with `401` `unauthenticated`, an access token whose `aud` does not contain its advertised `capabilities.auth.oauth2.audience`. It MUST do so before any authorization decision.
   - Upstream: "MCP servers **MUST** validate that access tokens were issued specifically for them as the intended audience … Invalid or expired tokens **MUST** receive a HTTP 401" (Authorization §Token Handling).
2. **Framing** (P3-H1). This is a **new requirement on previously undefined behaviour**, under the §4 last row, not stricter validation. The profile text has never defined what the host does with a wrong-audience token beyond "the canonical error envelope". v2 needs nothing here, because `identity.md` §2.1 already requires every lane to "check audience" (`audience_mismatch`, `401`).
3. **Sequencing with Phase 2 P2-a.** P2-a normalizes the *status* these failures use (401) and merges the OIDC `aud` SHOULD/MUST contradiction (`auth-profiles.md:69/:72`). §C owns the *obligation to reject*. If P2-a's merged wording already states the rejection as a MUST, §C.1 becomes a cross-reference, and the classification is P2-a's.

### §D — ID tokens as bearers (v2 `identity.md` §2.1, one sentence)

> On the `oidc` lane an ID token MAY be a bearer only when its `aud` equals the host's configured audience; any other `aud` is `audience_mismatch`.

This neither retires ID tokens nor adds a lane (`review/arch-P4.md` recommendation 8: "DON'T" retire; "an ID token MAY be accepted only when its `aud` equals the host's configured audience").
- The sentence is compatible with the lane MUST in §2.1 and names the ID-token case that MUST already covers.
- A Firebase or Google ID token issued for the host's own project passes.
- An ID token issued to any other relying party, including one that is an OAuth client of the same IdP, is refused.
- v1 is unchanged: `auth-profiles.md:68` keeps `<id-token-or-access-token>`, and the audience MUST at `:69` (merged by P2-a) already covers it.

### §E — No inbound credential leaves the host (invariant `inbound-credential-no-passthrough`)

1. A host MUST NOT attach a credential it received on an inbound request to any outbound request. Such credentials include:
   - an `Authorization`, `Cookie` or `Proxy-Authorization` value;
   - a DPoP proof;
   - an interrupt token;
   - an MCP or A2A peer's bearer;
   - a credential carried inside a body.

   Outbound requests include A2A, MCP, webhook delivery, `callbackUrl` delivery, `httpClient`/`safeFetch`, connector and tool egress. Outbound authentication uses only credentials the host holds for that destination (`host.credentials` / `host.oauth`, v2 `oauth.md` once RFC 0199 lands, bound by RFC 0079 provenance).
2. This generalizes `trigger-bridge.md` §F.1 (inbound webhook headers MUST NOT pass into run data). §F.1 stays as it is and gains a pointer.
3. It does **not** forbid a verified delegation chain. RFC 0154 §B carries *provenance* (a `proofRef` digest), never the inbound credential, and a downstream credential minted by token exchange is a host-held credential under RFC 0154 §C.
4. v1 (`auth.md` new §Onward hops) and v2 (`security-defaults.md` §Onward hops) carry the same MUST. It is a new requirement on previously undefined behaviour.

### §F — OpenAPI describes the lanes (description only; no wire change)

1. `api/openapi.yaml` `components.securitySchemes` gains three entries beside `ApiKeyAuth`:
   - `OAuth2` (`type: oauth2`, `flows.clientCredentials` and `flows.authorizationCode`, each carrying the canonical scope map from `auth.md` §Scopes);
   - `OpenIdConnect` (`type: openIdConnect`);
   - `MutualTLS` (`type: mutualTLS`).
   Their URLs are placeholders (`https://issuer.example/…`), in the same way `servers` uses `api.example.com`.
2. Every operation not marked `security: []` gains an explicit `security` array of three alternatives: `[{ApiKeyAuth: [<scope>]}, {OAuth2: [<scope>]}, {OpenIdConnect: [<scope>]}]`. `<scope>` is the scope `rest-endpoints.md` names for that method and path. OpenAPI 3.1 permits roles on non-OAuth schemes ("the array MAY contain a list of role names", §4.8.30), so the API-key requirement carries the scope too.
   - `MutualTLS` is declared but appears in no canonical requirement, because in OpenWOP it is *in addition to* a bearer (`auth-profiles.md` §`openwop-auth-mtls`). A host that requires it adds `MutualTLS: []` inside each requirement object (AND).
3. `api/v2/openapi.yaml` is regenerated by `scripts/derive-v2-api.py`, which carries `components` and per-operation `security`. The three RFC 0173 operations the script adds are given their scopes there.
4. A new gate, `scripts/check-openapi-security.mjs`, run in `openwop:check`, fails when any of the following holds:
   - an operation lacks `security`, other than the explicit `security: []` public ones;
   - the three alternatives' scope lists differ;
   - a scope is outside `auth.md` §Scopes plus the documented extensions;
   - an operation's scope disagrees with the `rest-endpoints.md` table.
5. **The card derivation** (informative, `a2a-integration.md` §AgentCard). A host that serves its own OpenAPI document (`GET /v1/openapi.json`, v2 `/openapi.json`) SHOULD:
   - replace the placeholders with its advertised issuers;
   - drop the schemes for lanes it does not advertise;
   - generate the A2A card's `securitySchemes` and `securityRequirements` from that document.

   The mapping is one-to-one. OpenAPI `http`/`bearer` becomes `HTTPAuthSecurityScheme`, `oauth2` becomes `OAuth2SecurityScheme` (one `OAuthFlows` member per scheme, since A2A's is a `oneof`), `openIdConnect` becomes `OpenIdConnectSecurityScheme`, and `mutualTLS` becomes `MutualTlsSecurityScheme` (A2A v1.0.1 `a2a.proto`). The response headers `WWW-Authenticate` (on the shared `Unauthenticated` and `Forbidden` responses) regenerate `spec/v2/core/headers.md`.

### §G — `purposePropagation` is homed with §E (v2 `security-defaults.md` §Onward hops)

§E fixes what must not cross an onward hop. `purposePropagation` (RFC 0128) is the one family whose whole contract is what *must* cross one. Its v1 rule (`spec/v1/capabilities.md` §`purposePropagation`) is restated in the same v2 section, and `declaration.json` moves its `normativeText` there:
- re-emit a received `permittedPurposes` label on every onward hop, narrowing and never widening;
- treat `[]` as no onward use;
- `propagatesOnward` is false only without an onward hop;
- the family advertises propagation, not enforcement.

The rule itself is unchanged; §G homes it and pays for §A–§E's v2 words (§Implementation notes).

### Examples

**Positive: an `oidc`-lane host under a sub-path.** The lane advertised is `{ "lane": "oidc", "issuers": ["https://securetoken.google.com/acme-prod"], "revocation": "short-lived", "revocationWindowSeconds": 3600, "minimumAssurance": "bearer" }`.

> **Caveat added 2026-09-22 (RFC 0210, `Draft`).** This example's `revocation` value is copied from a production advertisement that `identity.md` §2.2 does not sanction: §2.2's `oidc` row lists `exp-and-recheck`, and `short-lived` appears only in the `mtls` row, where it is an obligation on the party that **issues** the credential. The lane's shape is what this RFC is illustrating and the illustration stands; the `revocation` cell is not to be copied. RFC 0210 proposes `exp-only` as the honest member for a host that honours `exp` and re-checks nothing, and this example becomes `"revocation": "exp-only", "revocationWindowSeconds": 3600` when RFC 0210 is `Active`. Nothing else in this RFC changes.

`GET https://acme.example/.well-known/oauth-protected-resource/api` returns:

```json
{ "resource": "https://acme.example/api",
  "authorization_servers": ["https://securetoken.google.com/acme-prod"],
  "scopes_supported": ["manifest:read", "runs:create", "runs:read", "runs:cancel", "artifacts:read", "webhooks:manage", "approvals:respond"],
  "bearer_methods_supported": ["header"] }
```

`GET /api/runs/r1` with no credential returns `401` with `WWW-Authenticate: Bearer resource_metadata="https://acme.example/.well-known/oauth-protected-resource/api"`.

**Negative:**
- `authorization_servers: ["https://accounts.google.com"]` on a host whose lanes list only `securetoken.google.com/acme-prod` violates §A.3.
- `dpop_bound_access_tokens_required: true` with `minimumAssurance: "bearer"` violates §A.3.
- A `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="runs:read"` for `GET /tools/unknown-or-hidden` violates §B.3; it MUST stay `404`, with no scope challenge.
- An ID token with `aud: "some-other-client"` accepted on the `oidc` lane violates §D.
- A webhook delivery whose request carries the `Authorization` value the run's creator sent violates §E.

## Compatibility

**Classification: `additive`.** Clause by clause:

- **Lane gate** (P3-H2). §A's and §B.1's MUSTs bind only a host advertising an `oauth2` or `oidc` lane. Neither v2-reference's committed bundle (lanes: api-key, session, saml, scim, workload) nor openwop-app's (api-key, session, anonymous) advertises one, so neither is bound. MyndHyve's bundle (`oidc`) is bound, and its host work is listed in the implementation plan. No unconditional "every `401` MUST challenge" is introduced: §B.2 is a SHOULD.
- **§A, §B.1, §C, §E are new requirements on previously undefined behaviour** (COMPATIBILITY §4 last row):
  - no document defines a PRM endpoint, a challenge header, the OAuth2-CC wrong-audience outcome, or outbound treatment of an inbound credential;
  - none of them rejects protocol input that previously succeeded, except §C;
  - §C rejects a token the profile never said to accept, which is the §4 "previously undefined" row and not the "stricter validation" row (P3-H1). The schema description of `auth.oauth2.audience` and the suite already assumed rejection.
- **Adding a response header** to an existing `401` or `403` does not change a response contract (COMPATIBILITY §2.2 bullet 4, "additive optional fields aside"). Clients ignore unknown headers. The non-oracle clause (§B.3) makes sure no status changes.
- **§D relaxes nothing and tightens nothing new.** v2 `identity.md` §2.1 already requires an audience check on every lane. The sentence names ID tokens explicitly as admissible under it. No committed host's behaviour changes: MyndHyve and openwop-app accept only same-audience Firebase ID tokens, verify-EF #6.
- **§F is description-only.** Adding `securitySchemes` and per-operation `security` to the canonical OpenAPI changes no wire behaviour. The derived v2 document changes only by the same additions.
- **v2 growth.** No schema changes. Of the facets, `auth` is untouched. `headers.md` gains `WWW-Authenticate`, a standard header, which RFC 0171 §C.1 lets keep its standard name.

## Conformance

The scenarios land at or after `Active`, in a suite minor published on the steward's release decision. **No requirement id enters `floorScenarios` or a profile predicate.**

- **New: `v2-protected-resource-metadata.test.ts`** (major 2). Gated on an advertised `oauth2`/`oidc` lane (`inapplicable` otherwise). **Unaided:**
  - it derives the §A.2 URL from the suite's own base URL and GETs it without credentials;
  - it asserts `200` JSON, `resource` identical to the base URL, `authorization_servers` set-equal to the lanes' URL issuers, `scopes_supported` non-empty, and no sender-constraint claim above the lanes' `minimumAssurance`.
  A `404` **fails**. It is not a soft-skip: the lane is advertised, so the document is owed.
- **New: `v2-auth-challenge.test.ts`** (major 2). Gated as above.
  - **Unaided:** a no-credential `GET /runs/{id}` → `401`, `WWW-Authenticate` naming `Bearer` and `resource_metadata` equal to the §A.2 URL, with no `error`. A garbage bearer → `error="invalid_token"`.
  - **Harness-gated** on `OPENWOP_TEST_LOW_SCOPE_KEY`: an operation the key lacks scope for → `403`, `error="insufficient_scope"`, and `scope` containing the operation's scope.
- **New: `auth-challenge-no-oracle.test.ts`** (both majors via `BOTH_MAJORS`, gated on `toolCatalog` / `agents` presence). With `OPENWOP_TEST_LOW_SCOPE_KEY` or `OPENWOP_TEST_UNAUTHORIZED_API_KEY`:
  - `GET /tools/{unknown}` and `GET /agents/{unknown}` → `404` with no `insufficient_scope`/`scope` challenge;
  - the same for a tool that exists but that principal cannot see (fixture-gated);
  - a cross-workspace `run_forbidden` `403` carries no `insufficient_scope`.
- **New: `inbound-credential-no-passthrough.test.ts`** (both majors).
  - **Unaided leg,** gated on `webhooks`: register a subscription at the suite's `webhook-receiver.ts`, then create a run sending `Authorization: Bearer <suite key>`, `Cookie: ow_canary=<c1>` and `Proxy-Authorization: Basic <c2>`. Assert that no captured delivery header or body contains the key, `c1` or `c2`.
  - **Seam legs:** the same canaries on runs that call `a2a-fake-peer.ts`, `mcp-fake-server.ts` and an `httpClient` fixture pointed at the receiver. The fakes capture headers.
- **Extended:** `auth-oauth2-client-credentials.test.ts` (wrong-aud leg re-cited to `openwop.requirement.0200.oauth2cc-wrong-aud-401`) and `auth-oidc-user-bearer.test.ts` (+ v2 twin `v2-oidc-id-token-audience.test.ts`, harness-gated on `OPENWOP_TEST_OIDC_ISSUER_URL`; `oidc-issuer.ts` mints an ID token with `aud` = host audience → accepted, and with `aud` = another client → `401 audience_mismatch`).
- **Extended:** the MCP mount scenarios (`mcp-current-auth-boundary.test.ts`, major 1), where the mount requires OAuth: the mount's `401` carries `resource_metadata`, or its path-inserted well-known URI serves PRM. *Amended 2026-09-22:* this v1 leg is non-gating. `openwop.requirement.0200.mcp-mount-prm` is minted by a mount leg in `v2-protected-resource-metadata.test.ts` against the v2 MCP mount RFC 0208 builds, because `check-accepted-predicate` rule 4 reads only v2 bundles.
- **Corpus gate:** `scripts/check-openapi-security.mjs` (witness `claims-check`).

### Falsifiability — one row per normative requirement

Every row names the sabotage that makes it fail in the companion implementation plan (not committed with the RFC).

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1–§A.2 PRM served at the path-inserted URI (`openwop.requirement.0200.prm-served`) | `200` JSON at the derived URL | the suite, unaided | witnessable-gated (on an `oauth2`/`oidc` lane) |
| §A.3 derived, not declared (`openwop.requirement.0200.prm-consistent`) | `resource` identical; `authorization_servers` set-equal to lane issuers; no over-claimed binding | the suite, unaided | witnessable-gated |
| §A.4 MCP mount discovery (`openwop.requirement.0200.mcp-mount-prm`) | `resource_metadata` in the mount's `401`, or PRM at the mount-path well-known | the suite, on a v2 mount requiring OAuth-lane authentication (major 2: a planned mount leg in `v2-protected-resource-metadata`, against the v2 mount of RFC 0208) | witnessable — gated on a v2 mount that requires an `oauth2`/`oidc` lane; the planned witness is the v2 reference host's mount under its synthetic `oauth2` lane. A mount that does not require such a lane records `inapplicable` with that reason. The v1 leg in `mcp-current-auth-boundary` is non-gating coverage |
| §A.5 v1 SHOULD | — | — | unwitnessable as a certification row — a SHOULD, not a MUST; no row owed |
| §B.1 `401` challenge (`openwop.requirement.0200.challenge-401`) | `WWW-Authenticate` with `resource_metadata`; `invalid_token` only when a credential was sent | the suite, unaided | witnessable-gated |
| §B.1 `403` scope challenge (`openwop.requirement.0200.challenge-403-scope`) | `insufficient_scope` + `scope` ⊇ the operation's scope | the suite, with a low-scope key | witnessable-gated (harness key) |
| §B.1 no scope challenge on resource-binding `403` | a `run_forbidden` response has no `insufficient_scope` | the suite, with a second-workspace key | witnessable-gated (harness key) |
| §B.3 challenge never replaces a `404` (`openwop.requirement.0200.no-challenge-on-nondisclosure-404`) | `404` stays `404`, with no scope challenge, for unknown and unauthorized ids | the suite, with a low-scope key | witnessable-gated (on `toolCatalog`/`agents`) |
| §C OAuth2-CC wrong audience (v1 only; leg id `0200.oauth2cc-wrong-aud-401` in the major-1 `auth-oauth2-client-credentials` scenario) | `401 unauthenticated` for a token the harness issuer minted with a foreign `aud` | the suite with a harness issuer the host trusts, at major 1 | witnessable — gated at major 1 only (harness issuer); **non-gating**: §C binds a v1 profile, v2's audience check is the pre-existing `identity.md` §2.1, and no v2 cut reaches a major-1 file, so this row carries no requirement id for rule 4 |
| §D ID-token `aud` (`openwop.requirement.0200.id-token-aud`) | same-audience ID token accepted; foreign-audience ID token `401 audience_mismatch` | the suite with `oidc-issuer.ts` | seam-gated (harness issuer) |
| §E no passthrough (`openwop.requirement.0200.inbound-credential-no-passthrough`) | the suite key and cookie canaries are absent from every header and body captured at suite-owned receivers | the suite (it owns the receiver and knows its own credential) | witnessable-gated (webhooks); seam-gated (A2A/MCP/httpClient fixtures) |
| §E covers body-borne credentials and DPoP proofs | — | — | **unwitnessable in general**: the suite cannot enumerate every body field a host might forward, and DPoP needs a sender-constrained lane no committed host advertises. The header canaries are the witnessed subset. |
| §F OpenAPI declares the lanes (`openwop.requirement.0200.openapi-security-declared`) | `check-openapi-security.mjs` fails on a missing or mismatched operation | the corpus gate (corpus); the ledger row is minted by a planned coherence test in `conformance/src/coherence/` that runs the same predicate, since a script alone mints no ledger row | claims-check |
| §F.5 the card derivation (SHOULD) | — | — | unwitnessable as a certification row — a SHOULD, not a MUST; no row owed |
| §G `purposePropagation` restated | the existing RFC 0128 scenarios | unchanged | witnessable — gated, by the existing RFC 0128 scenarios (homing moves no behaviour) |

## Alternatives considered

1. **Every host MUST serve PRM and MUST challenge every `401`.** This follows HTTP's own `401` MUST and would be the most interoperable. Rejected for now: it fails all three committed v2 hosts on core endpoints at the next suite (P3-H2). It would also turn this RFC into a certification-class change if it ever reached a floor. §B.2 records the SHOULD, and a later RFC can raise it once hosts have moved.
2. **Replace `capabilities.auth.oauth2`/`.oidc` and `auth.lanes[].issuers[]` with PRM** (E-F1: "v2: Replace-by-derivation"). Rejected: PRM has no field for `revocation`, `minimumAssurance` beyond two booleans, SAML, SCIM, LDAP or workload lanes, or `introspectionIntervalSeconds` (review E §F1 deltas 4–5). The lanes stay the declaration, and PRM becomes a projection of them.
3. **Retire ID tokens as bearers** (E-F3). Rejected: it breaks MyndHyve's v2 `oidc` lane and app.openwop.dev (verify-EF #6; arch-P4 "DON'T"). §D's audience rule removes the actual threat.
4. **Frame §C as a safety fix.** That would give the change an explicit migration package. Rejected as unnecessary: the behaviour was undefined, not specified-and-wrong. A safety fix needs a 90-day window (COMPATIBILITY §3) and would delay the rule for no benefit to any host.
5. **Put §A–§B in `spec/v2/ext/` to spare the core budget.** Rejected: these are witnessable, lane-bound obligations of the `auth` family. Filing them where the budget does not count is the stubbing incentive RFC 0190 §A was written against. §G pays for them honestly.
6. **Name the invariant `credential-passthrough` / `identity-passthrough`.** Rejected: `identity-passthrough.test.ts` already exists for the unrelated `core.identity` echo fixture (verify-EF #13).
7. **Do nothing.** Generic OAuth and MCP clients keep failing discovery against every OpenWOP host. An MCP client of an OpenWOP mount keeps getting a `401` it cannot act on. A host that forwards the caller's bearer to a third-party MCP server is not in violation of anything written.

## Unresolved questions

1. **Audience vs `resource`.** The PRM `resource` is a URL. An `oidc` lane's configured audience may not be (Firebase `aud` = project id). A client that sends RFC 8707 `resource` to such an IdP gets a token whose `aud` the host would refuse. Should v2 `auth.lanes[]` gain an optional `audience` member, so a client can see the value it must request? Deferred: no Firebase-style client uses `resource`, and adding the member is additive later.
2. **`scopes_supported` on multi-tenant hosts.** Should it list the full vocabulary, or the scopes the *tenant's* roles can grant? PRM is fetched unauthenticated, so a per-tenant list would be an oracle. The proposal lists the host-wide vocabulary.
3. **Should §B.2 become MUST at a later minor?** It would align with RFC 9110 §15.5.2. The trigger is when all three committed v2 hosts already comply.
4. **A signed PRM (`signed_metadata`)** would pair with an A2A card JWS (E24). Out of scope.
5. **`scopesRequired: string[]` in the body envelope** (E-F2). The header already carries the full set, so the body is left alone to avoid a v1 envelope change.

## Implementation notes (non-normative)

- **Sequencing.**
  - After Phase 2 P2-a (the `auth-profiles.md:69/:72` merge and the `:41` status wording; see §C.3).
  - Independent of RFC 0199. §E's "credentials the host holds" points at RFC 0199's `oauth.md` when both land; otherwise it points at v1 `host-capabilities.md` §host.oauth.
  - §A.4's v2 text is a row in RFC 0208's `mcp.authorization` group. If RFC 0208 has not merged, it waits for it; v1 carries the MUST meanwhile.
- **Core word budget.**
  - Measured on the draft: `identity.md` +197 words, `security-defaults.md` +139 words, one marker word, and `headers.md` +~15 generated, for a total of ≈ 352 added.
  - Homing `purposePropagation` grants 200.
  - Net **≈ +152**, under the +300 ceiling. Per-file counts are in the impl file.
- **Witness pole.**
  - MyndHyve (tier-2, `oidc` lane) is the only committed v2 host that §A/§B bind.
  - openwop-app would be bound in v2 if it advertised its v1 `oidc` lane there. Its v2 bundle today omits it (gap G2).
  - §E's unaided leg can run on every host advertising `webhooks`, which is all three.
  - **MyndHyve re-certification (`review/arch-impl.md` R2).** MyndHyve advertises an `oidc` lane, so on the suite release that ships `v2-protected-resource-metadata` its PRM `404` is an `executed-fail`, not a soft-skip, and its bundle stops certifying. §A/§B must be deployed on MyndHyve before its first cut on that suite. MyndHyve is warned before the scenario merges, and its INTEROP row stays on the prior suite until the deploy lands.

## Acceptance criteria

- [x] `Active`: 2026-09-22, by steward override of RFC 0147 §A.6 (the window was waived, not run; see `Updated`).
- [x] Spec text merged:
  - v2 `identity.md` §2.5 + the §2.1 sentence; `security-defaults.md` rows + §Onward hops; `declaration.json` `purposePropagation.normativeText`;
  - v1 `auth.md`, `auth-profiles.md`, `mcp-integration.md` §E, `trigger-bridge.md` pointer, `a2a-integration.md` note.
  - *§A.3 reads "URL-form issuers" where this RFC says "`https` URL members". The narrower word would exclude a loopback test issuer and make the rule unwitnessable on any local boot; `urn:` trust roots — the api-key, session and anonymous lanes — are excluded either way, which is the clause's purpose. Every production issuer is `https`, so no host's obligation differs.*
- [x] OpenAPI v1 `securitySchemes` + per-operation `security` + `WWW-Authenticate` headers; v2 regenerated; `headers.md` regenerated; `check-openapi-security.mjs` in `openwop:check`. All 56 v1 and 54 v2 operations declare their scope or `security: []`; `derive-v2-api.py` names the seven v2-only operations' scopes and refuses to generate a document whose operation declares none.
- [x] `inbound-credential-no-passthrough` and `auth-challenge-no-oracle` registered at `reference-impl` (`SECURITY/invariants.yaml`, 210 → 212), each with the residual risk recorded in its threat model.
- [x] Scenarios published, and each shown able to fail by its named sabotage. Eight host sabotages (PRM `404`; an issuer no lane names; no challenge on a `401`; an error code on a credential-less `401`; a `403` without `scope`; a scope challenge on the non-disclosure `404`; the inbound `Authorization` forwarded to the webhook; the `oidc` `aud` check removed) and three corpus sabotages (a deleted operation `security`; a scope that disagrees across alternatives; a removed `WWW-Authenticate`) were each run red against the v2 reference host / the gate before the row was cited.
- [ ] A committed v2 host bundle carries `openwop.requirement.0200.prm-served`, `.prm-consistent`, `.challenge-401` and `.no-challenge-on-nondisclosure-404` at `executed-pass` from a host with an `oidc` or `oauth2` lane, nothing relaxed. **All four are `executed-pass` on a local boot of the v2 reference host under a configured `oidc` lane** (2026-09-22, loopback, `OPENWOP_REQUIRE_BEHAVIOR=true`); the box stays open until a CERTIFIED bundle carrying them is committed, which waits on the 2.36.0 publish and the public-ingress cut.
- [ ] `.inbound-credential-no-passthrough` at `executed-pass` (unaided webhook leg) on at least two hosts. One so far: the v2 reference host, local boot, 2026-09-22. The second is an openwop-app v2 re-cut (`review/handoff-openwop-app-0200.md`).
- [ ] RFC 0156 §B retrospective review recorded. Until then, `Accepted` is **provisional** (register row `not-reviewed`).
- [x] CHANGELOG entry.

## References

- **Upstream** (verified live 2026-09-22; copies kept with the review notes):
  - **MCP 2026-07-28.**
    - Basic › Authorization (`https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization`): §Overview 4, §Token Handling, §Scope Selection Strategy, §Runtime Insufficient Scope Errors.
    - Authorization Server Discovery (`…/authorization-server-discovery`): §Protected Resource Metadata Discovery Requirements ("MUST implement one of"; the client MUST fall back to the well-known URIs).
    - Security Considerations (`…/security-considerations`): §Access Token Privilege Restriction.
    - Tutorials › Security Best Practices (`https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices`): §Token Passthrough.
  - **A2A v1.0.1** (`https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/docs/specification.md`, `specification/a2a.proto`): §4.5 SecurityScheme (`oneof` of APIKey/HTTPAuth/OAuth2/OpenIdConnect/MutualTls; `OAuthFlows` a `oneof`; `AgentCard.security_schemes = 8`, `security_requirements = 9`), §7.4 ("SHOULD provide relevant authentication challenge information").
  - **IETF.**
    - RFC 6750 §3, §3.1
    - RFC 8707 §2
    - RFC 9110 §15.5.2
    - RFC 9728 §2, §3, §3.1, §3.3, §5.1, §7.7
  - **OpenAPI 3.1.0** (`https://spec.openapis.org/oas/v3.1.0`): §4.8.27 (scheme types `apiKey`, `http`, `mutualTLS`, `oauth2`, `openIdConnect`), §4.8.30 (requirement arrays; roles for non-OAuth schemes).
- **Corpus.**
  - RFC 0010 (auth profiles), RFC 0072/0074/0086/0087 (non-disclosure 404s), RFC 0078 (tool catalog), RFC 0079 (egress audience binding), RFC 0128 (purpose propagation), RFC 0154 (delegation), RFC 0170 (v2 identity), RFC 0171 §C.1 (headers), RFC 0173 (security defaults), RFC 0189/0190 (homing and budget), RFC 0147 §A.6, RFC 0156 §B, RFC 0194 (override precedent), RFC 0199 (the outbound sibling).
  - `spec/v1/auth.md`; `spec/v1/auth-profiles.md:39-41, :68-72`, §Discovery guidance; `spec/v1/tool-catalog.md` §`GET /v1/tools/{toolId}`; `spec/v1/capabilities-change-detection.md`; `spec/v1/trigger-bridge.md` §F.1; `spec/v1/mcp-integration.md` §E; `spec/v1/a2a-integration.md` §AgentCard; `spec/v2/core/identity.md` §2.1–§2.4, §6; `spec/v2/core/security-defaults.md`.
- **Review inputs.** `review/E-auth-security.md` F1–F4, F7, F10; `review/verify-EF.md` #5, #6, #13, E-F4; `review/arch-P3.md` P3-C4, P3-H1, P3-H2, P3-M5; `review/arch-P4.md` (ID-token recommendation).
