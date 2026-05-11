/**
 * Env-var validation for the openwop conformance suite.
 *
 * Required:
 *   OPENWOP_BASE_URL — the server root, e.g., https://api.example.com
 *   OPENWOP_API_KEY  — credential for runs:read / manifest:read scopes
 *
 * Optional (cosmetic — surfaced in failure messages):
 *   OPENWOP_IMPLEMENTATION_NAME    — e.g., "acme-openwop-server"
 *   OPENWOP_IMPLEMENTATION_VERSION — e.g., "1.0"
 */

export interface ConformanceEnv {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly implementationName: string;
  readonly implementationVersion: string;
}

let cached: ConformanceEnv | null = null;

export function loadEnv(): ConformanceEnv {
  if (cached) return cached;

  const baseUrl = process.env.OPENWOP_BASE_URL?.trim();
  const apiKey = process.env.OPENWOP_API_KEY?.trim();

  if (!baseUrl) {
    throw new Error(
      'OPENWOP_BASE_URL env var is required. Example: OPENWOP_BASE_URL=https://api.example.com',
    );
  }
  if (!apiKey) {
    throw new Error(
      'OPENWOP_API_KEY env var is required. See auth.md for credential format.',
    );
  }

  // Strip trailing slash so URL composition is consistent.
  const normalizedBase = baseUrl.replace(/\/$/, '');

  cached = {
    baseUrl: normalizedBase,
    apiKey,
    implementationName: process.env.OPENWOP_IMPLEMENTATION_NAME?.trim() ?? 'unknown',
    implementationVersion: process.env.OPENWOP_IMPLEMENTATION_VERSION?.trim() ?? 'unknown',
  };
  return cached;
}
