# Discovery and Capabilities

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0169, 0176, 0179.**

## Why this exists

v1 discovery had 91 root properties on an open root, `supported` in four shapes, and four machine registries with no schema of their own. v2 has one capability record type on a closed root, generated from one declaration file that also mints pack peer-dependency identifiers and the `§` anchors below. Profiles are derived predicates, never a wire field.

## 1. One well-known resource (RFC 0176 §C.1)

`/.well-known/openwop` is one resource. Its representation MUST be selected by `OpenWOP-Version` per `versioning.md` §1.3: no header ⇒ the v1 document (with `protocolVersions[]` and `preferredVersion` additive) through the overlap; `OpenWOP-Version: 2` ⇒ the closed v2 root. A single fetch answers the major the client speaks and names the other. A v2 root MUST NOT contain a v1 sub-object; per-major sub-objects in one document are not adopted.

### 1.1 Cache validators

A host MUST emit a standard `ETag` on the discovery document and MUST honor `If-None-Match` with `304`. `Capabilities-Etag` is absent from the v2 representation; the document's bytes are its negotiation identity, and a host that changes semantics without changing bytes is non-conformant.

### 1.2 Removal triggers (RFC 0176 §C.2)

`deprecations.json` rows carry `removalTrigger` (`v2.0-cut | v1-end-of-support`). The wrapper (`capabilities-wrapper`), the dotted mirror (`host-dotted-mirror`), and `Capabilities-Etag` (`capabilities-etag-header`) MUST be absent from the v2 representation at the cut and MUST be removed from the v1 representation at v1 end-of-support (`overview.md`). The `/.well-known/wop` alias (`well-known-wop-alias`) carries the same trigger.

## 2. The capability record (RFC 0169 §A)

Every family at the v2 root is one object:

```json
{ "status": "stable" | "experimental" | "deprecated",
  "since": "<major>.<minor>",
  "until": "<major>.<minor>" | "<YYYY-MM-DD>",
  "witness": "witnessable-unaided" | "witnessable-gated" | "seam-gated" | "claims-check" | "negative-existence",
  ...facets }
```

| Rule | Requirement |
| --- | --- |
| Required | `status`, `since`, `witness` MUST be present |
| `until` | REQUIRED when `status` is `experimental` or `deprecated`; MUST NOT be present when `stable` |
| `until` in the past | non-conformant; a validator MUST answer `400` `until_in_past` |
| `witness` | MUST be one of the five wire-legal classes; `unwitnessable` MUST NOT appear on a wire record — such a family lives in `spec/v2/ext/` and is not advertised |
| `supported` | does not exist; presence of the record is the claim, and a host that does not support a family MUST omit it |
| facets | the named per-family fields; `aiProviders.providers[]` carries the v1 `supported` list |

`until` absorbs v1 `tier` / `experimentalUntil`. A family's facets are hand-decided where `spec/v2/facets/<key>.schema.json` exists and otherwise generated from the declaration row.

## 3. The closed root (RFC 0169 §A.1a, §A.4)

The root of `schemas/v2/capabilities.schema.json` is `additionalProperties: false`; `protocolVersions` and `preferredVersion` are REQUIRED. Every root key is one of: a metadata key (§3.1), a core family (§5), an `ext/` family (§6), or `extensions` (§3.2). Any other key MUST fail validation: no dotted key, no wrapper, no mirror, no root `profiles[]`.

### 3.1 Metadata keys (17)

`protocolVersion`, `protocolVersions`, `preferredVersion`, `extensions`, `implementation`, `engineVersion`, `eventLogSchemaVersion`, `configurable`, `observability`, `minClientVersion`, `runtimeCapabilities`, `testing`, `conformance`, `fixtures`, `compliance`, `discovery`, and `supportedTransports`. Each is declared as metadata with its own schema in `spec/v2/declaration.json`; a metadata key is not a record and carries no `status` or `witness`. `supportedTransports` is declared only to record its deletion (§4). Version-axis metadata are specified in `versioning.md`; `configurable` in `runs.md`.

### 3.2 `extensions.<org>.<name>`

Vendor and host extensions live under one key, `extensions`, whose members MUST match `^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$` (short-form `<org>.<name>`). The orgs `openwop` and `vendor` are reserved: a host MUST NOT use either. An extension record's shape is the org's own (`additionalProperties: true` inside the record). The 11 v1 extension-class `host.*` families (§6) are advertised as `extensions.openwop-app.*` by the host that serves them.

