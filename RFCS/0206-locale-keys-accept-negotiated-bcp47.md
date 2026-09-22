# RFC 0206: locale keys accept the BCP 47 tags the host negotiates

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0206                                                            |
| **Title**         | Localized-content locale keys use a case-canonical BCP 47 subset (language, optional script, optional region) instead of `ll(-RR)`, so a host can author content for every tag its `i18n` annex negotiates |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply. The RFC changes no identity, authorization, isolation, idempotency, replay, external-effect or certification rule. It widens one string grammar, adds one fallback step that only a newly legal key can reach, and adds two canonical-case SHOULDs.) · **Updated 2026-09-22 — amended per implementation review** (`review/arch-impl.md` R3, R4, R7; Status unchanged: the six `(corpus)` ids, including `script-family-fallback` and `old-sections-unchanged`, which test the suite's shared `resolveSection` reference algorithm, are minted by a coherence test in `conformance/src/coherence/`; `delivery-extended-locale` is minted by the major-2 scenario, whose gated leg records `inapplicable` with its reason on a v2 cut; the major-1 legs are non-gating; the v2 twins are re-seeded only after `derive-v2-schemas.mjs` stops clobbering hand edits, or for the three files alone; the scenarios ride the open 2.36.0 suite (decisions log D3)) |
| **Affects**       | `spec/v1/localized-content.md` §A, §B, §C, §D · `spec/v1/i18n.md` §"Accept-Language request header" rule 4 and §"Capability advertisement" · `schemas/localized-content-{section,language-settings,page}.schema.json` and their `schemas/v2/` twins (re-seeded) · `api/openapi.yaml` (the `upsertContentSection` body `locale`) and `api/v2/openapi.yaml` (derived) · the eight `spec-artifacts/` mirrors (regenerated) · `RFCS/registers/0103-localized-content-surface.gaps.md` G5 → `spec/v1/gaps.json` (generated) · `conformance/src/scenarios/localized-content-delivery.test.ts` + one new major-2 scenario |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §4, row "Looser validation accepting input that previously failed". The new grammar is a strict superset of the old one, and the new fallback step is reachable only through keys that were invalid before. |
| **Supersedes**    | RFC 0103 Q3 and its register row G5. Amends those two only; RFC 0103 otherwise stands. |
| **Superseded by** | —                                                               |

## Summary

`localized-content.md` requires every `localizations` key, every admin-write `locale`, and every language-settings locale to match `^[a-z]{2}(-[A-Z]{2})?$`. The `i18n` annex that content delivery rides on uses full BCP 47 and lists `zh-Hans`, `zh-Hant` and `es-419` among its common tags. As a result, a host that negotiates `es-419` for human-facing text cannot author content for it.

This RFC widens those keys to a **case-canonical** BCP 47 subset: a 2–3 letter language, an optional titlecase script, and an optional uppercase or 3-digit region. `EN`, `en_US` and `en-us` still fail, so the two negative examples that RFC 0103 fixed still hold.

The per-section merge gains one step, so `zh-Hant-TW` falls back to `zh-Hant` before `zh`. The step can only fire on a key the old grammar rejected, so every section that was valid before resolves exactly as it did.

## Motivation

**The two halves of one surface disagree.**

| Surface | Pattern | Accepts `es-419`? |
| --- | --- | --- |
| `capabilities.i18n.{defaultLocale,supportedLocales}` (`schemas/capabilities.schema.json:3981,3990`) | `^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$` | yes |
| `capabilities.content.{baseLocale,supportedLocales}` (`:4013,4021`) | same | yes |
| `localizations` keys, write `locale`, settings (`localized-content.md:85,148`; three schemas; `api/openapi.yaml:738`) | `^[a-z]{2}(-[A-Z]{2})?$` | **no** |

- `i18n.md:54` lists `zh-Hans`, `zh-Hant` and `es-419` as common tags.
- `i18n.md:140`'s own advertisement example is `["en", "en-US", "ja", "ja-JP", "es-419", "fr-FR"]`.
- `localized-content.md` §A constraint 3 lets content be authored for any subset of those locales.

So a host can conformantly advertise `content.supportedLocales: ["es-419"]` while every schema that stores or writes that content rejects the key. The same holds for three-letter languages (`fil`, `yue`) and for any script subtag.

**Nothing in the corpus says the subset was needed.** RFC 0103 Q3 asked the question, and register G5 closed it on the "pragmatic subset", noting that "widening to full BCP-47 stays additive". Slice F of the 2026-09-22 MCP/A2A review found the conflict (F-12), and `review/verify-EF.md` confirmed it across eight wire files.

**Why not just reuse the capabilities pattern.** It is case-insensitive, so it accepts `EN` and `pt-br`. `localized-content.md:120` says a key `EN` or `en_US` "MUST fail", and `localized-content-delivery.test.ts:121-123` asserts both rejections. Adopting that pattern would relax a MUST, which `COMPATIBILITY.md` §2.2 forbids. It would also let `pt-BR` and `pt-br` coexist as two distinct keys of one map for one language. RFC 5646 §2.1.1 says these "MUST NOT be taken to carry meaning", so a key map that holds both is ambiguous.

This is a normative change to an explicit, deliberately decided MUST. It is not a Class-3 correction: the old text was neither ambiguous nor impossible to satisfy (Phase 2 architect ruling, Q1). Hence this RFC.

## Proposal

### §A The locale-key grammar

1. Wherever `localized-content.md` constrains a locale today, the value MUST match

   ```text
   ^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$
   ```

   The constrained locales are:
   - `localizations` keys (§B, `localized-content-section.schema.json` `propertyNames`);
   - the admin-write `locale` (§D, `api/openapi.yaml` `upsertContentSection`);
   - `baseLocale` and `supportedLocales[]` in the language-settings object (`localized-content-language-settings.schema.json`);
   - the two locale-bearing fields of `localized-content-page.schema.json`: `seo.hreflang[].locale` (`:48`) and `seo.ogLocaleAlternates[]` (`:56`).

2. The grammar is the `langtag` production of RFC 5646 §2.1, restricted to `language` (2–3 letters, without `extlang`), an optional `script`, and an optional `region` (`2ALPHA` or `3DIGIT`). Each subtag has one fixed case:
   - language lowercase;
   - script titlecase;
   - region uppercase.

   That is the case RFC 5646 §2.1.1 recommends ("the format of subtags in the registry is RECOMMENDED"). It is also the case CLDR's canonical syntax requires (UTS #35, §"Canonical Unicode Locale Identifiers", CLDR 48.2): "Any script subtag … is in title case", "Any region subtag … is in uppercase", "All other subtags are in lowercase".

   Variants, extensions, private use, `extlang` and grandfathered tags remain out of scope (register G2).

3. The new grammar is a strict superset of the old one: every string matching `^[a-z]{2}(-[A-Z]{2})?$` matches it. Adopting it does not invalidate any section, page, settings object or write that was valid before.

**Positive examples** (each fails the old grammar except where noted):

- `en` and `pt-BR` (both old-valid)
- `zh-Hans`, `zh-Hant-TW`, `sr-Latn-RS`
- `es-419`
- `fil`, `yue`

**Negative examples** (each MUST fail):

- `EN` and `en_US` (both unchanged from RFC 0103)
- `en-us` and `zh-hans` (non-canonical case)
- `de-CH-1996` (variant) and `en-US-x-foo` (private use)
- `zh-yue` (`extlang`)

### §B The merge reaches the script before the language

4. `resolveSection` (`localized-content.md` §C) gains one step between the exact-locale override and the language-family override. Hosts MUST implement the amended algorithm identically. It stays shared verbatim with the conformance suite.

   ```text
   resolveSection(section, negotiatedLocale, baseLocale):
     if negotiatedLocale == baseLocale or section.localizations is empty:
         return section.data
     if section.localizations[negotiatedLocale] exists:                       # exact-locale override
         return { ...section.data, ...section.localizations[negotiatedLocale] }
     parts = negotiatedLocale.split('-')
     if len(parts) >= 3 and parts[1] is four ASCII letters:                   # script-family override (RFC 0206)
         ls = parts[0] + '-' + parts[1]
         if section.localizations[ls] exists:
             return { ...section.data, ...section.localizations[ls] }
     if len(parts) >= 2:                                                      # language-family override
         if section.localizations[parts[0]] exists:
             return { ...section.data, ...section.localizations[parts[0]] }
     return section.data                                                       # base fallback
   ```

   This is the truncation order of RFC 4647 §3.4 (Lookup), limited to the subtags §A admits. Without the new step, a reader negotiated to `zh-Hant-TW` on a section keyed `{ "zh-Hant", "zh" }` would receive `zh`, which may be written in a different script.

5. **The amended algorithm returns the same result as the old one on every section that was valid before this RFC.** The new step fires only when a key of the form `ll-Ssss` exists, and the old grammar admitted no such key. The other two branches are unchanged. The only rewrite is `negotiatedLocale contains '-'` becoming `len(parts) >= 2`, which is equivalent.

### §C Canonical case on the advertisement side

6. A host SHOULD advertise `i18n.defaultLocale`, `i18n.supportedLocales[]`, `content.baseLocale` and `content.supportedLocales[]` in the §A.2 canonical case, and SHOULD emit `Content-Language` in that case.

   The capabilities pattern is **not** tightened: rejecting `pt-br` there would break a record that validates today (§2.2). A content locale advertised in non-canonical case cannot be a `localizations` key. It therefore resolves only through the language-family or base branch, and §C says so rather than leaving it to be discovered.

7. Language-tag comparisons in negotiation are case-insensitive, as RFC 5646 §2.1.1 and RFC 4647 §2 already require. `i18n.md` rule 4 gains that sentence. It cites the upstream requirement and mints no new keyword.

8. §A constraint 3 of `localized-content.md` ("Every member MUST be an element of `capabilities.i18n.supportedLocales`") keeps its exact-membership meaning. Reading it case-insensitively would make a record that is non-conformant today conformant, which relaxes a MUST.

### §D Text changes

| File | Location | Change |
| --- | --- | --- |
| `spec/v1/localized-content.md` | `:85` | Replace the pattern with §A.1's; add "(case-canonical BCP 47 subset, RFC 0206 §A)". |
| same | `:100-110` §C | Replace the pseudocode with §B.4's. Add §B.5's identity sentence to the bullet that follows. |
| same | `:120` | Keep the sentence. Change "MUST fail the `^[a-z]{2}(-[A-Z]{2})?$` pattern" to "MUST fail the §B locale-key pattern", and add `en-us` as a third negative. |
| same | `:148` | Write `locale` is validated against the same pattern. |
| same | §A, after constraint 5 | Add §C.6 as a new constraint 6 (SHOULD), with its rationale sentence. |
| `spec/v1/i18n.md` | `:54` rule 4 | Append §C.7's sentence and "hosts SHOULD advertise and emit tags in the case RFC 5646 §2.1.1 recommends (`zh-Hant-TW`, `es-419`)". |
| `spec/v1/i18n.md` | `:148-149` | Add "(canonical case SHOULD, see rule 4)" to both facet bullets. |
| 3 v1 schemas | the pattern sites listed in the companion implementation plan (not committed with the RFC) | Swap the pattern; update each `description` that quotes it. |
| `api/openapi.yaml` | `:738` | Swap the pattern. Change the `:715` wording "(BCP-47-subset)" to "(case-canonical BCP 47 subset, RFC 0206)". |

`schemas/v2/` twins, `api/v2/openapi.yaml` and `spec-artifacts/**` are regenerated, never hand-edited. The three v2 schemas still carry `x-openwop-seeded-from: v1`, so re-seeding carries the change.

## Compatibility

**Additive**, under `COMPATIBILITY.md` §4, row "Looser validation accepting input that previously failed".

- **Validation.** §A.3 proves superset, so no document that validated before stops validating.
- **Behaviour.** §B.5 proves outcome identity on every previously valid section. The new step changes behaviour only on inputs that did not exist before.
- **Advertisement.** §C adds SHOULDs only. No MUST is relaxed (§C.8), and the capabilities pattern is untouched (§C.6).
- **Error codes.** No error code, status or event shape changes.
- **Strict consumers.** A consumer validating against the *old* schema rejects a new key such as `es-419`. That is the "additive for producers, breaking for strict consumers" hazard RFC 0171 G6 records. The mitigation is the corpus's usual one: the `$id`s carry no version segment (no `$id` bump, per the Phase 2 architect's Q1 ruling), and a consumer pins the `@openwop/spec-artifacts` version it validates against.
- **Scope in v1 and v2.** The same edit binds both majors. `spec/v1/localized-content.md` and `spec/v1/i18n.md` are the declared `normativeText` of the v2 `content` and `i18n` families (`spec/v2/declaration.json`), so no separate v2 prose is written.

