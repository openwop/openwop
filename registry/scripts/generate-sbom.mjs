#!/usr/bin/env node
/**
 * Generate CycloneDX 1.6 SBOMs for every published pack.
 *
 * Stage 4 PR 2 (2026-05-12): operational maturity per the enterprise-
 * architecture review. Each published pack tarball gets a sibling
 * `<version>.sbom.json` containing:
 *   - the pack as the top-level component (name, version, license,
 *     purl, sha-256 integrity)
 *   - one `components[]` entry per file inside the tarball, with the
 *     file's sha-256 hash (lets consumers cross-check that every file
 *     they extract matches what the publisher signed)
 *   - peerDependencies (declared host capabilities) as `dependencies[]`
 *     entries (e.g., the host MUST advertise `aiProviders.supported`
 *     for a pack with that peer)
 *
 * Aggregate `registry/v1/sbom.json` lists every pack version with a
 * reference back to its per-version SBOM URL.
 *
 * Deterministic: same registry tree -> same bytes. No timestamps, no
 * UUIDs derived from process time. The CI `--check` mode regenerates
 * + compares; any drift fails the gate.
 *
 * Pure Node 20 stdlib — no npm install required.
 *
 * Usage:
 *   node registry/scripts/generate-sbom.mjs           # write
 *   node registry/scripts/generate-sbom.mjs --check   # fail if files would change
 *
 * @see https://cyclonedx.org/specification/overview/ (CycloneDX 1.6)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // registry/
const PACKS_ROOT = join(REGISTRY_ROOT, 'v1', 'packs');
const AGGREGATE_PATH = join(REGISTRY_ROOT, 'v1', 'sbom.json');

const args = new Set(process.argv.slice(2));
const CHECK_MODE = args.has('--check');

const TTY = process.stdout.isTTY;
const C = TTY
  ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { red: '', green: '', yellow: '', dim: '', reset: '' };
const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const fail = (s) => console.error(`${C.red}✗${C.reset} ${s}`);
const warn = (s) => console.log(`${C.yellow}⚠${C.reset} ${s}`);
const dim = (s) => console.log(`${C.dim}${s}${C.reset}`);

// ─── tarball enumeration ────────────────────────────────────────────

/**
 * Enumerate every file in a gzipped USTAR tarball, returning
 * `[{ name, sha256, size }]` sorted by name (deterministic).
 *
 * USTAR block size is 512 bytes. Each entry: 512-byte header + N×512
 * data blocks (N = ceil(size / 512)). End-of-archive is a zero-name
 * block. Directory entries (`./`) are skipped.
 */
