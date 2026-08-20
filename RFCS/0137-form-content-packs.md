# RFC 0137: Form-content packs — a publishable declarative pack kind for form templates

| Field | Value |
| --- | ---|
| **RFC** | 0137 |
| **Title** | Form-content packs — `kind: "form-content"` distributes form templates; field types reuse the RFC 0071 portable subset |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-08-05 |
| **Updated** | 2026-08-05 — **`Active → Accepted`.** Graduated on the openwop-app reference-host witness (PR openwop-app#2976, rev `7a5c90af1`): `form-content-instantiation.test.ts` **4/4 PASS non-vacuously** under `OPENWOP_REQUIRE_BEHAVIOR=true` against a booted host advertising `host.forms: { contentPacks: true }`, with the `POST /v1/host/sample/formcontent/instantiate` seam routing through the host's REAL loader and REAL `createForm` (a seam that reimplemented instantiation would witness itself). See [Amendment record](#amendment-record). |
| **Affects** | `spec/v1/form-content-packs.md` (NEW); `spec/v1/registry-operations.md` §"Validation flow" #3/#7 + §"Type-ID indexing"; `spec/v1/host-capabilities.md` §host.forms (NEW); `schemas/form-content-pack-manifest.schema.json` (NEW); `schemas/registry-version-manifest.schema.json`; `SECURITY/invariants.yaml`; `SECURITY/threat-model-prompt-injection.md`; `conformance/src/scenarios/form-content-packs.test.ts` (NEW); reference registry (`openwop-registry`) indexer |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Adds `form-content` as a publishable declarative pack kind: a pack carrying `templates[]`, where a template is a named, versioned, ordered set of typed input fields a host instantiates into an ordinary, fully editable form through its normal create path. The kind is inert — no `runtime`, no entry point, no handler, no submission surface the host would not otherwise accept. Its field-type vocabulary is **not new**: `fields[].type` reuses the closed portable subset already settled for chat-card packs (`chat-card-packs.md` §"Input fields", RFC 0071 gap G9), including that subset's `vendor.*` / `x-` extension escape hatch and its "unrecognized ⇒ degrade to plain text" contract. The change is additive to `registry-version-manifest.schema.json` (RFC 0107) and adds one host capability, one spec doc, one source manifest schema, and one SECURITY invariant.

## Motivation

A host that lets users build forms ships starter forms. Today those starters are host-private code — a table, a hard-coded array, a seeder. They cannot be installed across hosts, versioned independently of the host's release train, or contributed by anyone without commit access.

Everything needed to distribute one already exists: `registry-operations.md` defines publication/signing/integrity, RFC 0107 made the published version manifest kind-aware, and RFC 0071 already settled what a portable typed input field is. Only the distribution unit is missing.

**The problem is concrete and was hit in practice.** A host attempted to publish `core.openwop.forms.starters@1.0.0`: signed with an authorized key, SRI recomputed, Ed25519 verified over the in-tarball `pack.json`, all local registry gates green — and CI rejected it, because `registry-version-manifest.schema.json` declares a **closed** `kind` enum that does not contain `form-content`, has no `templates` property, and is `additionalProperties: false`. RFC 0107 is `Accepted` and defines exactly that closed set, so extending it is a spec change, not a registry-local one.

**The spec is the right place** for the same reason RFC 0107 gave: the version manifest is the registry-interop contract. Any conformant registry validates published manifests against this single schema and any consumer relies on its shape; a registry-local relaxation forks the contract and `check-vendored-sync` would correctly flag the drift.

**A second, sharper reason this belongs in the spec rather than in a host:** the field-type vocabulary. The host that hit this wall proposed keeping its field-type catalog (`text | email | textarea | select | checkbox`) **host-owned**, arguing that a wire-level enum would freeze a host-UI concern into the protocol. That argument was already heard and resolved in this corpus, in the opposite direction, for the closest possible precedent — see §Alternatives 3. Leaving the vocabulary host-owned would produce a pack that publishes but is not portable, which defeats the point of publishing it.

## Proposal

### Wire shape changes

**1. `schemas/registry-version-manifest.schema.json` (RFC 0107 amendment, additive).**

```diff
   "anyOf": [
     …
     { "properties": { "cards": { "type": "array", "minItems": 1 } }, "required": ["cards"] },
+    { "properties": { "templates": { "type": "array", "minItems": 1 } }, "required": ["templates"] }
   ],
   "allOf": [
     {
-      "if": { "properties": { "kind": { "enum": ["artifact-type", "connection", "workflow-chain", "prompt", "card"] } },
+      "if": { "properties": { "kind": { "enum": ["artifact-type", "connection", "workflow-chain", "prompt", "card", "form-content"] } },
               "required": ["kind"] },
       "then": { "not": { "required": ["runtime"] } },
       "else": { "required": ["runtime"] }
     }
   ],
   "properties": {
     "kind": {
-      "enum": ["node", "artifact-type", "connection", "workflow-chain", "prompt", "card"],
+      "enum": ["node", "artifact-type", "connection", "workflow-chain", "prompt", "card", "form-content"],
     },
+    "templates": {
+      "type": "array",
+      "description": "Present iff `kind == \"form-content\"` (RFC 0137). Carried loosely per the RFC 0107 G1 pattern; `form-content-pack-manifest.schema.json` is authoritative.",
+      "items": { "type": "object", "additionalProperties": true }
+    },
   }
