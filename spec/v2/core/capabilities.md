# Discovery and Capabilities

> **Status: Stable.**

## Why this exists

A host advertises what it supports in one discovery document. Every capability family in it is one record type on a closed root, generated from one declaration file. That file also mints the pack peer-dependency identifiers and the `§` anchors below. Profiles are derived predicates, never a wire field.

## 1. One well-known resource

`/.well-known/openwop` is one resource. Its representation MUST be selected by `OpenWOP-Version`, per [`versioning.md`](versioning.md) §1.3:

- No header ⇒ the v1 document, with `protocolVersions[]` and `preferredVersion` added, through the overlap.
- `OpenWOP-Version: 2` ⇒ the closed v2 root.

A single fetch answers the major the client speaks and names the other. A v2 root MUST NOT contain a v1 sub-object; one document never carries per-major sub-objects.

### 1.1 Cache validators

A host MUST emit a standard `ETag` on the discovery document and MUST honor `If-None-Match` with `304`. The v2 representation has no `Capabilities-Etag`: the document's bytes are its negotiation identity. A host that changes semantics without changing bytes is non-conformant.

### 1.2 Removal triggers

Each `deprecations.json` row carries a `removalTrigger` (`v2.0-cut | v1-end-of-support`). The following MUST be absent from the v2 representation and MUST be removed from the v1 representation at v1 end-of-support ([`overview.md`](overview.md)):

- the wrapper (`capabilities-wrapper`);
- the dotted mirror (`host-dotted-mirror`);
- `Capabilities-Etag` (`capabilities-etag-header`).

The `/.well-known/wop` alias (`well-known-wop-alias`) carries the same trigger.

## 2. The capability record

Every family at the v2 root is one object:

```json
{ "status": "stable" | "experimental" | "deprecated",
  "since": "<major>.<minor>",
  "until": "<major>.<minor>" | "<YYYY-MM-DD>",
  "witness": "witnessable-unaided" | "witnessable-gated" | "seam-gated" | "claims-check" | "negative-existence",
  ...facets }
```

| Field | Rule |
| --- | --- |
| `status`, `since`, `witness` | MUST be present |
| `until` | REQUIRED when `status` is `experimental` or `deprecated`; MUST NOT be present when `stable` |
| `until` in the past | Non-conformant; a validator MUST answer `400` `until_in_past` |
| `witness` | MUST be one of the five wire-legal classes |
| `supported` | Not a field: the record's presence is the claim, and a host that does not support a family MUST omit it |
| facets | A facet is advertised by the presence of its key; a host MUST omit the key for a facet it does not offer, except where the facet's own schema states a meaning for its absence |

`unwitnessable` MUST NOT appear on a wire record; such a family lives in `spec/v2/ext/` and is not advertised.

A family's facets are hand-decided where `spec/v2/facets/<key>.schema.json` exists, and otherwise generated from the declaration row.

## 3. The closed root

The root of `schemas/v2/capabilities.schema.json` is `additionalProperties: false`, and `protocolVersions` and `preferredVersion` are REQUIRED. Every root key is one of:

- a metadata key (§3.1);
- a core family (§5);
- an `ext/` family (§6);
- `extensions` (§3.2).

Any other key MUST fail validation: no dotted key, no wrapper, no mirror, no root `profiles[]`.

### 3.1 Metadata keys (17)

`protocolVersion`, `protocolVersions`, `preferredVersion`, `extensions`, `implementation`, `engineVersion`, `eventLogSchemaVersion`, `configurable`, `observability`, `minClientVersion`, `runtimeCapabilities`, `testing`, `conformance`, `fixtures`, `compliance`, `discovery`, and `supportedTransports`.

- Each is declared as metadata, with its own schema, in `spec/v2/declaration.json`. A metadata key is not a record and carries no `status` or `witness`.
- `supportedTransports` is declared only to record its deletion (§4).
- The version-axis keys are specified in [`versioning.md`](versioning.md); `configurable` in [`runs.md`](runs.md).
- `implementation` (`name`, `version`, `vendor`, `url`) is self-reported: a client SHOULD NOT change behaviour because of it or authorize from it.

