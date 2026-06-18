# RFC 0103: Localized Content Surface — durable, authored, structured localized content (pages → sections) extending the Stable i18n annex

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title**         | Localized Content Surface — a capability-gated content data model (page → section, where a section is one record with a base `data` payload plus a sparse `localizations` map) plus delivery + admin endpoints, **reusing the Stable `spec/v1/i18n.md` annex's `Accept-Language`/`Content-Language` negotiation and fallback verbatim** and adding only the content model + a per-section field merge, so a host can serve durable authored content in multiple locales without a second locale mechanism |
| **RFC**           | 0103                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Status**        | `Accepted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Author(s)**     | David Tufts (@davidscotttufts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Created**       | 2026-06-17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Updated**       | 2026-06-17 (Draft → **Active** — 7-day window waived, maintainer call) · 2026-06-17 (Active → **Accepted** — `spec/v1/localized-content.md` + 4 schemas + `content` capability + OpenAPI paths + conformance scenario (suite 1.27.0) + 3 protocol-tier SECURITY invariants landed; dual non-steward host evidence: openwop-app reference HOST-1+2 + MyndHyve witness Layer 1+2) · 2026-06-18 (**first non-vacuous behavioral witness**: MyndHyve `workflow-runtime` prod rev `00273-6rf` (`api.myndhyve.ai`) ran `localized-content-delivery` 18/18 incl. the live §A-coherence leg + `i18n-negotiation` 4/4; `content` advertisement steward-curl-verified — closes the KNOWN-LIMITS behavioral residual to a second-witness narrowing) |
| **Affects**       | `spec/v1/i18n.md` (relationship only — reuses its negotiation/fallback; no edit to its normative text) · NEW `spec/v1/localized-content.md` (the content data model, the per-section field merge, delivery + admin endpoints, capability advertisement, security invariants) · NEW `schemas/localized-content-section.schema.json`, `schemas/localized-content-page.schema.json`, `schemas/localized-content-language-settings.schema.json`, `schemas/localized-content-page-response.schema.json` · `schemas/capabilities.schema.json` (NEW additive `content` capability block) · `api/openapi.yaml` (additive `GET /v1/content/pages/{slug}` public delivery + tenant-scoped admin CRUD) · `CHANGELOG.md` · `INTEROP-MATRIX.md` · `README.md` doc index · `ROADMAP.md` · new capability-gated scenarios in `conformance/src/scenarios/localized-content-delivery.test.ts` |
| **Compatibility** | `additive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Supersedes**    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Superseded by** | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Summary

`spec/v1/i18n.md` (`Stable`, v1.1) localizes **transient, host-rendered human-facing text** — interrupt prompts, error envelopes, conversation prompts — by negotiating `Accept-Language` → `Content-Language` with a normative fallback (q-value order → language family → host default). It is explicitly scoped *away* from structured content. This RFC adds the complementary surface: **durable, authored, structured localized content** — pages composed of sections, where a section is **one record** carrying a base `data` payload plus a sparse `localizations: { <bcp47>: { <partial field overrides> } }` map (never one record per locale), served in the locale the *existing annex* negotiates. It is `additive` and capability-gated behind a new `content` block: a host that doesn't advertise `content` is unaffected, and the content block's locale set MUST be a subset of the host's already-advertised `capabilities.i18n.supportedLocales`. The only genuinely new normative algorithm is the **per-section field merge** (exact-locale overrides → language-family overrides → base `data`, a shallow overlay) that runs *after* the annex has already selected the negotiated locale.

## Motivation

The motivating host is the OpenWOP reference app (openwop-app), which is adding a localized-content CMS (design: `openwop-app/CMS-I18N-PLAN.md`, ported from a proven Firestore CMS and made normative). openwop-app has no CMS today — it is a workflow/agent host — so the surface is being defined in the spec corpus *first*, then implemented.

Today the protocol has exactly two relevant facts:

1. **`i18n.md` localizes transient text only.** Its Scope section lists structured content as out of scope: it handles "interrupt prompts, error envelopes, and (host-extension) UI strings" and "Localization OF the protocol spec itself" / "node-pack node names" are explicitly excluded. There is no normative contract for serving *authored* content (a marketing page, a help article, an onboarding flow) in multiple locales.

