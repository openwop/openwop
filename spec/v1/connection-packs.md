# OpenWOP Spec v1 — Connection Packs

> **Status: Stable · v1.x (2026-06-12) — RFC 0095 `Accepted`.** Normative surface for [RFC 0095 — Connection packs](../../RFCS/0095-connection-packs-portable-provider-definitions.md) — a registry-distributable **provider definition** pack. Companion to [`node-packs.md`](./node-packs.md) §Connectors (RFC 0045), [`auth.md`](./auth.md) (the `host.oauth` flow), and the credential/oauth capabilities of RFC 0046/0047. Graduated `Active → Accepted` 2026-06-12: the non-steward MyndHyve `workflow-runtime` host advertises `connections.packsSupported` live on `api.myndhyve.ai` and passes all five RFC 0095 scenarios non-vacuously vs the published 1.23.0 suite under `OPENWOP_REQUIRE_BEHAVIOR=true`; the openwop-app reference host implements §Resolution (boot-time loader) with the same strict pass. Keywords MUST, SHOULD, MAY, MUST NOT, SHOULD NOT follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

## Why this exists

OpenWOP's connector stack already has three Accepted layers: a pack declares a named
integration's typed **actions** ([`node-packs.md`](./node-packs.md) §Connectors, RFC 0045);
the host performs the OAuth 2.0 dance for `auth: { type: 'oauth2', provider, scopes[] }`
(`host.oauth`, RFC 0047); and the resulting token lands in a credential store (`host.credentials`,
RFC 0046). All three lean on a single seam — the **`provider`** string — yet nothing defined
what `'github'` or `'salesforce'` *resolves to*: its authorize/token/revoke endpoints, the
scope strings that mean "read" vs "write", or how the integration is reached (an MCP server
or an OpenAPI surface). Every host hard-coded that catalog, so "a Google connection" was not
an installable thing — it was code each host re-wrote, and the connector marketplace RFC 0045
promised had no provider data to render.

A **connection pack** closes that seam. It is a new pack `kind` (`pack.json` with
`kind: "connection"`) whose payload is a portable, signed, registry-listable definition of a
**provider** — and nothing else. It is the missing sibling of the pack family
(node / prompt / workflow-chain / artifact-type / chat-card packs). When installed, an
RFC 0045 connector's `auth.provider` (or an RFC 0047 `host.oauth` provider string) resolves
against the pack's `provider.id` instead of host-locked code, so any conformant host gains
Google / Slack / GitHub / Jira / Stripe support by *installing a pack*. A connection pack
carries **no secret**: the OAuth **client** credential is a host concern (RFC 0047), supplied
out of band by the operator — the pack is public provider metadata only.

This is distinct from the neighbouring primitives: a **connector** (RFC 0045) is the *actions*
you perform; **`host.oauth`** (RFC 0047) is the token-acquisition *dance*; **`host.credentials`**
(RFC 0046) is the credential *at rest*; a **connection pack** (this doc) is the portable
*provider definition* the first three resolve against.

## Manifest

A connection pack manifest is `pack.json` at the pack root, validating against
[`connection-pack-manifest.schema.json`](../../schemas/connection-pack-manifest.schema.json).
It is disjoint from the other pack manifests via the `kind` discriminator and distributes
through the same signed-tarball + Ed25519 + SRI pipeline (`node-packs.md` §Signing).

1. A connection pack manifest **MUST** carry `kind: "connection"` and validate against
   `connection-pack-manifest.schema.json`. It **MUST** declare exactly one `provider`. Unlike
   the array-content pack kinds (`nodes[]` / `prompts[]` / `chains[]` / `artifactTypes[]` /
   `cards[]`), a connection pack's content is the single `provider` object; a manifest mixing
   `provider` with another kind's content array is rejected with `pack_kind_invalid`.

