# RFC 0066: `x-openwop-form` Vendor Extension on Pack `configSchema`

| Field | Value |
| --- | --- |
| **RFC** | 0066 |
| **Title** | `x-openwop-form` vendor extension on pack `configSchema` for picker-grade UX hints |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-05-25 |
| **Updated** | 2026-06-01 (`Active → Accepted`) — graduated on the **non-steward host** MyndHyve's **genuine frontend consumption** of the extension (deployed to Firebase Hosting `myndhyve-prod.web.app`, commit `33b498747`; reported via the `billy` crosstalk bus 2026-06-01). See [Amendment record](#amendment-record). |
| **Affects** | `spec/v1/node-packs.md` (new §"`x-openwop-form` UX hints"), `schemas/node-pack-manifest.schema.json` (no change — `additionalProperties` on inline configSchema already permits `x-*`), `RFCS/0043` (extends the vendor-extension policy to in-schema annotations), reference-app frontend `configFieldsFromSchema.ts` (Phase 2 — picks up the extension when present, falls through to pure-schema rendering when absent) |
| **Compatibility** | `additive` per `COMPATIBILITY.md §2.1` |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

Reserves a normative `x-openwop-form` annotation on pack-manifest `configSchema` properties so pack authors can opt their nodes into picker-grade UX (model / provider / credential / prompt pickers + cross-field dependency cascades) that the static reference-app catalog already provides for built-in nodes. The annotation is purely advisory (consumer-side hint; no behavior change at the host); rendering apps that don't understand it MUST fall through to pure-schema rendering, so pack-author opt-in costs nothing for non-openwop consumers and adds no wire-shape risk.

## Motivation

