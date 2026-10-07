# Pack Lifecycle Runbook

> **Status: current (v2).** How to deprecate, yank, supersede and re-sign a pack version after it is live at `packs.openwop.dev`. The normative rules are [`spec/v2/core/packs.md`](../../spec/v2/core/packs.md) §Signing and §"Version manifests", from [RFC 0222](../../RFCS/0222-v2-registry-operations.md).

The registry is a static, signed tree served from [openwop/openwop-registry](https://github.com/openwop/openwop-registry). It has no write API: its `.well-known/openwop-registry.json` declares `writeApi: { supported: false, publishMethod: "github-pull-request" }`. Every lifecycle change is a pull request against openwop-registry. The registry tooling named below (`build-index.mjs`, `verify-signatures.mjs`, `check-published-immutable.mjs`, `check-advisories.mjs`) lives in that repository, not this one. First-time publishing is covered in openwop-registry's README and [`docs/PACK-AUTHOR-QUICKSTART.md`](../PACK-AUTHOR-QUICKSTART.md).

---

## The lifecycle changes

Lifecycle flags sit on the served version manifest, outside the pack signature. Changing one republishes the version manifest; the tarball and signature never change.

| Change | Effect on consumers | Reversible | When to use |
| --- | --- | --- | --- |
| **Deprecate** (`versionDeprecated: true`) | Still served and installable. A consumer MAY refuse to install it. | Yes | A newer version supersedes it, or the pack is being retired. |
| **Yank** (`yanked: true`) | Manifest, tarball and signature stay served. Never the pack's `latest` while an unyanked version exists. A range skips it; an exact pin may still resolve it. | Yes | A defect or vulnerability serious enough to block new installs. |
| **New version** | Standard publish at a bumped SemVer. Old versions stay served. | n/a | Bug fix or feature. |

There is no unpublish. A registry MUST refuse a submission that republishes a version (`version_conflict`), and the registry gate refuses any change to a published `.tgz` or `.sig`. If a version was published in error, yank it and publish a fixed version.

---

## Deprecate

1. In an openwop-registry branch, edit the version manifest `registry/v2/packs/<name>/-/<version>.json`:

   ```jsonc
   {
     // ...
     "versionDeprecated": true,
     "deprecationReason": "Superseded by 2.0.0. Migration notes: <url>.",
     "supersededBy": "2.0.0"
   }
   ```

2. Run `node registry/scripts/build-index.mjs --tree v2` so the pack index agrees with the manifest.
3. Open the PR. The registry gate (`npm run check`) runs as usual.
4. After merge and deploy, verify:

   ```bash
   curl -s https://packs.openwop.dev/v2/packs/<name>/-/<version>.json | jq .versionDeprecated   # true
   ```

To reverse, set `versionDeprecated: false`, rebuild the index, and merge.

---

## Yank

### When

- A version ships a security vulnerability.
- A version causes data loss or undefined behavior on the consumer side.
- A version is named by an `affected[]` range in the registry's security-advisory feed (`schemas/v2/security-advisory.schema.json`). Advisory-listed versions MUST be yanked; openwop-registry's `check-advisories.mjs` fails the gate until they are.

### How

1. Edit the version manifest:

   ```jsonc
   // registry/v2/packs/<name>/-/<version>.json
   {
     // ...
     "yanked": true,
     "yankedReason": "<advisory id>: <one-line description>"
   }
   ```

2. Run `node registry/scripts/build-index.mjs --tree v2`. It marks the version yanked in the pack index and keeps it off `latest` while an unyanked version exists. (The frozen v1 tree keeps highest-semver.)
3. Open the PR with the title prefix `[YANK]` so maintainers review it first.
4. After merge, verify:

   ```bash
   # Manifest, tarball and signature are all still served
   curl -s  https://packs.openwop.dev/v2/packs/<name>/-/<version>.json | jq .yanked   # true
   curl -sI https://packs.openwop.dev/v2/packs/<name>/-/<version>.tgz | head -1      # 200
   # latest moved off it
   curl -s  https://packs.openwop.dev/v2/packs/<name>/index.json | jq .latest
   ```

Do not delete the `.tgz` or `.sig`. A yanked version stays served so exact pins keep working and anyone can verify what they installed, and its signing key must stay listed in `signingKeys[]` for as long as it is served.

To unyank, the original reason must no longer apply (for example, the advisory was a false positive). Set `yanked: false`, rebuild the index, and explain why in the PR description.

---

## New version

Publish a bumped version through the standard flow. All versions sit side by side; `latest` is the highest unyanked SemVer.

- **Patch** (`1.0.0` → `1.0.1`): bug fixes with no API change.
- **Minor** (`1.0.0` → `1.1.0`): backward-compatible additions (new typeIds, new optional config fields).
- **Major** (`1.0.0` → `2.0.0`): breaking changes (removed typeIds, new required config, schema changes that invalidate existing inputs).

---

## Key rotation

Only a `signingKeys[]` entry whose `status` is `active` may sign a new publication. A key must stay listed while any served version names it, and a verifier must not refuse a version because its key is no longer `active`. The full procedure, including compromise response, is in [`KEY-ROTATION.md`](./KEY-ROTATION.md). In short:

1. Add the new key to `signingKeys[]` with the same `permittedNamespaces`; leave the old entry in place.
2. Sign new publications with the new key.
3. Mark the old entry non-`active` (for example `status: "rotated"`). Remove it only after every served version it signed has been re-signed with the new key. Yanking does not release a key, because a yanked version is still served.

---

## Common pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pack index disagrees with a version manifest | `build-index.mjs --tree v2` not re-run | Re-run it; the gate's `--check` mode catches drift. |
| `latest` still names the yanked version | Index not rebuilt, or deploy not finished | Confirm the PR merged and the deploy finished; re-run `build-index.mjs --tree v2`. |
| Gate refuses the PR with a changed `.tgz` or `.sig` | `check-published-immutable.mjs`: published bytes are immutable | Revert the byte change; publish a new version instead. |
| Gate refuses a new version's signature | Signed by a key that is not `active`, or outside its `permittedNamespaces` | Re-sign with an `active` key permitted for the namespace. |

---

## See also

- [`spec/v2/core/packs.md`](../../spec/v2/core/packs.md) — registry tree, signing, version manifests, errors
- [RFC 0222](../../RFCS/0222-v2-registry-operations.md) — v2 registry operations and the checks a registry refuses on
- [`VENDOR-ONBOARDING.md`](./VENDOR-ONBOARDING.md) — namespace claim and first key registration
- [`KEY-ROTATION.md`](./KEY-ROTATION.md) — planned and emergency key rotation
- [`INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md) — key compromise and vulnerability response
- [openwop/openwop-registry](https://github.com/openwop/openwop-registry) — the registry tree, its scripts, and the `registry-publish` CI gate