2. A connection pack **MUST NOT** contain credential material — no client secret, no
   access/refresh token, no API key, no password — in any field. A host **MUST** reject a
   connection-pack manifest that carries a property whose name indicates a secret with
   `connection_pack_credential_material`. The normative minimum blocklist of property
   names (matched case-insensitively, at any depth) is `clientSecret`, `client_secret`,
   `apiKey`, `api_key`, `token`, `accessToken`, `refreshToken`, `password`, `privateKey`,
   `secret`. **Exemption:** the property named `token` at exactly the path
   `provider.auth.endpoints.token` (the OAuth token-endpoint **URL**, RFC 0047) is exempt;
   the exemption applies to that full path only — a property named `token` at any other
   path **MUST** be rejected. The credential-material scan **MUST** run **before** generic
   schema validation, so a manifest carrying credential material surfaces the specific
   `connection_pack_credential_material` code rather than a generic schema-shape error.
   Hosts **MAY** extend the blocklist per deployment policy and **SHOULD** additionally
   reject property *values* matching well-known credential formats (e.g. `ghs_…`, `sk-…`,
   `xoxb-…` prefixes). The OAuth **client** credential is a host concern (RFC 0047;
   supplied out of band by the operator), never shipped in the pack.

3. `provider.auth.endpoints.{authorize,token,revoke}`, when present, **MUST** be absolute
   `https://` URLs. A host **MUST** treat them as **fixed, manifest-declared** values and
   **MUST NOT** derive them from runtime user input — they are not an SSRF surface (the same
   posture `host.oauth` already requires for token endpoints; the actual token POST and any
   MCP connect compose with the host `safeFetch` egress guard, RFC 0076).

4. When `provider.auth.kind` is `oauth2` and `provider.auth.scopeModel` is `groups`,
   `provider.auth.scopes.read` **SHOULD** be present, and `provider.auth.scopes.write` (when
   present) **MUST** be requested as a **separate** consent step — a host **MUST NOT** bundle
   write scopes into the initial read authorization. (For `scopeModel: "coarse"` — e.g. Stripe
   Connect `read_only`/`read_write` — and `scopeModel: "capabilities"` — e.g. Notion — the
   read/write group split does not apply; the host renders consent per the declared model.)

5. `provider.reach` **MUST** specify exactly one of `mcp` / `openapi` / `integration`,
   declaring which core node family injects the resolved credential — respectively
   `core.openwop.mcp.*` (against the declared MCP server), `core.openwop.http.openapi-call`
   (against the declared OpenAPI document), or the declared `core.openwop.integration.*` node.

