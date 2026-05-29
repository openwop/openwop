/**
 * Shared helper for the RFC 0076 §B `ctx.http.safeFetch` conformance scenarios.
 * Lives in lib/ (not a *.test.ts) so scenarios import it via `../lib/safeFetch.js`.
 *
 * Reads `capabilities.httpClient.safeFetch` (root-first, wrapper-fallback) and
 * drives the conformance-only host seam `POST /v1/host/sample/http/safe-fetch`
 * (host-sample-test-seams.md §"Open seams").
 */
import { driver } from './driver.js';
import { capabilityFamily } from './discovery-capabilities.js';

interface HttpClientCap {
  supported?: boolean;
  safeFetch?: { supported?: boolean };
}

/** True when the host advertises `capabilities.httpClient.safeFetch.supported`. */
export async function isSafeFetchSupported(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<HttpClientCap>(disco.json, 'httpClient')?.safeFetch?.supported === true;
}

/** True when the host also advertises `capabilities.toolHooks.prePostEvents`. */
export async function isToolHookAuditOn(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<{ prePostEvents?: boolean }>(disco.json, 'toolHooks')?.prePostEvents === true;
}

export interface SafeFetchResult {
  outcome?: 'fetched' | 'blocked';
  status?: number;
  blocked?: 'ssrf' | 'upgrade' | string;
  toolCalled?: Record<string, unknown>;
  toolReturned?: Record<string, unknown>;
}

/**
 * Drives one safeFetch evaluation via the host-sample seam, or null (soft-skip)
 * when the host doesn't expose it.
 */
export async function safeFetch(body: Record<string, unknown>): Promise<SafeFetchResult | null> {
  const res = await driver.post('/v1/host/sample/http/safe-fetch', body);
  if (res.status === 404 || res.status === 405) return null; // seam absent — soft-skip
  return (res.json as SafeFetchResult | undefined) ?? {};
}