```

> **The `anyOf` branch is load-bearing and easy to miss.** Extending the `kind` enum and declaring `templates` under `properties` is **necessary but not sufficient**: the schema also gates on an `anyOf` requiring one of the known payload arrays. Without a `templates` branch, every `form-content` manifest is rejected even when the other two edits are in place. This is believed to be the second face of the CI failure that motivated this RFC.

**2. `schemas/form-content-pack-manifest.schema.json` (NEW).** The authoritative source contract, modeled on `chat-card-pack-manifest.schema.json`. `kind` is `const: "form-content"`; `templates[]` has `minItems: 1`; every object sets `additionalProperties: false`.

```jsonc
// FormTemplate — required: templateId, version, label, title, fields
{ "templateId": "core.openwop.form.rsvp",   // reverse-DNS, same pattern + reserved scopes as a pack name
  "version": "1.0.0",                        // SemVer 2.0.0 — the PACK axis, not the integer schemaVersion axis
  "label": "RSVP", "title": "Will you be joining us?",
  "description": "…", "category": "events",  // both optional
  "fields": [ /* FormField, minItems 1 */ ] }

// FormField — required: id, type, label
{ "id": "email",            // `id`, NOT `key` — matches chat-card InputField.id
  "type": "text",           // the RFC 0071 portable subset, verbatim
  "format": "email",        // optional validation constraint (NOT a type)
  "label": "Email", "description": "…", "required": true,
  "default": …, "options": ["…"] }           // options for select / multiselect
```

**3. Field types (normative).** `fields[].type` MUST be a member of the closed portable subset defined in `chat-card-packs.md` §"Input fields — a closed portable subset" — `text`, `longtext`, `number`, `boolean`, `select`, `multiselect`, `file`, `artifact-ref` — or a `vendor.<org>.<kind>` / `x-<kind>` host extension. A host encountering an unrecognized type MUST ignore it and degrade to a plain text input; it MUST NOT fail the instantiation. This RFC **MUST NOT** introduce a second field-type vocabulary.

**4. Validation formats (normative).** A field MAY carry `format` — spec-reserved `email`, `uri`, `date`, `date-time`, `time`, plus `x-<format>` extensions. It is only meaningful for `type: "text"` / `"longtext"` and a host MUST ignore it on any other type. A host that recognizes the format SHOULD apply it as an input-validation constraint; a host that does not MUST ignore it and accept the value as plain text.

**5. Instantiation (normative).** Per `form-content-packs.md` §Instantiation: the host MUST use its normal form-create path; MUST map each type to a control of the corresponding data kind and degrade unknown types; MUST leave the resulting form fully editable; MUST NOT execute anything from the pack; and MUST sanitize/validate/authorize submitted values exactly as hand-typed input to the same path.

**6. Trust boundary (normative, F1).** Pack-authored `label` / `title` / `description` / `category` / `fields[].options[]` are **untrusted content**. A host MUST escape or neutralize them for the target surface and MUST NOT interpret them as markup, script, or a templating directive. When any of them — or a value collected through an instantiated template — is interpolated into a prompt, the composed envelope MUST carry `meta.contentTrust: "untrusted"` per `ai-envelope.md` §"Trust boundary". A signature proves *who* authored the pack, not that the bytes are safe; a host MUST NOT treat pack provenance as content trust. Length bounds are a resource guard and MUST NOT be treated as sanitization.

**7. Host capability.** `host.forms.contentPacks: supported` (`host-capabilities.md` §host.forms). Instantiation is host behavior, so it MUST be discoverable; a host that does not advertise it does not load form-content packs.

**8. Discovery.** `registry-operations.md` §"Type-ID indexing" SHOULD-list extended with `templates[].templateId` for `kind: "form-content"`. Kept a **SHOULD** — see §Alternatives 4.

### Examples

**Positive** — a published form-content version manifest validates (`kind` + `templates`, no `runtime`):

```json
{ "name": "core.openwop.forms.starters", "version": "1.0.0", "kind": "form-content",
  "engines": { "openwop": ">=1.1.0 <2.0.0" },
  "templates": [ { "templateId": "core.openwop.form.rsvp", "version": "1.0.0",
                   "label": "RSVP", "title": "Will you be joining us?",
                   "fields": [ { "id": "guestName", "type": "text", "label": "Your name" } ] } ],
  "integrity": "sha256-…" }