## Conformance

- **Existing.** `localized-content-delivery.test.ts` (major 1) covers the capability block, the four schemas, the coherence predicate and `resolveSection`. Its negatives `EN` and `en_US` (`:121-123`) are kept unchanged.
- **Legs added there (major 1, supplementary and non-gating):**
  - positives `zh-Hans`, `zh-Hant-TW`, `es-419`, `fil`;
  - negatives `en-us`, `zh-hans`, `de-CH-1996`;
  - the §B.4 script-family leg;
  - the §B.5 identity leg.
- **New coherence test (planned): `conformance/src/coherence/locale-key-grammar.test.ts`.** It mints the six `(corpus)` ids: the grammar positives and negatives against the v1 and v2 schemas, the eight-site wire agreement over both OpenAPI documents, the superset enumeration, and the two `resolveSection` properties. `script-family-fallback` and `old-sections-unchanged` exercise the suite's own copy of the reference algorithm, which is a corpus property, not a host's behaviour. `evidence/corpus-ledger.json` is emitted only from `conformance/src/coherence/`, and a major-1 scenario is never reached by a v2 cut, so neither location in the first draft could satisfy `check-accepted-predicate` rule 4.
- **New major-2 scenario (planned): `v2-content-locale-keys.test.ts`.**
  - One gated behavioural leg, minting `openwop.requirement.0206.delivery-extended-locale`, on a host whose `content.supportedLocales` contains a tag outside the old subset. Otherwise it records `inapplicable` **with that reason** (no `content` family, or no extended tag advertised), so the row is accounted for on every v2 cut. No committed bundle carries such a tag today.
