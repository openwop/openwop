/**
 * Agent-pack registry browser — sample-extension surface backing
 * the Agents-tab "Install from registry" flow (phase E3, 2026-05-28).
 *
 * Endpoints:
 *   GET  /v1/host/sample/registry/agent-packs
 *     → list known agent packs + whether each is currently installed
 *       in this host's AgentRegistry (i.e. any of its agents are
 *       registered).
 *   POST /v1/host/sample/registry/agent-packs/install
 *     → body: { name, version? } — fetch + verify + register via the
 *       existing `installPackFromRegistry` machinery. No-ops cleanly
 *       when the pack is already installed.
 *
 * "Known" comes from scanning the local packs/ directory for entries
 * matching `core.openwop.agents.*`. A future iteration could query the
 * public registry catalog directly, but the local scan covers the
 * sample's typical case and avoids tying this surface to a registry
 * fetch on every page load.
 */

import type { Express } from 'express';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenwopError } from '../types.js';
import { getAgentRegistry } from '../executor/agentRegistry.js';
import { installPackFromRegistry, resolveDefaultPackDir } from '../packs/registryInstaller.js';
import { createLogger } from '../observability/logger.js';

const log = createLogger('routes.agentPackRegistry');

interface AgentPackSummary {
  /** Pack name, e.g. `core.openwop.agents.code-reviewer`. */
  name: string;
  /** Pack version pinned in this host's local mirror, e.g. `1.0.0`. */
  version: string;
  /** From `pack.json` `description`. */
  description?: string;
  /** Personas the pack ships (extracted from `agents[]`). Drives the
   *  card body so users can see what they'd be installing without
   *  navigating into the registry. */
  personas: string[];
  /** True when at least one of the pack's agents is currently
   *  registered in the in-process `AgentRegistry`. */
  installed: boolean;
}

export function registerAgentPackRegistryRoutes(app: Express): void {
  app.get('/v1/host/sample/registry/agent-packs', (_req, res, next) => {
    try {
      const packs = scanLocalAgentPacks();
      res.json({ packs, total: packs.length });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/registry/agent-packs/install', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { name?: unknown; version?: unknown };
      if (typeof body.name !== 'string' || body.name.length === 0) {
        throw new OpenwopError('validation_error', '`name` is required.', 400);
      }
      if (!body.name.startsWith('core.openwop.agents.')) {
        throw new OpenwopError(
          'validation_error',
          'This route installs `core.openwop.agents.*` packs only. Use the regular pack-install surface for other namespaces.',
          400,
        );
      }
      const version = typeof body.version === 'string' && body.version.length > 0
        ? body.version
        : '1.0.0';
      const packDir = resolveDefaultPackDir();
      const registry = process.env.OPENWOP_REGISTRY_URL;
      const trustedKeysDir = resolve('../../../registry/keys');
      const result = await installPackFromRegistry(
        { name: body.name, version },
        { packDir, registry, trustedKeysDir },
      );
      log.info('agent_pack_install_completed', {
        name: body.name,
        version,
        installed: result.installed,
      });
      res.status(200).json({
        name: body.name,
        version,
        installed: result.installed,
        alreadyInstalled: !result.installed,
      });
    } catch (err) {
      next(err);
    }
  });
}

/** Scan the host's local packs directory for `core.openwop.agents.*`
 *  entries. Returns one summary per pack; installation status comes
 *  from the in-process AgentRegistry. */
function scanLocalAgentPacks(): AgentPackSummary[] {
  const packDir = resolveDefaultPackDir();
  let entries: string[] = [];
  try {
    // Accept both real directories AND symlinks pointing at one.
    // `mountLocalPacks.ts` installs every `core.openwop.*` pack as a
    // symlink into the runtime pack dir, and `Dirent.isDirectory()`
    // returns `false` for symlinks even when their target IS a
    // directory — so a `d.isDirectory()`-only filter silently drops
    // every mounted pack. The agents-tab "Install from registry" page
    // was rendering empty for that reason on the Cloud Run revision
    // even after the packs/ COPY landed.
    entries = readdirSync(packDir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && d.name.startsWith('core.openwop.agents.'))
      .map((d) => d.name);
  } catch {
    // No packs dir on disk — return empty rather than 500. The UI
    // surfaces this as "no packs available locally" and points users
    // at the public registry.
    return [];
  }
  const registryAgents = getAgentRegistry().list();
  const out: AgentPackSummary[] = [];
  for (const dir of entries) {
    const packJsonPath = join(packDir, dir, 'pack.json');
    try {
      const raw = readFileSync(packJsonPath, 'utf-8');
      const pack = JSON.parse(raw) as {
        name?: string;
        version?: string;
        description?: string;
        agents?: Array<{ persona?: string; label?: string }>;
      };
      if (!pack.name || !pack.version) continue;
      const personas = (pack.agents ?? [])
        .map((a) => a.label ?? a.persona ?? '')
        .filter((p): p is string => p.length > 0);
      const installed = registryAgents.some((ra) =>
        ra.packName === pack.name && ra.packVersion === pack.version,
      );
      out.push({
        name: pack.name,
        version: pack.version,
        description: pack.description,
        personas,
        installed,
      });
    } catch {
      // Skip malformed pack.json — surfaces as "missing" rather than
      // failing the whole list.
    }
  }
  // Stable order: installed last, then alphabetical. Puts the "needs
  // attention" rows at the top of the page.
  return out.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}
