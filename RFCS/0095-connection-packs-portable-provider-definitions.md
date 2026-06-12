# RFC 0095: Connection packs — portable provider definitions

| Field | Value |
|---|---|
| **RFC** | 0095 |
| **Title** | Connection packs — a registry-distributable provider definition that resolves the RFC 0047 `provider` string |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-12 |
| **Updated** | 2026-06-12 |
| **Affects** | `schemas/connection-pack-manifest.schema.json` (new) · `schemas/capabilities.schema.json` (additive `connections.packsSupported` flag) · `spec/v1/node-packs.md` (new §"Connection packs", sibling to §"Connectors") · `spec/v1/auth.md` (the RFC 0047 `provider` string gains a portable definition source) · `registry/` index + `packs.openwop.dev` (new `connection` artifact facet) · `SECURITY/invariants.yaml` (new `connection-pack-no-credential-material` invariant) · new conformance scenarios |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Add a **connection pack** — a new pack `kind` (`pack.json` with `kind: "connection"`) whose payload is a portable, signed, registry-listable definition of a **provider**: the authorize / token / revoke endpoints, the read/write OAuth scope catalog, and how the integration is reached (an MCP server, an OpenAPI surface, or a core integration node). It is the missing sibling in the pack family (node / agent / prompt / artifact-type / chat-card / workflow-chain packs each already have a dedicated `*-pack-manifest.schema.json`). A connection pack carries **no secret** — only public provider metadata; it makes RFC 0047's `auth: { type: 'oauth2', provider }` magic string resolve against an *installed artifact* instead of host-locked code, so any conformant host gains Google / Slack / GitHub / Jira / Stripe support by installing a pack rather than shipping a bespoke provider registry.

## Motivation

The connector stack is already three-quarters built and Accepted:

- **RFC 0045** (`connector` block) lets a pack declare a named integration's typed **actions** — `auth: { type: 'oauth2', provider: 'salesforce', scopes: [...] }`. That is *what you do*.
- **RFC 0047** (`host.oauth`) has the host perform the OAuth 2.0 authorization-code + refresh dance for that declaration and persist the result as a credential. That is *how the token is obtained*.
- **RFC 0046** (`host.credentials`) defines credential resolution, lifecycle, rotation, and redaction. That is *the credential at rest*.

The seam they all lean on is **`provider`** — a bare string. RFC 0045 says `provider: 'salesforce'`; RFC 0047 performs the dance "for that provider"; but **nothing in the spec defines what `'salesforce'` resolves to** — its `authorize_url`, `token_url`, the scope strings that mean "read" vs "write", or whether it is reached via an MCP server or a REST surface. Today every host hard-codes that catalog (the openwop reference app keeps it in `providerRegistry.ts`; other hosts re-implement it). The consequences:

1. **No portability.** "A Google connection" is not an installable thing; it is code each host re-writes, so a workflow that works on host A may have no provider definition on host B even though both advertise `host.oauth`.
2. **No marketplace data.** RFC 0045 §Discovery promises a connector marketplace on `packs.openwop.dev`, but the provider catalog that marketplace would render has no wire representation.
3. **No community providers.** Adding the 100th SaaS provider requires shipping host code, not publishing a manifest — the exact friction the pack model exists to remove.

This RFC closes that seam: the provider definition becomes a **connection pack**, distributed through the same signed pipeline as every other pack, and `provider: 'salesforce'` resolves against the installed `connection` pack whose `provider.id` is `salesforce`. The spec is the right place because `provider` is already a normative wire identifier (RFC 0045/0047) — only its *resolution source* was left implementation-defined.

## Proposal

### §A — New schema `schemas/connection-pack-manifest.schema.json` (additive)

