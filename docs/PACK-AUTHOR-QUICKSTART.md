# OpenWOP Pack Author Quickstart

> **Status: v2.** This guide is the end-to-end path from "I want to publish a pack" to "my pack is live in the v2 tree of `packs.openwop.dev`". It is written for a first-time pack author who hasn't read the full corpus. The normative rules are [`spec/v2/core/packs.md`](../spec/v2/core/packs.md). Every command below was run against [`openwop/openwop-registry`](https://github.com/openwop/openwop-registry) `main` with a throwaway key.
>
> The registry is versioned by tree ([`packs.md`](../spec/v2/core/packs.md) §"The registry tree"). `registry/v1/…` is the frozen tree for v1 hosts through the overlap, and `registry/v2/…` is the tree this guide publishes to. The v1 version of this guide is in git history: `git show 4aa80535:docs/PACK-AUTHOR-QUICKSTART.md`.

A **pack** is a versioned, signed unit of nodes (and optionally agents, prompts, connections, and more). A workflow definition references it through `core.<…>`, `vendor.<…>`, or `community.<…>` typeIds. Packs let third-party authors extend OpenWOP without forking the protocol. Your pack lives in your repo, or in a pull request to the registry. You sign it with your key, and the public registry serves it to any OpenWOP host.

This page is the **author** path. For host-side consumption (signature verification, lockfile honoring, fail-closed behavior), see [`packs.md`](../spec/v2/core/packs.md) §Signing and [`schemas/v2/pack-lockfile.schema.json`](../schemas/v2/pack-lockfile.schema.json).

All commands run from a clone of the registry:

```bash
git clone https://github.com/openwop/openwop-registry.git
cd openwop-registry
```

---

## 0. Pick a tier and a name

| Tier | Who can publish | Use for |
| --- | --- | --- |
| `core.openwop.*` | Steward only | Framework-canonical primitives (`core.openwop.ai`, `core.openwop.http`, etc.) |
| `vendor.<org>.*` | The org named in the prefix | Vendor-specific tools (`vendor.acme.crm`) |
| `community.<group>.*` | Any group | Open-source community packs (`community.openwop-team.demo`) |
| `private.<org>.*` | Local development only | Pre-registry exploration. Never published |

The name pattern is `^(core|vendor|community|private)\.[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$` ([`schemas/v2/node-pack-manifest.schema.json`](../schemas/v2/node-pack-manifest.schema.json)). `local.*` is for in-repo packs that are never published, and it must not appear in any registry.

If you're new, start with `private.<your-team>.<pack>` locally, then move to `community.<your-group>.<pack>` for the public registry.

---

## 1. Create the pack source

Scaffold the pack from the registry's v2 template ([`templates/node-pack/`](https://github.com/openwop/openwop-registry/tree/main/templates/node-pack)):

```bash
node scripts/new-pack.mjs community.your-group.your-pack
```

```text
✓ pack source tree created at …/packs/community.your-group.your-pack
```

The script copies the template into `packs/<your-pack-name>/` and fills in the name. It then prints the build, stage and verify commands for your key. `--template <dir>` scaffolds from another source tree instead.

```text
packs/community.your-group.your-pack/
  pack.json      # the manifest
  index.mjs      # the node implementation
  schemas/       # config / input / output JSON Schemas per node
  README.md
  LICENSE
```

The scaffolded `pack.json` is already a v2 manifest ([`packs.md`](../spec/v2/core/packs.md)). Fill in `description`, `author`, `homepage`, `repository` and `keywords`, and replace the example node with your own. Keep it v2 while you edit:

- **`kind: "node"`** is required. v1's "absent means node" reading doesn't exist in v2.
- **`engines.openwop`** needs a `>=` lower bound and an explicit `<` major ceiling that admits 2, such as `">=1.0.0 <3.0.0"`. A v2 host treats a range with no upper bound as `<2.0.0` and refuses it with `pack_engine_unsupported`.
- **`peerDependencies`** keys are capability family keys from [`spec/v2/declaration.json`](../spec/v2/declaration.json), such as `aiEnvelope`, `secrets`, or `aiProviders`. A dotted v1 key (`host.aiEnvelope`) or a facet path isn't an identifier. Name facets in `peerDependenciesMeta.<family>.facets[]`. A key the declaration doesn't name gets `pack_peer_dependency_undefined`.
- **Don't add a `signing` block.** The build step writes the v2 block for you. The v1 block `{ method, keyId, signatureRef }` fails v2 validation.
- Set `version` (semver) and `nodes[]` (each with its `typeId`, `version`, and schema refs). When you bump `version`, bump the version segment of every schema `$id` in `schemas/` too.

```json
{
  "name": "community.your-group.your-pack",
  "version": "0.1.0",
  "kind": "node",
  "engines": { "openwop": ">=1.0.0 <3.0.0" },
  "runtime": { "language": "javascript", "entry": "index.mjs" },
  "peerDependencies": { "secrets": "required" },
  "peerDependenciesMeta": { "secrets": { "facets": ["resolveInPack"] } },
  "nodes": [ { "typeId": "community.your-group.your-pack.example", "version": "0.1.0", "…": "…" } ]
}
```

