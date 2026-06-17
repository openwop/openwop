# OpenWOP Spec v1 — Localized Content Surface

> **Status: Stable · v1.x (2026-06-17).** RFC 0103. A capability-gated surface for durable, authored, structured localized content (pages → sections), extending the Stable `i18n.md` annex. It **reuses** the annex's `Accept-Language`/`Content-Language` negotiation and fallback verbatim and adds only the content data model + a per-section field merge. Additive; layers on `i18n.md` (Stable v1.1). Keywords MUST, SHOULD, MAY, MUST NOT follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

`i18n.md` (Stable) localizes **transient, host-rendered human-facing text** — interrupt prompts, error envelopes, conversation prompts — by negotiating `Accept-Language` → `Content-Language` with a normative fallback. It is explicitly scoped *away* from structured content.

This document adds the complementary surface: **durable, authored, structured localized content**. The motivating need is a host serving authored pages (marketing, help, onboarding) in multiple locales — a CMS-shaped surface — where the page shape and its locale-resolution must be agreed so a page authored on host A resolves identically on host B. The same argument that put locale *negotiation* in the spec (so every host fills `Content-Language` the same way) applies to the *content data model* layered on top of it.

Two facts from the existing corpus shape the design:

1. **There is one locale mechanism, and there must not be a second.** `i18n.md` makes `Accept-Language` authoritative and forbids sniffing locale from the request body or overriding the header. A `?locale=` query parameter is therefore **forbidden** on this surface.
2. **Tenant is derived from the credential.** Per `auth.md` §"Identity claims", tenant is the top-level isolation boundary derived from the caller's credential (RFC 0048). This surface scopes all content to a tenant; how a tenant is resolved on an *anonymous* public request is host-defined (§F).

---

## Scope

**In scope:**

- A normative content data model: a page composed of sections, where a section is **one record** with a base `data` payload plus a sparse `localizations` map.
- A normative per-section field merge that resolves a section body for the negotiated locale.
- A public, cacheable delivery endpoint and a tenant-scoped admin CRUD surface.
- A `content` capability advertisement that reuses the `i18n` locale set.
- Security invariants for the public delivery path.

**Out of scope:**

- Locale **negotiation** — reused verbatim from `i18n.md` (this doc adds no second mechanism).
- Per-locale publication state (atomic across locales for v1; §E).
- Field-level concurrency on locale writes (last-write-wins; §G).
- Section **body** field shapes — open and host/section-type-defined; the protocol closes the envelope, not the body.

---

## §A — The `content` capability

A host that serves this surface advertises a `content` block in `/.well-known/openwop` (schema: `capabilities.schema.json` §`content`):

```json
{
  "capabilities": {
    "i18n": { "supported": true, "defaultLocale": "en", "supportedLocales": ["en", "es", "pt-BR", "fr"] },
    "content": { "supported": true, "baseLocale": "en", "supportedLocales": ["es", "pt-BR", "fr"] }
  }
}
```

**Normative constraints (MUST):**

1. A host advertising `content.supported: true` **MUST** also advertise `i18n.supported: true`. Content delivery rides the annex's `Accept-Language` handling; advertising content without the annex is incoherent and MUST NOT validate as conformant.
2. `content.baseLocale` **MUST** equal `capabilities.i18n.defaultLocale`.
3. The resolvable content locale set is `content.baseLocale ∪ content.supportedLocales`. Every member **MUST** be an element of `capabilities.i18n.supportedLocales` (content may be authored for fewer locales than the host negotiates human-facing text for, never more).
4. `content.supportedLocales` **MUST NOT** contain `content.baseLocale` (the base locale is carried by section `data`, not a `localizations` entry).
5. Hosts **SHOULD** advertise only locales that content delivery actually returns; advertising a locale no surface serves is dishonest per the INTEROP-MATRIX honesty rule.

A host that omits the `content` block serves no content surface and is unaffected; the conformance scenarios skip cleanly.

---

## §B — Content data model

The core decision: **content is one section record with a base `data` payload plus a sparse `localizations` map — never one record per locale.**

**Section** (`localized-content-section.schema.json`):

```json
{
  "sectionId": "hero",
  "sectionType": "hero",
  "data":   { "heading": "Welcome", "cta": "Get started" },
  "localizations": {
    "es":    { "heading": "Bienvenido", "cta": "Empezar" },
    "pt-BR": { "heading": "Bem-vindo" }
  },
  "status": "published",
  "enabled": true,
  "order": 0
}
```

