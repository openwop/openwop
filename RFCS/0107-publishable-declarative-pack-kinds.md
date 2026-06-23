# RFC 0107: Publishable declarative pack kinds (registry version manifest)

| Field | Value |
|---|---|
| **RFC** | 0107 |
| **Title** | Publishable declarative pack kinds — registry version manifest carries `kind` + declarative payload, `runtime` conditional |
| **Status** | `Accepted` |
| **Author(s)** | David Tufts (@davidscotttufts) |
| **Created** | 2026-06-23 |
| **Updated** | 2026-06-23 — flipped to `Accepted`; implementation landed (PR #749 → `534a25be`) and conformance reflects it (suite `1.33.0`, tag `openwop-conformance/v1.33.0`). The reference registry published the first declarative packs (`openwop-registry` PR #4 → `4dde5009`) and `packs.openwop.dev` serves them live (artifact-type + 6 connection packs; 4-tab landing). All acceptance criteria met. _Prior:_ 2026-06-23 — flipped to `Active`; 7-day comment window **waived** by the maintainer (David Tufts) under single-org bootstrap governance (`GOVERNANCE.md` — lazy consensus, maintainer-driven). Additive/backward-compatible; no objections outstanding. |
| **Affects** | `spec/v1/registry-operations.md` §"Validation flow" + §"Type-ID indexing and cross-namespace exports"; `schemas/registry-version-manifest.schema.json`; `conformance/src/scenarios/registry-public.test.ts` (+ fixtures); reference registry (`openwop-registry`) `build-index` + landing |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 |
| **Supersedes** | — |
| **Superseded by** | — |

## Summary

OpenWOP defines several **declarative** pack kinds at the source level — artifact-type packs (`kind:"artifact-type"`, RFC 0075) and connection packs (`kind:"connection"`, RFC 0095) — each with its own source manifest schema. But the **published** contract, `registry-version-manifest.schema.json` (which every `…/-/{version}.json` a registry serves MUST validate against), is node-shaped: it `require`s `runtime`, sets `additionalProperties: false`, and has no `kind` / `artifactTypes` / `provider` properties. A declarative manifest therefore cannot be published — and no registry has ever served one. This RFC extends the version-manifest contract **additively** so declarative kinds can publish: it adds a `kind` discriminator (default `"node"` when absent), the kind-specific declarative payload, and makes `runtime` required only for executable kinds.

## Motivation

The protocol already says these pack kinds exist (`spec/v1/artifact-type-packs.md`, `spec/v1/connection-packs.md`, with `schemas/artifact-type-pack-manifest.schema.json` and `schemas/connection-pack-manifest.schema.json`). A pack author can build one; a host can load one. But they hit a wall at **publication**: `registry-operations.md` §"Validation flow" → `schemas/registry-version-manifest.schema.json` rejects the manifest, because

- it `require`s `runtime` — a declarative pack ships no executor bytecode and has no `runtime` block; and
- it is `additionalProperties: false` with no `kind`, `artifactTypes`, or `provider` — so a manifest carrying those is rejected.

The spec is the right place because the version manifest is the **registry-interop contract**: any conformant registry validates published manifests against this single schema, and any consumer relies on its shape. A registry-local relaxation would fork the contract. The concrete consequence today: the reference registry (`packs.openwop.dev`) cannot list, serve, or display artifact-type or connection packs — a capability gap visible to every pack author who tries to publish one.

This is the registry-publication analogue of the source-vs-published split the spec already manages for node packs; it simply was never extended when RFC 0075 / RFC 0095 added declarative kinds.

## Proposal

### Wire shape changes

`registry-version-manifest.schema.json` gains a `kind` discriminator and the per-kind declarative payload, and makes `runtime` **conditionally** required.

```diff
 {
   "$id": "https://openwop.dev/spec/v1/registry-version-manifest.schema.json",
-  "required": ["name", "version", "engines", "runtime", "integrity"],
+  "required": ["name", "version", "engines", "integrity"],
   "additionalProperties": false,
   "properties": {
+    "kind": {
+      "type": "string",
+      "enum": ["node", "artifact-type", "connection", "workflow-chain", "prompt", "chat-card"],
+      "default": "node",
+      "description": "Pack kind discriminator. Absent ≡ \"node\" (the original, executable kind). Executable kinds (node) carry `runtime` + `nodes[]`/`agents[]`; declarative kinds carry their own payload and no `runtime`."
+    },
+    "artifactTypes": { "type": "array", "items": { "type": "object" }, "description": "Present iff kind == \"artifact-type\" (RFC 0075). Mirrors artifact-type-pack-manifest.schema.json." },
+    "provider":      { "type": "object", "description": "Present iff kind == \"connection\" (RFC 0095). Mirrors connection-pack-manifest.schema.json. MUST NOT carry credential material (RFC 0095 §B.2)." },
+    "chains":        { "type": "array", "items": { "type": "object" }, "description": "Present iff kind == \"workflow-chain\" (RFC 0013)." },
+    "prompts":       { "type": "array", "items": { "type": "object" }, "description": "Present iff kind == \"prompt\"." },
+    "cards":         { "type": "array", "items": { "type": "object" }, "description": "Present iff kind == \"chat-card\"." },
     "...": "(name, version, engines, runtime, signing, nodes, agents, integrity, publishedAt, tarballUrl, signatureUrl, deprecated, yanked, … unchanged)"
   },
+  "allOf": [
+    {
+      "comment": "Executable kinds (node, or kind absent) MUST carry runtime; declarative kinds MUST NOT.",
+      "if":   { "properties": { "kind": { "enum": ["artifact-type", "connection", "workflow-chain", "prompt", "chat-card"] } }, "required": ["kind"] },
+      "then": { "not": { "required": ["runtime"] } },
+      "else": { "required": ["runtime"] }
+    }
+  ]
 }
```

Normative prose (lands in `registry-operations.md` §"Validation flow"):

1. A published version manifest **MUST** carry a `kind` discriminator; an absent `kind` **MUST** be interpreted as `"node"` (backward compatibility — existing node manifests omit it).
2. For an **executable** kind (`node`, or `kind` absent) the manifest **MUST** carry a `runtime` block (unchanged from today). For a **declarative** kind (`artifact-type`, `connection`, `workflow-chain`, `prompt`, `chat-card`) the manifest **MUST NOT** carry `runtime`, and **MUST** carry that kind's declarative payload (`artifactTypes[]`, `provider`, `chains[]`, `prompts[]`, `cards[]` respectively).
3. A registry's **runtime-support check** (`registry-operations.md` §"Validation flow" → Required checks #7, "`runtime.language` MUST be one of …") **MUST** be skipped when `kind` is declarative — there is no `runtime` to check. All other required checks (namespace, name/version match, signature where present, integrity) apply unchanged.
4. The discovery **denormalization** (`registry-operations.md` §"Type-ID indexing" — `publishedTypeIds[]`) **SHOULD** be extended so declarative kinds surface their ids in the per-pack index (`artifactTypes[].artifactTypeId` for artifact-type; `provider.id` for connection; `chains[].chainId` for workflow-chain). Consumers **MUST** tolerate absence (older registries omit it).
5. A connection pack's published `provider` **MUST NOT** carry credential material (RFC 0095 §B.2); a registry **SHOULD** re-scan on submission (the rule already binds at source — this reaffirms it for the published manifest).

### Examples

**Positive** — an artifact-type version manifest now validates:

```json
{
  "name": "core.openwop.artifact-types", "version": "1.0.0",
  "kind": "artifact-type",
  "engines": { "openwop": ">=1.1.0 <2.0.0" },
  "artifactTypes": [ { "artifactTypeId": "doc.one-pager", "title": "One-Pager", "schema": { "type": "object" }, "export": ["pdf"] } ],
  "integrity": "sha256-…"
}
```

**Positive** — an unchanged node manifest still validates (no `kind`, `runtime` present): identical to today.

**Negative** — a declarative manifest that carries `runtime` **fails** (`then: { not: { required: ["runtime"] } }`); a node manifest that omits `runtime` **fails** (`else: { required: ["runtime"] }`) — both as today for node.

### Version axes impact

Per `version-negotiation.md`: none. This is a registry-contract schema change, not a run-event or per-event shape; no engine/event-log/runtime-pinning axis is touched.

## Compatibility

**Classification: `additive`** (`COMPATIBILITY.md` §2.1 — v1.x additive-only).

- `kind` is optional with documented default `"node"`; **every existing published node manifest validates unchanged** (absent `kind` → executable branch → `runtime` required, exactly as today).
- The new payload properties (`artifactTypes`, `provider`, `chains`, `prompts`, `cards`) are optional and only meaningful for their kind; a node manifest omits them. `additionalProperties: false` is preserved (the new keys are now declared).
- The only `required` relaxation (`runtime` removed from the top-level `required` array) is **immediately re-tightened** by the `allOf` `if/then/else`: node/absent still requires `runtime`. No node manifest loses a requirement.
- No event-type shapes, endpoint contracts, error codes, or HTTP statuses change. Registries that don't yet implement this still validate node manifests identically; they reject declarative manifests exactly as before (no regression — they just can't serve the new kinds yet).