A connection pack is `pack.json` at the pack root with `kind: "connection"`, peer to and disjoint from the other pack manifests via the `kind` discriminator (the established pattern from `prompt-pack-manifest.schema.json` / `workflow-chain-pack-manifest.schema.json`). It distributes through the same signed-tarball + Ed25519 + SRI pipeline.

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/connection-pack-manifest.schema.json",
  "title": "ConnectionPackManifest",
  "type": "object",
  "required": ["name", "version", "kind", "engines", "provider"],
  "additionalProperties": false,
  "properties": {
    "name":    { "type": "string", "pattern": "^(core|vendor|community|private)\\.[a-z][a-z0-9_-]*(\\.[a-z][a-zA-Z0-9_-]*)+$" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$" },
    "kind":    { "const": "connection" },
    "engines": { "type": "object", "required": ["openwop"], "properties": { "openwop": { "type": "string" } } },
    "provider": {
      "type": "object",
      "required": ["id", "displayName", "category", "auth", "reach"],
      "additionalProperties": false,
      "properties": {
        "id":          { "type": "string", "pattern": "^[a-z][a-z0-9-]*$", "description": "Stable provider id RFC 0045/0047 `provider` resolves to, e.g. `github`." },
        "displayName": { "type": "string", "minLength": 1 },
        "category":    { "type": "string", "enum": ["communication","docs","crm","dev","storage","email-calendar","ticketing","data-warehouse","marketing","finance","hr","esignature","support","project-management","payments","other"] },
        "auth": {
          "type": "object",
          "required": ["kind"],
          "additionalProperties": false,
          "properties": {
            "kind":     { "enum": ["oauth2","api_key","bearer","basic"] },
            "authFlow": { "enum": ["pkce","client_credentials","manual","none"] },
            "scopeModel": { "enum": ["groups","coarse","capabilities"], "default": "groups",
              "description": "`groups` = read/write scope groups (Google/Jira/Graph). `coarse` = a single read-vs-write toggle (Stripe Connect read_only/read_write). `capabilities` = consent is a static developer-portal capability set, not per-request scopes (Notion)." },
            "endpoints": {
              "type": "object", "additionalProperties": false,
              "properties": {
                "authorize": { "type": "string", "format": "uri", "pattern": "^https://" },
                "token":     { "type": "string", "format": "uri", "pattern": "^https://" },
                "revoke":    { "type": "string", "format": "uri", "pattern": "^https://" }
              }
            },
            "scopes": {
              "type": "object", "additionalProperties": false,
              "properties": {
                "read":  { "type": "array", "items": { "$ref": "#/$defs/ScopeGroup" } },
                "write": { "type": "array", "items": { "$ref": "#/$defs/ScopeGroup" } }
              }
            },
            "instanceUrlTemplate": { "type": "string",
              "description": "For per-account-host providers (Snowflake/NetSuite/ServiceNow): a template the host fills per connection, e.g. `https://{account}.snowflakecomputing.com`. Its presence signals the provider cannot use a single global OAuth app." }
          }
        },
        "reach": {
          "type": "object", "minProperties": 1, "maxProperties": 1, "additionalProperties": false,
          "description": "Exactly ONE of mcp | openapi | integration — which core node injects the resolved credential.",
          "properties": {
            "mcp":         { "type": "object", "required": ["server"], "additionalProperties": false,
              "properties": { "server": { "type": "object", "required": ["url","transport"], "properties": { "url": { "type": "string", "format": "uri", "pattern": "^https://" }, "transport": { "enum": ["http","sse"] } } } } },
            "openapi":     { "type": "object", "required": ["ref"], "additionalProperties": false,
              "properties": { "ref": { "type": "string", "description": "URL or in-pack path of the OpenAPI document for core.openwop.http.openapi-call." } } },
            "integration": { "type": "object", "required": ["node"], "additionalProperties": false,
              "properties": { "node": { "type": "string", "description": "A core.openwop.integration.* node typeId." } } }
          }
        },
        "consumerNodes": { "type": "array", "items": { "type": "string" },
          "description": "The core node typeIds that consume this provider's credential (e.g. core.openwop.mcp.invoke-tool)." },
        "docsUrl": { "type": "string", "format": "uri" }
      }
    }
  },
  "$defs": {
    "ScopeGroup": {
      "type": "object", "required": ["key","label","scopes"], "additionalProperties": false,
      "properties": {
        "key":    { "type": "string", "pattern": "^[a-z][a-z0-9._-]*$" },
        "label":  { "type": "string", "minLength": 1 },
        "scopes": { "type": "array", "items": { "type": "string" }, "description": "The provider's raw scope strings, e.g. `https://www.googleapis.com/auth/drive.readonly`." }
      }
    }
  }
}
```

### §B — Normative prose (new `spec/v1/node-packs.md` §"Connection packs")

1. A connection pack manifest **MUST** carry `kind: "connection"` and validate against `connection-pack-manifest.schema.json`. It **MUST** declare exactly one `provider`.
2. A connection pack **MUST NOT** contain credential material — no client secret, no access/refresh token, no API key, no password — in any field. A host **MUST** reject a connection-pack manifest that carries a property whose name or value indicates a secret (e.g. `clientSecret`, `apiKey`, `token`, `password`) with `connection_pack_credential_material`. The OAuth **client** credential is a host concern (RFC 0047; supplied out of band by the operator), never shipped in the pack.
3. `provider.auth.endpoints.{authorize,token,revoke}`, when present, **MUST** be absolute `https://` URLs. A host **MUST** treat them as **fixed, manifest-declared** values and **MUST NOT** derive them from runtime user input — they are not an SSRF surface (the same posture RFC 0047 already requires for token endpoints).
4. When `provider.auth.kind` is `oauth2` and `scopeModel` is `groups`, `auth.scopes.read` **SHOULD** be present, and `auth.scopes.write` (when present) **MUST** be requested as a **separate** consent step — a host **MUST NOT** bundle write scopes into the initial read authorization (composes with the write-re-consent pattern already used by RFC 0047 hosts).
5. `provider.reach` **MUST** specify exactly one of `mcp` / `openapi` / `integration`, declaring which core node family injects the resolved credential.
6. **Resolution (the core contract).** When an RFC 0045 connector declares `auth: { type: 'oauth2', provider: P }` (or RFC 0047 `host.oauth` is invoked for provider `P`), a host advertising `capabilities.connections.packsSupported: true` **MUST** resolve `P` against the installed connection pack whose `provider.id === P` to obtain the authorize/token endpoints and scope catalog. If no installed connection pack matches `P` **and** the host has no built-in definition for `P`, the host **MUST** refuse to register the dependent connector/pack with `connection_provider_unresolved`. A host **MAY** retain built-in provider definitions; an installed connection pack for the same `id` **MUST** take precedence over a built-in of the same `id` only when its `version` is greater-or-equal (else the host **MUST** surface a `connection_provider_conflict` diagnostic rather than silently choosing).
7. Connection packs **MUST** be distributed through the same signed-tarball + Ed25519 + SRI pipeline as node/prompt/agent packs (`node-packs.md` §Signing), and **MUST** surface in the `registry/` index and on `packs.openwop.dev` as a distinct `connection` artifact facet (data-only — no new endpoint, mirroring RFC 0045 §Discovery).

