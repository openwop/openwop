/**
 * RFC 0175 §E.1 — `mrtr-rounds-ceiling` (suite 2.0.0, target major 2; gated on mcp + mrtr).
 *
 * `mcp.mrtr.maxRounds` (integer 1–16) is the advertised ceiling on multi-round
 * tool-result rounds; the host MUST refuse an `input_required` round beyond it
 * with `mcp_mrtr_rounds_exceeded` (422, `spec/v2/errors.json`); RFC 0153 G9
 * closes (`spec/v2/core/interop.md` §The MCP round ceiling; RFC 0175 row C8.7).
 *
 * Legs:
 *   1. unaided on the gate: the facet's `maxRounds` is an integer in 1..16;
 *   2. behavioural: drive `maxRounds + 1` `input_required` rounds through the
 *      suite's fake MCP server via the §23 invoke seam. The suite's server
 *      (`McpFakeServer`) has ONE MRTR tool, `needs_input`, which completes on
 *      the first retry — it cannot re-issue `input_required` N times — so the
 *      behavioural leg records `blocked` naming the fixture it needs: a
 *      `needs_input_loop` tool that answers `input_required` for
 *      `arguments.rounds` retries before completing.
 *
 * @see spec/v2/core/interop.md §The MCP round ceiling
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { getMcpFakeServer } from '../lib/mcp-fake-server.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = "the host's MCP client drives MRTR rounds against the suite's fake server through /conformance/seams/sample/mcp/invoke";

const CODE = 'mcp_mrtr_rounds_exceeded';
const LOOP_TOOL = 'needs_input_loop';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

function maxRoundsOf(facet: Record<string, unknown>): unknown {
  const mrtr = facet['mrtr'];
  return mrtr && typeof mrtr === 'object' ? (mrtr as { maxRounds?: unknown }).maxRounds : undefined;
}

describe('RFC 0175 §E.1 — mrtr-rounds-ceiling (gated on mcp + mrtr)', () => {
  it('mcp.mrtr.maxRounds is an integer ceiling in 1..16', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const facet = await familyAdvertised('mcp');
    if (!facet) return softSkip('inapplicable', 'mcp facet not advertised — no MRTR ceiling');
    const maxRounds = maxRoundsOf(facet);
    if (maxRounds === undefined) return softSkip('inapplicable', 'mcp.mrtr not advertised — the host offers no multi-round tool results');
    expect(
      Number.isInteger(maxRounds) && (maxRounds as number) >= 1 && (maxRounds as number) <= 16,
      req('openwop.requirement.0175.mrtr-rounds-ceiling', 'facets/mcp.schema.json mrtr.maxRounds', `maxRounds MUST be an integer in 1..16 (got ${JSON.stringify(maxRounds)}) — "the host MUST bound the number of rounds (host policy)" was a MUST with no number (RFC 0153 G9)`),
    ).toBe(true);
  });

  it('round maxRounds + 1 is refused with mcp_mrtr_rounds_exceeded', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const facet = await familyAdvertised('mcp');
    if (!facet) return softSkip('inapplicable', 'mcp facet not advertised — no MRTR ceiling');
    const maxRounds = maxRoundsOf(facet);
    if (!Number.isInteger(maxRounds)) return softSkip('inapplicable', 'mcp.mrtr.maxRounds not advertised — no ceiling to exceed');
    if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'the rounds are driven through the seams profile (§23 invoke seam) — conformance.seamsProfile is not openwop-conformance-seams-v2');
    const server = getMcpFakeServer();
    if (server === null) return softSkip('blocked', 'the suite MCP fake server (OPENWOP_MCP_FAKE_SERVER=true) is not started in this run');
    server.reset();
    // The suite server's only MRTR tool, `needs_input`, completes on the first
    // retry: it cannot re-issue input_required maxRounds+1 times. The fixture
    // this leg needs is a `needs_input_loop` tool on McpFakeServer that answers
    // input_required for `arguments.rounds` retries before completing.
    const rounds = (maxRounds as number) + 1;
    const res = await driver.post(`${SEAMS_PREFIX}/sample/mcp/invoke`, {
      serverUrl: server.endpoint(),
      tool: LOOP_TOOL,
      arguments: { rounds },
      clientCapabilities: { elicitation: {} },
      elicitationAnswer: { name: 'Ada' },
    });
    if (res.status === 404 || res.status === 403 || res.status === 405) return seamAbsent(`host advertises mcp.mrtr but ${SEAMS_PREFIX}/sample/mcp/invoke answered ${res.status} (host-sample-test-seams.md §23)`);
    const served = server.invocations().filter((i) => i.method === 'tools/call');
    const loopKnown = served.some((i) => (i.params as { name?: unknown } | null)?.name === LOOP_TOOL) && !res.text.includes('Unknown tool');
    if (!loopKnown) {
      return softSkip('blocked', `the suite MCP fake server cannot loop — its only MRTR tool (needs_input) completes on the first retry; a \`${LOOP_TOOL}\` fixture tool that re-issues input_required ${rounds} times is required to drive maxRounds + 1`);
    }
    expect(res.status, req('openwop.requirement.0175.mrtr-rounds-ceiling.refused', 'interop.md §The MCP round ceiling', `round ${rounds} (maxRounds + 1) MUST be refused with 422`)).toBe(422);
    expect(readErrorCode(res.json), req('openwop.requirement.0175.mrtr-rounds-ceiling.refused', 'errors.json mcp_mrtr_rounds_exceeded', `the refusal MUST carry ${CODE}`)).toBe(CODE);
    expect(
      served.length,
      req('openwop.requirement.0175.mrtr-rounds-ceiling.refused', 'interop.md §The MCP round ceiling', `the host MUST NOT issue a retry beyond the ceiling — the server saw ${served.length} tools/call for a ceiling of ${String(maxRounds)}`),
    ).toBeLessThanOrEqual((maxRounds as number) + 1);
  });
});
