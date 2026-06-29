# OpenWOP Spec v1 — Node-Pack Registry Operations

> **Status: Stable · v1.1 (2026-04-29).** Comprehensive coverage of the operational lifecycle for a hosted node-pack registry: submission, validation, deprecation, yank, and signing-key rotation flows. Pairs with the registry HTTP API in `node-packs.md` §"Registry HTTP API" — that doc covers wire shapes; this doc covers the lifecycle operations + their security model. Stable surface for external review. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend.

---

## Why this exists

`node-packs.md` defines the pack manifest shape, the registry HTTP API, and the trust-model layers an engine consumer SHOULD support. What it doesn't specify is the **operator side** of the registry — how authors submit new versions, what the registry validates pre-accept, how deprecations work without breaking pinned consumers, how to handle emergency yanks for security issues, and how signing keys rotate over time.

This doc is the operator's normative reference. An OpenWOP-compliant registry implementation MUST implement the lifecycle flows below; engine consumers MUST tolerate the metadata shapes the flows produce (deprecation flags, yank markers, key-rotation chains).

The planned hosted reference registry at `packs.openwop.dev` implements these flows when it launches; third-party registry implementations (private mirrors, enterprise self-host) MUST do the same to remain compatible.

> **Policy layer.** This doc is the _operational_ reference (the how). The _policy_ above it — submission gates, trust tiers, name reservation, IPR — is **[RFC 0043 — Registry and extension-policy](../../RFCS/0043-registry-and-extension-policy.md)** §B; the one-stop index is [`docs/governance/registry-policy.md`](../../docs/governance/registry-policy.md).

---

## Submission flow

The full author-side workflow for publishing a new pack version.

### Prerequisites

1. **Namespace claim.** The pack name is rooted in one of three reserved namespaces:
   - `core.*` — reserved for the openwop working group; not author-publishable.
   - `vendor.*` — vendor namespace under control of the vendor organization (`vendor.acme.*` belongs to Acme; the registry MUST refuse `vendor.acme.*` from non-Acme accounts).
   - `community.*` — open-publish namespace; first-claim wins per name (no organization gating).

   The registry MUST resolve the caller's account against the claimed namespace BEFORE accepting any submission.

2. **API key with `packs:publish` scope.** Per `auth.md`. Keys without the scope return `403 forbidden` on `PUT /v1/packs/{name}/-/{version}.tgz`.

3. **Signed tarball (RECOMMENDED).** Per `node-packs.md` §"Signing". Sigstore is the recommended method for v1.x; manual ed25519 / PGP signing is also accepted. Unsigned packs MAY be published but MUST be flagged in the registry metadata so consumers running in `verified` mode (per the trust model) can refuse them.

### Step 1 — package the tarball

```text
mypack/
  pack.json           # canonical manifest
  schemas/
    upsert.config.json
    upsert.input.json
    upsert.output.json
  dist/
    index.js          # runtime entry per pack.json runtime.entry
  README.md
  LICENSE
```

Tar+gzip the directory:

```bash
tar -czf mypack-1.4.2.tgz -C mypack .
```

### Step 2 — sign (RECOMMENDED)

Sigstore (keyless OIDC):

```bash
cosign sign-blob --bundle mypack-1.4.2.bundle mypack-1.4.2.tgz
```

Manual ed25519:

```bash
openssl pkeyutl -sign -inkey private.pem -in mypack-1.4.2.tgz \
  -out mypack-1.4.2.sig
```

Either form produces a signature artifact the registry stores alongside the tarball. The trust model in `node-packs.md` §"Trust model" describes how consumers verify signatures.

### Step 3 — compute integrity hash

```bash
shasum -a 256 mypack-1.4.2.tgz | awk '{print $1}' | base64
# Output something like: nW3kQ4f...
```

The registry verifies this against its own computation before accepting the upload.

### Step 4 — submit

```bash
curl -X PUT "https://packs.openwop.dev/v1/packs/vendor.acme.salesforce-tools/-/1.4.2.tgz" \
  -H "Authorization: Bearer $OPENWOP_API_KEY" \
  -H "X-Pack-Signing-Method: sigstore" \
  -H "X-Pack-Sha256: sha256-nW3kQ4f..." \
  -H "Content-Type: application/octet-stream" \
  --data-binary @mypack-1.4.2.tgz
```

