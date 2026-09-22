# RFC 0199: the host as an OAuth client, and the `credential` interrupt

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0199                                                            |
| **Title**         | the host as an OAuth client, and the `credential` interrupt |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 — filed `Draft → Active`; **comment window waived** by the steward on 2026-09-22 under GOVERNANCE.md §"Sole-steward operation" — an explicit **steward override of RFC 0147 §A.6** (precedent: RFC 0194), which forbids bootstrap waiver language from shortening the window for an RFC of this risk class; it is outside the `MAINTAINERS.md` waiver grant, recorded there as an override, not as a routine waiver (this RFC affects identity and authorization: who may complete a grant, and what a run may ask a user for). Acceptance under this override is provisional and the §B review is owed (RFC 0156 register, `docs/WAIVER-RETROSPECTIVE-REGISTER.md`). **Updated 2026-09-22 — amended per implementation review** (`review/arch-impl.md` R1, R3, R9; Status unchanged): §E.2's schema conditional is replaced by the host-side rule of Unresolved question 3, because the G4 census found six published `reach.mcp` + `oauth2` manifests without `issuer`; every Falsifiability id is now minted by a major-2 scenario (the v1 legs stay as non-gating coverage); the `authorize-start` seam must call the production URL builder. |
| **Affects**       | RFC 0047 §C (amended) · `spec/v1/host-capabilities.md` §host.oauth · `spec/v1/connection-packs.md` §Manifest · `spec/v1/interrupt.md` · `spec/v1/mcp-integration.md` §C.2 · `spec/v1/a2a-integration.md` (drift point #3) · `spec/v1/capabilities.md` §oauth · new `spec/v2/core/oauth.md` (homes `oauth` and `credentials`) · `spec/v2/core/interrupt.md` · `spec/v2/core/interop.md` §The durable-task projection · `spec/v2/declaration.json` · schemas (v1 and v2): `capabilities`, `connection-pack-manifest`, `suspend-request`, `run-event-payloads`, `a2a-task-state` · `spec/v2/errors.json` · `SECURITY/invariants.yaml` (+2) · conformance (four new scenarios, one extended) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` (§4 rows "New optional capability advertised, off by default" and "New normative requirement on a previously-undefined behavior"; see §Compatibility for each clause) |
| **Supersedes**    | — (amends RFC 0047 §C and resolves its Unresolved question 1; retires `a2a-integration.md` drift point #3 for the forward direction) |
| **Superseded by** | —                                                               |

## Summary

When a host runs the OAuth authorization-code grant for a connector (RFC 0047 `host.oauth`), nothing in the corpus requires PKCE, a checked `state`, RFC 9207 `iss` validation, a fixed redirect URI, or that the user who finishes the grant be the user who started it. MCP 2026-07-28 requires most of these of any server that acts as an OAuth client to a third party. This RFC states them for `host.oauth`, adapted to providers that publish no authorization-server metadata (Slack is the example). When the provider is reached as an MCP server, it adds the RFC 8707 `resource` parameter and Protected Resource Metadata discovery, but discovery only *verifies* the manifest's fixed endpoints and never *selects* them, so the anti-SSRF rule in `connection-packs.md` §Manifest clause 3 stays intact. It adds a `credential` interrupt kind, so an advertising host can suspend a run until a user authorizes a credential out of band. That kind projects to A2A `TASK_STATE_AUTH_REQUIRED` and to MCP URL-mode elicitation. The last rule forbids any interrupt from collecting a secret through MCP form mode. Suspending on refresh failure is opt-in and advertised. RFC 0047 §C.3's fail-the-node rule stays the default.

## Motivation

The review of 2026-09-22 (the 2026-09-22 MCP/A2A review, slice E, re-verified against `origin/main` `faedeb6b` in `review/verify-EF.md`) found four gaps.

1. **`host.oauth` has none of the OAuth-client MUSTs** (E-F6, verify-EF: PARTIAL, gap confirmed).
   - `host-capabilities.md` §host.oauth rule 1 says only that the code, redirect URI and `state` "MUST NOT enter any run-visible surface".
   - RFC 0047 Unresolved question 1 deferred PKCE "until a conformance fixture needs the distinction".
   - The providers schema `capabilities.oauth.providers[]` is `{id, authUrl, tokenUrl, scopesSupported}`, with `additionalProperties: false`, no `issuer` and no PKCE field.
   - PKCE is declarable in one place and absent in another. Connection packs already carry `provider.auth.authFlow: "pkce"` (`connection-pack-manifest.schema.json`), and `capabilities.md` advertises `oauth-pkce` for AI providers.
   - MCP places the host in exactly this role: "MCP servers act as OAuth clients to third-party resource servers" (MCP 2026-07-28 Client › Elicitation §URL Mode Elicitation for OAuth Flows).
2. **Suspension is missing where both upstreams have it** (E-F5).
   - `interrupt.md` has a closed set of kinds with no authorization kind.
   - RFC 0047 §C.3 fails the node on refresh failure, and the run can then only be forked.
   - `a2a-integration.md:84`, `:235` and `:433` project A2A `AUTH_REQUIRED` as `waiting-input` with `metadata.subkind: 'auth'`, "until a future v1.x adds a normative `auth` interrupt".
   - `spec/v2/core/interop.md` §The durable-task projection says the forward projection "MUST NOT emit it: v2 has no `auth` interrupt kind. Adding one is an additive v2.x RFC, not a host extension." This RFC is that RFC.
3. **The MCP form-mode bridge can ask for a secret or emit a schema MCP forbids** (#14 / E-F8, CONFIRMED).
   - `mcp-integration.md` §C.2 answers every waiting interrupt with `mode: "form"` and `requestedSchema ← the interrupt payload's schema`.
   - MCP: "Servers **MUST NOT** use form mode elicitation to request sensitive information such as passwords, API keys, access tokens, or payment credentials" (Elicitation §User Interaction Model).
   - MCP also limits `requestedSchema` to "flat objects with primitive properties only" (Elicitation §Requested Schema).
   - A nested clarification schema bridged verbatim is invalid MCP. A credential-asking clarification also puts the secret into resume state, against SR-1.
4. **Connection packs reach MCP servers with static endpoints and no `resource` indicator** (#7, PARTIAL). The static endpoints are a deliberate MUST ("MUST treat them as fixed, manifest-declared values and MUST NOT derive them from runtime user input", `connection-packs.md` clause 3), and this RFC keeps that. What is missing:
   - the RFC 8707 audience binding MCP requires of every client (Authorization §Resource Parameter Implementation);
   - any check that the manifest agrees with the authorization server the MCP server actually names.

**Who hits this today.**
- MyndHyve advertises `oauth` with nine providers in its committed v2 bundle (`evidence/v2-host-bundles/myndhyve.json`).
- Any MCP client of a host's MCP mount reaches the §C.2 bridge. openwop-app mounts at `/v1/host/openwop-app/mcp` and advertises `mcp-2026-07-28` (`conformance/src/lib/mcp-mount.ts`).
- Any A2A consumer of a run that needs a third-party grant sees an untyped `input-required` it cannot tell apart from a question.

**Why the spec, not the host.** A host that implements PKCE, `state` and `iss` privately gives a connector author nothing portable to rely on. Two things are wire contract and cannot be host-private: an A2A or MCP consumer needs a *typed* signal that authorization is required, and a bridge has to agree across hosts on what it will not put in form mode.

## Proposal

Everything in §A–§B binds a host that advertises `oauth` (v1: `capabilities.oauth.supported: true`; v2: presence of the `oauth` family). Everything in §C–§D binds only a host that also advertises the new `oauth.credentialInterrupt` facet, except §C.6, which binds every host, and §D.2's form-mode rules, which bind every host with an MCP server mount.

### §A — The authorization-code client (amends RFC 0047 §C.1)

For every `authorization_code` grant, a host advertising `oauth`:

1. **MUST send PKCE with `S256`** (RFC 7636 §4.2) and **MUST NOT** use `plain`. This is stronger than MCP's "MUST use the `S256` code challenge method when technically capable" (Security Considerations §Authorization Code Protection) and matches OAuth 2.1 (draft-ietf-oauth-v2-1-16 §7.5.1.1: "plain … is removed and explicitly prohibited").
   - **Metadata-free fallback.** A provider that publishes no authorization-server metadata is not refused. RFC 7636 §5 makes PKCE safe to send to a server that ignores it: "client implementations of this specification do not need to know if the server has implemented this specification or not".
   - **Declared exception.** A host MAY omit PKCE only for a provider whose definition declares `pkce: "unsupported"`. It MUST then advertise that value on the provider's `oauth.providers[]` member, so the weaker posture is visible rather than silent.
2. **MUST send a fresh `state`** of at least 128 bits of entropy from a CSPRNG, bound host-side to the initiating Subject (v2 `owner.subject`; v1 RFC 0048 `principal`) and to the provider, with a lifetime of at most 10 minutes.
   - It MUST refuse a callback whose `state` is absent, unknown, already consumed or expired, and MUST NOT make a token request for that callback.
   - *Labelled strengthening:* MCP makes `state` a client SHOULD (Security Considerations §Open Redirection: "MCP clients **SHOULD** use and verify state parameters"). Its best-practices document makes it MUST only for proxy servers. OpenWOP makes it MUST because the host is a multi-user confidential client, which is the case where CSRF on the callback binds one user's token to another user's session.
3. **MUST complete the callback only for the initiating Subject** (invariant `oauth-same-user-binding`). The credential is stored under the Subject bound to `state`. If the Subject authenticated on the callback request (by session or bearer) differs from that Subject, the host MUST refuse and store nothing.
   - This is MCP's phishing rule transferred to `host.oauth`: "the server **MUST** ensure that the user who started the elicitation request … is the same user who completes the authorization flow" (Elicitation §Phishing).
4. **MUST defend against mix-up.**
   - **Known issuer.** Where the provider's issuer identifier is known, from `oauth.providers[].issuer` or from authorization-server metadata fetched under §B.3, the host MUST validate the authorization response per RFC 9207 §2.4. It MUST reject a response whose `iss` differs by simple string comparison, and MUST reject a response without `iss` from a provider whose metadata sets `authorization_response_iss_parameter_supported: true`. It MUST do both before any token request.
   - **No known issuer.** For a provider with no known issuer identifier, the host MUST give the provider a redirect URI that no other provider on the host shares. This is RFC 9700 §4.4.2.2, "Mix-Up Defense via Distinct Redirect URIs".
   - RFC 9700 §4.4.2 requires a client that talks to two or more authorization servers to "prevent mix-up attacks". RFC 9207 §2.4 allows "deployment-specific ways (for example, a static configuration)" where metadata is not used. `issuer` is that static configuration.
5. **MUST use one fixed redirect URI per provider**, registered with the provider, and MUST NOT derive it from request input. The exact-match check is the authorization server's obligation (MCP Security Considerations §Open Redirection: "Authorization servers **MUST** validate exact redirect URIs"). This rule makes the host's side of that check meaningful.
6. RFC 0047 §C.1's redaction rule gains the PKCE verifier: the code, redirect URI, `state` and verifier MUST NOT enter any run-visible surface.

RFC 0047 Unresolved question 1 ("PKCE advertisement") is resolved by §A.1: PKCE is required, and only its absence is advertised.

### §B — A provider reached as an MCP server (amends `connection-packs.md` §Manifest)

When the connection pack resolving a provider declares `provider.reach.mcp` and `provider.auth.kind: "oauth2"`:

1. **`resource` (RFC 8707).** The host MUST send `resource`, set to the canonical URI of `reach.mcp.server.url`, in both the authorization request and the token request. The canonical URI has no fragment, lowercase scheme and host, and no trailing slash unless the path requires it.
   - Upstream: "**MUST** be included in both authorization requests and token requests … **MUST** send this parameter regardless of whether authorization servers support it" (MCP Authorization §Resource Parameter Implementation, §Canonical Server URI).
   - For a provider not reached as an MCP server, `resource` is OPTIONAL.
2. **PKCE support is verified.** The host MUST refuse the provider if its authorization-server metadata does not list `S256` in `code_challenge_methods_supported`. This is MCP's rule verbatim: "If `code_challenge_methods_supported` is absent … MCP clients **MUST** refuse to proceed" (Security Considerations §Authorization Code Protection).
   - It applies only here. RFC 8414 §2 reads an absent member as "the authorization server does not support PKCE", and an MCP authorization server is required to publish metadata. A Slack-style provider is not reached through this section.
3. **Discovery verifies; it never selects.** The host MUST obtain the MCP server's Protected Resource Metadata (RFC 9728), because MCP clients "**MUST** use OAuth 2.0 Protected Resource Metadata for authorization server discovery" (Authorization §Overview 4). The host MUST then:
   - (a) fetch it only from the well-known URIs RFC 9728 §3 derives from `reach.mcp.server.url`, or from a `resource_metadata` URL in that server's `401` challenge **whose origin equals the server URL's origin**, through the `httpClient` egress guard (RFC 0076);
   - (b) refuse metadata whose `resource` is not identical to the resource identifier used to form the URL (RFC 9728 §3.3);
   - (c) require `authorization_servers[]` to contain the manifest's `provider.auth.issuer`. The host MUST NOT authorize a provider of this combination whose manifest declares no `issuer`: (c) cannot hold, so the grant is refused with `connection_auth_metadata_mismatch` (§E.2; the schema keeps `issuer` optional);
   - (d) fetch authorization-server metadata only from the URIs derived from that issuer, in MCP's order (Authorization Server Discovery §Authorization Server Metadata Discovery), and require its `issuer` to be identical (RFC 8414 §3.3);
   - (e) require its `authorization_endpoint` and `token_endpoint` to equal the manifest's `endpoints.authorize` and `endpoints.token`.

   A mismatch at (b)–(e) MUST be refused with `connection_auth_metadata_mismatch`, and no authorization or token request may be sent. **The host sends requests only to manifest-declared endpoints.** Discovery can refuse a manifest; it cannot redirect one. Clause 3's "fixed, manifest-declared" MUST is unchanged.
4. **Pinning.** The host MUST run §B.3 when the pack is registered and record the verified tuple `(resource, issuer, authorize, token)`. A later discovery that disagrees with the recorded tuple MUST be refused with the same code. It MUST NOT be adopted silently.

### §C — The `credential` interrupt

1. **Advertisement.** A new optional facet, `oauth.credentialInterrupt` (v1: `capabilities.oauth.credentialInterrupt: true`; v2: the key's presence, RFC 0192). A host that does not advertise it is bound by none of §C.2–§C.5 and keeps RFC 0047 §C.3 unchanged.
2. **When.** A host advertising `oauth.credentialInterrupt` MUST suspend the node with a `credential` interrupt, instead of failing it, when a node that declares `auth: { type: "oauth2", provider, scopes }` is about to execute and either:
   - (a) no credential resolves for the run's Subject, provider and scopes (`reason: "missing"`, or `"insufficient_scope"` when one resolves with fewer scopes); or
   - (b) the §C.3 refresh has failed terminally (`reason: "expired"`). In this case the host MUST first emit `connector.auth_expired` as today.
3. **Payload.** `data` is `CredentialData`, closed (§E.3). Its fields:
   - `provider` (an advertised `oauth.providers[].id`)
   - `scopes[]`
   - `reason` (`missing | expired | insufficient_scope`)
   - `connectUrl`
   - optional `credentialRef` (the reference being re-authorized; never material)

   `connectUrl` MUST be an `https` URL on the host's own origin that begins §A's grant for the interrupt's initiating Subject. It MUST NOT be pre-authenticated: opening it MUST require the host to authenticate the user and MUST refuse a user other than the initiating Subject.
   - Upstream: "**MUST NOT** provide a URL which is pre-authenticated" (Elicitation §Safe URL Handling); `connectUrl` is the "connect URL" of Elicitation §Phishing.
   - `connectUrl` is not the interrupt's capability token. It MUST NOT embed the token or any value that resolves the interrupt.
4. **Resolution.** The resume value is closed: `{ "outcome": "authorized" | "declined" }`. It carries no credential. `resumeSchema` rejects any other property, so a credential cannot be submitted through it.
   - The host resolves the interrupt itself when §A's grant completes and a credential resolves. It records `interrupt.resolved` with `resumeValue: { "outcome": "authorized" }`.
   - A caller's resolve with `outcome: "authorized"` MUST be refused with `400 validation_error` (`details.field: "resumeValue"`) unless a credential for the Subject, provider and scopes now resolves. The host re-checks; it does not trust the caller.
   - `outcome: "declined"` fails the node with `connector_auth_declined`, a new code.
   - The ordinary resolve rules (idempotency, concurrent-resolve `409`, token expiry) apply unchanged.
5. **Status.** A run suspended on a `credential` interrupt has snapshot status `waiting-input`. **No `RunStatus` member is added.** The kind, not the status, distinguishes it.
6. **No interrupt collects a secret** (binds every host). A workflow or pack MUST NOT use an interrupt of any kind to solicit credential material: passwords, API keys, access or refresh tokens, or payment credentials. Credential acquisition uses `credential` (§C) or the host's own vault surface (RFC 0046), never a resume value. A host's bridges enforce the machine-checkable half (§D.2 for MCP form mode; RFC 0209 §B.8 for A2UI surfaces).

### §D — Projections

1. **A2A, forward.** A run suspended on a `credential` interrupt MUST project to `TASK_STATE_AUTH_REQUIRED` (`auth-required` on the JSON-RPC wire).
   - Its `TaskStatus.message` MUST name the provider and carry `connectUrl`.
   - `A2ATaskState.interruptKind` MUST be `credential`. `interruptKind` is then present iff `state` is `input-required` or `auth-required`.
   - Upstream: an agent "MUST transition the TaskState to `TASK_STATE_AUTH_REQUIRED` … MUST include a TaskStatus message explaining the required authorization … MUST arrange to receive credentials via an out-of-band means" (A2A v1.0.1 §7.6.1). `connectUrl` is that out-of-band means.
   - Drift point #3 is retired for the forward direction. The reverse direction, an external agent reporting `AUTH_REQUIRED`, keeps today's `waiting-input` + `metadata.subkind: "auth"` projection. A host MAY instead raise a `credential` interrupt when it can obtain the peer's credential through `host.oauth`.
2. **MCP, OpenWOP as server** (amends `mcp-integration.md` §C.2):
   - (a) **URL mode for credentials.** A `credential` interrupt MUST be answered with `inputRequests: { <key>: { method: "elicitation/create", params: { mode: "url", message, url: <connectUrl> } } }`. It MUST NOT be answered in form mode.
   - (b) **Client support is checked per request.** The host MUST emit URL mode only if the request's `_meta["io.modelcontextprotocol/clientCapabilities"].elicitation.url` is declared. MCP: "an empty capabilities object is equivalent to declaring support for `form` mode only" (Elicitation §Capabilities). Otherwise the host MUST answer `CallToolResult { isError: true }`, its text naming the provider and saying authorization is required out of band. The run stays suspended and resolvable through the REST and token surfaces. The host MUST NOT fall back to form mode.
   - (c) **Retry.** A retry whose `inputResponses[<key>]` is `ElicitResult { action: "accept" }` (URL mode carries no `content`) MUST cause the §C.4 re-check.
     - If a credential now resolves, the interrupt is resolved and the run continues.
     - Otherwise the host MUST answer `input_required` again with the same URL, not an error. Upstream: the client learns of completion by retrying.
     - `decline` and `cancel` keep §C.2's existing meanings.
   - (d) **Form mode refuses what MCP forbids.** The host MUST NOT emit form mode for an interrupt whose schema is not a flat object of primitive properties (Elicitation §Requested Schema), or whose schema marks any property `writeOnly: true` or `format: "password"` (invariant `elicitation-form-no-secret`). For such an interrupt:
     - if the client declared URL mode, the host MUST emit URL mode pointing at a host-owned page that resolves that interrupt for the same Subject, under §C.3's rules for `connectUrl`;
     - otherwise it MUST answer as in (b).
3. **MCP, OpenWOP as client** (`mcp-integration.md` §C.1). A remote server's `elicitation/create` with `mode: "url"` keeps today's `clarification` mapping (`mode` is already projected into the payload). Its resolution MUST produce `ElicitResult` with no `content`. The host MUST NOT collect data for a URL-mode request.

### §E — Wire shape

**E.1 `capabilities.schema.json` (v1) and `schemas/v2/capabilities.schema.json`: `oauth`.** Optional properties on closed objects. v1 shown; v2 adds the same three members to its `oauth` object and its `providers` items.

```diff
   "oauth": { "type": "object", "required": ["supported"], "properties": {
     "supported": { … }, "grants": { … },
+    "credentialInterrupt": { "type": "boolean", "description": "RFC 0199 §C. The host suspends a node on a `credential` interrupt instead of failing it when no credential resolves or refresh fails terminally. Absent ⇒ RFC 0047 §C.3 (fail the node)." },
     "providers": { "type": "array", "items": { "type": "object", "required": ["id"], "properties": {
       "id": { … }, "authUrl": { … }, "tokenUrl": { … }, "scopesSupported": { … },
+      "issuer": { "type": "string", "format": "uri", "description": "RFC 0199 §A.4. The provider's authorization-server issuer identifier (RFC 8414 / RFC 9207). Absent ⇒ the host uses a provider-unique redirect URI (RFC 9700 §4.4.2.2)." },
+      "pkce": { "type": "string", "enum": ["S256", "unsupported"], "description": "RFC 0199 §A.1. Absent or `S256` ⇒ the host sends PKCE S256. `unsupported` ⇒ the host sends no PKCE for this provider; such a provider cannot back an MCP reach (§B.2)." }
     }, "additionalProperties": false } }
   }, "additionalProperties": false }
```

v2 `oauth` gains `credentialInterrupt` as `{ "const": true }`, since a v2 facet is advertised by presence (RFC 0192).

**E.2 `connection-pack-manifest.schema.json` (v1 and v2): `provider.auth`.**

```diff
   "auth": { "type": "object", "required": ["kind"], "additionalProperties": false, "properties": {
     "kind": { … }, "authFlow": { … }, "scopeModel": { … }, "endpoints": { … }, "scopes": { … },
+    "issuer": { "type": "string", "format": "uri", "pattern": "^https://", "description": "RFC 0199 §A.4/§B.3. The authorization server's issuer identifier. Fixed and manifest-declared, like `endpoints`." },
+    "pkce": { "type": "string", "enum": ["S256", "unsupported"], "description": "RFC 0199 §A.1." }
   } }
```

**No schema conditional.** Both properties stay OPTIONAL in both manifest schemas, and no `allOf` branch makes them REQUIRED. The census §Compatibility C3 called for was run on 2026-09-22 (gap G4) and is non-empty: `openwop-registry` `registry/v1/packs/core.openwop.connections.{github,jira,notion}` 1.0.0 and `registry/v2/…` 1.0.1 are all `reach.mcp` + `oauth2` and none declares `issuer`. A `required` would reject six published documents, a narrowing of a published v1 and v2 schema. The rule is therefore **host-side** (Unresolved question 3): for a `reach.mcp` + `oauth2` provider, a host MUST NOT authorize it while its manifest declares no `issuer`, or declares `pkce: "unsupported"`, and refuses the grant with `connection_auth_metadata_mismatch` before any authorization URL is issued (§B.2, §B.3(c)). The rule refuses a *grant*, never a document. The six packs gain `issuer` in a registry patch release (gap G10).

**E.3 `suspend-request.schema.json` (v1 and v2) and the two `kind` enums in each `run-event-payloads.schema.json` (`interruptRequested`, `interruptResolved`).**

```diff
   "kind": { "enum": ["approval", "clarification", "external-event", "custom",
-                    "conversation.start", "conversation.exchange", "conversation.close", "low-confidence"] }
+                    "conversation.start", "conversation.exchange", "conversation.close", "low-confidence",
+                    "credential"] }
 …
+  "CredentialData": {
+    "type": "object", "additionalProperties": false,
+    "required": ["provider", "scopes", "reason", "connectUrl"],
+    "properties": {
+      "provider":   { "type": "string", "minLength": 1 },
+      "scopes":     { "type": "array", "items": { "type": "string", "minLength": 1 }, "uniqueItems": true },
+      "reason":     { "enum": ["missing", "expired", "insufficient_scope"] },
+      "connectUrl": { "type": "string", "format": "uri", "pattern": "^https://" },
+      "credentialRef": { "$ref": "credential-reference.schema.json" }
+    }
+  }
```

`CredentialData` joins the `kind`-bound `data` dispatch that the Phase 2 correction P2-c introduces (a minimal `conversation.start` payload fails `oneOf` today because it matches two branches; `review/arch-P3.md` P3-H7). This RFC does not land before P2-c. With the kind bound, `kind: "credential"` requires `CredentialData`, and `resumeSchema` for the kind is fixed as `{ "type": "object", "additionalProperties": false, "required": ["outcome"], "properties": { "outcome": { "enum": ["authorized", "declined"] } } }`.

**E.4 `a2a-task-state.schema.json` (v1 and v2).**

```diff
   "interruptKind": {
-    "enum": ["approval", "clarification"],
-    "description": "Present iff `state == 'input-required'`. …"
+    "enum": ["approval", "clarification", "credential"],
+    "description": "Present iff `state` is `input-required` or `auth-required`. `credential` ⇔ `auth-required` in the forward direction (RFC 0199 §D.1). …"
   }
```

The `state` description loses "the forward projection never sets it".

**E.5 Error codes.** Two new codes. v2: `spec/v2/errors.json` registry members under `overview.md` §0. v1: the failure-mode lists in `host-capabilities.md` §host.oauth and `connection-packs.md`.
- `connector_auth_declined` — 401, `retriable: false`. The user declined a `credential` interrupt.
- `connection_auth_metadata_mismatch` — 422, `retriable: false`. §B.3 or §B.4 refused discovered metadata.

### §F — Invariants

Two rows, `tier: reference-impl`, at `Draft → Active`. Each graduates to `protocol` at `Accepted` only with a non-vacuous witness.

- **`oauth-same-user-binding`** (`threat_model: SECURITY/threat-model-auth-profiles.md`, `severity: critical`, `witness: seam-gated`). The Subject that completes an authorization-code callback, or opens a `credential` interrupt's `connectUrl`, MUST be the Subject bound to its `state`. Otherwise the host refuses and stores nothing.
- **`elicitation-form-no-secret`** (`threat_model: SECURITY/threat-model-secret-leakage.md`, `severity: high`, `witness: seam-gated`). A host MUST NOT emit MCP form-mode elicitation for a `credential` interrupt, or for a schema that is non-flat or marks a property `writeOnly`/`format: "password"`.

### Examples

**Positive: a credential interrupt** (v2 `interrupt.requested` payload):

```json
{ "kind": "credential", "key": "acme~2Fr-7f…:post-to-slack:1",
  "data": { "provider": "slack", "scopes": ["chat:write"], "reason": "expired",
            "connectUrl": "https://host.example/oauth/connect/9a1c…",
            "credentialRef": { "ref": "cred_slack_ws", "scope": "workspace" } } }
```

It projects to A2A `{ "status": { "state": "auth-required", "message": { "parts": [ { "text": "Authorize Slack (chat:write): https://host.example/oauth/connect/9a1c…" } ] } } }` with `metadata.openwop.interrupt.kind: "credential"`. It projects to MCP `{ "resultType": "input_required", "inputRequests": { "k1": { "method": "elicitation/create", "params": { "mode": "url", "message": "Authorize Slack", "url": "https://host.example/oauth/connect/9a1c…" } } }, "requestState": "…" }`.

**Negative:**
- `{ "kind": "credential", "data": { "provider": "slack", "scopes": [], "reason": "expired", "connectUrl": "http://host.example/c", "accessToken": "xoxb-…" } }` fails twice: `connectUrl` is not `https`, and `CredentialData` is closed (`accessToken`).
- A resume of `{ "outcome": "authorized", "token": "…" }` fails `resumeSchema`.
- A `reach.mcp` + `oauth2` manifest without `provider.auth.issuer` **validates** (the schema keeps `issuer` optional), but a host MUST refuse to authorize it: the grant is refused with `connection_auth_metadata_mismatch` and no authorization URL is issued (§E.2 host-side rule).
- A clarification whose schema has `{ "type": "object", "properties": { "apiKey": { "type": "string", "format": "password" } } }` MUST NOT reach an MCP client as `mode: "form"`.

## Compatibility

**Classification: `additive`.** Each clause against `COMPATIBILITY.md`:

- **C1: RFC 0047 §C.3 is not relaxed** (P3-C1). A host that does not advertise `oauth.credentialInterrupt` keeps "emit `connector.auth_expired` and fail the node with `connector_auth_expired`" as a MUST, unchanged. Suspension is a new optional capability, off by default (§4 row 1). No `MUST` is relaxed (§2.2 bullet 5).
- **C2: §A and §B.1/§B.3 are new requirements on previously undefined behaviour** (§4 last row).
  - RFC 0047 left PKCE, `state` handling, `iss`, redirect handling and callback identity unspecified. It deferred PKCE explicitly (Unresolved question 1).
  - These rules constrain what the *host* sends to a third party. They do not reject any input a protocol client sent that previously succeeded, so the §4 "stricter validation" row, and the 90-day safety-fix window with it, does not apply.
  - A host that sends no PKCE today becomes non-conformant against the new text. That is the ordinary effect of an additive MUST and is surfaced through the suite (§2.3).
- **C3: no schema narrowing; the issuer rule is host-side.**
  - The census was run on 2026-09-22 (gap G4). Six published manifests (`core.openwop.connections.{github,jira,notion}`, v1 1.0.0 and v2 1.0.1) are `reach.mcp` + `oauth2` with no `issuer`. A schema `required` would make them invalid, which is a narrowing of a published schema (a COMPATIBILITY §4 safety-fix at v1, and a major under RFC 0197 §B.6 at v2).
  - So §E.2 adds only optional properties, and every document valid before stays valid. The obligation is a host rule, "a host MUST NOT authorize such a provider until `issuer` is declared", effective in the suite release that ships this RFC's scenarios (2.36.0). It refuses a *grant*, not a document. It constrains what the host sends to a third party, so it is C2's class (a new requirement on previously undefined behaviour).
  - Until the registry republishes the six packs with `issuer` (gap G10), a conforming host refuses to authorize them over MCP reach. That is the intended mix-up posture, not a regression: RFC 0047 never permitted discovery to choose the endpoint.
- **C4: v2 growth.**
  - Optional properties on closed objects (`oauth`, `providers` items, `provider.auth`) and a new member of an inline, non-registry enum (`kind`, `interruptKind`) are additive under the "every document valid before is valid after" test, by the precedent of RFC 0183, 0186 and 0188 (`review/arch-P3.md` ground rules). No written v2 rule covers either case today; RFC 0197 §B writes the optional-property half down.
  - The two error codes are registry members under `overview.md` §0.
  - `interop.md` §The durable-task projection licenses the kind in terms: "Adding one is an additive v2.x RFC".
- **C5: The §D.1 forward projection changes one v2 MUST.** "The forward projection MUST NOT emit it" becomes "MUST emit it for a `credential` interrupt and MUST NOT otherwise". The prohibition was conditioned on the kind's absence, and no host can raise a `credential` interrupt before this RFC. Every log that was conformant stays conformant.
- **C6: §D.2(d) and §C.6 bind every host with an MCP mount**, not only advertisers. Emitting form mode for a non-flat schema already produces invalid MCP (a restricted-schema violation upstream). Emitting it for a password field violates an upstream MUST the host already claims by advertising `mcp-2026-07-28`. The OpenWOP rule restates what the advertised profile already requires, so it is not a new obligation on a conformant host.
- **C7: v1 and v2 halves.** v1 edits land only where v1 is the surface's home:
  - `host.oauth`, until this RFC homes it;
  - `connection-packs.md` for the v1 manifest;
  - the v1-only MCP mount text;
  - the twin v1 schemas.

  The v2 halves are written once in `spec/v2/core/oauth.md`, which becomes the normative home of `oauth` and `credentials` (RFC 0189/0190).

**Forward-compatibility guarantees.**
- Every new field is optional.
- A client that does not know `credential` sees a `waiting-input` run, which is today's status.
- An A2A consumer sees `auth-required`, a state already in its enum.
- A host that advertises nothing new is unaffected except by C2 (if it advertises `oauth`) and C6 (if it mounts MCP).

## Conformance

A scenario may not cite a `Draft` RFC (`check-rfc-status-coherence.mjs` rule 7). The scenarios below land with or after this RFC's `Active` status, in a suite minor that is published after the steward's release decision (see §Implementation notes). No requirement id enters a `floorScenarios` list or a profile predicate, so this RFC stays out of the §A.6 certification class.

**Where each id is minted (amended 2026-09-22).** `scripts/check-accepted-predicate.mjs` rule 4 reads only certified `evidence/v2-host-bundles/` and the corpus ledger, and a v2 cut never runs a major-1 file. So every id in the Falsifiability table is minted by a **major-2** file, and the v1 legs below are kept as supplementary, **non-gating** coverage of the v1 halves:
- §A ids: planned `v2-oauth-client-pkce-state-iss`.
- §B ids (`resource-indicator`, `mcp-pkce-verified`, `mcp-metadata-bound`) and the issuer-less refusal of §E.2: planned `v2-oauth-mcp-reach-discovery` (major 2), the twin of the v1 file below, over `spec/v2/core/connection-packs.md`.
- §C ids and the C1 regression leg: planned `v2-credential-interrupt`.
- §D.1 `a2a-auth-required`: an `auth-required` leg in RFC 0208's planned `v2-a2a-operation-map` scenario, against the v2 A2A server RFC 0208 builds on the v2 reference host.
- §D.2 `mcp-url-mode` and `form-mode-no-secret`: legs in RFC 0208's planned `v2-mcp-mount-map` scenario, against the v2 MCP mount (the `interop-map.json` `mcp.mrtr` row this RFC amends).

- **Extended: `oauth-authorization-code-roundtrip.test.ts`** (RFC 0047 seam). New legs drive the host against a **suite-owned authorization-server double**, `conformance/src/lib/oauth-as-double.ts`, which extends `oidc-issuer.ts` and is served through the same tunnel mechanism as `webhook-receiver.ts`. The double counts token requests. A seam `POST …/oauth/authorize-start` returns the authorization URL the host would send the user to, and the suite plays the user agent against the host's real callback.
- **New: `oauth-client-pkce-state-iss.test.ts`** (v1; plus `v2-oauth-client-pkce-state-iss.test.ts`). Asserts:
  - `code_challenge_method=S256` and a verifier that hashes to it at the double's token endpoint;
  - that a wrong-`iss`, missing-`iss` (with `authorization_response_iss_parameter_supported: true`), unknown-`state` and replayed-`state` callback each produces **zero** token requests at the double;
  - that a callback authenticated as a second Subject stores nothing and produces zero token requests.
- **New: `oauth-mcp-reach-discovery.test.ts`.** Uses a fake MCP server built on `mcp-fake-server.ts` that serves PRM. Asserts:
  - `resource` on both requests;
  - refusal (`connection_auth_metadata_mismatch`, zero token requests) when the PRM names a different issuer or the AS metadata names a different token endpoint;
  - refusal when `code_challenge_methods_supported` lacks `S256`.
- **New: `v2-credential-interrupt.test.ts`** (and v1 `credential-interrupt.test.ts`). Fixture `conformance-credential`: one node declaring `auth: { type: "oauth2", provider: "synthetic", scopes: ["openwop.read"] }`, run by a Subject with no credential. Asserts:
  - `interrupt.requested` with `kind: "credential"` and a closed `CredentialData`;
  - snapshot `waiting-input`;
  - a caller resolve of `authorized` refused `400` while no credential exists;
  - `declined` fails the node with `connector_auth_declined`;
  - on the refresh-failure leg (seam `…/oauth/expire-refresh`), `connector.auth_expired` precedes the interrupt.

  On a host advertising `oauth` **without** `credentialInterrupt`, the same fixture MUST fail the node (RFC 0047 §C.3 regression leg).
- **New legs on `a2a-1-0-task-roundtrip.test.ts`** (A2A projection): `auth-required` + `interruptKind: "credential"` + `connectUrl` in the status message.
- **New legs on `mcp-server-elicitation-bridge.test.ts` / `mcp-mrtr-roundtrip.test.ts`** (§D.2, v1 mount):
  - URL mode for `credential`;
  - `isError` with no form fallback when the client declares form only;
  - no form mode for a nested schema or a `format: "password"` field.

### Falsifiability — one row per normative requirement

Every row below can fail, and the sabotage that makes it fail is named in the companion implementation plan (not committed with the RFC).

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 PKCE S256 (`openwop.requirement.0199.pkce-s256`) | the authorization URL carries `code_challenge_method=S256`; the verifier at the double's token endpoint hashes to the challenge | the suite, through the `authorize-start` seam and the AS double | seam-gated |
| §A.2 `state` refused when unknown or replayed (`openwop.requirement.0199.state-single-use`) | zero token requests at the double for the forged or replayed callback | the suite (it plays the user agent) | seam-gated |
| §A.3 same Subject (`openwop.requirement.0199.same-user-callback`) | zero token requests, no credential listed for the second Subject | the suite, with two credentials | seam-gated |
| §A.4 `iss` / mix-up (`openwop.requirement.0199.iss-validated`) | zero token requests on a wrong or missing `iss`; for an issuer-less provider, distinct redirect URIs across two providers in the authorization URLs | the suite | seam-gated |
| §A.5 fixed redirect URI | the same `redirect_uri` on every `authorize-start` for one provider, whatever the request carries | the suite | seam-gated |
| §B.1 `resource` (`openwop.requirement.0199.resource-indicator`) | `resource` present on both requests at the double, equal to the canonical server URI (major 2: planned `v2-oauth-mcp-reach-discovery`) | the suite (fake MCP server + double) | seam-gated |
| §B.2 refuse missing `S256` (`openwop.requirement.0199.mcp-pkce-verified`) | registration or grant refused; zero authorization URLs issued | the suite | seam-gated |
| §B.3 verify-not-select (`openwop.requirement.0199.mcp-metadata-bound`) | `connection_auth_metadata_mismatch`; zero requests to the PRM-named foreign issuer (a second double counts them); an issuer-less `reach.mcp` pack is refused the grant with zero authorization URLs (§E.2) | the suite | seam-gated |
| §B.4 pinning | a changed PRM after registration is refused on the next grant | the suite (it rewrites its fake server's PRM) | seam-gated |
| §C.2 suspend instead of fail (`openwop.requirement.0199.credential-interrupt`) | `interrupt.requested` `kind: credential`, status `waiting-input` | the suite, with the fixture and a Subject with no credential | witnessable-gated (on `oauth.credentialInterrupt`) |
| §C.2(b) `connector.auth_expired` precedes | event order in the log | the suite, via the `expire-refresh` seam | seam-gated |
| §C.3 `connectUrl` not pre-authenticated | an unauthenticated GET of `connectUrl` does not start a grant (no authorization URL; `401` or a login redirect) | the suite | witnessable-gated |
| §C.4 re-check on `authorized` (`openwop.requirement.0199.credential-resume-rechecked`) | `400 validation_error` while no credential exists | the suite | witnessable-gated |
| §C.4 `declined` | node fails with `connector_auth_declined` | the suite | witnessable-gated |
| C1: default unchanged (`openwop.requirement.0199.refresh-failure-fails-node`) | on a host without the facet, the refresh-failure leg fails the node with `connector_auth_expired` and raises no interrupt | the suite, via the `expire-refresh` seam | seam-gated (on `oauth`) |
| §A.2 entropy and lifetime | nothing reliable: entropy cannot be measured from samples, and a 10-minute expiry needs a timed wait | — | **unwitnessable** as stated; its refusal half is `.state-single-use` |
| §C.6 no interrupt solicits a secret (author rule) | nothing in general: whether a string field is a password is semantic | — | **unwitnessable in general**; its machine-checkable half is §D.2(d) |
| §D.1 A2A projection (`openwop.requirement.0199.a2a-auth-required`) | `auth-required`, `interruptKind: credential`, `connectUrl` in the status message | the suite (A2A client) on a host advertising `a2a` and the facet; major 2: the planned leg in RFC 0208's `v2-a2a-operation-map` | seam-gated (`a2a` is seam-gated in v2) |
| §D.2(a–c) URL mode (`openwop.requirement.0199.mcp-url-mode`) | `mode: "url"` with `url` = `connectUrl`; `isError` with no form fallback when only form is declared; `input_required` repeated on an accept retry with no credential | the suite (MCP client) on a host with a v2 mount; major 2: the planned leg in RFC 0208's `v2-mcp-mount-map` | seam-gated |
| §D.2(d) no form for nested or sensitive schemas (`openwop.requirement.0199.form-mode-no-secret`) | no `mode: "form"` in `inputRequests` for the two probe schemas | the suite, on a host with a v2 mount and a fixture that raises them; major 2: the planned leg in RFC 0208's `v2-mcp-mount-map` | seam-gated |
| §D.3 no `content` for a URL-mode request | the retry's `ElicitResult` at the fake MCP server carries no `content` | the suite (fake MCP server as remote) | seam-gated |

## Alternatives considered

1. **Name the kind `auth-required`.** This follows A2A's name. Rejected: `openwop-interrupt-auth-required` (`interrupt-profiles.md:31`) already means "resume calls are authenticated". A kind with the same name meaning "the user must authorize a third party" would make one string mean two things across two registries (`review/arch-P3.md` P3-H7). `authorization` was also rejected, because it collides with the `authorization` family (RFC 0049 role-based authorization) and the `authorization.decided` event.
2. **Make suspension the default and relax RFC 0047 §C.3.** This is what both upstreams do. Rejected: it relaxes a MUST, which COMPATIBILITY §2.2 forbids in v1.x and which in v2 needs the breaking-class route (RFC 0197 §A.1: no reshape in place). The opt-in facet gets the same behaviour on every host that wants it.
3. **Adopt MCP's OAuth-client rules by reference, verbatim** (E-F6 as first written). Rejected on two points:
   - MCP's "refuse if `code_challenge_methods_supported` is absent" would exclude every provider without RFC 8414 metadata, including the Slack example in `host-capabilities.md`. Always sending S256 is safe (RFC 7636 §5), so §A.1 does that, and only §B.2 (MCP reach) refuses.
   - MCP's `state` is a SHOULD. OpenWOP makes it a MUST and says so.
4. **Let discovery select endpoints for MCP reach.** Discovery is how MCP clients find the authorization server. Rejected: the PRM is served by the MCP server, a third party, so an attacker-controlled PRM would choose where the host sends codes and client credentials. That is exactly what `connection-packs.md` clause 3 forbids. Verify-not-select gives the MCP-conformant discovery step without letting a third party choose the endpoint.
5. **Carry credentials through a clarification.** No new kind, and a form field of type `password` would do the job. Rejected: that is the MCP form-mode violation §D.2(d) forbids, and it puts a secret into resume state (SR-1, `credential-payload-redaction`).
6. **Add a `RunStatus` member (`waiting-authorization`).** Rejected: A2A already distinguishes the case by task state. An OpenWOP status member would break every client that switches exhaustively on status, while the kind carries the same information additively (`review/arch-P3.md` P3-H7).
7. **Do nothing.** Every `host.oauth` host goes on inventing its own PKCE/`state` posture, invisible to the connector author. Every MCP client of an OpenWOP mount stays one clarification away from a form-mode secret. A2A consumers keep receiving an untyped `input-required` for a question that must not be answered in band.

## Unresolved questions

1. **§D.2(b) answer shape when the client lacks URL mode.** `CallToolResult { isError: true }` tells the client "this call failed" while the run is in fact suspended and resolvable elsewhere. MCP 2026-07-28 retired the `-32042` URL-elicitation-required error (`schema.ts`: "2025-11-25 only", reserved). Should OpenWOP define a structured `isError` content convention so a client can find the REST resolve surface?
2. **The reverse A2A direction.** Should a host that consumes an external agent in `AUTH_REQUIRED` be *required*, rather than permitted, to raise a `credential` interrupt when the peer's credential is obtainable through `host.oauth`? Left permissive: most peers' credentials are not `host.oauth` providers.
3. **C3 fallback.** *Resolved 2026-09-22:* the census found six published `reach.mcp` packs without `issuer`, so the host-side "MUST NOT authorize until `issuer` is declared" rule is the one adopted (§E.2); no schema conditional is added.
4. **Device-code grant** (RFC 0047 Unresolved question 2). Headless and CLI connectors cannot open a `connectUrl`. The `credential` kind could carry a `user_code` + verification URI instead. Deferred until an adopter asks.
5. **Incremental scopes** (RFC 0047 Unresolved question 3). `reason: "insufficient_scope"` is now expressible. Whether a host may request only the missing scopes, or must re-consent to all of them, is still open.

## Implementation notes (non-normative)

- **Sequencing.**
  - Land after Phase 1 P1-A (the `a2a-integration.md` lines this RFC amends), Phase 2 P2-c (the `kind`-bound `data` dispatch) and RFC 0208's spec PR.
  - RFC 0208 moves the v2 A2A and MCP mappings into `spec/v2/interop-map.json`, and its spec PR lands first. It defers every credential and authorization-required row to this RFC (RFC 0208 §A, "Rows another RFC owns"). It ships the `mcp.mrtr` InputRequiredResult (host as server) row with form mode limited to flat, non-secret schemas, the upstream MUST restated in §D.2(d). It also keys `a2a.taskState` so that a row carrying `interruptKind` overrides its status's default. This RFC's spec PR then adds §D.2(a)–(c) to that `mcp.mrtr` row, adds the override row `(waiting-input, credential) → auth-required`, and rewrites the `TASK_STATE_AUTH_REQUIRED` reverse note. The totality check needs no change (gap G9, closed).
  - Coordinate with RFC 0198 (MCP Tasks), whose `tasks/get` carries the same `inputRequests`, so §D.2 applies there unchanged.
  - RFC 0200 (the host as protected resource) is its inbound sibling. RFC 0047 §Alternatives 1 draws the same line.
- **Core word budget.**
  - Measured: `spec/v2/core/oauth.md` ≈ 515 words, `interrupt.md` +41 words, `interop.md` +6 words, for a total of ≈ 562 added.
  - Homing `oauth` and `credentials` grants 2 × 200 = 400.
  - Net **≈ +162**, which is under the +300 ceiling. The per-file counts are in the impl file.
- **Suite publication.** Under the override the window is waived. `review/arch-P3.md` P3-M6 recommends, per the RFC 0195 precedent, that no suite implementing a ★ RFC is published before 7 days from filing (2026-09-29). This is the steward's call; the impl file assumes the conservative date.
- **Witness pole.**
  - MyndHyve is the only `oauth` host (tier-2).
  - v2-reference (tier-1) needs a synthetic `oauth` provider, the facet, and the `authorize-start` seam to witness §A–§C and the A2A projection.
  - §D.1 and §D.2 are witnessed at major 2 on the v2 reference host's A2A server and MCP mount, which RFC 0208 builds. openwop-app's v1 MCP mount can exercise the v1 legs, which are non-gating (gap G3).
  - **The `authorize-start` seam sits in the assertion path** of the PKCE, `state`, same-Subject and `iss` legs, which assert on the URL it returns. It is admissible only if it calls the host's production authorization-URL builder, and the bundle's notes say so. A seam that builds its own URL is the host measuring its own stub (GOVERNANCE side-revision rule; `review/arch-impl.md` R9).

## Acceptance criteria

- [x] `Active`: 2026-09-22, by steward override of RFC 0147 §A.6 (the window was waived, not run; see `Updated`).
- [ ] Spec text merged: `spec/v2/core/oauth.md` (+ `declaration.json` `normativeText` for `oauth` and `credentials`), `interrupt.md`, `interop.md`; v1 `host-capabilities.md` §host.oauth, `connection-packs.md`, `interrupt.md`, `mcp-integration.md` §C.2, `a2a-integration.md`; RFC 0047 `Amended by` row.
- [ ] Schemas (v1 + v2 + `spec-artifacts/` regeneration): E.1–E.4; `errors.json` E.5.
- [ ] `oauth-same-user-binding` and `elicitation-form-no-secret` registered at `reference-impl`.
- [ ] The scenarios above ship in a published suite, and each is shown able to fail by its named sabotage.
- [ ] A committed host bundle carries `openwop.requirement.0199.pkce-s256`, `.state-single-use`, `.same-user-callback`, `.iss-validated` and `.credential-interrupt` at `executed-pass`, nothing relaxed. At least one host must be production (tier-2 MyndHyve, or tier-1 openwop-app if it adopts `oauth`). If the seams run on a 0%-traffic side revision, it is built from the production image and `host.build` records it as a side revision; the bundle notes state that `authorize-start` calls the production authorization-URL builder.
- [ ] `.mcp-url-mode` and `.form-mode-no-secret` `executed-pass` on a committed **v2** bundle of a host with a v2 MCP mount (the v2 reference host, after RFC 0208's mount). The v1 legs on openwop-app's v1 bridge are supplementary and do not satisfy this box.
- [ ] RFC 0156 §B retrospective review recorded. Until then, `Accepted` is **provisional** (register row `not-reviewed`).
- [ ] CHANGELOG entry.

## References

- **Upstream** (verified live 2026-09-22; copies kept with the review notes):
  - **MCP 2026-07-28.**
    - Basic › Authorization (`https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization`): §Overview 4 (PRM MUST), §Resource Parameter Implementation, §Canonical Server URI, §Authorization Response Validation (RFC 9207 §2.4 MUST).
    - Authorization Server Discovery (`…/basic/authorization/authorization-server-discovery`): §Protected Resource Metadata Discovery Requirements, §Authorization Server Metadata Discovery.
    - Security Considerations (`…/basic/authorization/security-considerations`): §Authorization Code Protection (PKCE, S256 when capable, refuse on absent `code_challenge_methods_supported`), §Open Redirection (`state` SHOULD; AS exact redirect MUST), §Access Token Privilege Restriction.
    - Client › Elicitation (`…/client/elicitation`): §Capabilities (`_meta["io.modelcontextprotocol/clientCapabilities"].elicitation.url`), §User Interaction Model (form-mode secret ban), §Requested Schema (flat primitives), §URL Mode Elicitation for OAuth Flows, §Phishing (same user MUST), §Safe URL Handling (no pre-authenticated URL). `schema.ts` `ElicitRequestURLParams { mode: "url", message, url }`, and `-32042` "2025-11-25 only".
  - **A2A v1.0.1** (`https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/docs/specification.md`, `specification/a2a.proto`): §7.6.1 (AUTH_REQUIRED MUSTs), §7.6.3; `TASK_STATE_AUTH_REQUIRED = 8`.
  - **IETF.**
    - RFC 6749 §4.1
    - RFC 7636 §4.2, §5
    - RFC 8414 §2, §3.3
    - RFC 8707 §2
    - RFC 9207 §2, §2.4
    - RFC 9700 (BCP 240) §4.4.2, §4.4.2.2
    - RFC 9728 §3, §3.1, §3.3, §5.1, §7.7
    - draft-ietf-oauth-v2-1-16 §7.5.1.1
- **Corpus.**
  - RFC 0046, RFC 0047 (amended), RFC 0076 (egress guard), RFC 0095 (connection packs), RFC 0153 (MCP current profile), RFC 0100/0152 (A2A), RFC 0192 (facet presence), RFC 0189/0190 (homing and budget), RFC 0147 §A.6, RFC 0156 §B, RFC 0194 (override precedent).
  - `spec/v1/host-capabilities.md` §host.oauth; `spec/v1/connection-packs.md` §Manifest clauses 3 and 5; `spec/v1/interrupt.md`; `spec/v1/interrupt-profiles.md:31`; `spec/v1/mcp-integration.md` §C.1–§C.2; `spec/v1/a2a-integration.md:84,235,433`; `spec/v2/core/interop.md` §The durable-task projection; `spec/v2/core/interrupt.md`.
- **Review inputs.** `review/E-auth-security.md` F5, F6, F8; `review/verify-EF.md` #7, E-F6, #14; `review/arch-P3.md` P3-C1, P3-H5, P3-H7, P3-M5, P3-M6, P3-L1/L2.