2. **There is no second locale mechanism, and there must not be one.** The annex makes `Accept-Language` authoritative and **forbids** sniffing locale from the request body or overriding the header (`i18n.md` §"`Accept-Language` request header" → Host MUST NOT). A `?locale=` query parameter — the obvious shortcut, and what the source CMS used — would directly violate that. Any content surface MUST reuse the annex's negotiation so that a client sending `Accept-Language: pt-BR` resolves identically whether it is reading an interrupt prompt or a content page.

The spec is the right place (not an implementation choice) because **cross-host content portability is an interop concern**: the section-envelope shape (`data` + `localizations`) and the resolution algorithm must be agreed, or a page authored on host A resolves differently on host B. The same argument that put locale *negotiation* in the spec (so every host fills `Content-Language` the same way) applies to the *content data model* layered on top of it. No failing conformance scenario drove this — it is forward-authored from the openwop-app host product need; prior art (the source CMS's `resolveLocale`) is cited and made normative.

## Proposal

This RFC adds one capability block, one normative spec doc (`spec/v1/localized-content.md`), four schemas, and a public + admin endpoint surface. All of it is gated behind the new `content` capability; nothing changes for hosts that don't advertise it. Locale negotiation is **not redefined** — the annex's algorithm is referenced and reused.

### §A — The `content` capability block (additive, `schemas/capabilities.schema.json`)

A new optional sibling of the existing `i18n` block:

```jsonc
"content": {
  "supported": true,
  "baseLocale": "en",                       // the locale section `data` is authored in (the default-locale fields)
  "supportedLocales": ["es", "pt-BR", "fr"] // locales the host has AUTHORED content translations for
}
```

Shape: `{ supported: boolean, baseLocale: string (BCP 47), supportedLocales: string[] (BCP 47, unique) }`, `additionalProperties: false`.

**Relationship to `i18n` (normative — resolves the open question, since `Active` locks the shape):**

- The `content` block **MUST NOT** redeclare locale negotiation. It declares only *which content has been authored*; the *how* (header parsing, q-values, fallback ordering, `Content-Language`) is `i18n.md`'s, reused verbatim.
- A host advertising `content.supported: true` **MUST** also advertise `i18n.supported: true`. Content delivery rides the annex's `Accept-Language` handling; advertising content without the annex is incoherent and **MUST NOT** validate as conformant.
- `content.baseLocale` **MUST** equal `capabilities.i18n.defaultLocale` (the host has one default locale; section `data` is authored in it).
- The **resolvable** locale set for content is `content.baseLocale ∪ content.supportedLocales`. Every member of that set **MUST** be an element of `capabilities.i18n.supportedLocales` (i.e. `({baseLocale} ∪ content.supportedLocales) ⊆ i18n.supportedLocales`). Content can be authored for *fewer* locales than the host can negotiate human-facing text for, never more — the host cannot honestly serve content in a locale it can't even negotiate.
- `content.supportedLocales` **MUST NOT** contain `content.baseLocale` (the base locale is carried by `data`, not by a `localizations` entry — same "base ∉ supported" invariant the language-settings object enforces, §C).

```diff
   "i18n": { "...": "unchanged" },
+  "content": {
+    "type": "object",
+    "description": "RFC 0103. Localized authored content (pages → sections) per spec/v1/localized-content.md. Requires i18n.supported:true; ({baseLocale} ∪ supportedLocales) MUST be ⊆ i18n.supportedLocales; baseLocale MUST equal i18n.defaultLocale. Hosts that omit this block serve no content surface; the conformance scenarios skip cleanly.",
+    "additionalProperties": false,
+    "required": ["supported", "baseLocale", "supportedLocales"],
+    "properties": {
+      "supported": { "type": "boolean" },
+      "baseLocale": { "type": "string", "pattern": "^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$" },
+      "supportedLocales": {
+        "type": "array", "uniqueItems": true,
+        "items": { "type": "string", "pattern": "^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$" }
+      }
+    }
+  }
```

### §B — The content data model (NEW schemas)

The core decision, carried from the source CMS and now made normative: **content is one section record with a base `data` payload plus a sparse `localizations` map — never one record per locale.**

**Section** (`localized-content-section.schema.json`):

```jsonc
{
  "sectionId": "hero",
  "sectionType": "hero",
  "data":   { "heading": "Welcome", "cta": "Get started" },   // authored in baseLocale
  "localizations": {                                            // sparse, partial overrides
    "es":    { "heading": "Bienvenido", "cta": "Empezar" },
    "pt-BR": { "heading": "Bem-vindo" }                         // partial: cta falls back to data
  },
  "status": "published",
  "enabled": true,
  "order": 0
}
```

- `data` (object, REQUIRED): the base/default-locale fields. Section body shapes are open (`data` is `type: object`, `additionalProperties: true`) — the envelope is closed, the per-`sectionType` body is the host's/section-type's concern (see §"Unresolved questions" Q5).
- `localizations` (object, REQUIRED, MAY be empty `{}`): `patternProperties` keyed by `^[a-z]{2}(-[A-Z]{2})?$` → object of partial field overrides. A key **MUST** match that pattern (a pragmatic BCP-47 subset; see Q3). A `localizations` key **MUST NOT** equal `baseLocale`.
- `status` (enum `draft|published`, REQUIRED), `enabled` (boolean, REQUIRED), `order` (integer, REQUIRED).

**Page** (`localized-content-page.schema.json`):

```jsonc
{
  "pageId": "home", "slug": "home", "name": "Home",
  "status": "published",
  "sectionOrder": ["hero", "features", "footer"],
  "seo": { "hreflang": [ { "locale": "es", "href": "https://…/es/home" } ], "ogLocaleAlternates": ["es", "pt-BR"] }
}
```

- `slug` (string, REQUIRED, pattern `^[a-z][a-z0-9-]*$`), `name` (string, REQUIRED), `status` (enum `draft|published`, REQUIRED), `sectionOrder` (array of section ids — render order), `seo` (object: `hreflang` alternates + `og:locale` alternates).

**Language settings** (`localized-content-language-settings.schema.json`): `{ baseLocale, supportedLocales[], autoTranslateOnPublish }`. **Invariant (MUST):** `baseLocale ∉ supportedLocales`. This object is the per-tenant authoring configuration; it MUST stay consistent with the advertised `content` block (`baseLocale` equal; `supportedLocales` equal or a subset of what's advertised).

**Resolved delivery response** (`localized-content-page-response.schema.json`): `{ version, generatedAt, locale, slug, page, sections[] }` — `locale` is the negotiated locale (== `Content-Language`), `sections[]` are the **already-merged** section bodies (no `localizations` map in the response; resolution happened server-side).

### §C — Locale negotiation + the per-section field merge

**Negotiation — reused, not redefined.** Locale selection is `i18n.md` §"`Accept-Language` request header" + §"Fallback rules (normative)" *verbatim*: parse `Accept-Language` (a malformed header MUST NOT `400` — fall back to default), honor q-values, try the language family, fall back to `content.baseLocale` (== `i18n.defaultLocale`), and set `Content-Language` to the locale actually used. There is **no** `?locale=` parameter (the annex forbids overriding the header). The negotiated locale then drives the merge below.

**Per-section field merge (the one new normative algorithm).** After negotiation has chosen `negotiatedLocale`, each section resolves its fields:

```
resolveSection(section, negotiatedLocale, baseLocale):
  if negotiatedLocale == baseLocale or section.localizations is empty:
      return section.data
  if section.localizations[negotiatedLocale] exists:                       # exact-locale override
      return { ...section.data, ...section.localizations[negotiatedLocale] }
  if negotiatedLocale contains '-':                                        # language-family override
      lang = negotiatedLocale.split('-')[0]
      if section.localizations[lang] exists:
          return { ...section.data, ...section.localizations[lang] }
  return section.data                                                       # base fallback
```

- The merge is a **shallow** field overlay: locale fields override base fields key-by-key; missing locale fields fall through to `data` (so a partial translation is valid — see the `pt-BR` example in §B, where `cta` falls back to the base). Nested objects are replaced, not deep-merged (MUST — keeps resolution deterministic and cheap; deep merge deferred, Q6).
- This ordering (exact → family → base) is the section-level analogue of the annex's locale-level fallback. Both are normative so resolution is byte-identical across hosts. The same `resolveSection` is shared verbatim between the reference host and the conformance suite.

**Positive example.** `Accept-Language: pt-BR`, host `content.supportedLocales: ["es","pt-BR","fr"]`, the section from §B → negotiated `pt-BR` → `localizations["pt-BR"]` exists → `{ heading: "Bem-vindo", cta: "Get started" }` (heading overridden, cta falls through to base). `Content-Language: pt-BR`.

**Negative example (fails validation).** A section whose `localizations` contains the base locale —

```jsonc
{ "sectionId": "x", "data": { "h": "Hi" }, "localizations": { "en": { "h": "Hi" } }, "status": "draft", "enabled": true, "order": 0 }
```

— with host `baseLocale: "en"` **MUST** be rejected: the base locale is carried by `data`, never by a `localizations` entry. Likewise a `localizations` key `EN` or `en_US` (wrong case / underscore) **MUST** fail the `^[a-z]{2}(-[A-Z]{2})?$` pattern.

### §D — Delivery + admin endpoints (`api/openapi.yaml`, capability-gated)

**Public delivery (cacheable, published-only, locale via `Accept-Language`):**

```
GET /v1/content/pages/{slug}        Accept-Language: pt-BR  →  resolved page, Content-Language: pt-BR
GET /v1/content/sections/{sectionId}
```

- Negotiates locale per §C; sets `Content-Language` to the locale used; `Vary: Accept-Language, Accept-Encoding`; `Cache-Control: public, max-age=300, stale-while-revalidate=3600`.
- Serves `status: "published"` content **only**.

**Admin CRUD (auth + write scope, tenant-scoped; locale targeted in the request body for writes):**

```
GET    /v1/content/pages                      POST   /v1/content/pages
PATCH  /v1/content/pages/{pageId}             DELETE /v1/content/pages/{pageId}
POST   /v1/content/pages/{pageId}/sections
PUT    /v1/content/pages/{pageId}/sections/{sectionId}            { locale, data }   # upsert base (locale==baseLocale) or a localization
DELETE /v1/content/pages/{pageId}/sections/{sectionId}/locales/{locale}
GET    /v1/content/settings                   PUT    /v1/content/settings
```

Admin *writes* target a locale in the body (you author one translation at a time); only *public delivery* negotiates via the header. Write `locale` is validated `^[a-z]{2}(-[A-Z]{2})?$`; `locale == baseLocale` upserts `data`, otherwise it upserts `localizations[locale]`.

### §E — Publish granularity (resolved: atomic across locales for v1)

`status` is a property of the **section / page**, not of an individual locale. For v1 a section is published or draft **atomically across all its locales** — there is no per-locale publish state. Rationale: per-locale publish multiplies the visibility state space (a section could be published in `en`, draft in `es`) and complicates the published-cache security invariant (§F) without a demonstrated need. **Per-locale publish is a future additive enhancement** (a new optional field; carried as a named gap, not a v1 MUST).

### §F — Security invariants (normative prose — `Active` locks these now)

These are MUST-level and wire into the SECURITY-invariant coverage check:

- **Published cache MUST NOT include draft content.** The public, cacheable delivery path serves `status: "published"` sections only; a draft section (or a draft page) MUST NOT appear in any public response, and MUST NOT be written into any shared/public cache entry. A cache key MUST be scoped such that a draft can never be served from a cached published response.
- **Content responses MUST be tenant-scoped.** Every read and write is scoped by the authenticated principal's `tenantId`. A page/section belonging to another tenant MUST be unreachable.
- **No cross-tenant enumeration.** A request for a `slug`/`pageId`/`sectionId` that exists under a *different* tenant MUST return the same `404` as a wholly nonexistent id — the response MUST NOT distinguish "exists for another tenant" from "does not exist" (no existence oracle).
- **`Content-Language` is request-scoped, not logged.** Consistent with `i18n.md` §"Replay determinism": the negotiated content locale is a response-time concern and is not part of any run event log.

## Compatibility

**Additive.** Per `COMPATIBILITY.md`, this is a new optional capability block, four new schemas, a new spec doc, and a new endpoint surface — none of which alter an existing wire shape. Backward-compatibility clauses:

- The `content` capability block is optional; a host that omits it serves no content surface and is unaffected. Existing clients never see it.
- The new endpoints live under `/v1/content/*`, a previously unused path space; no existing route changes.
- The four new schemas are new files; no existing schema is modified except `capabilities.schema.json`, which gains an optional `content` property (additive — existing capability documents still validate).
- It layers on the `Stable` `i18n.md` annex and reuses its negotiation verbatim; the annex's normative text is unchanged.

This RFC lands in v1.x. No migration plan is required (nothing to migrate from).

**On landing at `Active` with the comment window waived (maintainer decision).** Per `RFCS/README.md` §"Status states", `Active` = "accepted, implementation pending; wire shapes are locked unless the RFC explicitly says otherwise." Two consequences were accounted for in authoring:

1. Missing reference-host implementation and a not-yet-shipped full conformance suite are **not** blockers for `Active` — they gate the later `Accepted` flip (see Acceptance criteria). 
2. Because `Active` **locks the wire shapes**, the three shape-level open questions that would normally be resolved during the comment window are resolved **in this RFC** rather than left open: the `content`↔`i18n` capability relationship (§A), publish granularity (§E), and the security MUST-NOTs (§F). The remaining open items (Q1–Q6) are deliberately **non-wire-shape** (AsyncAPI presence, conformance breadth, BCP-47 strictness, deep-merge) — each is itself additive and can be settled before the `Accepted` flip without re-locking anything.

## Conformance

- **Existing coverage.** `conformance/src/scenarios/i18n-negotiation.test.ts` already covers the negotiation half this surface reuses. The content surface does not re-test negotiation; it tests the content model + merge layered on top.
- **New scenarios** (capability-gated on `capabilities.content.supported`, soft-skip otherwise — matching the additive-surface precedent): `localized-content-delivery.test.ts` sketching —
  1. `Accept-Language` exact hit → merged locale fields, `Content-Language` matches.
  2. Language-family fallback (`pt-BR` → `pt` localization) → family override applied.
  3. Default fallback on unsupported/missing translation → base `data`, `Content-Language: baseLocale`.
  4. Partial translation → overridden fields localized, missing fields fall through to `data`.
  5. Malformed `Accept-Language` → succeeds with base locale (annex MUST).
  6. Published-only delivery: a draft section/page is never served on the public path.
  7. Tenant isolation + no cross-tenant enumeration (cross-tenant id → 404, indistinguishable from nonexistent).
  8. Language-settings invariant: `baseLocale ∈ supportedLocales` rejected.
  9. Capability coherence: `content.supported` without `i18n.supported`, or `content.supportedLocales ⊄ i18n.supportedLocales`, rejected.
- Fixtures in `conformance/fixtures/` + catalog entry in `fixtures.md`; suite version bumped per the minor rule; CHANGELOG entry. Per `RFCS/README.md`, shipping ≥1 new scenario in the same `@openwop/openwop-conformance` release is expected — this is sequenced for the `Accepted` flip, not `Active`.

## Alternatives considered

1. **Reuse `i18n.md` directly with no content model (do nothing).** Rejected: the annex is scoped to transient host-rendered text and has no concept of an authored, persisted, multi-section page. Hosts would each invent an incompatible content shape, defeating cross-host portability — the exact problem the spec exists to prevent.
2. **One record per locale (a `(sectionId, locale)` row per translation).** Rejected: it duplicates base fields across every locale, makes "edit the base, cascade to untranslated locales" impossible, and makes partial translations (the common case) awkward. The single-record `data` + sparse `localizations` model keeps base authoring single-sourced and partial translations first-class.
3. **A `?locale=` query parameter for delivery.** Rejected — and **forbidden** by `i18n.md` (Host MUST NOT override `Accept-Language`). Reusing the header is what keeps a content page and an interrupt prompt resolving to the same locale for the same client.
4. **Extend the `i18n` capability block with a `content` sub-object** instead of a sibling block. Rejected: it conflates "I negotiate human-facing text" with "I serve authored content" — a host can do the former without the latter. A sibling block with an explicit subset constraint (§A) keeps the two concerns separable while binding them correctly.

## Unresolved questions

These are deliberately **non-wire-shape** (they don't re-lock anything settled in §A/§E/§F); each is settleable before the `Accepted` flip.

1. **AsyncAPI surface.** Are there content-lifecycle events (e.g. `content.page.published`) or is this delivery-only? A new channel is itself additive, so this can be added later without disturbing the locked shapes. Lean delivery-only for v1.
2. **Conformance breadth.** Which of the nine sketched scenarios are MUST-for-`Accepted` vs nice-to-have? (At least the negotiation-reuse, published-only, and tenant-isolation scenarios are MUST.)
3. **Locale-key strictness.** `localizations` keys and write `locale` use the pragmatic subset `^[a-z]{2}(-[A-Z]{2})?$`, not full BCP-47 (which `Accept-Language`/`Content-Language` use per the annex). Confirm the subset is acceptable or widen to the annex's `^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$`. (Widening is additive.)
4. **Settings vs capability source of truth.** The per-tenant language-settings object (§B) and the advertised `content` block can drift (settings is editable, the advertisement is host config). Define which is authoritative and how they reconcile.
5. **Section body openness.** `data`/`localizations` values are open objects; conformance can validate the *envelope* but not arbitrary `sectionType` bodies. Confirm the spec defines the envelope strictly and leaves body shapes to the host/section-type.
6. **Deep vs shallow merge.** The merge is shallow by MUST (§C). Confirm no v1 section-type needs nested-object locale overrides; if one does, deep merge is a future additive opt-in.

## Implementation notes (non-normative)

- The reference host (openwop-app) does **not** implement the `i18n.md` annex today (no `Accept-Language` parsing, no `capabilities.i18n` advertisement, no `Content-Language`). Since the content surface *reuses* the annex, the host must stand up annex-level negotiation **first** (parse `Accept-Language`, advertise `capabilities.i18n`, emit `Content-Language`, pass `i18n-negotiation.test.ts`) before the content surface can ride it. This is a hard sequencing dependency, tracked as a separate host task (openwop-app HOST-1), not a spec dependency.
- `negotiateLocale()` (annex) + `resolveSection()` (§C) should live in one module shared verbatim between the reference host and the conformance suite, so the normative algorithm has a single source.
- SQL storage has no field-merge primitive: locale writes are read-modify-write of the `localizations` JSON (last-write-wins under concurrent editing — acceptable for single-editor admin; concurrency is out of scope v1).

## Acceptance criteria

Checklist the maintainers used to flip `Status` from `Active` to `Accepted`:

- [x] `spec/v1/localized-content.md` merged (data model, per-section merge, delivery + admin endpoints, capability advertisement, security invariants, G11 carve-out, Status legend).
- [x] The four schemas + the `content` capability block merged; schema discipline (`ajv`/`redocly`) green.
- [x] `api/openapi.yaml` paths added (public delivery + admin CRUD), `Vary`/`Cache-Control`/`Content-Language` documented; `redocly` green.
- [x] ≥1 conformance scenario covering the new surface, capability-gated (`localized-content-delivery.test.ts`), in `@openwop/openwop-conformance` 1.27.0; suite version bumped (349 → 350).
- [x] CHANGELOG `[Unreleased]` entry; INTEROP-MATRIX row reflects the reference host's **actual** pass (emit/advertise honesty).
- [x] Reference host implements and passes the new scenarios: openwop-app (HOST-1 annex + HOST-2 content surface) + MyndHyve (Layer 1 + Layer 2) — two independent non-steward witnesses.
- [x] Register sweep: every open row in `registers/0103-localized-content-surface.{gaps,risks}.md` closed or carried forward (G4/G5/G6/G8 → tracked future-additive; G11 resolved in §F; see registers).

## References

- `spec/v1/i18n.md` — the `Stable` annex this surface reuses (negotiation, fallback, `capabilities.i18n`).
- `RFCS/0000-template.md`, `RFCS/README.md` §"Status states" / §"Companion gap & risk registers", `COMPATIBILITY.md`, `GOVERNANCE.md`.
- `schemas/capabilities.schema.json` — where the `content` block lands beside `i18n`.
- `openwop-app/CMS-I18N-PLAN.md` — the reference-host implementation plan + the source-CMS port map (non-normative).
- [RFC 9110 §12.5.4](https://www.rfc-editor.org/rfc/rfc9110#section-12.5.4) (`Accept-Language`), [BCP 47](https://www.rfc-editor.org/rfc/rfc5646) (language tags).
- Related: RFC 0098 (portability — a localized-content export is a future bundle slot), RFC 0102 (a2ui — also an additive, capability-gated content-shaped surface).
