// Node-pack publishing example — build manifest, sign with Ed25519,
// validate locally, optionally PUT to a registry.
//
// Defaults to --dry-run mode (no network). Real publishing requires
// super-admin auth which most readers don't have, so the default is
// to demonstrate the steps locally:
//
//   1. Generate (or load) an Ed25519 keypair.
//   2. Construct a manifest under the `private.local-example` scope
//      (a real public registry won't accept this scope — safe-by-default).
//   3. Sign the manifest's canonical JSON with the private key.
//   4. (Optional, --print-publish-cmd) print the curl PUT command
//      that a super-admin operator would run to publish the binary
//      tarball + manifest to the registry at OPENWOP_PACK_REGISTRY_URL
//      with OPENWOP_PACK_PUBLISH_KEY Bearer auth.
//
//      The flag was previously named --live; that name implied the
//      example would do the actual PUT, which it doesn't (the example
//      doesn't ship a buildable pack source). --live is accepted as
//      a deprecated alias.
//
// Profile required: openwop-node-packs (for --print-publish-cmd mode).
// CI runs --dry-run only.
//
// @see spec/v1/node-packs.md §"Manifest format" + §"Registry HTTP API"
// @see spec/v1/registry-operations.md §"Submission validation"

import { generateKeyPairSync, sign as ed25519Sign } from 'node:crypto';

// Tiny ANSI helpers — colors when stdout is a TTY, no-op when piped/CI.
const _tty = process.stdout.isTTY;
const _c = _tty
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' }
  : { dim: '', red: '', green: '', reset: '' };
const skip = (msg) => console.log(`${_c.dim}${msg}${_c.reset}`);
const fail = (msg) => console.error(`${_c.red}${msg}${_c.reset}`);
const ok = (msg) => console.log(`${_c.green}${msg}${_c.reset}`);

const args = new Set(process.argv.slice(2));
// `--live` was renamed to `--print-publish-cmd` per code-review #7
// (the previous --live flag prints documentation, not actual PUT).
// `--live` is accepted as a deprecated alias.
const LIVE = args.has('--print-publish-cmd') || args.has('--live');

const REGISTRY_URL = process.env.OPENWOP_PACK_REGISTRY_URL ?? '';
const PUBLISH_KEY = process.env.OPENWOP_PACK_PUBLISH_KEY ?? '';

function canonicalJson(obj) {
  // Deterministic JSON encoding for signing — sort keys recursively.
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]));
  return '{' + entries.join(',') + '}';
}

function buildManifest() {
  // Pack name uses the `private.local-example.*` scope so a real
  // public registry won't accept it (per spec/v1/node-packs.md §Naming).
  // This is intentional — the example is safe by default.
  return {
    name: 'private.local-example.echo-tool',
    version: '1.0.0',
    description: 'Reference example pack — single core.noop-style node, demonstration only.',
    license: 'Apache-2.0',
    runtime: { engine: 'openwop-v1' },
    nodes: [
      {
        id: 'echo',
        typeId: 'core.noop',
        // Real packs have node code under `dist/` referenced by entry.
        // The dry-run example doesn't actually build a tarball; it
        // just prints what the manifest would contain.
        entry: 'dist/echo.js',
      },
    ],
    signing: {
      algorithm: 'ed25519',
      // signatureRef is host-resolved per spec/v1/node-packs.md §Signing;
      // the registry serves the signature blob via GET .sig endpoint.
      signatureRef: 'detached',
    },
  };
}

function buildSignature(manifest, privateKey) {
  const canonical = canonicalJson(manifest);
  const signature = ed25519Sign(null, Buffer.from(canonical, 'utf-8'), privateKey);
  return {
    canonical,
    signatureBase64: signature.toString('base64'),
  };
}

