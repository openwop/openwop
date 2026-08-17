/**
 * Where a host mounts its MCP server (RFC 0153 §B / `mcp-integration.md`
 * §"MCP server composition").
 *
 * The reference boots mount it at the sample-seam path
 * `/v1/host/sample/mcp`, and until suite 1.134.0 every server-side MCP
 * scenario hard-coded that path. The v1.0 discovery baseline has always let a
 * host SAY where its mount is — `capabilities.mcp.serverUrls: string[]`
 * (`mcp-discoverability.test.ts`) — and the first deployed host to advertise
 * `mcp-2026-07-28` mounted at `/v1/host/openwop-app/mcp`, advertised exactly
 * that, and watched ten `server/discover` legs 404 against the sample path and
 * return early (S25, openwop-app H38, 2026-08-17). So: read the advert first,
 * fall back to the sample path, and never treat "the mount answered 404" as a
 * pass — that is `seamAbsent` (the host advertised a server mount it does not
 * serve where it said).
 */
import { driver } from './driver.js';
import { capabilityFamily } from './discovery-capabilities.js';

export const SAMPLE_MCP_MOUNT = '/v1/host/sample/mcp';

interface McpAdvert {
  readonly supported?: boolean;
  readonly serverUrls?: unknown;
  readonly serverMount?: { readonly supported?: boolean };
}

/**
 * The MCP server mount to POST JSON-RPC to: `capabilities.mcp.serverUrls[0]`
 * when the host advertises one (a path is joined to the base URL by the driver;
 * an absolute URL is used as-is), else the sample-seam path.
 */
export async function mcpServerMount(): Promise<string> {
  const disco = await driver.get('/.well-known/openwop');
  const mcp = capabilityFamily<McpAdvert>(disco.json, 'mcp');
  const urls = Array.isArray(mcp?.serverUrls) ? (mcp?.serverUrls as unknown[]) : [];
  const first = urls.find((u): u is string => typeof u === 'string' && u.length > 0);
  return first ?? SAMPLE_MCP_MOUNT;
}
