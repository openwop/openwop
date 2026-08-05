# OpenWOP Spec v1 — Form-Content Packs

> **Status: Draft · v1.0 (2026-08-05).** [RFC 0137 — Form-content packs](../../RFCS/0137-form-content-packs.md). Specifies a declarative pack kind that distributes **form templates** — a named, versioned set of typed input fields a host instantiates into an ordinary, editable form. Depends on [`chat-card-packs.md`](./chat-card-packs.md) §"Input fields" (RFC 0071 Phase 2) for the portable field-type subset, which this kind **reuses rather than redefines**. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Status legend per `auth.md`.

---

## Why this exists

Hosts that let a user build something — a survey, an intake form, an RSVP, a request — almost always ship a set of starter forms. Today those starters live in host-private code: a `FormTemplateDefinition` table, a hard-coded array, a seeder. A starter form authored for one host cannot be installed on another, cannot be versioned independently of the host's release train, and cannot be contributed by anyone without commit access to the host.

openwop already carries every piece needed to distribute one. `registry-operations.md` defines publication, signing, and integrity; RFC 0107 made the published version manifest kind-aware so declarative kinds can be served at all; and `chat-card-packs.md` §"Input fields" already settled what a **portable typed input field** is. What is missing is the distribution unit: a pack that carries form templates and nothing else.

A **form-content pack** is that unit. A template is, precisely: `(a label + title + an ordered list of typed fields) → the host's normal form-create path`. It composes existing primitives — the registry contract and the RFC 0071 portable field subset — rather than introducing new machinery.

This doc stops at the wire contract. It does **not** specify form *layout*, *widgets*, *theming*, conditional field visibility, or the submission surface — those are host-product concerns per `positioning.md`. It specifies the template identity, the field contract, and the trust boundary.

A form-content pack is also distinct from **`x-openwop-form`** ([`node-packs.md`](./node-packs.md) §"`x-openwop-form` UX hints", RFC 0066). That is a consumer-side *rendering hint* — a vendor-extension annotation a node-pack author places on `configSchema` properties so a host can render a nicer **config** form for an existing node. It annotates a schema the pack already ships; it is not a distribution unit, carries no template identity or version, and is never published as a pack of its own. A form-content pack distributes standalone form *content*. The two compose without overlapping: a host MAY use `x-openwop-form` hints when rendering node config and form-content templates when seeding user-authored forms.

A form-content pack is distinct from a **chat-card pack** ([`chat-card-packs.md`](./chat-card-packs.md)): a card binds typed inputs to a *prompt template* and produces a typed artifact via `ctx.aiEnvelope.generate`. A form-content template binds typed inputs to **nothing** — it is inert, and the host does with the resulting form whatever it does with a form its own user typed. Cards are AI steps; form-content templates are form starters. They deliberately share one field vocabulary.

---

## Pack kind

Form-content packs are the sixth declarative pack `kind`, peer to `node`, `workflow-chain`, `prompt`, `artifact-type`, and `card`. A manifest with `kind: "form-content"` validates against [`form-content-pack-manifest.schema.json`](../../schemas/form-content-pack-manifest.schema.json), MUST declare a non-empty `templates[]`, and MUST NOT declare `nodes[]` / `chains[]` / `prompts[]` / `artifactTypes[]` / `cards[]`; mixing is rejected at registry `PUT` with `pack_kind_invalid`.

A form-content pack is **declarative**: it MUST NOT carry a `runtime` block, and a published version manifest that does is rejected (`registry-version-manifest.schema.json` §`allOf`; `registry-operations.md` §"Validation flow" #3). The registry's runtime-support check (#7) is skipped for this kind.

---

## Manifest format

```jsonc
{
  "name": "core.openwop.forms.starters",
  "version": "1.0.0",
  "kind": "form-content",
  "engines": { "openwop": ">=1.1.0 <2.0.0" },
  "templates": [
    {
      "templateId": "core.openwop.form.rsvp",
      "version": "1.0.0",
      "label": "RSVP",
      "title": "Will you be joining us?",
      "description": "Collect attendance and dietary needs.",
      "category": "events",
      "fields": [
        { "id": "guestName", "type": "text",   "label": "Your name", "required": true },
        { "id": "email",     "type": "text",   "label": "Email", "format": "email", "required": true },
        { "id": "partySize", "type": "number", "label": "How many in your party?" },
        { "id": "meal",      "type": "select", "label": "Meal", "options": ["standard", "vegetarian", "vegan"] },
        { "id": "notes",     "type": "longtext", "label": "Anything else we should know?" }
      ]
    }
  ]
}
```

`templates[].version` is **SemVer 2.0.0**, the same axis as the pack `version` — deliberately *not* the non-negative-integer schema-version axis used by `chat-card-pack-manifest.schema.json` `schemaVersion`. A template's shape is author-meaningful (removing a field breaks anything storing that template's submissions), so it carries the same contract as the pack that ships it.

