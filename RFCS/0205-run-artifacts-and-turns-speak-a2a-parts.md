# RFC 0205: run artifacts and conversation content speak A2A Parts

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0205                                                            |
| **Title**         | A named A2A `Artifact` / `Part` schema for `getArtifact` (negotiated by `application/a2a+json`) and for conversation turns (by `parts` presence), and media types accepted beside the reserved `exportFormats` aliases |
| **Status**        | `Active`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 (`Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply. The RFC adds two optional representations and widens one string grammar. Its single isolation sentence, §A.3, restates for the native read the outbound `url` rule that `a2a-integration.md` D.3 (RFC 0152, `Accepted`) already imposes on the same artifact over A2A. No identity, authorization, isolation, idempotency, replay, external-effect or certification rule is created or relaxed, and persisted turns are read exactly as before.) |
| **Affects**       | `spec/v2/core/runs.md` §"Annotations, artifacts, eval summary" and §"Conversation and residency capabilities" · `schemas/v2/artifact.schema.json` (new) · `schemas/v2/part.schema.json` (new) · `schemas/v2/conversation-turn.schema.json` and `schemas/v2/conversation-event.schema.json` `$defs.ConversationTurn` (optional `parts`) · `scripts/derive-v2-api.py` → `api/v2/openapi.yaml` `getArtifact` (a second response media type) · `spec/v1/artifact-type-packs.md` §"The `ArtifactType` declaration" (`exportFormats`, `export`), `schemas/artifact-type-pack-manifest.schema.json` + `schemas/v2/` twin · `spec-artifacts/` (regenerated) · conformance (two new major-2 scenarios, new legs on `artifact-type-pack-manifest-validation.test.ts`) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1, and §4 rows "New normative requirement on a previously-undefined behavior" (§A, §B) and "Looser validation accepting input that previously failed" (§C) |
| **Supersedes**    | — (amends RFC 0071 §`exportFormats` as amended by RFC 0075, and gives RFC 0005 §C's opaque `content` an optional structured sibling; neither RFC's other text changes) |
| **Superseded by** | —                                                               |

## Summary

Three OpenWOP content surfaces have no portable shape, even though the A2A shape for the same content already exists:

- the native artifact read, whose response is "Implementation-defined artifact shape";
- a conversation turn's `content`, which is "Opaque turn content";
- `exportFormats`, which uses short names in a private registry where media types exist.

This RFC mints `schemas/v2/artifact.schema.json` and `schemas/v2/part.schema.json` from A2A v1.0.1, and makes the A2A shape reachable through a **discriminator** on each surface:

- **The artifact read** answers the A2A shape when the client negotiates `application/a2a+json`.
- **A conversation turn** carries an optional `parts` array whose presence marks it as A2A-shaped.
- **`exportFormats`** accepts lowercase media types beside the reserved aliases, with an alias table. The existing `PPTX` negative still fails.

Everything is at SHOULD, and nothing that is valid today stops being valid. The discriminators exist so that a later, capability-gated RFC can require the A2A shape **on emission only**, following the RFC 0187 precedent, while readers keep accepting old shapes on replay.

## Motivation

**Two shapes for one artifact.**
- `a2a-integration.md` D.3 defines exactly how an OpenWOP artifact projects to A2A: `Artifact { artifactId (REQUIRED), name?, description?, parts[] (REQUIRED), metadata?, extensions[] }`, with a member-presence `Part` table.
- The native read of the same artifact is unspecified: `api/openapi.yaml:1810` and `api/v2/openapi.yaml:2352` say `description: Implementation-defined artifact shape.`, and `spec/v2/core/runs.md:115` says "`getArtifact` returns the artifact as an implementation-defined JSON object."

So a client that already decodes A2A artifacts has to learn one private shape per host to read the same object from its origin. `artifact-auth.test.ts` asserts only the 401 path, so nothing pins the body today (verify-EF F-4).

**Turn content that no one can render across hosts.**
- `conversation-turn.schema.json:31-33` says: "Opaque turn content. Protocol does not standardize the shape … Pass-through for any JSON value."
- A multi-party transcript replayed on another host, or projected to an A2A `Message` (`{messageId, role, parts[] REQUIRED}`), has nothing portable to carry (verify-EF F-7).

**A private format registry.**
- `artifact-type-packs.md:76` reserves `pdf`, `pptx`, … `dxf` as identifiers and forbids a `/` by pattern (`artifact-type-pack-manifest.schema.json:146`), while the same document's `rendering.mimeType` is already a media type.
- A2A `AgentSkill.outputModes` and `Part.mediaType`, and MCP `mimeType`, all negotiate on media types (verify-EF F-6).

**Why the architect review requires discriminators.** Phase 3 architect finding M2 notes that "a bare 'SHOULD be A2A Artifact' leaves nothing for [the] 'suite detects both shapes' requirement to key on". Each surface therefore gets an explicit, machine-checkable marker of which shape it is carrying. Phase 4 finding 3 (replay) adds the other constraint: any later MUST binds emission only.

## Proposal

### §A The artifact read

1. `getArtifact` (`GET /runs/{runId}/artifacts/{artifactId}`) gains a second response media type, `application/a2a+json`. Its body is an A2A `Artifact` as defined by `schemas/v2/artifact.schema.json` (§D). A host SHOULD serve it when the request's `Accept` prefers it (RFC 9110 §12.5.1). A host that does not MAY ignore the preference and answer `application/json` as today, and that answer's shape stays implementation-defined.

2. **The discriminator is the response `Content-Type`.** A `200` whose `Content-Type` is `application/a2a+json` MUST have a body that validates against `schemas/v2/artifact.schema.json`, and its `artifactId` MUST equal the `{artifactId}` path segment.
   - When a host negotiates, it SHOULD send `Vary: Accept` (RFC 9110 §12.5.5).
   - For an artifact of a registered type, it SHOULD carry the type identity in the `metadata.openwop.*` namespace that `a2a-integration.md` already uses: `metadata.openwop.artifactTypeId` and `metadata.openwop.schemaVersion`. The artifact's JSON payload goes in a `data` Part with `mediaType: "application/json"`.

3. A `url` Part in such a body MUST NOT resolve beyond the caller's `artifacts:read` authorization. This is the outbound `url` rule of `a2a-integration.md` D.3 ("MUST NOT be a pre-signed URL into host-internal storage that leaks beyond the caller's authorization"), applied to the same artifact's native read. A `raw` Part is bounded by host policy, as in D.3.

4. This RFC changes nothing in v1. The v1 `getArtifact` keeps its single `application/json` response. The v2 operation is derived from v1 (`scripts/derive-v2-api.py`), so the second media type is added there as a v2-only rule, the way RFC 0188 added its read.

### §B The conversation turn

5. `schemas/v2/conversation-turn.schema.json` and its mirror `schemas/v2/conversation-event.schema.json` `$defs.ConversationTurn` gain an OPTIONAL property `parts`: a non-empty array of `schemas/v2/part.schema.json`. **The discriminator is presence of `parts`.** A turn that carries `parts` is A2A-shaped. `messageId`, `role` (`user` → `ROLE_USER`, `agent` → `ROLE_AGENT`) and `parts` then project to an A2A `Message`. A `system` turn has no A2A role, and this RFC defines no projection for it (Unresolved question 2).

6. A producer SHOULD emit `parts`. When it does, it SHOULD keep `content` displayable by consumers that predate this RFC, for example as the concatenated `text` Parts. `content` stays REQUIRED and opaque; this RFC does not constrain it.

7. A turn without `parts` remains valid on emission, on read, on replay and on fork, for the life of the major. This RFC changes no rule about how a recorded turn is read. `persistence.md`'s era rules and RFC 0185's vendor hatch are untouched.

8. This RFC changes nothing in v1. The v1 turn schema is open (`additionalProperties: true`). Declaring a `parts` property there would newly reject a v1 turn that already carries an undeclared `parts` key of another shape, and that is the stricter-validation row of `COMPATIBILITY.md` §4, which requires a safety fix. The v2 turn is closed, so no v2 turn can carry `parts` today, and adding it is purely additive.

### §C `exportFormats` accepts media types

9. An `exportFormats[]` entry, and a `host.artifactTypes.export` / `artifactTypes.export[]` entry, MAY be one of:
   - a reserved alias;
   - a `vendor.`/`x-` identifier, as today;
   - a **media type**: RFC 6838 `type/subtype`, lowercase, with no parameters.

   The schema pattern and length become:

   ```text
   ^([a-z][a-z0-9]*|vendor\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*|x-[a-z][a-z0-9-]*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126})$
   maxLength 64 → 255
   ```

   The fourth alternative is RFC 6838 §4.2's `restricted-name "/" restricted-name`, restricted to lowercase. The length has to grow because `application/vnd.openxmlformats-officedocument.presentationml.presentation` is 73 characters.

   `PPTX` still fails. It matches no alternative: it is uppercase, has no prefix and contains no `/`. So does `Application/PDF`.

10. **Alias table (normative).** Each reserved alias names exactly one media type. All fifteen were verified against the IANA media-types registry on 2026-09-22.

    | Alias | Media type | IANA reference |
    | --- | --- | --- |
    | `pdf` | `application/pdf` | RFC 8118 |
    | `pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | vendor tree |
    | `docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | vendor tree |
    | `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | vendor tree |
    | `md` | `text/markdown` | RFC 7763 |
    | `html` | `text/html` | W3C |
    | `txt` | `text/plain` | RFC 2046 |
    | `csv` | `text/csv` | RFC 4180 |
    | `json` | `application/json` | RFC 8259 |
    | `png` | `image/png` | W3C |
    | `svg` | `image/svg+xml` | W3C |
    | `jpeg` | `image/jpeg` | RFC 2046 |
    | `step` | `model/step` | ISO TC 184/SC 4 |
    | `stl` | `model/stl` | DICOM |
    | `dxf` | `image/vnd.dxf` | vendor tree |