function enumerateTarball(tarballBytes) {
  const decompressed = gunzipSync(tarballBytes);
  const BLOCK = 512;
  const files = [];
  for (let off = 0; off + BLOCK <= decompressed.length; ) {
    const nameBuf = decompressed.subarray(off, off + 100);
    const nameEnd = nameBuf.indexOf(0);
    const rawName = nameBuf.subarray(0, nameEnd < 0 ? 100 : nameEnd).toString('utf8');
    if (rawName === '') break; // real end-of-archive
    // USTAR allows a leading `./` on every entry; strip it for the
    // canonical filename. The bare `./` entry (directory marker) becomes
    // `''` after stripping — skip those, do NOT treat as end-of-archive.
    const name = rawName.replace(/^\.\//, '');
    const sizeStr = decompressed
      .subarray(off + 124, off + 136)
      .toString('ascii')
      .replace(/\0/g, '')
      .trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = decompressed[off + 156];
    // typeflag '0' / 0x00 = regular file. '5' = directory. Skip non-regular.
    const isRegular = typeflag === 0x30 || typeflag === 0;
    // PAX extended header ('x'=0x78) and GNU LongLink ('L'=0x4c) carry
    // long names + extended metadata as pseudo-files preceding the real
    // entry. The 100-byte name field in those preceding USTAR headers is
    // truncated. Fail fast rather than silently hash files under the
    // truncated name + produce a corrupt SBOM.
    if (typeflag === 0x78 || typeflag === 0x4c) {
      throw new Error(
        `USTAR extended header (typeflag=0x${typeflag.toString(16)}) not supported; pack tarballs MUST keep entry names <= 100 bytes`
      );
    }
    if (isRegular && name && !name.endsWith('/')) {
      const data = decompressed.subarray(off + BLOCK, off + BLOCK + size);
      files.push({
        name,
        size,
        sha256: createHash('sha256').update(data).digest('hex'),
      });
    }
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return files;
}

// ─── per-version SBOM ───────────────────────────────────────────────

/**
 * Build a CycloneDX 1.6 SBOM for one pack version.
 *
 * Deterministic: no timestamps, no serialNumber. Re-running on the
 * same inputs produces byte-identical output. Consumers that want a
 * timestamp can read `metadata.component.externalReferences` to find
 * the distribution URL and check `Last-Modified` over HTTP.
 */
function buildSbom(packName, version, manifest, tarballPath) {
  const tarballBytes = readFileSync(tarballPath);
  const files = enumerateTarball(tarballBytes);

  const purl = `pkg:openwop/${encodeURIComponent(packName)}@${encodeURIComponent(version)}`;
  const tarballSha256 = createHash('sha256').update(tarballBytes).digest('hex');

  // pack.json may live INSIDE the tarball with fields not surfaced
  // on the registry manifest (e.g., peerDependencies). Read it.
  const packJsonEntry = files.find((f) => f.name === 'pack.json');
  let packJson = {};
  if (packJsonEntry) {
    // Re-extract to get the raw bytes (already hashed; re-walking the
    // tarball is fine for a CI gate that runs against ~20 packs).
    packJson = JSON.parse(extractFile(gunzipSync(tarballBytes), 'pack.json'));
  }

  const licenses = packJson.license
    ? [{ license: { id: packJson.license } }]
    : [];

  const externalReferences = [];
  if (packJson.homepage) {
    externalReferences.push({ type: 'website', url: packJson.homepage });
  }
  if (packJson.repository) {
    const repoUrl =
      typeof packJson.repository === 'string'
        ? packJson.repository
        : packJson.repository?.url;
    if (repoUrl) externalReferences.push({ type: 'vcs', url: repoUrl });
  }
  if (manifest.tarballUrl) {
    externalReferences.push({ type: 'distribution', url: manifest.tarballUrl });
  }
  if (manifest.signing?.publicKeyUrl) {
    externalReferences.push({
      type: 'other',
      comment: 'publisher signing key (Ed25519)',
      url: manifest.signing.publicKeyUrl,
    });
  }

  // peerDependencies translate to host capability surfaces. CycloneDX
  // `dependencies` accept any ref string — we use `host:<capability>`
  // so downstream tools can distinguish runtime host requirements from
  // pkg-style refs.
  const peerDeps = packJson.peerDependencies ?? {};
  const dependsOn = Object.keys(peerDeps).map((cap) => `host:${cap}`);

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      component: {
        'bom-ref': purl,
        type: 'library',
        name: packName,
        version,
        description: packJson.description,
        licenses,
        externalReferences,
        hashes: [{ alg: 'SHA-256', content: tarballSha256 }],
        purl,
      },
      tools: [
        {
          vendor: 'openwop',
          name: 'generate-sbom.mjs',
          version: '1',
        },
      ],
    },
    components: files.map((f) => ({
      type: 'file',
      name: f.name,
      hashes: [{ alg: 'SHA-256', content: f.sha256 }],
      properties: [{ name: 'openwop:size', value: String(f.size) }],
    })),
    dependencies: [
      {
        ref: purl,
        dependsOn,
      },
    ],
  };
}

/**
 * Re-walk a tarball looking for one specific file's raw bytes.
 * Mirrors registry/scripts/verify-signatures.mjs §extractPackJson —
 * kept inline here so this script has no internal imports.
 */
function extractFile(decompressed, targetName) {
  const BLOCK = 512;
  for (let off = 0; off + BLOCK <= decompressed.length; ) {
    const nameBuf = decompressed.subarray(off, off + 100);
    const nameEnd = nameBuf.indexOf(0);
    const rawName = nameBuf.subarray(0, nameEnd < 0 ? 100 : nameEnd).toString('utf8');
    if (rawName === '') break;
    const name = rawName.replace(/^\.\//, '');
    const sizeStr = decompressed
      .subarray(off + 124, off + 136)
      .toString('ascii')
      .replace(/\0/g, '')
      .trim();
    const size = parseInt(sizeStr, 8) || 0;
    if (name === targetName) {
      return decompressed.subarray(off + BLOCK, off + BLOCK + size).toString('utf8');
    }
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return '{}';
}

// ─── aggregate ─────────────────────────────────────────────────────

function buildAggregate(perVersionSboms) {
  // Per-version SBOMs are the source of truth; aggregate just lists
  // them. Sort by purl for determinism.
  const components = perVersionSboms
    .map(({ packName, version, sbomUrl, sbomSha256 }) => ({
      'bom-ref': `pkg:openwop/${encodeURIComponent(packName)}@${encodeURIComponent(version)}`,
      type: 'library',
      name: packName,
      version,
      externalReferences: [
        { type: 'bom', url: sbomUrl, hashes: [{ alg: 'SHA-256', content: sbomSha256 }] },
      ],
    }))
    .sort((a, b) => (a['bom-ref'] < b['bom-ref'] ? -1 : 1));

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      tools: [{ vendor: 'openwop', name: 'generate-sbom.mjs', version: '1' }],
      component: {
        type: 'platform',
        name: 'openwop-registry',
        description: 'Aggregate SBOM listing every published pack version.',
      },
    },
    components,
  };
}