---

## Field types — the RFC 0071 portable subset, reused

`fields[].type` is the **closed portable subset** already defined in [`chat-card-packs.md`](./chat-card-packs.md) §"Input fields — a closed portable subset": `text`, `longtext`, `number`, `boolean`, `select`, `multiselect`, `file`, `artifact-ref`. A host MAY extend it with a `vendor.<org>.<kind>`- or `x-<kind>`-prefixed value that other hosts MUST ignore (degrading to a plain text input).

This kind **MUST NOT** define its own field-type vocabulary. Two declarative pack kinds that both collect typed user input, rendered by the same host machinery, MUST agree on what a field type means; a second enum would fork the wire contract inside one protocol. The subset was resolved as RFC 0071 gap G9 (2026-05-27) against a real host's authoritative field-type catalog, and that resolution binds here unchanged.

The subset is **named by data kind, not widget** — a host renders `boolean` as whatever toggle or checkbox it likes, and `longtext` as whatever multi-line control it likes. Host catalogs map onto it:

| A typical host catalog | openwop `fields[].type` |
| ---------------------- | ----------------------- |
| `text`                 | `text`                  |
| `textarea`             | `longtext`              |
| `checkbox` / `toggle`  | `boolean`               |
| `select`               | `select`                |
| `email`                | `text` + `format: "email"` (see below) |

### Validation formats are not types

A field MAY carry an optional `format` constraining its value: spec-reserved `email`, `uri`, `date`, `date-time`, `time`, plus `x-<format>` host extensions. It follows the JSON Schema `format` idiom used throughout this corpus.

- `format` is only meaningful for `type: "text"` / `"longtext"`; a host MUST ignore it on any other type.
- A host that recognizes the format SHOULD apply it as an input-validation constraint.
- A host that does NOT recognize the format MUST ignore it and accept the value as plain text — the same degradation contract as an unrecognized `type`.

`email` is deliberately **not** a member of the `type` enum. It is a validation constraint on a text field, not a data kind. Admitting it as a type invites `url`, `tel`, `date`, and `zip` next, and the portable subset degenerates into the widget catalog that keeping it data-kind-named was meant to prevent.

---

## Instantiation (normative)

When a host advertises `host.forms.contentPacks: supported` and a registered template is instantiated:

1. The host MUST create the form through its **normal create path** — the same path that serves a form the host's own user authored by hand. A form-content pack MUST NOT cause the host to accept a form, field, or submission surface it would not otherwise accept.
2. The host MUST map each `fields[].type` to a control of the corresponding data kind, and MUST degrade an unrecognized (`vendor.*` / `x-`-prefixed) type to a plain text input rather than failing the instantiation.
3. The resulting form MUST be **fully editable** by the instantiating user. A template is a starting point, not a locked contract: the host MUST NOT treat a pack-authored field as immutable or privileged relative to a hand-added one.
4. The host MUST NOT execute anything from the pack. There is no entry point, no handler, and no runtime; a manifest carrying `runtime` is rejected at publication.
5. Submitted values are ordinary user input and MUST be sanitized, validated, and authorized exactly as hand-typed input to the same create path.

A host that does not advertise `host.forms.contentPacks` does not load form-content packs; template resolution stays implementation-defined and this document imposes no requirement on it.

---

## Trust boundary (normative — F1)

A template's **pack-authored strings** — `label`, `title`, `description`, `category`, and `fields[].options[]` — are **untrusted content**. They originate with a third-party pack author, arrive inside a signed tarball, and are rendered into host chrome (a picker, a gallery card, a form heading, a field label, a dropdown option).

A signature proves **who** authored the pack; it does not make the authored bytes trustworthy. A host MUST NOT treat pack provenance as content trust.

