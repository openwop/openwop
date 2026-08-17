/**
 * Shared helper for the RFC 0060 host.heartbeat conformance scenarios.
 * Lives in lib/ (not a *.test.ts) so scenarios import it via `../lib/heartbeat.js`.
 */
import { driver } from './driver.js';
import { discoveryFamilies } from './discovery-capabilities.js';

/** Reads `capabilities.heartbeat` from discovery; null when unadvertised. */
export async function readHeartbeatCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const caps = discoveryFamilies(res.json);
  const hb = caps && typeof caps === 'object' ? (caps as Record<string, unknown>)['heartbeat'] : undefined;
  return hb && typeof hb === 'object' ? (hb as Record<string, unknown>) : null;
}

/** True when the host advertises a working heartbeat surface. */
export function heartbeatSupported(cap: Record<string, unknown> | null): boolean {
  return cap?.['supported'] === true;
}

/** Drives one heartbeat tick via the host-sample seam, or null (soft-skip)
 *  when the host doesn't expose it. The seam is host-extension surface —
 *  hosts wiring RFC 0060 expose `POST /v1/host/sample/heartbeat/tick`. */
export async function tickHeartbeat(body: Record<string, unknown>): Promise<{ status: number; json: unknown } | null> {
  const res = await driver.post('/v1/host/sample/heartbeat/tick', body);
  if (res.status === 404 || res.status === 405) return null; // seam absent — soft-skip
  return { status: res.status, json: res.json };
}
