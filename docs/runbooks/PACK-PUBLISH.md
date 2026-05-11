# Pack Publish Runbook

How to publish the 19 OpenWOP packs (in `packs/`) to a registry running
the workflow-runtime pack routes (see
`services/workflow-runtime/src/routes/packs.ts` in the MyndHyve repo).

## Prerequisites

- Super-admin Firebase account on the target project (`myndhyve-prod`
  or `myndhyve-stage`).
- `gcloud` CLI authenticated as that account, OR a way to mint a
  Firebase ID token for it.
- Repo checked out at `~/dev/openwop` with all 19 packs in `packs/`.
- Node 20+.

## Step 1 — Generate a publishing keypair

Each publishing identity (e.g., `openwop-team`, `myndhyve-internal`)
gets its own Ed25519 keypair. The PRIVATE key never leaves the
operator's machine; the PUBLIC key is pre-registered with the
registry's keychain so the verifier can look it up by `publicKeyRef`.

```bash
# Generate keypair — keep private.pem secret.
openssl genpkey -algorithm ed25519 -out /secure/path/openwop-team-1.private.pem
openssl pkey -in /secure/path/openwop-team-1.private.pem -pubout -out /tmp/openwop-team-1.public.pem

# Print the SPKI DER (base64) — this is what gets registered.
openssl pkey -in /tmp/openwop-team-1.public.pem -pubin -outform DER | base64
```

## Step 2 — Pre-register the public key with the registry

The pack-registry's `verifyPublishSignature` looks up the
`publicKeyRef` from inside the tarball's `signing` block against the
pack's keychain. Each pack needs its keychain populated **before** the
first PUT.

For each pack name in `packs/`, register the key:

```bash
PACK_NAME=core.openwop.examples
PUB_KEY_B64=$(openssl pkey -in /tmp/openwop-team-1.public.pem -pubin -outform DER | base64 -w0)

curl -X POST "$REGISTRY_URL/v1/packs/$PACK_NAME/-/keychain" \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"keyId\": \"openwop-team-1\",
    \"algorithm\": \"ed25519\",
    \"publicKey\": \"$PUB_KEY_B64\"
  }"
```

Loop over the 19 pack names from `packs/` to populate every keychain.

(Future improvement: support wildcard keychain registration so one
POST covers a whole vendor namespace. Today's route is per-pack.)

## Step 3 — Build signed tarballs

```bash
cd ~/dev/openwop
node scripts/build-pack-tarball.mjs --all --signed \
  --key /secure/path/openwop-team-1.private.pem \
  --key-id openwop-team-1
```

Outputs in `dist/packs/`:

```
<name>-<version>.tgz             gzipped USTAR tarball
<name>-<version>.manifest.json   augmented pack.json (with signing block)
<name>-<version>.sig.b64         off-tarball Ed25519 signature (for reference)
<name>-<version>.integrity.txt   sha256:<hex>
```

The tarball contains both the augmented `pack.json` (with the signing
block) and `keys/pack.json.sig` (the raw 64-byte signature). The
registry's `extractPackTarball` reads both during verification.

## Step 4 — Dry-run the publish

Sanity-check what would be PUT:

```bash
node scripts/publish-pack.mjs --all --dry-run
```

Expected: 19 PUT URLs, all to
`<registry>/v1/packs/<name>/-/<version>.tgz`.

## Step 5 — Mint a Firebase ID token

```bash
# Method A — gcloud SA impersonation
FIREBASE_ID_TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account=<super-admin-sa>@myndhyve-prod.iam.gserviceaccount.com)

# Method B — Firebase Auth client SDK (browser/Node)
# Sign in as the super-admin account, call user.getIdToken()
```

The token's `uid` must have super-admin claims (`super_admin: true` in
custom claims OR membership in the platform admin workspace per
`requireSuperAdmin` middleware logic).

## Step 6 — Publish

```bash
export OPENWOP_PACK_REGISTRY_URL=https://workflow-runtime-...-uc.a.run.app
# or: https://api.myndhyve.ai

export OPENWOP_PACK_PUBLISH_KEY=$FIREBASE_ID_TOKEN

node scripts/publish-pack.mjs --all
```

Expected output (per pack):

```
✓ <name>@<version>  published (first-time)        # 201
✓ <name>@<version>  re-published (idempotent)      # 200 (same content)
⚠ <name>@<version>  version_conflict               # 409 (different content)
```

Re-publish is idempotent at the same content hash — re-running step 6
after a no-op rebuild is safe.

## Step 7 — Verify in Firestore + Cloud Storage

```bash
# Firestore: wop_packs/{packName} catalog doc should exist.
gcloud firestore documents describe wop_packs/core.openwop.examples \
  --project myndhyve-prod

# Cloud Storage: tarball blob should exist.
gsutil ls gs://$WOP_PACK_BUCKET/wop-packs/core.openwop.examples/1.0.0.tgz
```

## Step 8 — Smoke test resolution

In a workflow-runtime instance with `WOP_PACK_BUCKET` set, the
`MyndHyveNodePackResolver` is wired and async resolution should
succeed:

```bash
curl -X POST "$REGISTRY_URL/v1/runs" \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": {
      "id": "ad-hoc-smoke",
      "nodes": [
        { "id": "n1", "typeId": "core.openwop.examples.echo",
          "config": { "message": "hello pack" }, "inputs": {} }
      ],
      "edges": []
    }
  }'
```

If resolution succeeds, the run completes with the echoed message —
proving end-to-end that the Cloud Run host resolved `core.openwop.examples.echo`
from the pack registry rather than from in-tree code.

## Rollback

Publishes are append-only by design. If a bad version ships:

1. **Yank** (recommended within 72h): marks the version unavailable
   for new dispatches but keeps it loadable for in-flight runs.
   ```bash
   curl -X POST "$REGISTRY_URL/v1/packs/<name>/-/<version>/yank" \
     -H "Authorization: Bearer $FIREBASE_ID_TOKEN"
   ```
2. **Unpublish** (only within 72h, per npm-style convention):
   ```bash
   curl -X DELETE "$REGISTRY_URL/v1/packs/<name>/-/<version>" \
     -H "Authorization: Bearer $FIREBASE_ID_TOKEN"
   ```
3. **Deprecate** (after 72h or for soft retirement):
   ```bash
   curl -X POST "$REGISTRY_URL/v1/packs/<name>/-/<version>/deprecate" \
     -H "Authorization: Bearer $FIREBASE_ID_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"reason": "security_advisory", "supersededBy": "1.0.1"}'
   ```

## See also

- `spec/v1/node-packs.md` §"Registry HTTP API"
- `scripts/build-pack-tarball.mjs` — local build + sign
- `scripts/publish-pack.mjs` — PUT to the registry
- `services/workflow-runtime/src/routes/packs.ts` (myndhyve repo) — route handler
- `services/workflow-runtime/src/registry/PackRegistryStorage.ts` (myndhyve repo) — Firestore + Cloud Storage backend
