/**
 * Registry-side pack installer for packs.openwop.dev (or any registry
 * following the same shape per `spec/v1/node-pack-registry.md`).
 *
 * For each {name, version}:
 *   1. Fetch the version manifest, tarball, and signature.
 *   2. Resolve the signing public key (registry/keys/<keyId>.pub on disk,
 *      then HTTPS /keys/<keyId>.pub as a fallback).
 *   3. Verify the tarball's SHA-256 SRI integrity AND Ed25519 signature.
 *   4. Extract to ./packs/<name>/ (any pre-existing dir is replaced).
 *   5. Drop a `.openwop-installed.json` trust marker so the runtime
 *      pack loader knows the manifest was verified at install-time
 *      and doesn't need to re-check the manifest signature.
 *
 * The installer is sample-grade: shells out to /usr/bin/tar (bsdtar/
 * GNU tar both work). Real hosts use a vetted tar library + extract
 * into a sandboxed dir. The verification logic is the same.
 */

import { createHash, createPublicKey, verify as verifySig } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createLogger } from '../observability/logger.js';

const log = createLogger('packs.registryInstaller');

const DEFAULT_REGISTRY = 'https://packs.openwop.dev';
const MARKER = '.openwop-installed.json';

export interface InstallTarget {
  name: string;
  version: string;
}

export interface InstallOptions {
  packDir: string;
  registry?: string;
  /** Local fallback directory for signing keys (registry/keys/). */
  trustedKeysDir?: string;
}

interface PackVersionManifest {
  name: string;
  version: string;
  signing?: {
    method: string;
    publicKeyRef: string;
    signatureRef?: string;
  };
  integrity: string;
}

interface InstallMarker {
  name: string;
  version: string;
  integrity: string;
  publicKeyRef: string;
  registry: string;
  installedAt: string;
  /** SHA-256 hex digest of each load-bearing file in the install
   *  dir. Re-verified by `verifyInstalledPack()` on every load. */
  contentHashes: Record<string, string>;
}

/** Files copied from a verified install. Anything outside this set
 *  (READMEs, LICENSEs, CHANGELOGs) is skipped to keep the install dir
 *  free of files that aren't load-bearing. */
const ALLOWED_FILES = new Set(['pack.json', 'index.mjs']);
// `prompts` added for RFC 0070 / RFC 0003 §C: agent manifests carry
// `systemPromptRef` (e.g. `prompts/supervisor.md`) which the AgentRegistry
// loader resolves from the installed pack dir at load time.
const ALLOWED_SUBDIRS = new Set(['schemas', 'keys', 'prompts']);

