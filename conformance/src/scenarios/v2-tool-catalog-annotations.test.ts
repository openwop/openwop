/**
 * RFC 0204 §D.11–§D.12 — the catalog's MCP annotation projection (suite 2.36.0,
 * target major 2; gated on `toolCatalog`).
 *
 * `spec/v2/core/tool-catalog.md` §The descriptor: the host assigns
 * `safetyTier`, `replayPolicy` and `egress` itself and never copies them from
 * an MCP server's `annotations` (untrusted upstream); an unclassified
 * `source: "mcp"` tool is `write`; and any `annotations` it publishes carry all
 * four hints, each a fixed function of those host-assigned fields.
 *
 *   annotations-derived     every descriptor carrying `annotations` has all
 *                           four hints and each equals the table's value;
 *                           `inapplicable` when no descriptor carries any (a
 *                           catalog without annotations is untouched by §D.12,
 *                           and passing it would be vacuous);
 *   mcp-unclassified-write  the suite's fake MCP server lists
 *                           `conformance_readonly_claim_<nonce>` annotated
 *                           `readOnlyHint: true`; wherever a host projects it
 *                           (any `conformance_readonly_claim_*` descriptor with
 *                           `source: "mcp"` — a host MAY answer from a list it
 *                           cached from an earlier suite server within `ttlMs`),
 *                           it MUST be `safetyTier: "write"`. `inapplicable`
 *                           when the host does not project the server.
 *
 * Sabotage, each run once against the v2 reference host: emit
 * `readOnlyHint: true` on a `write` tool; omit `openWorldHint`; copy the
 * server's `readOnlyHint` into `safetyTier: "read"` — each turns its row red.
 *
 * @see spec/v2/core/tool-catalog.md §The descriptor
 * @see SECURITY/invariants.yaml tool-annotations-untrusted
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { familyAdvertised } from '../lib/v2.js';
import { getMcpFakeServer, READONLY_CLAIM_PREFIX } from '../lib/mcp-fake-server.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { expectedAnnotations, type ToolDescriptor } from '../lib/toolCatalog.js';

export const REQUIRES_HOST_CALLBACK = "the host projects the suite's fake MCP server into GET /tools (the unclassified-MCP leg)";

const DOC = 'spec/v2/core/tool-catalog.md §The descriptor';
const ID_DERIVED = 'openwop.requirement.0204.annotations-derived';
const ID_UNCLASSIFIED = 'openwop.requirement.0204.mcp-unclassified-write';
/**
 * Recorded `inapplicable`, not through `gateFamily`: under strict mode
 * `gateFamily` FAILS a host that neither advertises nor opts out, and a new
 * gate on an existing family would de-certify every strict v2 cut that does not
 * advertise `toolCatalog` until its operator adds an opt-out — a certification
 * change this RFC does not make.
 */
const NOT_ADVERTISED = 'toolCatalog not advertised — the host publishes no catalog';
const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

async function readCatalog(): Promise<ToolDescriptor[] | { reason: string }> {
  const res = await driver.get('/tools').catch(() => null);
  if (res === null) return { reason: 'GET /tools unreachable (fetch failed)' };
  if (res.status !== 200) return { reason: `the host advertises toolCatalog and GET /tools answered ${res.status}` };
  const body = res.json as unknown;
  const tools = Array.isArray(body) ? body : (body as { tools?: unknown } | null)?.tools;
  return Array.isArray(tools) ? (tools as ToolDescriptor[]) : { reason: 'GET /tools returned neither a ToolDescriptor[] nor { tools }' };
}

describe('RFC 0204 §D — tool annotations are derived, never copied (gated on toolCatalog)', () => {
  it('every published annotations object is the table function of the descriptor', async () => {
    if (!(await familyAdvertised('toolCatalog'))) return softSkip('inapplicable', NOT_ADVERTISED);
    const tools = await readCatalog();
    if (!Array.isArray(tools)) return softSkip('blocked', tools.reason);
    const annotated = tools.filter((t) => t['annotations'] !== undefined);
    if (annotated.length === 0) return softSkip('inapplicable', `none of the ${tools.length} descriptors carries annotations — §D.12 binds only a host that publishes them`);
    for (const t of annotated) {
      const a = (t['annotations'] ?? {}) as Record<string, unknown>;
      const want = expectedAnnotations(t);
      for (const h of HINTS) {
        expect(typeof a[h], req(ID_DERIVED, DOC, `${String(t.toolId)}: annotations MUST carry all four hints — ${h} is ${a[h] === undefined ? 'absent (a consumer would fall through to the MCP default)' : `not a boolean (${JSON.stringify(a[h])})`}`)).toBe('boolean');
        expect(a[h], req(ID_DERIVED, DOC, `${String(t.toolId)}: ${h} MUST be derived from safetyTier=${String(t.safetyTier)} replayPolicy=${String(t['replayPolicy'] ?? '(absent)')} egress=${String(t['egress'] ?? '(absent)')} — want ${String(want[h])}`)).toBe(want[h]);
      }
    }
  });

  it('an MCP tool the host has not classified is safetyTier write, whatever the server claims', async () => {
    const fam = await familyAdvertised('toolCatalog');
    if (!fam) return softSkip('inapplicable', NOT_ADVERTISED);
    const sources = Array.isArray(fam['sources']) ? (fam['sources'] as unknown[]) : [];
    if (!sources.includes('mcp')) return softSkip('inapplicable', 'toolCatalog.sources does not include mcp — the host projects no MCP server');
    const fake = getMcpFakeServer();
    // No suite server ⇒ nothing the host could project: the RFC's `inapplicable`
    // case, not `blocked` — a tier-2 host that projects its own MCP servers and
    // cuts without OPENWOP_MCP_FAKE_SERVER is not made uncertifiable by this row.
    if (fake === null) return softSkip('inapplicable', 'the suite MCP fake server (OPENWOP_MCP_FAKE_SERVER=true) is not started in this run, so there is no suite server for the host to project');
    const tools = await readCatalog();
    if (!Array.isArray(tools)) return softSkip('blocked', tools.reason);
    const claims = tools.filter((t) => t.source === 'mcp' && [t.toolId, t['title']].some((v) => typeof v === 'string' && v.includes(READONLY_CLAIM_PREFIX)));
    if (claims.length === 0) return softSkip('inapplicable', `no source:"mcp" descriptor names ${fake.readonlyClaimToolName()} — the host does not project the suite's fake server as a catalog source`);
    for (const t of claims) {
      expect(t.safetyTier, req(ID_UNCLASSIFIED, DOC, `${String(t.toolId)}: the server annotates it readOnlyHint: true, which is untrusted; a source:"mcp" tool the host has not classified MUST be safetyTier "write" (got ${String(t.safetyTier)})`)).toBe('write');
    }
  });
});
