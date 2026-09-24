# RFC 0209: v2 A2UI surfaces are A2UI v0.9

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0209                                                            |
| **Title**         | `ui.a2ui-surface` schema version 2 carries real A2UI v0.9 server-to-client messages (a closed OpenWOP profile of the basic catalog), while the 0.9.1 seven-component tree stays readable forever. The RFC 0114 delta frame is deprecated in v2, and v2 regains the `ui.*`/`media.*` kind carve-out |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 (`Draft → Active` in the filing PR; **comment window waived** by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation" — an explicit **steward override of RFC 0147 §A.6** (precedent: RFC 0194), which forbids bootstrap waiver language from shortening the window for an RFC of this risk class; it is outside the `MAINTAINERS.md` waiver grant and recorded there as an override, not as a routine waiver. This RFC affects **authorization** (A2UI action confinement and the untrusted-surface approval block) and **replay** (a surface's state becomes the fold of several recorded envelopes). **Acceptance under this override is provisional and the §B review is owed** (RFC 0156 register, `docs/WAIVER-RETROSPECTIVE-REGISTER.md`).) · **Updated 2026-09-22 — amended per implementation review** (`review/arch-impl.md` R4, R5; Status unchanged: the `(corpus)` rows are minted by a coherence test in `conformance/src/coherence/`, where the corpus ledger is emitted, not by the scenario's server-free legs; `catalog-pinned` is split into the corpus enum id and the seam-gated `catalog-equality` id, so a ledger row cannot stand in for the seam half; the v2 reference host is the expected behavioural witness; RFC 0197's shape-monotone baseline is generated after this RFC's schema restructure lands; the scenario rides the open 2.36.0 suite (decisions log D3)) |
| **Affects**       | `schemas/v2/envelopes/ui.a2ui-surface.schema.json` (hand-edited; a second, schema-version-2 branch) · `spec/v2/ext/a2uiSurface/README.md` (becomes the v2 contract for the kind) · `spec/v2/core/events.md` §"AI envelopes: E1–E5" (the `ui.*`/`media.*` carve-out) and §"The envelope-kind catalog" (one pointer) · `spec/v2/declaration.json` (`a2uiSurface`: `owningRfc`, `reason`) · `spec/v1/deprecations.json` (the v2 delta frame and `deltaTransport` facet) · `SECURITY/invariants.yaml` (five `a2ui-*` notes restated for the v0.9 path, plus one new row) · `SECURITY/threat-model-prompt-injection.md` · conformance (one new major-2 scenario; vendored upstream A2UI v0.9 schemas as fixtures). **v1 is unchanged.** |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1. It adds a per-kind schema version, a widening under `events.md` §"The envelope-kind catalog", plus two Class-3 corrections on record for v2 only (§D). |
| **Supersedes**    | — (amends RFC 0102 §A's payload shape and RFC 0114 for major 2 only. Where it touches them, it corrects v2's seeded copies; v1's `ai-envelope.md` §"A2UI surfaces" and §"Delta transport" stand unchanged) |
| **Superseded by** | —                                                               |

## Summary

OpenWOP's `ui.a2ui-surface` carries the A2UI name without the A2UI wire. It is a flat list of seven OpenWOP-named components (`heading`, `text`, `field.text`, `field.date`, `field.select`, `field.checkbox`, `action.button`), pinned by a version string, `catalogVersion: "0.9.1"`. It has no `catalogId`, no `surfaceId`, no data model, and none of A2UI's message types. An A2UI renderer cannot render it.

In v2, this RFC adds a second payload branch at per-kind **schema version 2**: an ordered run of real A2UI v0.9 `createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface` messages. The branch is restricted to a closed OpenWOP **profile** of the basic catalog (`Text`, `TextField`, `CheckBox`, `ChoicePicker`, `DateTimeInput`, `Button`, `Column`, `Row`, `Card`, `Divider`).

Every profile-valid message is a valid upstream A2UI v0.9 message. The profile keeps all five `a2ui-*` security invariants, and it closes the upstream affordances that would break them: `functionCall` actions (including `openUrl`), URL-bearing media components, `theme.iconUrl`, and `obscured` text fields.

The schema-version-1 tree stays readable on replay, fork and poll for the life of the major. A2UI's own incremental messages make the RFC 0114 JSON-Patch delta frame unnecessary in v2, so this RFC deprecates the frame there. Its removal follows RFC 0197. v1 does not change.

## Motivation

**The shape does not match what the name claims.** Evidence from `review/verify-EF.md` (#1/F-2) and `F-content-packs-ui.md` F-2, re-checked live on 2026-09-22:

| | OpenWOP `ui.a2ui-surface` (v1 = v2 seed) | A2UI v0.9 (a2ui.org, fetched 2026-09-22) |
| --- | --- | --- |
| Catalog identity | `catalogVersion: {"enum": ["0.9.1"]}` | `catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"` |
| Components | 7, OpenWOP-named | 18 in the basic catalog: `Text`, `Image`, `Icon`, `Video`, `AudioPlayer`, `Row`, `Column`, `List`, `Card`, `Tabs`, `Modal`, `Divider`, `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput` |
| Structure | a flat ordered list; field `id` is a binding key | an adjacency list keyed by component `id`, with exactly one `root` |
| State | none | a per-surface data model (`updateDataModel`, JSON Pointer paths) |
| Messages | one payload | `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface` (`server_to_client.json`, `version: "v0.9"`) |

`ai-envelope.md:350` promises "a component tree built from a host-pinned A2UI catalog, with data bindings and actions", but there are no data bindings. RFC 0102's own register still carries G5 ("needs confirmation against the live A2UI 0.9.1 catalog") and G7 ("leaving `surface` internals to the A2UI spec (referenced, not re-specified)"). The schema re-specified them instead.

**Why v2, and why now.** v2 has never defined this contract:
- `spec/v2/ext/a2uiSurface/README.md` says: "Discovery-only reservation; no portable operations or payload contract is defined in the current v2 corpus."
- `schemas/v2/envelopes/ui.a2ui-surface.schema.json` still carries `x-openwop-seeded-from: v1`.
- No committed v2 host bundle carries `ui.a2ui-surface` or `a2uiSurface` (`evidence/v2-host-bundles/*`, checked 2026-09-22).
- v1 has a live advertiser (app.openwop.dev, `schemaVersions` 1), so v1 cannot change.

Phase 4 architect finding 4c and §5 decision 2 recommend exactly this: add a v0.9 branch under a bumped per-kind schema version, keep v1, and make replay readers accept `0.9.1` forever.

**And v2 invalidates the kind as it stands.** `events.md` §"AI envelopes" says: "An envelope kind MUST be namespaced under the same `<org>.` rule as events, universal kinds excepted." Row E3 adds: "a kind whose org is not registered is invalid." `ui` and `media` are not registered orgs, and the universal kinds are the four MUST-recognize kinds. v1 carved out the core content-primitive families (`ai-envelope.md:383`); v2's text dropped the carve-out while v2's own schemas kept shipping `ui.a2ui-surface` and `media.*` (Phase 4 architect finding 10). So a v2 host advertising any of those kinds is non-conformant by construction.

## Proposal

### §A Schema version 2 of `ui.a2ui-surface`

1. `schemas/v2/envelopes/ui.a2ui-surface.schema.json` becomes an `anyOf` of two closed branches:
   - `$defs/payloadV1` is the existing tree, unchanged byte-for-byte. It is selected by per-kind schema version **1**, or by `0`/absent: the pre-versioning default that `events.md` compares against `0`.
   - `$defs/payloadV2` is new. It is selected by per-kind schema version **2**.

   An engine MUST validate an envelope against exactly one branch: the branch for the version that `events.md` §"The envelope-kind catalog" selects. That is the emitted version, except under `warn` below the floor, where it is the advertised one. The engine MUST never validate against the union: a version-2 envelope carrying a version-1 payload is invalid, and so is the reverse. The `anyOf` exists for tooling. When a host asks a model to emit version 2, it hands the provider `$defs/payloadV2` alone.

2. `payloadV2` is `{ reasoning?, version: "v0.9", catalogId, surfaceId, messages[1..64] }`.
   - `catalogId` is an enum of the host-pinned catalogs. Today that is exactly the basic catalog's `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`, never a free string. This replaces `catalogVersion` as the determinism pin.
   - Each `messages[]` item is one A2UI v0.9 server-to-client message, restricted to the §B profile.
   - Every message's `surfaceId` MUST equal the payload's `surfaceId`.
   - A `createSurface.catalogId` MUST equal the payload's `catalogId`.

3. **A host advertises version 2 by its floor.** `schemaVersions.kinds["ui.a2ui-surface"]: 2` admits version 2. The existing `events.md` rules then apply unchanged:
   - above the floor ⇒ `unknown_schema_version`;
   - below the floor ⇒ `envelopeStrictness`.

   A consumer that knows only version 1 refuses version 2 and fails closed. Retiring version-1 *emission* is therefore a host's own choice, made by raising its floor; the corpus removes nothing.

### §B The OpenWOP profile of the A2UI v0.9 basic catalog

4. **Profile ⊂ upstream.** Every message that validates against `payloadV2.messages[]` MUST also validate against upstream A2UI v0.9 `server_to_client.json`, with the basic catalog and `common_types.json` bound. The profile only removes; it never adds a property A2UI lacks. Conformance vendors the three upstream files, pinned by SHA-256 (§References), and checks this.

5. **Messages.**

   | Message | Profile |
   | --- | --- |
   | `createSurface` | `surfaceId`, `catalogId`, and optional `theme` restricted to `primaryColor` and `agentDisplayName`. `theme.iconUrl` is excluded because it is network egress. `sendDataModel` is excluded, because collected data returns only through §C. |
   | `updateComponents` | `surfaceId`, and `components[1..512]` drawn from the component set in rule 6. |
   | `updateDataModel` | as upstream: `surfaceId`, optional `path` (JSON Pointer), optional `value`. |
   | `deleteSurface` | as upstream. |

6. **Components.** Each component is closed, carries `additionalProperties: false`, and is discriminated by a single-string-enum `component`, in keeping with `ai-envelope.md` §"Schema discipline". The ten components and what the profile does to each:

   | Component | Restriction |
   | --- | --- |
   | `Text` | none |
   | `TextField` | `variant` ∈ {`shortText`, `longText`, `number`}; `obscured` is excluded (rule 8) |
   | `CheckBox` | none |
   | `ChoicePicker` | none |
   | `DateTimeInput` | none |
   | `Button` | `action` limited as in rule 7 |
   | `Column`, `Row` | static `children` id lists only; data-model templates are excluded |
   | `Card` | none |
   | `Divider` | none |

   Two restrictions apply to every component:
   - **Dynamic values** are a literal or a `{path}` data binding. A2UI `FunctionCall` values are excluded, with one exception: a `checks[].condition` MAY call the pure `required` function.
   - **Excluded components.** `Image`, `Video`, `AudioPlayer` and `Icon` are out: the first three fetch a URL, and `Icon` is deferred (Unresolved question 1). `List`, `Tabs`, `Modal` and `Slider` are also out.

7. **Actions (`a2ui-action-confinement`).** A `Button.action` MUST be the A2UI server-event arm, `{ event: { name, context? } }`, with `name` ∈ {`resume`, `exchange`}. The two names are the allowlisted targets of `ai-envelope.md` rule 2: an interrupt resume and a conversation exchange. The `functionCall` arm is excluded. That arm is client-side execution, and in the basic catalog it includes `openUrl`. `context` values are §B.6 dynamic values.

8. **No secret input (`a2ui-surface-no-secret-input`, new).** A surface MUST NOT solicit a secret. This is RFC 0199 §C.6 ("no interrupt collects a secret") applied to the A2UI schema: a surface's collected values are an interrupt's resume value, so §C.6 already binds the author, and this rule is its machine-checkable half for A2UI, as RFC 0199 §D.2(d) is for MCP form mode. The schema excludes `TextField.variant: "obscured"`, and a host MUST NOT emit a surface whose evident purpose is credential collection. Collected values become a `resumeValue` in the event log, where SR-1 redaction is a backstop, not a licence. This mirrors MCP 2026-07-28 `client/elicitation` l. 30: "Servers **MUST NOT** use form mode elicitation to request sensitive information", fetched live 2026-09-22 from modelcontextprotocol/modelcontextprotocol `main`.

### §C Semantics

9. **A surface is a fold.** A surface is identified by `(runId, surfaceId)`. Its state is the fold, in event `sequence` order, of the `messages` of every schema-version-2 `ui.a2ui-surface` envelope the run recorded with that `surfaceId`. The fold follows A2UI v0.9 semantics:
   - `updateComponents` upserts components by `id`;
   - `updateDataModel` replaces or removes the value at `path`;
   - `deleteSurface` ends the surface.

   The host MUST refuse, rather than record, an envelope that would make this fold invalid:
   - the first envelope for a `surfaceId` does not begin with `createSurface`;
   - `createSurface` is sent for a live `surfaceId`;
   - any message follows `deleteSurface` without a new `createSurface`.

   A consumer MUST NOT render the surface, and MUST NOT enable any action on it, until the fold holds exactly one component with `id: "root"` (A2UI: "There must be exactly one component with the ID `root`").

10. **Collected data.** When a user fires a `Button` whose `event.name` is `resume` or `exchange`, the consumer resolves `event.context` against the surface's data model and submits the result: as the interrupt `resumeValue` for `resume`, or as the exchanged turn's data for `exchange`. With no `context`, it submits the surface's whole data model at `/`. It MUST NOT submit to any other target (rule 7).

11. **Replay and fork (`replay.md`).** Recorded surface envelopes are returned as recorded, and no surface is ever regenerated. That is `ai-envelope.md` rule 4, with durable state widened from "(surface envelope, submitted resume value)" to "(the ordered surface envelopes, submitted resume value)".
    - A reader MUST keep accepting schema-version-1 envelopes on replay, fork and poll for the life of the major. That holds even on a host whose floor is now 2: recorded envelopes are read, not re-admitted through the envelope-kind catalog.
    - A fork at `fromSeq` folds only the envelopes in `[0, fromSeq)`.

12. **Trust is sticky (`a2ui-untrusted-blocks-approval`).** If any envelope in a surface's fold carries `meta.contentTrust: "untrusted"`, the whole surface is untrusted, and the `untrusted_content_blocks_approval` rule applies to every action on it. A later trusted `updateComponents` does not launder an earlier untrusted one, and the reverse also holds: one untrusted update taints a surface a trusted node created. The SR-1 harness walks every message.

13. **Streaming.** `partial: true` keeps its meaning per envelope (`ai-envelope.md` rule 3). A surface's actions stay disabled until the envelope that last touched it has finalized.

### §D Corrections for v2 (Class 3, on record)

14. **The kind carve-out.** In `events.md` §"AI envelopes", "universal kinds excepted" becomes "universal kinds and the core content-primitive families `ui.*` and `media.*` excepted". This restores for v2 the rule v1 states at `ai-envelope.md:383`. Without it, no v2 host could advertise a kind the v2 corpus ships a schema for. That is the COMPATIBILITY Class-3 criterion: "no implementation could satisfy" (the `deliveryId` precedent). No MUST moves, and no conforming host stops conforming. If RFC 0197 lands first, this correction is recorded in its `corrections.json` (0197 §A.4). Its R3 condition holds, because no committed bundle carries either kind family.

15. **The delta frame and `deltaTransport` in v2.** `schemas/v2/a2ui-surface-delta-frame.schema.json` and the `a2uiSurface.deltaTransport` facet are deprecated for major 2. A v2 host SHOULD NOT advertise the facet. Incremental updates are version-2 envelopes carrying `updateComponents` / `updateDataModel` (§C.9), which are recorded, replayable and closed-catalog-validated by construction.

    The deprecation row carries `removeIn: "3.0"` until RFC 0197 ("retire, never reshape") is `Accepted`. After that, removal follows 0197's machine-checked `v2-minor` path (`check-v2-retirement.mjs`). The expected disposition under each of 0197's predicates:

    | Predicate | Holds? |
    | --- | --- |
    | R1: replacement first | yes; this RFC adds the replacement, and the `spec/v2/migrations.json` row is recorded when 0197 creates that register |
    | R2: announced minor | on the rescheduled row |
    | R3: unevidenced | holds today: no committed v2 bundle carries the frame or the facet |
    | R4: absence already defined | an optional ext facet |
    | R5: corpus maturity | `a2uiSurface` is `experimental` |
    | R6: no independent host | no tier-3 host |

    If 0197 is not accepted, the frame stays deprecated until 3.0. That is harmless, because no v2 host advertises it.

    v1's RFC 0114 stands.

### §E Normative home and word budget

16. The v2 contract for the kind (§A–§C) lives in `spec/v2/ext/a2uiSurface/README.md`, which grows from a discovery-only reservation into the kind's contract. That document is `a2uiSurface`'s own ext section, and no core family cites it, so `check-core-budget.mjs` does not count it (RFC 0190 §A). Arch-P4 §6.4 placed the A2UI text in `ext/` for this reason.

17. Core words touched are `events.md` only: §D.14's clause, and one pointer sentence in §"The envelope-kind catalog": "`ui.a2ui-surface` at schema version 2 is specified by `ext/a2uiSurface/README.md`." **Net core-word delta: +17** (8 words in the clause and 9 in the pointer, by `check-core-budget.mjs`'s whitespace split). No family is homed. `a2uiSurface` is ext-anchored, and the `envelopes` family's `normativeText` is unchanged.

### Examples

**Positive** (valid against the profile and against upstream A2UI v0.9; checked at authoring with Ajv 2020 against the vendored upstream files, in the review notes). The recorded payload of one `ui.a2ui-surface` envelope with `schemaVersion: 2`:

```json
{ "version": "v0.9",
  "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
  "surfaceId": "approve-brief",
  "messages": [
    { "version": "v0.9", "createSurface": { "surfaceId": "approve-brief",
        "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json" } },
    { "version": "v0.9", "updateComponents": { "surfaceId": "approve-brief", "components": [
        { "id": "root", "component": "Column", "children": ["h", "name", "submit"] },
        { "id": "h", "component": "Text", "text": "Launch brief", "variant": "h2" },
        { "id": "name", "component": "TextField", "label": "Product name", "value": { "path": "/name" },
          "checks": [ { "condition": { "call": "required", "args": { "value": { "path": "/name" } } }, "message": "Required" } ] },
        { "id": "submit_label", "component": "Text", "text": "Submit" },
        { "id": "submit", "component": "Button", "child": "submit_label",
          "action": { "event": { "name": "resume", "context": { "name": { "path": "/name" } } } } } ] } },
    { "version": "v0.9", "updateDataModel": { "surfaceId": "approve-brief", "value": { "name": "" } } } ] }
```

**Negative.** Each of the following is refused by the profile, and each is **accepted by upstream A2UI**. That acceptance is why the profile exists:
- a `Button.action` of `{ "functionCall": { "call": "openUrl", "args": { "url": "https://evil.example/" } } }`;
- `event.name: "deleteAll"`;
- `TextField.variant: "obscured"`;
- an `Image` component;
- `theme.iconUrl`;
- a `Text.text` that is a `formatString` call.

Two more are refused by both: an extra property such as `onClick`, and a foreign `catalogId`.

**Migration from schema version 1 (informative).** A mechanical map. The only loss is `placeholder`, which has no v0.9 field.

| v1 component | v0.9 profile |
| --- | --- |
| `heading {text, level}` | `Text {text, variant: "h<level>"}`; level 6 maps to `h5` |
| `text {text}` | `Text {text, variant: "body"}` |
| `field.text {id, label, required}` | `TextField {id, label, value: {path: "/<id>"}, checks: [required]}` |
| `field.date {id, label}` | `DateTimeInput {id, label, value: {path: "/<id>"}, enableDate: true}` |
| `field.select {id, label, options}` | `ChoicePicker {id, label, options, value: {path: "/<id>"}, variant: "mutuallyExclusive"}`; note that the collected value becomes a one-element array |
| `field.checkbox {id, label, default}` | `CheckBox {id, label, value: {path: "/<id>"}}`, with `default` seeded by `updateDataModel` |
| `action.button {id, label, action.target}` | `Button {id, child: "<id>_label", action: {event: {name: <target>, context: {<each field id>: {path: "/<id>"}}}}}`, plus a `Text` label |
| surface `title` | a leading `Text {variant: "h1"}` |
| (root) | a `Column {id: "root", children: [...]}` in v1 order |

## Compatibility

- **Additive.** No committed v2 bundle and no v1 surface changes.
  - `payloadV1` is unchanged, so every version-1 envelope that validated still validates.
  - Version 2 is new, and it is reachable only by a host raising its floor. The existing above-floor refusal makes unaware consumers fail closed.
  - Adding a branch to a per-kind payload under a new schema version is the widening that `events.md` §"The envelope-kind catalog" and `versioning.md` axis 6 exist for (Phase 4 architect §2, row 4c).
- **§D.14** is a Class-3 correction: the v2 text was impossible to satisfy for kinds v2 itself shipped.
- **§D.15** deprecates and removes nothing in this RFC.
- **No relaxation.** No `MUST` is relaxed. Each of the five `a2ui-*` invariants holds on the version-2 path at least as strictly as on version 1 (§B.7, §B.8, §C.12, and rule 6's egress exclusions).
- **v1 unchanged.** `ai-envelope.md`, `schemas/envelopes/ui.a2ui-surface.schema.json`, RFC 0114 and the six v1 `a2ui-*` scenarios are untouched.

## Conformance

- **Existing.** Six major-1 scenarios pin the v1 shape: `a2ui-surface-shape`, `-delta-transport`, `-replay`, `-degrades`, `-version-refusal`, and `a2ui-untrusted-blocks-approval`. All stay as they are. No major-2 scenario covers A2UI today.
- **New coherence test (planned): `conformance/src/coherence/a2ui-v09-profile.test.ts`.** It carries every server-free leg, against `schemas/v2/envelopes/ui.a2ui-surface.schema.json` and against vendored upstream A2UI v0.9 schemas in `conformance/fixtures/upstream/a2ui-v0.9/`, pinned by SHA-256, and mints every `(corpus)` id of the Falsifiability table. `evidence/corpus-ledger.json` is emitted only from `conformance/src/coherence/`, and `check-accepted-predicate` satisfies a `(corpus)` row from that ledger alone.
- **New major-2 scenario (planned): `v2-a2ui-v09-surface.test.ts`.**
  - Seam-gated behavioural legs only through the v2 seams profile (an emit-surface seam equivalent to v1's), `inapplicable` where the seam is absent.
- **Invariants.** Five `a2ui-*` notes are restated for the version-2 path, and `tests:` gains the new scenario. One row is added: `a2ui-surface-no-secret-input`. Re-derive the count at merge (203 → 204).
- **Suite.** The scenario rides the open, unpublished 2.36.0 suite (decisions log D3), and is not published before the steward's go. No new requirement id enters a floor or a profile predicate.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B.4 profile ⊂ upstream (`openwop.requirement.0209.profile-subset-of-upstream`) | every positive fixture's `messages[]` validates against vendored upstream `server_to_client.json` (planned coherence test `a2ui-v09-profile.test.ts`) | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by adding an OpenWOP-only property (e.g. `Text.level`) to the profile and a fixture using it, and the upstream leg fails |
| §B.7 actions confined (`openwop.requirement.0209.action-confined`) | a `functionCall` action, or an `event.name` outside {`resume`,`exchange`}, fails `payloadV2` | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by admitting the upstream `Action` `oneOf`, and the `openUrl` negative passes |
| §B.8 no secret input (`openwop.requirement.0209.no-secret-input`) | `TextField.variant: "obscured"` fails `payloadV2` | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by restoring the upstream `variant` enum |
| §B.5–§B.6 no egress-bearing components (`openwop.requirement.0209.no-egress-components`) | `Image`, `Video`, `AudioPlayer` and `createSurface.theme.iconUrl` each fail `payloadV2` | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by adding `Image` to the component `anyOf` |
| §A.2 catalog pinned (`openwop.requirement.0209.catalog-pinned`) | a payload `catalogId` other than the basic-catalog URI fails | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by widening the `catalogId` enum, and the foreign-catalog negative passes |
| §A.2 catalog equality on a live host (`openwop.requirement.0209.catalog-equality`) | through the emit seam: a `createSurface.catalogId` differing from the payload's is refused | the suite, via the v2 emit-surface seam | seam-gated — the emit-surface seam; split from `catalog-pinned` so the corpus ledger row cannot stand in for it |
| §A.1 the schema version selects the branch (`openwop.requirement.0209.version-selects-branch`) | through the emit seam on a host with floor 2: a version-2 envelope with a `payloadV1` body, and a version-1 envelope with a `payloadV2` body, are both refused | the suite, via the v2 emit-surface seam | seam-gated — the suite cannot make a model emit a chosen envelope without the seam |
| §C.9 the fold is guarded at record time (`openwop.requirement.0209.fold-guarded`) | through the emit seam: a first envelope for a new `surfaceId` that does not begin with `createSurface` is refused, and so is a message after `deleteSurface` | the suite, via the emit seam | seam-gated — same seam |
| §C.9 no render before `root` (`openwop.requirement.0209.render-needs-root`) | — | — | unwitnessable — a render-side guarantee; the server-oriented suite cannot observe a renderer (the `a2ui-surface-no-code-exec` precedent: a reference-app client probe, `tier: reference-impl`) |
| §C.11 legacy stays readable (`openwop.requirement.0209.legacy-readable`) | on a host whose floor is 2, a run that recorded a version-1 surface (via the seam, before the floor was raised, or through a seeded log) returns it on poll, and `:fork` at a later `fromSeq` carries it unchanged | the suite, via the emit seam and `fork` | seam-gated — needs the emit seam and a host that can hold both floors across a run |
| §C.12 trust is sticky (`openwop.requirement.0209.taint-sticky`) | a surface created by a trusted envelope, then touched by an untrusted `updateComponents`, cannot advance an `approval` interrupt (`untrusted_content_blocks_approval`) | the suite, via the emit seam with a `contentTrust` control | seam-gated — as `a2ui-untrusted-blocks-approval.test.ts` is in v1 |
| §D.14 kind carve-out (`openwop.requirement.0209.kind-carve-out`) | every kind under `schemas/v2/envelopes/` is universal or in `ui.*`/`media.*`, and `events.md` states the carve-out | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by deleting the clause, and the corpus leg names the orphaned kinds |

## Alternatives considered

- **Rename to `ui.form-surface` and drop the A2UI claim** (the F-2 alternative). It is honest and cheap. But it throws away the interoperability the name was chosen for, and it still leaves v2 without a real A2UI kind.
- **Carry upstream A2UI unrestricted.** Upstream admits `openUrl`, URL-bearing media, `theme.iconUrl`, `obscured` fields and arbitrary `FunctionCall` values. Each of those breaks an Accepted OpenWOP invariant. A profile keeps renderer interoperability, because every profile message is an upstream message.
- **Keep one full snapshot per envelope and a JSON-Patch transport** (RFC 0114 in v2). It preserves "the recorded envelope is always full". But it duplicates A2UI's own incremental model with a second, generic one that must be re-validated after every patch. §C.9's fold is recorded, ordered and replayable, so it needs no side channel.
- **Replace the v2 seed in place** instead of adding a version. The seed is uncontracted in v2 and no bundle carries it, so a Class-3 replacement is defensible (arch-P4 path 2). A second version is chosen anyway. It costs one `anyOf` branch, and it keeps the version-1 tree readable for v1→v2 forks of runs recorded under v1.
- **Reserve `ui` and `media` in `declaration.json` `reservedOrgs`** instead of the prose carve-out. `reservedOrgs` means "forbidden, never registered" (`declaration.schema.json`), so reserving the orgs would not make the kinds *valid* under E3. It remains a useful companion that prevents a vendor from registering either org (register G4).
- **Do nothing.** The corpus keeps claiming A2UI compatibility it does not have, which is the RFC 0147 §A.10 claim-discipline problem F-2 names. And v2 keeps shipping a kind its own grammar invalidates.

## Unresolved questions

1. Should `Icon` join the profile? It carries a name, not a URL, but its icon vocabulary is renderer-defined. Deferred until a renderer reports on it.
2. Which pure functions beyond `required` should `checks` admit (`email`, `regex`, `length`, `numeric`)? `regex` raises ReDoS on the renderer. `validationRegexp` is already admitted, capped at 256 characters.
3. Should A2A peers exchange the version-2 payload as A2UI does ("Each A2UI envelope … corresponds to the payload of a single A2A message Part", with `mediaType: "application/a2ui+json"` per the A2UI A2A extension `https://a2ui.org/a2a-extension/a2ui/v0.9`)? This belongs with the A2A mapping registry (RFC 0208, `spec/v2/interop-map.json`), not here.
4. A2UI v1.0 is a release candidate. When it ships, is a third per-kind version the right shape, or should the profile track `catalogId` alone?

## Implementation notes (non-normative)

- The profile schema draft, the positive fixture and the Ajv harness are kept with the review notes (not committed with the RFC).
  - The harness validates the fixture against the profile and against the three upstream files (`a2ui.org`, fetched 2026-09-22).
  - All eight negatives are refused by the profile.
  - Six of them are accepted upstream.
- File-level diffs, the scenario plan and the host work are in the companion implementation plan (not committed with the RFC).

## Acceptance criteria

- [x] `Active` (2026-09-22), by steward override of RFC 0147 §A.6 (the window was waived, not run; see `Updated`).
- [x] Schema, ext README, `events.md` clause and pointer, declaration row, deprecation row and invariant rows merged. `check-v2-schemas`, `check-declaration`, `check-core-budget`, `check-security-invariants.sh` and `check-deprecations` all pass. *(The RFC 0209 spec+conformance PR, branch `feat/rfc-0209-a2ui-v09`: all five gates green; core 24,281 → 24,298 words, the stated +17; invariants 203 → 204.)*
- [x] `v2-a2ui-v09-surface.test.ts` ships in a published suite; the coherence test runs in spec-repo CI and mints its rows in the corpus ledger. Every `(corpus)` row records `executed-pass` in `evidence/corpus-ledger.json`. — **Criterion corrected 2026-09-24, because as written it could never be ticked honestly.** It asked the coherence test to "ship in a published suite"; `conformance/package.json` `files` carries `!src/coherence`, so coherence tests are deliberately NOT published — they are corpus gates that run in this repo's CI and never in a consumer's install, which is why their verdicts are `(corpus)` and are satisfied by `evidence/corpus-ledger.json` alone (RFC 0174 §B.1 rule 4). The obligation the box was for — that the rows are real and recorded — is unchanged and is met. Verified 2026-09-24 against the PUBLISHED tarball, not the checkout: `npm pack @openwop/openwop-conformance@2.37.0` carries `src/scenarios/v2-a2ui-v09-surface.test.ts` and no `src/coherence/`; all six `(corpus)` ids (`action-confined`, `catalog-pinned`, `kind-carve-out`, `no-egress-components`, `no-secret-input`, `profile-subset-of-upstream`) record `executed-pass` in the ledger.
- [ ] A committed v2 host bundle records `0209.version-selects-branch`, `.fold-guarded` and `.taint-sticky` at `executed-pass`. The expected host is the v2 reference host (tier-1), which gains envelope admission, the fold guard and the v2 emit-surface seam in this RFC's host PR. openwop-app has no v2 A2UI surface; its part is the render probe below.
- [ ] The reference-app render probe for `render-needs-root` lands next to the existing `a2ui-render-invariants.test.tsx`, as a `reference-impl` witness.
- [ ] RFC 0156 §B row: `not-reviewed` until a cross-organization review. Acceptance before that is **provisional**.
- [x] `RFCS/0102` and `RFCS/0114` headers carry `Amended by: RFC 0209 (major 2 only)`, and the RFC 0102 register rows G5/G7 are dispositioned for v2. *(Same PR; G5/G7 carry a v2 transfer to this RFC, v1 dispositions unchanged.)*

## References

- A2UI v0.9, fetched 2026-09-22. The README says "A2UI's current production release is **v0.9.1** … The v1.0 specification is a release candidate." Pinned files:
  - `https://a2ui.org/specification/v0_9/json/server_to_client.json`, sha256 `77080edd7d15077e5d345682c7bedec27b59c6df13ed3a72fd3de66318acb2d6`;
  - `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json` (`$id` = `catalogId`), sha256 `8cc94d0a482e67048f9fc989964ca5da56fe42f531d919315a508989fb22e13e`;
  - `https://a2ui.org/specification/v0_9/json/common_types.json`, sha256 `ac79788e95e5bdf0a39808953593a53c1bc9fcdcdb55480f4610613c6591e94c`;
  - `https://a2ui.org/specification/v0_9/json/client_to_server.json`, sha256 `76c9a6f54e40bbcc1ed7b36b0d56563b82122ea7f9d8379787c4afcf29cc95e0`.

  The a2ui.org copies differ from the repository's `v0.9` git tag, which predates the 0.9.1 patch. This RFC pins the served bytes.
- A2UI protocol document `specification/v0_9/docs/a2ui_protocol.md` (github.com/a2ui-project/a2ui, `main`): §"updateComponents" (adjacency list), §"UI composition" ("exactly one component with the ID `root`"), §"Defining actions" (server vs local actions), §"Data model updates", §"A2A binding". Extension spec `a2ui_extension_specification.md` (URI `https://a2ui.org/a2a-extension/a2ui/v0.9`). Apache-2.0.
- MCP 2026-07-28 `docs/specification/2026-07-28/client/elicitation.mdx` l. 30-35: form mode MUST NOT request sensitive information, "secrets and credentials that grant access" (§B.8 analogy).
- RFC 0102 (register G5, G7), RFC 0114, RFC 0197 (retirement rule), RFC 0194 (§A.6 override precedent), RFC 0156 §B, RFC 0190 §A (ext is not budgeted unless cited).
- 2026-09-22 review: slice F findings F-2 and F-3; `review/verify-EF.md` (#1, F-3); `review/arch-P4.md` findings 3, 7, 8 and 10, §2 row 4c, §4 row 1, §5 Q2, §6.4.