- **Suite.** The scenarios ride the open, unpublished 2.36.0 suite and `@openwop/spec-artifacts` 2.36.0, which the suite exact-pins (decisions log D3; rule 7 of `check-rfc-status-coherence.mjs` is met, since the RFC is `Active`). No PR in this batch bumps a version pin.
- **Floor.** No new requirement id enters a floor or a profile predicate.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 keys, write `locale` and settings match the case-canonical pattern (`openwop.requirement.0206.key-grammar`) | a section keyed `zh-Hans`, `zh-Hant-TW`, `es-419` or `fil` validates against `localized-content-section.schema.json`, v1 and v2 (planned coherence test `locale-key-grammar.test.ts`) | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by restoring `^[a-z]{2}(-[A-Z]{2})?$` in one schema and the positive legs fail |
| §A.1 non-canonical and out-of-subset tags fail (`openwop.requirement.0206.key-grammar-negatives`) | `EN`, `en_US`, `en-us`, `zh-hans`, `de-CH-1996` are rejected | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by substituting the case-insensitive capabilities pattern and `EN`/`en-us` pass, failing the leg |
| §A.1 the eight wire sites agree (`openwop.requirement.0206.wire-agreement`) | every locale-constraining `pattern` in the three v1 schemas, three v2 schemas and both OpenAPI documents is byte-identical to §A.1 | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by leaving `api/openapi.yaml:738` on the old pattern and the leg names it |
| §A.3 superset (`openwop.requirement.0206.superset`) | every string in an exhaustive enumeration of `[a-z]{2}` and `[a-z]{2}-[A-Z]{2}` matches the new pattern | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage with a pattern requiring 3-letter languages and the enumeration fails |
| §B.4 script-family fallback (`openwop.requirement.0206.script-family-fallback`) | `resolveSection(s{zh-Hant, zh}, 'zh-Hant-TW', 'en')` overlays `zh-Hant` | the suite, unaided (corpus): the shared reference algorithm, in the planned coherence test | witnessable — unaided (corpus): sabotage by deleting the new step and the result is the `zh` overlay |
| §B.5 old sections resolve unchanged (`openwop.requirement.0206.old-sections-unchanged`) | over every key set drawn from old-legal keys and a fixed corpus of negotiated tags (including `de-CH-1996`, `zh-Hant-TW`, `pt-BR`), the amended and RFC 0103 algorithms return equal results | the suite, unaided (corpus): the shared reference algorithm, in the planned coherence test | witnessable — unaided (corpus): sabotage by making the new step try every 2-subtag prefix and `de-CH-1996` against `{de-CH, de}` diverges |
| §A.1 on a live host: an extended locale is delivered (`openwop.requirement.0206.delivery-extended-locale`) | `GET /v1/content/pages/{slug}` (v2: `/content/pages/{slug}`) with `Accept-Language: es-419` answers `Content-Language: es-419` and the `es-419` overlay | the suite, on a host whose `content.supportedLocales` contains a tag outside the old subset (major 2: planned `v2-content-locale-keys`; the major-1 leg is non-gating) | witnessable — gated on that advertisement, and recorded `inapplicable` with its reason otherwise; no committed bundle carries one today (openwop-app and MyndHyve advertise `es`, `pt-BR`, `fr`) |