[`examples/packs/rust-hello/`](https://github.com/openwop/openwop-examples/tree/main/examples/packs/rust-hello) shows a v2 WASM pack manifest and loads in the in-memory example host. The registry's tarball builder also bundles the file `runtime.entry` names (openwop-registry #78), so a WASM pack publishes once its module is built. Runtimes are covered in [`spec/v2/core/node-pack-runtimes.md`](../spec/v2/core/node-pack-runtimes.md).

---

## 2. Generate a signing key

Pack signatures are Ed25519. Generate a keypair:

```bash
mkdir -p ~/.openwop-keys
openssl genpkey -algorithm Ed25519 -out ~/.openwop-keys/your-group-1.private.pem
openssl pkey -in ~/.openwop-keys/your-group-1.private.pem -pubout \
  -out registry/keys/your-group-1.pub
```

The public key (`registry/keys/your-group-1.pub`) goes into your publish PR. The private key never enters git.

Add your key to `signingKeys[]` in `registry/.well-known/openwop-registry.json`. Its `permittedNamespaces` must cover your prefix:

```json
{
  "keyId": "your-group-1",
  "algorithm": "ed25519",
  "publicKeyUrl": "/keys/your-group-1.pub",
  "permittedNamespaces": ["community.your-group.*"],
  "operator": "Your Group",
  "status": "active"
}
```

Keys are not protocol-versioned: one key signs in both trees.

---

## 3. Check the build

```bash
node scripts/build-pack-tarball.mjs --pack community.your-group.your-pack \
  --signed --key ~/.openwop-keys/your-group-1.private.pem --key-id your-group-1 \
  --tree v2 --scheme ed25519-canonical-json
```

```text
✓ community.your-group.your-pack@0.1.0 [signed ed25519-canonical-json]
  entries: 8  size: 5039b  sha256: a898722dfa584860…
```

This writes a deterministic tarball, the manifest, the signature, and the integrity hash to `dist/packs/`. It doesn't write to the registry tree. Use it to catch manifest errors before you publish:

- Leaving out `--scheme` under `--tree v2` is refused. There is exactly one v2 scheme and it has no default.
- A ceiling that doesn't admit major 2 is refused: `engines.openwop ">=1.0.0 <2.0.0" does not admit protocol major 2`.

**How v2 signing works.** The manifest's `signing` block is exactly `{ keyId, scheme: "ed25519-canonical-json" }`. The signature is a detached Ed25519 signature over the canonical (RFC 8785 JCS) bytes of `pack.json` inside the tarball. A signature over the tarball bytes, which was v1's `method: "ed25519"`, is not a v2 signature. Such a pack has to be re-signed, not relabeled ([`packs.md`](../spec/v2/core/packs.md) §Signing).

---

## 4. Stage the v2 artifacts

```bash
node scripts/auto-register.mjs --tree v2 \
  --key-file ~/.openwop-keys/your-group-1.private.pem --key-id your-group-1 \
  --scheme ed25519-canonical-json
```

```text
auto-register [v2]: staged 1 pack(s); registry/v2/index.json + per-pack indexes + SBOMs written. Commit.
```

This command signs only packs in the namespaces your key is permitted in `signingKeys[]`. It lists every other pack as belonging to another key and leaves it alone. For your pack it stages the following:

```text
registry/v2/packs/community.your-group.your-pack/-/0.1.0.json       # version manifest (integrity + signing)
registry/v2/packs/community.your-group.your-pack/-/0.1.0.tgz        # the pack archive
registry/v2/packs/community.your-group.your-pack/-/0.1.0.sig        # detached Ed25519 signature
registry/v2/packs/community.your-group.your-pack/-/0.1.0.sbom.json  # CycloneDX SBOM
registry/v2/packs/community.your-group.your-pack/index.json         # per-pack index
registry/v2/index.json, registry/v2/sbom.json                        # registry-wide index + aggregate SBOM
registry/community.your-group.your-pack/0.1.0/*.json                 # the node schemas, served for $ref
```

The registry's `registry-v2-sign` CI job runs this same script with the first-party `openwop-team-1` key. It leaves `community.*` and other vendors' namespaces to their own publishers, who run it with their own keys as above.

---

## 5. Verify locally

```bash
node registry/scripts/verify-signatures.mjs --tree v2
```

```text
✓ community.your-group.your-pack@0.1.0  (keyId=your-group-1, over=pack.json (ed25519-canonical-json), operator=Your Group)
✓ verified 199 signed pack(s) [v2]
```

This is one of the checks the registry's `.github/workflows/registry-publish.yml` runs on your PR. Run the rest locally with the registry's own gate:

```bash
npm install   # once, for the schema checks
npm run check
```

```text
=== registry:check OK ===
```

`npm run check` (`scripts/registry-check.sh`) checks the v1 tree, then the v2 tree. The v2 leg covers:

- index drift
- tarball signatures and signer consistency
- namespace authority
- structural conformance
- SBOM drift
- advisories
- the vendored v2 schemas
- the engines ceiling
- peer-dependency identifiers
- the corpus manifest schema for every source and served pack

Your scaffolded source is validated even before you stage it.

---

## 6. Local-host smoke

No v2 example host executes third-party pack code today. The [v2 reference host](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/v2-reference) validates a pack without running it: it checks the engines ceiling, peer-dependency keys, and the vendor hatch. It accepts the pack through its conformance seam `PUT /conformance/seams/packs-test/{name}/-/{version}.tgz` (its README, "The surfaces" item 9). The in-memory host has no pack surface. To exercise your nodes inside runs, use a host that advertises `packs` and a `sandbox` in its v2 discovery document.

---

## 7. Publish the PR

The public registry uses pull-request-driven publishing. `packs.openwop.dev` has no upload API. Open the PR against [`openwop/openwop-registry`](https://github.com/openwop/openwop-registry). It includes:

1. The pack source under `packs/<name>/`.
2. Everything step 4 staged under `registry/v2/…` and `registry/<name>/<version>/`.
3. The public key under `registry/keys/<keyId>.pub` (once per author).
4. Your `signingKeys[]` entry in `registry/.well-known/openwop-registry.json` (once per author). A maintainer reviews the namespace grant.

Merging requires a maintainer's review. After the merge, the registry redeploys, and the pack is served at the v2 endpoints named in `/.well-known/openwop-registry` `endpoints.v2`: `https://packs.openwop.dev/v2/packs/<name>/-/<version>.tgz` and its `.json` / `.sig` / `.sbom.json` siblings. Clients must resolve registry paths through `endpoints`, not construct them ([`packs.md`](../spec/v2/core/packs.md) §"The registry tree").

---

## 8. Lifecycle (post-publish)

### Bump a version

For a non-breaking change, bump `version` in `pack.json` (for example `0.1.0` → `0.1.1`) and re-run steps 3–5. Commit the new artifacts and open a new PR. Don't delete old versions: existing lockfiles pin them.

### Deprecate a version

Set `"versionDeprecated": true` on the version manifest. The v1 name `deprecated` fails the closed v2 schema. The registry keeps serving the version, and a consumer may refuse to install it ([`packs.md`](../spec/v2/core/packs.md) §"Version manifests").

### Yank a version

For a serious bug or security issue, set `"yanked": true` on the version manifest and its row in the per-pack `index.json`. For a yanked version, the registry must refuse to serve the tarball and consumers must refuse to dispatch its nodes ([`schemas/v2/registry-version-manifest.schema.json`](../schemas/v2/registry-version-manifest.schema.json)). Document the reason in the PR description.

### Rotate your signing key

For long-lived packs, rotate the key:

1. Generate a new keypair (`your-group-2`).
2. Sign new pack versions with the new key.
3. Keep both `your-group-1.pub` and `your-group-2.pub` in `registry/keys/` indefinitely, so older versions stay verifiable.
4. In `signingKeys[]`, mark the old key `status: "rotated"` and add the new key as `active`.

v2 core doesn't restate the registry's operational flows (submission, yank, rotation, federation). The v1 description is [`spec/v1/registry-operations.md`](../spec/v1/registry-operations.md).

---

## What you should NOT do

- **Don't claim `core.*` or someone else's `vendor.*` / `community.*` prefix.** `permittedNamespaces` in `registry/.well-known/openwop-registry.json` is the security boundary, and a verifier checks every pack name against its signing key ([`packs.md`](../spec/v2/core/packs.md) §Signing). Maintainer review will reject your PR.
- **Don't put credentials, API keys, or hardcoded secrets in your pack.** Declare the `secrets` family with the `resolveInPack` facet (`peerDependenciesMeta`), and let the host resolve secrets at run time ([`capabilities.md`](../spec/v2/core/capabilities.md) § secrets).
- **Don't break replay determinism.** Your nodes should produce the same outputs for the same inputs, and they should read time through `ctx.now()`. Non-determinism breaks `POST /runs/{runId}:fork` in `replay` mode for everyone downstream ([`replay.md`](../spec/v2/core/replay.md) §"Determinism caveats").
- **Don't depend on a specific host runtime topology.** Pack code runs in whatever sandbox the host provides. Assuming Node 20 plus filesystem and network access breaks hosts with stricter runtimes.
- **Don't treat vendor-hatch properties as trusted.** Properties matching `^(openwop-|x-|vendor\.)` are pack-authored. Consumers ignore the ones they don't recognize and treat all of them as untrusted.

---

## Recommended first pack

A safe first community pack has one node, wraps one tool, uses no external secrets, and makes no AI calls. Examples: a Markdown-table formatter, a date-difference calculator, or a base64 encoder/decoder. Stay under 100 lines of code, ship it, and iterate.

---

## See also

- [`spec/v2/core/packs.md`](../spec/v2/core/packs.md): engines ceiling, registry tree, peer-dependency identifiers, signing, and version manifests (normative).
- [`spec/v2/core/node-pack-runtimes.md`](../spec/v2/core/node-pack-runtimes.md): runtime languages, WASM, and the sandbox.
- [`schemas/v2/node-pack-manifest.schema.json`](../schemas/v2/node-pack-manifest.schema.json): the manifest schema.
- [`schemas/v2/registry-version-manifest.schema.json`](../schemas/v2/registry-version-manifest.schema.json): the version manifest schema.
- [`schemas/v2/pack-lockfile.schema.json`](../schemas/v2/pack-lockfile.schema.json): the workspace lockfile schema.
- [`spec/v2/peer-dependency-aliases.json`](../spec/v2/peer-dependency-aliases.json): the v1 peer-dependency keys a v2 host may still resolve through the overlap.
- [`registry/scripts/verify-signatures.mjs`](https://github.com/openwop/openwop-registry/blob/main/registry/scripts/verify-signatures.mjs): the canonical signature verifier.
- [`docs/IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md): for host authors rather than pack authors.
- [`docs/recruitment/external-pack-author.md`](./recruitment/external-pack-author.md): the steward's outreach playbook.