Response: `201 Created` with the registry's canonical metadata for the new version (per `node-packs.md` `GET /v1/packs/{name}/-/{version}.json` shape).

### Step 5 — verify discoverability

```bash
curl https://packs.openwop.dev/v1/packs/vendor.acme.salesforce-tools
```

The new version SHOULD appear in the `versions` array. Search results (`GET /v1/packs/-/search`) are eventually consistent — typical propagation under 60s.

---

## Validation flow

What the registry checks before accepting a submission. An OpenWOP-compliant registry MUST implement at least these checks; MAY add more.

### Required checks (registry MUST refuse on failure)

1. **Integrity.** Server computes `SHA-256(body)` and compares to the `X-Pack-Sha256` header. Mismatch → `400 pack_integrity_failure`.
2. **Namespace claim.** Caller's account MUST match the namespace per §submission flow step 1. Mismatch → `403 forbidden`.
3. **Manifest validity.** The tarball MUST contain `pack.json` at root. The schema it MUST conform to is selected by the manifest's `kind` (RFC 0107): an absent `kind` or `kind: "node"` validates against `schemas/node-pack-manifest.schema.json`; `kind: "artifact-type"` against `schemas/artifact-type-pack-manifest.schema.json`; `kind: "connection"` against `schemas/connection-pack-manifest.schema.json`; `kind: "workflow-chain"` against `schemas/workflow-chain-pack-manifest.schema.json` (likewise `prompt`, and `kind: "card"` — the chat-card pack of RFC 0071 — against `schemas/chat-card-pack-manifest.schema.json`). The served per-version manifest (`/v1/packs/{name}/-/{version}.json`) MUST additionally validate against `schemas/registry-version-manifest.schema.json`, which carries the same `kind` discriminator. Schema-validation failure → `400 invalid_manifest`. Missing `pack.json` → `400 missing_manifest`.
4. **Name + version match path.** `pack.json` `name` and `version` fields MUST match the URL path `/v1/packs/{name}/-/{version}.tgz`. Mismatch → `400 manifest_path_mismatch` OR the more granular pair `400 manifest_name_mismatch` / `400 manifest_version_mismatch` (registries SHOULD prefer the granular pair for richer diagnostics; clients MUST handle either form).
5. **Version uniqueness.** `(name, version)` MUST NOT already exist. Conflict → `409 conflict` (or the more descriptive `409 version_conflict` — clients MUST handle either form). Semver is immutable per the npm convention; republishing requires a new version.
6. **Engine compatibility.** `pack.json` `engines.openwop` MUST declare a semver range. Missing or unparseable → `400 invalid_engines_range`. (The range itself isn't validated against any specific openwop version — that's a consumer-side check.)
7. **Runtime support.** For an **executable** kind (`node`, or `kind` absent), `pack.json` `runtime.language` MUST be one of `["javascript", "python", "go", "wasm", "remote"]`; unknown → `400 unsupported_runtime`. For a **declarative** kind (`artifact-type`, `connection`, `workflow-chain`, `prompt`, `card`, RFC 0107) this check MUST be **skipped** — a declarative pack carries no `runtime` block (and MUST NOT, per `registry-version-manifest.schema.json`); a declarative manifest carrying `runtime` is rejected at check #3.
8. **Schema references resolve.** Every `configSchemaRef` / `inputSchemaRef` / `outputSchemaRef` declared in `pack.json` MUST point to an existing file in the tarball. Missing → `400 schema_ref_missing`.
9. **Signature verification (when claimed).** If `X-Pack-Signing-Method` is `sigstore` or `manual`, the registry MUST verify the signature against the published key for the namespace. Failure → `400 signature_invalid`.

### Recommended checks (registry SHOULD perform)

1. **Tarball size cap.** Recommended max 50 MB unpacked, 10 MB compressed. Larger uploads MAY be refused with `413 payload_too_large`.
2. **Path-traversal prevention.** No tarball entry MAY have a path containing `..` or starting with `/`. Refuse with `400 unsafe_paths`.
3. **License field present.** Encourages license clarity; not a hard requirement. Missing license SHOULD generate a metadata warning visible on the pack's discovery page.
4. **`schemas/*` files validate as JSON Schema 2020-12.** Failure SHOULD produce a metadata warning rather than a hard rejection.
5. **No malicious patterns.** Scan binary entries for known-malware signatures (out of scope for this spec; registry operators choose their scanning vendor).

