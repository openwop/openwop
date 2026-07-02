# RFC 0123: Connection-pack provider `vendor` — catalog grouping

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0123                                                            |
| **Title**         | An additive `vendor` field on the connection-pack provider manifest, so a catalog can group connectors by the commercial vendor a customer does business with |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-07-02                                                      |
| **Updated**       | 2026-07-02                                                      |
| **Affects**       | `schemas/connection-pack-manifest.schema.json` (additive optional `provider.vendor`) · `spec/v1/connection-packs.md` (§ provider fields) · `registry/` index + `packs.openwop.dev` (a `vendor` facet on the connection tab) |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                               |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Add an **optional** `vendor` string to the RFC 0095 connection-pack `provider` object —
the commercial vendor / ecosystem a connector belongs to ("Microsoft 365", "Google",
"Workday", "Atlassian"). It is presentational metadata for **grouping the connector
catalog** so a customer can pick connectors by the vendors it already does business with
(a Google shop connects Google Workspace + Gmail + BigQuery under one heading). It is
**not** the resolution key — RFC 0047's `provider` id still resolves auth — and it
changes no behavior; a manifest without `vendor` remains valid and a host that ignores
it is fully conformant.

## Motivation

The reference host (`openwop-app`) and the registry (`packs.openwop.dev`) already group
their connector catalog by **vendor** — a Microsoft-365 customer sees Outlook/Graph under
one heading, a Google customer sees Workspace + Gmail + BigQuery together — because
customers adopt integrations by the vendors they use, not by a flat alphabetical provider
list. Today that grouping is **host-side only**: it is derived from a hardcoded map over
*built-in* provider ids (openwop-app ADR 0183/0186; the registry's `build-index.mjs`).

That map cannot reach **pack-delivered** providers: RFC 0095's `provider` object is
`additionalProperties: false`, so a connection pack has no way to declare its vendor, and
a host/registry cannot group a third-party connector without shipping a bespoke code map
for it. The result is an asymmetry — a customer's own installed connectors fall out of
the vendor grouping that the built-ins enjoy — which defeats the point of packs being
portable, installable artifacts.

The spec is the right place to fix this because the grouping key must travel **with the
pack** (a portable artifact any host installs), not live in each host's private code. It
is a one-field, presentational, non-normative-behavior addition — exactly the kind of
metadata that belongs on the manifest next to the existing `category`.

`vendor` and `category` are **orthogonal** and both are useful: `category` is the
*capability* axis (email-calendar, hr, ticketing — used for capability-typed binding),
while `vendor` is the *who-sells-it* axis (Google spans three categories). Neither
substitutes for the other.

## Proposal

Add an optional `vendor` string to the `provider` object in
`schemas/connection-pack-manifest.schema.json`:

```diff
         "displayName": { "type": "string", "minLength": 1 },
         "category": {
           "type": "string",
           "enum": ["communication", "docs", "crm", "dev", "storage", "email-calendar", "ticketing", "data-warehouse", "marketing", "finance", "hr", "esignature", "support", "project-management", "payments", "other"]
         },
+        "vendor": {
+          "type": "string",
+          "minLength": 1,
+          "description": "OPTIONAL. The commercial vendor / ecosystem this connector belongs to (e.g. \"Microsoft 365\", \"Google\", \"Workday\"). Presentational grouping ONLY — it is NOT the resolution key (RFC 0047 `provider` still resolves auth). Free-form (not an enum) so a new vendor needs no schema change; a host/registry groups connectors sharing a `vendor` under one heading and MUST fall back to the provider `displayName` when it is absent."
+        },
         "auth": {
```

### Normative behavior

- A connection pack **MAY** set `provider.vendor`. It **MUST NOT** be treated as, or
  substituted for, the `provider.id` — the RFC 0047 resolution key is unchanged.
- A host or registry that renders a connector catalog **SHOULD** group connectors that
  share an identical `vendor` string under one heading, and **MUST** fall back to the
  provider's `displayName` for a connector whose `vendor` is absent (so nothing is ever
  hidden by the grouping).
- A host **MAY** ignore `vendor` entirely (render a flat list); doing so is conformant —
  `vendor` gates no capability and appears in no capability advertisement.
- `vendor` is free-form (not an enum): a new vendor is a data change, never a schema
  change. Producers **SHOULD** use the vendor's common product/brand name.

### Examples

Positive — a pack that groups under "Google":

```json
{
  "id": "google-bigquery",
  "displayName": "Google BigQuery",
  "category": "data-warehouse",
  "vendor": "Google",
  "auth": { "kind": "oauth2" },
  "reach": { "openapi": { "ref": "..." } }
}
```

Positive — a pack that OMITS `vendor` (still valid; groups under its `displayName`):

```json
{ "id": "acme-crm", "displayName": "Acme CRM", "category": "crm", "auth": { "kind": "api_key" }, "reach": { "openapi": { "ref": "..." } } }
```

Negative — `vendor` as a non-string (fails validation):

```json
{ "id": "x", "displayName": "X", "category": "crm", "vendor": ["Google"], "auth": { "kind": "api_key" }, "reach": { "integration": { "node": "n" } } }
```

## Compatibility

`additive` per `COMPATIBILITY.md §2.2`: a new **optional** field on an existing object.

- Existing manifests validate unchanged (no `vendor` ⇒ still valid).
- Existing hosts are unaffected (an unknown field is not present today because the object
  is `additionalProperties: false`; after this RFC, a host that does not read `vendor`
  simply renders a flat / `displayName`-grouped catalog).
- No behavior, capability advertisement, auth resolution, replay, or fork semantics
  change. No `MUST` is relaxed.

## Conformance

`vendor` is presentational and behavior-inert, so it gates no capability and needs no
`OPENWOP_REQUIRE_BEHAVIOR` scenario. The schema-validation legs suffice:

1. A `kind:"connection"` manifest **with** a valid `provider.vendor` string loads and is
   accepted (positive).
2. A manifest **without** `provider.vendor` loads and is accepted (back-compat).
3. A manifest with a non-string `provider.vendor` is **rejected** by schema validation
   (negative).

These attach to the existing RFC 0095 connection-pack loader scenarios; no new capability
handshake is introduced.

## Migration

None required. The field is optional and additive:

- **Producers** (pack authors) MAY add `vendor` at their own pace; a registry MAY
  backfill `vendor` for its curated connection packs.
- **Consumers** (hosts / registries) that already group built-in providers by a private
  vendor map (openwop-app, `packs.openwop.dev`) extend that map to *prefer* the pack's
  declared `vendor` when present, falling back to the private map / `displayName`
  otherwise. openwop-app ADR 0183/0186 already carries the host-side plumbing and reads
  the field only once this RFC is `Accepted` (its loader documents the deliberate
  omission until then).

## Open questions

- **Vendor-name normalization.** Free-form strings risk near-duplicates ("Microsoft 365"
  vs "Microsoft"). This RFC deliberately keeps `vendor` free-form (an enum would need a
  schema change per new vendor); the registry MAY publish a *recommended* vendor-label
  list as non-normative guidance. Resolved: normalization is a registry curation concern,
  not a wire constraint.
- **Sub-vendor granularity** (e.g. distinguishing "Google Ads" from "Google Workspace"
  within the "Google" vendor) is out of scope — that is the `category` axis' job.
