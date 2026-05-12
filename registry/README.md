# `packs.openwop.dev` — openwop node-pack registry MVP

Read-only static registry serving signed openwop node packs. Backed by Firebase Hosting (`packs` target in `firebase.json`). Submissions land via maintainer PR; CI validates manifest + integrity + signature before merging; merge-to-`main` triggers deploy.

This directory is the deploy root. Everything under `registry/` is served at `https://packs.openwop.dev/` modulo the rewrites declared in `firebase.json`.

## Layout

```
registry/
├── README.md                           (this file — excluded from deploy)
├── .well-known/
│   └── openwop-registry.json           served at /.well-known/openwop-registry (rewritten)
├── v1/
│   ├── index.json                      served at /v1/index.json (registry-wide listing)
│   └── packs/
│       └── <pack-name>/
│           ├── index.json              served at /v1/packs/<pack-name> (rewritten)
│           └── -/
│               ├── <version>.json      version manifest
│               ├── <version>.tgz       signed pack tarball
│               ├── <version>.sig       signature (ed25519 or sigstore bundle)
│               └── <version>.sbom.json CycloneDX 1.6 SBOM (files, hashes, peer deps)
├── keys/
│   └── <keyId>.pub                     signing public key(s); served at /keys/<keyId>.pub
└── scripts/                            local dev only — excluded from deploy
    ├── build-index.mjs                 regenerates index/aggregate JSON from on-disk packs
    ├── generate-sbom.mjs               writes per-version + aggregate CycloneDX SBOMs
    ├── verify-signatures.mjs           crypto-verifies every published Ed25519 signature
    ├── conformance-check.mjs           structural conformance for every pack
    └── serve.mjs                       local-dev HTTP server mirroring Firebase rewrites
```

## URL endpoints

Per `spec/v1/node-packs.md` §"Registry HTTP API" + `spec/v1/registry-operations.md`:

| URL | Returns |
|---|---|
| `GET /.well-known/openwop-registry` | Discovery metadata (registry version, supported namespaces, endpoints). |
| `GET /v1/index.json` | Registry-wide pack listing for search/browse UIs. |
| `GET /v1/packs/{name}/index.json` | Pack metadata + version list (aggregate). |
| `GET /v1/packs/{name}/-/{version}.json` | Version manifest. |
| `GET /v1/packs/{name}/-/{version}.tgz` | Signed pack tarball. |
| `GET /v1/packs/{name}/-/{version}.sig` | Signature for the tarball. |
| `GET /keys/{keyId}.pub` | Registry signing public key. |
| `GET /v1/packs/{name}/-/{version}.sbom.json` | Per-version SBOM (CycloneDX 1.6). |
| `GET /v1/sbom.json` | Aggregate SBOM listing every published version. |

**Discovery is authoritative.** Clients SHOULD substitute `{name}` / `{version}` into the templates declared in `.well-known/openwop-registry` `endpoints` rather than hardcoding paths. Filesystem-backed registries (this one and other static-CDN deployments) serve pack metadata at `/index.json` because CDN URL-rewrite engines don't reliably match dot-containing path segments — clients reach the abstract `/v1/packs/{name}` endpoint described by `node-packs.md` via the discovery template.

Write endpoints (`PUT /v1/packs/{name}/-/{version}.tgz`) are NOT supported by this MVP. Publish via the maintainer PR flow below.

## Publish flow

Read-only registry — submissions go through GitHub PRs. The CI gate at `.github/workflows/registry-publish.yml` validates each submission before merge; merge-to-`main` triggers Firebase deploy.

### 1. Build the pack

For a Rust WASM pack:

```bash
cd examples/packs/rust-hello
cargo build --target wasm32-unknown-unknown --release
```

Output: `target/wasm32-unknown-unknown/release/rust_hello.wasm`.

Bundle into a tarball:

```bash
mkdir -p staging/dist
cp pack.json staging/
cp README.md staging/
cp target/wasm32-unknown-unknown/release/rust_hello.wasm staging/dist/
tar -czf rust_hello-1.0.0.tgz -C staging .
```

### 2. Sign

Manual Ed25519 (until sigstore is wired in v1.2):

```bash
openssl pkeyutl -sign -inkey ~/.openwop/openwop-registry-root.key \
  -in rust_hello-1.0.0.tgz -out rust_hello-1.0.0.sig
```