export async function installPackFromRegistry(
  target: InstallTarget,
  opts: InstallOptions,
): Promise<{ installed: boolean; reason?: string }> {
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const destDir = join(opts.packDir, target.name);

  // Idempotent: skip if already installed at the requested version.
  if (existsSync(join(destDir, MARKER))) {
    try {
      const marker = JSON.parse(readFileSync(join(destDir, MARKER), 'utf-8')) as InstallMarker;
      if (marker.version === target.version) {
        return { installed: false, reason: 'already_installed' };
      }
    } catch {
      /* fall through to reinstall */
    }
  }

  // 1. Fetch the version manifest.
  const manifestUrl = `${registry}/v1/packs/${target.name}/-/${target.version}.json`;
  const manifestRes = await fetch(manifestUrl);
  if (!manifestRes.ok) {
    throw new Error(`manifest_fetch_failed (${manifestRes.status}): ${manifestUrl}`);
  }
  const manifest = (await manifestRes.json()) as PackVersionManifest;
  if (manifest.name !== target.name || manifest.version !== target.version) {
    throw new Error(
      `manifest_identity_mismatch: requested ${target.name}@${target.version}, got ${manifest.name}@${manifest.version}`,
    );
  }

  // 2. Fetch the tarball.
  const tarballUrl = `${registry}/v1/packs/${target.name}/-/${target.version}.tgz`;
  const tarballRes = await fetch(tarballUrl);
  if (!tarballRes.ok) {
    throw new Error(`tarball_fetch_failed (${tarballRes.status}): ${tarballUrl}`);
  }
  const tarballBytes = Buffer.from(await tarballRes.arrayBuffer());

  // 3. SHA-256 SRI integrity over the tarball.
  const [algo, expectedB64] = manifest.integrity.split('-');
  if (algo !== 'sha256') {
    throw new Error(`unsupported_integrity_algorithm: ${algo}`);
  }
  const computedB64 = createHash('sha256').update(tarballBytes).digest('base64');
  if (computedB64 !== expectedB64) {
    throw new Error(`pack_integrity_mismatch: expected ${expectedB64}, got ${computedB64}`);
  }

  // 4. Resolve public key. Try the on-disk registry/keys/ first
  // (faster + works offline), then fall back to the registry's
  // /keys/<keyId>.pub endpoint.
  const keyRef = manifest.signing?.publicKeyRef;
  if (!keyRef) {
    throw new Error('pack_signature_unverifiable: no signing.publicKeyRef in manifest');
  }
  const publicKeyPem = await resolvePublicKey(keyRef, registry, opts.trustedKeysDir);

  // 5. Fetch the signature and verify Ed25519 against the pack.json
  // bytes inside the tarball. Canonical recipe per
  // registry/scripts/verify-signatures.mjs — the signature is over the
  // raw pack.json file (not the whole tarball), so we gunzip + USTAR-
  // parse to find pack.json before verifying.
  const sigUrl = `${registry}/v1/packs/${target.name}/-/${target.version}.sig`;
  const sigRes = await fetch(sigUrl);
  if (!sigRes.ok) {
    throw new Error(`signature_fetch_failed (${sigRes.status}): ${sigUrl}`);
  }
  const sigBytes = Buffer.from(await sigRes.arrayBuffer());
  const packJsonBytes = extractPackJsonFromTarball(tarballBytes);
  const verified = verifySig(null, packJsonBytes, createPublicKey(publicKeyPem), sigBytes);
  if (!verified) {
    throw new Error('pack_signature_invalid');
  }

  // 6. Extract. Stage into a temp dir to detect any wrapper directory
  // (e.g., npm-style `package/`). Then copy only the load-bearing
  // files (pack.json, index.mjs, schemas/, keys/) to destDir —
  // skipping READMEs and LICENSEs whose relative `../../spec/v1/*.md`
  // links pollute spec-corpus link-walks if the install dir ends up
  // anywhere under the openwop repo.
  const stageDir = join(tmpdir(), `openwop-install-${target.name.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}`);
  mkdirSync(stageDir, { recursive: true });
  const tarballPath = join(stageDir, 'pack.tgz');
  // Computed during the install path; persisted in the marker so the
  // runtime loader can re-verify on each load.
  let packJsonSha = '';
  let indexMjsSha: string | undefined;
  try {
    writeFileSync(tarballPath, tarballBytes);
    const r = spawnSync('tar', ['-xzf', tarballPath, '-C', stageDir], { encoding: 'utf-8' });
    if (r.status !== 0) {
      throw new Error(`tar_extract_failed: ${r.stderr ?? ''}`);
    }
    // Delete the tarball immediately so findPackRoot doesn't have to
    // skip it by name, and so the install dir stays clean if the
    // tarball had no wrapper directory.
    rmSync(tarballPath, { force: true });
    const packRoot = findPackRoot(stageDir);
    if (!packRoot) {
      throw new Error('extracted_archive_missing_pack_json');
    }
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true, force: true });
    }
    mkdirSync(destDir, { recursive: true });
    copyAllowlistedFiles(packRoot, destDir);
    packJsonSha = createHash('sha256').update(readFileSync(join(destDir, 'pack.json'))).digest('hex');
    const indexPath = join(destDir, 'index.mjs');
    if (existsSync(indexPath)) {
      indexMjsSha = createHash('sha256').update(readFileSync(indexPath)).digest('hex');
    }
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }

  // 7. Drop the trust marker. SHA-256 of pack.json + index.mjs lets
  // the loader re-verify the install on every boot — without this,
  // anyone with write access to the install dir could replace the
  // code post-install and bypass the install-time signature check.
  const marker: InstallMarker = {
    name: manifest.name,
    version: manifest.version,
    integrity: manifest.integrity,
    publicKeyRef: keyRef,
    registry,
    installedAt: new Date().toISOString(),
    contentHashes: {
      'pack.json': packJsonSha,
      ...(indexMjsSha ? { 'index.mjs': indexMjsSha } : {}),
    },
  };
  writeFileSync(join(destDir, MARKER), JSON.stringify(marker, null, 2));

  log.info('pack installed and verified', {
    name: manifest.name,
    version: manifest.version,
    integrity: manifest.integrity,
    keyRef,
  });
  return { installed: true };
}

async function resolvePublicKey(
  keyRef: string,
  registry: string,
  trustedKeysDir?: string,
): Promise<string> {
  if (trustedKeysDir) {
    const localPath = join(trustedKeysDir, `${keyRef}.pub`);
    if (existsSync(localPath)) {
      return readFileSync(localPath, 'utf-8');
    }
  }
  const keyUrl = `${registry}/keys/${keyRef}.pub`;
  const keyRes = await fetch(keyUrl);
  if (!keyRes.ok) {
    throw new Error(`public_key_fetch_failed (${keyRes.status}): ${keyUrl}`);
  }
  return keyRes.text();
}

/**
 * Extract pack.json from a gzipped USTAR tarball. Returns the raw bytes
 * the publisher signed (parse-and-re-serialize would normalize JSON
 * whitespace and break the signature).
 *
 * Ported from registry/scripts/verify-signatures.mjs's extractPackJson.
 * Pack tarballs MUST keep entry names <= 100 bytes — PAX extended
 * headers and GNU LongLink throw rather than risk silent mis-identification.
 */
