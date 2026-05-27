/**
 * Shared helpers for the RFC 0071 Phase 2 host.chat.cardPacks conformance scenarios.
 * Lives in lib/ so scenarios import it via `../lib/cardPacks.js`.
 *
 * Hosts wiring chat card packs expose a documented host-extension seam:
 *
 *   POST /v1/host/sample/cardpacks/execute
 *     body: { cardTypeId: string, inputs: Record<string, unknown> }
 *     → 2xx {
 *         artifactId?: string,
 *         registered?: boolean,        // output validated against the linked outputArtifactType
 *         validated?: boolean,
 *         contentTrust?: 'trusted' | 'untrusted',   // the composed-envelope trust tag (R2)
 *         runStatus?: 'completed' | 'failed',
 *         artifactCreated?: { registered?: boolean, artifactType?: string }
 *       }
 *
 * A 404/405 means the host hasn't wired the seam → soft-skip.
 */
import { driver } from './driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Reads `host.chat.cardPacks` (or the `host.chat` block's `cardPacks` facet) from discovery; null when unadvertised. */
export async function readCardPacksCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const doc = res.json as DiscoveryDoc | undefined;
  const caps = doc?.capabilities && typeof doc.capabilities === 'object' ? (doc.capabilities as Record<string, unknown>) : undefined;
  // Accept either a discrete `host.chat.cardPacks` key or a `cardPacks` facet under `host.chat`.
  const direct = caps?.['host.chat.cardPacks'] ?? doc?.['host.chat.cardPacks'];
  if (direct && typeof direct === 'object') return direct as Record<string, unknown>;
  const chat = caps?.['host.chat'] ?? doc?.['host.chat'];
  const facet = chat && typeof chat === 'object' ? (chat as Record<string, unknown>)['cardPacks'] : undefined;
  return facet && typeof facet === 'object' ? (facet as Record<string, unknown>) : null;
}

export function cardPacksSupported(cap: Record<string, unknown> | null): boolean {
  return cap?.['supported'] === true;
}

/** Executes a registered card via the host-sample seam, or null (soft-skip) when absent. */
export async function executeCard(
  cardTypeId: string,
  inputs: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> } | null> {
  const res = await driver.post('/v1/host/sample/cardpacks/execute', { cardTypeId, inputs });
  if (res.status === 404 || res.status === 405) return null;
  return { status: res.status, json: (res.json ?? {}) as Record<string, unknown> };
}