11. A consumer MUST treat an alias and its media type as naming the same format, both when matching a host's `export` advertisement against a type's declared `exportFormats` and when calling `host.artifactTypes.export`. A manifest SHOULD NOT list both spellings of one format. A media type outside the table SHOULD be IANA-registered or use an RFC 6838 §3 tree (`vnd.`, `prs.`, `x.`). A pack meant to install on hosts whose schema predates this RFC SHOULD keep using the aliases, which stay valid everywhere.

12. §C is written once, in `spec/v1/artifact-type-packs.md` (the declared `normativeText` of the v2 `artifactTypes` family), and binds both majors. Both manifest schemas take the §C.9 pattern.

### §D The two schemas (transcribed from A2A v1.0.1)

A2A publishes no committed JSON Schema. `specification/json/README.md` at tag v1.0.1 says `a2a.json` "is a **non-normative build artifact** derived from the canonical proto definition … intentionally **not** committed". The schemas are therefore transcribed from `specification/a2a.proto` at tag `v1.0.1`, using the JSON member names that spec §5.5 mandates ("MUST use camelCase").

- **`part.schema.json`.**
  - It follows `message Part { oneof content { text | raw | url | data }; metadata; filename; media_type }`.
  - An object with `additionalProperties: false` and `oneOf` over `required: [text]`, `[raw]`, `[url]`, `[data]`: exactly one content member (the member-presence discriminator of spec §14 "Current Pattern (v1.0)").
  - `raw` is a base64 string (a2a.proto: "In JSON serialization, this is encoded as a base64 string").
  - `url` is a URI.
  - `data` is any JSON value.
  - `metadata` is an object, and `filename` and `mediaType` are strings.
  - A legacy v0.3 `kind` member is rejected.
