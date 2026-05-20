# openwop Spec v1 — Prompt Templates

> **Status: DRAFT v1.x (filed via [RFC 0027](../../RFCS/0027-prompt-templates.md), 2026-05-19; first cut 2026-05-20).** Lands the wire shape for portable, versioned, variable-bound prompts referenced by workflow nodes and agent manifests. Closes the gap where `core.ai.callPrompt` config (`workflow-chain-packs.md` line 62, `host-capabilities.md` line 347) and `AgentManifest.systemPrompt | systemPromptRef` (`agent-manifest.schema.json` lines 34–41) accept inline prompt bodies but offer no shared addressing, library distribution, variable schema, or observability of the composed result. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend. Fields marked **(stable)** lock; fields marked **(in-flight)** may shift compatibly within v1.x.

---

## Why this exists

Two v1 surfaces already accept prompt bodies, but neither establishes prompt-as-a-resource:

- `workflow-chain-packs.md` line 71 demonstrates `core.ai.callPrompt` config carrying `"systemPrompt": "You are a senior PM. Write a PRD for: {{params.productIdea}}\nAudience: {{params.targetAudience}}"`. The `{{params.X}}` substitution is convention-only — no spec'd variable schema, no enumeration of allowed sources, no observability of the composed result.
- `schemas/agent-manifest.schema.json` lines 34–41 + 104–105 lock `systemPrompt XOR systemPromptRef`. Both are tarball-resident; neither can be referenced across packs or replaced at run time.

Authors who want canvas-editor patterns of (a) maintain a named, versioned prompt library, (b) reuse the same prompt across multiple nodes or workflows, (c) preview the composed body before dispatch, or (d) audit what every agent actually saw in a multi-agent run have no protocol-level surface for any of these. Host-internal libraries exist (the reference `myndhyve` impl persists `PromptEntry`/`PromptLibrary` documents in Firestore at `workspaces/{workspaceId}/prompt-libraries/{canvasTypeId}` with built-in/override/version semantics), but the values they hold cross the wire as opaque interpolated strings — losing the ID, the version, the variable schema, and the resolution chain.

This document closes the wire-shape gap. Phase A only — the **shape**, the **capability flag**, and the **observability event**. RFC 0028 lands the registry surface (`/v1/prompts/*` endpoints + `kind: "prompt"` pack distribution); RFC 0029 lands the agent-scoped resolution hierarchy + `agent.promptResolved` event.

---

## What a Prompt Template is (and is not)

A **PromptTemplate** is openwop's canonical wire format for a named, versioned, variable-bound prompt body. A PromptTemplate is a single JSON document whose top-level shape is fixed by `schemas/prompt-template.schema.json`, whose `kind` is selected from the shared `prompt-kind.schema.json` enum, whose `text` field MAY contain Mustache-compatible `{{varName}}` placeholders, and whose `variables[]` array typed-declares each placeholder.

A PromptTemplate is **distinct from `AIEnvelope`** (`ai-envelope.md`) and **distinct from `RunEventDoc`** (`run-event.schema.json`):

| Concern | `PromptTemplate` | `AIEnvelope` | `RunEventDoc` |
|---|---|---|---|
| Direction | **Authored** — host library, pack-distributed | **Inbound** — LLM → engine | **Outbound** — host → client |
| Source of truth | Host library (built-in + installed packs + user) | Single emission, recorded as `RunEventDoc` | Append-only run event log |
| Type discriminator | `kind` ∈ {system, user, few-shot, schema-hint} | Open-ended kind catalog, host-advertised | Fixed 51-variant enum, FINAL v1 |
| Lifecycle | Authored once; resolved at every node execution | Validated → gated → routed → recorded | Immutable after `appendAtomic` |
| Audience | Workflow editors, node dispatcher | Engine, node dispatcher | Clients, observability, replay |

In short: **PromptTemplates are what the host sends to the LLM. AIEnvelopes are what the LLM sends back. RunEventDocs are what the engine reports to clients.**

