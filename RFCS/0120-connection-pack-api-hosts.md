# RFC 0120: Connection-pack provider `apiHosts` — declared credential-egress allow-list

| Field | Value |
|---|---|
| **RFC** | 0120 |
| **Title** | Connection-pack provider `apiHosts` — declared credential-egress allow-list |
| **Status** | `Draft` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-28 |
| **Updated** | 2026-06-28 |
| **Affects** | `schemas/connection-pack-manifest.schema.json` · `spec/v1/connection-packs.md` (§B) · `SECURITY/invariants.yaml` · `conformance/src/scenarios/connection-pack-manifest-valid.test.ts` (+ a host-behavioral egress scenario) · reference host (`providerRegistry`/connection-pack loader) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

A connection pack (RFC 0095) defines a provider's auth endpoints, scope catalog, and reach — but **not the API host(s) the resolved credential may be sent to**. So a host that pins credential-bearing connector egress to a provider's API hosts (the confused-deputy guard) has **no allow-list for a pack-delivered provider and fails closed**. This RFC adds an **optional `provider.apiHosts`** array (bare registrable hostnames) to the connection-pack manifest, declaring that allow-list, so a pack provider becomes reachable by a connector action's egress (RFC 0045) instead of being unreachable or requiring a host-locked built-in workaround. It is purely additive: a pack without `apiHosts` behaves exactly as today.

## Motivation

RFC 0095 made `provider: 'salesforce'` resolve against an installed pack instead of host-locked code. RFC 0045 then made a connector **action** an authenticated outbound call to that provider's API. The safe execution of that call requires an **egress allow-list**: the host MUST send the resolved credential only to the provider's own API hosts (the confused-deputy / RFC 0079 audience-binding guard), never to an arbitrary URL the action could name. Reference hosts implement this as a per-provider `apiHosts` list and **fail closed** when a destination matches none.

The gap: **the connection-pack manifest cannot express `apiHosts`**, so a pack-delivered provider has an empty allow-list and every credential-bearing connector call to it fails closed. This is a documented limitation, not a hypothetical — the openwop reference app had to introduce dedicated *built-in* providers with distinct ids (`bigquery` instead of the pack-overridable `google`; `microsoft-graph` instead of `microsoft365`) precisely because "a pack override strips `apiHosts` … which would silently break egress." That workaround only works when the connection can live under a *different* provider id. It **fails** when the credential must be stored under the pack's own id — e.g. ad-platform dispatch (openwop-app ADR 0167) stores the user's OAuth token under provider `meta-ads`/`google-ads`/`tiktok-ads`; a distinct built-in id would have no token. And the host cannot *derive* `apiHosts` from the pack's OAuth endpoints, because the auth host and the API host routinely differ (Google: token `oauth2.googleapis.com`, docs `developers.google.com`, **API `googleads.googleapis.com`** — three different hosts). The provider must be able to **declare** its API hosts. The spec is the right place because `provider` and its reach are already normative wire identifiers (RFC 0045/0047/0095); only the credential-egress allow-list was left unexpressible.

## Proposal

### §A — Schema: `schemas/connection-pack-manifest.schema.json` (additive)

Add one optional property to the `provider` object (which is `"additionalProperties": false`, so it MUST be added explicitly):

```diff
 "provider": {
   "type": "object",
   "required": ["id", "displayName", "category", "auth", "reach"],
   "additionalProperties": false,
   "properties": {
     "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
     "displayName": { "type": "string", "minLength": 1 },
     "category": { "type": "string", "enum": [ ... ] },
     "auth": { ... },
     "reach": { ... },
     "consumerNodes": { "type": "array", "items": { "type": "string" } },
+    "apiHosts": {
+      "type": "array",
+      "description": "RFC 0120. The API host(s) a host MAY send this provider's resolved credential to for connector egress (RFC 0045). Each entry is a bare registrable hostname — no scheme, port, path, wildcard, or IP literal. Matched under the registrable-domain (eTLD+1) suffix rule, never substring. Omitted ⇒ no credential-bearing connector egress is reachable (fails closed).",
+      "items": { "type": "string", "format": "hostname", "pattern": "^(?!-)[a-z0-9-]{1,63}(\\.[a-z0-9-]{1,63})+$" },
+      "uniqueItems": true,
+      "minItems": 1
+    }
   }
 }
```

### §B — Normative prose (new items in `spec/v1/connection-packs.md`)

Appended after the existing reach/scope items:

6. **`provider.apiHosts`**, when present, is the set of API hosts a host **MAY** send this provider's resolved credential to for connector egress (an RFC 0045 action / brokered fetch). A host performing credential-bearing connector egress **MUST** restrict the destination to a host that matches an `apiHosts` entry under the **registrable-domain (eTLD+1) suffix rule** — the same matching RFC 0079 uses, never a substring match — and **MUST fail closed** (no credential sent) otherwise.

