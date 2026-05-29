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

/**
 * True when the host advertises BOTH `httpClient.safeFetch.supported` AND
 * `toolHooks.prePostEvents` — the co-advertisement that, per
 * `host-capabilities.md` §host.http + RFC 0076 §B, makes live audit-pair
 * emission a MUST. One discovery fetch (the two single-flag helpers above each
 * fetch; this avoids the double round-trip for the live-audit gate).
 */
export async function isSafeFetchLiveAuditAdvertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const safeFetchOn =
    capabilityFamily<HttpClientCap>(disco.json, 'httpClient')?.safeFetch?.supported === true;
  const auditOn =
    capabilityFamily<{ prePostEvents?: boolean }>(disco.json, 'toolHooks')?.prePostEvents === true;
  return safeFetchOn && auditOn;
}

/** Result of the live-run safe-fetch seam: the host executed one
 *  `ctx.http.safeFetch` call inside a real run via the production injection
 *  path, and returns the run's id so the caller can read the durable event
 *  log. `null` ⇒ the run seam is unwired (soft-skip, host-pending). */
export interface SafeFetchRunResult {
  runId?: string;
  outcome?: 'fetched' | 'blocked';
}

/**
 * Drives one `ctx.http.safeFetch` call **inside a real run** via the open seam
 * `POST /v1/host/sample/http/safe-fetch-run`, returning `{ runId, outcome }`,
 * or null (soft-skip) when the run seam isn't wired. Distinct from `safeFetch`
 * (which returns the audit pair INLINE from the seam): this exercises the
 * production per-ctx `ctx.http.safeFetch` path so the caller can assert the
 * `agent.toolCalled`/`agent.toolReturned` pair landed in the DURABLE run event
 * log — closing the seam-vs-production gap in `safefetch-behavior.test.ts`.
 */
export async function safeFetchViaRun(
  body: Record<string, unknown>,
): Promise<SafeFetchRunResult | null> {
  const res = await driver.post('/v1/host/sample/http/safe-fetch-run', body);
  if (res.status === 404 || res.status === 405) return null; // run seam unwired — soft-skip
  return (res.json as SafeFetchRunResult | undefined) ?? {};
}