### 3.2 `extensions.<org>.<name>`

Vendor and host extensions live under one key, `extensions`. Its members MUST match `^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$` (short form `<org>.<name>`).

- The orgs in `spec/v2/declaration.json` `reservedOrgs` — `openwop`, `vendor`, `effect-seams` and `events` — are reserved: a host MUST NOT use any of them.
- An extension record's shape is the org's own (`additionalProperties: true` inside the record).
- The 11 extension-class families of §6 are advertised as `extensions.openwop-app.*` by the host that serves them.
- A change to an extension that would break an existing reader MUST ship under a new key.
- A host MUST NOT read one key's record as another's (A2A §4.6.3).

## 4. Deleted keys

These keys are not part of the v2 root:

| Key | Why |
| --- | --- |
| `contractProvenance` | An advisory self-declaration the wire cannot falsify |
| `supportedTransports` | REST is the wire ([`interop.md`](interop.md)) |
| `grpc` | Unwitnessable, so not advertisable ([`interop.md`](interop.md) §gRPC) |
| `Capabilities-Etag`, `auth.subjectLinking`, `replay.fork`, bare `a2a.supported` / `mcp.supported`, the `openwop-core` alias | Rows `C2.1`–`C2.10` in `spec/v1/migrations.json` give each its codemod |
| `host.media`, `host.collaboration` | A closed root cannot represent reserved slots |

`host.workspace` is the declared family `workspace`. `minimumSuiteVersion` lives in the declaration file ([`versioning.md`](versioning.md) axis 9).

## 4.1 The declaration file

`spec/v2/declaration.json` (schema `spec/v2/declaration.schema.json`) is the single source for:

- the generated `schemas/v2/capabilities.schema.json`;
- each family's `witness` class and maturity;
- the pack peer-dependency identifier, identical to the root key;
- the spec anchor (`core/capabilities.md#<key>` or `ext/<key>/`);
- the floor scenarios and requirement ids that define `openwop-core-standard`;
- the profile predicates (§7).

Operation paths live in `spec/v2/path-manifest.json` ([`versioning.md`](versioning.md)). The declaration is generated from nothing and checked against everything (`scripts/check-declaration.mjs`).

## 5. Core families (72)

Each heading below is a `spec/v2/declaration.json` row with `anchor: core`. `scripts/check-declaration.mjs` MUST fail when a heading here, a root key in the generated schema, or a pack peer-dependency identifier names a family the declaration does not. The peer-dependency identifier is identical to the key ([`packs.md`](packs.md)).

Under each heading: the family's witness class and, where `spec/v2/facets/<key>.schema.json` exists, its hand-decided facets. Maturity axes are §8; the owning RFC is the row's `owningRfc`.

### § supportedEnvelopes

Witness `witnessable-gated`. Facets: `kinds`.

### § schemaVersions

Witness `witnessable-gated`. Facets: `kinds`.

### § limits

Witness `witnessable-gated`.

### § envelopeStrictness

Witness `claims-check`. Facets: `mode`.

### § envelopeContracts

Witness `claims-check`.

### § envelopes

Witness `claims-check`.

### § prompts

Witness `witnessable-gated`.

### § nodePackRuntimes

Witness `claims-check`.

### § secrets

Witness `witnessable-gated`.

### § connections

Witness `witnessable-gated`.

### § selfHostedRunner

Witness `witnessable-gated`.

### § purposePropagation

Witness `witnessable-gated`.

### § dataResidency

Witness `witnessable-gated`.

### § anonymousActor

Witness `seam-gated`.

### § credentials

Witness `witnessable-gated`.

### § feedback

Witness `witnessable-gated`.

### § replay

Witness `witnessable-gated`. Facets: `modes`, `retention`, `effectSeamsManifest`.

### § oauth

Witness `witnessable-gated`.

### § authorization

Witness `witnessable-gated`.