7. Each `apiHosts` entry **MUST** be a **bare registrable hostname**: lowercase ASCII, two or more dot-separated labels, and **MUST NOT** carry a scheme, userinfo, port, path, query, fragment, wildcard (`*`), or IP literal (v4 or v6). A host **MUST** reject a connection-pack manifest whose `apiHosts` contains a non-conforming entry with the error code `connection_pack_invalid_api_host`. (Rationale: the allow-list governs where a credential may be sent; a loose entry — a URL, a wildcard, an IP, or a single label — widens the confused-deputy surface.)

8. `apiHosts` is **independent of** the OAuth `authorize`/`token`/`revoke` endpoint hosts (RFC 0047, the *auth* surface) and of any `reach.openapi.ref` documentation host. A host **MUST NOT** infer `apiHosts` from those — they routinely differ from the API host. A pack **MUST** declare `apiHosts` explicitly to be reachable by credential-bearing egress.

9. When a pack's provider is consumed by a credential-bearing connector action (RFC 0045) or declares `reach: openapi`, it **SHOULD** declare `apiHosts`. A provider without `apiHosts` is **not** an error — but every credential-bearing connector call to it **fails closed** (item 6). Hosts **SHOULD** surface this as an honest "provider unreachable for egress" rather than a silent no-op.

10. `apiHosts` only constrains the **destination** of a credential the host already resolves host-side (RFC 0046/0047 unchanged). It does **not** place the credential anywhere new — neither on the wire, in events, the debug bundle, nor replay state. A host **MUST** treat `apiHosts` as **fixed, manifest-declared** data and **MUST NOT** derive or extend it from runtime user/agent input.

**Positive example** (meta-ads):
```json
{ "provider": { "id": "meta-ads", "displayName": "Meta Ads", "category": "marketing",
  "auth": { "kind": "oauth2", "endpoints": { "token": "https://graph.facebook.com/v19.0/oauth/access_token" } },
  "reach": { "openapi": { "ref": "https://developers.facebook.com/docs/marketing-api/reference" } },
  "apiHosts": ["facebook.com"] } }
```
`graph.facebook.com` (the real API host) matches `facebook.com` under eTLD+1. Google would declare `["googleapis.com"]`, TikTok `["tiktok.com"]`.

**Negative examples** (each rejected `connection_pack_invalid_api_host`):
- `["https://graph.facebook.com/v21.0"]` — a URL, not a host.
- `["*.facebook.com"]` — wildcard.
- `["127.0.0.1"]` / `["[::1]"]` — IP literal.
- `["facebook"]` — single label, not registrable.
- `["graph.facebook.com:8443"]` — carries a port.

## Compatibility

**Additive** per `COMPATIBILITY.md` §2.2. Forward-compatibility guarantees:
- `apiHosts` is **optional**; a pack that omits it validates and behaves **exactly as today** — credential-bearing connector egress to that provider fails closed (the current status quo for pack providers). No existing pack changes meaning.
- No required field becomes optional/removed; no type change; no event-shape or endpoint-contract change; no `MUST` relaxed; no error-code meaning changed (`connection_pack_invalid_api_host` is a **new** code on a **new** field).
- A host that does not yet understand `apiHosts` ignores it and continues to fail closed for that provider — strictly no worse than today. A host that does understand it gains the ability to reach the declared hosts. No interop regression.
- The provider object's `additionalProperties: false` means a pack carrying `apiHosts` is **rejected by an old host's schema** unless that host updates its bundled schema — so the field is gated behind the host advertising the connection-packs surface at the new suite version (a suite-version requirement, not a spec-relaxation). Documented under Conformance.

## Conformance

Existing: `conformance/src/scenarios/connection-pack-manifest-valid.test.ts` covers manifest validation; `connection-pack-*` install/resolve scenarios cover the surface. Capability-gated on the existing connection-packs flag (`host.connections.packsSupported`).

