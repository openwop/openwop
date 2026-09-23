# RFC 0203: a remote node-pack runtime may name its MCP server by its registry record

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0203                                                            |
| **Title**         | a remote node-pack runtime may name its MCP server by an inline MCP Registry record (Streamable HTTP only, no install packages, no header values), and `nodePackRuntimes` gets its v2 home |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 (filed `Draft`) · 2026-09-22 — `Draft → Active` in the filing PR. **Comment window waived** (additive, 7-day) by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation" and logged in `MAINTAINERS.md` §"Bootstrap-phase RFC waivers". RFC 0147 §A.6 does not apply: the record is carried **by value** inside the signed manifest, so the RFC adds no outbound fetch, no new egress target (the endpoint was already `runtime.entry`), no credential path, and no identity the host is asked to trust (§C.4). A by-reference form — resolving a registry entry at install — would be an external-effects RFC and is deliberately not proposed (Alternatives). · 2026-09-23 (`Active → Accepted`). **Evidence tier: corpus gate — no host tier is claimed**: every rule here is a property of the signed manifest (§A.1–§A.3), witnessed by the three `(corpus)` rows in `evidence/corpus-ledger.json` and by the registry publish validator; a host's application of §A.3 is explicitly not claimed (Falsifiability, §A.3 row), so no host bundle can witness it and none is cited. The coherence test now ships on npm (suite 2.36.0 and later). Retrospective cross-organization review under RFC 0156 §B is still owed (packs are in §B scope), so this acceptance is provisional until that review is recorded in `docs/WAIVER-RETROSPECTIVE-REGISTER.md`. |
| **Affects**       | `schemas/v2/node-pack-manifest.schema.json` (`$defs/Runtime.mcpServer`, new `$defs/McpServerRecord`) · NEW `spec/v2/core/node-pack-runtimes.md` (the `nodePackRuntimes` v2 home) · `spec/v2/declaration.json` (`nodePackRuntimes.normativeText`) · `spec/v2/errors.json` + generated `spec/v2/core/errors.md` table (`unsupported_runtime`) · `docs/normative-home-baseline.json` · `SECURITY/threat-model-node-packs.md` · conformance (one corpus-coherence test) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` (§2.1: a new optional property on a closed v2 object; every manifest valid before is valid after) |
| **Supersedes**    | — (amends RFC 0008's runtime table and RFC 0138's extension-property rule by addition; neither RFC's MUSTs change) |
| **Superseded by** | —                                                               |

## Summary

A `runtime.language: "remote"` pack names its MCP server with a bare URL (`spec/v1/node-packs.md` §"Runtime formats": "URL to an HTTP endpoint conforming to the MCP tool surface"). The MCP ecosystem already describes a server with a registry record, `server.json`, that carries a namespaced name, a version, and a typed remote endpoint. This RFC lets the runtime carry an **inline subset** of that record as a real schema field, `runtime.mcpServer`: Streamable HTTP remotes only, no `packages[]` install instructions, no header or variable values, so a signed manifest carries no install surface and no credential. It also writes the `nodePackRuntimes` family its v2 home, which self-funds the new text.

## Motivation

- **A bare URL says nothing a client can check.** No transport, no server identity, no version (review finding F-8; `review/F-content-packs-ui.md` §F-8). An MCP Registry `server.json` has all three.
- **The extension hatch is closed.** The v2 `Runtime` object is `additionalProperties: false` with no `patternProperties` (`schemas/v2/node-pack-manifest.schema.json` `$defs/Runtime`), and RFC 0138 forbids canonical handling that depends on an extension property. An `x-mcp-server-json` would be a vendor hint nobody may rely on (plan: F-8 `x-` route **dropped as WRONG**). So it is a real field or nothing.
- **`server.json` imports surface OpenWOP must not take by accident.** Its `packages[]` are npm/PyPI/OCI install instructions, and `remotes[].headers` / `variables` carry values that may be secrets (`isSecret: true` in the upstream `Input` definition). Pack content is untrusted (`spec/v2/core/packs.md` §"The manifest schema family"). A by-reference or verbatim import would make pack installation fetch and run third-party artifacts and would put credential slots in signed, published manifests (`review/arch-P3.md` P3-H8).
- **HTTP+SSE is on its way out upstream.** MCP 2026-07-28 `deprecated.mdx` lists the HTTP+SSE transport as deprecated in favour of Streamable HTTP; admitting `sse` now would pre-load a Phase 4 removal.
- **`nodePackRuntimes` has no v2 home.** Its `normativeText` is `spec/v1/node-packs.md`, so it is v1-dependent (`docs/normative-home-baseline.json` `v1Carried`). Writing the new rule in v2 without homing the family would cost core words with no grant.

## Proposal

### §A The field

1. `$defs/Runtime` in `schemas/v2/node-pack-manifest.schema.json` gains an OPTIONAL `mcpServer`, valid only when `language` is `"remote"`.
2. `mcpServer` is a `McpServerRecord`: a closed object whose every valid instance is also a valid MCP Registry `server.json` document of schema version `2025-12-11` (`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`, the latest released version on 2026-09-22; the registry's `CHANGELOG.md` shows only an unreleased Draft after it).

   | Member | Rule | Upstream `ServerDetail` |
   | --- | --- | --- |
   | `$schema` | OPTIONAL; `const` the 2025-12-11 URL | `format: uri` |
   | `name` | REQUIRED; `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`, 3–200 | same pattern and bounds, REQUIRED |
   | `description` | REQUIRED; 1–100 | REQUIRED, 1–100 |
   | `version` | REQUIRED; SemVer 2.0.0 exact (no range) | REQUIRED; ≤ 255, "SHOULD follow semantic versioning", ranges rejected |
   | `title` | OPTIONAL; 1–100 | same |
   | `websiteUrl` | OPTIONAL; `https://` URI | `format: uri` |
   | `repository` | OPTIONAL; closed `{ url, source, id?, subfolder? }` | `Repository`, `url` + `source` REQUIRED |
   | `remotes` | REQUIRED; exactly one item, closed `{ type: "streamable-http", url }`, `url` `^https://[^\s{}]+$` | `RemoteTransport` = `StreamableHttpTransport \| SseTransport` + `variables`; `url` `^https?://[^\s]+$` |
   | `packages`, `icons`, `_meta`, `headers`, `variables` | absent (closed objects) | optional upstream |