- `data` (object, REQUIRED): base/default-locale fields, authored in `content.baseLocale`. Open object.
- `localizations` (object, REQUIRED, MAY be `{}`): keys MUST match `^[a-z]{2}(-[A-Z]{2})?$` and MUST NOT equal `baseLocale`; values are partial overlays of `data`.
- `status` (`draft|published`, REQUIRED), `enabled` (boolean, REQUIRED), `order` (integer, REQUIRED).

**Page** (`localized-content-page.schema.json`): `{ pageId, slug (^[a-z][a-z0-9-]*$), name, status (draft|published), sectionOrder[], seo? }`.

**Language settings** (`localized-content-language-settings.schema.json`): `{ baseLocale, supportedLocales[], autoTranslateOnPublish }`. **Invariant (MUST):** `baseLocale ∉ supportedLocales`. This object is the source of truth for the advertised `content` block; the advertisement MUST reflect it.

**Resolved delivery response** (`localized-content-page-response.schema.json`): `{ version, generatedAt, locale, slug, page, sections[] }` — `locale` is the negotiated locale (= `Content-Language`); `sections[]` carry the already-merged bodies (no `localizations` map appears in the response).

---

## §C — Locale negotiation + the per-section field merge

**Negotiation — reused, not redefined.** Locale selection is `i18n.md` §"`Accept-Language` request header" + §"Fallback rules (normative)" **verbatim**: parse `Accept-Language` (a malformed header MUST NOT `400` — fall back to default), honor q-values, try the language family, fall back to `content.baseLocale` (== `i18n.defaultLocale`), and set `Content-Language` to the locale actually used. There is **no** `?locale=` parameter. The negotiated locale then drives the merge.

**Per-section field merge (the one new normative algorithm).** After negotiation selects `negotiatedLocale`, each section resolves its body:

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

- The merge is a **shallow** field overlay (MUST): locale fields override base fields key-by-key; missing locale fields fall through to `data`; nested objects are replaced, not deep-merged.
- This ordering (exact → family → base) is the section-level analogue of the annex's locale-level fallback. Both are normative so a client sending `Accept-Language: pt-BR` resolves byte-identically on every host. Hosts **MUST** implement `resolveSection` identically; it is shared verbatim with the conformance suite.

**Positive example.** `Accept-Language: pt-BR`, the §B section → `localizations["pt-BR"]` exists → `{ heading: "Bem-vindo", cta: "Get started" }` (heading overridden, cta falls through to base). `Content-Language: pt-BR`.

**Negative example (fails validation).** A section whose `localizations` contains the base locale (`{ "en": {...} }` with `baseLocale: "en"`) MUST be rejected; a key `EN` or `en_US` (wrong case / underscore) MUST fail the `^[a-z]{2}(-[A-Z]{2})?$` pattern.

---

## §D — Delivery + admin endpoints

**Public delivery (cacheable, published-only, locale via `Accept-Language`):**

```
GET /v1/content/pages/{slug}        Accept-Language: pt-BR  →  resolved page, Content-Language: pt-BR
GET /v1/content/sections/{sectionId}
```

- Negotiates locale per §C; sets `Content-Language` to the locale used.
- Sets `Vary: Accept-Language, Accept-Encoding` and `Cache-Control: public, max-age=300, stale-while-revalidate=3600`.
- Serves `status: "published"` content **only**. Response validates against `localized-content-page-response.schema.json`.

**Admin CRUD (auth + write scope, tenant-scoped; locale targeted in the request body for writes):**

```
GET    /v1/content/pages                      POST   /v1/content/pages
PATCH  /v1/content/pages/{pageId}             DELETE /v1/content/pages/{pageId}
POST   /v1/content/pages/{pageId}/sections
PUT    /v1/content/pages/{pageId}/sections/{sectionId}            { locale, data }
DELETE /v1/content/pages/{pageId}/sections/{sectionId}/locales/{locale}
GET    /v1/content/settings                   PUT    /v1/content/settings
```

Admin *writes* target a locale in the body (`{ locale, data }`): `locale == baseLocale` upserts `data`, otherwise it upserts `localizations[locale]`. Write `locale` is validated `^[a-z]{2}(-[A-Z]{2})?$`. Only *public delivery* negotiates via the header.

---

## §E — Publish granularity (atomic across locales)

