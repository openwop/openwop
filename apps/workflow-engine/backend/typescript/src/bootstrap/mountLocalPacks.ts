/**
 * Dev-mode: mount unsigned local pack directories from the openwop
 * repo's `packs/` tree into the same `OPENWOP_PACK_DIR` that registry-
 * installed packs use.
 *
 * Why: the workflow-engine sample is the example builder. We want its
 * palette to surface every `core.openwop.*` pack in the repo, even the
 * ones not yet published to packs.openwop.dev. The catalog route
 * (`routes/nodeCatalog.ts`) and resolver (`bootstrap/nodePackResolver`)
 * already scan that dir, so once a pack appears there it shows up in
 * the palette automatically.
 *
 * Trust model: this is DEV ONLY. We only mount packs that are NOT
 * already present at the destination — registry-installed (signed,
 * trust-marked) packs always win. The mount is a symlink so editing
 * pack source in the repo is reflected without a re-run.
 *
 * Opt-out: `OPENWOP_MOUNT_LOCAL_PACKS=false`.
 * Override path: `OPENWOP_LOCAL_PACKS_DIR=<abs-path-to-packs-dir>`.
 * Strict registry mode: `OPENWOP_STRICT_REGISTRY=true` — disables the
 *   "newer local version shadows older registry install" behavior. Use
 *   for prod-like runs where only signed registry packs may execute.
 *
 * Future phase: when all core packs are published with proper Ed25519
 * signing, drop this mount in favor of `DEFAULT_PACKS` in
 * installRegistryPacks.ts. See ARCHITECTURE.md §"Path to real packs".
 */

import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../observability/logger.js';
import { resolveDefaultPackDir } from '../packs/registryInstaller.js';

const log = createLogger('bootstrap.mountLocalPacks');

// Pack-name prefixes the dev mount surfaces from the workspace `packs/` tree.
// `core.openwop.*` are the protocol's own packs; `vendor.myndhyve.*` are the
// reference vendor packs whose host surfaces the sample host implements
// (host.kanban/chat/canvas/knowledge/launchStudio/webResearch) — mounting them
// makes those nodes available in the builder so the wired surfaces are runnable.
const LOCAL_PACK_PREFIXES = ['core.openwop.', 'vendor.myndhyve.'] as const;

export interface MountResult {
  /** Directories mounted on this run (excludes pre-existing). */
  mounted: string[];
  /** Directories already present at the destination (registry-installed or previously mounted). */
  skipped: string[];
  /** Registry-installed dirs we shadowed with a newer local version
   *  (when not in OPENWOP_STRICT_REGISTRY=true mode). The old dir is
   *  renamed to `<name>.registry-<version>` so it's recoverable. */
  shadowed: string[];
  /** Whether mounting was disabled via env. */
  disabled: boolean;
}