### §C — `capabilities.schema.json` (additive)

Add `capabilities.connections.packsSupported: boolean` (default absent ⇒ unsupported), mirroring `capabilities.prompts.packsSupported` (a `packsSupported` flag nested under a per-feature block — the established convention). A host advertising it **MUST** implement §B.6 resolution. Connection packs are only *useful* on a host that also advertises `capabilities.oauth.supported` (RFC 0047) or `capabilities.credentials.supported` (RFC 0046); a host **SHOULD NOT** advertise `connections.packsSupported` without at least one of those.

### Positive example (`core.openwop.connections.github`)

```jsonc
{ "name": "core.openwop.connections.github", "version": "1.0.0", "kind": "connection",
  "engines": { "openwop": ">=1.0.0" },
  "provider": {
    "id": "github", "displayName": "GitHub", "category": "dev",
    "auth": { "kind": "oauth2", "authFlow": "pkce", "scopeModel": "groups",
      "endpoints": { "authorize": "https://github.com/login/oauth/authorize", "token": "https://github.com/login/oauth/access_token" },
      "scopes": { "read": [ { "key": "repo.read", "label": "Read repositories", "scopes": ["repo:status","public_repo"] } ],
                  "write": [ { "key": "repo.write", "label": "Write repositories", "scopes": ["repo"] } ] } },
    "reach": { "mcp": { "server": { "url": "https://api.githubcopilot.com/mcp/", "transport": "http" } } },
    "consumerNodes": ["core.openwop.mcp.invoke-tool","core.openwop.mcp.read-resource"] } }
```

### Negative examples (MUST fail validation / be rejected)

