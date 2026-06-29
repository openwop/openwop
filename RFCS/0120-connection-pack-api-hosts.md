# RFC 0120: Connection-pack provider `apiHosts` — declared credential-egress allow-list

| Field | Value |
|---|---|
| **RFC** | 0120 |
| **Title** | Connection-pack provider `apiHosts` — declared credential-egress allow-list |
| **Status** | `Active` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-28 |
| **Updated** | 2026-06-29 (**Draft → Active** + normative surface, on convergent dual reference-host input — openwop-app-1 (egress-leg witness) + myndhyve-1 (provider author, honest egress opt-out). Folded **UQ1** (SHOULD vs MUST → *conditional MUST*: `apiHosts` REQUIRED when `reach: openapi` at the manifest schema **and** at the RFC 0045 binding site; SHOULD otherwise — host-less packs stay valid) and **UQ3** (eTLD+1 vs exact-host → eTLD+1 **floor** with **dot-anchored** suffix containment, pack MAY tighten to an exact host) into the schema + spec §Manifest items 10–15. Wire shape locked: `provider.apiHosts` + the `reach:openapi ⇒ apiHosts` conditional landed in `connection-pack-manifest.schema.json`. SECURITY invariant rows + conformance scenarios + reference-host impl remain **pending (Accepted stage)** — single behavioral witness (openwop-app) recorded honestly. — earlier 2026-06-29: architect review fixed the IPv4-literal regex (CRITICAL), split the SECURITY invariant into shape + egress-binding, added §B RFC 0079 AND-composition (UQ4/G4 resolved). 2026-06-28 |
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

Add one optional `provider` property **and** a provider-level `allOf` that makes it conditionally required (UQ1). The `provider` object is `"additionalProperties": false`, so the property MUST be added explicitly:

```diff
 "provider": {
   "type": "object",
   "required": ["id", "displayName", "category", "auth", "reach"],
   "additionalProperties": false,
+  "allOf": [
+    { "if":   { "required": ["reach"], "properties": { "reach": { "required": ["openapi"] } } },
+      "then": { "required": ["apiHosts"] } }
+  ],
   "properties": {
     "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
     "displayName": { "type": "string", "minLength": 1 },
     "category": { "type": "string", "enum": [ ... ] },
     "auth": { ... },
     "reach": { ... },
     "consumerNodes": { "type": "array", "items": { "type": "string" } },
     "docsUrl": { "type": "string", "format": "uri" },
+    "apiHosts": {
+      "type": "array",
+      "description": "RFC 0120 — credential-egress allow-list. Bare registrable hostnames; dot-anchored eTLD+1 suffix containment, pack MAY tighten to an exact host. No scheme/port/path/wildcard/IP. REQUIRED when reach is openapi (the allOf). Omitted ⇒ egress fails closed.",
+      "items": { "type": "string", "format": "hostname", "pattern": "^(?!-)[a-z0-9-]{1,63}(\\.[a-z0-9-]{1,63})*\\.[a-z][a-z0-9-]*$" },
+      "uniqueItems": true,
+      "minItems": 1
+    }
   }
 }
```

The `allOf` is the **install-time half** of UQ1's conditional MUST: an `openapi`-reach provider (a credentialed REST surface) that omits `apiHosts` is rejected at schema validation. It keys on `reach.openapi` — present in the manifest — **not** on "declares an egressing RFC 0045 action," which is a separate artifact the manifest cannot see; the **consumption-time half** (binding-site validator, §B item 13.2) covers paths the schema can't. Verified with the corpus's `ajv/2020`: `mcp`-reach without `apiHosts` validates; `openapi`-reach without `apiHosts` is rejected; `openapi` + `127.0.0.1` and `openapi` + `*.facebook.com` are rejected; `openapi` + `facebook.com` / `googleads.googleapis.com` validate.

### §B — Normative prose (`spec/v1/connection-packs.md` §Manifest items 10–15)

Appended after the existing §Manifest items 1–9 (the spec doc already numbers through item 9 — "validator robustness"). The six new clauses, as landed:

10. **`provider.apiHosts` — credential-egress allow-list + matching rule (UQ3).** When present, `apiHosts` is the set of API hosts a host **MAY** send this provider's resolved credential to for connector egress (an RFC 0045 action / brokered fetch). A host performing credential-bearing connector egress **MUST** restrict the destination to a host that **matches** an `apiHosts` entry and **MUST fail closed** (no credential sent) otherwise. **Matching is dot-anchored suffix containment**: a request host matches an entry **iff** it equals the entry **or** ends with `"." + entry` — never a bare substring (`notexample.com` / `evil.com` do **not** match `example.com`). eTLD+1 is the **floor** (`facebook.com` admits `graph.facebook.com`); a pack **MAY** declare a tighter exact host (`googleads.googleapis.com`) — the host enforces containment, the pack chooses granularity.

11. Each `apiHosts` entry **MUST** be a **bare registrable hostname**: lowercase ASCII, two or more dot-separated labels, the **final (TLD) label beginning with an ASCII letter**, and **MUST NOT** carry a scheme, userinfo, port, path, query, fragment, wildcard (`*`), or IP literal (v4 or v6). A host **MUST** reject a manifest whose `apiHosts` contains a non-conforming entry with `connection_pack_invalid_api_host`. (The TLD-must-be-alphabetic rule is what makes the §A `pattern` reject IPv4 literals such as `127.0.0.1` / `10.0.0.1`; `format: "hostname"` is advisory in JSON Schema and admits all-numeric hosts, so the egress allow-list **MUST NOT** rely on it for IP rejection.)

12. `apiHosts` is **independent of** the OAuth `authorize`/`token`/`revoke` endpoint hosts (RFC 0047, the *auth* surface) and of any `reach.openapi.ref` documentation host. A host **MUST NOT** infer `apiHosts` from those — they routinely differ from the API host. A pack **MUST** declare `apiHosts` explicitly to be reachable by credential-bearing egress.

13. **When `apiHosts` is required — the conditional MUST (UQ1).** A provider **SHOULD** declare `apiHosts` whenever it can be consumed by a credential-bearing RFC 0045 action. This SHOULD is sharpened to a **MUST at two enforcement points** so the footgun is caught where it bites without breaking host-less packs:
    1. **Install-time (manifest schema).** When `provider.reach` is `openapi` (a credentialed REST/OpenAPI egress surface), `apiHosts` is **REQUIRED** — a manifest omitting it **MUST** be rejected (schema-validation failure / `connection_pack_invalid_api_host`). This is the §A `allOf`.
    2. **Consumption-time (runtime).** When an RFC 0045 credential-bearing action binds this provider, a host **MUST** verify `apiHosts` is present and **MUST fail closed** (`validation_error`, no credential sent) if absent — catching credentialed-egress paths the manifest cannot see (e.g. a `reach: mcp` provider that nonetheless brokers a credentialed fetch).

    A provider with neither an `openapi` reach nor a credentialed-egress consumer — a metadata-only / read-via-MCP pack with no REST host — **MAY** omit `apiHosts` and remains valid; every credential-bearing call to a provider without `apiHosts` simply **fails closed**, which a host **SHOULD** surface as an honest "provider unreachable for egress" rather than a silent no-op.

14. `apiHosts` only constrains the **destination** of a credential the host already resolves host-side (RFC 0046/0047 unchanged). It does **not** place the credential anywhere new — not on the wire, in events, the debug bundle, nor replay state. A host **MUST** treat `apiHosts` as **fixed, manifest-declared** data and **MUST NOT** derive or extend it from runtime user/agent input.

15. **`apiHosts` composes with — and never widens past — the RFC 0079 `egress-credential-audience-bound` guard.** `apiHosts` is the *pack-declared static allow-list*; RFC 0079's per-use provenance `audiences` is a *runtime audit-and-binding* layer. They are **independent and AND-composed**: where a host enforces both, a credential-bearing egress **MUST** satisfy both (destination must match `apiHosts` **and** pass the RFC 0079 audience binding). A host **MUST NOT** treat a successful `apiHosts` match as an escape hatch that bypasses, relaxes, or auto-satisfies the RFC 0079 confused-deputy MUST — `apiHosts` may only *narrow* the destination set, never *widen* it past what RFC 0079 already permits. (For a fresh pack credential whose provenance `audiences` are empty, the egress allow-list is governed by `apiHosts`; the RFC 0079 binding still applies to any credential it covers.)

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
- The **conditional MUST** (`reach: openapi ⇒ apiHosts` required, §A `allOf`) is a fail-closed **tightening**, not a relaxation: an `openapi`-reach provider without `apiHosts` could not perform credential-bearing egress today (it fails closed), so rejecting it at schema validation regresses **no deployed behavior** — it converts a silent dead-end into an honest install-time error. Verified additive against the corpus: the only connection-pack fixture (`connection-pack-github.json`) is `reach: mcp`, and the sole inline `openapi` spec example is already an intentional `maxProperties` validation-failure case — nothing previously-valid breaks.
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

1. **SHOULD vs MUST — RESOLVED 2026-06-29 (§B item 13, §A `allOf`).** Converged dual reference-host input (openwop-app-1 + myndhyve-1): a **conditional MUST**, not a flat choice. `apiHosts` is **REQUIRED** at two enforcement points — install-time when `reach: openapi` (manifest schema), and consumption-time when an RFC 0045 credential-bearing action binds the provider (runtime `validation_error`/fail-closed) — and **SHOULD** otherwise. The architect pass re-keyed openwop-app's literal "if egressing-action" predicate (unexpressible — the manifest carries no RFC 0045 actions) to **`reach: openapi`** (manifest-present), with myndhyve's binding-site validator as the runtime complement. Metadata-only / read-via-MCP host-less packs stay valid.
2. **Port support.** The draft forbids a port (443 only). Some providers expose non-443 API ports. Keep host-only, or allow an optional `:port`? (Leaning host-only — a port in an allow-list is unusual and widens the parser.) *(Still open — not blocking; revisit if a real provider needs it.)*
3. **eTLD+1 vs exact-host matching — RESOLVED 2026-06-29 (§B item 10).** Converged dual input: eTLD+1 as the **floor**, with packs free to enumerate a tighter exact host. Match = **dot-anchored suffix containment** (request host == entry OR ends with `"." + entry`), so `googleapis.com` admits all `*.googleapis.com` (one entry) while a pack worried about over-broad reach (an ads pack that wants only `googleads.googleapis.com`) MAY scope down; the no-substring-escape property (`notexample.com` fails against `example.com`) is explicit and is asserted by the egress behavioral conformance leg. The over-broad-eTLD+1 case is the pack author's documented tradeoff — item 15's AND-composed RFC 0079 audience-binding still constrains per-use.
4. **Relationship to RFC 0079 `connectionUse` provenance audiences. — RESOLVED 2026-06-29.** Independent, AND-composed layers (now normative — §B item 11): `apiHosts` is the pack-declared *static allow-list*; RFC 0079 `audiences` is the *runtime audit/binding*. A credential-bearing egress MUST satisfy **both** where both apply; an `apiHosts` match MUST NOT bypass/relax the RFC 0079 `egress-credential-audience-bound` MUST, and MUST NOT widen egress past it. No auto-population — they stay distinct layers.
5. **Reference-host migration.** The reference app currently encodes `apiHosts` in `providerRegistry.ts` built-ins; once packs can declare it, do the `bigquery`/`microsoft-graph` dedicated built-ins fold back into their packs, or stay as narrow read-only identities for a different reason? (Implementation-side, non-normative.)

## Implementation notes (non-normative)

- **Schema** is a one-property addition (the diff in §A). The host-shape `pattern` + the `connection_pack_invalid_api_host` code do most of the work; the eTLD+1 match is the host's existing connector-egress matcher (reference: `brokeredFetch`/`hostMatchesApi`).
- **Reference host:** the connection-pack loader's `toProviderManifest` reads `provider.apiHosts` into the registry `ProviderManifest.apiHosts` (the one documented spot that "never sets it" today); no change to `brokeredFetch`, which already pins to `getProvider(provider).apiHosts`. The `bigquery`/`microsoft-graph` workaround comments become resolvable.
- **Concretely unblocks** openwop-app ADR 0167: with `meta-ads.apiHosts = ['facebook.com']`, the Meta cascade-delete rollback (`brokeredFetch` DELETE) stops no-oping and actually deletes; all three ad packs (meta/google/tiktok) and any future connector-action pack become reachable.
- **Cross-cut:** additive + connection-packs-gated — merges independently; no `CC-N` coordination needed.

## Acceptance criteria

**Landed at Active (wire shape locked):**
- [x] Spec text (`spec/v1/connection-packs.md` §Manifest items 10–15) merged
- [x] `schemas/connection-pack-manifest.schema.json` adds optional `provider.apiHosts` (host-shape pattern with the TLD-must-be-alphabetic rule so IP literals are rejected, `uniqueItems`) **and** the provider-level `allOf` making it required when `reach: openapi` (UQ1 install-time half)
- [x] CHANGELOG `[Unreleased] > Additive` entry

**Pending at Accepted (implementation — openwop-app-1 is the committed egress behavioral-leg witness; myndhyve-1 honest egress opt-out):**
- [ ] **Two** `SECURITY/invariants.yaml` rows, each with its public test: (a) `connection-pack-api-host-shape` — protocol-tier, the manifest-shape MUST-NOT (URL/wildcard/IP/single-label/port + `openapi`-without-`apiHosts` rejected), verified **always-on, server-free**; and (b) `connection-pack-egress-host-bound` — the security-critical egress MUST (item 10): a credential-bearing egress to a non-`apiHosts` host **fails closed** + composes with RFC 0079 (item 15), verified by the **capability-gated behavioral** leg. (The egress-binding guarantee MUST NOT ride only the shape test — a shape test never proves a credential *isn't* sent to a non-allowed host.)
- [ ] ≥2 conformance scenarios: the always-on manifest-validity leg (incl. IP-literal + `openapi`-without-`apiHosts` rejection + the dot-anchored no-substring-escape assertion) **and** the gated host-behavioral egress allow-list leg, capability-gated on `connections.packsSupported`
- [ ] Reference host reads `provider.apiHosts` in the connection-pack loader and passes the new scenarios (single behavioral witness recorded honestly until a second egressing host re-measures)

## References

- RFC 0095 — Connection Packs (the manifest this amends); RFC 0045 — Connector-Pack Manifest & Action Model (the egress this enables); RFC 0046/0047 — host credentials + OAuth flows (credential resolution, unchanged); RFC 0079 — credential provenance & egress policy (the eTLD+1 audience-binding this aligns with).
- `SECURITY/threat-model-secret-leakage.md` (the egress-destination surface) · `SECURITY/threat-model-node-packs.md` (operator-install + pack-signing trust boundary).
- openwop-app **ADR 0167** (real ad dispatch) + **ADR 0024** (Connections broker) — the concrete motivating consumer; the `bigquery` / `microsoft-graph` dedicated-builtin comments document the gap this closes.
