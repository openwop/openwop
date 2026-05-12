# Pack Lifecycle Runbook

> **Status: v1 (2026-05-12).** Operational procedures for the post-publish pack lifecycle: deprecate, yank, unpublish, force-update, key rotation. Pairs with `spec/v1/registry-operations.md` §"Pack lifecycle".

This runbook covers the operations that happen AFTER a pack is live at `packs.openwop.dev`. Initial-publish flow is in `docs/runbooks/PACK-PUBLISH.md`; this doc is about what to do when something needs to change.

---

## The four lifecycle transitions

Per `spec/v1/registry-operations.md`:

| Operation | Effect on consumers | Reversible | When to use |
|---|---|---|---|
| **Deprecate** | Pack still installable + dispatch-able. Consumers running `verified` mode see a deprecation flag + SHOULD suggest migration. | Yes (via `undeprecate`) | "There's a newer version; we'd like you to upgrade but old version still works" |
| **Yank** | Pack tarball blocked (registry refuses to serve). Consumers MUST NOT dispatch nodes from yanked versions. | Yes (via `unyank`) | "This version has a bug serious enough to block new installs; existing installs should re-pin" |
| **Unpublish** | Pack removed from registry entirely (tarball + manifest + index entry). Only allowed within 72h of publish per spec. | NO — once unpublished, the version can never be re-published with the same bytes (consumers may have cached the SHA256 hash) | "We published by mistake within the last 72h; we want it gone before anyone consumes it" |
| **Force-update** | New version published with bumped SemVer; old version stays at-rest | N/A (this is just the standard publish flow at a new version) | "Bug fix or feature addition" |

---

## Deprecate (most common)

### When

- A newer minor / patch version supersedes the current one
- The pack is being retired (e.g., the vendor sunsets a product line)
- A node in the pack has a known issue that's fixed in a newer version

Deprecation is ADVISORY — consumers can still install + dispatch. The registry returns a flag; runtime hosts SHOULD surface the warning to operators.

### How

1. Open a PR against `openwop/openwop` modifying the pack's version manifest:

   ```bash
   # registry/v1/packs/<name>/-/<version>.json
   {
     ...,
     "deprecated": true,
     "deprecationReason": "Superseded by 2.0.0 — improves X. Migration guide at <url>.",
     "advisoryUrl": "https://<vendor-site>/openwop/<pack>-1.0.0-deprecated"
   }
   ```

2. Run `node registry/scripts/build-index.mjs` to update the per-pack `index.json` `versionEntries[].deprecated: true`.