- **`artifact.schema.json`.** It follows `message Artifact { artifact_id REQUIRED; name; description; parts REQUIRED ("Must contain at least one part"); metadata; extensions }`. It is a closed object with `required: [artifactId, parts]`, `parts` of `minItems: 1`, and `extensions` an array of URI strings.

`oneOf` is used deliberately. The v1 `ai-envelope.md` ban on `oneOf` covers LLM-emitted *envelope payload* schemas handed to a provider's structured-output mode. These schemas describe host-emitted wire objects.

### §E v2 core text (replaces one sentence and adds one paragraph in `runs.md`)

> `getArtifact` answers `application/json` with an implementation-defined object or, when `Accept` prefers `application/a2a+json`, an A2A `Artifact` (`schemas/v2/artifact.schema.json`); a host SHOULD offer the latter. A body served as `application/a2a+json` MUST validate against that schema with `artifactId` equal to the path's, and a `url` Part in it MUST NOT resolve beyond the caller's `artifacts:read` authorization.

> A conversation turn MAY carry `parts`, a non-empty array of A2A `Part` objects (`schemas/v2/part.schema.json`); its presence marks the turn A2A-shaped. A producer SHOULD emit it and keep `content` readable by consumers that predate it. A turn without `parts` stays valid on emission, replay and fork.

