# `a2uiSurface` extension

> **Status: Draft · v2 extension.** Normative contract for the `ui.a2ui-surface`
> envelope kind at per-kind schema version 2 (RFC 0209), and the deprecated
> `deltaTransport` facet (RFC 0114 in v1).

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **peer-dependency id** | `a2uiSurface` |
| **advertised as** | `extensions.<org>.a2uiSurface` |
| **owning RFC** | RFC 0209 |
| **declared facets** | `deltaTransport` (deprecated) |

## Versions

`ui.a2ui-surface` has two per-kind schema versions in v2, both in
[`schemas/v2/envelopes/ui.a2ui-surface.schema.json`](../../../../schemas/v2/envelopes/ui.a2ui-surface.schema.json):

| Version | Branch | Shape |
| --- | --- | --- |
| `1`, `0` or absent | `$defs/payloadV1` | the RFC 0102 seven-component tree pinned by `catalogVersion: "0.9.1"`, unchanged from v1 |
| `2` | `$defs/payloadV2` | `{ reasoning?, version: "v0.9", catalogId, surfaceId, messages[1..64] }`: an ordered run of A2UI v0.9 server-to-client messages in the profile below |

An engine MUST validate an envelope against exactly one branch: the one for the
version that `core/events.md` §"The envelope-kind catalog" selects (the emitted
version, or the advertised one under `warn` below the floor). It MUST NOT
validate against the union: a version-2 envelope carrying a version-1 payload is
invalid, and so is the reverse. The root `anyOf` exists for tooling; a host that
asks a model to emit version 2 hands the provider `$defs/payloadV2` alone.

A host admits version 2 by advertising `schemaVersions.kinds["ui.a2ui-surface"]: 2`.
The catalog rules then apply unchanged, so a consumer that knows only version 1
refuses version 2 with `unknown_schema_version` and fails closed.

In a version-2 payload, `catalogId` is an enum of the host-pinned catalogs, today
exactly `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`. Every
message's `surfaceId` MUST equal the payload's `surfaceId`, and a
`createSurface.catalogId` MUST equal the payload's `catalogId`. The schema cannot
express either cross-field rule, so the engine checks both at admission and
refuses a violation with `envelope_invalid`.

## The profile

Every message that validates against `payloadV2.messages[]` MUST also validate
against upstream A2UI v0.9 `server_to_client.json` with the basic catalog and
`common_types.json` bound. The profile only removes; it never adds a property
A2UI lacks. Conformance vendors the upstream files, pinned by SHA-256
(`conformance/fixtures/upstream/a2ui-v0.9/`).

| Message | Profile |
| --- | --- |
| `createSurface` | `surfaceId`, `catalogId`, optional `theme` limited to `primaryColor` and `agentDisplayName` |
| `updateComponents` | `surfaceId` and `components[1..512]` from the set below |
| `updateDataModel` | as upstream: `surfaceId`, optional `path` (JSON Pointer), optional `value` |
| `deleteSurface` | as upstream |

Components, each closed and discriminated by a single-string-enum `component`:
`Text`, `TextField`, `CheckBox`, `ChoicePicker`, `DateTimeInput`, `Button`,
`Column`, `Row`, `Card`, `Divider`. A dynamic value is a literal or a `{path}`
data binding. `Column` and `Row` take static `children` id lists only.

| Excluded | Why |
| --- | --- |
| `Button.action.functionCall` (including `openUrl`) | client-side execution; `a2ui-action-confinement` |
| `FunctionCall` values, except `checks[].condition` calling `required` | code execution on the renderer; `a2ui-surface-no-code-exec` |
| `TextField.variant: "obscured"` | a surface MUST NOT solicit a secret; `a2ui-surface-no-secret-input` |
| `Image`, `Video`, `AudioPlayer`, `createSurface.theme.iconUrl` | each fetches a URL; `a2ui-surface-no-network-egress` |
| `createSurface.sendDataModel` | collected data returns only through the action below |
| `Icon` | its vocabulary is renderer-defined; deferred |
| `List`, `Tabs`, `Modal`, `Slider`, data-model templates | outside the day-one profile |