3. When `mcpServer` is present, `entry` MUST equal `mcpServer.remotes[0].url`. A manifest where it does not is invalid and fails with `pack_validation_failed`. This is a manifest-validity rule, like the array-length equality in `node-packs.md` §"`nextWorkerInputs`" — JSON Schema cannot compare two values, so the rule is stated in prose and enforced by the validator.

### §B What the record is not

4. The record is **by value**. This RFC defines no by-reference form and no registry lookup; a host installs exactly what the signed manifest says.
5. A host SHOULD NOT treat `name` as a verified identity or grant authority on it. The official registry authenticates namespaces at publication ("Publishers must prove ownership of their namespace", `official-registry-requirements.md` §"Namespace Authentication"); an inline copy carries no such proof.
6. The record carries no credential by construction (no `headers`, no `variables`). A host that authenticates to the server does so through the node's existing `requiredCredentials` (RFC 0046) or `auth` (RFC 0047) declarations, resolved by the host.

### §C The `nodePackRuntimes` home

7. `spec/v2/core/node-pack-runtimes.md` becomes the family's v2 home, restating the v1 runtime obligations (`spec/v1/node-packs.md` §"Runtime formats", §"WASM runtime") and adding §A–§B. `unsupported_runtime` — the v1 code for "a language this host cannot execute" (`node-packs.md:559`), missing from the v2 registry — is registered in `spec/v2/errors.json` (400, `statusSource: "v1 convention (node-packs.md)"`, `since: "1.0"`), so a v2 host has a registered code for the refusal v1 already allowed.

### Normative text (v2)

NEW `spec/v2/core/node-pack-runtimes.md`:

> # Node-pack runtimes
>
> > **Status: Stable · RFC 0203, RFC 0008.**
> > **Normative home:** `nodePackRuntimes`.
>
> ## Why this exists
>
> v2 carried this family only by pointing at `spec/v1/node-packs.md`. This is its v2 contract, and it lets a `remote` pack name its MCP server by an inline MCP Registry record instead of a bare URL. The shape is `$defs/Runtime` in `schemas/v2/node-pack-manifest.schema.json`.
>
> ## Languages
>
> `runtime.language` is one of `javascript`, `python`, `go`, `wasm`, `wasm-component`, `remote`. `entry` is a path inside the tarball, or, for `remote`, the URL of an MCP server the host calls as an MCP client. A host MAY refuse a language it cannot execute, at workflow registration and with `unsupported_runtime`.
>
> ## WASM
>
> A host that loads `wasm` packs MUST advertise `nodePackRuntimes.wasm` with at least one `abiVersions[]` entry (RFC 0008), and MUST reject at load a pack whose `openwop_abi_version()` is not listed. When it advertises `maxMemoryBytes` it MUST enforce it and emit `cap.breached` with `kind: "wasm-memory"` on a breach. `nodePackRuntimes.wasmComponent` advertises `wasm-component` loading; its interfaces are reserved for a later RFC.
>
> ## The MCP registry record
>
> A `remote` runtime MAY carry `mcpServer`, an inline subset of an MCP Registry `server.json` (schema `2025-12-11`): `name`, `description`, `version`, optional `title`, `websiteUrl` and `repository`, and exactly one `remotes[]` entry of `type: "streamable-http"` with an `https://` URL. It has no `packages[]`, `headers`, `variables` or `_meta`, so it carries no install instruction and no credential. `mcpServer` under any other language, or an `entry` that differs from `remotes[0].url`, makes the manifest invalid (`pack_validation_failed`). The record is by value; this contract defines no registry lookup. A host SHOULD NOT treat `name` as a verified identity: an inline record carries no proof of namespace ownership. A host that authenticates to the server does so through the node's `requiredCredentials` or `auth`.

290 words, plus 3 for the generated `errors.md` table row: **293 added − 200 for `nodePackRuntimes` homed = net +93**.

### Wire shape

```diff
 // schemas/v2/node-pack-manifest.schema.json — $defs/Runtime
   "properties": {
     "language": { … },
     "entry": { … },
     "format": { … },
     "minRuntimeVersion": { … },
-    "requires": { … }
+    "requires": { … },
+    "mcpServer": {
+      "$ref": "#/$defs/McpServerRecord",
+      "description": "RFC 0203. Inline subset of the MCP Registry server.json (2025-12-11) naming the MCP server a `remote` pack runs on. By value: the host resolves nothing from a registry. `entry` MUST equal `remotes[0].url` (node-pack-runtimes.md)."
+    }
   },
+  "if": { "properties": { "language": { "const": "remote" } } },
+  "else": { "not": { "required": ["mcpServer"] } },
   "additionalProperties": false
```

```diff
 // schemas/v2/node-pack-manifest.schema.json — $defs
+    "McpServerRecord": {
+      "type": "object",
+      "additionalProperties": false,
+      "required": ["name", "description", "version", "remotes"],
+      "description": "RFC 0203. Every valid instance validates against https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json. Excludes packages[] (install instructions), icons, _meta, and every header or variable slot, so a signed manifest carries no install surface and no credential.",
+      "properties": {
+        "$schema": { "const": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json" },
+        "name": { "type": "string", "minLength": 3, "maxLength": 200, "pattern": "^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$" },
+        "description": { "type": "string", "minLength": 1, "maxLength": 100 },
+        "version": { "type": "string", "maxLength": 255, "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$" },
+        "title": { "type": "string", "minLength": 1, "maxLength": 100 },
+        "websiteUrl": { "type": "string", "format": "uri", "pattern": "^https://" },
+        "repository": {
+          "type": "object", "additionalProperties": false, "required": ["url", "source"],
+          "properties": { "url": { "type": "string", "format": "uri" }, "source": { "type": "string" }, "id": { "type": "string" }, "subfolder": { "type": "string" } }
+        },
+        "remotes": {
+          "type": "array", "minItems": 1, "maxItems": 1,
+          "items": {
+            "type": "object", "additionalProperties": false, "required": ["type", "url"],
+            "properties": { "type": { "const": "streamable-http" }, "url": { "type": "string", "pattern": "^https://[^\\s{}]+$" } }
+          }
+        }
+      }
+    }
```

**Positive example.**

