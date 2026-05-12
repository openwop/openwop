# openwop Spec v1 — Node Packs and the Public Registry

> **Status: FINAL v1 (2026-04-27).** Comprehensive coverage of the pack manifest format, distribution, signing, and registry HTTP API. Language-neutral stable surface for external review. Not yet referenced from a publicly-deployed registry. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

Workflows in v1 are written against a fixed set of `core.*` node typeIds. Every implementation re-implements the same nodes (AI prompt calls, approval gates, HTTP fetches) because there's no shared distribution channel. Workflows that depend on a vendor-specific typeId (`vendor.acme.salesforce-upsert`) can't run against an implementation that doesn't ship that node.

openwop defines **node packs** as the unit of distribution. A pack is a self-describing archive containing:

1. A **manifest** declaring the node typeIds, schemas, and engine-version requirements.
2. A **runtime artifact** the engine loads at workflow-registration time (language-specific: a JS bundle, Python wheel, Go plugin, WASM module, or a remote MCP endpoint).
3. Optional **assets** (icons, prompt fragments, doc fragments).

An OpenWOP-compliant **registry** is an HTTP service that hosts published packs and exposes a discovery + fetch API. A hosted reference registry is planned at `https://packs.openwop.dev/`; deployers MAY operate private registries (the [npm enterprise](https://docs.npmjs.com/about-npm-enterprise) analog).

The pack/registry idiom parallels [npm](https://npmjs.com/) and [Helm chart repositories](https://helm.sh/docs/topics/chart_repository/) — chosen for ecosystem familiarity, not vendor lock-in.

---

## Pack identity

### Naming

Pack names use the reverse-DNS convention enforced by `typeId` patterns elsewhere in the spec (`workflow-definition.schema.json` §typeId):

```
<scope>.<author>.<pack>
```

| Scope | Reservation |
|---|---|
| `core.*` | Reserved for spec-canonical packs maintained by the openwop working group. Third parties MUST NOT publish under this scope. |
| `vendor.<org>.*` | Vendor-published packs. The `<org>` segment is reserved on first-publish; subsequent publishes from a different account return `403 forbidden`. |
| `community.<author>.*` | Hobbyist / individual packs. Lighter reservation; squatting is disputable but enforcement is best-effort. |
| `private.<host>.*` | **Host-internal packs** running on a single deployment's private registry. The `<host>` segment is operator-chosen and MUST NOT collide with reserved values. The public registry at `packs.openwop.dev` MUST refuse `private.*` uploads with `400 invalid_pack_scope` — `private.*` is for self-hosted registries only. Mirrors the `local.*` "not for public registries" semantic, distinguished by intent: `local.*` is in-repo / dev-time; `private.<host>.*` is the host's curated production registry. See registry-operations.md §"Host-private marketplace relationship" for the deployment model. |
| `local.*` | NOT published. Reserved for in-repo / unpublished private packs. Registries MUST refuse `local.*` uploads with `400 invalid_pack_scope`. |

### Reserved Core OpenWOP node typeIds

Within the `core.*` scope, the following typeIds are reserved for workflow primitives that every OpenWOP-compliant server is expected to provide.

| TypeId | Purpose |
|---|---|
| `core.start` | Workflow entry point. |
| `core.end` | Workflow terminal. |
| `core.conditional` | Routing on edge conditions. |
| `core.delay` | Wall-clock pause. |
| `core.loop` | Iteration construct. |
| `core.parallel` | Fan-out / parallel execution. |
| `core.merge` | Fan-in / synchronization point. |
| `core.setVariable` | Write to workflow variables. |
| `core.getVariable` | Read from workflow variables. |
| `core.interrupt` | HITL primitive — see `interrupt.md`. |
| `core.identity` | Echo-input primitive — passes a named input port to an output port unchanged. Used by conformance fixtures to verify input/output passthrough; servers SHOULD ship for v1 conformance. |
| `core.subWorkflow` | Synchronous sub-workflow invocation — parent waits for child terminal. Config shape, output shape, and `outputMapping` semantics are normative; see §"`core.subWorkflow` contract" below + `conformance/fixtures.md` §`conformance-subworkflow-parent`. |
| `core.channelWrite` | Write a value to a named channel using a typed reducer (v1: `append` only) with optional `ttlMs` filtering. Closes C3 channel-TTL fold. See `channels-and-reducers.md` §append + §TTL and `conformance/fixtures.md` §`conformance-channel-ttl`. |
| `core.orchestrator.supervisor` | Multi-Agent Shift Phase 5. Observes worker completions and emits an `OrchestratorDecision` (`schemas/orchestrator-decision.schema.json`) — discriminated union over `next-worker` / `ask-user` / `terminate`. Hosts advertising `capabilities.agents.orchestrator: true` MUST register this typeId. Pairs with `RunSnapshot.runOrchestrator` (the supervisor identity for the run's lifetime) and the `runOrchestrator.decided` event. Conservative-path: when the supervisor's `agent.decided.confidence` is below the resolved escalation threshold, the node MUST suspend via `node.suspended { reason: 'low-confidence' }` per the CP-1 invariant. |
| `core.dispatch` | Multi-Agent Shift Phase 6. Consumes the latest `OrchestratorDecision` (typically wired from an upstream `core.orchestrator.supervisor` via DAG edge) and acts on it: `next-worker` dispatches each `nextWorkerIds[i]` as a child run (delegates to `core.subWorkflow` machinery); `ask-user` suspends via `core.conversationGate` (if `capabilities.conversationPrimitive: true`) or `clarification.requested` interrupt; `terminate` completes the run cleanly. Configuration shape: `schemas/dispatch-config.schema.json`. Conservative-path commitment (CP-2): MUST NOT mutate the run's DAG mid-run — each iteration runs against the static template DAG. Hosts advertising `capabilities.agents.dispatch: true` MUST register this typeId. See `conformance/src/scenarios/dispatchLoop.test.ts`. |
| `core.conversationGate` | Multi-Agent Shift Phase 4. Multi-turn conversation primitive — `open`/`exchange`/`close` lifecycle on a single typeId. `open` mints a `conversationId` and emits `conversation.opened`. `exchange` suspends with the prompt; resume value MUST validate against the per-turn schema declared in node config; emits `conversation.exchanged`. `close` ends the conversation, emitting `conversation.closed`. Conversation log is replay-deterministic via the `message` reducer (see `channels-and-reducers.md`). Hosts advertising `capabilities.conversationPrimitive: true` MUST register this typeId; pre-MAS hosts route multi-turn user interjections through `clarification.requested` instead. |

The naming convention is `core.<conceptName>` — flat camelCase compound for multi-word names. Multi-segment dotted typeIds (e.g., `core.ai.callPrompt`) live in the **portable optional** node-pack tier (`openwop.*` / `vendor.*`), not in Core openwop. Implementations MUST register these typeIds before claiming v1 conformance.

### `core.subWorkflow` contract

`core.subWorkflow` dispatches a child run of a different workflow document and waits for that child's terminal status before completing. The contract is normative for v1 conformance.

**Config shape:**

```json
{
  "workflowId": "<child-workflow-id>",
  "waitForCompletion": true,
  "onChildFailure": "fail-parent" | "absorb",
  "outputMapping": { "<parentVar>": "<childVar>" },
  "propagateCancellation": true
}
```

- `workflowId` (required, string): the child workflow document identifier. Hosts MUST refuse the parent run with `unknown_child_workflow` if no such workflow is loaded.
- `waitForCompletion` (optional, boolean, default `true`): whether the parent blocks on the child's terminal status. `false` is reserved for a future asynchronous variant; v1 hosts MAY refuse `false` with `validation_error`.
- `onChildFailure` (optional, closed enum, default `"fail-parent"`): `"fail-parent"` propagates the child's failure to the parent's `node.failed` event and subsequent `run.failed`; `"absorb"` records the child's failure but lets the parent continue.
- `outputMapping` (optional, object): a `parentVar → childVar` map. After the child reaches `completed`, the host MUST copy each named child variable into the parent's variables under the mapped key. Missing child variables MUST surface as `undefined` (the host MUST NOT throw); the host MUST NOT overwrite parent variables for entries whose child source is `undefined`.
- `propagateCancellation` (optional, boolean, default `true`): when the parent enters `cancelling`, whether to cascade-cancel the in-flight child. See `interrupt-profiles.md` §"Parent-child cancellation."

**Output shape (normative).** On child terminal, the parent's `node.completed` event payload MUST carry `outputs.childRunId` (string) and `outputs.childStatus` (closed enum: `"completed" | "failed" | "cancelled"`):

```json
{
  "type": "node.completed",
  "nodeId": "<subwf-node-id>",
  "data": {
    "outputs": {
      "childRunId": "run-...",
      "childStatus": "completed"
    }
  }
}
```

Hosts that want to carry additional fields (e.g., aggregate `childOutcome` enum, retry counters) MAY add them under `data.outputs.*` but MUST NOT remove `childRunId` / `childStatus`.

**Parent linkage.** Every child run launched via `core.subWorkflow` MUST carry `RunSnapshot.parentRunId` (the parent's runId) and `RunSnapshot.parentNodeId` (the dispatching node's id). Both fields are required on the child's `GET /v1/runs/{runId}` response.

**Variable seeding.** A child run's variables MUST be initialized from the child workflow's `variables[].defaultValue` declarations at run-create time. Mid-run mutations to those defaults are out of scope (the next write wins per the channel reducer); the seeding rule covers the initial fold only.

**Conformance:** `conformance/src/scenarios/subworkflow.test.ts` and the `conformance-subworkflow-parent`/`conformance-subworkflow-child` fixtures exercise the contract end-to-end.

### Versioning

Pack versions follow [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]`). Workflow definitions pin pack versions via the same range syntax as npm (`^1.2.3`, `~1.2.0`, `>=1.0 <2.0.0`).

A registry MUST return the highest version satisfying the requested range. Prerelease versions are ONLY returned when the range is explicit (`^1.2.3-beta` matches `1.2.3-beta.1` but `^1.2.3` does NOT match prerelease versions per semver's "prerelease versions have lower precedence" rule).

### Dependency resolution + lockfile

Workspace operators MAY commit a `pack-lock.json` lockfile alongside their workflow definitions. The lockfile pins resolved versions of every pack a workspace depends on so that re-installation produces byte-identical artifacts.

**Why lockfiles.** Semver ranges are flexible by design — `^1.2.3` matches `1.2.3` today and `1.5.0` tomorrow. For audit-grade reproducibility (regulated deployments, supply-chain forensics, debug-bundle replay), workspaces need a way to pin the exact resolved version + tarball hash. Lockfiles encode that pin.

**Lockfile shape.** Defined in `schemas/pack-lockfile.schema.json`:

```json
{
  "lockfileVersion": 1,
  "generatedAt": "2026-05-12T18:00:00Z",
  "registry": "https://packs.openwop.dev",
  "packs": [
    {
      "name": "vendor.openwop.rust-hello",
      "version": "1.0.0",
      "resolved": "https://packs.openwop.dev/v1/packs/vendor.openwop.rust-hello/-/1.0.0.tgz",
      "integrity": "sha256-q3PFh1Yj+r...=",
      "signature": {
        "algorithm": "ed25519",
        "publicKey": "MCowBQYDK2VwAyEA...",
        "value": "wkjLZ8N1g...=="
      },
      "dependencies": {},
      "peerDependencies": { "host.aiEnvelope": "supported" }
    }
  ]
}
```

**Resolution rules (normative).** When a lockfile is present:

1. **Resolvers MUST honor the lockfile's exact versions.** A workspace with `pack-lock.json` ignores the manifest's range and installs the exact `version` from the lockfile entry. This is the "frozen-lockfile" mode in npm-family tooling.
2. **Resolvers MUST verify integrity.** The fetched tarball's SHA-256 MUST match `packs[].integrity`. Mismatch fails the install with `pack_integrity_mismatch`.
3. **Resolvers MUST verify signature when present.** When `packs[].signature` is recorded, the Ed25519 signature over the tarball MUST verify against `packs[].signature.publicKey`. Mismatch fails with `pack_signature_invalid`.
4. **Resolvers MUST verify host peerDependencies.** For each lockfile entry, the resolver consults the host's `/.well-known/openwop` (per `host-capabilities.md` §"Capability negotiation") and confirms every `peerDependencies` key is satisfied. Missing host capability fails with `pack_peer_dependency_missing` per existing rules.
5. **Resolvers MUST refuse partial lockfiles.** If a workspace references a pack not listed in the lockfile, the install fails with `pack_lockfile_incomplete`. Either regenerate the lockfile or remove the unreferenced pack.
6. **Mode without a lockfile.** When no `pack-lock.json` is present, the resolver runs normal semver resolution against the manifest ranges. This is the "free" mode; suitable for development.

**Lockfile regeneration.** Workspace tooling (a CLI installer, not part of the protocol) writes the lockfile after a successful resolution. The protocol does not specify CLI ergonomics — only the on-disk shape + the verification rules a resolver MUST follow when the file is present.

**Mixed-namespace lockfiles.** A workspace MAY depend on packs from multiple registries. Each `packs[]` entry's `resolved` URL identifies its registry. The top-level `registry` field is the default for entries that omit `resolved`. Resolvers MUST verify integrity per-entry regardless of registry — there's no cross-registry trust transfer.

**Failure modes (normative codes).** Error envelopes returned by the resolver MUST use these codes:

- `pack_integrity_mismatch` — fetched tarball SHA-256 ≠ lockfile `integrity`.
- `pack_signature_invalid` — Ed25519 signature verification failed.
- `pack_peer_dependency_missing` — host doesn't advertise a required peer capability.
- `pack_lockfile_incomplete` — workspace references a pack not in the lockfile.
- `pack_version_not_found` — lockfile pins a version the registry no longer serves (post-yank scenario). Operators recover by regenerating the lockfile or pinning to an alternative version.

---

## Manifest format

A pack's manifest is a JSON file named `pack.json` at the pack root. Schema: `schemas/node-pack-manifest.schema.json`.

```json
{
  "name": "vendor.acme.salesforce-tools",
  "version": "1.4.2",
  "description": "Salesforce CRM nodes for OpenWOP workflows.",
  "author": "Acme Corp <devs@acme.example>",
  "license": "Apache-2.0",
  "homepage": "https://acme.example/openwop/salesforce",
  "repository": "https://github.com/acme/openwop-salesforce",
  "engines": {
    "openwop": ">=1.0 <2.0.0"
  },
  "nodes": [
    {
      "typeId": "vendor.acme.salesforce.upsert",
      "version": "1.4.2",
      "label": "Salesforce Upsert",
      "category": "integration",
      "role": "side-effect",
      "capabilities": ["side-effectful", "mcp-exportable"],
      "configSchemaRef": "schemas/upsert.config.json",
      "inputSchemaRef":  "schemas/upsert.input.json",
      "outputSchemaRef": "schemas/upsert.output.json",
      "requiresSecrets": [
        { "id": "salesforce-oauth", "kind": "oauth-token", "scope": "tenant" }
      ]
    },
    {
      "typeId": "vendor.acme.summarize",
      "version": "1.4.2",
      "label": "AI Summarize",
      "category": "chat",
      "role": "streaming-output",
      "capabilities": ["streamable", "side-effectful", "mcp-exportable"],
      "configSchemaRef": "schemas/summarize.config.json",
      "inputSchemaRef":  "schemas/summarize.input.json",
      "outputSchemaRef": "schemas/summarize.output.json",
      "requiresSecrets": [
        { "id": "anthropic", "kind": "ai-provider", "provider": "anthropic", "scope": "tenant" }
      ]
    }
  ],
  "runtime": {
    "language": "javascript",
    "entry": "dist/index.js",
    "format": "esm"
  },
  "signing": {
    "publicKeyRef": "keys/2026-04.pem",
    "signatureRef": "pack.json.sig"
  }
}
```

### Required fields

| Field | Description |
|---|---|
| `name` | Pack name per §naming. |
| `version` | Semver. |
| `engines.openwop` | Semver range — which openwop protocol versions this pack works against. |
| `nodes[]` | Each declared node has `typeId`, `version` (per-node, may differ from pack version), `category`, `role`, schemas. |
| `runtime` | Language + entry-point + format triple. See §runtime formats. |

### Optional fields

`description`, `author`, `license`, `homepage`, `repository`, `keywords[]`, `dependencies` (other packs), `peerDependencies` (engine-supplied capabilities the pack consumes — see `host-capabilities.md` for the per-surface contracts), `signing` (see §signing).

### Per-node `requiresSecrets[]`

Each `nodes[].requiresSecrets[]` entry declares a secret the node needs at execution time. Hosts that advertise `Capabilities.secrets.supported = true` resolve these via their secret-resolution adapter; hosts that don't advertise secrets MUST refuse to dispatch a node with non-empty `requiresSecrets` and return `credential_unavailable`.

```json
"requiresSecrets": [
  { "id": "anthropic", "kind": "ai-provider", "provider": "anthropic", "scope": "tenant" },
  { "id": "salesforce-oauth", "kind": "oauth-token", "scope": "tenant" }
]
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Stable id the executor uses to look up the resolved secret. |
| `kind` | enum | yes | `ai-provider` / `api-key` / `oauth-token` / `custom`. Drives host resolution policy. |
| `provider` | string | iff `kind=ai-provider` | Provider id; MUST be in `Capabilities.aiProviders.supported`. |
| `scope` | enum | no (default `tenant`) | `tenant` / `user` / `run`. MUST match a scope in `Capabilities.secrets.scopes`. |

The host's `SecretResolver.resolveSecret(ctx)` returns an opaque `ResolvedSecret` reference that downstream provider adapters dereference internally. Raw key material NEVER appears in events, logs, traces, prompts, errors, exports, or screenshots — this is enforced by NFR-7 at the host layer.

**Engine semantics.** Before dispatching a node with `requiresSecrets`, the engine MUST:

1. Verify each entry's `kind` and `scope` against `Capabilities.secrets`. Mismatch → terminal `failed` with `error.code = credential_unavailable`.
2. If `kind = 'ai-provider'`, verify `provider` is in `Capabilities.aiProviders.supported` AND (for BYOK runs) that the run's `RunOptions.configurable.ai.credentialRef` references a stored credential of the right provider.
3. Call `SecretResolver.resolveSecret({ id, kind, provider, scope, runId, tenantId, userId })` and pass the opaque ref to the executor via the engine's existing context plumbing.

---

## Runtime formats

The `runtime.language` field declares how the engine loads the pack:

| `language` | `entry` is | Server requirement |
|---|---|---|
| `javascript` | Path to a JS module (CommonJS or ESM) | Engine running in Node 20+ or a JS-compatible WASM host |
| `python` | Path to a Python module / wheel | Python 3.10+ runtime adjacent to the engine |
| `go` | Path to a Go plugin (`.so`) or compiled binary | Go 1.22+ runtime; plugin support varies by platform |
| `wasm` | Path to a `.wasm` file with a defined ABI (planned v1.x profile) | Any host with a WASM runtime |
| `remote` | URL to an HTTP endpoint conforming to the MCP tool surface | Engine acts as MCP client; pack runs anywhere reachable |

A registry MAY refuse uploads of any `language` it doesn't support. An engine implementation MAY refuse to load packs whose `language` it can't execute, returning `400 unsupported_runtime` at workflow-register time.

For cross-language interop (a JavaScript engine loading a Python pack), the `remote` runtime is the recommended bridge — the engine speaks MCP to the pack process running in its native runtime.

---

## Distribution

### Pack archive

A pack is distributed as a `.tgz` (gzipped tarball) with the following layout:

```
pack.json
README.md                  (recommended — surfaces in registry UI)
schemas/                   (JSON Schemas referenced from pack.json `*SchemaRef`)
dist/                      (runtime artifact; path matches `runtime.entry`)
keys/<key-id>.pem          (signing public key, when present)
pack.json.sig              (detached signature over pack.json)
```

The tarball MUST NOT include build artifacts beyond `dist/`, lockfiles, `.git`, `node_modules`, or any other path matched by an opt-out `.openwopignore` (mirrors npm's `.npmignore`).

### Content addressing

Each published pack MUST have a content-addressable identifier — a SHA-256 hash of the tarball — exposed by the registry as `tarballSha256`. Workflow definitions MAY pin this hash for supply-chain integrity:

```json
{
  "engines": { "openwop": "^1.0" },
  "packs": {
    "vendor.acme.salesforce-tools": {
      "version": "1.4.2",
      "integrity": "sha256-Z1OcMeAwT/zYMyN9z/eFoy0e0xUDCcG2rh7Yd6hmvqM="
    }
  }
}
```

Engines MUST verify the hash before loading a pack; mismatch results in `400 pack_integrity_failure`.

### Signing

Packs MAY be signed with [Sigstore](https://www.sigstore.dev/) or a manual public-key signature.

For manual signatures, `pack.json.sig` is an Ed25519 signature over `pack.json` using the key at `keys/<key-id>.pem` (declared in `signing.publicKeyRef`). The registry MAY enforce signature presence on `vendor.<org>.*` namespaces; signature verification is the engine's responsibility at load time.

For Sigstore signatures, `pack.json.sigstore` is a Sigstore bundle. Verification follows [Sigstore client spec](https://docs.sigstore.dev/cosign/verifying/verify/).

A registry MUST surface the verification status in its discovery API so consumers can decide policy (deny on unsigned, prefer Sigstore over manual, etc.).

---

## Registry HTTP API

An OpenWOP-compliant registry MUST expose the following endpoints. All paths are relative to a registry base URL (e.g., `https://packs.openwop.dev/v1/`).

### `GET /v1/packs/{name}`

Discovery — returns metadata about a pack including all published versions, latest version, and download URLs.

```json
{
  "name": "vendor.acme.salesforce-tools",
  "description": "Salesforce CRM nodes for OpenWOP workflows.",
  "versions": {
    "1.4.2": {
      "tarballUrl": "https://packs.openwop.dev/v1/packs/vendor.acme.salesforce-tools/-/1.4.2.tgz",
      "tarballSha256": "sha256-...",
      "manifestUrl": "https://packs.openwop.dev/v1/packs/vendor.acme.salesforce-tools/-/1.4.2.json",
      "publishedAt": "2026-04-26T12:34:56Z",
      "signed": true,
      "signingMethod": "sigstore"
    }
  },
  "dist-tags": { "latest": "1.4.2" }
}
```

**Discovery-driven URL templates.** Registries SHOULD surface their actual URL templates via `.well-known/openwop-registry` `endpoints` (see `registry-operations.md`). Filesystem-backed registries (Firebase Hosting, S3+CDN, etc.) MAY serve pack metadata at `/v1/packs/{name}/index.json` instead of the bare `/v1/packs/{name}` URL because CDN URL-rewrite engines (notably Firebase Hosting's `path-to-regexp` matcher) do not reliably match path segments containing dots, which are common in reverse-DNS pack names. Clients SHOULD consult the discovery document's `endpoints` block and substitute `{name}` / `{version}` into the declared templates rather than hardcoding `/v1/packs/{name}`. Both forms MUST return identical content.

### Schema `$id` resolution

Pack schemas in `schemas/*.json` MAY declare a JSON Schema `$id` URL of the form `https://<registry>/{name}/{version}/<schema-file>.json`. Registries that wish to make these URLs resolvable SHOULD serve each schema at the path declared by its `$id`.

**Source-of-truth contract:** when a registry surfaces a schema at its `$id` URL, that surface MUST be a derived view of the schema as it appears inside the pack's **signed tarball**. The tarball is the canonical source; the mirrored URL is a courtesy for tools that auto-resolve `$id`. Consumers wanting cryptographic integrity of a schema MUST extract it from the tarball after verifying the tarball signature against the registry's signing keychain — the mirrored URL is NOT independently signed.

**Mirror lifecycle.** Schemas at `$id` URLs MUST be served only for packs that are present in the registry (have a published version with a tarball). Schemas for unpublished or yanked packs MUST NOT be exposed at `$id` URLs, even if the schema file exists in the pack's source repository; the mirror tracks registry state, not source-tree state.

**Implementer note.** A registry that derives the mirror from each tarball at publish time (extracting `schemas/*.json` into `/{name}/{version}/<schema>.json`) needs no special synchronization — the mirror cannot drift from the tarball because the tarball is its source. The reference registry's `build-index` script demonstrates this pattern.

### `GET /v1/packs/{name}/-/{version}.tgz`

Fetch the pack tarball. Response MUST include `Content-Type: application/tar+gzip`, `Content-Length`, and `ETag: "sha256-..."` matching the manifest's `tarballSha256`.

### `GET /v1/packs/{name}/-/{version}.json`

Fetch the pack manifest WITHOUT the runtime payload. Useful for introspection without triggering a full download.

### `GET /v1/packs/{name}/-/{version}.sig`

Fetch the detached Ed25519 signature blob over `pack.json` for this version. Pairs with the keychain endpoint (see `registry-operations.md` §"Signing keychain") to enable end-to-end signature verification: clients fetch the keychain, fetch the `.sig`, fetch the `.tgz`, then verify the signature against the keychain entries.

The endpoint MAY 302-redirect to a storage-backend signed URL rather than streaming the bytes directly — clients SHOULD follow redirects.

**Errors:**
- `404 signature_not_available` — version is missing, yanked, unsigned at publish time, OR the registry's storage backend is unwired. The four cases are intentionally indistinguishable: yanked tarballs MUST NOT serve their signatures (consumers shouldn't be verifying against known-bad packs); unsigned tarballs simply have no `.sig` blob to return; missing tarballs and storage outages are infrastructural states the consumer can't act on differently.
- `400 invalid_pack_name` / `400 invalid_version` — URL params don't match the spec's reverse-DNS / semver patterns.

### `PUT /v1/packs/{name}/-/{version}.tgz`

Publish a new version. Body is the gzipped tarball as `application/gzip` (or `application/x-gzip` / `application/octet-stream`). Auth via API key + `packs:publish` scope. Returns `201 Created` on first publish, `200 OK` on idempotent re-publish (identical content), or `409 Conflict` if `(name, version)` already exists with different content.

Headers:
- `Authorization: Bearer <api-key>`
- `X-Pack-Signing-Method: sigstore | manual | none`
- `X-Pack-Sha256: sha256-<base64>` (caller-asserted; server verifies)

Manifest extraction: the registry MUST extract `pack.json` from the tarball root and validate that `manifest.name` / `manifest.version` match the URL parameters before accepting the publish. The signature blob (if present in the tarball alongside `pack.json` per the `signing.signatureRef` path) is persisted as a sibling of the tarball and served via `GET /v1/packs/{name}/-/{version}.sig`.

**Errors:**

URL / scope:
- `400 invalid_pack_scope` — name doesn't match `core.*` / `vendor.*` / `community.*` / `private.*`. Public registries (`packs.openwop.dev`) MUST additionally refuse `private.*` and `local.*` per §Naming.
- `400 invalid_pack_name` — URL pack-name doesn't match the reverse-DNS pattern at all (e.g., single segment, uppercase scope).
- `400 invalid_version` — URL version doesn't match semver.

Body shape:
- `400 invalid_body` — body is not a Buffer / not octet-stream-shaped (caller sent JSON instead of tarball bytes).
- `400 invalid_body` — empty body.

Tarball extraction (`tarball_<code>` prefix groups these together for client-side switching):
- `400 tarball_gunzip_failed` — body isn't a valid gzip stream.
- `400 tarball_too_large` — decompressed bytes exceed the registry's cap (recommended default: 50 MB).
- `400 tarball_manifest_missing` — no `pack.json` at the tarball root.
- `400 tarball_manifest_too_large` — `pack.json` exceeds the registry's per-file cap (recommended default: 256 KB).
- `400 tarball_manifest_not_json` — `pack.json` isn't valid JSON.
- `400 tarball_entry_missing` — `manifest.runtime.entry` declares a path that isn't in the tarball.
- `400 tarball_entry_too_large` — entry source exceeds the registry's per-file cap (recommended default: 5 MB).
- `400 tarball_path_traversal` — a tarball entry's name contains `..` or otherwise attempts to escape the pack root.
- `400 tarball_tar_parse_failed` — tar parser couldn't read the stream past the gzip layer.

Manifest contents:
- `400 invalid_manifest` — `pack.json` parsed but failed schema validation (missing required fields, wrong shape). Detail message includes the failing path.
- `400 manifest_mismatch` — `manifest.name` and/or `manifest.version` differ from the URL params. Registries MAY emit this aggregate form or the granular pair (`manifest_name_mismatch` / `manifest_version_mismatch`); clients MUST handle either form.
- `400 pack_integrity_failure` — server-computed SHA-256 doesn't match `X-Pack-Sha256` (when the header is supplied).
- `400 unsupported_runtime` — `runtime.language` value not accepted by this registry.

Authorization + conflict:
- `403 forbidden` — caller lacks the namespace claim or `packs:publish` scope.
- `409 conflict` — version already published with different content (semver pinning is immutable per npm convention). Registries MAY emit a more descriptive `version_conflict` body code; either form is spec-allowed.

Idempotent re-publish: callers that PUT the SAME content (sha256-equal) for an existing `(name, version)` get `200 OK` with the existing record, NOT a conflict. This lets retries and tooling-driven re-uploads succeed cleanly.

### `DELETE /v1/packs/{name}/-/{version}`

Unpublish — registries SHOULD refuse this for versions older than 72 hours (npm's left-pad lesson). Auth via API key + `packs:publish` scope.

**Errors:**
- `400 unpublish_window_expired` — version is older than the registry's unpublish window (default 72h). Use the yank flow instead (`POST /v1/packs/{name}/-/{version}/yank`) for security incidents.
- `403 forbidden` — caller lacks `packs:publish` scope.
- `404 not_found` — version doesn't exist.

### `GET /v1/packs/-/search?q=<term>`

Full-text search across name + description + keywords. Returns paginated results.

---

## Trust model

A pack's trustworthiness is the consumer's call. The spec defines the wire shapes; deployment policy decides what to actually load.

An engine implementation SHOULD support a layered policy:

1. **Allowlist mode** — only load packs from a configured list (no registry calls).
2. **Pinned mode** — load any pack whose `(name, version, integrity)` matches an entry in the workflow definition's `packs` map.
3. **Verified mode** — load packs whose signing verification succeeds; refuse unsigned.
4. **Open mode** — load any pack the workflow references (development / sandbox only).

A registry SHOULD record provenance: who published which version when, and from what build environment. Consumers can audit before adopting a vendor's pack.

---

## Engine integration

An OpenWOP-compliant engine MUST:

1. Resolve all packs declared in a workflow's `packs` map at workflow-register time, before executing any nodes.
2. Verify integrity (`tarballSha256`) and signature (when `signing` is present).
3. Surface load failures as `400 pack_load_failure` on the workflow-register response — not as a node-runtime failure.

A workflow that references a typeId not provided by any registered pack MUST be rejected at workflow-register time, NOT at run time. Catching this at register is the difference between "this workflow is broken" (engineer can fix) and "this run is broken" (user sees runtime failure).

---

## Open spec gaps

| # | Gap | Owner |
|---|---|---|
| NP1 | WASM ABI for `language: wasm` packs — needs a stable function-signature contract. | future v1.x |
| NP2 | Pack-level `dependencies` resolution (transitive packs) — currently underspecified. | future v1.x |
| NP3 | Mirror / federation between registries (npm-style upstream-fallback). | future |
| ~~NP4~~ | ~~Pack deprecation flow~~ — closed by `registry-operations.md` §"Deprecation flow" (2026-04-29). | ✅ closed |
| ~~NP5~~ | ~~Signing key rotation~~ — closed by `registry-operations.md` §"Signing-key rotation flow" (2026-04-29). | ✅ closed |

## References

- `auth.md` — the `packs:publish` scope used by the publish endpoint.
- `rest-endpoints.md` — error envelope shape.
- `version-negotiation.md` — `engines.openwop` semver range semantics.
- `schemas/node-pack-manifest.schema.json` — canonical manifest JSON Schema.
- npm registry API: <https://docs.npmjs.com/cli/v10/configuring-npm/package-json> (idiom source — not a normative dependency).
- Sigstore: <https://www.sigstore.dev/> (signing reference).
- Reference registry: planned at `https://packs.openwop.dev/`.