## 4. Deleted keys (RFC 0169 §A.5, §B.3; RFC 0175)

| Key | Why |
| --- | --- |
| `contractProvenance` | an advisory self-declaration the wire cannot falsify (RFC 0169 §A.5) |
| `supportedTransports` | REST is the wire; there is no transport advertisement — A2A and MCP are compositions advertised by their own facets (RFC 0175 §B.1) |
| `grpc` | `witness: unwitnessable` (the suite ships no client); an unwitnessable family is not advertisable and its text moves to `spec/v2/ext/grpc-transport/` (RFC 0175 §A.1) |
| `Capabilities-Etag`, `auth.subjectLinking`, `replay.fork`, bare `a2a.supported` / `mcp.supported`, the `openwop-core` alias | absent from the v2 root; rows `C2.1`–`C2.10` in `spec/v1/migrations.json` carry each with its codemod |
| `host.media`, `host.collaboration` | reserved slots are unrepresentable under a closed root; `host.workspace` is the declared family `workspace` |

`minimumSuiteVersion` is retired into the declaration file (`versioning.md` axis 9).

## 4.1 The declaration file (RFC 0169 §B)

`spec/v2/declaration.json` (schema `spec/v2/declaration.schema.json`) is the single source for: the generated `schemas/v2/capabilities.schema.json`; each family's `witness` class and maturity; the pack peer-dependency identifier (identical to the root key); the spec anchor (`core/capabilities.md#<key>` or `ext/<key>/`); the floor scenarios and requirement ids that define `openwop-core-standard`; and the profile predicates (§7). It replaces `extensions.json`, `core-standard-manifest.json`, `capability-declaration-classes.json`, and the capabilities half of `operation-path-manifest.json` (the operations half is `spec/v2/path-manifest.json`, `versioning.md`). It is generated from nothing and checked against everything (`scripts/check-declaration.mjs`).

## 5. Core families (71)

Each heading is a `spec/v2/declaration.json` row with `anchor: core`; `scripts/check-declaration.mjs` MUST fail when a heading here, a root key in the generated schema, or a pack peer-dependency identifier names a family the declaration does not. The peer-dependency identifier is identical to the key (`packs.md`). Maturity axes are §7; the sentence under each heading names the witness class, the owning RFC, and, where `spec/v2/facets/<key>.schema.json` exists, the hand-decided facets.

### § supportedEnvelopes

Witness `witnessable-gated`; owner no owning RFC (declaration row).

### § schemaVersions

Witness `witnessable-gated`; owner no owning RFC (declaration row).

### § limits

Witness `witnessable-gated`; owner no owning RFC (declaration row).

### § envelopeStrictness

Witness `claims-check`; owner no owning RFC (declaration row).

### § envelopeContracts

Witness `claims-check`; owner no owning RFC (declaration row).

### § envelopes

Witness `claims-check`; owner RFC 0030.

### § prompts

Witness `witnessable-gated`; owner RFC 0027.

### § nodePackRuntimes

Witness `claims-check`; owner RFC 0008.

### § secrets

Witness `witnessable-gated`; owner no owning RFC (declaration row).

### § connections

Witness `witnessable-gated`; owner RFC 0095.

### § selfHostedRunner

Witness `witnessable-gated`; owner RFC 0122.

### § purposePropagation

Witness `witnessable-gated`; owner RFC 0128.

### § dataResidency

Witness `witnessable-gated`; owner RFC 0129.

### § anonymousActor

Witness `seam-gated`; owner RFC 0132.

### § credentials

Witness `witnessable-gated`; owner RFC 0046.

### § feedback

Witness `witnessable-gated`; owner RFC 0056.

### § replay

Witness `witnessable-gated`; owner RFC 0140; facets `modes`, `retention`, `effectSeamsManifest`.

### § oauth

Witness `witnessable-gated`; owner RFC 0047.

### § authorization

Witness `witnessable-gated`; owner RFC 0049.

### § multiPartyConversation

Witness `witnessable-gated`; owner RFC 0101.

### § conversationTurnModelProvenance

Witness `witnessable-gated`; owner RFC 0109.

### § channelPresence

Witness `witnessable-gated`; owner RFC 0110.

### § multiAgent

Witness `claims-check`; owner RFC 0037.

### § modelCapabilities

Witness `witnessable-gated`; owner RFC 0031.

