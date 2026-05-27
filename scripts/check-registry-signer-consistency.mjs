#!/usr/bin/env node
/**
 * check-registry-signer-consistency — verify that every published pack version's
 * catalog `index.json` `versions[].signingKeyId` matches the authoritative
 * per-version manifest `signing.publicKeyRef` (the key that actually produced the
 * tarball signature at `signatureUrl`).
 *
 * Why: the catalog `signingKeyId` sits beside `signatureUrl` + `integrity` and is
 * what a consumer keys tarball-signature verification off. If it names a different
 * key than the one that actually signed the tarball, a strict consumer rejects a
 * correctly-signed pack. This drift (catalog said `openwop-registry-root` while the
 * tarball was signed by the real publisher key) went unnoticed because no guard
 * compared the two. This script is that guard.
 *
 * Authoritative source: the per-version manifest `registry/v1/packs/<pack>/-/<v>.json`
 * `signing.publicKeyRef` — it lives next to the tarball + verifies against the actual
 * `.sig`. The catalog `index.json` MUST agree with it.
 *
 * Usage: node scripts/check-registry-signer-consistency.mjs
 * Exit 0 = consistent; exit 1 = drift found (lists every mismatch).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_DIR = join(ROOT, 'registry', 'v1', 'packs');

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

const mismatches = [];
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
    index = readJson(indexPath);
  } catch (err) {
    mismatches.push(`${pack}: index.json not valid JSON — ${err.message}`);
    continue;
  }
  for (const v of index.versions ?? []) {
    const ver = v.version;
    if (!ver) continue;
    const declared = v.signingKeyId;
    if (declared === undefined) continue; // catalog omits the field — nothing to compare
    const manPath = join(PACKS_DIR, pack, '-', `${ver}.json`);
    if (!existsSync(manPath)) {
      mismatches.push(`${pack}@${ver}: index.json declares signingKeyId="${declared}" but per-version manifest ${ver}.json is missing`);
      continue;
    }
    let actual;
    try {
      actual = readJson(manPath)?.signing?.publicKeyRef;
    } catch (err) {
      mismatches.push(`${pack}@${ver}: manifest ${ver}.json not valid JSON — ${err.message}`);
      continue;
    }
    checked += 1;
    if (actual && declared !== actual) {
      mismatches.push(`${pack}@${ver}: index.json signingKeyId="${declared}" ≠ manifest signing.publicKeyRef="${actual}"`);
    }
  }
}

if (mismatches.length > 0) {
  console.error(`✗ registry signer-metadata drift — ${mismatches.length} mismatch(es) across ${checked} version(s):`);
  for (const m of mismatches) console.error(`  ${m}`);
  console.error(
    '\n  Fix: set each catalog index.json versions[].signingKeyId to the per-version manifest\n' +
      "  signing.publicKeyRef (the key that actually signed the tarball at signatureUrl).",
  );
  process.exit(1);
}

console.log(`check-registry-signer-consistency OK — ${checked} published pack-version(s); catalog signingKeyId matches the per-version manifest signer.`);