When a host composes a PromptTemplate for an LLM call (per the resolution chain in RFC 0029), it MAY emit a `prompt.composed` RunEventDoc capturing the composed bodies, refs, variable bindings, and content-trust marker — see §"Composition + observability" below.

---

## PromptKind

`schemas/prompt-kind.schema.json` (NEW) holds the shared `kind` enum referenced by every schema that names a prompt kind. The enum has four values:

| Kind | Composed as | Notes |
|---|---|---|
| `system` | LLM system message | Carries behavior + output discipline. Composed once per call. |
| `user` | LLM user message | The variable-substitution surface — per-call task content. |
| `few-shot` | User-message prefix (or alternating user/assistant turns per host policy) | Example bodies. Hosts MAY support multiple `few-shot` templates per node via `additionalPromptRefs`. |
| `schema-hint` | Injected into system or user message at compose time (per host policy) | Structured-output schema description (e.g., the JSON Schema the LLM is asked to populate). |

A node MAY reference one template of each kind via the convention in `workflow-definition.md` §"Prompt references on nodes."

Adding a new kind in a future RFC is a single edit to `prompt-kind.schema.json`; consumers automatically pick it up. Hosts MAY narrow the accepted kinds via `capabilities.prompts.templateKinds[]`.

---

## PromptTemplate

The canonical wire shape — see `schemas/prompt-template.schema.json` for the full schema. Required fields:

```typescript
interface PromptTemplate {
  templateId: string;     // ^[a-z0-9][a-z0-9._-]{0,127}$
  version: string;        // SemVer 2.0.0
  kind: PromptKind;       // shared enum, see above
  text: string;           // <= 65536 bytes
}
```

Optional fields: `name`, `description`, `variables`, `modelHints`, `tags`, `meta`.

### Variable interpolation

The `text` body uses **Mustache-compatible `{{varName}}` placeholders**. No control-flow logic — substitution is purely literal. Hosts MUST:

- Resolve each `{{varName}}` against the bound value (from `variables[].source`).
- Fail the node with `prompt_variable_unresolved` when a required variable has no binding.
- Render unresolved optional variables as the empty string (the `onUnresolved: 'empty'` semantics from the myndhyve reference impl).

A `{{varName}}` placeholder that has no matching entry in `variables[]` MAY appear (treated as an optional variable with source `input` and no default). Hosts SHOULD warn at install time when a placeholder lacks a corresponding declaration.

### PromptVariable

```typescript
interface PromptVariable {
  name: string;           // ^[a-zA-Z_][a-zA-Z0-9_]{0,63}$
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  source?: 'input' | 'variable' | 'secret' | 'context';  // default: 'input'
  extractPath?: string;   // JSONPath into the source
  defaultValue?: unknown; // used when required: false and source resolves to undefined
  description?: string;
}
```

The `source` value determines where the binding comes from:

- **`input`** (default) — the node's input port whose name matches `name`.
- **`variable`** — a run-scoped variable resolved via `ctx.variables.get(name)` (or `extractPath`).
- **`secret`** — a BYOK secret reference. MUST be redacted to `[REDACTED:<secretId>]` markers in any observability output (`prompt.composed` events, debug bundles) per SECURITY/threat-model-secret-leakage.md §SR-1.
- **`context`** — a host-provided implicit context value (canonical names recommended below; hosts MAY define vendor-specific keys).

#### Recommended `context` variable names (non-normative)

To improve cross-host portability of templates that use the `context` source, hosts SHOULD recognize these canonical names where the underlying value exists:

- `currentUserId` — the authenticated user dispatching the run.
- `runId` — the current run identifier.
- `workflowId` — the workflow being executed.
- `workflowName` — the human-readable workflow name.
- `tenantId` — the tenant scope (when the host supports multi-tenancy).
- `nodeId` — the executing node's id.
- `now` — ISO 8601 UTC timestamp at composition time.

Hosts MAY surface additional context keys; templates that depend on host-specific keys lose cross-host portability.

---

## PromptRef

A **PromptRef** is the reference type that workflow-node config and agent-manifest fields carry to point at a PromptTemplate. Two equivalent forms (see `schemas/prompt-ref.schema.json`):

