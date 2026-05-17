/**
 * Boot-time pack installer for the workflow-engine sample.
 *
 * Default: installs `core.openwop.ai@1.0.0` and `core.openwop.http@1.0.0`
 * from packs.openwop.dev so the builder palette has real registry nodes
 * (in addition to the locally-defined sample nodes).
 *
 * Overrides:
 *   OPENWOP_INSTALL_PACKS=core.openwop.ai@1.0.0,core.openwop.http@1.0.0
 *   OPENWOP_REGISTRY_URL=https://packs.openwop.dev
 *   OPENWOP_PACK_DIR=./packs
 *
 * Set OPENWOP_INSTALL_PACKS=none to disable. Install failures are
 * logged but never block startup — the sample falls back to its
 * locally-registered nodes when the registry is unreachable.
 */

import { resolve } from 'node:path';
import { createLogger } from '../observability/logger.js';
import {
  installPackFromRegistry,
  parseInstallList,
  resolveDefaultPackDir,
  type InstallTarget,
} from '../packs/registryInstaller.js';

const log = createLogger('bootstrap.installRegistryPacks');

const DEFAULT_PACKS: InstallTarget[] = [
  { name: 'core.openwop.ai', version: '1.0.0' },
  { name: 'core.openwop.http', version: '1.0.0' },
];

export async function ensureRegistryPacksInstalled(): Promise<void> {
  const raw = process.env.OPENWOP_INSTALL_PACKS;
  if (raw === 'none') {
    log.info('registry pack install disabled (OPENWOP_INSTALL_PACKS=none)');
    return;
  }
  const targets = raw ? parseInstallList(raw) : DEFAULT_PACKS;
  if (targets.length === 0) return;

  const packDir = resolveDefaultPackDir();
  const registry = process.env.OPENWOP_REGISTRY_URL;
  const trustedKeysDir = resolve('../../../registry/keys');

  // Install in parallel — each pack is independent, and serial waits
  // burn boot latency proportional to the slowest network round-trip.
  // Promise.allSettled so one failed install never poisons the others.
  await Promise.allSettled(
    targets.map(async (target) => {
      try {
        const result = await installPackFromRegistry(target, {
          packDir,
          registry,
          trustedKeysDir,
        });
        if (result.installed) {
          log.info('registry pack ready', { name: target.name, version: target.version });
        } else {
          log.info('registry pack already installed', { name: target.name, version: target.version });
        }
      } catch (err) {
        log.warn('registry pack install failed; continuing without it', {
          name: target.name,
          version: target.version,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}
