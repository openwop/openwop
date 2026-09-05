/**
 * RFC 0175 §D.1 — `negotiation-authenticated` (suite 2.0.0, target major 2; gated on a2a/mcp + seams).
 *
 * A version-negotiation exchange MUST be authenticated: the peer identity is
 * the caller's Subject or the host's own outbound identity, and an
 * UNAUTHENTICATED exchange MUST NOT lower the negotiated version below
 * `preferredVersion` (`spec/v2/core/interop.md` §Authentication; RFC 0175 §D.1,
 * row C8.6; invariant `interop-negotiation-authenticated`).
 *
 * The load-bearing requirement is negative, as in the v1 silent-downgrade
 * scenarios: an unauthenticated peer that offers only a lower version must
 * produce either a refusal or a negotiation at `preferredVersion` — never a
 * success at the lower version. Both legs are checked: the host's report
 * (`negotiatedVersion`), the wire the suite's peer captured (`A2A-Version` /
 * `MCP-Protocol-Version` on every call), and, where the seam names the run, the
 * `negotiation.decided` event (`outcome: refused`, `reason: unauthenticated`).
 *
 * Driven through the §22/§23 invoke seams with `authenticated: false` and a
 * peer that offers only the lower era the suite can speak. When the host's
 * `preferredVersion` is already the lowest version the suite can offer there
 * is nothing lower to offer and the leg records `blocked`.
 *
 * Callback-shaped (the host calls the suite's peer): unwitnessable when the
 * host is in a separate network namespace — `../lib/host-callback.ts`.
 *
 * @see spec/v2/core/interop.md §Negotiation is a protocol
 * @see SECURITY/threat-model-interop.md (interop-negotiation-authenticated)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { A2AFakePeer } from '../lib/a2a-fake-peer.js';
import { McpFakeServer } from '../lib/mcp-fake-server.js';
import { softSkip, seamAbsent } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

export const REQUIRES_HOST_CALLBACK = "the host's A2A/MCP client calls a suite-owned peer offering only a lower version, under an unauthenticated principal";

const A2A_LOWER = '0.3';
const MCP_LOWER = '2025-06-18';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

interface EventRow { type?: unknown; payload?: Record<string, unknown> }
async function decidedEvents(runId: string): Promise<EventRow[]> {
  const res = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
  const events = res.status === 200 ? ((res.json as { events?: EventRow[] } | null)?.events ?? []) : [];
  return events.filter((e) => e.type === 'negotiation.decided');
}

async function assertNotLowered(id: string, preferred: string, lower: string, res: { status: number; json: unknown }, wireVersions: string[]): Promise<void> {
  if (res.status < 400) {
    const negotiated = (res.json as { negotiatedVersion?: unknown } | null)?.negotiatedVersion;
    expect(
      negotiated,
      req(id, 'interop.md §Authentication', `an unauthenticated exchange MUST NOT lower the version below preferredVersion (${preferred}) — the host reports ${String(negotiated)} (RFC 0175 §D.1)`),
    ).toBe(preferred);
  }
  for (const v of wireVersions) {
    expect(
      v,
      req(id, 'interop.md §Authentication', `the wire toward the peer MUST NOT carry the lower version (${lower}) under an unauthenticated exchange — captured ${v}`),
    ).not.toBe(lower);
  }
  const runId = (res.json as { runId?: unknown } | null)?.runId;
  if (typeof runId !== 'string') {
    softSkip('blocked', 'the seam answered without a runId — the negotiation.decided event for the unauthenticated exchange is not addressable from the suite');
    return;
  }
  const decided = await decidedEvents(runId);
  expect(decided.length, req(id, 'interop.md §The audit event', 'the unauthenticated exchange MUST also emit negotiation.decided (every outcome, RFC 0175 §D.3)')).toBeGreaterThan(0);
  const last = decided[decided.length - 1]!.payload ?? {};
  if (res.status >= 400) {
    expect(last['outcome'], req(id, 'run-event-payloads.schema.json negotiationDecided.outcome', 'a refused unauthenticated exchange records outcome: refused')).toBe('refused');
    expect(['unauthenticated', 'below-floor', 'unsupported'], req(id, 'run-event-payloads.schema.json negotiationDecided.reason', 'the reason names why (unauthenticated when the floor was not the cause)')).toContain(last['reason']);
  } else {
    expect(last['version'], req(id, 'interop.md §The audit event', 'an accepted unauthenticated exchange records the preferred version — nothing lower')).toBe(preferred);
  }
}

describe('RFC 0175 §D.1 — negotiation-authenticated (gated on a2a/mcp + seams)', () => {
  it('an unauthenticated A2A exchange cannot lower the version below preferredVersion', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const facet = await familyAdvertised('a2a');
    if (!facet) return softSkip('inapplicable', 'a2a facet not advertised — no negotiation to authenticate');
    if (!seamsProfileAdvertised(doc)) return softSkip('inapplicable', 'the unauthenticated exchange is driven through the seams profile — conformance.seamsProfile is not openwop-conformance-seams-v2');
    const preferred = String(facet['preferredVersion']);
    if (preferred === A2A_LOWER) return softSkip('blocked', `a2a.preferredVersion is ${preferred}, the lowest version the suite peer can offer — no lower version can be offered`);
    const peer = new A2AFakePeer({ protocolVersions: ['0.3'] });
    await peer.start();
    try {
      const res = await driver.post(`${SEAMS_PREFIX}/sample/a2a/invoke`, { peerUrl: peer.endpoint(), authenticated: false, peerOffersOnly: A2A_LOWER });
      if (res.status === 404 || res.status === 403 || res.status === 405) return seamAbsent(`host advertises a2a but ${SEAMS_PREFIX}/sample/a2a/invoke answered ${res.status} (host-sample-test-seams.md §22)`);
      const wire = peer.invocations().filter((i) => i.method !== 'GET').map((i) => String(i.headers['a2a-version'] ?? ''));
      await assertNotLowered('openwop.requirement.0175.negotiation-authenticated', preferred, A2A_LOWER, res, wire);
    } finally {
      await peer.stop();
    }
  });

  it('an unauthenticated MCP exchange cannot lower the revision below preferredVersion', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const facet = await familyAdvertised('mcp');
    if (!facet) return softSkip('inapplicable', 'mcp facet not advertised — no negotiation to authenticate');
    if (!seamsProfileAdvertised(doc)) return softSkip('blocked', 'the unauthenticated exchange is driven through the seams profile — conformance.seamsProfile is not openwop-conformance-seams-v2');
    const preferred = String(facet['preferredVersion']);
    if (!(MCP_LOWER < preferred)) return softSkip('blocked', `mcp.preferredVersion is ${preferred}, at or below the lowest revision the suite server can offer (${MCP_LOWER}) — no lower revision can be offered`);
    const server = new McpFakeServer({ protocolVersions: ['2025-06-18'] });
    await server.start();
    try {
      const res = await driver.post(`${SEAMS_PREFIX}/sample/mcp/invoke`, { serverUrl: server.endpoint(), authenticated: false });
      if (res.status === 404 || res.status === 403 || res.status === 405) return seamAbsent(`host advertises mcp but ${SEAMS_PREFIX}/sample/mcp/invoke answered ${res.status} (host-sample-test-seams.md §23)`);
      const wire = server.invocations().map((i) => String(i.headers['mcp-protocol-version'] ?? ''));
      await assertNotLowered('openwop.requirement.0175.negotiation-authenticated.mcp', preferred, MCP_LOWER, res, wire);
    } finally {
      await server.stop();
    }
  });
});