**Net core-word delta: +88.** The two blocks count 97 words by `check-core-budget.mjs`'s whitespace split, and the replaced sentence was 9. No family is homed: `getArtifact` belongs to no family, and `conversationPrimitive` is already homed in `runs.md`. The delta sits under the +300 per-RFC ceiling. Homing `artifactTypes` instead would cost about 700 words against a 200-word grant (register G1).

### Forward path (non-normative)

A later RFC can, behind a capability facet, turn §A.1's SHOULD and §B.6's SHOULD into MUSTs **on emission**. The facet would be new; `artifactTypes` does not gate `getArtifact`. That is the RFC 0187 shape: "a new obligation on what a host *emits*, with the old spelling still accepted on the way in". The suite then keys on the discriminators this RFC defines: `Content-Type: application/a2a+json` for the artifact read, and presence of `parts` for a turn. §B.7's replay guarantee is not something that later RFC may narrow.

## Compatibility

**Additive.**

- **§A** adds a response media type that no host serves today, and a MUST that binds only a host that chooses to serve it. This is §4, "New normative requirement on a previously-undefined behavior". An `application/json` answer is unchanged.
- **§B** adds an OPTIONAL property to closed v2 defs. That is additive by the RFC 0183 ("new OPTIONAL properties on a closed def"), 0186 and 0188 precedent: every document valid before stays valid.
- **§C** widens a pattern and a length. That is §4, "Looser validation": the old pattern is one alternative of the new one, so every manifest that validated still validates. `PPTX` still fails.
- **No relaxation.** No `MUST` is relaxed, and no error code, status or event shape changes.
- **Strict consumers.** A consumer validating a new manifest against the *old* schema rejects a media-type entry. That is the RFC 0171 G6 strict-consumer hazard, mitigated by §C.11's SHOULD and by version pinning.
- **Suite.** The new requirement ids stay out of every floor and profile predicate.

## Conformance

