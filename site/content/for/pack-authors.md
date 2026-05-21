# For pack authors

You're packaging reusable workflow components — node implementations, agent definitions, or chained workflow templates — for other OpenWOP users to consume. This page covers the manifest shape, the signing recipe, the namespace tiers, and how to publish to the canonical registry.

## What a pack is

An OpenWOP pack is a signed tarball containing:

- A `pack.json` manifest declaring the pack name, version, and the types it exports.
- One or more node implementations (TypeScript, Python, Go, or pre-compiled WASM).
- Optional agent manifests (per [RFC 0003](/rfcs/0003-agent-packs.html)).
- A detached Ed25519 signature over the tarball bytes.

Hosts consume packs at install time, verify the signature against the publisher's public key, and register the declared types in their node catalog. The host's pack-consumer reference implementation is at [`examples/hosts/postgres/src/pack-consumer.ts`](https://github.com/openwop/openwop/tree/main/examples/hosts/postgres/src/pack-consumer.ts) — it's the canonical install-time security check (lockfile parse, SRI integrity, version-drift detection, Ed25519 signature verification).

## Read these first

- [Node packs](/spec/v1/node-packs.html) — pack format, manifest schema, dependency resolution, lockfile semantics, signing recipe.
- [Workflow chain packs](/spec/v1/workflow-chain-packs.html) — composing reusable multi-step workflow templates (RFC 0013).
- [Registry operations](/spec/v1/registry-operations.html) — submission, signing, deprecation, yank, key rotation.
- [`agent-manifest.schema.json`](https://github.com/openwop/openwop/blob/main/schemas/agent-manifest.schema.json) — agent pack manifest shape (RFC 0003).

## Namespace tiers

Packs are partitioned into three tiers. The tier is part of the pack identifier; there's no implicit promotion.

| Tier | Publishing rule | Signing root | Example |
|---|---|---|---|
| `core.*` | OpenWOP-maintained; canonical baseline | `openwop-registry-root` | `core.openwop.http` |
| `vendor.*` | Named vendor; signed against the registry root with a vendor subkey | `openwop-registry-root` → vendor subkey | `vendor.myndhyve.canvas` |
| `community.*` | Open publishing via PR; maintainer-controlled signing keys | per-publisher Ed25519 keypair | `community.openwop-team.demo` |

Host-private deployments can additionally use `private.*` — these never enter the public registry.

## Sign your tarball

The canonical signing recipe (per [`node-packs.md`](/spec/v1/node-packs.html) §"Signing recipe") is:

1. Pack the tarball bytes (`npm pack` or equivalent).
2. Compute the SRI integrity (`sha512-…`) of the tarball.
3. Sign the tarball bytes with an Ed25519 private key.
4. Submit the `.tgz` + the `.sig` + a manifest referencing both, with the SRI integrity matching the tarball.

A reference workflow lives at [`scripts/build-pack-tarball.mjs`](https://github.com/openwop/openwop/blob/main/scripts/build-pack-tarball.mjs) — you can mine it for the canonical command sequence.

## Publish to the canonical registry

The reference registry at [`packs.openwop.dev`](https://packs.openwop.dev/) has no write API by design. Publishing is via PR against [`openwop/openwop`](https://github.com/openwop/openwop):

1. Fork the repo.
2. Add your pack tarball + signature + manifest under the appropriate namespace tier.
3. Add a row to the registry index (`registry/v1/index.json`) via the canonical generator script.
4. Open a PR with the conventional commit prefix `feat(registry):`.

The registry rebuilds on merge. Your pack URL resolves under `/v1/packs/{name}/-/{version}.tgz` immediately.

## Publish to a private registry

You can stand up your own OpenWOP registry by serving the discovery doc + the pack URLs over HTTPS. The discovery shape is defined at [`registry-operations.md`](/spec/v1/registry-operations.html) §"Discovery document." Hosts that point at your registry will consume your packs identically to the canonical one.

Use cases: tenant-scoped private packs, air-gapped deployments, enterprise compliance ("our packs never leave our network").

## Common pitfalls

- **Don't reuse a signing key across publishers.** Each `community.<publisher>.*` pack should use a publisher-scoped Ed25519 keypair.
- **Pin your dependencies.** Pack-to-pack dependencies are resolved via lockfile; install-time integrity checks fail closed on version drift.
- **Honor SR-1.** If your nodes touch secrets, follow the [secret-redaction invariant](https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml) — never put raw secrets in node outputs or event payloads.
- **Bump majors honestly.** A pack version bump that changes node input/output shapes is a breaking change; downstream workflows must be able to pin to the prior major.

## Next steps

| Action | Where |
|---|---|
| Read the node-pack spec | [/spec/v1/node-packs.html](/spec/v1/node-packs.html) |
| Browse the registry | [packs.openwop.dev ↗](https://packs.openwop.dev/) |
| See an example pack | [`registry/v1/packs/core.openwop.examples/` ↗](https://github.com/openwop/openwop/tree/main/registry/v1/packs/core.openwop.examples) |
| Open a publishing PR | [`registry-operations.md` ↗](/spec/v1/registry-operations.html) |
