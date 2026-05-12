#!/usr/bin/env node
/**
 * Verify Ed25519 signatures on every published pack tarball.
 *
 * Stage 2 PR 2 (2026-05-12): CRITICAL CI gate per the enterprise-
 * architecture review. Before this script, registry-publish.yml only
 * checked for `.sig` file PRESENCE. A bad-actor publisher with namespace
 * approval could sign with their registered key, then sneak-merge a
 * manifest body change leaving the sig stale — the CI gate would never
 * detect the integrity break.
 *
 * For each `registry/v1/packs/<name>/-/<version>.{tgz,sig,json}` triple:
 *   1. Resolve the signing key (`signing.keyId` or legacy `publicKeyRef`)
 *      from the version manifest.
 *   2. Load the corresponding public key from `registry/keys/<keyId>.pub`.
 *   3. Verify the namespace allow-list: keyId MUST be authorized for the
 *      pack's namespace per `.well-known/openwop-registry.json`'s
 *      `signingKeys[].permittedNamespaces`.
 *   4. Extract `pack.json` from the gzipped tarball.
 *   5. Verify the Ed25519 signature against the pack.json bytes.
 *
 * Exits 1 on first failure; reports the count of verified vs failed.
 * Pure Node 20 stdlib — no npm install required.
 *
 * @see services/workflow-runtime/src/registry/signatures.ts (host-side
 *      verifier used at request time; this script mirrors its logic at
 *      publish-PR time)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REGISTRY_ROOT = dirname(dirname(__filename)); // registry/
const PACKS_ROOT = join(REGISTRY_ROOT, 'v1', 'packs');
const KEYS_ROOT = join(REGISTRY_ROOT, 'keys');
const DISCOVERY_PATH = join(REGISTRY_ROOT, '.well-known', 'openwop-registry.json');

const TTY = process.stdout.isTTY;
const C = TTY
  ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { red: '', green: '', yellow: '', dim: '', reset: '' };
const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const fail = (s) => console.error(`${C.red}✗${C.reset} ${s}`);
const warn = (s) => console.log(`${C.yellow}⚠${C.reset} ${s}`);
const dim = (s) => console.log(`${C.dim}${s}${C.reset}`);

// ─── tarball extraction ─────────────────────────────────────────────

/**
 * Extract `pack.json` from a gzipped USTAR tarball. Returns its raw bytes
 * (the publisher signs raw bytes, not parsed-and-re-serialized).
 */
function extractPackJson(tarballBytes) {
  const decompressed = gunzipSync(tarballBytes);
  // USTAR block size = 512 bytes. Each entry: 512-byte header + N×512 data blocks.
  const BLOCK = 512;
  for (let off = 0; off + BLOCK <= decompressed.length; ) {
    // Header layout: name (0..100), size (124..136, octal ASCII).
    const nameBuf = decompressed.subarray(off, off + 100);
    const nameEnd = nameBuf.indexOf(0);
    const name = nameBuf.subarray(0, nameEnd < 0 ? 100 : nameEnd).toString('utf8');
    if (!name) break; // zero block — end of archive
    const sizeStr = decompressed.subarray(off + 124, off + 136).toString('ascii').replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = decompressed[off + 156];
    // PAX extended header ('x'=0x78) or GNU LongLink ('L'=0x4c) means a
    // following entry has a name longer than 100 bytes. The 100-byte
    // name field on subsequent entries is then truncated; pack.json
    // could be silently mis-identified. Fail fast.
    if (typeflag === 0x78 || typeflag === 0x4c) {
      throw new Error(
        `USTAR extended header (typeflag=0x${typeflag.toString(16)}) not supported; pack tarballs MUST keep entry names <= 100 bytes`
      );
    }
    if (name === 'pack.json' || name === './pack.json') {
      return decompressed.subarray(off + BLOCK, off + BLOCK + size);
    }
    // Advance past header + data (rounded up to BLOCK).
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error('pack.json not found in tarball');
}

// ─── namespace allow-list resolution ────────────────────────────────

function loadDiscovery() {
  return JSON.parse(readFileSync(DISCOVERY_PATH, 'utf8'));
}

/**
 * Check that `keyId` is authorized for `packName` per the discovery doc's
 * `signingKeys[].permittedNamespaces` allow-list. Each entry is a wildcard
 * glob (e.g., `vendor.myndhyve.*`).
 *
 * Returns the matching entry on success, or `null` on policy violation.
 */
function authorizeKeyForNamespace(discovery, keyId, packName) {
  const entry = (discovery.signingKeys ?? []).find((k) => k.keyId === keyId);
  if (!entry) return null;
  const namespaces = entry.permittedNamespaces ?? [];
  for (const pattern of namespaces) {
    // Convert `foo.bar.*` to a prefix match.
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2) + '.';
      if (packName.startsWith(prefix)) return entry;
    } else if (pattern === packName) {
      return entry;
    }
  }
  return null;
}