### § providerUsage

Witness `witnessable-gated`; owner RFC 0026.

### § aiProviders

Witness `witnessable-gated`; owner no owning RFC (declaration row); facets `providers`, `byok`, `selfHosted`, `speechSynthesis`, `imageGeneration`, `videoGeneration`, `realtimeVoice`, `promptPrefixCache`, `maxInlineMediaBytes`, `authModes`, `policies`, `input`.

### § agents

Witness `witnessable-gated`; owner RFC 0002.

### § memory

Witness `witnessable-gated`; owner RFC 0004.

### § conversationPrimitive

Witness `claims-check`; owner RFC 0005.

### § subWorkflow

Witness `claims-check`; owner RFC 0007.

### § fs

Witness `witnessable-gated`; owner RFC 0014.

### § kvStorage

Witness `witnessable-gated`; owner RFC 0015.

### § tableStorage

Witness `witnessable-gated`; owner RFC 0016.

### § queueBus

Witness `witnessable-gated`; owner RFC 0017.

### § scheduling

Witness `witnessable-gated`; owner RFC 0052.

### § heartbeat

Witness `witnessable-gated`; owner RFC 0060; facets `minIntervalSec`, `maxRuntimeMs`, `deliveryChannel`.

### § toolHooks

Witness `witnessable-gated`; owner RFC 0064.

### § toolCatalog

Witness `witnessable-gated`; owner RFC 0078.

### § httpClient

Witness `witnessable-gated`; owner RFC 0076.

### § artifactTypes

Witness `witnessable-gated`; owner RFC 0071.

### § forms

Witness `claims-check`; owner RFC 0137.

### § aiEnvelope

Witness `witnessable-gated`; owner RFC 0144.

### § promptLibrary

Witness `claims-check`; owner RFC 0144.

### § agentRuntime

Witness `claims-check`; owner RFC 0144.

### § deadLetter

Witness `witnessable-gated`; owner RFC 0053.

### § webhooks

Witness `witnessable-gated`; owner no owning RFC (declaration row); facets `signatureAlgorithms`.

### § triggerBridge

Witness `witnessable-gated`; owner RFC 0083.

### § a2a

Witness `seam-gated`; owner RFC 0152; facets `versions`, `preferredVersion`, `minimumVersion`, `refreshedAt`, `profiles`, `agentCardUrl`, `streaming`, `pushNotifications`, `durableTasks`.

### § budget

Witness `witnessable-gated`; owner RFC 0084.

### § nondeterminismPolicy

Witness `claims-check`; owner RFC 0085.

### § workspace

Witness `witnessable-gated`; owner RFC 0059.

### § uiPlugins

Witness `witnessable-gated`; owner RFC 0117.

### § sql

Witness `witnessable-gated`; owner RFC 0018.

### § nosql

Witness `claims-check`; owner RFC 0018.

### § vectorStore

Witness `witnessable-gated`; owner RFC 0018.

### § searchIndex

Witness `witnessable-gated`; owner RFC 0018.

### § blobStorage

Witness `witnessable-gated`; owner RFC 0019.

### § cache

Witness `witnessable-gated`; owner RFC 0019.

### § workflowChainPacks

Witness `witnessable-gated`; owner RFC 0013.

### § packs

Witness `claims-check`; owner RFC 0025.

### § mcp

Witness `seam-gated`; owner RFC 0153; facets `revisions`, `preferredVersion`, `minimumRevision`, `refreshedAt`, `profiles`, `features`, `serverUrls`, `serverMount`, `mrtr`.

### § sandbox

Witness `witnessable-gated`; owner RFC 0035; facets `isolationModel`, `allowedHostCalls`, `memoryLimitBytes`, `wallClockLimitMs`.

### § compensation

Witness `seam-gated`; owner RFC 0151.

### § idempotency

Witness `witnessable-gated`; owner RFC 0150.

### § eventLog

Witness `claims-check`; owner RFC 0036.

### § production

Witness `witnessable-gated`; owner RFC 0009.

### § auth

Witness `seam-gated`; owner RFC 0154; facets `lanes`, `subjectLinkKey`.

### § i18n

Witness `witnessable-gated`; owner no owning RFC (declaration row).

### § content

Witness `witnessable-gated`; owner RFC 0103.

### § portability

Witness `witnessable-gated`; owner RFC 0098.

### § interrupt

