/**
 * Process-wide registry of advertised host surfaces.
 *
 * Each surface name is a stable string used by:
 *   - the catalog response (`requiresHostSurfaces` per node), so the
 *     UI can tell whether a node will execute on this host;
 *   - the well-known advertisement (`capabilities.hostSurfaces`), so
 *     external introspection clients can see the same info.
 *
 * The registry starts empty. Bootstrap code registers each surface as
 * it wires the underlying implementation. Surfaces NOT registered are
 * advertised as `{ supported: false }`. This mirrors the existing
 * `aiProviders` block, which has been hand-rolled in discovery.ts;
 * future cleanup could fold aiProviders into this registry too.
 *
 * Spec references:
 *   - host.kvStorage / host.tableStorage / host.cache / host.blobStorage
 *     / host.queue per RFCs 0015–0019.
 *   - host.fs per RFC 0014.
 *   - host.db.{sql,nosql,search,vector} per RFC 0018.
 *   - host.messaging, host.observability, host.mcp — not yet RFC'd;
 *     surface names match the typeId-prefix → surface table in
 *     hostSurfaceMap.ts.
 */

import { createLogger } from '../observability/logger.js';

const log = createLogger('bootstrap.hostSurfaceRegistry');

export type HostSurfaceName =
  | 'host.kvStorage'
  | 'host.tableStorage'
  | 'host.cache'
  | 'host.blobStorage'
  | 'host.queue'
  | 'host.fs'
  | 'host.db.sql'
  | 'host.db.nosql'
  | 'host.db.search'
  | 'host.db.vector'
  | 'host.messaging'
  | 'host.observability'
  | 'host.mcp'
  | 'host.aiProviders'
  | 'host.interrupts'
  | 'host.triggers'
  | 'host.a2a';

export interface HostSurfaceAdvertisement {
  /** Stable surface name. */
  name: HostSurfaceName;
  /** Whether this host actually implements the surface. */
  supported: boolean;
  /** Free-form one-liner the UI can render under the surface name. */
  note?: string;
  /** Backing implementation tag: `'in-memory'`, `'sqlite'`, `'postgres'`, etc.
   *  Used by the UI to show "in-memory demo" badges. Absent when not supported. */
  implementation?: string;
}

const registry = new Map<HostSurfaceName, HostSurfaceAdvertisement>();

export function registerHostSurface(ad: HostSurfaceAdvertisement): void {
  if (registry.has(ad.name)) {
    log.warn('host surface already registered; overwriting', { name: ad.name });
  }
  registry.set(ad.name, ad);
  log.info('host surface registered', {
    name: ad.name,
    supported: ad.supported,
    implementation: ad.implementation,
  });
}

/**
 * Idempotent seed for surfaces that this sample knows about but doesn't
 * yet implement. Lets the UI render the full surface list with
 * `supported=false` so users can see what's *possible* vs. what's
 * *wired*. Called once at boot — re-calls are no-ops because
 * registerHostSurface only overwrites with a warning.
 */
export function seedDefaultHostSurfaces(): void {
  const defaults: HostSurfaceAdvertisement[] = [
    { name: 'host.kvStorage', supported: false, note: 'RFC 0015. Wire in Phase 3 with an in-memory adapter.' },
    { name: 'host.tableStorage', supported: false, note: 'RFC 0016.' },
    { name: 'host.cache', supported: false, note: 'RFC 0019 §cache.' },
    { name: 'host.blobStorage', supported: false, note: 'RFC 0019 §blob.' },
    { name: 'host.queue', supported: false, note: 'RFC 0017.' },
    { name: 'host.fs', supported: true, implementation: 'workflow-engine', note: 'RFC 0014 (Active). In-memory sandboxed filesystem from host/inMemorySurfaces.ts; sandboxRoot under {dataDir}/fs.' },
    { name: 'host.db.sql', supported: false, note: 'RFC 0018 §SQL.' },
    { name: 'host.db.nosql', supported: false, note: 'RFC 0018 §NoSQL.' },
    { name: 'host.db.search', supported: false, note: 'RFC 0018 §search.' },
    { name: 'host.db.vector', supported: false, note: 'RFC 0018 §vector.' },
    { name: 'host.messaging', supported: false },
    { name: 'host.observability', supported: false, note: 'Wired implicitly via emit() — surface flag not yet honored.' },
    { name: 'host.mcp', supported: process.env.OPENWOP_MCP_SERVER_ENABLED === 'true', implementation: 'workflow-engine', note: 'RFC 0020 (Active). Sample-host MCP server mount at /v1/host/sample/mcp; advertise streamable-http transport. OFF by default — set OPENWOP_MCP_SERVER_ENABLED=true.' },
    { name: 'host.triggers', supported: false, note: 'Webhooks already supported via /v1/webhooks; full trigger fan-out not yet wired.' },
    { name: 'host.a2a', supported: false, note: 'A2A requires a peer agent.' },
    // These two are already advertised honestly elsewhere — pre-seed
    // them as supported so the UI doesn't show contradictory data.
    { name: 'host.aiProviders', supported: true, implementation: 'workflow-engine', note: 'BYOK via /v1/host/sample/byok/secrets.' },
    { name: 'host.interrupts', supported: true, implementation: 'workflow-engine' },
  ];
  for (const ad of defaults) {
    if (!registry.has(ad.name)) {
      registry.set(ad.name, ad);
    }
  }
}

export function listHostSurfaces(): HostSurfaceAdvertisement[] {
  return Array.from(registry.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getHostSurface(name: HostSurfaceName): HostSurfaceAdvertisement | undefined {
  return registry.get(name);
}

/** Test seam — wipes the registry. */
export function _resetHostSurfaceRegistry(): void {
  registry.clear();
}