```jsonc
// 1. Carries credential material — rejected with connection_pack_credential_material (§B.2)
{ "kind": "connection", "provider": { "id": "github", "auth": { "kind": "oauth2", "clientSecret": "ghs_xxx" } } }

// 2. Two reach modes — violates reach maxProperties:1 (§B.5)
{ "provider": { "reach": { "mcp": { "server": {} }, "openapi": { "ref": "..." } } } }

// 3. Non-https endpoint — violates the https pattern (§B.3)
{ "provider": { "auth": { "endpoints": { "token": "http://example.com/token" } } } }
```

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.2:

- **No existing field** changes optionality or type — this adds a *new schema* (`kind: "connection"`), disjoint from all others via the `kind` discriminator.
- **No event-type shape** changes. (The `connector.authorized` / `connector.auth_expired` events from RFC 0047 are unchanged.)
- **No endpoint contract** changes — the registry pack index gains a `connection` facet (data-only), no new or altered route.
- **No `MUST` relaxed**, **no error-code meaning changed** — three *new* error codes are introduced (`connection_provider_unresolved`, `connection_provider_conflict`, `connection_pack_credential_material`).
- **New optional capability flag** `connections.packsSupported` — a host that does not advertise it behaves exactly as today (provider resolution stays implementation-defined / host-built-in). Existing hosts ignore connection packs; existing clients never depend on one being installed.

Forward-compat clauses: a connection pack a host hasn't installed is simply absent — a connector referencing an unknown provider fails the *same* way it does today (`connection_provider_unresolved` instead of a host-specific error), so no client regresses.

## Conformance

**Existing coverage:** RFC 0045 connector-manifest scenarios; RFC 0047 `host.oauth` scenarios; RFC 0046 credential + `redaction.test.ts` scenarios; the pack-manifest validity scenarios (`spec-corpus-validity.test.ts`).

**New scenarios** (gated on `capabilities.connections.packsSupported`; server-free where possible, <1s):

1. `connection-pack-manifest-valid` — a well-formed manifest validates; `kind` discriminator routes it to this schema and away from node/prompt/agent. Cites `node-packs.md §Connection packs`.
2. `connection-pack-no-credential-material` — a manifest carrying `clientSecret`/`apiKey`/`token` is **rejected** with `connection_pack_credential_material`. Enforces the new SECURITY invariant.
3. `connection-pack-reach-exclusive` — a manifest with two `reach` modes fails validation.
4. `connection-provider-resolution` — with a `github` connection pack installed, an RFC 0045 connector declaring `provider: 'github'` registers; with it absent and no built-in, registration fails with `connection_provider_unresolved`.
5. `connection-pack-write-reconsent` — a host requesting `write` scopes does so as a separate consent step, not bundled into the read authorization (composes with RFC 0047).

**Fixtures:** `fixtures/connection-pack-github.json` (positive) + `fixtures/connection-pack-credential-leak.json` (negative) → catalog rows in `fixtures.md`.

**INTEROP-MATRIX:** add a `connection-packs` column; reference hosts that implement §B.6 mark it.

## Alternatives considered