6. **Resolution (the core contract).** When an RFC 0045 connector declares
   `auth: { type: 'oauth2', provider: P }` (or `host.oauth` is invoked for provider `P`), a
   host advertising `capabilities.connections.packsSupported: true` **MUST** resolve `P`
   against the installed connection pack whose `provider.id === P` to obtain the authorize/token
   endpoints and scope catalog. If no installed connection pack matches `P` **and** the host
   has no built-in definition for `P`, the host **MUST** refuse to register the dependent
   connector/pack with `connection_provider_unresolved`. A host **MAY** retain built-in
   provider definitions; when an installed connection pack and a built-in both define
   `provider.id` `P`, the installed pack **MUST** take precedence only when its `version` is
   greater-than-or-equal to the built-in's, otherwise the host **MUST** surface a
   `connection_provider_conflict` diagnostic rather than silently choosing. Version
   comparison **MUST** follow [SemVer §11](https://semver.org/#spec-item-11) — in
   particular, a prerelease version is **lower** than its corresponding release
   (`1.0.0-alpha.1` does **not** take precedence over a built-in `1.0.0`), and the
   prerelease component begins at the *first* hyphen after the patch digits (the
   prerelease of `1.0.0-x-y` is `x-y`).

7. Connection packs **MUST** be distributed through the same signed-tarball + Ed25519 + SRI
   pipeline as node/prompt packs, and **MUST** surface in the `registry/` index and on
   `packs.openwop.dev` as a distinct `connection` artifact facet (data-only — no new endpoint,
   mirroring `node-packs.md` §Connectors discovery).

8. **Rejection isolation.** A rejected connection pack means **not installed** — nothing
   more. On hosts that load installed packs at process start (*loader-path* hosts), one
   malformed pack **MUST NOT** prevent host startup or the registration of any other pack:
   the host **MUST** warn-and-continue per pack, and **MUST** make per-pack rejection
   reasons observable (e.g. an `errors[]` projection, a diagnostics endpoint, or logs)
   carrying the specific error code from this section. On hosts that validate at
   publish/install time behind an idempotent publish endpoint (*publish-path* hosts,
   [`idempotency.md`](./idempotency.md)), §Resolution **MUST** run **after** the
   idempotency short-circuit: a byte-identical re-publish of an already-installed pack
   **MUST** succeed even when resolution inputs have since changed (e.g. a built-in
   definition was removed after the original publish).

9. **Validator robustness.** A failure to load or compile
   `connection-pack-manifest.schema.json` itself (a malformed vendored schema, a
   schema-compiler throw) **MUST NOT** abort host startup and **MUST NOT** surface as an
   unstructured `5xx`: a publish-path host **MUST** return a structured error for the
   publish attempt; a loader-path host **MUST** disable connection-pack loading for the
   process (no pack installs; built-ins remain available) while continuing to boot.

10. **`provider.apiHosts` — credential-egress allow-list (RFC 0120).** When present, `apiHosts`
    is the set of API hosts a host **MAY** send this provider's resolved credential to for
    connector egress (an RFC 0045 action / brokered fetch). A host performing credential-bearing
    connector egress **MUST** restrict the destination to a host that **matches** an `apiHosts`
    entry and **MUST fail closed** (no credential sent) otherwise. **Matching is dot-anchored
    suffix containment**: a request host matches an entry **iff** it equals the entry **or** ends
    with `"." + entry` — never a bare substring (so `notexample.com` and `evil.com` do **not**
    match `example.com`). An entry is matched at the registrable-domain (eTLD+1) **floor** —
    `facebook.com` admits `graph.facebook.com` — and a pack **MAY** declare a tighter exact host
    (`googleads.googleapis.com`) to narrow egress: the host enforces the containment, the pack
    chooses the granularity.

11. **`apiHosts` entry shape.** Each entry **MUST** be a **bare registrable hostname**: lowercase
    ASCII, two or more dot-separated labels, the **final (TLD) label beginning with an ASCII
    letter**, and **MUST NOT** carry a scheme, userinfo, port, path, query, fragment, wildcard
    (`*`), or IP literal (v4 or v6). A host **MUST** reject a manifest whose `apiHosts` contains a
    non-conforming entry with the error code `connection_pack_invalid_api_host`. (The
    TLD-must-be-alphabetic rule is what makes the schema `pattern` reject IPv4 literals such as
    `127.0.0.1` / `10.0.0.1`; `format: "hostname"` is advisory in JSON Schema and admits
    all-numeric hosts, so the egress allow-list **MUST NOT** rely on it for IP rejection.)

12. **No inference from auth/doc hosts.** `apiHosts` is **independent of** the OAuth
    `authorize`/`token`/`revoke` endpoint hosts (RFC 0047) and of any `reach.openapi.ref`
    documentation host — these routinely differ from the API host. A host **MUST NOT** infer
    `apiHosts` from them; a pack **MUST** declare `apiHosts` explicitly to be reachable by
    credential-bearing egress.

13. **When `apiHosts` is required (conditional MUST).** A provider **SHOULD** declare `apiHosts`
    whenever it can be consumed by a credential-bearing connector action (RFC 0045). This SHOULD
    is sharpened to a **MUST at two enforcement points**, so the footgun is caught where it bites
    without breaking host-less packs:
    1. **Install-time (manifest schema).** When `provider.reach` is `openapi` (a credentialed
       REST/OpenAPI egress surface), `apiHosts` is **REQUIRED** — a manifest that omits it **MUST**
       be rejected (schema-validation failure / `connection_pack_invalid_api_host`).
    2. **Consumption-time (runtime).** When an RFC 0045 credential-bearing action binds this
       provider, a host **MUST** verify `apiHosts` is present and **MUST fail closed**
       (`validation_error`, no credential sent) if it is absent — this catches credentialed-egress
       paths the manifest cannot see (e.g. a `reach: mcp` provider that nonetheless brokers a
       credentialed fetch).

    A provider with neither an `openapi` reach nor a credentialed-egress consumer — a
    metadata-only or read-via-MCP pack with no REST host — **MAY** omit `apiHosts` and remains
    valid; every credential-bearing call to a provider without `apiHosts` simply **fails closed**,
    which a host **SHOULD** surface as an honest "provider unreachable for egress" rather than a
    silent no-op.

14. **Destination-only; manifest-fixed.** `apiHosts` only constrains the **destination** of a
    credential the host already resolves host-side (RFC 0046/0047 unchanged). It places the
    credential nowhere new — not on the wire, in events, the debug bundle, or replay state. A host
    **MUST** treat `apiHosts` as **fixed, manifest-declared** data and **MUST NOT** derive or
    extend it from runtime user/agent input.

15. **Composition with RFC 0079 (AND-composed, never widen).** `apiHosts` is the *pack-declared
    static allow-list*; RFC 0079's per-use provenance `audiences` is a *runtime audit-and-binding*
    layer. They are **independent and AND-composed**: where a host enforces both, a
    credential-bearing egress **MUST** satisfy both. A successful `apiHosts` match **MUST NOT** be
    treated as an escape hatch that bypasses, relaxes, or auto-satisfies the RFC 0079
    `egress-credential-audience-bound` MUST — `apiHosts` may only **narrow** the destination set,
    never **widen** it past what RFC 0079 already permits.

16. **`provider.vendor` — catalog grouping (RFC 0123, presentational).** A connection pack
    **MAY** set an optional `provider.vendor` string — the commercial vendor / ecosystem the
    connector belongs to (e.g. `"Microsoft 365"`, `"Google"`, `"Workday"`). It is
    **presentational metadata only** and gates no capability, appears in no capability
    advertisement, and changes no auth, replay, or fork behavior. A host or registry that
    renders a connector catalog **SHOULD** group connectors sharing an identical `vendor`
    string under one heading, and **MUST** fall back to the provider's `displayName` for a
    connector whose `vendor` is absent (so nothing is ever hidden by the grouping). A host
    **MAY** ignore `vendor` entirely and render a flat list; doing so is conformant.
    `vendor` **MUST NOT** be treated as, or substituted for, `provider.id` — the RFC 0047
    resolution key is unchanged; `vendor` (who-sells-it) and `category` (capability axis)
    are orthogonal and neither substitutes for the other. `vendor` is **free-form** (not an
    enum) so a new vendor is a data change, never a schema change; producers **SHOULD** use
    the vendor's common product/brand name.

## Capability

A host advertises connection-pack support via `capabilities.connections.packsSupported: boolean`
(absent ⇒ unsupported), mirroring `capabilities.prompts.packsSupported`. A host advertising it
**MUST** implement §Manifest clause 6 (Resolution). Connection packs are only *useful* on a host
that also advertises `capabilities.oauth.supported` (RFC 0047) or `capabilities.credentials.supported`
(RFC 0046); a host **SHOULD NOT** advertise `connections.packsSupported` without at least one
of those.

## Examples

A complete connection pack for GitHub, reached via the official GitHub MCP server:

```json
{
  "name": "core.openwop.connections.github",
  "version": "1.0.0",
  "kind": "connection",
  "engines": { "openwop": ">=1.0.0" },
  "provider": {
    "id": "github",
    "displayName": "GitHub",
    "category": "dev",
    "auth": {
      "kind": "oauth2",
      "authFlow": "pkce",
      "scopeModel": "groups",
      "endpoints": {
        "authorize": "https://github.com/login/oauth/authorize",
        "token": "https://github.com/login/oauth/access_token"
      },
      "scopes": {
        "read": [{ "key": "repo.read", "label": "Read repositories", "scopes": ["repo:status", "public_repo"] }],
        "write": [{ "key": "repo.write", "label": "Write repositories", "scopes": ["repo"] }]
      }
    },
    "reach": { "mcp": { "server": { "url": "https://api.githubcopilot.com/mcp/", "transport": "http" } } },
    "consumerNodes": ["core.openwop.mcp.invoke-tool", "core.openwop.mcp.read-resource"]
  }
}
```

Manifests that a host **MUST** reject:

```jsonc
// credential material (clause 2) → connection_pack_credential_material
{ "kind": "connection", "provider": { "id": "github",
  "auth": { "kind": "oauth2", "clientSecret": "ghs_xxx" } } }

// two reach modes (clause 5) → schema validation failure (reach maxProperties:1)
{ "provider": { "reach": { "mcp": { "server": {} }, "openapi": { "ref": "..." } } } }

// non-https endpoint (clause 3) → schema validation failure
{ "provider": { "auth": { "endpoints": { "token": "http://example.com/token" } } } }

// openapi reach without apiHosts (clause 13) → schema validation failure (conditional MUST)
{ "provider": { "reach": { "openapi": { "ref": "https://api.example.com/openapi.json" } } } }

// IP literal in apiHosts (clause 11) → connection_pack_invalid_api_host
{ "provider": { "reach": { "openapi": { "ref": "https://api.example.com/o" } },
  "apiHosts": ["127.0.0.1"] } }
```

A well-formed `openapi`-reach provider declaring its credential-egress allow-list (clauses 10–13):

```jsonc
{ "provider": { "id": "meta-ads", "displayName": "Meta Ads", "category": "marketing",
  "auth": { "kind": "oauth2", "endpoints": { "token": "https://graph.facebook.com/v19.0/oauth/access_token" } },
  "reach": { "openapi": { "ref": "https://developers.facebook.com/docs/marketing-api" } },
  "apiHosts": ["facebook.com"] } }
// graph.facebook.com (the real API host) matches facebook.com by dot-anchored eTLD+1 containment.
```

## Open spec gaps

| Gap | Status |
|---|---|
| `scopeModel` coverage — whether `groups`/`coarse`/`capabilities` captures every real consent model (Stripe coarse toggle, Notion capabilities) or needs richer per-model fields | Validate against the Tier-1 providers during reference-host impl (RFC 0095 UQ2) |
| Per-account-host providers — whether `auth.instanceUrlTemplate` is the right shape, and where the resolved `{account}` lives (pack vs the RFC 0046 per-connection record) for Snowflake/NetSuite/ServiceNow | RFC 0095 UQ3 |
| Provider-id precedence/namespacing — the version-based built-in-vs-installed rule (clause 6) vs scoped ids to prevent two community packs both claiming `github` | RFC 0095 UQ4 |
| MCP endpoint freshness — `reach.mcp.server.url` is volatile (the ecosystem moves monthly); whether the registry re-verifies and the host re-validates at install | RFC 0095 UQ1 |
| Core connection catalog — the Tier-1 `core.openwop.connections.*` packs (GitHub, Jira, Confluence, Notion, Linear, Microsoft 365, Stripe) ship as a follow-up once this mechanism is Accepted | RFC 0095 UQ5 |

## References

- [RFC 0095 — Connection packs](../../RFCS/0095-connection-packs-portable-provider-definitions.md)
- [`node-packs.md`](./node-packs.md) §Connectors (RFC 0045), §Signing, §Naming
- [`auth.md`](./auth.md) — `host.oauth` (RFC 0047) + `host.credentials` (RFC 0046)
- [`idempotency.md`](./idempotency.md) — the publish-path idempotency short-circuit clause 8 orders against
- `SECURITY/invariants.yaml` — `connection-pack-no-credential-material`