3. Open PR. CI gates (#12+#13+#14+#15) run as usual.

4. After merge + Firebase Hosting auto-deploy, verify:

   ```bash
   curl -s https://packs.openwop.dev/v1/packs/<name>/-/<version>.json | jq .deprecated
   # Expects: true
   ```

### Reverse (undeprecate)

Set `"deprecated": false`, rerun `build-index.mjs`, merge. Same gates apply.

---

## Yank (escalation)

### When

- A version ships a security vulnerability requiring immediate action
- A pack causes consumer-side data loss or undefined behavior
- A signing-key compromise is suspected (yank ALL versions signed by the key — see `INCIDENT-RESPONSE.md`)

Yank is STRICTER than deprecation: the registry MUST stop serving the tarball + signature for that version. Consumers running `verified` mode MUST refuse to dispatch any node from a yanked version.

### How

1. Edit the version manifest:

   ```jsonc
   // registry/v1/packs/<name>/-/<version>.json
   {
     ...,
     "yanked": true,
     "yankedReason": "CVE-2026-XXXX: <one-line description>",
     "advisoryUrl": "https://<vendor-site>/security/CVE-2026-XXXX"
   }
   ```

2. Run `node registry/scripts/build-index.mjs`. The script ALSO updates the per-pack `index.json` to mark the version yanked and excludes it from `latestVersion` resolution.

3. Open the PR with the title prefix `[YANK]` so maintainers prioritize review.

4. After merge, CRITICAL verification:

   ```bash
   # Registry returns 404 (or 410 Gone, depending on Hosting config)
   curl -sI https://packs.openwop.dev/v1/packs/<name>/-/<version>.tgz
   # Discovery doc + version manifest still served, with `yanked: true`
   curl -s https://packs.openwop.dev/v1/packs/<name>/-/<version>.json | jq .yanked
   # Expects: true
   ```

   If the tarball still serves: open an incident issue + manually delete the `.tgz` file from `registry/v1/packs/<name>/-/<version>.tgz` in a follow-up PR. Firebase Hosting doesn't auto-purge yanked artifacts; deletion is required for hard-refusal.

### Reverse (unyank)

Only acceptable if the original yank reason no longer applies (e.g., CVE was a false positive). Procedure: set `"yanked": false`, rebuild indices, merge. Document the unyank rationale in PR description.

---

## Unpublish (within 72h only)

### When

A pack version was published in error within the past 72 hours AND no known consumer has cached it. This is a HARD policy boundary per spec — after 72h, the version becomes immutable forever (consumer caches make undo-by-republish impossible without breaking existing installs).

### How

1. Open a PR removing the entire `registry/v1/packs/<name>/-/<version>.{tgz,sig,json}` triple.
2. Run `node registry/scripts/build-index.mjs` to remove the version from per-pack `index.json` + registry-wide `index.json`.
3. PR title prefix `[UNPUBLISH]`. Include a `publishedAt` timestamp + assert <72h.
4. CI gates run as usual. The pack's other versions are unaffected.

### After 72h

The version is immutable. Even if you delete the files, consumers who already fetched the tarball have its SHA-256 hash; a re-publish with the same version would fail integrity verification on their side.

Right action after 72h: **publish a new version with a bumped SemVer + yank the bad version**.

---

## Force-update (standard new-version publish)

Use the standard `PACK-PUBLISH.md` flow with a bumped version. NO special handling — the registry stores all versions side-by-side; `latestVersion` resolves to the highest non-yanked SemVer.

Bumping rules:

- **Patch** (`1.0.0` → `1.0.1`): bug fixes that don't change the API
- **Minor** (`1.0.0` → `1.1.0`): backward-compatible feature additions (new typeIds, new optional config fields)
- **Major** (`1.0.0` → `2.0.0`): breaking changes (removed typeIds, required config fields, schema changes that invalidate existing inputs)

---

## Key rotation

Publisher keys SHOULD rotate annually. Hard rotation (compromise response) follows `INCIDENT-RESPONSE.md`.

### Annual rotation

1. **Vendor generates new keypair** (`<org>-internal-2`):
   ```bash
   openssl genpkey -algorithm ed25519 -out ~/.openwop-keys/<org>-internal-2.private.pem
   openssl pkey -in ~/.openwop-keys/<org>-internal-2.private.pem -pubout \
     -out ~/.openwop-keys/<org>-internal-2.public.pem
   ```

2. **Vendor opens PR registering the new key alongside the old**:
   - Add `registry/keys/<org>-internal-2.pub`
   - Add new `signingKeys[]` entry with same `permittedNamespaces` as the old key
   - Do NOT remove the old `<org>-internal-1` entry yet

3. **Transition window** (1–3 months): vendor signs new pack publishes with `<org>-internal-2`. Existing packs signed with `<org>-internal-1` continue to verify.

4. **After transition**: vendor opens a second PR removing the old key:
   - Delete `registry/keys/<org>-internal-1.pub`
   - Remove the `<org>-internal-1` entry from `signingKeys[]`
   - All existing packs signed with the old key MUST have been re-signed with `<org>-internal-2` first (or yanked)

5. **Calendar reminder**: each vendor maintains an annual calendar entry for their next rotation.

---

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Yank PR merges but tarball still serves | Firebase Hosting doesn't auto-purge content; only the metadata is updated | Follow up with a PR deleting the `.tgz` file from `registry/v1/packs/<name>/-/<version>.tgz` |
| Deprecation flag not shown to consumers | Per-pack `index.json` `versionEntries[].deprecated` not updated | Re-run `node registry/scripts/build-index.mjs` |
| `latestVersion` doesn't update after yanking the current latest | `build-index.mjs` recomputes latest from non-yanked versions; ensure yank PR merged + redeployed | Wait for Firebase Hosting cache TTL (~60s) or re-run build-index |
| Unpublish PR merges after 72h | Spec allows the deletion but consumer caches still have the hash | Operational impact: consumers see 404; recommend yank instead next time |

---

## See also

- [`spec/v1/registry-operations.md`](../../spec/v1/registry-operations.md) §"Pack lifecycle"
- [`docs/runbooks/VENDOR-ONBOARDING.md`](./VENDOR-ONBOARDING.md) — initial namespace claim + key registration
- [`docs/runbooks/INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md) — emergency procedures (key compromise, CVE response)
- [`docs/runbooks/PACK-PUBLISH.md`](./PACK-PUBLISH.md) — initial publish flow
- [`registry/scripts/build-index.mjs`](../../registry/scripts/build-index.mjs) — index regeneration
- [`.github/workflows/registry-publish.yml`](../../.github/workflows/registry-publish.yml) — CI gates that run on every lifecycle PR