// ─── disk i/o ──────────────────────────────────────────────────────

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Compare desired bytes to on-disk bytes. Returns `true` if write would
 * change the file. In --check mode this fails the gate; in write mode
 * the caller skips no-op writes (preserves mtime).
 */
function wouldChange(path, desiredBytes) {
  if (!existsSync(path)) return true;
  const current = readFileSync(path);
  if (current.length !== desiredBytes.length) return true;
  return !current.equals(desiredBytes);
}

function serialize(obj) {
  // Stable 2-space indent + trailing newline. Matches build-index.mjs
  // output so contributors can diff side-by-side without whitespace
  // noise.
  return Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// ─── main ──────────────────────────────────────────────────────────

function main() {
  if (!existsSync(PACKS_ROOT)) {
    warn('no registry/v1/packs/ directory; nothing to generate');
    process.exit(0);
  }

  const packs = readdirSync(PACKS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let generated = 0;
  let drift = 0;
  const perVersion = [];

  for (const pack of packs) {
    const versionsDir = join(PACKS_ROOT, pack, '-');
    if (!existsSync(versionsDir)) continue;
    const versions = readdirSync(versionsDir)
      .filter((f) => f.endsWith('.tgz'))
      .map((f) => f.slice(0, -4))
      .sort();

    for (const version of versions) {
      const manifestPath = join(versionsDir, `${version}.json`);
      const tarballPath = join(versionsDir, `${version}.tgz`);
      const sbomPath = join(versionsDir, `${version}.sbom.json`);

      if (!existsSync(manifestPath)) {
        warn(`${pack}@${version}: missing manifest, skipping`);
        continue;
      }
      if (!existsSync(tarballPath)) {
        warn(`${pack}@${version}: missing tarball, skipping`);
        continue;
      }

      const manifest = readJson(manifestPath);
      const sbom = buildSbom(pack, version, manifest, tarballPath);
      const sbomBytes = serialize(sbom);

      if (wouldChange(sbomPath, sbomBytes)) {
        if (CHECK_MODE) {
          fail(`${pack}@${version}: ${sbomPath} drifted (rerun generate-sbom.mjs)`);
          drift++;
        } else {
          writeFileSync(sbomPath, sbomBytes);
          generated++;
          ok(`${pack}@${version}: wrote sbom.json (${sbom.components.length} files)`);
        }
      } else {
        dim(`${pack}@${version}: sbom.json up-to-date`);
      }

      perVersion.push({
        packName: pack,
        version,
        sbomUrl: `/v1/packs/${pack}/-/${version}.sbom.json`,
        sbomSha256: createHash('sha256').update(sbomBytes).digest('hex'),
      });
    }
  }

  // Aggregate.
  const aggregate = buildAggregate(perVersion);
  const aggregateBytes = serialize(aggregate);
  if (wouldChange(AGGREGATE_PATH, aggregateBytes)) {
    if (CHECK_MODE) {
      fail(`${AGGREGATE_PATH} drifted (rerun generate-sbom.mjs)`);
      drift++;
    } else {
      writeFileSync(AGGREGATE_PATH, aggregateBytes);
      ok(`wrote aggregate sbom.json (${aggregate.components.length} pack versions)`);
    }
  } else {
    dim('aggregate sbom.json up-to-date');
  }

  console.log('');
  if (CHECK_MODE) {
    if (drift === 0) {
      ok(`${perVersion.length} pack SBOM(s) up-to-date`);
      process.exit(0);
    } else {
      fail(`${drift} file(s) drifted — rerun \`node registry/scripts/generate-sbom.mjs\``);
      process.exit(1);
    }
  } else {
    ok(`generated ${generated} SBOM(s), ${perVersion.length} pack version(s) covered`);
  }
}

main();