export function ensureLocalPacksMounted(): MountResult {
  if (process.env.OPENWOP_MOUNT_LOCAL_PACKS === 'false') {
    log.info('local pack mount disabled (OPENWOP_MOUNT_LOCAL_PACKS=false)');
    return { mounted: [], skipped: [], shadowed: [], disabled: true };
  }
  // Example builder defaults to dev-friendly behavior: a newer local
  // pack shadows an older registry install so the palette shows every
  // node in the repo. Set OPENWOP_STRICT_REGISTRY=true for prod-style
  // behavior where only registry-installed (signed) packs are honored.
  const preferLocal = process.env.OPENWOP_STRICT_REGISTRY !== 'true';

  const localDir = resolveLocalPacksDir();
  if (!localDir || !existsSync(localDir)) {
    log.info('no local packs dir to mount', { searched: localDir ?? '<not-found>' });
    return { mounted: [], skipped: [], shadowed: [], disabled: false };
  }

  const destDir = resolveDefaultPackDir();
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const mounted: string[] = [];
  const skipped: string[] = [];
  const shadowed: string[] = [];

  for (const entry of readdirSync(localDir)) {
    if (!shouldMount(entry)) continue;
    const src = join(localDir, entry);
    if (!statSync(src).isDirectory()) continue;
    if (!existsSync(join(src, 'pack.json'))) continue;

    const dest = join(destDir, entry);
    if (existsSync(dest)) {
      // Idempotent: if a previous boot already shadowed this pack, the
      // dest is now a symlink into the repo. Nothing to do.
      if (isSymlinkToRepo(dest, src)) {
        skipped.push(entry);
        continue;
      }
      if (preferLocal && shouldShadow(src, dest)) {
        const installedVer = readManifestVersion(dest) ?? 'unknown';
        const newName = `${entry}.registry-${installedVer}`;
        const newPath = join(destDir, newName);
        try {
          // A previous shadow pass may have already preserved this same
          // registry version. If so, just discard the freshly-installed
          // dir rather than failing on rename collision.
          if (existsSync(newPath)) {
            rmSync(dest, { recursive: true, force: true });
          } else {
            renameSync(dest, newPath);
          }
          symlinkSync(src, dest, 'dir');
          shadowed.push(entry);
          log.warn('local pack shadows registry install (dev mode; set OPENWOP_STRICT_REGISTRY=true to disable)', {
            pack: entry,
            registryVersion: installedVer,
            localVersion: readManifestVersion(src),
            preservedAs: newName,
          });
          continue;
        } catch (err) {
          log.warn('failed to shadow registry pack with local', {
            pack: entry,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // Don't clobber registry installs or a prior mount. Registry-
      // installed packs carry `.openwop-installed.json`; mounted packs
      // are symlinks — either way, leave them alone unless dev-mode
      // shadowing kicked in above.
      skipped.push(entry);
      continue;
    }
    try {
      symlinkSync(src, dest, 'dir');
      mounted.push(entry);
    } catch (err) {
      log.warn('local pack mount failed', {
        pack: entry,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info('local packs mounted', {
    mounted: mounted.length,
    skipped: skipped.length,
    shadowed: shadowed.length,
    preferLocal,
    sourceDir: localDir,
    destDir,
  });
  return { mounted, skipped, shadowed, disabled: false };
}

function isSymlinkToRepo(dest: string, expectedTarget: string): boolean {
  try {
    if (!lstatSync(dest).isSymbolicLink()) return false;
    const target = readlinkSync(dest);
    return target === expectedTarget;
  } catch {
    return false;
  }
}

function shouldShadow(srcDir: string, destDir: string): boolean {
  const local = readManifestVersion(srcDir);
  const installed = readManifestVersion(destDir);
  if (!local || !installed) return false;
  return compareSemver(local, installed) > 0;
}

function readManifestVersion(packDir: string): string | null {
  try {
    const raw = readFileSync(join(packDir, 'pack.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Returns >0 if a > b, <0 if a < b, 0 if equal. Pre-release / build
 *  metadata is ignored — sample-grade semver compare only. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n.split('-')[0]) || 0);
  const pb = b.split('.').map((n) => Number(n.split('-')[0]) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function shouldMount(name: string): boolean {
  return LOCAL_PACK_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Resolve `<repo>/packs/`. Preference order:
 *   1. OPENWOP_LOCAL_PACKS_DIR (absolute path).
 *   2. Walk up from this module's directory looking for `packs/`
 *      adjacent to a workspace marker (`package.json` with name
 *      `openwop` or a `spec/v1` dir).
 */
function resolveLocalPacksDir(): string | null {
  const override = process.env.OPENWOP_LOCAL_PACKS_DIR;
  if (override) return resolve(override);

  // Start from this file's location so we work regardless of cwd.
  const here = dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let i = 0; i < 10; i++) {
    const candidate = join(cur, 'packs', 'core.openwop.ai', 'pack.json');
    if (existsSync(candidate)) return join(cur, 'packs');
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
