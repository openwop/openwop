# RFC 0028: Prompt Library Endpoints + Prompt Pack Kind

| Field | Value |
|---|---|
| **RFC** | 0028 |
| **Title** | Prompt Library Endpoints (`/v1/prompts/*`) and Prompt Pack Kind (`kind: "prompt"`) |
| **Status** | `Draft` |
| **Author(s)** | OpenWOP Working Group |
| **Created** | 2026-05-19 |
| **Updated** | 2026-05-19 |
| **Affects** | `spec/v1/prompts.md` (extends §"Discovery & distribution") · `spec/v1/registry-operations.md` (adds prompt-pack flow) · `api/openapi.yaml` (adds 6 operations under `/v1/prompts*`) · `schemas/prompt-pack-manifest.schema.json` (NEW) · `schemas/capabilities.schema.json` (extends `prompts` block with `packsSupported`, `mutableLibrary`, `library`) · 5 new conformance scenarios · CHANGELOG |
| **Compatibility** | `additive` |
| **Supersedes** | — |

## Summary

Builds on RFC 0027 by adding (a) a REST surface for listing, fetching, and rendering `PromptTemplate`s — `GET /v1/prompts`, `GET /v1/prompts/{templateId}`, `POST /v1/prompts:render`, plus optional mutating endpoints `POST /v1/prompts` / `PUT /v1/prompts/{templateId}` / `DELETE /v1/prompts/{templateId}` — and (b) a new registry pack kind `kind: "prompt"` parallel to `kind: "node"` (RFC 0003) and `kind: "workflow-chain"` (RFC 0013), so prompt libraries can be authored once and distributed across hosts via the same signed-tarball + Ed25519 + SRI pipeline that already serves node and chain packs. The endpoints close the discovery + dispatch gap left open in RFC 0027 (which shipped the wire shape but no surface to fetch one); the pack kind closes the distribution gap (hosts today have no portable way to ship a curated prompt library).

## Motivation

RFC 0027 normates `PromptTemplate` + `PromptRef` + `capabilities.prompts` + `prompt.composed`, but a host advertising `prompts.supported: true` has no spec'd way to expose its library to a client. Three concrete consequences:

1. **Editor authoring blocked.** A workflow-builder UI that wants to populate a "Prompt picker" dropdown (per the React reference app's planned `kind: 'prompt-picker'` `ConfigField`) has nowhere to call. The list endpoint is the gating piece.
2. **Cross-host portability blocked.** A prompt library curated against the `myndhyve` reference impl can't be exported to the openwop reference workflow-engine (or vice versa) without re-authoring each template. The same problem RFC 0013 solved for editor presets exists here for prompts: the in-the-wild assets live in proprietary stores.
3. **Render reproducibility opaque.** A host's prompt composition pipeline (the 10-step assembly in RFC 0027 §"Implementation notes") is internal. Clients that want to **preview** what a node will send to the LLM — before dispatch, for debugging or human-review surfaces — have no path. The `prompt.composed` event surfaces the *post-execution* result; a `:render` preview surfaces the *pre-execution* one.

The motivating use case: a multi-agent workflow author wants to drop three `core.ai.callPrompt` nodes (`writer`, `critic`, `editor`), pick a system prompt for each from a vendor-published `vendor.acme.editorial-prompts` prompt pack, preview each composed body in the inspector with the current node-input bindings, and dispatch — all without leaving the editor. Phase A gave the editor a `PromptRef` to store. Phase B gives the editor a list of refs to choose from and a `:render` endpoint to preview them.

This RFC takes the same posture as RFC 0021 (shape first, then surface): RFC 0027 landed the wire shape; this RFC lands the surface. RFC 0029 (Phase C) layers the agent-scoped override hierarchy on top.

## Proposal

### §A — REST surface

`api/openapi.yaml` gains six operations under a new `/v1/prompts` group. All six are gated on `capabilities.prompts.supported: true`. The mutating three (`POST`, `PUT`, `DELETE`) are additionally gated on `capabilities.prompts.mutableLibrary: true`.

```yaml
paths:
  /v1/prompts:
    get:
      operationId: listPromptTemplates
      summary: List prompt templates available to the caller.
      parameters:
        - name: kind
          in: query
          schema: { type: string, enum: [system, user, few-shot, schema-hint] }
          description: Filter by PromptTemplate.kind.
        - name: tag
          in: query
          schema: { type: string }
          description: Filter to templates whose `tags[]` array contains this exact tag. Repeatable.
        - name: modelClass
          in: query
          schema: { type: string }
          description: Filter to templates whose `modelHints.modelClass` matches.
        - name: source
          in: query
          schema: { type: string, enum: [host, pack, user] }
          description: Filter by provenance.
        - name: cursor
          in: query
          schema: { type: string }
          description: Opaque pagination cursor.
        - name: limit
          in: query
          schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
      responses:
        '200':
          description: Paginated list of templates.
          content:
            application/json:
              schema:
                type: object
                required: [items]
                properties:
                  items:
                    type: array
                    items:
                      $ref: '#/components/schemas/PromptTemplate'
                  nextCursor: { type: string }
        '501':
          description: Host does not advertise `capabilities.prompts.supported: true`.
    post:
      operationId: createPromptTemplate
      summary: Create a new prompt template (mutable libraries only).
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/PromptTemplate' }
      responses:
        '201':
          description: Created. `Location` header carries the canonical URI.
        '409':
          description: A template with this `templateId@version` already exists.
        '501':
          description: Host does not advertise `capabilities.prompts.mutableLibrary: true`.

  /v1/prompts/{templateId}:
    parameters:
      - name: templateId
        in: path
        required: true
        schema: { type: string, pattern: '^[a-z0-9][a-z0-9._-]{0,127}$' }
      - name: version
        in: query
        schema: { type: string, pattern: '^\\d+\\.\\d+\\.\\d+$' }
        description: Pin to a specific version. When omitted, returns the latest version.
    get:
      operationId: getPromptTemplate
      responses:
        '200':
          description: The template.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/PromptTemplate' }
        '404':
          description: No such template (or version).
    put:
      operationId: updatePromptTemplate
      summary: Replace template body / metadata (mutable libraries only). MUST snapshot the prior version.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/PromptTemplate' }
      responses:
        '200': { description: Updated. }
        '409':
          description: Submitted `version` does not exceed the stored version (SemVer comparison).
        '501':
          description: Host does not advertise `capabilities.prompts.mutableLibrary: true`.
    delete:
      operationId: deletePromptTemplate
      responses:
        '204': { description: Deleted. }
        '403':
          description: Template is host built-in or pack-sourced (`meta.source !== "user"`) and MUST NOT be deleted.
        '501':
          description: Host does not advertise `capabilities.prompts.mutableLibrary: true`.

  /v1/prompts:render:
    post:
      operationId: renderPromptTemplate
      summary: Render a template with supplied variable bindings and return the composed body + hash. Does NOT dispatch an LLM call.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [ref, variables]
              properties:
                ref: { $ref: '#/components/schemas/PromptRef' }
                variables:
                  type: object
                  description: Variable bindings keyed by PromptVariable.name. Secret-source values MUST be supplied as `[REDACTED:<secretId>]` markers; the host resolves them via `capabilities.secrets`.
                contentTrust:
                  type: string
                  enum: [trusted, untrusted]
                  description: Aggregate trust marker for the supplied variable values, propagated through composition per RFC 0027 §E.
      responses:
        '200':
          description: Composed result.
          content:
            application/json:
              schema:
                type: object
                required: [hash, refs, variableHashes]
                properties:
                  composed: { type: string, description: "Full composed body. Present only when `capabilities.prompts.observability` is `full`." }
                  hash: { type: string, pattern: '^sha256:[0-9a-f]{64}$' }
                  refs: { type: array, items: { type: string } }
                  variableHashes:
                    type: object
                    additionalProperties: { type: string, pattern: '^sha256:[0-9a-f]{64}$' }
                  contentTrust: { type: string, enum: [trusted, untrusted] }
        '400':
          description: |
            Required variable unresolved (`prompt_variable_unresolved`) OR variable type mismatch (`prompt_variable_type_mismatch`) OR
            invalid PromptRef (`prompt_ref_invalid`).
        '404':
          description: Referenced template does not exist.
        '501':
          description: Host does not advertise `capabilities.prompts.supported: true`.
```

**Deterministic-render invariant.** Two calls to `POST /v1/prompts:render` with identical `ref` + `variables` + `contentTrust` MUST produce identical `hash` and `variableHashes` values. This is the same determinism contract `prompt.composed` carries at dispatch time (RFC 0027 §F).

**Cache semantics.** `GET /v1/prompts/{templateId}` responses SHOULD set `ETag: "<hash-of-body>"` and `Cache-Control: max-age=60` (immutable when `version` is pinned: `Cache-Control: public, max-age=31536000, immutable`). Clients MAY use conditional requests (`If-None-Match`) to revalidate cheaply. This mirrors `node-packs.md` §"Immutable artifact" semantics.

### §B — Pack kind: `prompt`

`schemas/prompt-pack-manifest.schema.json` (NEW). Peer to `node-pack-manifest.schema.json` (RFC 0003) and `workflow-chain-pack-manifest.schema.json` (RFC 0013). Pack manifest top-level `kind` field carries the literal `"prompt"`. Diff against the existing pack-kind discriminator pattern:

```diff
 {
   "name": "vendor.acme.editorial-prompts",
   "version": "1.0.0",
+  "kind": "prompt",
   "engines": { "openwop": ">=1.1.0 <2.0.0" },
+  "prompts": [
+    {
+      "templateId": "writer-system",
+      "version": "1.0.0",
+      "kind": "system",
+      "text": "You are a careful editorial writer. {{styleGuide}}",
+      "variables": [
+        { "name": "styleGuide", "type": "string", "required": false, "source": "input" }
+      ],
+      "tags": ["editorial", "writing"]
+    }
+  ]
 }
```

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://openwop.dev/spec/v1/prompt-pack-manifest.schema.json",
  "title": "PromptPackManifest",
  "type": "object",
  "additionalProperties": false,
  "required": ["name", "version", "kind", "engines", "prompts"],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^(core|vendor|community|private)\\.[a-z][a-z0-9_-]*(\\.[a-z][a-zA-Z0-9_-]*)+$",
      "minLength": 1,
      "maxLength": 256
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$"
    },
    "kind": { "type": "string", "const": "prompt" },
    "description": { "type": "string", "maxLength": 1024 },
    "author": { "type": "string" },
    "license": { "type": "string" },
    "homepage": { "type": "string", "format": "uri" },
    "repository": { "type": "string", "format": "uri" },
    "keywords": { "type": "array", "items": { "type": "string", "maxLength": 64 }, "maxItems": 50 },
    "engines": {
      "type": "object",
      "required": ["openwop"],
      "properties": { "openwop": { "type": "string" } },
      "additionalProperties": true
    },
    "dependencies": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "Other prompt packs (or node/workflow-chain packs) whose templates this pack's templates reference (e.g., via `extends:` semantics introduced in a follow-up RFC, or via cross-pack `PromptRef.libraryId` lookups). Map of pack name → SemVer range. Install-time validation MUST resolve every entry before accepting the install; an unresolvable entry rejects with `prompt_pack_dependency_unresolvable`. Shape mirrors `workflow-chain-pack-manifest.schema.json#/properties/dependencies` (RFC 0013)."
    },
    "prompts": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "https://openwop.dev/spec/v1/prompt-template.schema.json" },
      "description": "PromptTemplate entries (per RFC 0027 §A). Each MUST have a unique (templateId, version) pair within the pack."
    },
    "signing": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "publicKeyRef": { "type": "string" },
        "signatureRef": { "type": "string" },
        "method": { "type": "string", "enum": ["manual", "sigstore"] }
      }
    }
  }
}
```

**Pack-kind discriminator invariant.** A manifest with both `prompts[]` and any other top-level kind-specific array (`nodes[]`, `chains[]`, `agents[]`) MUST be rejected with `pack_kind_invalid`. Same posture as RFC 0013 §"Negative example (rejected at manifest validation)".

**Install-time validation.** When a host installs a prompt pack:

1. Verify Ed25519 signature per `registry-operations.md` §"Signature verification" (same flow as node/chain packs — no new crypto surface).
2. Verify SRI integrity per `registry-operations.md` §"Subresource Integrity" (unchanged).
3. Compile each `prompts[].text` against `prompt-template.schema.json` and assert variable-reference closure (every `{{varName}}` in `text` MUST appear in `variables[]` OR be a documented context key — TBD per RFC 0027 Q3).
4. Reject install with `prompt_template_invalid` on any of the above.

**Conflict resolution.** When two installed prompt packs ship the same `templateId`, the host MUST surface both in `GET /v1/prompts` with distinct `meta.source.packName` (extension to `PromptTemplate.meta` introduced in §C below). Clients disambiguate by passing the full `PromptRef` object form (`{ libraryId, templateId, version }`) — where `libraryId` resolves to the pack name. The stringy `"prompt:templateId@version"` form is rejected with `prompt_ref_ambiguous` when multiple packs match.

### §C — Capability extension

`schemas/capabilities.schema.json` extends the `prompts` block introduced in RFC 0027 §D with three new optional fields:

```diff
   "prompts": {
     "type": "object",
     "required": ["supported"],
     "properties": {
       "supported": { "type": "boolean" },
       "templateKinds": { ... },
       "variableSources": { ... },
       "maxTemplateBytes": { ... },
       "observability": { ... },
+      "packsSupported": {
+        "type": "boolean",
+        "description": "Host installs `kind: \"prompt\"` registry packs per RFC 0028 §B. When false or absent, packs are not loaded; only host built-ins and (if `mutableLibrary`) user-created templates are visible at `GET /v1/prompts`."
+      },
+      "mutableLibrary": {
+        "type": "boolean",
+        "description": "Host honors the mutating endpoints (POST/PUT/DELETE /v1/prompts). When false or absent, those endpoints return 501. Pack-sourced and host-builtin templates are still read-only even when this is true; deletion of those is forbidden per RFC 0028 §A."
+      },
+      "library": {
+        "type": "object",
+        "additionalProperties": false,
+        "properties": {
+          "id": { "type": "string", "description": "Host's library identifier exposed at `/v1/prompts`. Single-library hosts MAY omit this." },
+          "renderEndpoint": { "type": "string", "format": "uri-reference", "description": "Absolute or relative URI of `:render` endpoint. Defaults to `/v1/prompts:render`. Useful for hosts mounting under a prefix." },
+          "maxRenderRequestBytes": { "type": "integer", "minimum": 1, "description": "Hard cap on `POST /v1/prompts:render` request body size." }
+        }
+      },
       "...": "..."
     }
   }