### Optional checks (registry MAY perform)

1. **Reproducibility hint.** Encourage `pack.json` carrying `repository` + a `provenance` field linking to a CI build record (Sigstore or in-toto attestation). Verifiable provenance is a strong trust signal.
2. **License-allowlist.** Operator-configured policy: refuse packs whose license isn't in an allowlist (e.g., `Apache-2.0`, `MIT`, `BSD-*`).

---

## Type-ID indexing and cross-namespace exports

A pack's contributed `nodes[].typeId` (and the `agents[]` it ships) **need not** be prefixed by the pack `name`. The manifest schema only _recommends_ the prefix (`node-pack-manifest.schema.json` `nodes[].typeId.description`: "The pack's `name` prefix is recommended"); the `typeId` pattern itself permits any reverse-DNS namespace. A pack named `vendor.myndhyve.web-research` may legitimately publish a node typed `ai.research.web`, and an agent's `toolAllowlist` (RFC 0072) may name that typeId with no textual relationship to the providing pack.

This has two operational consequences a registry and its consumers MUST account for:

1. **Prefix-scan discovery is unsound.** A consumer resolving "which pack provides typeId `T`?" MUST NOT assume `T`'s namespace prefix identifies the pack. It MUST consult a typeId→pack reverse mapping derived from the authoritative source — each version manifest's `nodes[].typeId` + `agents[].agentId`. Resolving by string-prefixing the pack name silently fails on cross-namespace exports.

2. **Registries SHOULD denormalize a `publishedTypeIds[]` index.** To let consumers resolve cross-namespace typeIds without fetching and scanning every manifest, a registry SHOULD surface, per pack version, the flat array of typeIds (and agent ids) that version contributes:

   ```json
   {
     "name": "vendor.myndhyve.web-research",
     "version": "1.0.1",
     "publishedTypeIds": ["ai.research.web"],
     "publishedAgentIds": []
   }
   ```

   `publishedTypeIds[]` is the union of the version manifest's `nodes[].typeId`; `publishedAgentIds[]` is the union of its `agents[].agentId`. Both are a **denormalization** — the manifest remains authoritative; the index is a discovery convenience the registry MUST keep consistent with the manifest it serves. A registry MAY additionally expose a reverse lookup (`GET /v1/packs/-/by-type/{typeId}` → the pack/version that publishes it) built from the same denormalization. Consumers MUST tolerate the fields' absence (older registries omit them) and fall back to manifest inspection.

   For **declarative** pack kinds (RFC 0107), the per-pack index SHOULD denormalize the kind's consumer-facing ids the same way: `artifactTypes[].artifactTypeId` for `kind: "artifact-type"`, `provider.id` for `kind: "connection"`, `chains[].chainId` for `kind: "workflow-chain"`. A registry MAY surface them under the same `publishedTypeIds[]` union or under kind-specific fields; consumers MUST inspect `kind` before assuming what an id denotes (a `node` typeId dispatches; an `artifactType` id names a type; a `provider` id names a connection). Absence is tolerated as above.

**Agent-manifest pack dependencies (informative).** Because an agent's `toolAllowlist` may reference cross-namespace typeIds, "which packs must this workspace approve to run this agent?" is not derivable from the agent manifest by inspection alone. A tool that computes the dependency closure — resolve each `toolAllowlist` entry through the `publishedTypeIds[]` index to its providing pack — is the recommended way to present that set to a workspace admin (RFC 0074 approval). The protocol does not yet normate a `packDeps` block on the agent manifest; the reverse index above is the supported resolution path.

---

## Runtime-requirement install gate (RFC 0076)