**Stringy form** — canonical for inline use in `WorkflowNode.config`:

```
prompt:writer-system@1.0.0
prompt:vendor.acme.writer.v2
prompt:critic-system
```

Pattern: `^prompt:<templateId>(@<version>)?$`. When `version` is omitted, the host resolves the **latest** version available.

**Object form** — canonical when `libraryId` disambiguation, per-reference variable overrides, or version pinning need to be explicit:

```json
{
  "libraryId": "vendor.acme.editorial-prompts",
  "templateId": "writer-system",
  "version": "1.0.0",
  "variableOverrides": { "tone": "formal" }
}
```

`variableOverrides` apply at composition time and take precedence over node-input bindings (matching the resolution chain in RFC 0029 §A).

### Conflict resolution

When two installed packs ship the same `templateId`, the stringy form is rejected with `prompt_ref_ambiguous` and consumers MUST use the object form with explicit `libraryId` to disambiguate (per RFC 0028 §B).

---

## Capability advertisement

A host advertises its prompt-resolution support via `capabilities.prompts` (per `capabilities.schema.json`). The block carries two **independent** axes — node-execution PromptRef resolution (Phase A) and the `/v1/prompts*` REST surface (Phase B) — each gated by its own flag so a host can implement either without the other.

```json
{
  "prompts": {
    "supported": true,
    "endpointsSupported": false,
    "templateKinds": ["system", "user", "schema-hint"],
    "variableSources": ["input", "variable", "context"],
    "maxTemplateBytes": 16384,
    "observability": "full"
  }
}
```

Field semantics:

| Field | Required | Semantics |
|---|---|---|
| `supported` | yes | RFC 0027 Phase A gate. When `true`, the host resolves PromptRef values on `WorkflowNode.config.{systemPromptRef, userPromptRef, additionalPromptRefs}` at node-execution time and emits `prompt.composed` events. When `false` or absent, those keys are treated as opaque strings and never composed. **Does NOT imply the `/v1/prompts*` REST surface is available** — see `endpointsSupported`. |
| `endpointsSupported` | no | RFC 0028 Phase B gate. When `true`, the host serves the `/v1/prompts*` REST surface (at minimum the read endpoints). When `false` or absent, every `/v1/prompts*` request returns `501 capability_not_provided`. Independent of `supported`. |
| `templateKinds` | no | Subset of `PromptKind` values the host accepts. Default: all four. |
| `variableSources` | no | Subset of `PromptVariable.source` values supported. `secret` SHOULD only appear when `capabilities.secrets.supported: true`. |
| `maxTemplateBytes` | no | Host cap on `text` length. MUST NOT exceed the schema cap (65536). |
| `observability` | no | `off` / `hashed` / `full` — controls `prompt.composed` emission per §"Composition + observability" below. Default: `hashed`. |

Phase B (RFC 0028) extends this block with `packsSupported` (pack-install path; requires `endpointsSupported: true` to be meaningful), `mutableLibrary` (write endpoints; requires `endpointsSupported: true`), and `library` (per-library knobs). Phase C (RFC 0029) extends it with `defaults` and `agentBindings`. This document covers Phase A; the Phase B fields are documented in §"Discovery & distribution" below.

---

## Composition + observability

When a node executes and the host has resolved a PromptRef (per the resolution chain in RFC 0029), the host **composes** the prompt body by:

1. Substituting `{{varName}}` placeholders against the resolved variable bindings.
2. Wrapping any input flagged `meta.contentTrust: "untrusted"` (per `mcp-integration.md` §"Trust boundary" + RFC 0020 §D) in `<UNTRUSTED>...</UNTRUSTED>` markers — the markers MUST be preserved verbatim into the composed body per `SECURITY/threat-model-prompt-injection.md`.
3. Replacing any `secret`-sourced variable values with `[REDACTED:<secretId>]` markers in any observability projection (the markers do NOT appear in the actual dispatched body — the host resolves real values via `capabilities.secrets` after redaction-projection).