1. **Do nothing — keep the provider catalog host-locked.** Every host re-implements Google/Slack/GitHub; no marketplace data; community providers need host code. Rejected: this is precisely the friction the pack model exists to remove, and it leaves RFC 0045's marketplace promise unfulfillable.
2. **Bake providers into RFC 0047 as a fixed enum.** A spec-blessed `provider` enum with hard-coded endpoints. Rejected: not extensible (an RFC per provider), no community/private providers, and it puts a fast-moving catalog (MCP endpoints change monthly) inside the normative spec where it can't be versioned independently.
3. **Put the provider definition inside the RFC 0045 `connector` block** (each connector self-describes its provider). Rejected: couples the provider definition to each connector, so N connectors for one provider (a Salesforce-read pack + a Salesforce-write pack) duplicate and can disagree on the provider's endpoints; and it breaks credential sharing (RFC 0046 keys a credential by provider, not by connector). The provider is a *separate, reusable* artifact — hence a distinct pack kind.
4. **A `provider` block on the node-pack manifest (like RFC 0045's `connector` block).** Rejected for the same reason prompt/artifact-type/chat-card packs got their own `kind` rather than node-pack sub-blocks: a provider definition ships and versions independently of any node code, and a pure provider pack carries no `nodes[]`.

## Unresolved questions

1. **MCP endpoint freshness.** The MCP-server ecosystem moves monthly and the old `modelcontextprotocol/servers` monorepo is no longer the provider catalog. Should `reach.mcp.server.url` be treated as re-verifiable metadata the registry periodically re-checks (and the host SHOULD re-validate at install), rather than a frozen value? (Proposed: yes — add a non-normative "MCP endpoints are volatile" note + a registry health-check facet.)
2. **`scopeModel` coverage.** Is `groups | coarse | capabilities` sufficient, or do Stripe Connect (coarse `read_only`/`read_write`) and Notion (capabilities, not scopes) need richer modeling so a host renders the consent UI correctly?
3. **Per-account-host providers.** Is `auth.instanceUrlTemplate` the right shape for Snowflake/NetSuite/ServiceNow per-connection hosts, and does the resolved `{account}` belong in the connection pack or in the per-connection record (RFC 0046)?
4. **Provider-id namespacing & precedence.** §B.6 gives a version-based precedence rule for a built-in vs an installed pack of the same `id`. Is that sufficient, or do we need scoped ids (`core.github` vs `community.x.github`) to avoid two community packs both claiming `github`?
5. **Catalog seeding.** Should the Tier-1 providers (GitHub, Jira, Confluence, Notion, Linear, Microsoft 365, Stripe) ship as `core.openwop.connections.*` packs *in this RFC*, or as a follow-up "core connection catalog" RFC once the manifest is Accepted?

## Implementation notes (non-normative)

- **Sequencing:** spec text + schema → `capabilities` flag → conformance scenarios + fixtures → reference-host resolution (§B.6) → seed the Tier-1 `core.*` connection packs. The reference openwop app (ADR 0024) already has an in-code provider registry with these exact fields; the host work is to *load installed connection packs into that registry* and keep the operator-supplied OAuth client secret host-side (ADR 0024 §7) — so the impl is "make the existing registry installable," not new infrastructure.
- **Cross-cut:** additive — the spec PR can merge independently of any host; a `CC-N` entry is not required (no breaking impl assumption). Hosts adopt §B.6 when they flip `connectionsSupported`.
- **Effort:** ~1 schema + 1 spec section + 5 conformance scenarios + 1 capability flag + reference-host loader; the deep-research top-20 supplies the initial catalog content.

## Acceptance criteria

- [ ] Spec text merged (`node-packs.md §Connection packs`; `auth.md` note on the `provider` resolution source)
- [ ] `connection-pack-manifest.schema.json` added; `capabilities.schema.json` `connections.packsSupported` added; both pass `npm run openwop:check`
- [ ] `SECURITY/invariants.yaml` gains `connection-pack-no-credential-material` with a public conformance test
- [ ] At least the five conformance scenarios above land, capability-gated, with fixtures cataloged
- [ ] CHANGELOG entry under `[Unreleased]`
- [ ] A reference host implements §B.6 and passes the new scenarios, OR the RFC explicitly defers reference-host implementation to the catalog-seeding follow-up

## References

- RFC 0045 (connector pack manifest & action model) — the action layer this provider layer completes
- RFC 0046 (`host.credentials`) — credential resolution/lifecycle/redaction the resolved token lands in
- RFC 0047 (`host.oauth`) — the OAuth dance whose `provider` string this RFC makes portable
- RFC 0043 (registry and extension policy); `spec/v1/node-packs.md` §Connectors, §Signing, §Naming
- `prompt-pack-manifest.schema.json` / `workflow-chain-pack-manifest.schema.json` — the `kind`-discriminated pack-family precedent
- openwop-app **ADR 0024** (Connections credential broker) + **§7** (host-managed OAuth client config) — the reference-host implementation whose provider registry this RFC makes portable
- Prior art: n8n/Make/Zapier connector catalogs; Composio/Paragon/Workato unified-integration catalogs; the MCP server ecosystem (Cloudflare MCP Demo Day, Anthropic Integrations, `github.com/microsoft/mcp`, the GitHub MCP Registry) — corroborating the initial provider catalog
- Companion: `0095-connection-packs-portable-provider-definitions.gaps.md`, `…risks.md`
