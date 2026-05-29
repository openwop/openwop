#!/usr/bin/env node
/**
 * check-pack-tarball-signatures — cryptographically verify that every
 * non-yanked in-tree pack version's tarball is actually signed by the key
 * the catalog claims.
 *
 * Why this exists (the A2 finding): `check-registry-signer-consistency.mjs`
 * only compares two JSON strings (`index.json` signingKeyId vs the manifest's
 * `signing.publicKeyRef`). It is blind to three real defects that shipped on
 * `core.openwop.examples@1.0.0`:
 *   1. the tarball's `pack.json` carried NO signing block at all (unsigned),
 *   2. the detached `.sig` verified against NO registered key, and
 *   3. the manifest recorded the publisher under the legacy `signing.keyId`
 *      alias, so the string-compare guard read `publicKeyRef` as undefined
 *      and silently SKIPPED the version.
 * A consumer that verifies signatures (every `verified`-mode host) rejects
 * such a pack. This guard is the missing crypto check: it extracts the exact
 * `pack.json` octets that physically live inside the `.tgz`, loads the public
 * key the catalog names, and runs Ed25519 `crypto.verify` against them — the
 * same bytes a strict consumer verifies (per myndhyve's tarball-extract-before-
 * verify posture). Sign the bytes that land in the tarball, not a re-serialized
 * manifest.
 *
 * Checks, per non-yanked version in every `registry/v1/packs/<pack>/index.json`:
 *   A. the tarball embeds `keys/pack.json.sig` (64-byte raw Ed25519 sig),
 *   B. the tarball's `pack.json` declares `signing.publicKeyRef` and it EQUALS
 *      the catalog `signingKeyId`,
 *   C. that key exists at `registry/keys/<keyId>.pub`, and
 *   D. the sig verifies against that key over the EXACT in-tarball pack.json
 *      bytes.
 * Yanked versions are skipped (a yanked artifact is allowed to be broken — that
 * is often WHY it was yanked).
 *
 * Pure Node 20 stdlib (zlib + crypto) — no system `tar`, no npm install.
 *
 * Usage: node scripts/check-pack-tarball-signatures.mjs
 * Exit 0 = every non-yanked version verifies; exit 1 = at least one failure.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createPublicKey, verify as edVerify } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_DIR = join(ROOT, 'registry', 'v1', 'packs');
const KEYS_DIR = join(ROOT, 'registry', 'keys');

/** Minimal USTAR reader — returns Map<name, Buffer> for a gunzipped tar. */
function readTar(gz) {
  const buf = gunzipSync(gz);
  const out = new Map();
  for (let off = 0; off + 512 <= buf.length; ) {
    const block = buf.subarray(off, off + 512);
    if (block.every((b) => b === 0)) break; // end-of-archive
    let name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(block.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    if (prefix) name = prefix + '/' + name;
    name = name.replace(/^\.\//, '');
    const start = off + 512;
    if (name && !name.endsWith('/')) out.set(name, buf.subarray(start, start + size));
    off = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

const failures = [];
let checked = 0;

if (!existsSync(PACKS_DIR)) {
  console.error(`✗ registry packs dir not found: ${PACKS_DIR}`);
  process.exit(1);
}

for (const pack of readdirSync(PACKS_DIR).sort()) {
  const indexPath = join(PACKS_DIR, pack, 'index.json');
  if (!existsSync(indexPath)) continue;
  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (err) {
    failures.push(`${pack}: index.json not valid JSON — ${err.message}`);
    continue;
  }
  for (const v of index.versions ?? []) {
    const ver = v.version;
    if (!ver || v.yanked) continue; // skip yanked — allowed to be broken
    const keyId = v.signingKeyId;
    const tgzPath = join(PACKS_DIR, pack, '-', `${ver}.tgz`);
    if (!existsSync(tgzPath)) {
      failures.push(`${pack}@${ver}: tarball missing at ${ver}.tgz`);
      continue;
    }
    let entries;
    try {
      entries = readTar(readFileSync(tgzPath));
    } catch (err) {
      failures.push(`${pack}@${ver}: cannot read tarball — ${err.message}`);
      continue;
    }
    const packJson = entries.get('pack.json');
    const sig = entries.get('keys/pack.json.sig');
    if (!packJson) {
      failures.push(`${pack}@${ver}: tarball has no pack.json`);
      continue;
    }
    // A. embedded signature present
    if (!sig) {
      failures.push(`${pack}@${ver}: UNSIGNED — tarball has no keys/pack.json.sig (catalog claims signingKeyId="${keyId}")`);
      continue;
    }
    // B. in-tarball signing.publicKeyRef agrees with catalog signingKeyId
    let embeddedRef;
    try {
      embeddedRef = JSON.parse(packJson.toString('utf8'))?.signing?.publicKeyRef;
    } catch (err) {
      failures.push(`${pack}@${ver}: in-tarball pack.json not valid JSON — ${err.message}`);
      continue;
    }
    if (!embeddedRef) {
      failures.push(`${pack}@${ver}: in-tarball pack.json has no signing.publicKeyRef (unsigned manifest)`);
      continue;
    }
    if (keyId !== undefined && embeddedRef !== keyId) {
      failures.push(`${pack}@${ver}: signer drift — catalog signingKeyId="${keyId}" ≠ in-tarball publicKeyRef="${embeddedRef}"`);
      continue;
    }
    // C. public key on disk
    const pubPath = join(KEYS_DIR, `${embeddedRef}.pub`);
    if (!existsSync(pubPath)) {
      failures.push(`${pack}@${ver}: no public key at registry/keys/${embeddedRef}.pub to verify against`);
      continue;
    }
    // D. Ed25519 verify over the EXACT in-tarball pack.json octets
    let pub;
    try {
      pub = createPublicKey(readFileSync(pubPath));
    } catch (err) {
      failures.push(`${pack}@${ver}: bad public key ${embeddedRef}.pub — ${err.message}`);
      continue;
    }
    let valid = false;
    try {
      valid = edVerify(null, packJson, pub, sig);
    } catch (err) {
      failures.push(`${pack}@${ver}: verify threw — ${err.message}`);
      continue;
    }
    if (!valid) {
      failures.push(`${pack}@${ver}: SIGNATURE INVALID — keys/pack.json.sig does not verify against ${embeddedRef} over the in-tarball pack.json bytes`);
      continue;
    }
    checked += 1;
  }
}

if (failures.length) {
  console.error(`✗ pack tarball signature check: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ pack tarball signatures: ${checked} non-yanked version(s) verify against their declared key`);
