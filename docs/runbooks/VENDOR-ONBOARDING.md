# Vendor Onboarding Runbook

> **Status: current (v2).** How a new organization claims a `vendor.<org>.*` namespace and registers its own publisher key at `packs.openwop.dev`. For registry maintainers and the vendor's first publisher. The normative signing rules are [`spec/v2/core/packs.md`](../../spec/v2/core/packs.md) §Signing; the namespace and trust-tier policy is [RFC 0043](../../RFCS/0043-registry-and-extension-policy.md) (indexed at [`docs/governance/registry-policy.md`](../governance/registry-policy.md)).

The registry and all of its tooling live in [openwop/openwop-registry](https://github.com/openwop/openwop-registry). Every step below is a pull request or a command in a clone of that repository, not this one.

---

## When to use this runbook

An organization wants to publish packs under its own `vendor.<org>.*` namespace, signed with its own key.

Not covered:

- **`community.<author>.*`** — open-publish; there is no namespace review.
- **`core.openwop.*`** — reserved for project maintainers.
- **`private.<host>.*`** — host-internal only; never published to `packs.openwop.dev`.

---

## Pre-flight (vendor)

The vendor needs:

- A GitHub organization that owns the repository it will author packs from.
- An Ed25519 keypair generated on an isolated workstation. The private key never leaves the vendor's infrastructure.
- A named point of contact.

### Generate the keypair

```bash
# On a secured workstation, never in CI.
mkdir -p ~/.openwop-keys
openssl genpkey -algorithm ed25519 -out ~/.openwop-keys/<org>-internal-1.private.pem
openssl pkey -in ~/.openwop-keys/<org>-internal-1.private.pem -pubout \
  -out ~/.openwop-keys/<org>-internal-1.public.pem
chmod 600 ~/.openwop-keys/<org>-internal-1.private.pem

# Confirm it is an Ed25519 public key
openssl pkey -in ~/.openwop-keys/<org>-internal-1.public.pem -pubin -text -noout
```

Only the `.public.pem` goes into the pull request.

---

## Step 1 — Vendor opens the namespace-claim PR

Open a pull request against `openwop/openwop-registry` that adds:

### A. `registry/keys/<org>-internal-1.pub`

```bash
cp ~/.openwop-keys/<org>-internal-1.public.pem registry/keys/<org>-internal-1.pub
```

### B. Entries in `registry/.well-known/openwop-registry.json`

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
      "status": "active"
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

Every `signingKeys[]` entry must carry `keyId`, `publicKeyUrl`, `permittedNamespaces` and `status`; the conformance leg for RFC 0222 reads all four.

### C. A row in the registry README's signing-key table

```markdown
| `<org>-internal-1` | <Org Display Name> | `vendor.<org>.*` | active |
```

### D. PR description

```markdown
## Namespace claim: vendor.<org>.*

**Claimant:** <Org Display Name> (https://<org-domain>)
**Point of contact:** <GitHub handle>
**First pack release ETA:** <YYYY-MM-DD>

### Verification

- [ ] `registry/keys/<org>-internal-1.pub` is an Ed25519 SPKI public key
- [ ] The key fingerprint matches one shared out of band
- [ ] `permittedNamespaces` is exactly `vendor.<org>.*`
- [ ] No other key already holds `vendor.<org>.*`

### Why this vendor

<one paragraph: what the vendor builds and which packs it plans to publish>
```

---

## Step 2 — Maintainer review

The reviewing maintainer checks:

1. **Identity.** The PR author controls the claimed organization: GitHub org membership, and optionally a DNS TXT record on `<org-domain>` carrying the key fingerprint or a public statement of the claim.
2. **Key shape.** `openssl pkey -in registry/keys/<org>-internal-1.pub -pubin -text -noout` prints an `ED25519 Public-Key` block.
3. **Exclusivity.** `permittedNamespaces` is scoped to `vendor.<org>.*` only. Two vendors never share a key.
4. **No conflict.** The namespace is not already in `namespaceAssignments[]`.
5. **Gate passes.** openwop-registry's `registry-publish` workflow and `npm run check` are green.

If all five hold, approve and merge. The registry deploys on merge.

---

## Step 3 — Verify after deploy

```bash
curl -sI https://packs.openwop.dev/keys/<org>-internal-1.pub   # 200
curl -sS https://packs.openwop.dev/.well-known/openwop-registry.json | \
  jq '.signingKeys[] | select(.keyId == "<org>-internal-1")'
```

---

## Step 4 — First pack publish

In a clone of openwop-registry:

```bash
node scripts/new-pack.mjs --pack vendor.<org>.<pack>
# edit pack.json, index.mjs, schemas/
node scripts/auto-register.mjs --tree v2 \
  --key-file ~/.openwop-keys/<org>-internal-1.private.pem \
  --key-id <org>-internal-1 --scheme ed25519-canonical-json
node registry/scripts/verify-signatures.mjs --tree v2 && npm run check
```

Then open a PR against openwop-registry. See [`docs/PACK-AUTHOR-QUICKSTART.md`](../PACK-AUTHOR-QUICKSTART.md) for authoring.

The gate checks each signature against the key's `permittedNamespaces`: a pack signed by `<org>-internal-1` must be named `vendor.<org>.*`, and the key must be `active`.

---

## Step 5 — Key rotation

Publisher keys should rotate annually. See [`KEY-ROTATION.md`](./KEY-ROTATION.md).

---

## Common pitfalls

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Signature verification fails | `keyId` in the manifest's `signing` block does not match the registered key | Re-sign with the correct `--key-id`. |
| "key not authorized for namespace" | The pack name is outside the key's `permittedNamespaces` | Rename the pack, or amend the claim in Step 1. |
| Public key 404s after merge | Deploy not finished or failed | Check openwop-registry's Actions tab and re-run the deploy. |
| Cannot push a branch | No write access to openwop-registry | Open the PR from a fork. |

---

## See also

- [`spec/v2/core/packs.md`](../../spec/v2/core/packs.md) §Signing
- [RFC 0222](../../RFCS/0222-v2-registry-operations.md) — v2 registry operations
- [`PACK-LIFECYCLE.md`](./PACK-LIFECYCLE.md) — deprecate, yank, new versions
- [`INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md) — key or pack compromise
- [`docs/PACK-AUTHOR-QUICKSTART.md`](../PACK-AUTHOR-QUICKSTART.md) — authoring your first pack
- [openwop/openwop-registry](https://github.com/openwop/openwop-registry) — the registry tree, scripts, and CI gate
