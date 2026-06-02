/**
 * Map from node typeId (prefix) to the host surfaces the node needs to
 * execute. Used by the catalog route to annotate each node with
 * `requiresHostSurfaces`, so the UI can show users which nodes will
 * fail with HOST_CAPABILITY_MISSING on this host.
 *
 * The mapping is derived from the published packs' `index.mjs` runtime
 * delegations (e.g., `core.openwop.storage/index.mjs` calls
 * `ctx.storage.kv.*` for `core.storage.kv-*`). When a pack rev moves
 * a node to a different surface, update this table.
 *
 * Heuristic: most specific prefix wins. We sort entries by prefix
 * length descending at lookup time.
 */

import type { HostSurfaceName } from './hostSurfaceRegistry.js';

interface MapEntry {
  prefix: string;
  surfaces: readonly HostSurfaceName[];
}

const MAP: readonly MapEntry[] = [
  // ── core.openwop.storage ──────────────────────────────────────────
  { prefix: 'core.storage.kv-', surfaces: ['host.kvStorage'] },
  { prefix: 'core.storage.table-', surfaces: ['host.tableStorage'] },
  { prefix: 'core.storage.cache-', surfaces: ['host.cache'] },
  { prefix: 'core.storage.blob-', surfaces: ['host.blobStorage'] },
  { prefix: 'core.storage.queue-', surfaces: ['host.queue'] },

  // ── core.openwop.db ──────────────────────────────────────────────
  { prefix: 'core.db.sql-', surfaces: ['host.db.sql'] },
  { prefix: 'core.db.nosql-', surfaces: ['host.db.nosql'] },
  { prefix: 'core.db.search-', surfaces: ['host.db.search'] },
  { prefix: 'core.db.vector-', surfaces: ['host.db.vector'] },

  // ── core.openwop.files ───────────────────────────────────────────
  // Local fs nodes need host.fs; ftp/sftp/ssh are external and don't.
  { prefix: 'core.files.read', surfaces: ['host.fs'] },
  { prefix: 'core.files.write', surfaces: ['host.fs'] },
  { prefix: 'core.files.delete', surfaces: ['host.fs'] },
  { prefix: 'core.files.stat', surfaces: ['host.fs'] },
  { prefix: 'core.files.list', surfaces: ['host.fs'] },
  // The rest of core.files.* (to-base64, image-resize, pdf-extract, etc.)
  // are pure CPU and don't need a host surface.

  // ── core.openwop.messaging ───────────────────────────────────────
  { prefix: 'core.messaging.', surfaces: ['host.messaging'] },

  // ── core.openwop.rag ─────────────────────────────────────────────
  // Vector ops route through host.db.vector. Loaders need outbound
  // HTTP/fs but no dedicated surface. upsert/query (and the retrievers,
  // which delegate to vector-query) ALSO embed via ctx.callAI.embeddings
  // → host.aiProviders; vector-delete (by id/filter) does not embed.
  // Longest-prefix-first resolution means these specific entries win
  // over the broad `core.rag.vector-` below.
  { prefix: 'core.rag.vector-upsert', surfaces: ['host.db.vector', 'host.aiProviders'] },
  { prefix: 'core.rag.vector-query', surfaces: ['host.db.vector', 'host.aiProviders'] },
  { prefix: 'core.rag.retriever-', surfaces: ['host.db.vector', 'host.aiProviders'] },
  { prefix: 'core.rag.vector-', surfaces: ['host.db.vector'] },

  // ── core.openwop.mcp ─────────────────────────────────────────────
  { prefix: 'core.openwop.mcp.', surfaces: ['host.mcp'] },

  // ── core.openwop.a2a ─────────────────────────────────────────────
  { prefix: 'core.openwop.a2a.', surfaces: ['host.a2a'] },

  // ── core.openwop.ai ──────────────────────────────────────────────
  { prefix: 'core.ai.', surfaces: ['host.aiProviders'] },
  { prefix: 'core.openwop.ai.', surfaces: ['host.aiProviders'] },

  // ── core.openwop.agents ──────────────────────────────────────────
  // Agents need an LLM at minimum. tool-* variants delegate further.
  { prefix: 'core.agents.run', surfaces: ['host.aiProviders'] },
  { prefix: 'core.agents.tool-mcp', surfaces: ['host.mcp'] },
  { prefix: 'core.agents.memory-kv-store', surfaces: ['host.kvStorage'] },

  // ── core.openwop.obs ─────────────────────────────────────────────
  { prefix: 'core.obs.', surfaces: ['host.observability'] },

  // ── core.openwop.hitl ────────────────────────────────────────────
  { prefix: 'core.hitl.', surfaces: ['host.interrupts'] },

  // ── core.openwop.triggers ────────────────────────────────────────
  { prefix: 'core.trigger.webhook', surfaces: ['host.triggers'] },
  { prefix: 'core.trigger.schedule', surfaces: ['host.triggers'] },
  { prefix: 'core.trigger.cron', surfaces: ['host.triggers'] },
  { prefix: 'core.trigger.email', surfaces: ['host.triggers'] },
  { prefix: 'core.trigger.mailhook', surfaces: ['host.triggers'] },
  { prefix: 'core.trigger.rss', surfaces: ['host.triggers'] },
  { prefix: 'core.trigger.form', surfaces: ['host.triggers'] },
  // `core.trigger.manual`, `.event`, `.envelope` etc. don't need a
  // dedicated surface — they're synthesized inline by the run kickoff.

  // ── vendor.myndhyve.kanban ───────────────────────────────────────
  { prefix: 'kanban.board.', surfaces: ['host.kanban'] },
  { prefix: 'kanban.task.', surfaces: ['host.kanban'] },
  { prefix: 'kanban.timeline.', surfaces: ['host.kanban'] },
  { prefix: 'kanban.workflow.', surfaces: ['host.kanban'] },
  { prefix: 'kanban.resource.', surfaces: ['host.kanban'] },

  // ── vendor.myndhyve.knowledge-tools ──────────────────────────────
  { prefix: 'knowledge.', surfaces: ['host.knowledge'] },

  // ── vendor.myndhyve.chat ─────────────────────────────────────────
  { prefix: 'core.chat.', surfaces: ['host.chat'] },

  // ── vendor.myndhyve.canvas ───────────────────────────────────────
  { prefix: 'core.coordination.canvas', surfaces: ['host.canvas'] },
  { prefix: 'core.coordination.crossCanvas', surfaces: ['host.canvas'] },

  // ── vendor.myndhyve.web-research ─────────────────────────────────
  { prefix: 'data.source.webSearch', surfaces: ['host.webResearch'] },
  { prefix: 'data.transform.fetchUrls', surfaces: ['host.webResearch'] },
  { prefix: 'ai.research.web', surfaces: ['host.webResearch'] },

  // ── vendor.myndhyve.launch-studio ────────────────────────────────
  { prefix: 'launch-studio.', surfaces: ['host.launchStudio'] },
];

// Sort once at module load: longest prefix first, so more-specific
// entries (e.g., `core.agents.tool-mcp`) win over broader ones
// (e.g., `core.agents.`).
const SORTED = [...MAP].sort((a, b) => b.prefix.length - a.prefix.length);

export function requiredHostSurfacesFor(typeId: string): readonly HostSurfaceName[] {
  for (const entry of SORTED) {
    if (typeId.startsWith(entry.prefix)) return entry.surfaces;
  }
  return [];
}