```json
"runtime": {
  "language": "remote",
  "entry": "https://mcp.acme.example/salesforce",
  "mcpServer": {
    "name": "io.github.acme/salesforce",
    "description": "Salesforce objects as MCP tools",
    "version": "1.4.2",
    "remotes": [{ "type": "streamable-http", "url": "https://mcp.acme.example/salesforce" }]
  }
}
```

**Negative examples** (each MUST fail): `remotes[0].type: "sse"`; a `packages[]` member; `remotes[0].headers: [{ "name": "Authorization", "value": "Bearer …" }]`; `remotes[0].variables`; `url: "http://…"`; `url: "https://{tenant}.acme.example/mcp"`; two `remotes[]`; `version: "^1.4.0"`; `mcpServer` under `language: "wasm"`; `entry` ≠ `remotes[0].url` (validator, not schema).

## Compatibility

**Additive.** `mcpServer` is an optional property on the closed `Runtime` object; every manifest valid before is valid after (the RFC 0183/0186/0188 precedent for closed v2 objects). A `remote` pack without `mcpServer` is unchanged. The `else` clause refuses only `mcpServer` under another language — a document that could not exist before this RFC. The homing restates v1's runtime MUSTs without relaxing any: `wasm` advertisement and ABI rejection are carried verbatim in force, and the `maxMemoryBytes` rule is scoped as the v2 facet schema already scopes it (the member is optional there). Registering `unsupported_runtime` grows a registry-backed enum, which `spec/v2/core/overview.md` §0 makes additive. v1 is untouched: v1 manifests and the v1 tree do not gain the field (G2).

## Conformance

One corpus-coherence test, `conformance/src/coherence/node-pack-mcp-server-record.test.ts` (spec-repo CI only; never in a host bundle — `spec/v2/core/conformance.md`), landing while this RFC is `Active`. It needs no host: every rule in §A is a property of the manifest.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1–A.2 the subset | `openwop.requirement.0203.mcpserver-subset` — the positive fixture validates against `schemas/v2/node-pack-manifest.schema.json` **and** its `mcpServer` validates against a vendored, sha256-pinned copy of the upstream `2025-12-11` `server.schema.json` (sha256 `3fba0959…114de0`, fetched 2026-09-22); each negative fixture above is refused | any contributor, by editing the schema | witnessable — unaided (corpus) |
| §A.1 remote only | `openwop.requirement.0203.language-remote-only` — `mcpServer` under `language: "wasm"` is refused | any contributor | witnessable — unaided (corpus) |
| §A.3 `entry` binding | `openwop.requirement.0203.entry-binding` — the reference manifest validator (`conformance/src/lib/`) refuses `entry` ≠ `remotes[0].url` with `pack_validation_failed`; the registry publish validator (openwop-registry) does the same | any contributor; a pack author at publish | witnessable — unaided (corpus) for the rule. A **host's** application of it is not claimed: v2 defines no install operation, so it would be seam-gated, and `spec/v2/core/conformance.md` forbids a seam-only MUST — the host obligation is the general "a host MUST NOT load an invalid manifest", unchanged |
| §C.7 `wasm` advertisement, ABI rejection, memory cap (restated) | the existing `wasm-pack-*` scenarios | the suite, with the Rust fixture packs | witnessable-gated — **today major 1 only**; registering them for major 2 is G3 |

**How each row can fail (sabotage):** add `"sse"` to the `remotes` `type` (the `sse` fixture is accepted → red); drop `additionalProperties: false` on the remote item (the `headers` fixture is accepted → red); relax `url` to `^https?://` (the `http://` fixture → red); delete the `if/else` (the `wasm` fixture → red); widen `description` to 200 characters (a positive fixture with 150 characters still passes our schema but **fails the upstream schema** → red on the subset leg — this is the leg that keeps the field a *subset*); remove the validator's equality check (the mismatch fixture → red).

## Alternatives considered

