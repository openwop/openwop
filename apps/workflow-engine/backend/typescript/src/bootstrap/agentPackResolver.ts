/**
 * Agent-pack resolver — the manifest-agent parallel to `nodePackResolver.ts`
 * (RFC 0070). Scans the pack dir for `agents[]` arrays and loads them into
 * the AgentRegistry.
 *
 * Unlike nodes (lazily resolved when a workflow references a typeId), an
 * agent-only pack (`nodes: []`) has no node typeId to trigger a lazy load,
 * so we ALSO eager-load every local pack's agents at bootstrap. The lazy
 * resolver remains wired for packs installed after boot (hot-reload, RFC
 * 0003 §ImplNotes).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setAgentPackResolver } from '../executor/agentRegistry.js';
import { loadAgentsFromManifest } from '../packs/agentLoader.js';
import { resolveDefaultPackDir } from '../packs/registryInstaller.js';
import { createLogger } from '../observability/logger.js';
import type { Storage } from '../storage/storage.js';

const log = createLogger('bootstrap.agentPackResolver');
const PACK_DIR = resolveDefaultPackDir();

/** Eager-load every local pack's `agents[]` into the AgentRegistry. */
export function loadAllLocalAgents(): number {
  if (!existsSync(PACK_DIR)) return 0;
  let total = 0;
  for (const entry of readdirSync(PACK_DIR)) {
    const manifestPath = join(PACK_DIR, entry, 'pack.json');
    if (!existsSync(manifestPath)) continue;
    try {
      total += loadAgentsFromManifest(join(PACK_DIR, entry)).length;
    } catch (err) {
      log.warn('failed to load agents from pack', {
        path: manifestPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (total > 0) log.info('eager-loaded manifest agents at bootstrap', { count: total });
  return total;
}

export function ensureAgentPackResolverInstalled(_storage: Storage): void {
  // Lazy resolver — handles packs installed after boot.
  setAgentPackResolver(async (agentId) => {
    if (!existsSync(PACK_DIR)) return null;
    for (const entry of readdirSync(PACK_DIR)) {
      const manifestPath = join(PACK_DIR, entry, 'pack.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (Array.isArray(manifest.agents) && manifest.agents.some((a: { agentId?: string }) => a.agentId === agentId)) {
          loadAgentsFromManifest(join(PACK_DIR, entry));
          return null; // registry re-read by the caller (getAgentRegistry().resolve)
        }
      } catch (err) {
        log.warn('failed to scan pack manifest for agent', {
          path: manifestPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  });
  // Eager pass so agent-only packs + the inventory route are populated now.
  loadAllLocalAgents();
}
