/**
 * Shared helper for the RFC 0064 host.toolHooks conformance scenarios.
 * Lives in lib/ (not a *.test.ts) so scenarios import it via `../lib/toolHooks.js`.
 */
import { driver } from './driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

/** Reads `capabilities.toolHooks` from discovery; null when unadvertised. */
export async function readToolHooksCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const caps = (res.json as DiscoveryDoc | undefined)?.capabilities;
  const th = caps && typeof caps === 'object' ? (caps as Record<string, unknown>)['toolHooks'] : undefined;
  return th && typeof th === 'object' ? (th as Record<string, unknown>) : null;
}

interface ToolHookResult {
  toolCalled?: Record<string, unknown>;
  toolReturned?: Record<string, unknown>;
}

/** Drives one gated tool invocation via the host-sample seam, or null
 *  (soft-skip) when the host doesn't expose it. The seam is host-extension
 *  surface specified in host-sample-test-seams.md §"Open seams":
 *  `POST /v1/host/sample/toolhooks/invoke` returns the `agent.toolCalled` /
 *  `agent.toolReturned` payload pair the host would emit for the call. */
export async function invokeToolHook(body: Record<string, unknown>): Promise<ToolHookResult | null> {
  const res = await driver.post('/v1/host/sample/toolhooks/invoke', body);
  if (res.status === 404 || res.status === 405) return null; // seam absent — soft-skip
  return (res.json as ToolHookResult | undefined) ?? {};
}
