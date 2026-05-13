# `core-packs-lockfile/` — workspace lockfile demo pinning the 4 audit-gated core packs

Reference workspace [`pack-lockfile`](../../schemas/pack-lockfile.schema.json)
that pins the four core packs whose **registry publication** is gated on
the external security audit (`SECURITY/external-audit-engagement.md` §2.1):

- `core.openwop.ai@1.0.0`
- `core.openwop.http@1.0.0`
- `core.openwop.mcp@1.0.0`
- `core.openwop.triggers@1.0.0`

The packs themselves are **built, signed, and in-tree** at
`registry/v1/packs/<name>/-/1.0.0.{tgz,sig,sbom.json,json}`. The audit
gate only blocks pushing them to the hosted registry at
`packs.openwop.dev`; everything below the push step ships in the repo.
This lockfile is the consumer-side artifact that pins them to v1.0.0
with SRI integrity hashes + Ed25519 signature material.

## Why this exists

Per `spec/v1/node-packs.md` §"Dependency resolution + lockfile", a
workspace records a lockfile alongside its workflow definitions; the
registry resolver MUST honor pinned versions on subsequent installs.
This file demonstrates the lockfile shape against the canonical core
packs — useful for:

1. **Schema-validity evidence** — the file validates against
   [`schemas/pack-lockfile.schema.json`](../../schemas/pack-lockfile.schema.json).
2. **Air-gapped install reproducibility** — an operator with the
   in-tree tarballs + this lockfile can install the 4 packs without
   reaching the hosted registry. The `resolved:` URLs point at
   `packs.openwop.dev` for documentation; substitute a local file://
   path when air-gapped.
3. **Signature verification offline** — each pack's
   `signature.{algorithm, publicKey, value}` carries the raw Ed25519
   bytes; resolvers verify against the publisher's advertised key
   without re-fetching from the registry.

## Verifying

```bash
# Validate the lockfile against the published schema
npx -y ajv-cli@5 validate --strict=false --spec=draft2020 \
  -s schemas/pack-lockfile.schema.json \
  -d examples/core-packs-lockfile/openwop-pack-lockfile.json

# Verify each pack's tarball matches the recorded integrity
for p in ai http mcp triggers; do
  expected=$(jq -r ".packs[] | select(.name == \"core.openwop.$p\") | .integrity" \
    examples/core-packs-lockfile/openwop-pack-lockfile.json | sed 's/sha256-//')
  actual=$(openssl dgst -sha256 -binary \
    "registry/v1/packs/core.openwop.$p/-/1.0.0.tgz" | base64)
  [ "$expected" = "$actual" ] && echo "✓ core.openwop.$p" || echo "✗ core.openwop.$p MISMATCH"
done

# Verify each pack's signature with the canonical verifier
node registry/scripts/verify-signatures.mjs
```

## Pack-author key

All 4 packs in this lockfile are signed with `keyId: openwop-team-1`
(public key at `registry/keys/openwop-team-1.pub`). The signature is
over the canonical manifest JSON per
`scripts/build-pack-tarball.mjs` §"Signing input" — not over the
tarball bytes. The lockfile's `signature.value` carries this same
Ed25519 signature, and `signature.publicKey` is the raw 32-byte key
extracted from the SPKI DER (base64-encoded).

## What this is NOT

- **Not a published lockfile.** This is an example, not the output of a
  real install resolution against `packs.openwop.dev`. A workspace
  using these packs in production generates its own lockfile via
  `npm install`-style resolution.
- **Not a substitute for the audit gate.** The 4 core packs remain
  flagged as audit-required in
  `SECURITY/external-audit-engagement.md` §2.1; this evidence proves
  they're build-ready, not that they're cleared for publication.

## See also

- [`schemas/pack-lockfile.schema.json`](../../schemas/pack-lockfile.schema.json) — normative shape.
- [`spec/v1/node-packs.md`](../../spec/v1/node-packs.md) §"Dependency resolution + lockfile".
- [`registry/scripts/verify-signatures.mjs`](../../registry/scripts/verify-signatures.mjs) — canonical verifier (28/28 packs pass as of 2026-05-13).
- [`SECURITY/external-audit-engagement.md`](../../SECURITY/external-audit-engagement.md) §2.1 — audit-gated pack list.