When the host advertises `capabilities.prompts.observability !== "off"`, the host MUST emit a `prompt.composed` RunEventDoc per node composition:

```typescript
interface PromptComposedPayload {
  nodeId: string;
  refs: string[];              // ["prompt:writer-system@1.0.0", "prompt:writer-user@1.0.0"]
  kind: 'system+user' | 'system-only' | 'user-only' | 'agent-reasoning';
  hash: string;                // sha256:... of composed body
  // observability: 'full' only
  systemPrompt?: string;
  userPrompt?: string;
  variableBindings?: Record<string, unknown>;
  // observability: 'hashed' or 'full'
  variableHashes?: Record<string, string>;  // name → sha256:...
  contentTrust?: 'trusted' | 'untrusted';
}
```

Under `observability: "hashed"` (default), only `hash` + `variableHashes` are populated — the bodies stay out of the event log. Under `observability: "full"`, the composed bodies appear with secret redaction and trust-marker preservation.

### Replay determinism

`prompt.composed` events participate in replay. Invariants:

- `hash` MUST replay identically.
- `variableHashes[name]` MUST replay identically.
- `refs` MUST replay identically.
- `systemPrompt` / `userPrompt` / `variableBindings` MAY be omitted on replay even when present in the original run (the host's `observability` setting may differ between original and replay); replay consumers MUST tolerate omission.

Divergence of `hash` MUST emit a `replay.diverged` event with `divergencePoint: "prompt.composed"` per `replay.md`.

### Three-surface taxonomy (non-normative)

OpenWOP distinguishes **three orthogonal observability surfaces** for LLM-call inspection. Multi-agent debugging tools render all three to reconstruct what an agent saw + thought + emitted:

| Surface | What it captures | Source |
|---|---|---|
| `prompt.composed.systemPrompt` / `userPrompt` | The body **the host sent** to the LLM, post-substitution + post-redaction | This document |
| `AIEnvelope.payload.reasoning` | Chain-of-thought **the LLM emitted as part of structured output** | RFC 0030 (parallel track, Draft) |
| `agent.reasoning.delta` + `agent.reasoned` | The LLM's interleaved **thinking-tokens stream** | RFC 0024 (Accepted) |

None of these replaces the others. A complete multi-agent visualization renders all three streams in temporal order so an operator can see what the host instructed, what the model thought through, and what the model returned as structured output.

---

## Security invariants

The `prompt.composed` event MUST carry two SECURITY invariants once a host actually emits the event (per the staging precedent in RFC 0021):

- **`prompt-composed-secret-redaction`** — Any variable whose `source` is `secret` MUST appear as `[REDACTED:<secretId>]` in `systemPrompt`, `userPrompt`, and `variableBindings`. Never as plaintext.
- **`prompt-composed-trust-marker`** — When ANY contributing input was tagged `meta.contentTrust: "untrusted"` (per RFC 0020 §D), the composed bodies MUST wrap the untrusted segments in `<UNTRUSTED>...</UNTRUSTED>` markers AND the payload's `contentTrust` MUST be `"untrusted"`.

Both invariants live in `SECURITY/invariants.yaml` once a reference host emits the event. Until then, the rows are RFC-tracked but not gate-enforced — matching the RFC 0021 envelope-shape staging precedent (the invariants land alongside the reference impl that emits the event, not at Draft merge).

---

## Discovery & distribution (RFC 0028)

Phase B of the prompt-library track adds two complementary surfaces:

### REST endpoints

Six operations under `/v1/prompts*`, all gated on `capabilities.prompts.endpointsSupported: true` (NOT `supported`; see §"Capability advertisement" above for the two-axis split — `supported` gates node-execution PromptRef resolution, `endpointsSupported` gates this REST surface). The mutating three (`POST` / `PUT` / `DELETE`) are additionally gated on `capabilities.prompts.mutableLibrary: true`. Hosts that don't advertise the relevant capability return `501 capability_not_provided`.

| Method | Path | OperationId | Purpose |
|---|---|---|---|
| `GET` | `/v1/prompts` | `listPromptTemplates` | Paginated list with `?kind`, `?tag`, `?modelClass`, `?source` filters + opaque `cursor` + `limit`. |
| `POST` | `/v1/prompts` | `createPromptTemplate` | Create a user-source template (mutable libraries only). Returns `201` with a `Location` header. |
| `GET` | `/v1/prompts/{templateId}` | `getPromptTemplate` | Fetch a single template, optionally pinned via `?version`. `ETag` + `If-None-Match` revalidation. `?libraryId` disambiguates when packs collide. |
| `PUT` | `/v1/prompts/{templateId}` | `updatePromptTemplate` | Replace a user-source template; submitted SemVer MUST be strictly greater than stored. |
| `DELETE` | `/v1/prompts/{templateId}` | `deletePromptTemplate` | Delete a user-source template; `403` on host-built-in or pack-sourced. |
| `POST` | `/v1/prompts:render` | `renderPromptTemplate` | Render with supplied bindings; returns composed body + sha256 hash + per-variable hashes. Does NOT dispatch an LLM call. |

**Deterministic-render invariant.** The `:render` response's `hash` MUST equal the `hash` that a matching `prompt.composed` event would carry at dispatch time for the same `(ref, variables, contentTrust)` inputs. This is the same determinism contract `prompt.composed` participates in for replay (per §"Replay determinism" above) — the `:render` endpoint is the preview surface that lets clients validate hashes before dispatch.

**Cache semantics.** `GET /v1/prompts/{templateId}` responses SHOULD set `ETag: "<sha256-of-body>"` and `Cache-Control: max-age=60`. When the request pinned `?version`, hosts SHOULD upgrade to `Cache-Control: public, max-age=31536000, immutable` (mirrors `node-packs.md` §"Immutable artifact" semantics).

**Authorization.** Mutating endpoints MUST require authentication per `auth.md`. Hosts SHOULD scope by writer role; the spec defers role-mapping to host policy.

### Prompt-pack distribution

A third pack kind alongside node packs (RFC 0003) and workflow-chain packs (RFC 0013). Distinguished by `kind: "prompt"` in the manifest:

```json
{
  "name": "vendor.acme.editorial-prompts",
  "version": "1.0.0",
  "kind": "prompt",
  "engines": { "openwop": ">=1.1.0 <2.0.0" },
  "prompts": [
    {
      "templateId": "writer-system",
      "version": "1.0.0",
      "kind": "system",
      "text": "You are a careful editorial writer.",
      "tags": ["editorial"]
    }
  ]
}
```

See `schemas/prompt-pack-manifest.schema.json` for the full shape.

**Install-time validation.** When a host installs a prompt pack:

1. Verify the Ed25519 signature per `registry-operations.md` §"Signature verification" — same flow as node and chain packs.
2. Verify SRI integrity per `registry-operations.md` §"Subresource Integrity" — unchanged.
3. Compile each `prompts[].text` against `prompt-template.schema.json` and assert variable-reference closure (every `{{varName}}` in `text` either appears in `variables[]` or matches a canonical context key).
4. Resolve every entry in the manifest's `dependencies` block; an unresolvable entry rejects the install with `prompt_pack_dependency_unresolvable`.
5. Reject install with `prompt_template_invalid` on any of the above.

**Pack-kind discriminator invariant.** A manifest with `kind: "prompt"` MUST NOT also carry `nodes[]` or `chains[]` arrays. Same posture as RFC 0013's "negative example."

**Conflict resolution (cross-pack `templateId` collision).** When two installed prompt packs ship the same `templateId`:

- Both surface in `GET /v1/prompts` with distinct `meta.source: "pack"` + `meta.packName` + `meta.packVersion` discriminators.
- A stringy `PromptRef` (`prompt:writer-system@1.0.0`) without `libraryId` is rejected with `prompt_ref_ambiguous` when more than one match exists.
- Clients disambiguate by using the structured object form: `{ libraryId: "vendor.acme.editorial-prompts", templateId: "writer-system", version: "1.0.0" }`.

### Capability advertisement extensions

Phase B extends `capabilities.prompts` with three additional optional fields:

| Field | Semantics |
|---|---|
| `packsSupported: boolean` | Host installs `kind: "prompt"` packs and exposes their templates at `GET /v1/prompts` with `meta.source: "pack"`. False or absent = no pack support. |
| `mutableLibrary: boolean` | Host honors `POST` / `PUT` / `DELETE /v1/prompts*`. False or absent → 501 on those endpoints. Pack-sourced + host-built-in templates remain read-only regardless. |
| `library.{id, renderEndpoint, maxRenderRequestBytes}` | Per-library configuration knobs. `id` enables structured-PromptRef `libraryId` lookup. `renderEndpoint` overrides the default `/v1/prompts:render` path. `maxRenderRequestBytes` caps `:render` request body size. |

### Provenance fields on `PromptTemplate.meta`

When a template is pack-sourced, the host MUST populate two additional `meta` fields:

- `meta.packName` — matches the installed pack's `name`. Required when `meta.source: "pack"`.
- `meta.packVersion` — matches the installed pack's `version`. Required when `meta.source: "pack"`.

A JSON-Schema `if/then` conditional in `prompt-template.schema.json` enforces this at install time.

---

## Open spec gaps

| # | Gap | Owner / RFC |
|---|---|---|
| P1 | Four-layer resolution chain + `agent.promptResolved` event + `AgentManifest.promptOverrides` | RFC 0029 (Draft) |
| P2 | Reference-host emission of `prompt.composed` from `core.ai.callPrompt` in the workflow-engine sample | Acceptance-gate item per RFC 0027 |
| P3 | First non-steward host advertises `capabilities.prompts.supported: true` | Acceptance-gate item per RFC 0027 |
| P4 | Reference-host implementation of `/v1/prompts*` REST endpoints + prompt-pack install flow | Acceptance-gate item per RFC 0028 |
| P5 | Nested template includes (`{{include:prompt:other@1.0.0}}`) — deferred to a future RFC if demand emerges | (open) |
| P6 | Canonical enumeration of `context` source variable names — currently non-normative recommendations | (open) |
| P7 | Cross-validation of `modelHints.envelopeType` against `capabilities.supportedEnvelopes` and the Tier-1 portability subset (RFC 0030) | RFC 0030 (Draft, parallel track) |
| P8 | Cross-pack `dependencies` semantics — `extends:` template inheritance, transitive closure resolution | RFC follow-up to 0028 (deferred) |

---

## Cross-reference

- `workflow-definition.md` §"Prompt references on nodes" — the convention by which `WorkflowNode.config` carries PromptRef values.
- `capabilities.md` — discovery handshake (this document extends the `prompts` block).
- `host-capabilities.md` §host.aiEnvelope — the existing LLM-call surface that prompt resolution feeds.
- `mcp-integration.md` §"Trust boundary" + RFC 0020 §D — `meta.contentTrust` propagation that `prompt.composed.contentTrust` mirrors.
- `replay.md` — replay invariants this document extends with `prompt.composed`.
- `RFCS/0027-prompt-templates.md` — Phase A wire-shape RFC (this document's source).
- `RFCS/0028-prompt-library-endpoints.md` — Phase B registry + endpoint surface.
- `RFCS/0029-prompt-override-hierarchy.md` — Phase C resolution chain + `agent.promptResolved`.
- `RFCS/0030-envelope-reasoning-and-tier-one-subset.md` — parallel-track sibling for the LLM-emission side of the three-surface taxonomy.
- `SECURITY/threat-model-secret-leakage.md` SR-1 — `[REDACTED:<id>]` marker discipline.
- `SECURITY/threat-model-prompt-injection.md` — `<UNTRUSTED>...</UNTRUSTED>` marker discipline.
- External: MyndHyve `PromptEntry` / `PromptLibrary` / `WorkflowPromptService.resolveForExecution()` reference impl — closest single-host prior-art for the resolution-chain pattern RFC 0029 normates.