function extractPackJsonFromTarball(tarballBytes: Buffer): Buffer {
  const decompressed = gunzipSync(tarballBytes);
  const BLOCK = 512;
  for (let off = 0; off + BLOCK <= decompressed.length; ) {
    const nameBuf = decompressed.subarray(off, off + 100);
    const nameEnd = nameBuf.indexOf(0);
    const name = nameBuf.subarray(0, nameEnd < 0 ? 100 : nameEnd).toString('utf8');
    if (!name) break;
    const sizeStr = decompressed
      .subarray(off + 124, off + 136)
      .toString('ascii')
      .replace(/\0/g, '')
      .trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = decompressed[off + 156];
    if (typeflag === 0x78 || typeflag === 0x4c) {
      throw new Error(
        `tarball uses extended USTAR header (typeflag=0x${typeflag.toString(16)}); not supported`,
      );
    }
    if (name === 'pack.json' || name === './pack.json') {
      return Buffer.from(decompressed.subarray(off + BLOCK, off + BLOCK + size));
    }
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error('pack.json not found in tarball');
}

function findPackRoot(stageDir: string): string | null {
  // Direct hit: tarball extracts files at the top level (rare).
  if (existsSync(join(stageDir, 'pack.json'))) return stageDir;

  // Common: single wrapper directory (npm `package/`, or `<name>-<version>/`).
  const entries = readdirSync(stageDir).filter((e) => {
    const full = join(stageDir, e);
    return statSync(full).isDirectory();
  });
  for (const e of entries) {
    if (existsSync(join(stageDir, e, 'pack.json'))) {
      return join(stageDir, e);
    }
  }
  return null;
}

/**
 * Copy only ALLOWED_FILES + ALLOWED_SUBDIRS from `from` to `to`. Skips
 * READMEs, LICENSEs, CHANGELOGs, and anything else the pack ships that
 * isn't needed at runtime. The `keys/` subdir is preserved because
 * legacy on-disk packs use it for the manifest-signature path even
 * though registry-installed packs don't.
 */
function copyAllowlistedFiles(from: string, to: string): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isFile() && ALLOWED_FILES.has(entry.name)) {
      writeFileSync(join(to, entry.name), readFileSync(join(from, entry.name)));
      continue;
    }
    if (entry.isDirectory() && ALLOWED_SUBDIRS.has(entry.name)) {
      const subFrom = join(from, entry.name);
      const subTo = join(to, entry.name);
      mkdirSync(subTo, { recursive: true });
      const r = spawnSync('cp', ['-R', `${subFrom}/.`, subTo], { encoding: 'utf-8' });
      if (r.status !== 0) {
        throw new Error(`copy_subdir_failed: ${entry.name}: ${r.stderr ?? ''}`);
      }
    }
  }
}

/**
 * Returns true when the pack dir holds a verified install marker.
 * Consumed by the runtime loader to skip the legacy manifest-sig path.
 */
export function isInstalledPack(packDir: string): boolean {
  return existsSync(join(packDir, MARKER));
}

/**
 * Re-verify a registry-installed pack against its trust marker. The
 * loader calls this on every load — without it, anyone with write
 * access to the install dir could swap `index.mjs` post-install and
 * bypass the install-time signature check.
 *
 * Returns null on success, or a string reason on failure.
 */
export function verifyInstalledPack(packDir: string): string | null {
  const markerPath = join(packDir, MARKER);
  if (!existsSync(markerPath)) return 'marker_missing';
  let marker: InstallMarker;
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf-8')) as InstallMarker;
  } catch {
    return 'marker_invalid_json';
  }
  if (!marker.contentHashes || typeof marker.contentHashes !== 'object') {
    return 'marker_missing_content_hashes';
  }
  for (const [relPath, expectedSha] of Object.entries(marker.contentHashes)) {
    const filePath = join(packDir, relPath);
    if (!existsSync(filePath)) return `content_missing:${relPath}`;
    const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
    if (actual !== expectedSha) return `content_modified:${relPath}`;
  }
  return null;
}

/** Parse `name@version` pairs from `OPENWOP_INSTALL_PACKS`. */
export function parseInstallList(raw: string | undefined): InstallTarget[] {
  if (!raw) return [];
  const out: InstallTarget[] = [];
  for (const entry of raw.split(',')) {
    const [name, version] = entry.trim().split('@');
    if (!name || !version) continue;
    out.push({ name, version });
  }
  return out;
}

export function resolveDefaultPackDir(): string {
  // Default outside the repo working tree. Installed packs ship with
  // their own READMEs whose relative `../../spec/v1/*.md` links don't
  // resolve when extracted into a deep subdir of the repo — the
  // openwop spec-corpus link-check walks every .md under the repo
  // and flags those as broken. Caching under $HOME side-steps the
  // problem and is also more durable across `git clean`.
  return process.env.OPENWOP_PACK_DIR ?? join(homedir(), '.openwop-packs');
}
