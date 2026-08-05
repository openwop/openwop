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
  // RFC 0137 G16 (resolved 2026-08-05): the canonical discovery key is the PLAIN
  // family name at the document root. capabilities.schema.json declares 82 properties
  // and ZERO dotted host.* keys, and already declares five host capabilities plainly
  // (fs, kvStorage, tableStorage, queueBus, scheduling), each mapping to a §host.<name>
  // section. The `host.` prefix is the capability IDENTIFIER (peerDependencies,
  // error.capability), not the discovery key. Order: plain-root → dotted-root →
  // plain-wrapper → dotted-wrapper (root before wrapper per RFC 0073).
  // Accept either a discrete cardPacks key or a `cardPacks` facet under the chat block.
  const direct = doc?.['chat.cardPacks'] ?? doc?.['host.chat.cardPacks'] ?? caps?.['chat.cardPacks'] ?? caps?.['host.chat.cardPacks'];
  if (direct && typeof direct === 'object') return direct as Record<string, unknown>;
  const chat = doc?.['chat'] ?? doc?.['host.chat'] ?? caps?.['chat'] ?? caps?.['host.chat'];
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
