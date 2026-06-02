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
  | 'host.memory'
  | 'host.mcp'
  | 'host.aiProviders'
  | 'host.interrupts'
  | 'host.triggers'
  | 'host.a2a'
  | 'host.kanban'
  | 'host.knowledge'
  | 'host.chat'
  | 'host.canvas';

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
    { name: 'host.triggers', supported: true, implementation: 'workflow-engine', note: 'Trigger entry nodes (webhook/schedule/cron/email/mailhook/rss/form) surface the run-scoped ctx.triggerData payload; runs are started by the RFC 0083 trigger bridge, scheduler, and kanban paths. webhook-respond durably records the reply via ctx.respondToWebhook.' },
    { name: 'host.canvas', supported: true, implementation: 'workflow-engine', note: 'Durable versioned shared-canvas store for vendor.myndhyve.canvas. read/write/create are real (optimistic-concurrency, shallow/deep/replace merge, field projection); crossCanvasInvoke is an honest stub (no run dispatcher on the surface).' },
    { name: 'host.chat', supported: true, implementation: 'workflow-engine', note: 'Bridges vendor.myndhyve.chat to the demo chat store (the same /v1/host/sample/chat tables the SPA reads). sendMessage/progressCard/updateCard run; the suspend-based gate nodes (phaseInputGate/approvalGate/clarificationGate) need ctx.suspend, not yet implemented on the sample host.' },
    { name: 'host.knowledge', supported: true, implementation: 'workflow-engine', note: 'Lexical RAG retrieval (token-frequency over a seeded demo corpus) for vendor.myndhyve.knowledge-tools. Real retrieve-with-citations; lexical not semantic (sample host ships no embedding model).' },
    { name: 'host.kanban', supported: true, implementation: 'workflow-engine', note: 'Bridges vendor.myndhyve.kanban to the demo kanban store (kanbanService.ts) — boards/cards shared with the builder UI. boardReview/timelinePlan/resourceMonitor are genuinely computed; automation rules persist in-process.' },
    { name: 'host.a2a', supported: true, implementation: 'workflow-engine', note: 'RFC 0076 §A. A2A 0.3 JSON-RPC client from host/a2aSurface.ts — discover/send/stream/tasks/pushConfig against any peer A2A agent; wire state-form normalized to the pack vocabulary. Server-as-agent methods (publishAgentCard/emit*/pushSend) are demo stubs (sample host has no live A2A server endpoint).' },
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