New scenarios (capability-gated on `connections.packsSupported`):
- **manifest validity** — a pack with well-formed `apiHosts` validates; URL / wildcard / IP / single-label / port-bearing / uppercase entries are each rejected with `connection_pack_invalid_api_host` (server-free, <1s).
- **egress allow-list (host-behavioral)** — a host advertising `connections.packsSupported`, given a pack with `apiHosts: ['example.com']`, **permits** a credential-bearing connector call to `api.example.com` and **fails closed** (`host_not_allowed`, no credential sent) to `evil.com` and to `notexample.com` (no substring escape). Reference-host scenario; gated.
- **fail-closed default** — a pack provider **without** `apiHosts` fails closed on credential-bearing egress (codifies item 9's consequence).

New fixtures: a `connection-pack-apihosts-valid` and `connection-pack-apihosts-invalid-*` set under `conformance/fixtures/`, added to `fixtures.md`.

## Alternatives considered

1. **Derive `apiHosts` from the pack's OAuth endpoints.** Rejected — unreliable: the token-endpoint host ≠ the API host for major providers (Google `oauth2.googleapis.com` vs `googleads.googleapis.com`). Would either under-allow (egress fails) or over-allow (token sent to the wrong host).
2. **Dedicated built-in providers (the status-quo workaround).** Rejected as the general fix — it works only when the credential can live under a *different* provider id; it fails when the connection must be stored under the pack's own id (ad-platform dispatch), and it re-introduces the host-locked provider catalog RFC 0095 set out to remove.
3. **Auto-include the `reach.openapi.ref` host in the allow-list.** Rejected — the OpenAPI `ref` is a *documentation* URL (e.g. `developers.facebook.com`), not the API host; auto-including it would both miss the real API host and widen egress to a docs host.
4. **Do nothing.** Rejected — pack-delivered providers permanently fail closed at credential-bearing connector egress; RFC 0045 actions over pack providers are unusable; the ADR 0167 ad cascade-delete stays a no-op; every host keeps hand-maintaining a built-in registry for any provider that needs egress, defeating RFC 0095.

## Unresolved questions

1. **SHOULD vs MUST** for `apiHosts` when a provider is consumed by an RFC 0045 action / `reach: openapi` (item 9). MUST would catch the footgun at install time but breaks metadata-only / read-via-MCP packs that legitimately have no REST API host. Current draft: SHOULD, with the fail-closed consequence stated.
2. **Port support.** The draft forbids a port (443 only). Some providers expose non-443 API ports. Keep host-only, or allow an optional `:port`? (Leaning host-only — a port in an allow-list is unusual and widens the parser.)
3. **eTLD+1 vs exact-host matching.** The draft reuses RFC 0079's registrable-domain suffix match for consistency. Should `apiHosts` instead require an exact host match (tighter, but forces packs to enumerate every subdomain)? Trade-off: `googleapis.com` (one entry, all `*.googleapis.com`) vs enumerating `googleads.`, `bigquery.`, etc.
4. **Relationship to RFC 0079 `connectionUse` provenance audiences.** Should a successful egress to an `apiHosts` host auto-populate the RFC 0079 provenance `audiences`, or are they independent layers? (They serve different purposes — allow-list vs per-use audit — but may want to agree.)
5. **Reference-host migration.** The reference app currently encodes `apiHosts` in `providerRegistry.ts` built-ins; once packs can declare it, do the `bigquery`/`microsoft-graph` dedicated built-ins fold back into their packs, or stay as narrow read-only identities for a different reason? (Implementation-side, non-normative.)

## Implementation notes (non-normative)

- **Schema** is a one-property addition (the diff in §A). The host-shape `pattern` + the `connection_pack_invalid_api_host` code do most of the work; the eTLD+1 match is the host's existing connector-egress matcher (reference: `brokeredFetch`/`hostMatchesApi`).
- **Reference host:** the connection-pack loader's `toProviderManifest` reads `provider.apiHosts` into the registry `ProviderManifest.apiHosts` (the one documented spot that "never sets it" today); no change to `brokeredFetch`, which already pins to `getProvider(provider).apiHosts`. The `bigquery`/`microsoft-graph` workaround comments become resolvable.
- **Concretely unblocks** openwop-app ADR 0167: with `meta-ads.apiHosts = ['facebook.com']`, the Meta cascade-delete rollback (`brokeredFetch` DELETE) stops no-oping and actually deletes; all three ad packs (meta/google/tiktok) and any future connector-action pack become reachable.
- **Cross-cut:** additive + connection-packs-gated — merges independently; no `CC-N` coordination needed.

## Acceptance criteria

- [ ] Spec text (`spec/v1/connection-packs.md` items 6–10) merged
- [ ] `schemas/connection-pack-manifest.schema.json` adds optional `provider.apiHosts` (host-shape pattern, `uniqueItems`)
- [ ] `SECURITY/invariants.yaml` row `connection-pack-api-host-shape` + a public conformance test
- [ ] ≥1 conformance scenario (manifest validity + the host-behavioral egress allow-list), capability-gated on `connections.packsSupported`
- [ ] CHANGELOG `[Unreleased] > Additive` entry
- [ ] Reference host reads `provider.apiHosts` in the connection-pack loader and passes the new scenarios

## References

- RFC 0095 — Connection Packs (the manifest this amends); RFC 0045 — Connector-Pack Manifest & Action Model (the egress this enables); RFC 0046/0047 — host credentials + OAuth flows (credential resolution, unchanged); RFC 0079 — credential provenance & egress policy (the eTLD+1 audience-binding this aligns with).
- `SECURITY/threat-model-secret-leakage.md` (the egress-destination surface) · `SECURITY/threat-model-node-packs.md` (operator-install + pack-signing trust boundary).
- openwop-app **ADR 0167** (real ad dispatch) + **ADR 0024** (Connections broker) — the concrete motivating consumer; the `bigquery` / `microsoft-graph` dedicated-builtin comments document the gap this closes.