The reference app's static catalog (`apps/workflow-engine/frontend/react/src/builder/palette/nodeCatalog.ts`) declares each built-in node's `ConfigField[]` with rich UX vocabulary: `kind: 'model-picker'` (sourced from the host's `aiProviders.supportedModels` for the chosen provider), `kind: 'credential-picker'` (filtered by provider prefix), `kind: 'provider-picker'` (sourced from `aiProviders.supported`), `kind: 'prompt-picker'` (sourced from the prompt library per RFC 0027), and `dependsOn` for cross-field cascades (changing `provider` clears the dependent `model`/`credentialRef`).

When a pack node lands via `/v1/host/sample/node-catalog` (Phase 11a), its `configSchema` JSON Schema is converted to `ConfigField[]` by `configFieldsFromSchema`. The converter uses only schema-native vocabulary — `type` / `enum` / `minimum` / `maximum` / `pattern` / etc. — and produces plain `text` / `number` / `select` / `string-list` / `textarea` fields. **A pack-installed `chatCompletion` node renders `provider` and `model` as plain text inputs, missing the picker UX a built-in equivalent would get.**

Three real consequences:

1. **Pack-author UX gap.** A pack author who replicates `core.ai.chatCompletion`'s `configSchema` gets a worse builder experience than the bundled version. There's no mechanism today to declare "this string field should be the provider picker."
2. **Cross-field dependencies inexpressible.** JSON Schema can express "model is a string" but not "model's enum depends on the current value of the sibling `provider` field." `dependsOn` is a runtime UX concern outside JSON Schema's scope.
3. **App reinvents the wheel per-pack.** Without a declarative path, the only way a pack reaches picker UX today is to inline the convention in `nodeCatalog.ts` — defeating the dynamic-catalog point of pack-served nodes.

The fix is the smallest protocol commitment that closes the gap: reserve a vendor-extension key on the JSON Schema property so pack authors can declare picker intent. The reference renderer honors it when present; everything else (pack-author tooling, third-party renderers, `redocly lint`-style validators) ignores it gracefully because vendor extensions are by convention opt-in.

## Proposal

### §A — The `x-openwop-form` annotation

Pack `configSchema` properties MAY carry an `x-openwop-form` object with the following shape:

```jsonc
{
  "type": "string",
  "x-openwop-form": {
    "kind":              "model-picker",
    "dependsOn":         "provider",
    "provider":          "anthropic",
    "credentialProvider": "anthropic",
    "promptKind":        "system"
  }
}
```

All sub-fields are OPTIONAL except `kind`. A property without `x-openwop-form` MUST render exactly as it does today (pure JSON-Schema inference per `configFieldsFromSchema`). The set of `kind` values reserved by this RFC:

| `kind`              | Wire-store shape                               | Renderer behavior                                                                                                |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `text`              | `string`                                       | Plain `<input>`. Equivalent to no extension (explicit form of the schema default).                               |
| `textarea`          | `string`                                       | Multi-line `<textarea>`.                                                                                         |
| `string-list`       | `string[]`                                     | One-per-line textarea round-tripping to `string[]` (matches Phase 11a).                                          |
| `prompt-picker`     | `string` (PromptRef per RFC 0027)              | Dropdown sourced from the prompt library; honors `promptKind` filter.                                            |
| `provider-picker`   | `string`                                       | Dropdown sourced from `capabilities.aiProviders.supported`.                                                      |
| `model-picker`      | `string`                                       | Dropdown sourced from `capabilities.aiProviders.supportedModels[provider]`; reads sibling field via `dependsOn`. |
| `credential-picker` | `string` (credentialRef like `anthropic:prod`) | Dropdown filtered by `provider` literal OR by sibling provider via `dependsOn`.                                  |

Renderers MUST treat unknown `kind` values as if `x-openwop-form` were absent (forward-compat with future RFCs that extend the vocabulary).

### §B — Cross-field references (`dependsOn`)

`x-openwop-form.dependsOn` names a SIBLING property at the same schema-`properties` level. The renderer MUST:

1. Resolve the sibling's current value at render time.
2. Pass it to the picker as the dependency input (e.g., a `model-picker` with `dependsOn: 'provider'` constrains its dropdown to the chosen provider's models).
3. When the dependency-source field's value changes, **clear** the dependent field's value (no stale `{provider: anthropic, model: gpt-5}` configurations survive a provider swap).

`dependsOn` MUST reference a property whose declared type is compatible (the consuming picker expects a `string` source today; future picker kinds MAY accept other types). If `dependsOn` names a non-existent or non-sibling property, the renderer MUST render the field as if `x-openwop-form` were absent (graceful fallback, not a hard error).

### §C — Static provider/credential filters

`provider` (for `credential-picker`) and `credentialProvider` (legacy alias accepted by renderers; pack authors SHOULD use `provider`) are LITERAL string filters applied when there is no sibling `dependsOn`. A `credential-picker` MAY carry both — `dependsOn` wins; `provider` is the fallback when the dependency-source value is unset.

### §D — Non-normative consumer expectations

For consumers (i.e., builder apps) implementing this RFC:

- A pack-served node's `configSchema` is the **authoritative validator** for what the host accepts. `x-openwop-form` hints are advisory UX; they MUST NOT bypass schema validation.
- The picker's option list (models for a provider, credentials filtered by prefix, prompts from the library) is sourced from host advertisements (`/.well-known/openwop`) or sibling host endpoints (`/v1/prompts`), NOT from `x-openwop-form`. Pack authors don't enumerate picker contents.
- Renderers SHOULD record telemetry on unknown `kind` values they encounter — useful signal for the next RFC extending the vocabulary.

### §E — JSON Schema diff

No change to `node-pack-manifest.schema.json` — pack `configSchema` is an inline JSON Schema 2020-12 document with implicit `additionalProperties: true` on each property (the `x-*` prefix is the well-known convention for vendor extensions, accepted by every conformant JSON Schema validator). This RFC simply reserves `x-openwop-form` as a normative openwop-defined key on pack `configSchema` properties.

### §F — Positive + negative examples

**Positive: `core.ai.chatCompletion`'s `configSchema` annotated for picker UX.**

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id":     "https://packs.openwop.dev/core.openwop.ai/1.1.2/chat-completion.config.json",
  "type":    "object",
  "required": ["provider", "model"],
  "properties": {
    "provider": {
      "type": "string",
      "description": "AI provider id.",
      "x-openwop-form": { "kind": "provider-picker" }
    },
    "model": {
      "type": "string",
      "minLength": 1,
      "description": "Provider-specific model id.",
      "x-openwop-form": { "kind": "model-picker", "dependsOn": "provider" }
    },
    "credentialRef": {
      "type": "string",
      "description": "Stored credential to authenticate the provider call.",
      "x-openwop-form": { "kind": "credential-picker", "dependsOn": "provider" }
    }
  },
  "additionalProperties": false
}
```

**Negative — falls through to pure-schema rendering with no error.**

```jsonc
{
  "type": "string",
  "x-openwop-form": { "kind": "unknown-future-picker" }
}
```

The renderer treats this as `kind` absent and renders a plain text input. No throw, no warning at the user level — just a forward-compat fallback. (A telemetry hook MAY log unknown kinds for the maintainers.)

**Negative — `dependsOn` to a non-sibling falls through.**

```jsonc
{
  "type": "object",
  "properties": {
    "model": {
      "type": "string",
      "x-openwop-form": { "kind": "model-picker", "dependsOn": "providerThatDoesNotExist" }
    }
  }
}
```

The renderer renders `model` as a plain text input (or as a `model-picker` with no provider filter if it elects to be lenient — implementation choice per §B point 3).

## Compatibility

**Additive** per `COMPATIBILITY.md §2.1`.

- No new required field on any existing schema. The `x-openwop-form` key is purely additive on pack-author-controlled `configSchema`s; pack authors opt in.
- Existing `configSchema`s without `x-openwop-form` work unchanged — the renderer's Phase 11a behavior remains the floor.
- No host-side change. Hosts don't read `x-openwop-form`; they validate against the `configSchema`'s standard JSON Schema keywords. This is a consumer-side contract.
- No SDK change. The SDKs don't expose pack `configSchema` rendering surface.
- No `Capabilities-Etag` impact. The extension lives in pack manifests served via the registry, not in `/.well-known/openwop`.
- Forward-compat by design: renderers MUST treat unknown `kind` values as `x-openwop-form` absent (§A last paragraph).

The 7-day comment window applies (additive RFC per `RFCS/0001-rfc-process.md`).

## Conformance

This RFC's normative surface is the _contract pack authors target_, not a host-side behavior. The conformance gate is shape-level:

- **New scenario** `conformance/src/scenarios/x-openwop-form-pack-manifest.test.ts` — validates that a pack `configSchema` carrying `x-openwop-form` annotations remains a valid JSON Schema 2020-12 document AND that the annotation shape itself matches an inline JSON Schema for the `kind` vocabulary listed in §A. Server-free; no host advertisement gate (the extension is consumer-side).
- **No new host capability** — hosts don't advertise this extension. The reference renderer's behavior is documented in `node-packs.md` but not gated.
- **Reference-app coverage** — the in-tree workflow-engine sample's `configFieldsFromSchema` (frontend) gets a Phase 2 extension that honors `x-openwop-form` when present. Unit-tested in the existing `__tests__/configFieldsFromSchema.test.ts` (after Phase 11a's framework lands).

Path-to-Accepted requires: this RFC's spec text merged, the conformance shape scenario green, AND a non-steward pack author publishing a pack that exercises the extension (cohort precedent: a pack uses the extension, the renderer honors it, evidence in `INTEROP-MATRIX.md`).

## Alternatives considered

1. **Pure JSON Schema rendering (no extension).** Pack-installed nodes get plain text/select inputs for everything; picker UX stays a built-in-only luxury. Rejected: defeats the dynamic-catalog point; widens the "built-in vs pack" UX gap as more nodes move to packs over time. (The architect review for plan item #11 explicitly named this as Option A; this RFC is the recommended Option B.)
2. **Heuristic inference from property names.** App pattern-matches field names: a property named `model` becomes a model-picker, `credentialRef` becomes a credential-picker, etc. Rejected: brittle (every new picker kind needs a regex; cross-field dependencies inexpressible; adversarial-pack risk — a pack could name an unrelated field `credentialRef` and steal a credentials dropdown UI).
3. **`format` keyword overload.** JSON Schema's `format` is for primitive-string formats (date-time, uri, email). Using it for `format: "model-picker"` would conflict with future standard `format` additions and confuse non-openwop schema validators. Rejected.
4. **`$comment` overload.** `$comment` is reserved for human-readable schema author notes; parsers MAY discard it. Putting structured data there violates the spec. Rejected.
5. **Out-of-band sidecar file.** Ship picker hints in a parallel file (`chat-completion.config.openwop-form.json`) referenced from the pack manifest. Rejected: doubles the artifact count per node; harder to keep in sync; the `x-*` prefix on JSON Schema is the standard idiom for advisory vendor data.
6. **In-pack-manifest top-level annotation.** Move the hints out of the JSON Schema into a new `nodes[].formHints` field on the pack manifest. Rejected: separates the picker contract from the validator contract (they're describing the same property); duplicates property names; encourages the two to drift.

## Unresolved questions

1. **Should `kind: "string-list"` carry an explicit `separator` knob** (e.g., comma-separated vs newline-separated)? Phase 11a hard-coded newline-per-entry. Defer until a pack author asks.
2. **Should `dependsOn` support dotted paths** for nested properties (`config.provider.id`)? The current scope is flat sibling-only — matches the static catalog. Defer until a real-world need arises.
3. **Should there be a `kind: "json"` for explicit "render this as raw JSON textarea"** that overrides the converter's inference? Useful when an author wants the JSON textarea even though the property is `type: array, items: string`. Defer; can land as a separate additive amendment.
4. **`provider` vs `credentialProvider` field name** — the legacy `nodeCatalog.ts` static-catalog uses `credentialProvider` on `credential-picker` `ConfigField`s. This RFC standardizes on `provider` (shorter, no kind-prefix). Should renderers accept both forever, or sunset `credentialProvider` after a deprecation window? Defer; the renderer will accept both in Phase 2 with `provider` winning when both are set.
5. **Telemetry on unknown `kind` values** (§D) — should the RFC require it normatively (MUST emit a structured warning) or leave it as a SHOULD? Lean SHOULD; the upstream signal is helpful but not safety-critical.

## Implementation notes (non-normative)

- **Phase 1 (this RFC):** spec text in `node-packs.md`, RFC file, CHANGELOG, KNOWN-LIMITS row. No renderer change yet — the file is `Draft` and the convention isn't normatively reserved until the comment window closes.
- **Phase 2 (post-Active):** extend `configFieldsFromSchema` in the reference frontend to detect `x-openwop-form` on each property and produce the matching `ConfigField` kind. Fall through to the pure-schema inference (Phase 11a) when the annotation is absent OR carries an unknown `kind`. Unit-test the matrix.
- **Phase 3 (post-Accepted):** update `packs/core.openwop.ai/schemas/chat-completion.config.json` (and siblings) to declare the picker hints, so the in-tree AI pack is the first adopter. This is the path-to-Accepted demonstration evidence.
- The extension does NOT need a new SDK helper. SDKs deal with the wire (run/event/discovery surfaces); pack `configSchema` annotations are consumer-app-only.
- Reference renderer touches one file (`configFieldsFromSchema.ts`) plus the same `Inspector.tsx` cases Phase 11a already wired. The new picker components (`ModelPickerInput`, `CredentialPickerInput`, etc.) already exist for the static-catalog path — they get reused when the converter produces matching `ConfigField.kind`.

## Acceptance criteria

- [ ] Spec text in `spec/v1/node-packs.md` §"`x-openwop-form` UX hints" merged with RFC 2119 keywords (MUST on the unknown-`kind` fallback, MUST on the `dependsOn` cascade-clear).
- [ ] `RFCS/0043-registry-and-extension-policy.md` cross-references this RFC as the first formal in-schema vendor-extension namespace (one-line note; not a normative change to 0043).
- [ ] `conformance/src/scenarios/x-openwop-form-pack-manifest.test.ts` — server-free shape validation of the annotation when present in a pack `configSchema`. Server-free; runs <1s.
- [ ] Reference-frontend `configFieldsFromSchema` (Phase 2) honors the extension; unit test extended.
- [ ] CHANGELOG entry under the appropriate `[1.1.x — unreleased]` block.
- [ ] First adopter pack (`core.openwop.ai` or external) publishes a `configSchema` using the extension — path-to-Accepted evidence per `RFCS/0001`.

## Amendment record

Change history relocated from the `Updated` metadata cell (newest first).

- MyndHyve's `SchemaFormRenderer` now reads `x-openwop-form`: the `field` `kind` picks an explicit widget overriding the heuristics (`prompt` → multiline; `provider`/`model`/`credential-picker` → enum Select or a single-line input tagged `data-openwop-form=<kind>` for a richer picker), and `dependsOn` makes a field conditionally visible on a sibling's value — exactly the Phase-2 `configFieldsFromSchema` consumption the path-to-Accepted called for (3 render tests + the always-on server-free `x-openwop-form-pack-manifest` scenario green on `main`).
- **Verification basis (honest):** `x-openwop-form` is an advisory authoring-time UX hint with **no discovery advertisement or wire surface** by design, so the graduation rests on the adoption-judgment model — the verifiable server-free conformance floor (green on `main`) + a credible non-steward genuine-consumption report — not a steward curl of a discovery field (there is none to curl).
- David greenlit building real app-side adoption, not advertise-only.
- 2026-05-29 (`Draft → Active`: the normative surface landed — `spec/v1/node-packs.md` §"`x-openwop-form` UX hints" (the §A `kind` vocabulary `prompt`/`provider`/`model`/`credential-picker` + the `MUST` unknown-`kind` fallback + the `MUST` `dependsOn` sibling-resolution/graceful-fallback) + the new server-free conformance scenario `x-openwop-form-pack-manifest.test.ts` (6 assertions: an annotated `configSchema` stays a valid 2020-12 schema and the advisory hints don't change what it accepts; each §A annotation matches the shape; forward-compat — an unknown `kind` validates; 3 negatives — missing `kind` / non-string `kind` / non-string `dependsOn`).
- No schema change (the annotation rides author-controlled `configSchema` `x-*` extensibility).
- Comment window waived (steward acceptance, additive per `COMPATIBILITY.md §2.1`). `Active → Accepted` awaits the Phase-2 reference-frontend `configFieldsFromSchema` honoring the extension + a first adopter pack publishing a `configSchema` that uses it — the path-to-Accepted evidence per `RFCS/0001`.).

## References

- `spec/v1/node-packs.md` — pack manifest format + `configSchema` host-validation contract.
- `RFCS/0003-agent-packs.md` — pack-kind manifest precedent.
- `RFCS/0043-registry-and-extension-policy.md` — vendor-extension namespace policy on event types + capabilities. This RFC extends that policy to in-schema annotations.
- `RFCS/0027-prompt-templates.md` — `PromptRef` wire shape consumed by `prompt-picker`.
- `apps/workflow-engine/frontend/react/src/builder/palette/configFieldsFromSchema.ts` — the Phase 11a JSON-Schema converter that this RFC's Phase 2 extends.
- `apps/workflow-engine/frontend/react/src/builder/palette/nodeCatalog.ts` — static catalog whose `ConfigField` vocabulary this RFC mirrors.
- `plans/app-buildable-now-on-existing-protocol.md` item #11b — the planning artifact that motivated this RFC.
