/**
 * RFC 0153 §A/§B — MCP revision negotiation, witnessed against the fake server.
 *
 * The companion to `a2a-version-negotiation.test.ts`, and it exists for the same
 * reason: `McpFakeServer` recorded the JSON-RPC method, params, and timestamp
 * but **not headers** — while MCP's revision is negotiated in
 * `MCP-Protocol-Version`. A recorder that captures only the body can see that a
 * call happened and not which revision it was made under, which is the whole of
 * what §B governs.
 *
 * **Both fake peers had the identical gap**, which is the part worth keeping:
 * it was not an oversight in one file but a shared assumption that the
 * interesting part of a call is its body. Version negotiation is the case where
 * that assumption is exactly wrong.
 *
 * MCP revisions are **dates**, and that shapes the assertions. A host that sends
 * `2026-7-28` or `latest` has sent something no peer can match against a pinned
 * revision, and the failure surfaces at the peer rather than at the handshake
 * meant to prevent it. So the header is checked for date form, not merely for
 * presence.
 *
 * `Pinned real MCP current peer passes in CI` stays separate and unmet — that
 * item tests interoperation, which no fake stands in for, and RFC 0153's
 * acceptance criteria still say so.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { getMcpFakeServer } from '../lib/mcp-fake-server.js';

const PROFILE = 'mcp.versionNegotiation';
const DATE_FORM = /^\d{4}-\d{2}-\d{2}$/;

interface McpCaps {
  readonly supported?: boolean;
  readonly protocolVersions?: readonly string[];
  readonly preferredVersion?: string;
  readonly features?: readonly string[];
}

async function mcp(): Promise<McpCaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<McpCaps>(disco.json, 'mcp');
}

async function negotiationAdvertised(): Promise<boolean> {
  const caps = await mcp();
  return caps?.supported === true && (caps.protocolVersions?.length ?? 0) > 0;
}

describe('RFC 0153 §A/§B — MCP revision negotiation', () => {
  it('advertised revisions use MCP date form and include the preferred one', async () => {
    if (!behaviorGate(PROFILE, await negotiationAdvertised())) return;
    const caps = await mcp();
    for (const v of caps?.protocolVersions ?? []) {
      expect(
        DATE_FORM.test(v),
        driver.describe(
          'RFCS/0153-mcp-2026-07-28-versioned-composition.md §A',
          `'${v}' is not MCP's date form. MCP revisions ARE dates, and 'latest' or an unpadded ` +
            'month lets two hosts disagree about which revision they share while both look valid.',
        ),
      ).toBe(true);
    }
    expect(
      caps?.protocolVersions ?? [],
      driver.describe('RFCS/0153 §A', '`preferredVersion` MUST be one the host actually lists'),
    ).toContain(caps?.preferredVersion);
  });

  it('outbound calls carry MCP-Protocol-Version in date form', async () => {
    if (!behaviorGate(PROFILE, await negotiationAdvertised())) return;
    const server = getMcpFakeServer();
    if (server === null) return;
    server.reset();
    const drive = await driver.post('/v1/host/sample/mcp/invoke', { serverUrl: server.endpoint() });
    if (drive.status === 404 || drive.status === 403) {
      expect(
        drive.status,
        driver.describe(
          'RFCS/0153 §B',
          'a host advertising MCP revisions MUST expose an invoke seam so the negotiated revision ' +
            'is observable. Without it the requirement resolves to `blocked` per RFC 0148 §A — not ' +
            'to a pass.',
        ),
      ).not.toBe(404);
      return;
    }
    const calls = server.invocations();
    expect(calls.length, 'the host MUST have called the server').toBeGreaterThan(0);
    for (const c of calls) {
      const v = c.headers['mcp-protocol-version'];
      expect(
        v,
        driver.describe('RFCS/0153 §A', 'every MCP call MUST declare its revision'),
      ).toBeTruthy();
      expect(
        DATE_FORM.test(v ?? ''),
        driver.describe(
          'RFCS/0153 §A',
          `the revision on the wire MUST be MCP's date form; got '${v}'. A malformed revision is ` +
            'unmatchable against a pinned peer, and the failure then surfaces at the peer rather ' +
            'than at the handshake meant to prevent it.',
        ),
      ).toBe(true);
    }
  });

  it('the negotiated revision is one the host advertises', async () => {
    if (!behaviorGate(PROFILE, await negotiationAdvertised())) return;
    const server = getMcpFakeServer();
    if (server === null) return;
    const caps = await mcp();
    server.reset();
    const drive = await driver.post('/v1/host/sample/mcp/invoke', { serverUrl: server.endpoint() });
    if (drive.status === 404 || drive.status === 403) return;
    // Discovery is a promise about behavior. A host that negotiates a revision
    // it never advertised has made its own discovery document unreliable, which
    // is worse than advertising nothing — a consumer that read it made a
    // decision on a fact that was not true.
    for (const c of server.invocations()) {
      expect(
        caps?.protocolVersions ?? [],
        driver.describe(
          'RFCS/0153 §A/§B',
          'the revision sent on the wire MUST appear in `protocolVersions`. Negotiating an ' +
            'unadvertised revision makes the discovery document unreliable for every consumer ' +
            'that read it.',
        ),
      ).toContain(c.headers['mcp-protocol-version']);
    }
  });

  it('an unsupported revision fails through the canonical interop envelope', async () => {
    if (!behaviorGate(PROFILE, await negotiationAdvertised())) return;
    const server = getMcpFakeServer();
    if (server === null) return;
    const drive = await driver.post('/v1/host/sample/mcp/invoke', {
      serverUrl: server.endpoint(),
      requestVersion: '1999-01-01',
    });
    if (drive.status === 404 || drive.status === 403) return;
    expect(
      drive.status >= 400,
      driver.describe('RFCS/0153 §B', 'an unsupported revision MUST fail rather than silently proceed'),
    ).toBe(true);
    expect(
      (drive.json as { error?: { code?: string } }).error?.code,
      driver.describe(
        'RFCS/0153 §B',
        'the upstream error MUST be projected through the canonical OpenWOP interop envelope — a ' +
          'raw JSON-RPC error body leaves the caller parsing a foreign protocol to learn its own ' +
          'request was rejected',
      ),
    ).toBeTruthy();
  });
});