// ─── per-pack verification ──────────────────────────────────────────

function verifyOne(packName, version, discovery) {
  const baseDir = join(PACKS_ROOT, packName, '-');
  const tarballPath = join(baseDir, `${version}.tgz`);
  const sigPath = join(baseDir, `${version}.sig`);
  const manifestPath = join(baseDir, `${version}.json`);

  if (!existsSync(tarballPath)) throw new Error(`missing tarball: ${tarballPath}`);
  if (!existsSync(sigPath)) throw new Error(`missing sig: ${sigPath}`);
  if (!existsSync(manifestPath)) throw new Error(`missing manifest: ${manifestPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const signing = manifest.signing;
  if (!signing) throw new Error('manifest missing `signing` block');
  const keyId = signing.keyId ?? signing.publicKeyRef;
  if (!keyId) throw new Error('manifest signing block missing keyId/publicKeyRef');

  // 1. Authorize keyId against the namespace allow-list.
  const authEntry = authorizeKeyForNamespace(discovery, keyId, packName);
  if (!authEntry) {
    throw new Error(
      `key '${keyId}' NOT authorized for namespace '${packName}' ` +
      `(check .well-known/openwop-registry.json signingKeys[].permittedNamespaces)`
    );
  }

  // 2. Load public key from registry/keys/<keyId>.pub.
  const keyPath = join(KEYS_ROOT, `${keyId}.pub`);
  if (!existsSync(keyPath)) throw new Error(`public key not found: ${keyPath}`);
  const publicKey = createPublicKey(readFileSync(keyPath, 'utf8'));

  // 3. Read the bytes the publisher signed over. Two conventions exist:
  //   - signing.method === 'ed25519' (original packs per registry/README.md
  //     §Sign): signature over the WHOLE gzipped tarball bytes. Produced
  //     by `openssl pkeyutl -sign -in <tarball>.tgz`.
  //   - signing.method === 'manual' (newer packs per build-pack-tarball.mjs):
  //     signature over the pack.json bytes INSIDE the tarball. Tarball is
  //     deterministic so consumers can re-derive the same bytes.
  //
  // Both conventions use Ed25519 and a 64-byte detached sig. Choose the
  // bytes-to-verify based on the manifest's `method`.
  const tarballBytes = readFileSync(tarballPath);
  const method = signing.method;
  let signedBytes;
  let signedKind;
  if (method === 'ed25519') {
    signedBytes = tarballBytes;
    signedKind = 'tarball';
  } else if (method === 'manual') {
    signedBytes = extractPackJson(tarballBytes);
    signedKind = 'pack.json';
  } else {
    throw new Error(`unsupported signing.method='${method}'; expected 'ed25519' or 'manual'`);
  }

  // 4. Read detached signature (64-byte raw Ed25519).
  const sigBytes = readFileSync(sigPath);
  if (sigBytes.length !== 64) {
    throw new Error(`sig file has unexpected size ${sigBytes.length}, expected 64 bytes for Ed25519`);
  }

  // 5. Verify Ed25519 signature.
  const valid = cryptoVerify(null, signedBytes, publicKey, sigBytes);
  if (!valid) {
    throw new Error(`signature does not match ${signedKind} bytes for ${keyId}`);
  }

  return { keyId, operator: authEntry.operator, signedKind };
}

// ─── main ────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(PACKS_ROOT)) {
    warn('no registry/v1/packs/ directory; nothing to verify');
    process.exit(0);
  }
  const discovery = loadDiscovery();
  const packs = readdirSync(PACKS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let checked = 0;
  let failed = 0;
  for (const pack of packs.sort()) {
    const versionsDir = join(PACKS_ROOT, pack, '-');
    if (!existsSync(versionsDir)) continue;
    const versions = readdirSync(versionsDir)
      .filter((f) => f.endsWith('.tgz'))
      .map((f) => f.slice(0, -4));
    for (const version of versions) {
      checked++;
      try {
        const { keyId, operator, signedKind } = verifyOne(pack, version, discovery);
        ok(`${pack}@${version}  (keyId=${keyId}, over=${signedKind}, operator=${operator ?? 'unknown'})`);
      } catch (err) {
        fail(`${pack}@${version}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log('');
  if (failed === 0) {
    ok(`verified ${checked} signed pack(s)`);
    process.exit(0);
  } else {
    fail(`${failed} of ${checked} pack(s) failed signature verification`);
    process.exit(1);
  }
}

main();
