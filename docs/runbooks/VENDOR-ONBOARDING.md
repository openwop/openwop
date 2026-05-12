# Vendor Onboarding Runbook

> **Status: v1 (2026-05-12).** Step-by-step procedure for adding a new external vendor namespace + publisher key to `packs.openwop.dev`. Targets registry maintainers + the vendor's first authorized publisher. Pairs with `spec/v1/registry-operations.md` §"Submission validation" + `registry/README.md` §"Signing keys + namespace assignments".

This runbook covers the namespace-claim PR for vendors who want to publish under `vendor.<org>.*`. The first openwop vendor onboarding (MyndHyve) executed this procedure on 2026-05-11 (openwop/openwop#2). Subsequent onboardings follow the same pattern.

---

## When to use this runbook

A new organization wants to publish OpenWOP node packs under their own `vendor.<org>.*` namespace AND use their own signing key (not `openwop-registry-root`).

NOT covered:

- **`community.<author>.*` publishes** — community namespaces are open-publish; no maintainer review of the namespace itself. Anyone can claim a `community.your-handle.*` name on first publish.
- **`core.openwop.*` publishes** — reserved for openwop-project maintainers. Different review process.
- **`private.<host>.*` packs** — host-internal only. MUST NOT appear on `packs.openwop.dev`.

---

## Pre-flight (vendor side)

The vendor MUST have:

- A GitHub organization that owns the repository they'll author packs from (e.g., `acme/openwop-packs`).
- An Ed25519 keypair generated on an isolated workstation. The PRIVATE key never leaves the vendor's secured infrastructure.
- A point-of-contact for the openwop maintainer to coordinate with.

### Generate the keypair (vendor)

```bash
# Run on the vendor's secured workstation (NOT in any CI pipeline).
mkdir -p ~/.openwop-keys
openssl genpkey -algorithm ed25519 -out ~/.openwop-keys/<org>-internal-1.private.pem
openssl pkey -in ~/.openwop-keys/<org>-internal-1.private.pem -pubout \
  -out ~/.openwop-keys/<org>-internal-1.public.pem
chmod 600 ~/.openwop-keys/<org>-internal-1.private.pem

# Verify it's a 32-byte Ed25519 public key
openssl pkey -in ~/.openwop-keys/<org>-internal-1.public.pem -pubin -text -noout
```

Send ONLY the `.public.pem` file to the openwop maintainer via the namespace-claim PR. The private key stays with the vendor.

---

## Step 1 — Vendor opens namespace-claim PR

Branch off `openwop/openwop` `main`. The PR adds:

### A. `registry/keys/<org>-internal-1.pub`

Copy the public key file from the vendor's workstation. Verify it's PEM-encoded and 113 bytes (Ed25519 public key SPKI).

```bash
cp ~/.openwop-keys/<org>-internal-1.public.pem \
   registry/keys/<org>-internal-1.pub
```

### B. `registry/.well-known/openwop-registry.json` updates

Two additions:

```jsonc
{
  "signingKeys": [
    // ... existing entries ...
    {
      "keyId": "<org>-internal-1",
      "algorithm": "ed25519",
      "publicKeyUrl": "/keys/<org>-internal-1.pub",
      "permittedNamespaces": ["vendor.<org>.*"],
      "operator": "<Org Display Name> (https://<org-domain>)",
      "status": "active",
      "_note": "First external vendor namespace under packs.openwop.dev. Per spec/v1/registry-operations.md §Step 1, vendor.<org>.* publishes MUST verify against this key; submissions from any other key MUST be refused at PR review."
    }
  ],
  "namespaceAssignments": [
    // ... existing entries ...
    {
      "namespace": "vendor.<org>.*",
      "owner": "<Org Display Name>",
      "signingKeyId": "<org>-internal-1",
      "claimedAt": "YYYY-MM-DD",
      "contact": "https://github.com/<org>"
    }
  ]
}
```

### C. `registry/README.md` table update

Add a row to the "Signing keys + namespace assignments" table:

```markdown
| `<org>-internal-1` | <Org Display Name> | `vendor.<org>.*` | active (online publishing key) |
```

### D. PR description checklist

```markdown
## Namespace claim: vendor.<org>.*

**Claimant:** <Org Display Name> (https://<org-domain>)
**Maintainer contact:** <GitHub handle of vendor's point-of-contact>
**First pack release ETA:** <YYYY-MM-DD>

### Verification

- [ ] `registry/keys/<org>-internal-1.pub` is a 32-byte Ed25519 SPKI
- [ ] Public key matches the fingerprint shared via [out-of-band channel]
- [ ] `permittedNamespaces` is scoped to `vendor.<org>.*` only (no overlap with other vendors)
- [ ] No existing publisher key holds `vendor.<org>.*` in its `permittedNamespaces`

### Why this vendor

<one-paragraph justification — what the vendor builds, why they need
their own openwop pack namespace, what packs they plan to publish>
```

---

## Step 2 — Maintainer review

Reviewer (openwop project maintainer) verifies:

1. **Identity.** Does the GitHub account opening the PR control the claimed org? Cross-check via:
   - GitHub org membership of the PR author
   - DNS TXT record on `<org-domain>` containing the public-key fingerprint (optional but recommended for external vendors)
   - A public statement (blog post / press release / signed message) declaring the namespace claim

2. **Public-key shape.** Verify the file is a valid Ed25519 public key:
   ```bash
   openssl pkey -in registry/keys/<org>-internal-1.pub -pubin -text -noout
   # Expects: "ED25519 Public-Key:" line + 32-byte hex dump
   ```

3. **Namespace exclusivity.** `permittedNamespaces` MUST be scoped to `vendor.<org>.*` only. Two vendors MUST NOT share a key.

4. **No conflict.** `vendor.<org>.*` MUST NOT already be claimed in `namespaceAssignments[]`.

5. **CI passes.** `registry-publish.yml` runs:
   - JSON parse validation
   - Schema validation (`registry-version-manifest.schema.json`)
   - Build-index check (no drift)
   - Sig verification (skipped on this PR — no new packs)
   - Conformance check (skipped on this PR — no new packs)

If all 5 pass: approve + squash-merge. Firebase Hosting auto-deploys via the WIF pipeline within ~2 min.

---

## Step 3 — Verify post-deploy

After merge, the vendor should verify their key is reachable:

```bash
curl -sI https://packs.openwop.dev/keys/<org>-internal-1.pub
# Expects: HTTP/2 200, content-type: application/octet-stream
curl -sS https://packs.openwop.dev/.well-known/openwop-registry | \
  jq '.signingKeys[] | select(.keyId == "<org>-internal-1")'
```

If both succeed, the vendor can publish their first pack.

---

## Step 4 — Vendor's first pack publish

Vendor uses the standard pack-publishing flow:

```bash
node scripts/new-pack.mjs vendor.<org>.<pack>
# ...edit pack.json, index.mjs, schemas/
node scripts/build-pack-tarball.mjs --pack vendor.<org>.<pack> --signed \
  --key ~/.openwop-keys/<org>-internal-1.private.pem \
  --key-id <org>-internal-1
# Open PR against openwop/openwop
```

The Stage 2 CI gates (`registry/scripts/verify-signatures.mjs`) cross-check the keyId against the namespace allow-list claimed in Step 1. A pack signed by `<org>-internal-1` MUST be in `vendor.<org>.*` — any mismatch fails CI.

---

## Step 5 — Annual key rotation (vendor)

Each authorized publisher key SHOULD rotate annually. See `KEY-ROTATION.md` (companion runbook) for the rotation procedure.

---

## Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| Sig verification fails on first PR | `keyId` in pack.json doesn't match registered key | Re-build pack with correct `--key-id` |
| Sig verification fails: "key not authorized for namespace" | Pack name's namespace doesn't match `permittedNamespaces` | Rename the pack OR add namespace to permittedNamespaces (Step 1) |
| Public-key URL 404s after merge | Firebase Hosting deploy failed (check Actions tab) | Wait + retry; if persistent, manually `firebase deploy --only hosting:packs` |
| `gh pr create` fails | PR author lacks write access to openwop/openwop | Fork → open PR from fork; maintainer can merge from any source |

---

## See also

- [`spec/v1/registry-operations.md`](../../spec/v1/registry-operations.md) §"Submission validation"
- [`registry/README.md`](../../registry/README.md) §"Signing keys + namespace assignments"
- [`docs/runbooks/PACK-LIFECYCLE.md`](./PACK-LIFECYCLE.md) — yank/deprecate/unpublish flows
- [`docs/runbooks/INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md) — what to do when a key or pack is compromised
- [`docs/AUTHORING-CANVAS-PACKS.md`](../AUTHORING-CANVAS-PACKS.md) — how to author the first pack after onboarding
