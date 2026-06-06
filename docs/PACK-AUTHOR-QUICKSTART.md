# OpenWOP Pack Author Quickstart

> DOC-4 + PACK-5 from `plans/openwop-protocol-gap-closure-plan.md`. End-to-end path from "I want to publish a pack" to "my pack is live on `packs.openwop.dev`". Targets a first-time pack author who hasn't read the full corpus.

A **pack** is a versioned, signed unit of nodes (and optionally agents) that a workflow definition references via `core.<…>` / `vendor.<…>` / `community.<…>` typeIds. Packs let third-party authors extend OpenWOP without forking the protocol — your pack lives in your repo (or a pull request to the registry), gets signed with your key, and is served from the public registry for any OpenWOP host to consume.

This page is the **author** path. For host-side consumption (signature verification, lockfile honoring, fail-closed behavior), see [`examples/hosts/postgres/src/pack-consumer.ts`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/src/pack-consumer.ts) (PACK-1 reference impl).

---

## 0. Pick a tier + name

| Tier | Who can publish | Use for |
|---|---|---|
| `core.openwop.*` | Steward only | Framework-canonical primitives (`core.openwop.ai`, `core.openwop.http`, etc.) |
| `vendor.<org>.*` | The org named in the prefix | Vendor-specific tools (`vendor.acme.crm`) |
| `community.<group>.*` | Any group | Open-source community packs (`community.openwop-team.demo`) |
| `private.<org>.*` | Local development only | Pre-registry exploration; NEVER published |

Reverse-DNS-style names per [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) §Naming. Your pack name pattern: `^(core|vendor|community|private)\.[a-z][a-z0-9_-]*(\.[a-z][a-zA-Z0-9_-]*)+$`.

If you're new: start with `private.<your-team>.<pack>` locally, then move to `community.<your-group>.<pack>` for the public registry.

---

## 1. Generate the pack skeleton

```bash
node scripts/new-pack.mjs --name community.your-group.your-pack --tier community
```

This produces:

```
packs/community.your-group.your-pack/
  pack.json              # the manifest
  README.md              # author-facing docs
  nodes/                 # one file per node typeId
    your-node.json       # node manifest (schema, runtime, etc.)
```

Edit `pack.json` to declare:

- `name` — full pack name (matches the directory)
- `version` — semver (e.g., `0.1.0`)
- `nodes[]` — list of typeIds your pack contributes
- `dependencies` (optional) — other packs you depend on, with semver ranges
- `signing.keyId` — the keyId you'll sign with (configured in step 2)
- `runtime` — `"javascript"` / `"wasm"` (per RFC 0008) / `"agent-only"`