Forward-compat guarantees: a consumer that doesn't understand `kind` treats an absent value as `node` (the default) and ignores unfamiliar payload arrays; a registry that doesn't implement this RFC is unaffected for node packs.

## Conformance

- **Existing coverage:** `conformance/src/scenarios/registry-public.test.ts` (`KNOWN_PACKS` resolves spec-canonical published manifests and validates their shape).
- **New scenarios (suite-version requirement):**
  - `registry-declarative-kinds.test.ts` — asserts a published **artifact-type** manifest (`kind:"artifact-type"`, `artifactTypes[]`, no `runtime`) and a **connection** manifest (`kind:"connection"`, `provider`, no `runtime`) each validate against `registry-version-manifest.schema.json`; and that a declarative manifest carrying `runtime` is **rejected** (negative case), via `expect(…, driver.describe('registry-operations.md §Validation flow', '…'))`.
  - Extend `registry-public.test.ts` `KNOWN_PACKS` with one published artifact-type + one connection pack once the reference registry serves them.
- **Fixtures:** add `registry-version-manifest-artifact-type.json` + `registry-version-manifest-connection.json` under `conformance/fixtures/`, catalogued in `fixtures.md`.
- **Capability gating:** none — this is a registry-contract requirement, always-on for a conformant registry. (A registry that serves no declarative packs is trivially conformant; the negative case still applies.)
- **INTEROP-MATRIX:** non-normative note that the reference registry serves declarative kinds once implemented.