### § multiPartyConversation

Witness `witnessable-gated`.

### § conversationTurnModelProvenance

Witness `witnessable-gated`.

### § channelPresence

Witness `witnessable-gated`.

### § multiAgent

Witness `claims-check`.

### § modelCapabilities

Witness `witnessable-gated`.

### § providerUsage

Witness `witnessable-gated`.

### § aiProviders

Witness `witnessable-gated`. Facets: `providers`, `byok`, `selfHosted`, `speechSynthesis`, `imageGeneration`, `videoGeneration`, `realtimeVoice`, `promptPrefixCache`, `maxInlineMediaBytes`, `authModes`, `policies`, `input`.

### § agents

Witness `witnessable-gated`.

### § memory

Witness `witnessable-gated`.

### § conversationPrimitive

Witness `claims-check`.

### § subWorkflow

Witness `claims-check`.

### § fs

Witness `witnessable-gated`.

### § kvStorage

Witness `witnessable-gated`.

### § tableStorage

Witness `witnessable-gated`.

### § queueBus

Witness `witnessable-gated`.

### § scheduling

Witness `witnessable-gated`.

### § heartbeat

Witness `witnessable-gated`. Facets: `minIntervalSec`, `maxRuntimeMs`, `deliveryChannel`.

### § toolHooks

Witness `witnessable-gated`.

### § toolCatalog

Witness `witnessable-gated`.

### § httpClient

Witness `witnessable-gated`.

### § artifactTypes

Witness `witnessable-gated`.

### § forms

Witness `claims-check`.

### § aiEnvelope

Witness `witnessable-gated`.

### § promptLibrary

Witness `claims-check`.

### § agentRuntime

Witness `claims-check`.

### § deadLetter

Witness `witnessable-gated`.

### § webhooks

Witness `witnessable-gated`. Facets: `deadLetter`, `retryPolicy`, `secretRotation`, `signatureAlgorithms`.

### § triggerBridge

Witness `witnessable-gated`.

### § a2a

Witness `seam-gated`. Facets: `versions`, `preferredVersion`, `minimumVersion`, `refreshedAt`, `profiles`, `agentCardUrl`, `streaming`, `pushNotifications`, `durableTasks`.

A facet MAY name a URL on another origin; that is a claim about the facet, not the origin. `agentCardUrl` (and `mcp.serverUrls[]`) are `format: uri` with no origin constraint.

- The advertiser knows where the card is, not that the named origin serves `/.well-known/openwop` or speaks any major.
- The suite exercises the advertiser only, and certification is per origin.

Open gap: whether a facet naming an origin that does not answer SHOULD be withdrawn, and how a client learns that origin's major.

### § budget

Witness `witnessable-gated`.

### § nondeterminismPolicy

Witness `claims-check`.

### § workspace

Witness `witnessable-gated`.

### § uiPlugins

Witness `witnessable-gated`.

### § sql

Witness `witnessable-gated`.

### § nosql

Witness `claims-check`.

### § vectorStore

Witness `witnessable-gated`.

### § searchIndex

Witness `witnessable-gated`.

### § blobStorage

Witness `witnessable-gated`.

### § cache

Witness `witnessable-gated`.

### § workflowChainPacks

Witness `witnessable-gated`. Facets: `subChains`.

### § packs

Witness `claims-check`. Facets: `testMode`.

### § mcp

Witness `seam-gated`. Facets: `revisions`, `preferredVersion`, `minimumRevision`, `refreshedAt`, `profiles`, `features`, `serverUrls`, `serverMount`, `mrtr`.

`serverUrls[]` MAY name other origins; the off-origin rule under § a2a applies.

### § sandbox

Witness `witnessable-gated`. Facets: `isolationModel`, `allowedHostCalls`, `memoryLimitBytes`, `wallClockLimitMs`.

### § compensation

Witness `seam-gated`.

### § idempotency

Witness `witnessable-gated`.

### § eventLog

Witness `claims-check`.

### § production

Witness `witnessable-gated`.