§C.6 and §C.7 are a SHOULD and a citation of an upstream MUST, so they carry no row.

## Alternatives considered

- **Adopt the capabilities pattern (`^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$`) for keys.** This is the obvious unification, and it is breaking. It accepts `EN`, which relaxes the `:120` MUST, and it lets case variants coexist as distinct map keys.
- **Full RFC 5646 `langtag` in canonical case** (variants, extensions, private use). More complete, but the merge algorithm would need RFC 4647 §3.4's singleton rule and variant truncation, and no host has asked for `de-CH-1996` content. It is left as register G2, and adding it later is also a superset.
- **Canonicalize on write:** accept any case and store the canonical form. This hides the input a client sent and still needs a grammar, so it is strictly more mechanism for the same set of storable keys.
- **Tighten the capabilities pattern to canonical case as well.** This is the consistent end state, and it rejects records that validate today (§2.2). §C.6's SHOULD is the additive half. The MUST half waits for a major (register G3).
- **Do nothing.** A host keeps being unable to author content for tags it negotiates, and `i18n.md`'s own example advertisement stays unservable by the content surface.

## Unresolved questions

1. `seo.ogLocaleAlternates[]` carries Open Graph `og:locale:alternate` values, whose conventional spelling is `language_TERRITORY` (underscore). The hyphenated pattern already rejected that spelling before this RFC, and this RFC keeps the rejection. Should a host map the value to underscore form on render, or should the field take its own grammar? This is out of scope here (register G6).
2. Should `resolveSection` also try `ll-RR` for a `ll-Ssss-RR` tag (for example `zh-TW` for `zh-Hant-TW`)? RFC 4647 §3.4 does not; this RFC follows it. Revisit if a host reports region-only keys it cannot migrate.
3. Should the `i18n` and `content` families be homed in `spec/v2/core/` now? This RFC writes no v2 core prose, so it is not required; the estimate is recorded as register G1.

