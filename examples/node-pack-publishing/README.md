# Node-Pack Publishing

Walks through building a pack manifest, signing with Ed25519, and (optionally) publishing to a registry. **Defaults to `--dry-run` mode** — no network calls, no auth required, safe to run anywhere.

| Profile required | `openwop-node-packs` (for `--print-publish-cmd` mode) |
| Host target      | None for dry-run; super-admin-authorized registry for `--print-publish-cmd` |
| Run modes        | default (dry-run) / `--print-publish-cmd` |

## Why dry-run by default

Publishing to a real registry requires super-admin authorization. Most readers won't have that, and accidentally publishing to production would be bad. So the default mode does everything except the network PUT:

1. Generates an Ed25519 keypair (per-run, ephemeral).
2. Constructs a sample manifest under the `private.local-example.*` scope (a real public registry won't accept this scope per `spec/v1/node-packs.md` §Naming — safe by default).
3. Computes canonical JSON + Ed25519 signature.
4. Prints the curl command you'd run for live publish.

## Run

```bash
# Default (no auth, no network)
npm start

# Print the curl PUT command (requires super-admin env vars)
# Renamed from --live in this version; --live is accepted as a
# deprecated alias. The flag prints the publish command but does NOT
# execute it — the example doesn't ship a buildable pack source.
OPENWOP_PACK_REGISTRY_URL=https://your-registry.example \
OPENWOP_PACK_PUBLISH_KEY=$YOUR_SUPER_ADMIN_KEY \
  npm start -- --print-publish-cmd
```

## Output (dry-run)

```
=== OpenWOP node-pack publishing example ===
Mode: dry-run (default)

→ Generating Ed25519 keypair...
  ✓ keypair generated
→ Built manifest:
  name:     private.local-example.echo-tool
  version:  1.0.0
  scope:    private.local-example (won't accept on public registries)
  signing:  ed25519 / detached

→ Canonical JSON (NNN bytes):
  {"description":"Reference example pack — single core.noop-style node...

→ Ed25519 signature (base64): MEUCIQDXP...

→ Public key (DER, base64):  MCowBQYDK...

To publish to a real registry:
  1. Pre-register your public key with the registry operator
     (super-admin action; out of scope for this example).
  2. Build the actual pack tarball:
       cd your-pack-source && tar czf pack.tgz manifest.json dist/
  3. PUT the tarball:
       curl -X PUT \
         "$OPENWOP_PACK_REGISTRY_URL/v1/packs/private.local-example.echo-tool/-/1.0.0" \
         -H "Authorization: Bearer $OPENWOP_PACK_PUBLISH_KEY" \
         -H "Content-Type: application/gzip" \
         --data-binary @pack.tgz
  4. Re-run this example with --print-publish-cmd to print the
     populated curl command (the example doesn't run the PUT itself).

✓ Dry-run complete (no network calls made).
```

## What this teaches

- **Manifest shape.** Required fields per `spec/v1/node-packs.md` §"Manifest format": `name`, `version`, `runtime`, `nodes`, `signing`.
- **Naming scopes.** `private.<host>.*` (host-internal) vs `community.*` / `vendor.<org>.*` / `local.*` (per `spec/v1/node-packs.md` §Naming).
- **Canonical JSON.** Sort keys recursively; signing operates on the canonical form so signatures are reproducible.
- **Ed25519 signature flow.** Sign canonical JSON → registry verifies against a published keychain (per `spec/v1/registry-operations.md` §"Signing keychain"); detached `.sig` blob served via `GET /v1/packs/{name}/-/{version}.sig` per `openwop/openwop@434c8f2`.

## What this does NOT do

- **Build a pack tarball.** Real publishing tar-packs a manifest + `dist/` directory. The example has no `dist/` to pack — it's documentation, not a working pack.
- **Register the public key.** A real registry validates signatures against pre-registered public keys (super-admin operation). The example generates ephemeral keys; even if you ran `--print-publish-cmd` and copy-pasted the curl, the registry would reject the signature with `signature_unknown_key` since the public key isn't in the keychain.
- **Test the registry's response shape.** The conformance scenarios `pack-registry.test.ts` + `maliciousManifest.test.ts` cover the registry HTTP contract.

## Why the live PUT is intentionally incomplete

A live publish requires:
1. Super-admin auth at the registry operator level.
2. Pre-registration of the publisher's public key in the keychain.
3. A real built pack tarball — not a stub.

All three are deployment-specific. An example that bundled a working pack would imply that one specific pack shape is canonical, which it isn't. The example shows the protocol contract; the build step is your project's concern.

## See also

- [`../../spec/v1/node-packs.md`](../../spec/v1/node-packs.md) — full pack contract
- [`../../spec/v1/registry-operations.md`](../../spec/v1/registry-operations.md) — operator-side reference
- [`../../SECURITY/threat-model-node-packs.md`](../../SECURITY/threat-model-node-packs.md) — supply-chain threat model
- [`../../conformance/src/scenarios/pack-registry.test.ts`](../../conformance/src/scenarios/pack-registry.test.ts) — registry HTTP contract
