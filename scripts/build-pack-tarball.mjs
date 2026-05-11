#!/usr/bin/env node
/**
 * Build a deterministic gzipped USTAR tarball for one local pack +
 * sign its manifest canonical JSON with Ed25519.
 *
 *   node scripts/build-pack-tarball.mjs --pack <pack-name>
 *   node scripts/build-pack-tarball.mjs --all
 *
 * Optional:
 *   --key <path>        PEM-encoded Ed25519 private key. If omitted,
 *                       a one-shot keypair is generated and the public
 *                       key is printed (dev/test mode).
 *   --out <dir>         Output dir (default: dist/packs).
 *   --validate-only     Validate the manifest + canonical JSON shape;
 *                       skip tarball write.
 *   --signed            Embed a `signing` block into the manifest +
 *                       embed the Ed25519 signature inside the tarball
 *                       at `keys/pack.json.sig`. Required for any pack
 *                       whose name doesn't start with `private.` —
 *                       the registry's verifyPublishSignature() refuses
 *                       unsigned tarballs for those.
 *   --key-id <id>       publicKeyRef written into the signing block.
 *                       Defaults to "openwop-team-1". The registry's
 *                       keychain MUST have the matching public key
 *                       pre-registered under this id.
 *
 * For each pack the script produces:
 *
 *   dist/packs/<name>-<version>.tgz             gzipped USTAR tarball
 *   dist/packs/<name>-<version>.manifest.json   pack.json (copy)
 *   dist/packs/<name>-<version>.sig.b64         Ed25519 sig (base64)
 *   dist/packs/<name>-<version>.integrity.txt   sha256:<hex>
 *
 * Deterministic tarball — no host-specific metadata:
 *   - mtime: 0 (epoch)
 *   - uid/gid: 0; uname/gname: ""
 *   - mode: 644 (files only — no directory entries)
 *   - entry order: lexicographic by path
 *   - file set: pack.json, LICENSE, README.md, index.mjs, schemas/*
 *               (everything else — node_modules, __tests__, .DS_Store,
 *               .git — excluded)
 *
 * Same inputs → byte-identical tarball → byte-identical sha256.
 *
 * Spec: https://github.com/openwop/openwop/blob/main/spec/v1/node-packs.md
 *       §"Manifest format" + §"Signing" + §"Registry HTTP API"
 */

import { readFileSync, readdirSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash as createCryptoHash, generateKeyPairSync, sign as ed25519Sign, createPrivateKey } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PACKS_DIR = join(REPO_ROOT, 'packs');
const DEFAULT_OUT = join(REPO_ROOT, 'dist', 'packs');

const TTY = process.stdout.isTTY;
const C = TTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' }
  : { dim: '', red: '', green: '', yellow: '', reset: '' };
const ok = (s) => console.log(`${C.green}${s}${C.reset}`);
const warn = (s) => console.log(`${C.yellow}${s}${C.reset}`);
const fail = (s) => console.error(`${C.red}${s}${C.reset}`);
const dim = (s) => console.log(`${C.dim}${s}${C.reset}`);