The [`examples/packs/vendor-template/`](https://github.com/openwop/openwop-examples/tree/main/examples/packs/vendor-template) shows the canonical shape. The [`examples/packs/rust-hello/`](https://github.com/openwop/openwop-examples/tree/main/examples/packs/rust-hello) shows a WASM pack end-to-end.

---

## 2. Generate a signing key

Pack signatures are Ed25519. Generate a keypair:

```bash
mkdir -p ~/.openwop-keys
openssl genpkey -algorithm Ed25519 -out ~/.openwop-keys/your-group-1.private.pem
openssl pkey -in ~/.openwop-keys/your-group-1.private.pem -pubout \
  -out ~/.openwop-keys/your-group-1.pub
```

The public key file (`your-group-1.pub`) gets committed to the registry's `registry/keys/` directory in your publish PR. The private key NEVER enters git — keep it under `~/.openwop-keys/` per the steward's convention.

For per-publisher namespace authorization, the registry's `registry/.well-known/openwop-registry.json` `signingKeys[]` array MUST list your keyId with `permittedNamespaces` scoped to your tier prefix (e.g., `community.your-group.*`). Your publish PR adds this entry.

---

## 3. Build + sign the tarball

```bash
node scripts/build-pack-tarball.mjs --pack community.your-group.your-pack --signed --key-id your-group-1
```

This emits:

```
registry/v1/packs/community.your-group.your-pack/-/0.1.0.tgz   # the pack archive
registry/v1/packs/community.your-group.your-pack/-/0.1.0.sig   # detached Ed25519 signature
registry/v1/packs/community.your-group.your-pack/-/0.1.0.json  # version manifest with integrity + signing.keyId
```

The signature is over the canonical `pack.json` bytes inside the tarball (per the `signing.method: "manual"` convention) OR over the whole tarball (per `signing.method: "ed25519"`). Use the latter for simpler verification.

---

## 4. Generate the SBOM

```bash
node scripts/build-pack-tarball.mjs --pack community.your-group.your-pack --sbom
```

Emits `0.1.0.sbom.json` alongside the tarball. CycloneDX-format SBOM — used by the registry's CVE scanner per [`spec/v1/registry-operations.md`](../spec/v1/registry-operations.md).

---

## 5. Validate against the schema

```bash
node scripts/precheck-packs.mjs --pack community.your-group.your-pack
```

Checks:

- `pack.json` validates against `schemas/node-pack-manifest.schema.json`
- Every node manifest validates against the canonical node schema
- `signing.keyId` matches a key in `registry/.well-known/openwop-registry.json`
- `permittedNamespaces` allows the pack's namespace
- Tarball integrity (`integrity: sha256-…`) matches actual bytes
- Ed25519 signature verifies against the public key

Run the registry-wide verifier to make sure nothing else broke:

```bash
node registry/scripts/verify-signatures.mjs
```

This is the CI gate that the registry-publish workflow runs.

---

## 6. Local-host smoke

Boot a reference host with your pack mounted:

```bash
# in-memory host can side-load packs via the local filesystem
cd examples/hosts/in-memory
OPENWOP_PACK_DIR=../../../packs npm start
```

Run a workflow that references your typeId. The host loads your pack from disk, verifies signature against the local public key, and routes typeId calls into your node implementation.

For Postgres host (production-shape) consumption via a lockfile, see [`examples/core-packs-lockfile/`](https://github.com/openwop/openwop-examples/tree/main/examples/core-packs-lockfile) for the canonical lockfile structure + [`examples/hosts/postgres/src/pack-consumer.ts`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/src/pack-consumer.ts) for the install-time security pass.

---

## 7. Publish the PR

The public registry uses pull-request-driven publishing — there is no upload API. Your PR includes:

1. The new pack's source under `packs/<name>/` (if you want it tracked in this repo).
2. The pre-built artifacts under `registry/v1/packs/<name>/-/<version>.{tgz,sig,json,sbom.json}`.
3. The public key under `registry/keys/<keyId>.pub` (one-time per author).
4. The `signingKeys[]` entry in `registry/.well-known/openwop-registry.json` (one-time per author).
5. An updated `registry/v1/index.json` row (the registry's index manifest).

The CI gate at `.github/workflows/registry-publish.yml` runs `node registry/scripts/verify-signatures.mjs` over every published pack — if your signature doesn't verify, your PR is blocked. Merge requires a maintainer's review.

After merge, `proxy.golang.org`-style caches eventually warm; the pack is available at `https://packs.openwop.dev/v1/packs/<name>/-/<version>.tgz` typically within minutes.

---

## 8. Lifecycle (post-publish)

### Version a bump

For a non-breaking change, bump `version` in `pack.json` (e.g., `0.1.0` → `0.1.1`), re-run steps 3-5, commit the new artifacts (don't delete old ones — packs are immutable per `registry-operations.md`), and open a new PR.

### Deprecate a version

Add `"deprecated": true` to the version manifest. Hosts SHOULD warn on consumption but MUST still resolve the version (don't break existing lockfiles).

### Yank a version

For a serious bug or security issue, mark the version `"yanked": true` in `registry/v1/packs/<name>/index.json`. Hosts that honor yank MUST refuse to install yanked versions. Document yank reasons in the PR description.

### Rotate your signing key

For long-lived packs, rotate the key:

1. Generate a new keypair (`your-group-2`).
2. Sign new pack versions with the new key.
3. Keep both `your-group-1.pub` and `your-group-2.pub` in `registry/keys/` indefinitely (older versions stay verifiable).
4. Update `signingKeys[]` to mark the old key `status: "rotated"` and add the new key as `active`.

---

## What you should NOT do

- **Don't unilaterally claim core.\* or someone else's vendor.\* / community.\* prefix.** The namespace allow-list in `registry/.well-known/openwop-registry.json` is the protocol-tier security boundary. Maintainer review will reject your PR.
- **Don't publish credentials, API keys, or hardcoded secrets in your pack.** Use the host's `secrets.resolveInPack` surface (per RFC 0004 + `host-capabilities.md` §host.secrets).
- **Don't break replay determinism.** Your nodes should produce the same outputs given the same inputs — non-determinism breaks `POST /v1/runs/{id}:fork` for downstream consumers.
- **Don't make your pack depend on a specific host runtime topology.** Pack-loaded code runs in whatever sandbox the host provides; assuming Node 20 + filesystem + network breaks hosts on stricter runtimes.

---

## Recommended first pack

A safe shape for a first community pack: **one node, one tool wrapper, no external secrets, no AI calls**. E.g., a Markdown-table formatter, a date-difference calculator, a base64 encoder/decoder. Stay under 100 LOC; ship it; iterate.

The [`examples/packs/rust-hello/`](https://github.com/openwop/openwop-examples/tree/main/examples/packs/rust-hello) is the canonical "hello world" — a Rust WASM pack with one typeId that echoes input. Read it before you build.

---

## See also

- [`docs/IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md) — for host authors (not pack authors).
- [`docs/recruitment/external-pack-author.md`](./recruitment/external-pack-author.md) — the steward's outreach playbook.
- [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) — normative manifest format + signing recipe + dependency resolution.
- [`spec/v1/registry-operations.md`](../spec/v1/registry-operations.md) — registry submission / yank / rotation / federation flows.
- [`schemas/node-pack-manifest.schema.json`](../schemas/node-pack-manifest.schema.json) — manifest schema.
- [`schemas/pack-lockfile.schema.json`](../schemas/pack-lockfile.schema.json) — workspace lockfile schema.
- [`registry/scripts/verify-signatures.mjs`](https://github.com/openwop/openwop-registry/blob/main/registry/scripts/verify-signatures.mjs) — canonical signature verifier (same algorithm hosts run at install time).
- [`examples/packs/rust-hello/`](https://github.com/openwop/openwop-examples/tree/main/examples/packs/rust-hello) — canonical reference pack.
- [`examples/packs/vendor-template/`](https://github.com/openwop/openwop-examples/tree/main/examples/packs/vendor-template) — template skeleton.
- [`examples/core-packs-lockfile/`](https://github.com/openwop/openwop-examples/tree/main/examples/core-packs-lockfile) — canonical lockfile pinning.