## Alternatives considered

1. **Do nothing.** Declarative kinds stay unpublishable; `packs.openwop.dev` stays node/agent-only. Rejected — it strands two spec'd pack kinds (RFC 0075/0095) at the publication boundary.
2. **Registry-local schema relaxation** (extend only the reference registry's vendored copy). Rejected — forks the normative interop contract; `check-vendored-sync` would (correctly) flag drift; other registries/consumers wouldn't agree on the shape.
3. **A separate published-manifest schema per kind** (`registry-version-manifest-artifact-type.schema.json`, …). Rejected for now — multiplies the validation surface and the discovery index has to dispatch on kind anyway; a single discriminated schema (`if/then` on `kind`) keeps one contract. Logged as G2 (a per-kind `$ref` split is a viable refactor if the single schema grows unwieldy).
4. **Shoehorn declarative packs into a `runtime:{language:"remote"}` block** (as agent-only packs do). Rejected — misrepresents a declarative pack as executable and pollutes the runtime-requirement install gate (RFC 0076); a declarative pack has no runtime semantics to gate.

## Unresolved questions

1. Should the published payload arrays (`artifactTypes`, `provider`, …) be validated **inline** against the per-kind source schemas (a `$ref` into `artifact-type-pack-manifest.schema.json` etc.), or kept as loose `object` (validated at source-build time, not re-validated at the version-manifest layer)? Loose is simpler and matches how `nodes[]`/`agents[]` are carried today (loose objects in the version manifest); strict `$ref` is more rigorous. (G1)
2. Does the discovery index need a typed reverse-lookup for declarative ids (`GET /v1/packs/-/by-artifact-type/{id}` / `by-provider/{id}`), or is the per-pack `publishedTypeIds[]` denormalization extension sufficient? (G3)
3. Should `prompt` / `chat-card` kinds be in-scope now, or should this RFC land `artifact-type` + `connection` only and reserve the others (their source schemas exist but no host consumes them yet)? (G4)

## Implementation notes (non-normative)

Sequencing once Active: (1) land the schema + `registry-operations.md` prose + conformance scenario/fixtures in `openwop`; (2) re-vendor the schema into `openwop-registry`, extend `build-index` to compute declarative ids + render the kinds on the landing, and publish the reference artifact-type + connection packs (signed); (3) update `INTEROP-MATRIX`. Expected effort: small-medium (schema + one conformance scenario + registry tooling). No reference-host runtime change — this is a registry-layer contract; hosts already load these kinds.

## Acceptance criteria

- [x] `spec/v1/registry-operations.md` §"Validation flow" amended (kind discriminator + conditional runtime + skip runtime-check for declarative kinds + denormalization extension). — PR #749 (`534a25be`).
- [x] `schemas/registry-version-manifest.schema.json` updated (additive: `kind`, declarative payload props, `if/then/else` runtime conditional; `additionalProperties:false` preserved). — PR #749 (`534a25be`).
- [x] ≥1 conformance scenario covering a published artifact-type + connection manifest (positive) and a declarative-with-runtime manifest (negative); fixtures catalogued. — `conformance/src/scenarios/registry-declarative-kinds.test.ts` (8 tests), PR #749; suite `1.33.0` (tag `openwop-conformance/v1.33.0`).
- [x] `CHANGELOG.md` entry under the appropriate v1.x minor. — PR #749, conformance suite `1.32.0 → 1.33.0`.
- [x] Reference registry (`openwop-registry`) re-vendors the schema, serves a published artifact-type + connection pack, and the landing surfaces the kinds. — `openwop-registry` PR #4 (`4dde5009`): re-vendored schema + `build-index` 4-tab landing + 7 signed declarative packs (`core.openwop.artifact-types` + 6 `core.openwop.connections.*`), `registry-check` green (96 packs). Live on `packs.openwop.dev` — manifests + `.sig` served (HTTP 200), landing shows Node 58 · Agent 5 · Artifact-type 1 · Connection 6. First non-node packs ever published.

## References

- RFC 0075 — Artifact-type packs (real-world amendment). `RFCS/0075-artifact-type-packs-realworld-amendment.md`
- RFC 0095 — Connection packs — portable provider definitions. `RFCS/0095-connection-packs-portable-provider-definitions.md`
- RFC 0013 — Workflow-chain packs. RFC 0076 — Runtime-requirement install gate.
- `spec/v1/registry-operations.md` §"Validation flow", §"Type-ID indexing and cross-namespace exports"; `spec/v1/node-packs.md` §"Registry".
- `schemas/{registry-version-manifest,artifact-type-pack-manifest,connection-pack-manifest}.schema.json`.
- `conformance/src/scenarios/registry-public.test.ts`.
- Prior art: npm registry (package metadata is `type`-agnostic; a manifest is validated structurally, not assumed to be one shape); OCI image-spec (a `mediaType` discriminator on the manifest selects the payload schema).