```

**Positive** — an unchanged node manifest still validates (no `kind`, `runtime` present): identical to today.

**Negative** — a `form-content` manifest carrying `runtime` fails (`then: { not: { required: ["runtime"] } }`). A `fields[].type` of `email` or `textarea` fails (neither is in the subset nor `vendor.*`/`x-`-prefixed — use `text` + `format: "email"`, and `longtext`). A `fields[].key` instead of `id` fails (`additionalProperties: false`). A `templates[].version` of `3` fails (SemVer pattern). A manifest declaring both `templates[]` and `cards[]` is rejected at registry `PUT` with `pack_kind_invalid`.

### Version axes impact

Per `version-negotiation.md`: **none**. This is a registry-contract schema change plus a host capability; no engine, per-run event-log, per-event, or runtime-pinning axis is touched. No run event is added or changed, so `POST /v1/runs/{runId}:fork` replays byte-identically.

## Compatibility

**Classification: `additive`** (`COMPATIBILITY.md` §2.1 — v1.x additive-only).

Per-clause backward-compatibility guarantees:

- **`kind` enum widening.** `kind` remains optional with documented default `"node"`. Every existing published manifest validates byte-identically: absent `kind` → the `else` branch → `runtime` required, exactly as today.
- **`templates` is a new optional property.** A node/artifact-type/connection/chain/prompt/card manifest omits it. `additionalProperties: false` is preserved because the key is now declared.
- **The new `anyOf` branch only *widens* what is accepted.** `anyOf` succeeds if any branch matches; adding a seventh branch cannot invalidate a manifest that already matched one of the six.
- **The `allOf` conditional adds `form-content` to the declarative side only.** No existing kind moves between the executable and declarative branches, and no manifest loses a requirement.
- **No event-type shapes, endpoint contracts, error codes, or HTTP statuses change.** §2.2's prohibited-change list is untouched: nothing goes required→optional, nothing is removed, nothing is type-changed, no MUST is relaxed.
- **New capability is off by default.** A host that does not advertise `host.forms.contentPacks` is unaffected and remains v1-compliant; the behavioral conformance legs skip cleanly.
- **Registries that do not implement this** validate node manifests identically and reject `form-content` manifests exactly as they do today — no regression, they simply cannot serve the new kind yet.

Forward-compat: a consumer that does not understand `kind: "form-content"` ignores the unfamiliar `templates` array; the RFC 0107 §Compatibility forward-guarantees carry over unchanged.

## Conformance

- **Existing coverage.** `conformance/src/scenarios/registry-declarative-kinds.test.ts` (RFC 0107) covers the kind discriminator + conditional-runtime contract for the six prior kinds; `registry-public.test.ts` resolves published manifests.
- **New scenario.** `conformance/src/scenarios/form-content-packs.test.ts` — always-on + server-free, three parts:
  - **PART 1 — contract present.** `form-content-packs.md` carries the instantiation + trust-boundary rules; `registry-operations.md` selects the per-kind source schema and skips the runtime check for `form-content`; the version manifest carries the kind, the `templates` property, the `anyOf` branch, and the conditional.
  - **PART 2 — schema admits the kind and still rejects malformed ones.** A published `form-content` manifest validates; one carrying `runtime` is rejected; a node manifest is unchanged. Explicitly asserts the `anyOf` branch by validating a manifest whose ONLY payload is `templates`.
  - **PART 3 — the field vocabulary is shared, not forked.** The `fields[].type` pattern in `form-content-pack-manifest.schema.json` is asserted **identical** to `InputField.type` in `chat-card-pack-manifest.schema.json`. This is the regression guard that matters: it fails the moment someone widens one kind's vocabulary without the other.
  - Negative legs: `email` / `textarea` as a `type`; `key` instead of `id`; integer `version`; empty `fields[]`.
- **Capability gating.** The corpus/schema legs are always-on (a registry-contract requirement, like RFC 0107's). Any behavioral leg (a host actually instantiating a template, and the F1 trust-boundary propagation) is gated on `host.forms.contentPacks` per `conformance/coverage.md` §"Capability-gated scenarios" and is `host-pending` until a reference host lands.
- **Suite version.** Minor bump `1.58.0 → 1.59.0` (new scenarios, no existing assertion changed).
- **SECURITY.** New protocol-tier invariant `form-content-pack-string-trust-boundary` in `SECURITY/invariants.yaml`, with `threat-model-prompt-injection.md` updated; the always-on schema/corpus leg is its public test, per the `chat-card-input-trust-boundary` precedent.
- **INTEROP-MATRIX.** No row change until a host advertises the capability.

## Alternatives considered

1. **Do nothing.** Form templates stay host-private; the pack that motivated this RFC stays unpublishable, and the sixth declarative kind is stranded at the publication boundary exactly as artifact-type and connection were before RFC 0107. Rejected for the same reason RFC 0107 rejected it.

2. **Revise RFC 0107 in place** rather than filing a new RFC. Rejected. RFC 0107 is `Accepted` with all five acceptance criteria met (PR #749 → `534a25be`). Its one in-place post-Accepted amendment — the 2026-06-23 `chat-card` → `card` correction — was justified as a *factual correction of a value no published manifest ever used*. A new pack kind is new normative surface, not a correction. The established pattern is that each kind gets its own RFC (0075 artifact-type, 0095 connection, 0013 workflow-chain, 0071 card) while 0107 owns the publication contract; this RFC follows it and carries the additive 0107 amendment.

3. **Keep the field-type catalog host-owned** (the original proposal from the host that hit the wall), on the argument that a wire-level enum freezes a host-UI concern into the protocol. **Rejected — the corpus already decided this, in the opposite direction, for the nearest neighbor.** `chat-card-packs.md` §"Input fields" puts `inputs[].type` on the wire as a closed enum with a `vendor.*` / `x-` escape hatch, and it got there by resolving tracked gap **G9** (2026-05-27) against a real host's authoritative `CardFieldType` — a resolution that pushed exactly three product-specific kinds (`color`, `canvas-reference`, `collection-reference`) behind `vendor.myndhyve.*` **on precisely the host-UI-concern argument**. So the argument was heard; the answer was "portable data kinds on the wire, product widgets behind the prefix," not "the whole catalog stays host-owned." The interop question settles it: a host receiving an unrecognized type MUST ignore it and degrade to a plain text input — and that degradation contract is only expressible *because* the enum is on the wire. Host-owned means no degradation contract, which means the pack is not portable, which defeats publishing it. A second, divergent enum for a second input-collecting declarative kind would be a wire-shape fork inside one protocol: strictly worse than either option originally offered.

4. **Promote the discovery denormalization to a MUST** so a pack cannot publish green-and-undiscoverable. Rejected. `registry-operations.md` makes it a SHOULD and requires consumers to tolerate absence; promoting it would retroactively invalidate registries that are conformant today, for what is a discovery convenience rather than a correctness property — a breaking change under §2.2 in exchange for very little. Instead the SHOULD list is extended and the trap is documented as a non-normative operator warning.

5. **Admit `email` as a field type** (as the motivating host's catalog does). Rejected. `email` is a validation constraint on a text value, not a data kind. Admitting it invites `url`, `tel`, `date`, `zip` next, and the portable subset degenerates into the widget catalog that naming it by data kind was meant to prevent. `text` + `format: "email"` gets the identical validation using the JSON Schema idiom already pervasive in this corpus, and keeps the type set stable.

6. **Reuse `x-openwop-form` (RFC 0066) instead of a new kind.** Rejected — it is a different surface. `x-openwop-form` is a consumer-side *rendering hint*: a vendor-extension annotation a node-pack author places on `configSchema` properties so a host renders a nicer **config** form for a node it already ships. It annotates an existing schema; it has no template identity, no version, no distribution unit, and is never published on its own. Nothing about it lets a starter form be authored, signed, published, installed, or discovered independently — which is the entire gap here. The two compose without overlapping.

7. **A separate published-manifest schema per kind.** Rejected for the reason RFC 0107 logged as its G2: it multiplies the validation surface, and the discovery index must dispatch on `kind` anyway. A single discriminated schema keeps one contract.

## Unresolved questions

1. **Conditional field visibility.** Should a template be able to express "show `dietaryNotes` iff `meal == vegetarian`"? It is a small expression language, and the corpus already has an edge-condition operator set (`workflow-definition.schema.json` §EdgeCondition, extended by RFC 0134 with `truthy`/`falsy`). Reusing it beats minting a second one, but it is not obviously the right shape for field-level predicates. Deferred rather than guessed. (G1)
2. **Per-field validation beyond `required` + `format`.** No `minLength` / `min` / `max` / `pattern` today. `pattern` in particular is a regex from an untrusted pack author, so it carries a ReDoS surface that would need the bounded-compilation treatment RFC 0071 gave artifact schemas (`artifact-schema-compile-bounded`). Deliberately out of scope for v1 of this kind. (G2)
3. **Internationalization.** `label` / `title` / `description` are single-language strings. RFC 0103 defines a localized content surface that may be the right host for this rather than a per-template locale map. (G3)
4. **The `format` reserved core set** is five values chosen from the JSON Schema formats a form realistically needs. Widening should be driven by adopter evidence, not anticipation. (G4)
5. **Template-level `dependencies` on artifact types.** `artifact-ref` is in the portable subset, so a field can reference an artifact — but this RFC does not require the template to declare which artifact type it expects. Chat cards solved the analogous problem with `outputArtifactType`. Worth revisiting once a host actually uses `artifact-ref` in a form template. (G5)

## Implementation notes (non-normative)

Sequencing: (1) land the schemas + spec docs + conformance + SECURITY invariant in `openwop` (this PR); (2) the reference registry (`openwop-registry`) extends its indexer to denormalize `templates[].templateId` and surface the kind on the landing page — **draft PR openwop-registry#43 already carries this work and should land with or just before this RFC rather than be rewritten**; (3) a reference host implements `host.forms.contentPacks` + the F1 trust boundary, which is the `Accepted` gate.

Expected effort: small-medium — two schemas, two spec docs, one scenario, one invariant. No engine or run-event change.

**Note for the motivating host.** The pack signed as `core.openwop.forms.starters@1.0.0` will need its `fields[].type` values remapped (`textarea` → `longtext`, `email` → `text` + `format`, `checkbox` → `boolean`) and re-signed — the signature covers exact bytes, so the remap forces a re-sign regardless. Adopting the portable subset is a net gain for that host: it also yields `number`, `multiselect`, `file`, and `artifact-ref`, none of which its private catalog had. A template that had been forced into a bounded `select` for want of a `number` type can take its honest type back.

## Amendment record (2026-08-05, same day, still `Active`)

- Preconditions were observed out-of-band before the run (`viaCreatePath: true`; the `vendor.acme.rating` field arriving as `control: text`), and the host ran its own sabotage host (capability advertised, seam wired, no templates registered) which **failed legs #1 and #2** — proving those two are sensitive to real host behavior rather than passing by soft-skip.
- **Recorded limit, volunteered by the host:** legs `#1/F2` and `#3` assert ABSENCES (no pack-bound routing, nothing locked), which its sabotage also satisfies; those two are discriminated instead by the steward's stub-host `routed` and `locked` modes (each reds exactly one leg, §A6).
- So all four legs are witnessed, but by two complementary harnesses rather than one.
- Witnessed on suite `1.61.0`; steward re-verified the result reproduces on `1.61.1` (**correction, same day:** the steward initially recorded the host as wrapper-exclusive and therefore resolving via the migration-window fallback — that was an over-inference from the host showing a `capabilities[...]` lookup.
- Verified in `openwop-app` `discovery.ts`: it spreads every family to the document ROOT and keeps the wrapper only as the permitted deprecated mirror, so it **satisfies** the RFC 0073 MUST and never relied on the fallback.
- G15 closed. The real, still-open axis is capability-key SPELLING — the helpers read a dotted `host.artifactTypes` while the host emits the plain family name — tracked as G16). F1 is implemented host-side (`toModelToolResult.ts` fencing at model-message construction, two call sites, plus a caller-enumeration ratchet).
- 2026-08-05 (amendment, same day, still `Active`) — **implementer-feedback amendment from the reference host, pre-adoption.** Adds two normative sections and relaxes two bounds; the field-type contract, `format` split, `id` naming, and SemVer axis are UNCHANGED.
- (1) §"Unique identifiers" — duplicate `templates[].templateId` / `fields[].id` MUST be refused; two fields sharing an `id` silently overwrite one another in the submission value bag, so this is data integrity, not style.
- Prose + registry/host check, because JSON Schema cannot express uniqueness-by-property — the same treatment every peer pack kind gives its id arrays.
- (2) §"No submission routing" (F2) + the `form-content-template-no-submission-routing` protocol-tier invariant — a template describes a form's SHAPE and MUST NOT describe where submissions go; binds future routing surfaces to operator consent rather than pack declaration.
- (3) Bounds RELAXED on adopter evidence: field `label` 200 → 1000 (a lawful GDPR consent label is legitimately long-form), `options` 200 → 250 entries (a country list is ~195).
- (4) Outer resource caps ADDED (`templates[]` ≤ 100, `fields[]` ≤ 200) — a render-bomb guard, deliberately set well above the host's own tighter product policy so the wire never rejects a legitimate form.
- (5) §"Host storage is out of scope" — the single-vocabulary rule binds the WIRE; a host MAY keep an internal representation and translate at the pack boundary. Suite `1.59.0 → 1.60.0`. See §"Amendment record" for the full reasoning.
- 2026-08-05 — landed directly at `Active` (wire shape LOCKED). The 7-day comment window (`GOVERNANCE.md` §"Normative addition") was **waived** under the bootstrap-phase single-maintainer steward waiver (`CONTRIBUTING.md` §"Bootstrap-phase notes"; same mechanism as RFC 0132/0133/0134/0135), architect-reviewed by the steward.
- Additive/backward-compatible; no objections outstanding. Graduation to `Accepted` is gated on a reference-host witness passing the capability-gated behavioral legs non-vacuously under `OPENWOP_REQUIRE_BEHAVIOR=true`.

