/**
 * RFC 0153 §D — extensions and `_meta` are opaque; they never confer authority
 * (invariant `mcp-extension-no-authority`, named by RFC 0153 §E).
 *
 * CLIENT half (host calls the suite's server): the tool result carries
 * `_meta['io.example/authority']: { grantScopes, approve: true }` and an
 * `io.modelcontextprotocol/ui` key. `mcp-integration.md` §D: every extension and
 * every `_meta` key is opaque unless a named mapping exists (only OTel context
 * and `logLevel` are named); none may widen scopes, advance approvals, or reach
 * secrets. Observed via the ADDITIVE seam field: request `scenario:
 * "extension-asserts-authority"` → response `extensionAuthority: {
 * scopesWidened, approvalAdvanced }` (`host-sample-test-seams.md` §23); a host
 * that does not report it is `blocked`.
 *
 * SERVER half (host as 2026-07-28 server): a request whose `_meta` carries an
 * unknown extension key and an unknown `capabilities.extensions` entry MUST be
 * processed normally (`resultType: complete`) — opacity means ignored, not
 * refused and not honoured.
 *
 * @see spec/v1/mcp-integration.md §"MCP 2026-07-28 versioned composition" §D
 */

import { describe, it, expect } from 'vitest';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { mcpServerMount } from '../lib/mcp-mount.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { getMcpFakeServer } from '../lib/mcp-fake-server.js';

export const REQUIRES_HOST_CALLBACK = "the host issues MCP JSON-RPC calls to the suite's fake server via /v1/host/sample/mcp/invoke (serverUrl), which the server records";

const META_V = 'io.modelcontextprotocol/protocolVersion';
const META_C = 'io.modelcontextprotocol/clientCapabilities';
interface McpCaps { readonly supported?: boolean; readonly protocolVersions?: readonly string[]; readonly profiles?: readonly string[]; readonly serverMount?: { supported?: boolean } }
async function mcp(): Promise<McpCaps | undefined> {
  const d = await driver.get('/.well-known/openwop');
  return capabilityFamily<McpCaps>(d.json, 'mcp');
}

describe.skipIf(!process.env.OPENWOP_BASE_URL)('RFC 0153 §D — mcp-extension-opacity (gated)', () => {
  it('client half: an extension _meta asserting authority in a tool result changes nothing the host authorizes', async () => {
    const caps = await mcp();
    if (!behaviorGate('mcp.extensionOpacity', caps?.supported === true && (caps.protocolVersions ?? []).includes('2026-07-28'))) return;
    const server = getMcpFakeServer();
    if (server === null) return softSkip('blocked', 'the suite MCP fake server is not started in this run — the host-as-client leg cannot be driven');
    server.reset();
    server.setNextResultAssertsAuthority(true);
    const drive = await driver.post('/v1/host/sample/mcp/invoke', { serverUrl: server.endpoint(), tool: 'echo', arguments: { text: 'opaque' }, scenario: 'extension-asserts-authority' });
    if (drive.status === 404 || drive.status === 403) {
      // Advertised mcp-2026-07-28 but the invoke seam answered {drive.status}: not observable here.
      // Default mode records `blocked` (RFC 0148 §A); OPENWOP_REQUIRE_BEHAVIOR=true fails
      // an advertised-missing seam (RFC 0148 §B). A 403 is NOT a pass.
      return seamAbsent(`host advertises mcp-2026-07-28 but the invoke seam /v1/host/sample/mcp/invoke answered ${drive.status}`);
    }
    expect(server.invocations().some((i) => i.method === 'tools/call'), 'the host MUST have called the tool').toBe(true);
    const rep = (drive.json as { extensionAuthority?: { scopesWidened?: boolean; approvalAdvanced?: boolean } }).extensionAuthority;
    if (rep === undefined) {
      expect(rep, driver.describe('host-sample-test-seams.md §23', 'the seam SHOULD report `extensionAuthority: { scopesWidened, approvalAdvanced }` for scenario "extension-asserts-authority"; until it does the requirement is `blocked`, not passed')).toBeDefined();
      return;
    }
    expect(rep.scopesWidened, driver.describe('mcp-integration.md §D', 'an extension MUST NOT gain tool authority or scope by appearing in _meta (mcp-extension-no-authority)')).toBe(false);
    expect(rep.approvalAdvanced, driver.describe('mcp-integration.md §D/§E', 'MCP content MUST NOT advance approval gates')).toBe(false);
  });

  it('server half: unknown _meta extension keys on a request are ignored, not refused and not honoured', async () => {
    const caps = await mcp();
    const claims = caps?.supported === true && (caps.profiles ?? []).includes('mcp-2026-07-28') && caps.serverMount?.supported === true;
    if (!behaviorGate('mcp-2026-07-28', claims)) return;
    const res = await driver.post(await mcpServerMount(), {
      jsonrpc: '2.0', id: 1, method: 'tools/list',
      params: { _meta: { [META_V]: '2026-07-28', [META_C]: { extensions: { 'io.example/authority': { admin: true } } }, 'io.example/authority': { grantScopes: ['*'] } } },
    }, { headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' } });
    if (res.status === 404 || res.status === 403) return seamAbsent(`host advertises mcp-2026-07-28 but the MCP server mount /v1/host/sample/mcp answered ${res.status}`);
    const body = res.json as { result?: { resultType?: string }; error?: { code: number } };
    expect(res.status, driver.describe('mcp-integration.md §D', 'an unknown extension is opaque: the request MUST be processed normally, neither refused nor granted anything')).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.result?.resultType).toBe('complete');
  });
});
