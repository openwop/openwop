/**
 * MCP-discoverability scenarios.
 *
 * `spec/v1/mcp-integration.md` §"Conformance + interop" calls out the
 * MCP slot as host-implementation-defined (not a normative openwop field).
 * The spec doesn't prescribe a wire-level MCP integration, but it
 * DOES say an OpenWOP host that supports MCP "advertises the capability
 * and (per the host's choice) lists supported MCP servers."
 *
 * Convention (matches lib/profiles.ts + reference hosts): the
 * `/.well-known/openwop` body itself IS the capabilities object — there
 * is no `capabilities` envelope. `replay`, `secrets`, `extensions`,
 * etc. all live at the top level.
 *
 * What this scenario locks in: IF a host advertises MCP-compatibility
 * — under either the standard top-level `mcp` slot OR a vendor-
 * namespaced slot like `<vendor>.mcp` — it MUST follow a consistent
 * shape so clients can discover serverUrls without per-vendor coupling.
 *
 * Required shape (when advertised):
 *   { supported: boolean, serverUrls: string[] }
 *
 * Hosts that don't advertise any MCP capability skip-equivalent
 * (test passes with no failed assertions per suite convention).
 *
 * @see spec/v1/mcp-integration.md
 * @see spec/v1/positioning.md (why MCP composes with openwop)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface McpAdvertisement {
  supported?: unknown;
  serverUrls?: unknown;
}

interface DiscoveredMcp {
  path: string;
  ad: McpAdvertisement;
}

function collectMcpAdvertisements(discovery: unknown): DiscoveredMcp[] {
  if (discovery === null || typeof discovery !== 'object') return [];
  const out: DiscoveredMcp[] = [];
  const obj = discovery as Record<string, unknown>;

  // Standard slot — top level of the discovery body per
  // mcp-integration.md §"Conformance + interop"
  if (obj.mcp !== null && typeof obj.mcp === 'object') {
    out.push({ path: 'mcp', ad: obj.mcp as McpAdvertisement });
  }

  // Vendor-namespaced slot (host-implementation-defined per spec).
  // Scans every top-level object value for a nested `mcp` field;
  // false-positive risk is low because non-namespace top-level fields
  // (limits, schemaVersions, etc.) don't carry an `mcp` key.
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'mcp') continue;
    if (value === null || typeof value !== 'object') continue;
    const inner = value as Record<string, unknown>;
    if ('mcp' in inner && inner.mcp !== null && typeof inner.mcp === 'object') {
      out.push({ path: `${key}.mcp`, ad: inner.mcp as McpAdvertisement });
    }
  }
  return out;
}

async function fetchMcpAdvertisements(): Promise<DiscoveredMcp[]> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return [];
  return collectMcpAdvertisements(res.json);
}

describe('mcp: discoverability shape', () => {
  it('any advertised MCP capability has well-formed shape ({supported, serverUrls})', async () => {
    const advertisements = await fetchMcpAdvertisements();
    if (advertisements.length === 0) return; // skip-equivalent: host does not advertise MCP

    for (const { path, ad } of advertisements) {
      expect(typeof ad.supported, driver.describe(
        'spec/v1/mcp-integration.md §"Conformance + interop"',
        `${path}.supported MUST be boolean when advertised`,
      )).toBe('boolean');

      if (ad.supported === true) {
        expect(Array.isArray(ad.serverUrls), driver.describe(
          'spec/v1/mcp-integration.md',
          `${path}.serverUrls MUST be an array when supported:true`,
        )).toBe(true);

        if (Array.isArray(ad.serverUrls)) {
          expect(ad.serverUrls.length, driver.describe(
            'spec/v1/mcp-integration.md',
            `${path}.serverUrls MUST be non-empty when supported:true`,
          )).toBeGreaterThan(0);

          for (const url of ad.serverUrls) {
            expect(typeof url, driver.describe(
              'spec/v1/mcp-integration.md',
              `${path}.serverUrls entries MUST be strings`,
            )).toBe('string');
          }
        }
      }
    }
  });

  it('serverUrls are valid URL paths or absolute URLs', async () => {
    const advertisements = await fetchMcpAdvertisements();
    if (advertisements.length === 0) return; // skip-equivalent

    for (const { path, ad } of advertisements) {
      if (ad.supported !== true || !Array.isArray(ad.serverUrls)) continue;
      for (const url of ad.serverUrls) {
        if (typeof url !== 'string') continue;
        // Must be either a leading-slash path (host-relative) or an
        // absolute URL with http/https scheme. Anything else is
        // ambiguous to a client trying to connect.
        const isHostRelative = url.startsWith('/');
        const isAbsoluteHttp = url.startsWith('http://') || url.startsWith('https://');
        expect(isHostRelative || isAbsoluteHttp, driver.describe(
          'spec/v1/mcp-integration.md',
          `${path}.serverUrls entry "${url}" MUST be a leading-slash path or absolute http(s) URL`,
        )).toBe(true);
      }
    }
  });
});