The reference host reviewed the merged RFC against its shipped implementation and returned five items. Each was ruled on against the corpus rather than accepted on report. The wire contract's load-bearing decisions — the shared field-type subset, `format`-not-type, `id`-not-`key`, SemVer `templates[].version` — are **unchanged**; this amendment adds constraints and relaxes bounds.

**A1 — Duplicate field `id` MUST be refused. ACCEPTED, as prose + a registry/host check.**
JSON Schema 2020-12 cannot express uniqueness-by-property for an array of objects: `uniqueItems` compares whole objects, so `{id:"a",label:"X"}` and `{id:"a",label:"Y"}` are "unique" to it and the duplicate slips through. Every peer pack kind hits the same wall and resolves it identically — `node-pack-manifest.schema.json` (`nodes[].typeId`), `artifact-type-pack-manifest.schema.json` (`artifactTypes[].artifactTypeId`), and `chat-card-pack-manifest.schema.json` (`cards[].cardTypeId`) all state uniqueness in the property `description` with no schema enforcement. This RFC follows that precedent and strengthens it with an explicit normative section, because the failure mode reported here is worse than a name collision: two fields sharing an `id` silently overwrite one another in the submission value bag, so a user's answer is lost with no error. *Cross-kind observation (G11):* the other five kinds carry the same prose-only guarantee with no registry check named in `registry-operations.md`. That is a corpus-wide gap, not a form-content one, and is logged rather than fixed unilaterally here.