## Actions and collected data

A `Button.action` MUST be the A2UI server-event arm `{ event: { name, context? } }`
with `name` ∈ {`resume`, `exchange`}: an interrupt resume or a conversation
exchange. When a user fires one, the consumer resolves `event.context` against
the surface's data model and submits the result, as the interrupt `resumeValue`
for `resume` or as the exchanged turn's data for `exchange`. With no `context` it
submits the whole data model at `/`. It MUST NOT submit anywhere else.

A host MUST NOT emit a surface whose evident purpose is credential collection.
Collected values become a `resumeValue` in the event log, where SR-1 redaction is
a backstop, not a licence.

## The fold

A surface is identified by `(runId, surfaceId)`. Its state is the fold, in event
`sequence` order, of the `messages` of every version-2 `ui.a2ui-surface` envelope
the run recorded with that `surfaceId`, under A2UI v0.9 semantics:
`updateComponents` upserts components by `id`, `updateDataModel` replaces or
removes the value at `path`, and `deleteSurface` ends the surface.

The host MUST refuse, rather than record, an envelope that would make the fold
invalid, with `envelope_invalid`:

- the first envelope for a `surfaceId` does not begin with `createSurface`;
- `createSurface` is sent for a live `surfaceId`;
- any message follows `deleteSurface` without a new `createSurface`.

A consumer MUST NOT render the surface, or enable any action on it, until the
fold holds exactly one component with `id: "root"`. `partial: true` keeps its
per-envelope meaning; a surface's actions stay disabled until the envelope that
last touched it has finalized.

## Replay and fork

Recorded surface envelopes are returned as recorded; no surface is regenerated.
A reader MUST keep accepting version-1 envelopes on replay, fork and poll for the
life of the major, including on a host whose floor is now 2: recorded envelopes
are read, not re-admitted through the envelope-kind catalog. A fork at `fromSeq`
folds only the envelopes in `[0, fromSeq)`.

## Trust

If any envelope in a surface's fold carries `meta.contentTrust: "untrusted"`, the
whole surface is untrusted and the `untrusted_content_blocks_approval` rule
applies to every action on it: an `approval` interrupt it is bound to MUST NOT
advance. A later trusted `updateComponents` does not launder an earlier untrusted
one, and one untrusted update taints a surface a trusted node created. The SR-1
harness walks every message.

## `deltaTransport` (deprecated)

`schemas/v2/a2ui-surface-delta-frame.schema.json` and the `deltaTransport` facet
are deprecated for major 2 (`spec/v1/deprecations.json`,
`openwop.deprecation.v2-a2ui-delta-frame` and `-delta-transport-facet`). A v2 host
SHOULD NOT advertise the facet: incremental updates are version-2 envelopes
carrying `updateComponents` / `updateDataModel`, recorded and replayable by the
fold. The rows carry `removeIn: "3.0"` until RFC 0197 is `Accepted`; removal then
follows its `v2-minor` path. v1's RFC 0114 stands.

## Conformance

- `conformance/src/coherence/a2ui-v09-profile.test.ts` (corpus gate, no host): the
  profile ⊂ upstream check, each excluded affordance refused, the pinned catalog,
  the unchanged version-1 branch and the `ui.*`/`media.*` kind carve-out.
- `conformance/src/scenarios/v2-a2ui-v09-surface.test.ts` (major 2, seams-gated on
  `POST /conformance/seams/sample/a2ui/emit-surface` in `api/seams-v2.yaml`):
  version selects branch, fold guarded, catalog equality, legacy readable and
  sticky taint. A host without the seam records `inapplicable`.
- No render before `root` is a renderer guarantee the server-oriented suite cannot
  observe; it is witnessed by a reference-app client probe (`tier: reference-impl`).

The `claims-check` witness above is the discovery claim of `extensions.<org>.a2uiSurface`.
