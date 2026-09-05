/**
 * RFC 0175 §D.2 — `minimum-version-refused` (suite 2.0.0, target major 2; gated on a2a/mcp + seams).
 *
 * A host advertises a floor (`a2a.minimumVersion` / `mcp.minimumRevision`); a
 * negotiation that would land below it MUST fail closed with
 * `interop_version_unsupported` (400, `spec/v2/errors.json`) whether or not
 * policy permits an explicit downgrade above the floor, and the
 * `negotiation.decided` event MUST say `outcome: refused` (`spec/v2/core/interop.md`
 * §The floor, §The audit event; RFC 0175 §D.2/§D.3; invariant
 * `interop-minimum-version-enforced`).
 *
 * How the below-floor peer is produced: the suite constructs its OWN single-era
 * peer offering only a version below the advertised floor — `A2AFakePeer`
 * with `['0.3']`, `McpFakeServer` with `['2025-06-18']` — and points the host at
 * it through the §22/§23 invoke seams (`peerOffersOnly` for A2A). When the
 * host's floor is at or below the lowest version the suite can offer there is
 * nothing below the floor to offer, and the leg records `blocked` naming that.
 *
 * Callback-shaped (the host calls the suite's peer): unwitnessable when the
 * host is in a separate network namespace — `../lib/host-callback.ts`.
 *
 * @see spec/v2/core/interop.md §Negotiation is a protocol
 * @see SECURITY/threat-model-interop.md (interop-minimum-version-enforced)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { A2AFakePeer } from '../lib/a2a-fake-peer.js';
import { McpFakeServer } from '../lib/mcp-fake-server.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = "the host's A2A/MCP client calls a suite-owned peer that offers only a version below the advertised floor";

const CODE = 'interop_version_unsupported';
const A2A_LOWEST = '0.3';
const MCP_LOWEST = '2025-06-18';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

function a2aBelow(a: string, b: string): boolean {
  const [am, an] = a.split('.').map(Number);
  const [bm, bn] = b.split('.').map(Number);
  return am! < bm! || (am === bm && an! < bn!);
}

interface EventRow { type?: unknown; payload?: Record<string, unknown> }
async function decidedEvents(runId: string): Promise<EventRow[]> {
  const res = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
  const events = res.status === 200 ? ((res.json as { events?: EventRow[] } | null)?.events ?? []) : [];
  return events.filter((e) => e.type === 'negotiation.decided');
}

async function assertRefused(id: string, protocol: 'a2a' | 'mcp', floor: string, res: { status: number; json: unknown }): Promise<void> {
  expect(
    res.status,
    req(id, 'interop.md §The floor', `a negotiation that would land below ${protocol}'s floor (${floor}) MUST fail closed with 400 (RFC 0175 §D.2)`),
  ).toBe(400);
  expect(
    readErrorCode(res.json),
    req(id, 'errors.json interop_version_unsupported', `the refusal MUST carry ${CODE} in the canonical envelope`),
  ).toBe(CODE);
  const details = (res.json as { details?: Record<string, unknown> } | null)?.details ?? {};
  if (details['protocol'] !== undefined) {
    expect(details['protocol'], req(id, 'host-sample-test-seams.md §22/§23', `details.protocol MUST name ${protocol}`)).toBe(protocol);
  }
  const runId = (res.json as { runId?: unknown } | null)?.runId ?? details['runId'];
  if (typeof runId !== 'string') {
    softSkip('blocked', `the refusal names no runId — the negotiation.decided { outcome: refused } event on the host log is not addressable from the suite`);
    return;
  }
  const decided = await decidedEvents(runId);
  expect(decided.length, req(id, 'interop.md §The audit event', 'the refused outcome MUST also emit negotiation.decided (RFC 0175 §D.3 — every outcome, including the fail-closed one)')).toBeGreaterThan(0);
  const last = decided[decided.length - 1]!.payload ?? {};
  expect(last['outcome'], req(id, 'run-event-payloads.schema.json negotiationDecided.outcome', 'the event MUST say outcome: refused')).toBe('refused');
  expect(last['reason'], req(id, 'run-event-payloads.schema.json negotiationDecided.reason', 'the reason MUST be below-floor')).toBe('below-floor');
  if (last['floor'] !== undefined) expect(last['floor'], req(id, 'run-event-payloads.schema.json negotiationDecided.floor', 'the recorded floor MUST equal the advertised one')).toBe(floor);
}

describe('RFC 0175 §D.2 — minimum-version-refused (gated on a2a/mcp + seams)', () => {
  it('an A2A peer offering only a version below minimumVersion is refused', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const facet = await familyAdvertised('a2a');
    if (!facet) return softSkip('inapplicable', 'a2a facet not advertised — no floor to enforce');
    if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'the below-floor exchange is driven through the seams profile — conformance.seamsProfile is not openwop-conformance-seams-v2');
    const floor = String(facet['minimumVersion']);
    if (!a2aBelow(A2A_LOWEST, floor)) {
      return softSkip('blocked', `the advertised a2a.minimumVersion (${floor}) is at or below the lowest version the suite peer can offer (${A2A_LOWEST}) — nothing below the floor can be offered; a peer speaking a lower A2A revision is needed`);
    }
    const peer = new A2AFakePeer({ protocolVersions: ['0.3'] });
    await peer.start();
    try {
      const res = await driver.post(`${SEAMS_PREFIX}/sample/a2a/invoke`, { peerUrl: peer.endpoint(), authenticated: true, peerOffersOnly: A2A_LOWEST });
      if (res.status === 404 || res.status === 403 || res.status === 405) return seamAbsent(`host advertises a2a but ${SEAMS_PREFIX}/sample/a2a/invoke answered ${res.status} (host-sample-test-seams.md §22)`);
      await assertRefused('openwop.requirement.0175.minimum-version-refused', 'a2a', floor, res);
      // The wire leg: the host MUST NOT have spoken the below-floor version to the peer.
      for (const c of peer.invocations().filter((i) => i.method !== 'GET')) {
        expect(
          a2aBelow(String(c.headers['a2a-version'] ?? ''), floor),
          req('openwop.requirement.0175.minimum-version-refused', 'interop.md §The floor', `no call to the peer may carry an A2A-Version below the floor (got ${String(c.headers['a2a-version'])})`),
        ).toBe(false);
      }
    } finally {
      await peer.stop();
    }
  });

  it('an MCP server offering only a revision below minimumRevision is refused', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const facet = await familyAdvertised('mcp');
    if (!facet) return softSkip('inapplicable', 'mcp facet not advertised — no floor to enforce');
    if (!seamsProfileAdvertised(doc)) return softSkip('blocked', 'the below-floor exchange is driven through the seams profile — conformance.seamsProfile is not openwop-conformance-seams-v2');
    const floor = String(facet['minimumRevision']);
    if (!(MCP_LOWEST < floor)) {
      return softSkip('blocked', `the advertised mcp.minimumRevision (${floor}) is at or below the lowest revision the suite server can offer (${MCP_LOWEST}) — nothing below the floor can be offered`);
    }
    const server = new McpFakeServer({ protocolVersions: ['2025-06-18'] });
    await server.start();
    try {
      const res = await driver.post(`${SEAMS_PREFIX}/sample/mcp/invoke`, { serverUrl: server.endpoint(), requestVersion: MCP_LOWEST });
      if (res.status === 404 || res.status === 403 || res.status === 405) return seamAbsent(`host advertises mcp but ${SEAMS_PREFIX}/sample/mcp/invoke answered ${res.status} (host-sample-test-seams.md §23)`);
      await assertRefused('openwop.requirement.0175.minimum-version-refused.mcp', 'mcp', floor, res);
      for (const c of server.invocations()) {
        const v = String(c.headers['mcp-protocol-version'] ?? '');
        expect(
          v !== '' && v < floor,
          req('openwop.requirement.0175.minimum-version-refused.mcp', 'interop.md §The floor', `no call to the server may carry an MCP-Protocol-Version below the floor (got ${v})`),
        ).toBe(false);
      }
    } finally {
      await server.stop();
    }
  });
});