### 3. Commit

Copy artifacts into the registry tree at the correct paths:

```bash
cp rust_hello-1.0.0.tgz registry/v1/packs/vendor.openwop.rust-hello/-/1.0.0.tgz
cp rust_hello-1.0.0.sig registry/v1/packs/vendor.openwop.rust-hello/-/1.0.0.sig
```

### 4. Rebuild indices + SBOM

```bash
node registry/scripts/build-index.mjs
node registry/scripts/generate-sbom.mjs
```

`build-index.mjs` recomputes the `integrity` (sha256) field on every version manifest, regenerates the per-pack `index.json`, and regenerates the registry-wide `v1/index.json`.

`generate-sbom.mjs` writes a sibling `<version>.sbom.json` (CycloneDX 1.6) for every pack version and the aggregate `v1/sbom.json`. Output is deterministic — re-runs without source changes are no-ops. CI runs `--check` mode and fails the PR if any SBOM bytes drift from the committed file.

### 5. Open a PR

CI will:

1. Validate every JSON file parses + every version manifest matches `schemas/registry-version-manifest.schema.json`.
2. Verify `build-index.mjs --check` is clean (no drift between manifests and tarball hashes).
3. Verify every `.tgz` has a sibling `.sig`.
4. Crypto-verify each `.sig` against the registered publisher key per `signingKeys[]` (namespace-scoped).
5. Run structural conformance check on every pack (`conformance-check.mjs`).
6. Verify SBOMs are up-to-date (`generate-sbom.mjs --check`).

On merge to `main`, the `deploy` job pushes the directory to Firebase Hosting under the `packs` target. New artifacts become live at `https://packs.openwop.dev/v1/packs/...` within a minute.

## Local development

Boot the static server (mirrors Firebase rewrites):

```bash
node registry/scripts/serve.mjs
# [registry-dev] serving /…/registry at http://127.0.0.1:4319
```

Probe:

```bash
curl http://127.0.0.1:4319/.well-known/openwop-registry
curl http://127.0.0.1:4319/v1/packs/vendor.openwop.rust-hello
curl http://127.0.0.1:4319/v1/packs/vendor.openwop.rust-hello/-/1.0.0.json
```

Hosts loading from this local server: set `OPENWOP_REGISTRY_URL=http://127.0.0.1:4319` (when host-side configuration supports it; the reference in-memory host doesn't read from registries yet — that's v1.2 work).

## Signing keys + namespace assignments

The registry advertises its keychain through the `signingKeys` array in `.well-known/openwop-registry.json`. Each entry binds a `keyId` to a permitted-namespace allow-list, so the PR review gate can reject submissions where the signing key isn't authorized for the target namespace.

| keyId | Operator | Permitted namespaces | Status |
|---|---|---|---|
| `openwop-registry-root` | openwop project | `core.openwop.*`, `community.openwop-team.*`, `vendor.openwop.*` | active (sealed; emergency only) |
| `openwop-team-1` | openwop team | `core.openwop.*`, `community.openwop-team.*`, `vendor.openwop.*` | active (online publishing key) |
| `myndhyve-internal-1` | MyndHyve | `vendor.myndhyve.*` | active (first external vendor) |

**Adding a new publisher key** (e.g., a new vendor onboarding):

1. Vendor generates an Ed25519 keypair locally (`openssl genpkey -algorithm ed25519`). Private key STAYS WITH THE VENDOR — never committed.
2. Vendor opens a PR adding their `.pub` to `registry/keys/<keyId>.pub` + a `signingKeys` entry + a `namespaceAssignments` entry in `.well-known/openwop-registry.json`.
3. Registry maintainer reviews + merges. Subsequent packs under the claimed namespace are signed by the vendor's key + verified against the registered `.pub` at publish-time review.

Per `spec/v1/registry-operations.md` §Step 1: `vendor.<org>.*` packs MUST be refused if their signing key isn't the one registered for that namespace. The CI gate enforces presence-of-signature today; cryptographic verification against the namespace-permitted key lands when the `node-pack-manifest.schema.json` registry-side schema is finalized.

## Key ceremony

The `openwop-registry-root` key is the root of trust for everything signed by this registry. Generation:

```bash
# Generate on an air-gapped or otherwise isolated machine.
openssl genpkey -algorithm ed25519 -out openwop-registry-root.key
openssl pkey -in openwop-registry-root.key -pubout -out openwop-registry-root.pub

# Commit only the public key.
cp openwop-registry-root.pub registry/keys/

# The private key MUST be stored offline (hardware token, sealed envelope,
# operator's encrypted backup). The registry never holds the private key
# online; signing happens before commits.
```

The public key file is committed to the registry and served at `https://packs.openwop.dev/keys/openwop-registry-root.pub`. Consumers verify pack signatures against this key.

Key rotation procedure (per `spec/v1/registry-operations.md` §"Key rotation"):

1. Generate a new key (`openwop-registry-2027`, dated).
2. Commit the new public key alongside the old one.
3. Update `.well-known/openwop-registry.json` to list both keys.
4. Begin signing new submissions with the new key.
5. After the grace window declared in the registry metadata, retire the old key.

## Trust model

Consumers operating in `verified` mode (per `spec/v1/node-packs.md` §"Trust model") MUST:

1. Fetch the registry's public key from `/keys/{keyId}.pub`.
2. Verify the tarball signature against it before unpacking.
3. Refuse packs whose `integrity` hash doesn't match the tarball bytes.
4. Refuse packs flagged `yanked: true` in the registry index.

Consumers operating in `trusted` mode skip steps 1–2 but should still honor integrity + yank flags.

## Provisioning notes (operators)

To deploy this registry for the first time:

1. The Firebase Hosting site `packs-openwop-dev` must exist under project `openwop-dev`. Create via:
   ```bash
   firebase hosting:sites:create packs-openwop-dev
   firebase target:apply hosting packs packs-openwop-dev
   ```
   The second command writes the mapping declared in `.firebaserc`.

2. Custom domain `packs.openwop.dev` must be wired to the `packs-openwop-dev` site in the Firebase Console (Hosting → Add custom domain). DNS records (A/AAAA) are issued by Firebase.

3. **CI deploy auth via Workload Identity Federation (no downloadable SA keys).** The `openwop-dev` project enforces `iam.disableServiceAccountKeyCreation` — long-lived SA JSON keys can't be issued. Instead, GitHub Actions authenticates with its OIDC token through a WIF pool. One-time setup:

   ```bash
   # 1. Create the WIF pool.
   gcloud iam workload-identity-pools create github \
     --location=global --project=openwop-dev \
     --display-name="GitHub Actions"

   # 2. Create the GitHub OIDC provider. The `attribute-condition`
   #    locks the provider to repositories owned by the `openwop` org
   #    so a compromised workflow in another org can't impersonate.
   gcloud iam workload-identity-pools providers create-oidc github-actions \
     --location=global --workload-identity-pool=github \
     --project=openwop-dev \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
     --attribute-condition='assertion.repository_owner=="openwop"'

   # 3. Bind the deploy SA so only the openwop/openwop repo can
   #    impersonate it. principalSet membership is enforced by IAM —
   #    no chance of cross-repo escalation.
   PROJECT_NUMBER=$(gcloud projects describe openwop-dev --format='value(projectNumber)')
   gcloud iam service-accounts add-iam-policy-binding \
     github-action-1224821216@openwop-dev.iam.gserviceaccount.com \
     --project=openwop-dev \
     --role="roles/iam.workloadIdentityUser" \
     --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/openwop/openwop"
   ```

   The deploy SA needs `roles/firebasehosting.admin` on `openwop-dev` (already granted). The workflow at `.github/workflows/registry-publish.yml` calls `google-github-actions/auth@v2` with the pool's `workload_identity_provider` URL — no repo secret required.

## See also

- [`spec/v1/node-packs.md`](../spec/v1/node-packs.md) — pack manifest format + registry HTTP API
- [`spec/v1/registry-operations.md`](../spec/v1/registry-operations.md) — operator-side lifecycle (submission, deprecation, yank, key rotation)
- [`RFCS/0008-wasm-abi.md`](../RFCS/0008-wasm-abi.md) — WASM pack ABI (the `rust-hello` pack hosted here exercises this)
- [`examples/packs/rust-hello/README.md`](../examples/packs/rust-hello/README.md) — the reference WASM pack
- [`.github/workflows/registry-publish.yml`](../.github/workflows/registry-publish.yml) — CI gate + deploy job
