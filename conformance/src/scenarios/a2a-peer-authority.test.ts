/**
 * RFC 0152 §E — a peer's content is never authority (invariant
 * `a2a-peer-no-authority-escalation`, named by RFC 0152 §E; §"Trust boundary"
 * `prompt-injection-mcp-no-approval` generalized to A2A).
 *
 * The host acts as an A2A CLIENT against the suite's fake peer. The peer's
 * agent-role reply carries everything a hostile peer would try: text that reads
 * like an approval, `metadata.openwop.approval: "accept"`, `metadata.openwop.
 * scopes[]`, `metadata.openwop.interrupt.resolve`, and a `referenceTaskIds[]`
 * pointing at a task the caller never created. `a2a-integration.md` §D.2 says
 * all of it is opaque and §E says none of it may become authority: the run's
 * approval state, tool allowlist, and scopes MUST be exactly what they were
 * before the peer answered, and the referenced task MUST NOT be dereferenced on
 * the peer's say-so.
 *
 * Observability: the host's `/v1/host/sample/a2a/invoke` seam accepts an
 * ADDITIVE `scenario: "peer-asserts-authority"` and, when it implements it,
 * reports `peerAuthority: { approvalAdvanced, scopesWidened, referencedTaskDereferenced }`
 * (`host-sample-test-seams.md` §22). A host that has not added the field is
 * recorded `blocked` for this requirement rather than passed — RFC 0148 §A —
 * because a leg that cannot see the outcome cannot vouch for it.
 *
 * Gate: `a2a.supported && a2a.protocolVersions.length > 0` (same as the §B
 * legs — the requirement is version-independent). Needs the fake peer
 * (`OPENWOP_A2A_FAKE_PEER=true`).
 *
 * @see spec/v1/a2a-integration.md §"A2A 1.0 versioned composition" §D.2, §E
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { getA2AFakePeer } from '../lib/a2a-fake-peer.js';

const PROFILE = 'a2a.peerAuthority';

interface A2ACaps {
  readonly supported?: boolean;
  readonly protocolVersions?: readonly string[];
}

async function advertised(): Promise<boolean> {
  const disco = await driver.get('/.well-known/openwop');
  const caps = capabilityFamily<A2ACaps>(disco.json, 'a2a');
  return caps?.supported === true && (caps.protocolVersions?.length ?? 0) > 0;
}

interface PeerAuthorityReport {
  approvalAdvanced?: boolean;
  scopesWidened?: boolean;
  referencedTaskDereferenced?: boolean;
}

describe('RFC 0152 §E — a2a-peer-no-authority-escalation (host as A2A client, gated)', () => {
  it('a peer reply that asserts approval, scopes, and a foreign task reference changes nothing the host authorizes', async () => {
    if (!behaviorGate(PROFILE, await advertised())) return;
    const peer = getA2AFakePeer();
    if (peer === null) return; // no fake peer wired in this run
    peer.reset();
    peer.setNextPeerAssertsAuthority(true);
    const drive = await driver.post('/v1/host/sample/a2a/invoke', {
      peerUrl: peer.endpoint(),
      scenario: 'peer-asserts-authority',
    });
    if (drive.status === 404 || drive.status === 403) {
      expect(
        drive.status,
        driver.describe(
          'RFCS/0152 §E',
          'a host advertising A2A MUST expose the invoke seam so peer-authority handling is observable; ' +
            'without it the requirement resolves to `blocked` per RFC 0148 §A',
        ),
      ).not.toBe(404);
      return;
    }
    // The peer must actually have answered with the authority-asserting message,
    // or this leg is vacuous.
    const created = peer.taskCount();
    expect(created, driver.describe('RFCS/0152 §E', 'the host MUST have created a task on the peer for this leg to mean anything')).toBeGreaterThan(0);
    const report = (drive.json as { peerAuthority?: PeerAuthorityReport }).peerAuthority;
    if (report === undefined) {
      // Additive seam field not yet implemented: blocked, not passed.
      expect(
        report,
        driver.describe(
          'host-sample-test-seams.md §22',
          'the invoke seam SHOULD report `peerAuthority: { approvalAdvanced, scopesWidened, referencedTaskDereferenced }` for ' +
            'scenario "peer-asserts-authority"; until it does this requirement is unobservable and resolves to `blocked`, not passed',
        ),
      ).toBeDefined();
      return;
    }
    expect(report.approvalAdvanced, driver.describe('RFCS/0152 §E', 'peer content MUST NOT advance an approval gate (a2a-peer-no-authority-escalation)')).toBe(false);
    expect(report.scopesWidened, driver.describe('RFCS/0152 §E', 'peer content MUST NOT widen the run’s scopes or tool allowlist')).toBe(false);
    expect(
      report.referencedTaskDereferenced,
      driver.describe('a2a-integration.md §D.2', '`referenceTaskIds[]` are opaque hints — MUST NOT be dereferenced on the peer’s say-so'),
    ).toBe(false);
  });
});