A pack MAY declare the abstract platform primitives its runtime code exercises via `runtime.requires[]` (see [`node-packs.md` §"Runtime platform requirements"](node-packs.md#runtime-platform-requirements-rfc-0076)). This is a **consumer/host install-time gate**, not a registry-acceptance check: the registry stores the field verbatim (it is part of the validated manifest), and the _host installing the pack into a workspace_ enforces it.

**Normative.** A host that gates platform access (a sandbox host) MUST, at install time, intersect a pack's `runtime.requires[]` against the set of primitives its sandbox will grant. If every listed primitive is grantable, install proceeds. If any primitive will **not** be granted, the host MUST refuse install with `pack_runtime_requirement_unmet` and MUST NOT silently install and fail at first invocation. The error reuses the `capability_not_provided` envelope (`capabilities.md`):

```json
{
  "error": "pack_runtime_requirement_unmet",
  "unmet": ["subprocess"],
  "manifest": "core.openwop.cron@1.0.0",
  "advice": "operator-facing remediation copy (OPTIONAL)"
}
```

`unmet[]` is the subset of `runtime.requires[]` the host refuses; `manifest` is the offending `name@version`; `advice` is OPTIONAL. A host that does not gate platform access MAY skip enforcement but SHOULD project `runtime.requires[]` onto the pack's inventory entry for operator visibility (RFC 0076 §A). This is the runtime-primitive analogue of the host-capability boundary the [§"Host-private marketplace"](#host-private-marketplace-relationship-non-normative-example) example already illustrates with `requires: ['<host>.canvas.write']`.

---

## Deprecation flow (closes NP4)

Marking a published version deprecated without unpublishing it. Lets pinned consumers continue resolving the version while signaling new consumers to migrate.

### Endpoint

```http
POST /v1/packs/{name}/-/{version}/deprecate
```

Body:

```json
{
  "reason": "Stripe API v2 is deprecated; use vendor.acme.stripe-tools@2.x for v3 support.",
  "supersededBy": "vendor.acme.stripe-tools@2.0.0"
}
```

Auth: `packs:publish` scope on the pack's namespace. Idempotent — calling with the same body returns `200 OK`; calling with different body updates the deprecation message (operator can refine wording).

### Response shape

The version metadata at `GET /v1/packs/{name}/-/{version}.json` gains a `deprecation` block:

```json
{
  "name": "vendor.acme.stripe-tools",
  "version": "1.4.2",
  "deprecation": {
    "deprecated": true,
    "reason": "Stripe API v2 is deprecated; use vendor.acme.stripe-tools@2.x for v3 support.",
    "supersededBy": "vendor.acme.stripe-tools@2.0.0",
    "deprecatedAt": "2026-05-15T12:00:00.000Z",
    "deprecatedBy": "alice@acme.example"
  },
  ...
}
```

### Consumer semantics

- Engine consumers in `pinned` or `allowlist` mode continue to resolve deprecated versions (pinning is contractual; deprecation is informational).
- Engine consumers in `open` or `verified` mode SHOULD log a warning when resolving a deprecated version. The warning MUST include `deprecation.reason` and `deprecation.supersededBy` if set.
- Search results (`GET /v1/packs/-/search`) MAY de-rank deprecated versions but MUST NOT hide them entirely.
- The latest non-deprecated version is a separate concept from "highest semver version" — `GET /v1/packs/{name}` returns both via `latest` (highest semver, deprecation-aware) and `versions[*].deprecation` per-version markers.

### Reverting deprecation

```http
DELETE /v1/packs/{name}/-/{version}/deprecate
```

Removes the deprecation marker. Same auth as the POST.

---

## Yank flow

Emergency removal for security issues. Distinct from `DELETE /v1/packs/{name}/-/{version}` (which is the standard unpublish, refused for versions >72h old per the npm convention).

### Endpoint

```http
POST /v1/packs/{name}/-/{version}/yank
```

Body:

```json
{
  "reason": "CVE-2026-12345 — RCE via crafted input.",
  "advisoryUrl": "https://github.com/advisories/GHSA-abcd-1234-efgh"
}
```

Auth: `packs:yank` scope (distinct from `packs:publish` — yank is privileged because it breaks pinned consumers). Operators MAY restrict the scope to a small set of trusted accounts.

### Effects

A yanked version is:

1. **Still served.** The tarball remains downloadable (consumers may need it for forensic analysis).
2. **Marked yanked in metadata.** `GET /v1/packs/{name}/-/{version}.json` returns the version with `yanked: { reason, advisoryUrl, yankedAt, yankedBy }`.
3. **Excluded from semver range resolution.** Engine consumers resolving `engines.openwop` semver ranges MUST exclude yanked versions from the candidate set. New runs that previously would have picked the yanked version MUST pick the next-best non-yanked version (or fail with a descriptive error if no candidate remains).
4. **Logged on every resolve.** Engine consumers that resolve a pinned-by-hash reference to a yanked version MUST emit a structured warning to operations (the run may proceed; the operator gets the signal).

### Consumer semantics

- Pinned-by-version (`vendor.acme.stripe-tools@1.4.2`): yank does NOT block resolution; the consumer still gets the yanked version. The pin is contractual.
- Pinned-by-hash (`vendor.acme.stripe-tools@sha256-...`): same as above; hash pinning is the strongest contract.
- Unpinned (`vendor.acme.stripe-tools@^1.0`): yank EXCLUDES the version from resolution. The consumer transparently gets the next-best.

### Reverting yanks

Yanks are intentionally hard to revert — they're for emergencies. The endpoint is:

```http
DELETE /v1/packs/{name}/-/{version}/yank
```

Auth: `packs:yank-revert` scope (further restricted; typically held by 1-2 trusted accounts). Reverting a yank reinstates semver range eligibility but DOES NOT remove the historical yank markers — consumers can audit the yank/revert pair.

---

## Signing-key rotation flow (closes NP5)

Long-lived ed25519 / Sigstore keys eventually need rotation. The spec supports this without breaking signature verification on existing pinned versions.

### Mechanism

A namespace's signing keys are stored in a registry-managed `keychain` document. Each key entry has a unique `kid` (key id), `algorithm`, public-key bytes, validity period, and a signing-key chain that links subsequent keys.

```http
GET /v1/packs/{name}/-/keychain
```

Response:

```json
{
  "namespace": "vendor.acme",
  "keys": [
    {
      "kid": "acme-2025-01",
      "algorithm": "ed25519",
      "publicKey": "MCowBQYDK2VwAyEA...",
      "validFrom": "2025-01-01T00:00:00.000Z",
      "validUntil": "2026-12-31T23:59:59.999Z",
      "rotatedTo": "acme-2026-04"
    },
    {
      "kid": "acme-2026-04",
      "algorithm": "ed25519",
      "publicKey": "MCowBQYDK2VwAyEA...",
      "validFrom": "2026-04-01T00:00:00.000Z",
      "validUntil": "2028-03-31T23:59:59.999Z",
      "rotatedFrom": "acme-2025-01",
      "rotationProof": "base64(sig_old(kid_new || publicKey_new || validFrom))"
    }
  ]
}
```

### Rotation operation

```http
POST /v1/packs/{name}/-/keychain/rotate
```

Body:

```json
{
  "kid": "acme-2026-04",
  "algorithm": "ed25519",
  "publicKey": "MCowBQYDK2VwAyEA...",
  "validFrom": "2026-04-01T00:00:00.000Z",
  "validUntil": "2028-03-31T23:59:59.999Z",
  "rotationProof": "base64(sig_old_key(kid_new || publicKey_new || validFrom))"
}
```

The `rotationProof` MUST be a signature produced by the OLD key over the canonical payload `{kid_new}||{publicKey_new}||{validFrom}` (concatenated UTF-8 bytes). The registry verifies the proof against the latest valid key in the keychain BEFORE accepting the rotation. Without rotation proof, rotation requires an out-of-band recovery flow (operator intervention; deliberately painful).

### Consumer semantics

- Verifying a pack signature: consumers walk the `keychain` finding the key whose `validFrom <= signedAt <= validUntil` matches the version's publication timestamp. Mismatch → signature verification fails (the version was signed with a key that doesn't cover its publication time).
- Rotation chains: consumers MAY require rotation proofs for keys whose `rotatedFrom` is set. Rejection of a rotation chain whose proof fails verification is implementation-defined; the recommended behavior is to refuse to verify packs signed under the rotated-to key until the proof verifies.
- Old keys remain usable for old packs: a key past `validUntil` continues to verify packs published while it was valid (the key's `validUntil` is a publish-time gate, not a verify-time gate).

### Compromise flow

If a private key is compromised, the operator MUST:

1. Rotate to a new key per the standard flow (with a fresh `kid` and `rotationProof` from the compromised key — yes, the compromised key still works for one last legitimate operation).
2. **Yank every pack version** signed under the compromised key whose `publishedAt` falls within the suspected compromise window. Use the standard yank flow per §yank.
3. Publish an advisory at a registry-discoverable URL listing the compromised `kid` and the exposed publish window.

The registry's role is structural — it can't decide which packs are legitimate vs. malicious. That's the operator's call; the registry provides the audit trail.

---

## Registry mirror + federation (closes NP3)

Closes NP3 from `node-packs.md` §"Open spec gaps". A workspace MAY consume packs from multiple registries — a primary (typically `packs.openwop.dev`) with one or more fallbacks (private mirror, enterprise self-host, air-gapped read-only replica). This section defines the cross-registry trust + resolution rules.

### Workspace federation configuration

A workspace declares federation via the lockfile's `registry` field (single) OR via per-entry `resolved` URLs (multi). Mixed-namespace lockfiles per §"Mixed-namespace lockfiles" already permit per-entry registries; this section formalizes the resolution + trust contract.

```json
{
  "lockfileVersion": 1,
  "registry": "https://packs.example-corp.internal",
  "fallbackRegistries": [
    "https://packs.openwop.dev"
  ],
  "packs": [
    {
      "name": "vendor.example.internal-pack",
      "version": "1.0.0",
      "resolved": "https://packs.example-corp.internal/v1/packs/vendor.example.internal-pack/-/1.0.0.tgz",
      "integrity": "sha256-..."
    }
  ]
}
```

`fallbackRegistries[]` is an ordered list of registry base URLs. When a pack is not found in the primary registry's `index.json`, resolvers MUST consult each fallback in order. The first registry returning a `200` for the version manifest wins.

### Trust roots are per-registry

**Normative rule.** A signing key trusted by one registry is NOT automatically trusted by another. Each registry maintains its own `signingKeys[]` allow-list in `.well-known/openwop-registry.json` per its tier policy. Resolvers MUST verify a fetched pack's signature against the public key URL declared in THAT pack's version manifest (which points back at the issuing registry's `/keys/<keyId>.pub`), NOT against a globally-trusted key store.

Operationally:

1. Fetch the version manifest from registry R.
2. The manifest declares `signing.keyId` + `signing.publicKeyUrl`.
3. The resolver fetches the public key from R + verifies the signature against it.
4. R's discovery doc (`/.well-known/openwop-registry.json`) lists `signingKeys[]` with each key's `permittedNamespaces`. The resolver MUST also verify the pack's name matches the key's allow-list. Mismatch fails with `pack_signature_invalid` (canonical code from `node-packs.md`).

A private mirror that **rewrites** signatures (re-signing with the mirror's own key over the same tarball bytes) MUST also publish its own `signingKeys[]` entry permitting the rewritten pack's namespace. Resolvers see only what the mirror serves; the mirror's namespace allow-list IS the trust boundary.

### Federation does NOT imply trust transitivity

A workspace that includes `https://packs.openwop.dev` as a fallback does NOT thereby trust every key in that registry's `signingKeys[]`. The workspace declares which fallbacks to consult; the per-pack signature verification still happens against the fallback's declared trust root. An operator who wants to restrict to a subset of keys MUST mirror the packs into a private registry that only lists those keys.

### Offline behavior

Resolvers operating against an air-gapped workspace (no network) MUST:

1. Refuse to fall through to a network registry. Behaviour when no entry's `resolved` URL is reachable: fail with `pack_version_not_found` (canonical code from `node-packs.md`).
2. Verify integrity + signature against locally-cached bytes per the usual rules.
3. Honor lockfile pinning verbatim.

Workspaces destined for air-gapped operation SHOULD ship the tarballs + signatures alongside the lockfile (e.g., as a sealed archive). The protocol does not normate the archive format; that's deployer choice.

### Failure modes (additive codes)

In addition to the canonical codes in `node-packs.md` §"Failure modes", federated resolution adds:

- `pack_registry_unreachable` — a fallback registry returned a transport-layer error (timeout, DNS, connection refused). Caller MAY retry on a different fallback or fail closed.
- `pack_namespace_unauthorized` — a fetched pack's signature key is not allow-listed for the pack's namespace per the issuing registry's `signingKeys[]`. Indicates either misconfiguration or supply-chain tampering at the registry layer.

### Capability advertisement

Hosts that consume packs from a federated registry set MAY advertise the federation under `capabilities.packRegistry`:

```json
"packRegistry": {
  "primary": "https://packs.example-corp.internal",
  "fallbacks": ["https://packs.openwop.dev"],
  "offlineMode": false
}
```

This is informational — clients use it to understand which registries the host trusts, not to override the host's resolver behavior.

---

## Host-private marketplace relationship (non-normative example)

> **Non-normative.** This section illustrates how a host product can layer a private marketplace registry on top of the public openwop registry contract. The wire format is unchanged; only deployment-side details differ. An OpenWOP-compliant registry implementation does NOT need to support private-marketplace dual-resolution to claim conformance — this is host-extension territory.

A host product MAY ship private extension packages that ARE node packs but live in a host-controlled namespace. The pattern below is one such layering, illustrated using a hypothetical `acme.*` host marketplace; substitute any host name. The relationship is:

| Concern     | Public OpenWOP node packs                                                   | Host-private marketplace packs (example: `acme.*`)                                      |
| ----------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Registry    | `packs.openwop.dev` (and any compliant mirror)                              | Host-internal registry; not exposed to public openwop consumers                         |
| Namespace   | `core.*` (working group), `vendor.*` (vendor-claimed), `community.*` (open) | Private — typically `<host>.<surface>.*` (e.g., `acme.app-builder.tasks-card`)          |
| Publication | Anyone with namespace claim + `packs:publish` scope                         | Host-tenant admins via the host's admin panel                                           |
| Trust model | Layered (allowlist / pinned / verified / open) per consumer                 | Hosts typically run in `verified` mode; only signed packs from approved publishers load |
| Signing     | Sigstore / ed25519 / PGP                                                    | Host-rooted ed25519 chain                                                               |
| Wire format | Identical (`schemas/node-pack-manifest.schema.json`)                        | Identical                                                                               |

**The wire format is the same.** A host-private pack and a public openwop pack share the canonical `pack.json` shape; the difference is purely deployment-side (which registry serves it, which signing chain validates it). This means:

- A host tenant MAY mirror a public `vendor.*` pack into its private registry by re-signing with a host key (subject to the public pack's license).
- A host-private pack CANNOT be published to `packs.openwop.dev` without changing its name to a public namespace (e.g., `vendor.<host>.*` or `community.<host>-*`) and signing with a public-namespace key.
- Engine consumers running in host tenants consult both registries: host-internal first (for private packs), then `packs.openwop.dev` (for public packs the tenant has approved). Resolution order is operator-configurable.

**Safety boundary:** host-private packs MAY require capability declarations (per `capabilities.md` §"Runtime capabilities") that the public openwop engine doesn't advertise. A pack that declares `requires: ['<host>.canvas.write']` is unloadable in a non-host engine — that's the intended boundary.

Hosts can implement this pattern with a private namespace, a host-rooted signing chain, and an admin-controlled dual-resolution policy.

---

## Reference deployment

The hosted reference registry is live at [`packs.openwop.dev`](https://packs.openwop.dev) — Stage 1–4 operational maturity deployed 2026-05-12 (WIF auto-deploy, CycloneDX SBOMs, registry CVE feed + OSV scanning, Cloud Monitoring uptime check). As of 2026-06-28 it hosts 79 packs across four trust tiers (`core.openwop.*`, `community.openwop-team.*`, `vendor.openwop.*`, `vendor.myndhyve.*`). See [`docs/PACK-CATALOG.md`](../../docs/PACK-CATALOG.md) for the categorized inventory and [`ROADMAP.md`](../../ROADMAP.md) §"Hosted infrastructure" for the deployment status row.

Operator notes for self-hosted registries:

- **Storage:** any blob store (S3 / GCS / B2) holds the tarballs. Metadata can live in any DB; reference uses Postgres with a single `packs` table + `versions` index.
- **Compute:** stateless HTTP server (container service, function runtime, VM, etc.) sits in front of the storage + DB.
- **Auth:** any IdP that maps to API keys with scope vocabulary (`packs:publish`, `packs:yank`, `packs:yank-revert`).
- **Geographic distribution:** mirror via standard CDN (CloudFront, Cloudflare). The HTTP API is read-mostly + cache-friendly; only writes (publish / deprecate / yank / rotate) require origin reachability.

---

## See also

- `node-packs.md` — pack manifest format, registry HTTP API wire shapes, trust model layers, distribution + content-addressing.
- `auth.md` — `packs:publish` / `packs:yank` / `packs:yank-revert` scopes.
- `capabilities.md` — `runtimeCapabilities` advertisement that node packs may require.
- npm registry API: <https://docs.npmjs.com/cli/v10/configuring-npm/package-json> (idiom reference for deprecation flow + 72h unpublish window).
- Sigstore: <https://www.sigstore.dev/> (recommended signing method).