## Implementation notes (non-normative)

- The seven files that carry the pattern are listed in the companion implementation plan (not committed with the RFC), with the regenerate order:
  1. v1 schemas and `api/openapi.yaml`;
  2. `derive-v2-schemas.mjs --write`;
  3. `derive-v2-api.py --write`;
  4. `generate-spec-artifacts.mjs --write`;
  5. `generate-gaps.mjs --write`.
- openwop-app and MyndHyve advertise `es`, `pt-BR` and `fr`. All three are valid under both grammars, so neither host changes to stay conformant. To witness the gated leg, one of them adds a content locale such as `es-419`.

## Acceptance criteria

- [x] `Active` (2026-09-22, comment window waived; see `Updated`).
- [x] Spec text merged (`localized-content.md` §A–§D, `i18n.md` rule 4). (implementation PR: `localized-content.md` §A constraint 6, §B, §C script-family step, §D write `locale`, §Conformance; `i18n.md` rule 4 and both facet bullets.)
- [x] The three v1 schemas and `api/openapi.yaml` carry §A.1. The v2 twins, `api/v2/openapi.yaml` and the eight `spec-artifacts/` mirrors are regenerated. `derive-v2-schemas`, `derive-v2-api --check` and `generate-spec-artifacts --check` pass. The v2 twins are re-seeded either after `derive-v2-schemas.mjs --write` is fixed so it no longer clobbers hand-edited v2 schemas (the RFC 0186 `onTimeout` edit; 33 files churn today), or by re-seeding only the three localized-content files; a full `--write` on today's generator is not admissible. (Evidence: `derive-v2-schemas.mjs --write` after the #1487 fix changed exactly the three localized-content twins; `--check` green; `derive-v2-api.py --check` and `generate-spec-artifacts --check` green; the `0206.wire-agreement` row asserts all twelve pattern sites.)
- [x] Register G5 of RFC 0103 is dispositioned `transferred:RFC 0206`, and `spec/v1/gaps.json` is regenerated. (`transferred:rfc-0206`; `spec/v1/gaps.json` `openwop.gap.0103.5` regenerated.)
- [x] Every `(corpus)` id in the falsifiability table records `executed-pass` in `evidence/corpus-ledger.json`, minted by the coherence test in `conformance/src/coherence/`. The corpus rows need no host. (`conformance/src/coherence/locale-key-grammar.test.ts`; all six ids `executed-pass` in `evidence/corpus-ledger.json`; each row's sabotage run once and turned it red.)
- [ ] `openwop.requirement.0206.delivery-extended-locale` records `executed-pass` on a committed bundle of a host advertising an extended content locale, or the RFC records why no host does and is accepted on the corpus rows alone (tier: corpus gate, the RFC 0189 precedent for rows witnessable unaided in the corpus).
- [x] CHANGELOG entry.

## References

- RFC 5646 §2.1 (ABNF), §2.1.1 (case: "MUST NOT be taken to carry meaning"; registry format RECOMMENDED); <https://www.rfc-editor.org/rfc/rfc5646>, fetched 2026-09-22.
- RFC 4647 §2 (case-insensitive matching) and §3.4 (Lookup, progressive truncation); <https://www.rfc-editor.org/rfc/rfc4647>, fetched 2026-09-22.
- Unicode UTS #35 (LDML), §"Canonical Unicode Locale Identifiers" (casing rules), CLDR 48.2; <https://www.unicode.org/reports/tr35/tr35.html>, fetched 2026-09-22.
- RFC 0103 (Q3; register G5); `spec/v1/localized-content.md`; `spec/v1/i18n.md`; RFC 0171 G6 (strict-consumer hazard).
- 2026-09-22 review: slice F finding F-12; `review/verify-EF.md` (locale row); `review/arch-P2.md` Q1 and CRITICAL-1.