- **Existing.** `artifact-auth.test.ts` (major 1; the 401 path only). `artifact-type-pack-manifest-validation.test.ts` (major 1; the `:124-128` `PPTX` negative is kept unchanged). `conversation-turn-model-provenance-shape.test.ts` and `multi-party-conversation-shape.test.ts` (major 1; string `content`, unaffected).
- **New major-2 scenario (planned): `v2-artifact-a2a-shape.test.ts`.**
  - Server-free legs over `part.schema.json` and `artifact.schema.json`.
  - A gated behavioural leg. It runs only on a host that advertises an artifact-producing conformance fixture (none does today; `artifact-auth.test.ts`'s own header says no reference host implements `getArtifact` end-to-end). It creates a run, takes `artifactId` from `artifact.created`, and requests it with `Accept: application/a2a+json`. It is `inapplicable` when the answer is `application/json`, and fails when an `application/a2a+json` body does not validate or names another `artifactId`.
- **New major-2 scenario (planned): `v2-conversation-turn-parts.test.ts`.**
  - Server-free legs over both turn defs.
  - A gated behavioural leg on hosts that advertise `conversationPrimitive` and a conversation fixture. Every `conversation.exchanged` turn that carries `parts` must validate. The leg is `inapplicable` if no turn does.
- **New legs on `artifact-type-pack-manifest-validation.test.ts`** (planned): media-type positives, and the alias-table entries validate.
- **Suite.** One minor, cut after this RFC is `Active`. `@openwop/spec-artifacts` is bumped in lockstep.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.2 an `application/a2a+json` body is an A2A `Artifact` (`openwop.requirement.0205.artifact-a2a-shape`) | a `200` with `Content-Type: application/a2a+json` whose body fails `schemas/v2/artifact.schema.json` (planned `v2-artifact-a2a-shape.test.ts`) | the suite, on a host that serves the media type and advertises an artifact-producing fixture | witnessable — gated on the host choosing `application/a2a+json` and on an artifact-producing fixture; no host qualifies today |
| §A.2 `artifactId` equals the path segment (`openwop.requirement.0205.artifact-id-matches-path`) | the body's `artifactId` differs from the requested `{artifactId}` | the suite, same gate | witnessable — gated, as above |
| §A.3 a `url` Part does not outlive the caller's authorization (`openwop.requirement.0205.artifact-url-part-scoped`) | the `url` from tenant A's artifact resolves with tenant B's credential (`OPENWOP_TEST_TENANT_B_API_KEY`) or with none | the suite, only on a host that emits `url` Parts, with a second-tenant credential | witnessable — gated on a host emitting `url` Parts and on the second-tenant harness key; the wire cannot show a leak to a party the suite does not hold |
| §B.5 `parts`, when present, is a valid `Part[]` (`openwop.requirement.0205.turn-parts-shape`) | a turn `{…, parts: [{text:'a', raw:'YQ=='}]}` (two content members) or `parts: []` fails both v2 turn defs; `[{text:'a'}]` passes (planned `v2-conversation-turn-parts.test.ts`) | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by dropping the `oneOf` from `part.schema.json` and the two-member negative passes |
| §B.5 the two turn defs stay in sync on `parts` (`openwop.requirement.0205.turn-mirror-sync`) | `conversation-turn.schema.json#/properties/parts` and `conversation-event.schema.json#/$defs/ConversationTurn/properties/parts` are deep-equal | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by adding `parts` to one file only |
| §D the schemas match A2A v1.0.1 (`openwop.requirement.0205.part-schema-upstream`) | the three A2A spec §14 "Current Pattern" examples (`{text}`, `{raw, filename, mediaType}`, `{data, mediaType}`) validate; the legacy `{kind:'text', text}` form fails | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by opening `additionalProperties` and the legacy `kind` form passes |
| §C.9 media types accepted, `PPTX` still refused (`openwop.requirement.0205.export-media-type`) | `exportFormats: ['application/pdf', 'model/step', '<pptx media type>']` validates in both manifest schemas; `['PPTX']` and `['Application/PDF']` fail | the suite, unaided (corpus) | witnessable — unaided (corpus): sabotage by leaving `maxLength: 64` (the pptx media type fails) or by making the pattern case-insensitive (`Application/PDF` passes) |
| §C.11 an alias and its media type name one format (`openwop.requirement.0205.export-alias-equivalence`) | — | — | unwitnessable — the equivalence binds a consumer's matching logic and the pack-author `host.artifactTypes.export` call, neither of which is on the wire; the advertisement half is readable but a mismatch between spellings is legal |

## Alternatives considered

- **Make the A2A shape the only v2 `getArtifact` response.** A host serving another shape would become non-conformant in a 2.x minor. That is a reshape, which the Phase 4 architect ruled cannot happen in place in 2.x (finding 1).
- **Sniff the shape** (a body with `artifactId` + `parts` is A2A). A host's implementation-defined object may legitimately contain those names, and the check could not distinguish the two. Media-type negotiation is the discriminator HTTP already has.
- **Put the A2A Part array *inside* `content`** (`content: {parts: [...]}`). `content` is opaque and persisted. Validating a `parts` member inside it would newly reject recorded turns whose opaque content happens to use that name, which is a replay hazard (Phase 4 finding 3). A sibling property on the closed v2 def cannot collide.
- **Replace the `exportFormats` aliases with media types.** This breaks every manifest in the registry (MyndHyve advertises `export: ["pdf","pptx","docx","md","png","svg"]`). An alias table keeps both spellings.
- **Mint an OpenWOP extension URI for artifact-type metadata** (`https://openwop.dev/ext/artifact-type/v1` in `Artifact.extensions`). This is a new namespace, while `metadata.openwop.*` already exists for this purpose in `a2a-integration.md` and RFC 0128. Adding it can wait until a peer needs to negotiate on it.
- **Do nothing.** Clients keep writing one decoder per host for the object A2A already defines, and the Phase 4 content MUSTs have nothing to key on.

## Unresolved questions

1. Should a v1 host be able to opt into the same negotiation? Adding a second media type to v1 `getArtifact` is additive under `COMPATIBILITY.md` §5. It is left out because v1 has taken corrections only since v2 (RFC 0182), and the v2 read is the one a later MUST would bind.
2. How should a `system` turn project to A2A, which has only `ROLE_USER` and `ROLE_AGENT`? Candidates are omitting it, or projecting it as `ROLE_AGENT` with `metadata.openwop.role: "system"`. This belongs to the A2A mapping registry (RFC 0208's `a2a.fields` Message rows), not here.
3. Should the named `Part` schema also type `conversation.opened.initialTurn` and `conversation.closed.finalTurn`? Both already `$ref` the same `ConversationTurn` def, so they inherit `parts`. Is that intended for every turn-bearing payload?
4. Should `mediaType` inside a Part be constrained to lowercase? A2A does not constrain it. This RFC accepts any RFC 6838 spelling on input and recommends lowercase on emission.

## Implementation notes (non-normative)

- The v2 OpenAPI change is a rule in `scripts/derive-v2-api.py`: after derivation, add `content['application/a2a+json'] = {schema: {$ref: '../../schemas/v2/artifact.schema.json'}}` to `getArtifact`'s `200`. `api/v2/openapi.yaml` is regenerated, never hand-edited.
- The two turn schemas carry `x-openwop-seeded-from: v1`. This RFC hand-edits both and removes the marker, so `derive-v2-schemas.mjs` never re-seeds them from the open v1 def (§B.8).
- Full schema texts, the diffs and the scenario plan are in the companion implementation plan (not committed with this RFC).
- **Sequencing.** This RFC's discriminators must land, and the RFC must be `Accepted`, before any content MUST that keys on them (the Phase 4 content-MUST RFC, gap G5). That later RFC files once this one is `Active` and flips only after this one is `Accepted`.

## Acceptance criteria

- [x] `Active` (2026-09-22, comment window waived; see `Updated`).
- [ ] `runs.md` §E text merged. `check-core-budget.mjs` stays under its cap.
- [ ] `artifact.schema.json` and `part.schema.json` land. Both turn defs gain `parts`. `getArtifact` in `api/v2/openapi.yaml` lists `application/a2a+json`. Both manifest schemas carry §C.9.
- [ ] `artifact-type-packs.md` carries §C.9–§C.11 and the alias table.
- [ ] Every corpus row in the falsifiability table records `executed-pass` in a published suite.
- [ ] At least one host (MyndHyve, which advertises `artifactTypes` and `conversationPrimitive` in its committed v2 bundle, or the v2 reference host) records `0205.artifact-a2a-shape` or `0205.turn-parts-shape` `executed-pass` on a behavioural leg. Otherwise the RFC records why no host does and is accepted on the corpus rows (tier: corpus gate).
- [ ] The CHANGELOG entry is in, and the `RFCS/0071` and `RFCS/0005` headers carry `Amended by` pointers.

## References

- A2A v1.0.1:
  - `specification/a2a.proto`, `message Part` (l. 224-242) and `message Artifact` (l. 280-293), <https://raw.githubusercontent.com/a2aproject/A2A/v1.0.1/specification/a2a.proto>;
  - `docs/specification.md` §4.1.6, §4.1.7, §5.5 (camelCase MUST), §14.1.1 (`application/a2a+json`, "intended for the HTTP+JSON/REST binding") and §14 "Current Pattern (v1.0)" (member-presence discriminator);
  - `specification/json/README.md` (no committed JSON Schema).

  All fetched 2026-09-22.
- IANA Media Types registry (`application`, `text`, `image`, `model` CSVs), fetched 2026-09-22. RFC 6838 §3 (registration trees) and §4.2 (naming), <https://www.rfc-editor.org/rfc/rfc6838>. RFC 9110 §12.5.1 (`Accept`) and §12.5.5 (`Vary`).
- RFC 0005 §C (conversation turn), RFC 0071 / RFC 0075 (artifact-type packs), RFC 0152 (`a2a-integration.md` D.3), RFC 0187 (emission-narrowing precedent), RFC 0183 / 0186 / 0188 (optional property on a closed def), RFC 0171 G6.
- 2026-09-22 review: slice F findings F-4, F-6 and F-7; `review/verify-EF.md`; `review/arch-P3.md` M2; `review/arch-P4.md` findings 3 and 8 and the §4 content row.