`status` is a property of the **section / page**, not of an individual locale. For v1 a section is published or draft **atomically across all its locales**; there is no per-locale publish state. Per-locale publish is a future additive enhancement (a new optional field). Rationale: per-locale publish multiplies the visibility state space and complicates the published-cache invariant (§F) without a demonstrated need.

---

## §F — Security invariants (normative)

These are MUST-level and verified by the SECURITY-invariant gate (`content-published-cache-no-draft`, `content-response-tenant-scoped`, `content-no-cross-tenant-enumeration`):

- **Published cache MUST NOT include draft content.** The public, cacheable delivery path serves `status: "published"` sections only; a draft section (or draft page) MUST NOT appear in any public response, and MUST NOT be written into any shared/public cache entry. A cache key MUST be scoped such that a draft can never be served from a cached published response.
- **Content responses MUST be tenant-scoped.** Every read and write is scoped by the resolved tenant. A page/section belonging to another tenant MUST be unreachable.
- **No cross-tenant enumeration.** A request for a `slug`/`pageId`/`sectionId` that exists under a *different* tenant MUST return the same `404` as a wholly nonexistent id — the response MUST NOT distinguish "exists for another tenant" from "does not exist".
- **`Content-Language` is request-scoped, not logged.** Consistent with `i18n.md` §"Replay determinism", the negotiated content locale is a response-time concern and is not part of any run event log.

**Tenant resolution on the public delivery path is host-defined** (RFC 0103 register G11). When the request is authenticated, the tenant is the credential-derived RFC 0048 identity triple's `tenant`. When the request is anonymous, the host resolves the tenant by a host-defined mapping (e.g. domain / `Host` header). The protocol does **not** prescribe a single anonymous-resolution mechanism — doing so would invent a URL→tenant coupling the rest of the corpus avoids. **The cross-host content-portability guarantee is scoped to a resolved `(tenant, locale)` pair**: given the same resolved tenant and negotiated locale, `resolveSection` is byte-identical across hosts. It does NOT extend to how an anonymous request selects its tenant — mirroring how `i18n.md` leaves the host's *default locale* host-defined. The §F tenant-scoping and no-enumeration invariants hold relative to the host-resolved tenant.

---

## §G — Compatibility + replay

**Additive** per `COMPATIBILITY.md`: a new optional capability block, four new schemas, a new `/v1/content/*` path space — none of which alter an existing wire shape. Hosts that omit `content` are unaffected. No event-log shape changes; this surface emits no run events in v1 (any future content-lifecycle events — e.g. `content.page.published` — would be additive AsyncAPI channels). Locale writes are read-modify-write of the `localizations` JSON (last-write-wins under concurrent editing; field-level concurrency is out of scope v1).

---

## Conformance

Hosts that advertise `capabilities.content.supported: true` are expected to pass the capability-gated scenario `conformance/src/scenarios/localized-content-delivery.test.ts`. The scenario verifies (server-free legs always-on; behavioral legs gated on a live host):

- The four schemas validate the §B shapes; the negative cases (base locale in `localizations`, bad key case) are rejected.
- `resolveSection` exact-hit / language-family / default-fallback / partial-translation cases (the §C reference algorithm).
- §A capability coherence: `content` requires `i18n`; `baseLocale == i18n.defaultLocale`; `({baseLocale} ∪ supportedLocales) ⊆ i18n.supportedLocales`; `baseLocale ∉ supportedLocales`.
- Behavioral (live host): malformed `Accept-Language` succeeds with base locale; `Content-Language` reflects the locale used; published-only delivery; tenant isolation + no cross-tenant enumeration.

Hosts that don't advertise the capability skip-equivalent.

---

## See also

- `i18n.md` — the Stable annex this surface reuses (negotiation, fallback, `capabilities.i18n`).
- `capabilities.md` — the `content` capability block lives beside `i18n`.
- `auth.md` §"Identity claims" — tenant/workspace/principal identity triple (tenant resolution).
- `rest-endpoints.md` — error envelope shape for the admin surface.
- `RFCS/0103-localized-content-surface.md` — the RFC + `registers/0103-*.{gaps,risks}.md`.
- [RFC 9110 §12.5.4](https://www.rfc-editor.org/rfc/rfc9110#section-12.5.4) (`Accept-Language`), [BCP 47](https://www.rfc-editor.org/rfc/rfc5646) (language tags).