### § auth

Witness `seam-gated`. Facets: `lanes`, `subjectLinkKey`.

### § i18n

Witness `witnessable-gated`.

### § content

Witness `witnessable-gated`.

### § portability

Witness `witnessable-gated`.

### § interrupt

Witness `witnessable-gated`. Facets: `refKinds`, `tokenAlgs`, `callbackDelivery`.

### § runList

Witness `witnessable-gated`. Facets: `maxPageSize`, `filters` ([runs.md](runs.md) §List).


## 6. Extension families (13)

Rows with `anchor: ext` are documented under `spec/v2/ext/<key>/`. Each document MUST declare `witness` and both maturity axes in its header ([`overview.md`](overview.md)). The families are `restTransport`, `a2uiSurface`, `brand`, `canvas`, `chat`, `coordination`, `dataIntegration`, `entities`, `kanban`, `knowledge`, `launchStudio`, `messaging`, `webResearch`.

- `restTransport` and `a2uiSurface` (`witness: claims-check`) stay in `ext/` unless a behavioral witness lands.
- The other 11 are extension-class families, advertised as `extensions.openwop-app.<name>` (§3.2).

## 7. Profiles

A profile is a predicate over the declaration file, published in `spec/v2/profiles.json` (generated): every listed family is present as a record, and every listed metadata key is present.

| Profile | Predicate |
| --- | --- |
| `openwop-discovery-core` | Metadata `protocolVersions`, `preferredVersion` |
| `openwop-core-standard` | Families `interrupt`, `replay`, `webhooks`, `idempotency`, `eventLog`, plus the 2.0.0 floor scenarios and requirement ids the declaration names |
| `openwop-conformance-seams-v2` | The seams profile ([`conformance.md`](conformance.md)); forbidden from the capability namespace |

- The v2 root has no `profiles[]`; a host that emits one MUST fail schema validation (§3).
- The facets `auth.lanes[]` ([`identity.md`](identity.md)), `a2a.versions[]` and `mcp.revisions[]` ([`interop.md`](interop.md)) replace `auth.profiles`, `a2a.profiles`, and `mcp.profiles`.
- The discovery-only id is `openwop-discovery-core`; the `openwop-core` alias is deleted (row `C2.3`).
- The claim vocabulary is in [`overview.md`](overview.md). The invariant `profile-claim-floor-not-overstated` is registered in `SECURITY/invariants.yaml` with its test.

## 8. Maturity axes

| Axis | Values | Source |
| --- | --- | --- |
| `technical` | `experimental \| stable \| deprecated` | The record's `status`, which MUST NOT exceed the declaration row |
| `adoption` | `none \| single-witness \| multi-witness \| independent` | Derived from INTEROP-MATRIX bundle evidence |

- `stable` does not require a tier-3 host; `independent` records whether one exists.
- There is no cap on the number of families: a family MAY exist at any count if it declares its witness class.
- `memory.injectionBudget`, `toolCatalog.compactView`, and `aiProviders.promptPrefixCache` keep their families with `adoption: single-witness`.

## 9. Externally-gated

`externally-gated` is the disposition for a surface held on grounds that are neither technical nor adoption, such as a legal citation or a non-steward host tripwire.

- An externally-gated family MAY be declared with `status: experimental` and an `until` equal to the tripwire review date, or omitted.
- It MUST NOT be `stable` (`externally-gated-never-stable`).

`sandbox` is externally gated.

## 10. Migration rows

Rows `C2.1`–`C2.10` are `spec/v1/migrations.json` entries. `openwop.codemod.discovery-document-v2` transforms `C2.2`–`C2.8`: it drops a family with `supported: false` and promotes a dotted-only declared family to its plain key. Certification bundles naming `openwop-core` are never upgraded; they remain valid v1 evidence at their version.

*Sources: RFC 0144, RFC 0169, RFC 0175, RFC 0176, RFC 0179, RFC 0197. Each family's owning RFC is its `owningRfc` in [`declaration.json`](../declaration.json).*