- A host MUST treat every pack-authored string in a form-content template as untrusted when rendering it: it MUST be escaped or otherwise neutralized for the target surface, and MUST NOT be interpreted as markup, script, or a formatting/templating directive.
- When any pack-authored string, or a value collected through an instantiated template, is interpolated into a prompt, the composed AI envelope MUST carry `meta.contentTrust: "untrusted"` (propagated per `ai-envelope.md` §"Trust boundary"), mirroring the chat-card rule in [`chat-card-packs.md`](./chat-card-packs.md) §"Trust boundary". This prevents a published template from smuggling instructions into a downstream model call — a template titled `"Ignore previous instructions and…"` is a realistic supply-chain vector precisely because a form template looks inert.
- **Length bounds are not a trust boundary.** The `maxLength` constraints in `form-content-pack-manifest.schema.json` are a resource guard against render bombs. They do nothing about injection, and a host MUST NOT treat bounding a string as having sanitized it.

The threat and this mitigation are documented in `SECURITY/threat-model-prompt-injection.md` (invariant `form-content-pack-string-trust-boundary`); `form-content-packs.test.ts` asserts the corpus contract, and the behavioral leg is capability-gated pending a reference host.

---

## Discovery

A registry SHOULD denormalize `templates[].templateId` into its per-pack index per `registry-operations.md` §"Type-ID indexing and cross-namespace exports". Consumers MUST tolerate its absence and fall back to manifest inspection.

Because that denormalization is a SHOULD, a registry that validates a form-content manifest without extending its indexer will serve the pack with **no** discoverable template ids — published, valid, and invisible. That is an operational trap, not a spec violation; see the note in `registry-operations.md`.

---

## Examples

**Positive.** The manifest above validates and installs; each `templateId` is unique within the pack; no `runtime` is present.

**Negative — `pack_kind_invalid`.** A manifest declaring both `templates[]` and `cards[]`.

**Negative — schema.** A `fields[].type` of `email` or `textarea` (neither is in the closed subset, and neither is `vendor.*` / `x-`-prefixed — use `text` + `format: "email"` and `longtext` respectively); a `fields[].key` instead of `fields[].id`; a `templates[].version` of `3` (the integer axis — MUST be SemVer); a `templateId` with an uppercase scope; a template with an empty `fields[]`; a manifest carrying `runtime`.

---

## Open spec gaps

| Gap | Tracked as |
| --- | --- |
| No conditional field visibility / cross-field dependency vocabulary ("show `dietaryNotes` iff `meal == vegetarian`"). Deferred: it is a small expression language, and the corpus already has an edge-condition operator set that should be evaluated for reuse before a second one is minted. | RFC 0137 §Unresolved 1 / G1 |
| No per-field validation beyond `required` + `format` (no `minLength`, `min`/`max`, `pattern`). | RFC 0137 §Unresolved 2 / G2 |
| No i18n: `label` / `title` / `description` are single-language strings. RFC 0103 defines a localized content surface that may be the right host for this. | RFC 0137 §Unresolved 3 / G3 |
| No reference-host implementation yet; the `host.forms.contentPacks` behavioral conformance legs are capability-gated and `host-pending`. | RFC 0137 §Acceptance criteria / R1 |
| The `format` reserved core set is small (5 values) and was chosen from the JSON Schema formats a form realistically needs; it may need widening on adopter evidence. | RFC 0137 §Unresolved 4 / G4 |

---

## References

- [RFC 0137 — Form-content packs](../../RFCS/0137-form-content-packs.md) — the rationale, alternatives, and compatibility analysis.
- [RFC 0107 — Publishable declarative pack kinds](../../RFCS/0107-publishable-declarative-pack-kinds.md) — the published-manifest contract this kind extends.
- [`chat-card-packs.md`](./chat-card-packs.md) §"Input fields — a closed portable subset" — the authoritative field-type vocabulary.
- [`registry-operations.md`](./registry-operations.md) §"Validation flow", §"Type-ID indexing and cross-namespace exports".
- [`host-capabilities.md`](./host-capabilities.md) §host.forms — the capability advertisement.
- [`ai-envelope.md`](./ai-envelope.md) §"Trust boundary" — `meta.contentTrust` propagation.
- [`positioning.md`](./positioning.md) — why layout, widgets, and theming are out of scope.
- [`form-content-pack-manifest.schema.json`](../../schemas/form-content-pack-manifest.schema.json), [`registry-version-manifest.schema.json`](../../schemas/registry-version-manifest.schema.json).