async function dryRun(manifest, signed, publicKey) {
  console.log(`→ Built manifest:`);
  console.log(`  name:     ${manifest.name}`);
  console.log(`  version:  ${manifest.version}`);
  console.log(`  scope:    private.local-example (won't accept on public registries)`);
  console.log(`  signing:  ${manifest.signing.algorithm} / ${manifest.signing.signatureRef}`);
  console.log('');
  console.log(`→ Canonical JSON (${signed.canonical.length} bytes):`);
  console.log(`  ${signed.canonical.slice(0, 120)}${signed.canonical.length > 120 ? '...' : ''}`);
  console.log('');
  console.log(`→ Ed25519 signature (base64): ${signed.signatureBase64.slice(0, 40)}...`);
  console.log('');
  console.log(`→ Public key (DER, base64):  ${publicKey.export({ type: 'spki', format: 'der' }).toString('base64').slice(0, 40)}...`);
  console.log('');
  console.log('To publish to a real registry:');
  console.log('  1. Pre-register your public key with the registry operator');
  console.log('     (super-admin action; out of scope for this example).');
  console.log('  2. Build the actual pack tarball:');
  console.log('       cd your-pack-source && tar czf pack.tgz manifest.json dist/');
  console.log('  3. PUT the tarball:');
  console.log(`       curl -X PUT \\
         "$OPENWOP_PACK_REGISTRY_URL/v1/packs/${manifest.name}/-/${manifest.version}" \\
         -H "Authorization: Bearer $OPENWOP_PACK_PUBLISH_KEY" \\
         -H "Content-Type: application/gzip" \\
         --data-binary @pack.tgz`);
  console.log('  4. Re-run this example with --print-publish-cmd to print');
  console.log('     the populated curl above; the example does not run the PUT itself.');
  console.log('');
  ok('✓ Dry-run complete (no network calls made).');
}

async function liveRun(manifest, signed, publicKey) {
  if (!REGISTRY_URL) {
    fail('✗ --print-publish-cmd requires OPENWOP_PACK_REGISTRY_URL');
    process.exit(1);
  }
  if (!PUBLISH_KEY) {
    fail('✗ --print-publish-cmd requires OPENWOP_PACK_PUBLISH_KEY (super-admin Bearer)');
    process.exit(1);
  }

  console.log(`→ Probing registry: ${REGISTRY_URL}/.well-known/openwop`);
  const discovery = await fetch(`${REGISTRY_URL}/.well-known/openwop`);
  if (!discovery.ok) {
    fail(`✗ discovery failed: ${discovery.status}`);
    process.exit(1);
  }
  const caps = await discovery.json();
  console.log(`  Host: ${caps.implementation?.name ?? 'unknown'}`);

  // Real PUT requires actual binary tarball — dry-run example doesn't
  // ship one. The --live mode here is documentation for the path; a
  // production publishing tool builds the tarball from a project dir.
  console.log('');
  skip('⊘ --print-publish-cmd mode requires a built pack tarball — the example doesn\'t');
  skip('  ship a buildable pack source. To complete live publish:');
  skip('  1. Build a tarball from your pack source dir.');
  skip('  2. PUT it via the curl command printed in --dry-run mode.');
  console.log('');
  console.log('  This split is intentional: the example demonstrates manifest');
  console.log('  + signing flow safely; the actual build + PUT is a per-pack');
  console.log('  operation, not a single canonical example.');
  process.exit(0);
}

async function main() {
  console.log('=== OpenWOP node-pack publishing example ===');
  console.log(`Mode: ${LIVE ? 'print-publish-cmd' : 'dry-run (default)'}`);
  console.log('');

  // Step 1: keypair
  console.log('→ Generating Ed25519 keypair...');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  console.log('  ✓ keypair generated');

  // Step 2: manifest
  const manifest = buildManifest();

  // Step 3: sign
  const signed = buildSignature(manifest, privateKey);

  if (!LIVE) {
    await dryRun(manifest, signed, publicKey);
    return;
  }
  await liveRun(manifest, signed, publicKey);
}

main().catch((err) => {
  fail(`✗ ${err.message}`);
  process.exit(1);
});