// ─── arg parsing ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    pack: null, all: false, key: null, out: DEFAULT_OUT,
    validateOnly: false, signed: false, keyId: 'openwop-team-1',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack') args.pack = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--key') args.key = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--validate-only') args.validateOnly = true;
    else if (a === '--signed') args.signed = true;
    else if (a === '--key-id') args.keyId = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: build-pack-tarball.mjs [--pack <name> | --all] [--key <path>] [--out <dir>] [--validate-only] [--signed [--key-id <id>]]');
      process.exit(0);
    } else {
      fail(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ─── canonical JSON (RFC 8785-style key-sorted) ──────────────────────

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

// ─── USTAR writer (self-contained — no deps) ─────────────────────────

function ustarHeader(name, size) {
  const buf = Buffer.alloc(512, 0);
  const writeOctal = (n, len, offset) => {
    const s = n.toString(8).padStart(len - 1, '0') + '\0';
    buf.write(s, offset, len, 'ascii');
  };
  // Long names go in `prefix` (155 bytes) + `name` (100 bytes); USTAR
  // splits on the last '/' that keeps name ≤100. Our paths are all
  // short (< 100), so name field alone suffices.
  if (name.length > 100) {
    throw new Error(`path too long for USTAR name field: ${name}`);
  }
  buf.write(name, 0, 100, 'ascii');
  writeOctal(0o644, 8, 100);   // mode
  writeOctal(0, 8, 108);        // uid
  writeOctal(0, 8, 116);        // gid
  writeOctal(size, 12, 124);    // size
  writeOctal(0, 12, 136);       // mtime (epoch)
  // checksum field starts as 8 spaces (0x20) for the computation
  for (let i = 148; i < 156; i++) buf[i] = 0x20;
  buf[156] = 0x30;              // typeflag '0' (regular file)
  // linkname (157..256) — leave zero
  buf.write('ustar\0', 257, 6, 'ascii'); // magic
  buf.write('00', 263, 2, 'ascii');       // version
  // uname/gname empty (265..328) — leave zero
  // devmajor/devminor (329..344) — leave zero
  // prefix (345..499) — leave zero

  // Compute checksum: sum of all unsigned bytes.
  let chksum = 0;
  for (let i = 0; i < 512; i++) chksum += buf[i];
  writeOctal(chksum, 8, 148);

  return buf;
}

function buildUstarGzip(entries) {
  // entries: [{name, content: Buffer}], must be sorted by name.
  const chunks = [];
  for (const { name, content } of entries) {
    chunks.push(ustarHeader(name, content.length));
    chunks.push(content);
    const pad = 512 - (content.length % 512);
    if (pad !== 512) chunks.push(Buffer.alloc(pad, 0));
  }
  // Archive terminator: 2 × 512-byte zero blocks.
  chunks.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(chunks);
  // gzip with mtime: 0 so the gzip header is also deterministic.
  // node's zlib.gzipSync doesn't expose mtime directly, but the
  // default sync gzip header writes mtime as 0 when called with a
  // raw Buffer + no options. Verified by inspecting bytes 4..7 of
  // the resulting gzip output below.
  const gz = gzipSync(tar, { level: 9 });
  // Stomp gzip header mtime (bytes 4..7 little-endian) to 0 for
  // belt-and-suspenders determinism — Node already writes 0 here
  // but be explicit so a future zlib change doesn't break us.
  gz[4] = 0; gz[5] = 0; gz[6] = 0; gz[7] = 0;
  // Stomp OS byte (byte 9) to 0xFF (unknown) instead of host's OS id.
  gz[9] = 0xff;
  return gz;
}

// ─── pack walk ───────────────────────────────────────────────────────

const ALLOWED_TOPS = new Set(['pack.json', 'README.md', 'LICENSE', 'index.mjs']);
const ALLOWED_DIRS = new Set(['schemas', 'keys']);

function walkPack(packDir) {
  const entries = [];
  for (const name of readdirSync(packDir).sort()) {
    const full = join(packDir, name);
    const st = statSync(full);
    if (st.isFile()) {
      if (!ALLOWED_TOPS.has(name)) continue;
      entries.push({ name, content: readFileSync(full) });
    } else if (st.isDirectory()) {
      if (!ALLOWED_DIRS.has(name)) continue;
      for (const f of readdirSync(full).sort()) {
        if (!f.endsWith('.json') && !f.endsWith('.pem') && !f.endsWith('.sig')) continue;
        entries.push({ name: `${name}/${f}`, content: readFileSync(join(full, f)) });
      }
    }
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries;
}

// ─── ed25519 ─────────────────────────────────────────────────────────

function loadOrGeneratePrivateKey(keyPath) {
  if (keyPath) {
    const pem = readFileSync(resolve(keyPath), 'utf8');
    return createPrivateKey({ key: pem, format: 'pem' });
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  warn('  ⚠ --key omitted; generated ephemeral keypair. PUBLIC KEY (DER, base64):');
  warn(`  ${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`);
  warn('  (Pre-register this with the registry operator before publishing.)');
  return privateKey;
}

// ─── per-pack build ──────────────────────────────────────────────────

function buildPack(packName, args) {
  const packDir = join(PACKS_DIR, packName);
  if (!existsSync(packDir)) {
    fail(`✗ pack dir not found: ${packDir}`);
    return false;
  }

  const manifestPath = join(packDir, 'pack.json');
  if (!existsSync(manifestPath)) {
    fail(`✗ pack.json missing: ${packName}`);
    return false;
  }

  const manifestText = readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    fail(`✗ pack.json not valid JSON: ${packName} — ${err.message}`);
    return false;
  }

  if (manifest.name !== packName) {
    fail(`✗ pack.json name (${manifest.name}) ≠ dir name (${packName})`);
    return false;
  }
  if (!manifest.version) {
    fail(`✗ pack.json missing version: ${packName}`);
    return false;
  }

  // Signed mode: registry's verifyPublishSignature() requires the
  // manifest to declare a signing block AND for the signature to live
  // inside the tarball at `signing.signatureRef`. The canonical JSON
  // we sign is computed over the AUGMENTED manifest (with the signing
  // block) so the verifier can recompute the same canonical bytes from
  // the in-tarball pack.json.
  const requiresSignature = !packName.startsWith('private.');
  if (requiresSignature && !args.signed && !args.validateOnly) {
    warn(`  ⚠ ${packName} is non-private; registry will reject unsigned tarball. Add --signed.`);
  }

  let signedManifest = manifest;
  if (args.signed) {
    signedManifest = {
      ...manifest,
      signing: {
        method: 'manual',
        algorithm: 'ed25519',
        publicKeyRef: args.keyId,
        signatureRef: 'keys/pack.json.sig',
      },
    };
  }

  const canonical = canonicalJson(signedManifest);

  if (args.validateOnly) {
    ok(`✓ ${packName}@${manifest.version} — manifest valid (${canonical.length} canonical bytes)`);
    return true;
  }

  if (!existsSync(args.out)) mkdirSync(args.out, { recursive: true });

  // Sign the manifest canonical JSON (always — used for off-tarball
  // .sig.b64 artifact + optionally embedded inside tarball).
  const privateKey = loadOrGeneratePrivateKey(args.key);
  const sig = ed25519Sign(null, Buffer.from(canonical, 'utf8'), privateKey);

  // Walk the source dir; if --signed, replace the on-disk pack.json
  // entry with the canonical-augmented version + append the sig file
  // at keys/pack.json.sig.
  let entries = walkPack(packDir);
  if (args.signed) {
    const augmentedManifestBytes = Buffer.from(JSON.stringify(signedManifest, null, 2) + '\n', 'utf8');
    entries = entries.map((e) =>
      e.name === 'pack.json' ? { name: 'pack.json', content: augmentedManifestBytes } : e,
    );
    // The verifier needs the sig file inside the tarball. Use the
    // raw 64-byte Ed25519 signature (not base64) — verifySignature
    // uses crypto.verify which expects raw bytes for the
    // node:crypto Ed25519 signature format.
    entries.push({ name: 'keys/pack.json.sig', content: sig });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  const tgz = buildUstarGzip(entries);
  const sha = createCryptoHash('sha256').update(tgz).digest('hex');

  const base = `${packName}-${manifest.version}`;
  writeFileSync(join(args.out, `${base}.tgz`), tgz);
  writeFileSync(
    join(args.out, `${base}.manifest.json`),
    args.signed ? JSON.stringify(signedManifest, null, 2) + '\n' : manifestText,
  );
  writeFileSync(join(args.out, `${base}.sig.b64`), sig.toString('base64'));
  writeFileSync(join(args.out, `${base}.integrity.txt`), `sha256:${sha}\n`);

  ok(`✓ ${packName}@${manifest.version}${args.signed ? ' [signed]' : ''}`);
  dim(`  entries: ${entries.length}  size: ${tgz.length}b  sha256: ${sha.slice(0, 16)}…`);
  return true;
}

// ─── main ────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));

if (!args.pack && !args.all) {
  fail('✗ specify --pack <name> or --all');
  process.exit(2);
}

const packs = args.all
  ? readdirSync(PACKS_DIR).filter((n) => {
      const full = join(PACKS_DIR, n);
      return statSync(full).isDirectory() && existsSync(join(full, 'pack.json'));
    }).sort()
  : [args.pack];

console.log(`=== Building ${packs.length} pack tarball${packs.length === 1 ? '' : 's'} ===`);
console.log(`out: ${args.out}`);
console.log('');

let okCount = 0;
let failCount = 0;
for (const p of packs) {
  if (buildPack(p, args)) okCount++;
  else failCount++;
}

console.log('');
if (failCount === 0) {
  ok(`✓ ${okCount} pack${okCount === 1 ? '' : 's'} built`);
  process.exit(0);
} else {
  fail(`✗ ${failCount} failure${failCount === 1 ? '' : 's'} (${okCount} succeeded)`);
  process.exit(1);
}
