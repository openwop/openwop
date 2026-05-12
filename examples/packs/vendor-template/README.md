# `vendor.{ORG}.{PACK}` — pack template

Replace this `README.md` with documentation for your real pack. Recommended structure (copy from `~/dev/openwop/packs/vendor.myndhyve.ai/README.md` as a model):

1. **One-line summary** + when-to-use vs. neighboring packs (e.g., "Distinct from `core.openwop.*` because…").
2. **Comparison table** if your pack overlaps with other packs.
3. **Pack metadata table** (peerDependencies, License).
4. **Nodes table** — typeId → role → one-line description.
5. **Host contract** — the `ctx.*` surface your nodes consume, with TypeScript-shape pseudocode.
6. **Examples** — at least one workflow YAML/JSON snippet showing how a downstream author wires your nodes.
7. **Versioning + compatibility** — your support for `engines.openwop` range.

## Authoring a new pack from this template

1. **Generate from this skeleton:**

   ```bash
   node scripts/new-pack.mjs vendor.<org>.<pack>
   ```

   The generator copies `examples/packs/vendor-template/` to `packs/<name>/`, substitutes the placeholders (`{ORG}`, `{PACK}`), and runs through a sanity-check pass.

2. **Customize `pack.json`:**
   - Replace `description`, `keywords`, `homepage`.
   - Update `peerDependencies` to declare the `host.*` capabilities your nodes actually consume. See [`spec/v1/host-capabilities.md`](../../../spec/v1/host-capabilities.md) for the canonical contracts.
   - Update `signing.keyId` to your registered publisher key (must be in `registry/keys/` and authorized for `vendor.<org>.*` via `.well-known/openwop-registry.json`).
   - Replace the placeholder `nodes[]` array with your real typeIds.

3. **Author per-node JSON schemas** in `schemas/`:
   - `<typeId>.config.json` — workflow-author-supplied config (author time)
   - `<typeId>.input.json` — runtime inputs computed from upstream node outputs
   - `<typeId>.output.json` — output shape emitted by `yield { type: 'output' }`
   - Each schema MUST be a valid JSON Schema draft 2020-12 (the registry CI gate compiles them).

4. **Write the executor in `index.mjs`:**
   - Each typeId is a named export wrapped in `defineNode({...})`.
   - Use `ctx.*` accessors for host capabilities (never import myndhyve services directly).
   - Use `ctx.log()` for structured logging (never `console.log`).
   - Yield `output` / `error` / `progress` events; the engine handles the rest.
   - See [`docs/AUTHORING-CANVAS-PACKS.md`](../../../docs/AUTHORING-CANVAS-PACKS.md) for the full patterns + anti-patterns guide.

5. **Build + sign:**

   ```bash
   node scripts/build-pack-tarball.mjs \
     --pack vendor.<org>.<pack> \
     --signed \
     --key ~/.openwop-keys/<org>-internal-1.private.pem \
     --key-id <org>-internal-1
   ```

   Output: `dist/packs/vendor.<org>.<pack>-1.0.0.{tgz,sig.b64,manifest.json,integrity.txt}`.

6. **Open a PR against `openwop/openwop`:**
   - Copy the tarball + sig + manifest into `registry/v1/packs/vendor.<org>.<pack>/-/1.0.0.{tgz,sig,json}` (binary sig — base64-decode `.sig.b64`).
   - Run `node registry/scripts/build-index.mjs` to regenerate the per-pack `index.json` + registry-wide `v1/index.json`.
   - Push the branch + open PR. CI runs all three quality gates: schema validation, sig verification, structural conformance.

7. **After merge:** the WIF auto-deploy publishes your pack to `packs.openwop.dev` within ~2 min.

## What this template doesn't include (do these in your real pack)

- **Per-pack `__tests__/`** — author at least one unit test that exercises the happy path of each node. Vitest is the convention in this repo.
- **Conformance scenario** at `conformance/src/scenarios/pack-fetch-verify-vendor-<org>-<pack>.test.ts` — fetches + verifies + dispatches the pack against the reference OpenWOP host. Required by the openwop maintainer review.
- **SBOM** (Software Bill of Materials) — `cyclonedx-npm` or equivalent. Required for security-conscious consumers; will become a CI gate in Stage 4.

## License

Apache-2.0 (matches openwop convention). Replace `LICENSE` if your org uses a different SPDX-listed license.