- **By reference** (`mcpServer: "io.github.acme/salesforce@1.4.2"`, resolved at install). Smallest manifest, and what F-8 first suggested. Rejected: install would fetch a third-party document the signature does not cover, which makes this an external-effects RFC under RFC 0147 §A.6 and an SSRF surface; a sha256 pin fixes integrity but not the fetch. Revisit only with a pin and a registry allowlist (Unresolved question 2).
- **Verbatim `server.json`.** Maximum fidelity. Rejected: it imports `packages[]` (install-and-run instructions), `headers` and `variables` (credential slots, `isSecret`), and `sse` — every hazard P3-H8 names.
- **An `x-mcp-server-json` extension property.** No schema change. Not available: `Runtime` admits no `x-` property, and RFC 0138 forbids canonical behaviour that depends on one.
- **Write the text into `packs.md` without homing `nodePackRuntimes`.** Costs ~290 core words with no grant, and leaves the family v1-dependent.
- **Do nothing.** Remote packs stay a bare URL with no transport, identity or version.

## Unresolved questions

1. Should a host advertise that it honours `mcpServer` (`nodePackRuntimes.remote`)? Nothing in §A is host behaviour beyond manifest validity, so no facet is added; a future host-side rule (e.g. version pinning at connect via `server/discover`) would need one.
2. Is a by-reference form with a sha256 pin and an operator allowlist of registries worth a separate, §A.6-class RFC?
3. When the registry releases a schema version after `2025-12-11`, does `$schema` widen to an enum (additive) or does the subset re-pin? The subset leg re-runs against each vendored version either way.
4. How does a node's `typeId` bind to an MCP tool `name` on the named server? v1 never said (`node-packs.md` §"Runtime formats"), and this RFC does not either (G4).

## Implementation notes (non-normative)

No known host loads `remote` packs today (`review/arch-P3.md`, ι row: "gap: no known remote-runtime host"), which is why every rule here is a manifest property witnessable from the corpus alone. The registry (`openwop-registry`) should add the §A.3 equality to its publish validator in the same release as the schema.

## Acceptance criteria

- [x] `Active` — 2026-09-22 (window waived; routine, not an §A.6 override).
- [x] Spec text merged: `node-pack-runtimes.md`; schema `mcpServer` + `McpServerRecord`; declaration `normativeText`; `unsupported_runtime` registered; normative-home baseline lowered (`v1Dependent` −1, `nodePackRuntimes` out of `v1Carried`). — the implementation PR (`feat/rfc-0203-runtime-server-json`); `check-v2-normative-home` 30 resolved / 42 v1-dependent; `check-core-budget` 24,575 / 29,200.
- [x] The coherence test ships, every row sabotage-proven, and `evidence/corpus-ledger.json` carries each requirement id. — `conformance/src/coherence/node-pack-mcp-server-record.test.ts`, shipped in suite 2.36.0 (published); three `executed-pass` ledger rows; eight sabotage cases recorded in the PR and `conformance/CHANGELOG.md`.
- [x] The registry publish validator enforces §A.3. — openwop-registry#73 (merged `02b7c9d1f`, 2026-09-23): `scripts/lib/remote-entry-binding.mjs` refuses `entry` ≠ `mcpServer.remotes[0].url` with `pack_validation_failed`, wired into `check-pack-manifest-schemas.mjs` and tested by `scripts/test-remote-entry-binding.mjs` in `registry-check.sh`.
- [x] CHANGELOG entry; `MAINTAINERS.md` waiver row.

## References

- MCP Registry `server.json` schema `2025-12-11`: https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json (fetched 2026-09-22; `ServerDetail`, `RemoteTransport`, `StreamableHttpTransport`, `SseTransport`, `KeyValueInput`, `Input.isSecret`, `Repository`). Changelog and requirements: https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/CHANGELOG.md (2025-12-11 is the latest dated section; "Draft (Unreleased)" above it), https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md §"Namespace Authentication".
- MCP 2026-07-28 `deprecated.mdx` (HTTP+SSE transport deprecated → Streamable HTTP): https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/deprecated.mdx
- RFC 0008 (WASM ABI §H, §K), RFC 0046, RFC 0047, RFC 0076, RFC 0138, RFC 0177 (`packs.md`), RFC 0189/0190/0191 (normative home, budget, marker).
- `spec/v1/node-packs.md` §"Runtime formats", §"WASM runtime"; `spec/v1/registry-operations.md` check #7.
- Review inputs: `review/F-content-packs-ui.md` §F-8; `review/arch-P3.md` P3-H8, ι row, P3-L2.
