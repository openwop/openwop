/**
 * Node-pack resolver — wires the executor's NodeRegistry async miss
 * path to the pack-registry storage so packs registered after boot
 * can be loaded transparently.
 *
 * Sample-grade: scans `./packs/*.json` at boot for any pack manifests,
 * verifies SRI + Ed25519 signature where present, and registers their
 * node modules. Real deployers point at a real pack registry (the
 * postgres host's `pack-consumer.ts` is the reference).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setNodePackResolver } from '../executor/nodeRegistry.js';
import { loadPackFromManifest } from '../packs/tarballLoader.js';
import { createLogger } from '../observability/logger.js';
import type { Storage } from '../storage/storage.js';

const log = createLogger('bootstrap.nodePackResolver');
const PACK_DIR = process.env.OPENWOP_PACK_DIR ?? resolve('./packs');

export function ensureNodePackResolverInstalled(_storage: Storage): void {
  setNodePackResolver(async (typeId) => {
    if (!existsSync(PACK_DIR)) return null;
    for (const entry of readdirSync(PACK_DIR)) {
      const manifestPath = join(PACK_DIR, entry, 'pack.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (Array.isArray(manifest.nodes)) {
          const match = manifest.nodes.find((n: any) => n.typeId === typeId);
          if (match) {
            return await loadPackFromManifest(join(PACK_DIR, entry));
          }
        }
      } catch (err) {
        log.warn('failed to scan pack manifest', {
          path: manifestPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  });
}