**A2 — A template MUST NOT carry submission-routing config. ACCEPTED as a protocol-tier invariant.**
The objection to weigh was redundancy: `additionalProperties: false` already rejects an `intakeBinding` key today, so does a second invariant earn its place? It does, for two reasons. First, there is exact precedent for this shape: `org-position-no-authority-escalation` (RFC 0087) is a protocol-tier invariant whose entire content is "the schema carries no permissions/scopes/canDispatch field and rejects one via `additionalProperties: false`," verified always-on and server-free. Second — and this is what `additionalProperties: false` cannot do — the invariant binds **future** evolution. It states that if a routing surface is ever added, routing remains a host-side decision made by the operator behind explicit consent; a pack MUST NOT bind a destination unilaterally. Where a tenant's submissions land is a decision about the *operator's* data, frequently personal data with legal obligations attached, and a signature confers authorship, not authority. A closed schema records today's shape; an invariant records the commitment.

**A3 — Bounds. Two RELAXED, two ADDED, with an explicit compatibility note.**
`label` 200 → 1000 and `options` 200 → 250 entries are **relaxations** — strictly more input is accepted, so nothing previously valid becomes invalid. The evidence is concrete and the original values were simply wrong: a lawful GDPR/marketing consent label routinely exceeds 200 characters, and a country list is ~195 entries against a 200 cap. The new outer caps (`templates[]` ≤ 100, `fields[]` ≤ 200) are a **narrowing**, and the honest classification is that a narrowing is not `additive` in the general case. It is safe here on specific grounds, not by assertion: RFC 0137 landed hours ago, **zero form-content packs exist in any registry** (the one motivating pack is held unpublished pending its field-type remap), so the set of manifests this could invalidate is empty. The caps are deliberately set well **above** the host's own product policy (it enforces 50 fields / 20 templates locally) — the wire's job is an outer render-bomb bound, not product policy, and a wire cap tighter than legitimate use is itself an interop hazard.