Witness `witnessable-gated`; owner RFC 0104; facets `refKinds`, `tokenAlgs`.

## 6. Extension families (13)

Rows with `anchor: ext` are documented under `spec/v2/ext/<key>/` and each document MUST declare `witness` and both maturity axes in its header (`overview.md`): `restTransport`, `a2uiSurface`, `brand`, `canvas`, `chat`, `coordination`, `dataIntegration`, `entities`, `kanban`, `knowledge`, `launchStudio`, `messaging`, `webResearch`. `restTransport` and `a2uiSurface` (`witness: claims-check`) stay in `ext/` unless a behavioral witness lands (RFC 0169 §C.5); the other 11 are the RFC 0144 extension-class families advertised as `extensions.openwop-app.<name>` (§3.2).

## 7. Profiles (RFC 0169 §C.1, §C.3)

A profile is a predicate over the declaration file, published in `spec/v2/profiles.json` (generated): every listed family present as a record and every listed metadata key present. No `profiles[]` exists at the v2 root; a host that emits one MUST fail schema validation (§3). `auth.profiles`, `a2a.profiles`, and `mcp.profiles` are replaced by the facets `auth.lanes[]` (`identity.md`), `a2a.versions[]` and `mcp.revisions[]` (`interop.md`).

| Profile | Predicate |
| --- | --- |
| `openwop-discovery-core` | metadata `protocolVersions`, `preferredVersion` |
| `openwop-core-standard` | families `interrupt`, `replay`, `webhooks`, `idempotency`, `eventLog` plus the 2.0.0 floor scenarios and requirement ids the declaration names |
| `openwop-conformance-seams-v2` | the seams profile (`conformance.md`); forbidden from the capability namespace |

The `openwop-core` alias is deleted (row `C2.3`); the canonical discovery-only id is `openwop-discovery-core`. The claim vocabulary is `overview.md`. The invariant `profile-claim-floor-not-overstated` is registered in `SECURITY/invariants.yaml` with its test.

## 8. Maturity axes (RFC 0169 §C.2)

| Axis | Values | Source |
| --- | --- | --- |
| `technical` | `experimental \| stable \| deprecated` | the record's `status` |
| `adoption` | `none \| single-witness \| multi-witness \| independent` | derived from INTEROP-MATRIX bundle evidence |

`stable` does not require a tier-3 host; `independent` records whether one exists. The RFC 0155 numeric extension budget is repealed: a family MAY exist at any count if it declares its witness class. At the cut, `memory.injectionBudget`, `toolCatalog.compactView`, and `aiProviders.promptPrefixCache` keep their families with `adoption: single-witness` (RFC 0169 §C.5).

## 9. Externally-gated (RFC 0169 §C.4)

`externally-gated` is the disposition for a surface held on grounds that are neither technical nor adoption (a legal citation, RFC 0121; a non-steward host tripwire, RFC 0035). An externally-gated family MAY be declared with `status: experimental` and an `until` equal to the tripwire review date, or omitted; it MUST NOT be `stable` (`externally-gated-never-stable`, a corpus gate). `sandbox` is the first row.

## 10. Migration rows (RFC 0169)

| Row | v1 | v2 |
| --- | --- | --- |
| `C2.1` | `capabilities` wrapper | none (`openwop.codemod.capabilities-wrapper-removal`) |
| `C2.2` | `host.<family>` dotted mirrors | none |
| `C2.3` | `openwop-core` | `openwop-discovery-core` |
| `C2.4` | `contractProvenance` | none |
| `C2.5` | `auth.subjectLinking` | none; advertising `saml` and `scim` lanes implies the contract (`identity.md`) |
| `C2.6` | bare `a2a.supported` / `mcp.supported` | `versions[]` / `revisions[]` facets (the codemod refuses when no array is present) |
| `C2.7` | `replay.fork` boolean | `replay.modes[]` |
| `C2.8` | the 11 extension-class `host.*` families | `extensions.<org>.<name>` |
| `C2.9` | `Capabilities-Etag` | standard `ETag` / `If-None-Match` (dual emission through the overlap) |
| `C2.10` | root `profiles[]` | none — schema-invalid |

Rows `C2.2`–`C2.8` are transformed by `openwop.codemod.discovery-document-v2`; a family with `supported: false` is dropped, and a dotted-only declared family is promoted to its plain key. Certification bundles naming `openwop-core` are never-upgraded and remain valid v1 evidence at their version.