```

`PromptTemplate.meta` (RFC 0027 §A) gains one optional field:

```diff
   "meta": {
     "properties": {
       "author": { "type": "string" },
       "createdAt": { "type": "string", "format": "date-time" },
       "updatedAt": { "type": "string", "format": "date-time" },
-      "source": { "enum": ["host", "pack", "user"] }
+      "source": { "enum": ["host", "pack", "user"] },
+      "packName": {
+        "type": "string",
+        "description": "When `source: \"pack\"`, the installed pack's `name` (e.g., `vendor.acme.editorial-prompts`). Required when `source: \"pack\"`; absent otherwise."
+      },
+      "packVersion": {
+        "type": "string",
+        "description": "When `source: \"pack\"`, the installed pack's `version`. Required when `source: \"pack\"`; absent otherwise."
+      }
     }
   }
```

### §D — Registry index entry

`registry-operations.md` §"Index format" already lists per-pack `kind` (per RFC 0013 §"Registry distinguishes by kind in index"). Prompt packs surface in the same `/v1/index.json` with:

```json
{
  "packs": [
    {
      "name": "vendor.acme.editorial-prompts",
      "kind": "prompt",
      "latest": "1.0.0",
      "typeIds": ["writer-system", "critic-system", "editor-system"]
    }
  ]
}
```

For prompt packs, `typeIds[]` holds the pack's contributed `templateId`s — parallel to chain `chainId`s and node `typeId`s.

### §E — Security carry-forward

- **SR-1 redaction.** `:render` requests MUST carry `secret`-sourced variable values as `[REDACTED:<secretId>]` markers (matching RFC 0027 §E). The host resolves real values via `capabilities.secrets` before composition and never echoes them back in the `composed` response field. Conformance scenario `prompt-render-secret-redaction.test.ts` covers this.
- **Trust propagation.** When `:render` request carries `contentTrust: "untrusted"`, the response's `contentTrust` MUST also be `"untrusted"` and the `composed` body (if returned) MUST wrap the relevant segments in `<UNTRUSTED>...</UNTRUSTED>` markers. Same posture as RFC 0027 §E and RFC 0021 §E.
- **Pack signing.** Reuses Ed25519 + SRI from `registry-operations.md` unchanged. No new signing surface. SECURITY/invariants.yaml gains no new entries — the pack-signing invariants from RFC 0003 already cover prompt packs by construction (same signature flow, same SRI digest, same trust chain).
- **Mutating-endpoint authorization.** The `POST` / `PUT` / `DELETE` operations MUST require authentication per `spec/v1/auth.md`. Hosts SHOULD scope by writer role; the spec defers role-mapping to host policy.

## Compatibility

**Additive per `COMPATIBILITY.md §2.1`.** All claims:

- Existing endpoints: unchanged. The six new operations live under a new path group.
- Existing pack kinds: unchanged. The pack-kind discriminator (`kind: "node"` default, `kind: "workflow-chain"` per RFC 0013) gains a third literal `"prompt"`; manifests without `kind` continue to validate as node packs.
- Existing `capabilities.prompts` block (from RFC 0027): unchanged. Three new optional fields added.
- Existing `PromptTemplate.meta`: unchanged. Two new optional fields (`packName`, `packVersion`) only populated when `source: "pack"`.
- Existing client SDKs: unchanged. Clients that don't call `/v1/prompts*` operations see no behavioral change.
- Existing MUST requirements: not relaxed.

Hosts that don't advertise `capabilities.prompts.supported: true` see no behavioral change (the endpoints return 501 across the board). Hosts that advertise `supported: true` without `packsSupported` continue to serve host built-ins only.

## Conformance

Five new scenarios under `conformance/src/scenarios/`. All gated on `capabilities.prompts.supported: true`; the mutating-endpoint scenario is additionally gated on `mutableLibrary: true`; the pack scenarios are additionally gated on `packsSupported: true`.

- `prompt-list-and-fetch.test.ts` — `GET /v1/prompts` returns a paginated list; `GET /v1/prompts/{templateId}` round-trips a known template; `404` on a fabricated `templateId`; `ETag` headers present; conditional `If-None-Match` returns `304`.
- `prompt-render-deterministic.test.ts` — Two `POST /v1/prompts:render` calls with identical inputs produce identical `hash` and `variableHashes`. Different `variables` produce different `variableHashes` for the relevant keys. Different `contentTrust` produces a different `hash` even with identical variables.
- `prompt-render-secret-redaction.test.ts` — `:render` with a `secret`-source variable bound to `[REDACTED:<id>]` returns a response where the `composed` body (under `observability: "full"`) shows the marker preserved verbatim and never the plaintext secret value.
- `prompt-pack-install.test.ts` — Install a fixture prompt pack; verify Ed25519 signature; assert listed templates appear in `GET /v1/prompts` with `meta.source: "pack"`, `meta.packName`, `meta.packVersion`; assert `DELETE /v1/prompts/{templateId}` returns 403 for pack-sourced templates.
- `prompt-mutable-lifecycle.test.ts` — Create a template via `POST`; fetch via `GET`; update via `PUT` and observe `version` bumped + prior version still accessible at the pinned path; delete via `DELETE`; assert 404 thereafter.

The `behaviorGate` helper from RFC 0023 / RFC 0027 gains two predicates: `requirePromptPacksSupport()` and `requirePromptMutableLibrary()`.

A new in-tree example pack `examples/packs/prompt-sample/` ships two templates (one system, one user) and proves the manifest format is implementable end-to-end. Parallel to the workflow-chain-sample pack from RFC 0013.

## Alternatives considered

1. **Single endpoint group, no pack kind.** Ship only the REST surface; prompt distribution stays host-internal. Rejected — leaves the cross-host portability gap open. The whole rationale for separating Phase A (shape) from Phase B (surface) was to keep this RFC able to land both halves of the distribution story together; punting packs to a hypothetical RFC 0030 means hosts that adopt 0028 still can't share libraries.

2. **Pack kind, no endpoint group.** Ship only the pack format; clients fetch packs directly from the registry and resolve refs locally. Rejected — workflow-editor UX needs a list endpoint against the *host* (so the picker reflects what *this* host actually has installed), and `:render` is structurally a server-side operation (the host owns the composition pipeline + the secrets backend). The endpoints aren't optional for the picker UX.

3. **Reuse `core.*` registry namespace for prompt packs (e.g., `core.prompts.writer`).** Rejected — the `core.*` namespace is reserved per `node-packs.md` §"Naming" for spec-authoritative artifacts. Vendor and community packs use their own prefixes; the spec ships *zero* `core.*` prompt packs at this RFC's acceptance time. A future RFC MAY introduce `core.prompts.<name>` for a canonical baseline library (e.g., a `core.prompts.openwop-default-system` template), but that's out of scope here.

4. **Make `:render` a GET with query params.** Rejected — variable bindings are arbitrary JSON values that don't safely encode into URLs; trust markers and secret-source variables need request-body handling. `POST` matches the operation-style verb used elsewhere in `api/openapi.yaml` (e.g., `:fork`, `:pause`, `:resume`).

5. **Defer mutating endpoints to a separate RFC.** Rejected — the wire shape is symmetric (`POST` mirrors `GET`, `PUT` mirrors a fresh `POST`, `DELETE` is trivial), and gating them behind `mutableLibrary: false` means hosts opt in selectively. Splitting them into a third RFC creates ceremony without spec-text benefit.

## Unresolved questions

1. **Bulk operations.** Should the RFC ship `POST /v1/prompts:bulkCreate` and `POST /v1/prompts:bulkDelete` operations parallel to `:bulk-cancel` (existing `/v1/runs:bulk-cancel`)? Reference workflow-editor UX could collapse pack-import flows into one round-trip. Recommendation: defer; the loop-over-singletons approach is fine for v1.1 and ergonomics can be added in a follow-up.

2. **Server-Sent Events for `prompts.changed`.** When a host's library changes (pack installed, user template created), a long-lived editor session benefits from push notification. The existing `/v1/runs/{runId}/events` SSE is per-run; a global library-changes stream would be parallel. Recommendation: defer to a Phase D RFC; clients can poll `GET /v1/prompts` until then.

3. **Pack-to-pack `dependencies` semantics.** A prompt pack MAY declare other packs via the `dependencies` map (see §B schema, which mirrors the chain-pack precedent). Open question: what does it mean for a prompt pack to depend on another prompt pack — does it imply install-order, transitive resolution of cross-pack `PromptRef.libraryId` lookups, or eventual `extends:` template inheritance? This RFC ships the *field* and the install-time MUST that every declared dependency must resolve; the *semantics* of cross-pack composition (template inheritance, transitive `dependencies` closure) defer to a follow-up RFC. Reviewers may push to defer the field as well.

4. **`renderEndpoint` URI normalization.** The `capabilities.prompts.library.renderEndpoint` field accepts relative URIs. Should the spec require canonical absolute form, or honor the host's advertised prefix verbatim? Recommendation: honor verbatim; clients resolve relative against the discovery base URL same as elsewhere in REST endpoints.

5. **Quota / rate-limit advertisement.** Should `capabilities.prompts.library` carry per-tenant `:render` rate limits? The existing `limits` block in capabilities is for run-level quotas. Recommendation: defer; the global rate-limit middleware already exists per `spec/v1/auth.md`, and per-endpoint rates are operator-config, not protocol surface.

## Implementation notes (non-normative)

- Reference host `apps/workflow-engine/backend/typescript` MUST add a `routes/prompts.ts` route module mounting the six operations. Storage backend SHOULD reuse the host's existing key-value adapter (per `capabilities.kv` if present, or in-memory for the sample host). The pack-install path goes through the existing `registry-resolver` module (same as workflow-chain packs).
- The reference host's `:render` implementation reuses the same Mustache substitution + variable validation utility introduced for RFC 0027's `prompt.composed` emission. Single codepath; less drift risk.
- A starter example pack `examples/packs/prompt-sample/` should ship with: two templates (writer-system + critic-user), one `prompts/` source file per template, a signed manifest, and a README documenting how to install it locally for conformance runs.
- Estimated effort: schemas + spec text ~1 day; reference-host endpoints ~2 days; pack install path ~1 day; example pack ~0.5 day; five conformance scenarios ~1.5 days; CHANGELOG ~30 min. Total ~6 days plus the standard Active window (or bootstrap waiver).
- The React example app (per Part 5 of the accompanying analysis) consumes `GET /v1/prompts` from the new `usePromptsClient.ts` hook and surfaces `POST /v1/prompts:render` from a new "Preview composed prompt" button in `src/builder/inspector/Inspector.tsx`. These are non-normative implementation steps and ship separately from this RFC.

## Acceptance criteria

Promotion from `Active` → `Accepted`:

- [ ] `spec/v1/prompts.md` extended with §"Discovery & distribution" describing the endpoints + pack kind (cross-references this RFC).
- [ ] `spec/v1/registry-operations.md` extended with §"Prompt-pack install flow" (parallel to existing node-pack flow).
- [ ] `api/openapi.yaml` adds the six operations under `/v1/prompts*` per §A.
- [ ] `schemas/prompt-pack-manifest.schema.json` ships.
- [ ] `schemas/capabilities.schema.json` `prompts` block extended per §C with `packsSupported`, `mutableLibrary`, `library`.
- [ ] `schemas/prompt-template.schema.json` `meta` block extended per §C with `packName`, `packVersion`.
- [ ] Five new conformance scenarios per §"Conformance" land in `@openwop/openwop-conformance`; suite minor-version bumps.
- [ ] In-tree example pack `examples/packs/prompt-sample/` ships, install-verifies under the reference host's registry resolver.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] `INTEROP-MATRIX.md` extended with rows for `capabilities.prompts.packsSupported` and `capabilities.prompts.mutableLibrary`, alongside the RFC 0027 base row.
- [ ] Reference host (`apps/workflow-engine/backend/typescript`) advertises `capabilities.prompts.packsSupported: true` and `mutableLibrary: true`, passes all five new conformance scenarios.
- [ ] First non-steward host advertises `capabilities.prompts.supported: true` AND `packsSupported: true` (third-party validation gate per RFC 0001). MAY be waived under bootstrap-phase waiver.

## References

- `RFCS/0027-prompt-templates.md` — Phase A wire shape this RFC's endpoints and pack kind serve.
- `RFCS/0003-agent-packs.md` — `kind: "node"` pack baseline + Ed25519 signing + SRI integrity.
- `RFCS/0013-workflow-chain-packs.md` — `kind: "workflow-chain"` precedent for adding a new pack kind alongside node packs.
- `RFCS/0021-ai-envelope-primitive.md` — shape-first-then-surface precedent.
- `spec/v1/registry-operations.md` — pack-install signature + SRI flow, reused unchanged.
- `spec/v1/rest-endpoints.md` — REST URL conventions (`:render`, `:bulk-*` operation-style verbs).
- `api/openapi.yaml` — operation definitions this RFC extends.
- `RFCS/0029-prompt-override-hierarchy.md` (forthcoming) — Phase C agent-scoped override hierarchy that consumes this RFC's endpoints.