**A4 — The host's example `templateId` (`forms.contact-us`) is INVALID. Confirmed.**
`templateId` reuses the pack-name pattern and reserved scopes verbatim — `^(core|vendor|community|private)\.…` — matching `cardTypeId`, `artifactTypeId`, and pack `name`. A bare `forms.contact-us` has no reserved scope and is rejected. The correct spellings are `core.openwop.form.contact-us` (steward namespace) or `vendor.<org>.form.contact-us`. The pattern is not amended: namespace reservation is enforced at registry `PUT` (`registry-operations.md` §"Validation flow" #2) and by RFC 0043 policy, and exempting one kind would open a squatting hole.

**A5 — Host-side storage/wire translation. AFFIRMED, and now stated in the spec.**
The host stores its own field names and translates at the pack boundary rather than migrating stored rows — because migrating would coerce a stored multi-line field to single-line (silent data loss) and hard-fail host logic keyed on an internal type name, on tenant data, triggered by an ordinary save. This does **not** violate the single-vocabulary ruling. That ruling prohibits two divergent vocabularies *on the wire*; an internal representation with an anti-corruption layer is one wire vocabulary plus a private implementation detail. The host's own falsifying test is the right one: *does anything outside the host observe the internal names?* If not, there is one wire contract. Because a second host would reasonably ask the same question, this is now explicit in `form-content-packs.md` §"Host storage is out of scope" rather than left to inference.

**A6 — The `Active → Accepted` gate was unsatisfiable as written. FIXED (2026-08-05).**
The reference host went to run the gate and reported, correctly, that it could not: every leg this RFC shipped in `form-content-packs.test.ts` is **server-free** (corpus assertions, schema validation, the cross-kind vocabulary check). `--base-url <host>` would run them, go green, and prove nothing — the identical green appears against a host that never implemented RFC 0137, including one that advertises `host.forms.contentPacks` and does nothing. Asking for a "non-vacuous run" of a suite with no host-touching leg was an incoherent request, and the honest move was the host's: report the vacuity rather than post the green.

`form-content-instantiation.test.ts` now carries the behavioral half, gated on the advertisement **and** the `POST /v1/host/sample/formcontent/instantiate` seam (soft-skipping cleanly on both, so a non-implementing host stays v1-compliant). It asserts, over the wire, the three numbered §Instantiation rules plus F2: instantiation goes through the host's normal create path with no pack-bound routing destination (#1/F2); an unrecognized `vendor.*` / `x-` type **degrades to a plain text input rather than failing** (#2); and pack-authored fields stay fully editable (#3).

Its non-vacuity was verified against a stub host before merge, in the discipline the reference host itself modelled: a host that **refuses** a `vendor.*` type — precisely the non-conformance corrected in §A(clarification) — reds exactly leg #2; one that locks pack fields reds exactly #3; one that returns a pack-bound routing destination reds exactly F2; an unadvertised host passes all four by soft-skip. Each sabotage isolates one leg, so the suite cannot go green by over-refusing or by refusing everything.

**F1 is deliberately excluded from the wire leg.** Its observable — a `contentTrust` tag on a composed prompt — is not visible to a black-box client for a kind that composes no prompt of its own. Asserting it over HTTP would reproduce the exact vacuity this fix removes, so it remains a host-side guarantee backed by the always-on corpus legs and the invariant.

**Standing lesson.** A capability-gated *schema* leg and a capability-gated *behavioral* leg are not interchangeable, and "capability-gated" in an acceptance criterion should name the file that touches the host. The general form of this mistake — a green suite that never exercises the real path — showed up three times in one day across both sessions: seven passing tests for a function never called from the loader; a wiring test that passed on `isError: true` from an unregistered tool; and this RFC's own gate. It is the same failure every time: asserting about a component instead of about the path.

## Acceptance criteria

- [x] Spec text merged (`spec/v1/form-content-packs.md`; `registry-operations.md` §"Validation flow" #3/#7 + §"Type-ID indexing"; `host-capabilities.md` §host.forms).
- [x] Schemas updated (`form-content-pack-manifest.schema.json` NEW; `registry-version-manifest.schema.json` — kind enum, `templates` property, `anyOf` branch, `allOf` conditional). No OpenAPI/AsyncAPI surface is touched.
- [x] At least one conformance scenario covering the new surface (`form-content-packs.test.ts`), with fixtures catalogued; suite `1.58.0 → 1.59.0`.
- [x] SECURITY invariant `form-content-pack-string-trust-boundary` + threat-model update.
- [x] `CHANGELOG.md` entry under `[Unreleased]`.
- [ ] Reference registry denormalizes `templates[].templateId` and serves a published form-content pack (`openwop-registry#43`).
- [x] **A behavioral conformance leg that can actually witness the host exists** (`form-content-instantiation.test.ts`). Added 2026-08-05 after the reference host found that the `Active → Accepted` gate as originally written was **unsatisfiable**: every leg shipped with this RFC was server-free, so `OPENWOP_REQUIRE_BEHAVIOR=true` had nothing host-touching to make non-vacuous. See §"Amendment record" A6.
- [x] Reference host implements `host.forms.contentPacks` + the F1 trust boundary and passes `form-content-instantiation.test.ts` **non-vacuously** under `OPENWOP_REQUIRE_BEHAVIOR=true` — the `Active → Accepted` gate. — openwop-app#2976, rev `7a5c90af1`, 4/4 (see the `Updated` row for the witness's own stated limit).

## References

- RFC 0107 — Publishable declarative pack kinds. `RFCS/0107-publishable-declarative-pack-kinds.md` (the publication contract this amends).
- RFC 0071 — Artifact-type packs and AI chat card packs. `RFCS/0071-artifact-type-and-chat-card-packs.md` (Phase 2 §G9 — the authoritative field-type subset).
- RFC 0075 — Artifact-type packs, real-world amendment. RFC 0095 — Connection packs. RFC 0013 — Workflow-chain packs. RFC 0103 — Localized content surface. RFC 0134 — Edge-condition `truthy`/`falsy` operators.
- `spec/v1/{form-content-packs,chat-card-packs,registry-operations,host-capabilities,ai-envelope,positioning}.md`.
- `schemas/{form-content-pack-manifest,chat-card-pack-manifest,registry-version-manifest}.schema.json`.
- `SECURITY/threat-model-prompt-injection.md`, `SECURITY/invariants.yaml`.
- Companion registers: `RFCS/0137-form-content-packs.gaps.md`, `RFCS/0137-form-content-packs.risks.md`.
- Prior art: npm (manifest validated structurally, not assumed to be one shape); OCI image-spec (`mediaType` discriminator selects the payload schema); JSON Schema `format` (a constraint annotation distinct from `type`) — the direct model for §Proposal 4.
