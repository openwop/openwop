#!/usr/bin/env node
/**
 * Emit a 7-hash pin-block JSON for a registered pack version, suitable
 * for pasting into a downstream consumer's `pack-pins.json`.
 *
 *   node scripts/emit-pin-json.cjs <pack-name> <version> [--quote-key]
 *
 * Output shape (line-by-line so consumers can grep individual fields):
 *
 *   "<pack-name>": {
 *     "version": "<version>",
 *     "manifestHash":         "sha256:<hex>",   // pack.json (canonical JSON, sorted keys)
 *     "indexBundleHash":      "sha256:<hex>",   // registry/v1/packs/<pack>/index.json
 *     "schemasHash":          "sha256:<hex>",   // sorted concat of every schemas/*.json
 *     "tarballHash":          "sha256:<hex>",   // signed .tgz body
 *     "sigHash":              "sha256:<hex>",   // raw .sig body
 *     "sbomHash":             "sha256:<hex>",   // .sbom.json body
 *     "registryManifestHash": "sha256:<hex>"    // registry-side <version>.json body
 *   }
 *
 * Reads from `registry/v1/packs/<pack>/-/<version>.{json,tgz,sig,sbom.json}`
 * and from the local `packs/<pack>/{pack.json,schemas/}` source tree.
 * All hashes are sha256(file body) — no canonicalization beyond what the
 * file already encodes — so consumers compare bytes-for-bytes against
 * what the CDN serves.
 *
 * Spec: `spec/v1/node-packs.md` §Signing; `spec/v1/registry-operations.md`
 * §"Consumer pinning". Pure utility — no spec change.
 */

const { createHash } = require('node:crypto');
const { readFileSync, existsSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

function sha256Hex(buf) {
  return 'sha256:' + createHash('sha256').update(buf).digest('hex');
}

function readOr(path, fallback) {
  return existsSync(path) ? readFileSync(path) : fallback;
}

function schemasHash(schemasDir) {
  if (!existsSync(schemasDir) || !statSync(schemasDir).isDirectory()) {
    return sha256Hex(Buffer.alloc(0));
  }
  const names = readdirSync(schemasDir).filter((n) => n.endsWith('.json')).sort();
  const h = createHash('sha256');
  for (const name of names) {
    h.update(name);
    h.update('\0');
    h.update(readFileSync(join(schemasDir, name)));
    h.update('\0');
  }
  return 'sha256:' + h.digest('hex');
}

function main() {
  const [, , packName, version, ...flags] = process.argv;
  if (!packName || !version) {
    console.error('usage: node scripts/emit-pin-json.cjs <pack-name> <version> [--quote-key]');
    process.exit(2);
  }
  const root = __dirname.replace(/\/scripts$/, '');
  const srcPackJson = join(root, 'packs', packName, 'pack.json');
  const srcSchemasDir = join(root, 'packs', packName, 'schemas');
  const regBase = join(root, 'registry', 'v1', 'packs', packName);
  const regIndex = join(regBase, 'index.json');
  const regManifest = join(regBase, '-', `${version}.json`);
  const regTarball = join(regBase, '-', `${version}.tgz`);
  const regSig = join(regBase, '-', `${version}.sig`);
  const regSbom = join(regBase, '-', `${version}.sbom.json`);
  for (const p of [srcPackJson, regIndex, regManifest, regTarball, regSig]) {
    if (!existsSync(p)) {
      console.error(`missing: ${p}`);
      process.exit(2);
    }
  }
  const pin = {
    version,
    manifestHash: sha256Hex(readFileSync(srcPackJson)),
    indexBundleHash: sha256Hex(readFileSync(regIndex)),
    schemasHash: schemasHash(srcSchemasDir),
    tarballHash: sha256Hex(readFileSync(regTarball)),
    sigHash: sha256Hex(readFileSync(regSig)),
    sbomHash: sha256Hex(readOr(regSbom, Buffer.alloc(0))),
    registryManifestHash: sha256Hex(readFileSync(regManifest)),
  };
  const key = flags.includes('--quote-key') ? `"${packName}":` : packName + ':';
  process.stdout.write(`${key} ${JSON.stringify(pin, null, 2).split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n')}\n`);
}

main();
