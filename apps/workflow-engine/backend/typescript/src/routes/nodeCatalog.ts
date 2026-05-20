/**
 * Vendor-prefixed node-catalog endpoint used by the builder palette.
 *
 *   GET /v1/host/sample/node-catalog
 *
 * Returns every resolvable node typeId on this host: the locally-
 * registered sample modules + any node declared in a pack manifest
 * under OPENWOP_PACK_DIR. The builder UI uses this to render the
 * palette dynamically so registry-installed packs show up alongside
 * the hardcoded sample nodes.
 *
 * The endpoint returns metadata only — no executable code is sent.
 * Schema refs (configSchema/inputSchema/outputSchema) are read from
 * pack.json and inlined when small (<8kb each) so the inspector can
 * render a config form without a second round-trip.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Express } from 'express';
import { OpenwopError } from '../types.js';
import { getNodeRegistry } from '../executor/nodeRegistry.js';
import { resolveDefaultPackDir } from '../packs/registryInstaller.js';
import { requiredHostSurfacesFor } from '../bootstrap/hostSurfaceMap.js';
import { listHostSurfaces } from '../bootstrap/hostSurfaceRegistry.js';

const MAX_SCHEMA_INLINE_BYTES = 8 * 1024;

interface CatalogNode {
  typeId: string;
  version: string;
  label: string;
  description: string;
  category: string;
  role?: string;
  capabilities?: readonly string[];
  /** Source: 'local' for in-process modules, 'pack' for registry packs. */
  source: 'local' | 'pack';
  /** Pack name when source='pack'. */
  packName?: string;
  configSchema?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  /** Host surfaces this node needs to execute on the host (e.g.,
   *  `host.kvStorage`). Derived from hostSurfaceMap.ts. Empty array
   *  means "no host surface required" (pure data / control nodes). */
  requiresHostSurfaces: string[];
  /** Subset of `requiresHostSurfaces` that THIS host does NOT advertise.
   *  Empty array means the node is runnable here. Populated server-side
   *  so the client doesn't have to cross-reference advertisement. */
  missingHostSurfaces: string[];
  /** RFC 0031 §B — model-capability identifiers this NodeModule depends
   *  on. Empty / absent for nodes that don't dispatch to an LLM (the
   *  field is OPTIONAL; SHOULD-tier for `core.ai.*` nodes per the same
   *  RFC's authoring guidance). */
  requiredModelCapabilities?: string[];
  /** RFC 0031 §B — host-substitution coordinates the host MAY use when
   *  the active model can't satisfy `requiredModelCapabilities`. Pack
   *  authors who omit this opt into refusal-only posture. */
  fallbackModel?: { provider: string; model: string };
}

interface PackManifestNode {
  typeId: string;
  version: string;
  label?: string;
  description?: string;
  category?: string;
  role?: string;
  capabilities?: string[];
  /** RFC 0031 §B — see CatalogNode. */
  requiredModelCapabilities?: string[];
  fallbackModel?: { provider: string; model: string };
  configSchemaRef?: string;
  inputSchemaRef?: string;
  outputSchemaRef?: string;
}

interface PackManifest {
  name: string;
  version: string;
  nodes?: PackManifestNode[];
}

export function registerNodeCatalogRoute(app: Express): void {
  app.get('/v1/host/sample/node-catalog', (_req, res, next) => {
    try {
      const supported = new Set(
        listHostSurfaces().filter((s) => s.supported).map((s) => s.name),
      );

      const nodes: CatalogNode[] = [];

      // 1. Locally-registered modules from the in-process NodeRegistry.
      //    These have no metadata beyond typeId/version, so the
      //    frontend's static catalog supplies labels/categories for them.
      const registry = getNodeRegistry();
      for (const typeId of registry.listTypeIds()) {
        const mod = registry.get(typeId);
        if (!mod) continue;
        const required = requiredHostSurfacesFor(typeId);
        nodes.push({
          typeId,
          version: mod.version,
          label: typeId,
          description: '',
          category: 'flow',
          source: 'local',
          requiresHostSurfaces: [...required],
          missingHostSurfaces: required.filter((s) => !supported.has(s)),
        });
      }

      // 2. Pack-declared nodes scanned from ./packs/*/pack.json. We
      //    surface even packs whose modules haven't been loaded yet
      //    (the resolver will load them on first use). This is what
      //    the builder palette needs: declare a graph using a pack
      //    node before it's been resolved.
      const packDir = resolveDefaultPackDir();
      if (existsSync(packDir)) {
        for (const entry of readdirSync(packDir)) {
          const manifestPath = join(packDir, entry, 'pack.json');
          if (!existsSync(manifestPath)) continue;
          let manifest: PackManifest;
          try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PackManifest;
          } catch {
            continue;
          }
          if (!Array.isArray(manifest.nodes)) continue;
          for (const n of manifest.nodes) {
            const required = requiredHostSurfacesFor(n.typeId);
            nodes.push({
              typeId: n.typeId,
              version: n.version,
              label: n.label ?? n.typeId,
              description: n.description ?? '',
              category: n.category ?? 'flow',
              role: n.role,
              capabilities: n.capabilities,
              source: 'pack',
              packName: manifest.name,
              configSchema: readSchemaInline(packDir, entry, n.configSchemaRef),
              inputSchema: readSchemaInline(packDir, entry, n.inputSchemaRef),
              outputSchema: readSchemaInline(packDir, entry, n.outputSchemaRef),
              requiresHostSurfaces: [...required],
              missingHostSurfaces: required.filter((s) => !supported.has(s)),
              // RFC 0031 §B — propagate model-capability declarations from
              // the pack manifest. Absent for nodes whose author hasn't
              // declared the field; SHOULD-tier conformance for
              // `core.ai.*` nodes is asserted in
              // `node-module-required-capabilities-shape.test.ts`.
              ...(Array.isArray(n.requiredModelCapabilities)
                ? { requiredModelCapabilities: n.requiredModelCapabilities }
                : {}),
              ...(n.fallbackModel ? { fallbackModel: n.fallbackModel } : {}),
            });
          }
        }
      }

      // De-duplicate by typeId, preferring 'pack' source (richer metadata).
      const byTypeId = new Map<string, CatalogNode>();
      for (const n of nodes) {
        const existing = byTypeId.get(n.typeId);
        if (!existing || (existing.source === 'local' && n.source === 'pack')) {
          byTypeId.set(n.typeId, n);
        }
      }
      res.json({ nodes: Array.from(byTypeId.values()) });
    } catch (err) {
      next(err instanceof OpenwopError ? err : new OpenwopError('internal_error', String(err), 500));
    }
  });
}

function readSchemaInline(packDir: string, packEntry: string, ref: string | undefined): unknown {
  if (!ref) return undefined;
  // Refuse path-traversal attempts; only relative refs within the pack dir.
  if (ref.includes('..') || ref.startsWith('/')) return undefined;
  const schemaPath = join(packDir, packEntry, ref);
  if (!existsSync(schemaPath)) return undefined;
  try {
    const raw = readFileSync(schemaPath);
    if (raw.byteLength > MAX_SCHEMA_INLINE_BYTES) return { $ref: ref, _note: 'schema too large to inline' };
    return JSON.parse(raw.toString('utf-8'));
  } catch {
    return undefined;
  }
}
