/**
 * Memory inspector client (RFC 0004 read-side + demo delete).
 *
 * Reuses `listMemory` / `MemoryEntry` from runsClient (the canonical list
 * wrapper) and adds the single-entry `get` + demo-only `delete` the inspector
 * needs:
 *
 *   GET    /v1/host/sample/memory/:memoryId[?memoryRef=]  → { memoryRef, entry }
 *   DELETE /v1/host/sample/memory/:memoryId[?memoryRef=]  → { memoryRef, memoryId, removed }
 *
 * CTI-1: the backend scopes every read/delete to the caller's principal
 * (`req.tenantId`), never a query value. The inspector sends only
 * memoryRef/tag/limit + auth headers — never a tenantId/scopeId — so it cannot
 * cross a tenant boundary. Tenant selection is the auth layer's job.
 */

import { authedHeaders, config, fetchOpts } from '../../client/config.js';
import { listMemory, type MemoryEntry } from '../../client/runsClient.js';

export type { MemoryEntry };
export { listMemory };

const baseHeaders = (): HeadersInit => authedHeaders({ 'content-type': 'application/json' });

export async function getMemoryEntry(memoryId: string, memoryRef?: string): Promise<MemoryEntry> {
  const qs = memoryRef ? `?memoryRef=${encodeURIComponent(memoryRef)}` : '';
  const res = await fetch(
    `${config.baseUrl}/v1/host/sample/memory/${encodeURIComponent(memoryId)}${qs}`,
    fetchOpts({ headers: baseHeaders() }),
  );
  if (!res.ok) throw new Error(`getMemoryEntry returned ${res.status}`);
  const body = (await res.json()) as { memoryRef: string; entry: MemoryEntry };
  return body.entry;
}

export async function deleteMemoryEntry(memoryId: string, memoryRef?: string): Promise<void> {
  const qs = memoryRef ? `?memoryRef=${encodeURIComponent(memoryRef)}` : '';
  const res = await fetch(
    `${config.baseUrl}/v1/host/sample/memory/${encodeURIComponent(memoryId)}${qs}`,
    fetchOpts({ method: 'DELETE', headers: baseHeaders() }),
  );
  if (!res.ok) throw new Error(`deleteMemoryEntry returned ${res.status}`);
}
