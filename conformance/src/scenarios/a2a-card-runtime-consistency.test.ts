/**
 * RFC 0152 §C — Agent Card ↔ runtime consistency (invariant
 * `a2a-card-runtime-consistent`, named by RFC 0152 §E).
 *
 * `a2a-integration.md` §"A2A 1.0 versioned composition" §C: the card and
 * `capabilities.a2a` MUST be generated from the same source the runtime routes
 * on — the SET of `supportedInterfaces[].protocolVersion` MUST equal
 * `capabilities.a2a.protocolVersions`, `capabilities.streaming` /
 * `pushNotifications` MUST equal the discovery flags, the interface carrying
 * `preferredVersion` SHOULD be listed first, `skills[]` MUST be non-empty, and
 * a `a2a-1.0` host MUST serve the JSON-RPC binding at 1.0 (the mandatory floor).
 *
 * This is a BLACK-BOX leg against the host's own two documents — no peer, no
 * seam: `GET /.well-known/openwop` (`capabilities.a2a`) and
 * `GET <agentCardUrl>`. Two documents that describe one fact and disagree are
 * card/runtime drift, which is what the invariant forbids.
 *
 * Gate: `capabilities.a2a.profiles` contains `a2a-1.0`. Written against the
 * 1.0 card shape ONLY (per the host maintainers' explicit ask: do NOT
 * dual-shape it to pass on 0.3) — a 0.3-card host soft-skips here and records
 * `blocked`, and this leg becomes its witness the moment it flips the card.
 * Hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`.
 *
 * @see spec/v1/a2a-integration.md §"A2A 1.0 versioned composition" §C
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

const PROFILE = 'a2a-1.0';

interface A2ACaps {
  readonly supported?: boolean;
  readonly agentCardUrl?: string;
  readonly streaming?: boolean;
  readonly pushNotifications?: boolean;
  readonly protocolVersions?: readonly string[];
  readonly preferredVersion?: string;
  readonly profiles?: readonly string[];
}

interface Card10 {
  name?: string;
  description?: string;
  version?: string;
  supportedInterfaces?: Array<{ url?: string; protocolBinding?: string; protocolVersion?: string; tenant?: string }>;
  capabilities?: { streaming?: boolean; pushNotifications?: boolean; extensions?: unknown[]; extendedAgentCard?: boolean };
  skills?: Array<{ id?: string; name?: string }>;
  url?: unknown;
  protocolVersion?: unknown;
}

async function a2a(): Promise<A2ACaps | undefined> {
  const disco = await driver.get('/.well-known/openwop');
  return capabilityFamily<A2ACaps>(disco.json, 'a2a');
}

async function claims10(): Promise<boolean> {
  const caps = await a2a();
  return caps?.supported === true && (caps.profiles ?? []).includes('a2a-1.0');
}

async function fetchCard(caps: A2ACaps): Promise<Card10 | null> {
  if (typeof caps.agentCardUrl !== 'string') return null;
  const res = await fetch(caps.agentCardUrl, { headers: { accept: 'application/json' } });
  if (res.status !== 200) return null;
  return (await res.json()) as Card10;
}

describe('RFC 0152 §C — a2a-card-runtime-consistent (gated on a2a.profiles ∋ a2a-1.0)', () => {
  it('the card is 1.0-shaped and reachable at agentCardUrl', async () => {
    if (!behaviorGate(PROFILE, await claims10())) return;
    const caps = (await a2a())!;
    const card = await fetchCard(caps);
    expect(card, driver.describe('a2a-integration.md §C', '`agentCardUrl` MUST resolve to the Agent Card (200)')).not.toBeNull();
    expect(
      Array.isArray(card!.supportedInterfaces) && card!.supportedInterfaces!.length > 0,
      driver.describe('a2a-integration.md §C', 'a host claiming `a2a-1.0` MUST publish a 1.0 card: `supportedInterfaces[]` REQUIRED (≥1)'),
    ).toBe(true);
    expect(card!.url, driver.describe('a2a-integration.md §C', '1.0 removed the top-level `url` — a card with both shapes is neither')).toBeUndefined();
    expect(card!.protocolVersion, driver.describe('a2a-integration.md §C', '1.0 removed the top-level `protocolVersion` (per interface now)')).toBeUndefined();
    expect(Array.isArray(card!.skills) && card!.skills!.length > 0, driver.describe('a2a-integration.md §C', '`skills[]` MUST be non-empty — one per invocable workflow')).toBe(true);
  });

  it('the set of supportedInterfaces[].protocolVersion equals capabilities.a2a.protocolVersions', async () => {
    if (!behaviorGate(PROFILE, await claims10())) return;
    const caps = (await a2a())!;
    const card = await fetchCard(caps);
    if (card === null) return; // asserted above
    const fromCard = [...new Set((card.supportedInterfaces ?? []).map((i) => i.protocolVersion).filter((v): v is string => typeof v === 'string'))].sort();
    const fromDiscovery = [...new Set(caps.protocolVersions ?? [])].sort();
    expect(
      fromCard,
      driver.describe(
        'a2a-integration.md §C',
        'the SET of `supportedInterfaces[].protocolVersion` MUST equal `capabilities.a2a.protocolVersions` — two documents, one fact; ' +
          'a version advertised in one and not the other is card/runtime drift (`a2a-card-runtime-consistent`)',
      ),
    ).toEqual(fromDiscovery);
  });

  it('a2a-1.0 MUST serve the JSON-RPC binding at 1.0 (the mandatory floor), and SHOULD list the preferred interface first', async () => {
    if (!behaviorGate(PROFILE, await claims10())) return;
    const caps = (await a2a())!;
    const card = await fetchCard(caps);
    if (card === null) return;
    const ifaces = card.supportedInterfaces ?? [];
    expect(
      ifaces.some((i) => i.protocolBinding === 'JSONRPC' && i.protocolVersion === '1.0' && typeof i.url === 'string'),
      driver.describe('a2a-integration.md §C', 'the `a2a-1.0` profile floor is the JSON-RPC binding at 1.0; HTTP+JSON / gRPC are optional additions'),
    ).toBe(true);
    for (const i of ifaces) {
      expect(['JSONRPC', 'GRPC', 'HTTP+JSON'], driver.describe('a2a-integration.md §C', 'protocolBinding uses the upstream binding names')).toContain(i.protocolBinding);
    }
    if (typeof caps.preferredVersion === 'string' && ifaces.length > 0) {
      // SHOULD, so a soft expectation: report, do not fail.
      if (ifaces[0]?.protocolVersion !== caps.preferredVersion) {
        // eslint-disable-next-line no-console
        console.warn(`[a2a-card-runtime-consistency] SHOULD: the interface carrying preferredVersion (${caps.preferredVersion}) is not listed first`);
      }
    }
  });

  it('card capabilities.streaming / pushNotifications equal the discovery flags', async () => {
    if (!behaviorGate(PROFILE, await claims10())) return;
    const caps = (await a2a())!;
    const card = await fetchCard(caps);
    if (card === null) return;
    expect(
      card.capabilities?.streaming === true,
      driver.describe('a2a-integration.md §C', '`capabilities.streaming` on the card MUST equal `capabilities.a2a.streaming` on discovery'),
    ).toBe(caps.streaming === true);
    expect(
      card.capabilities?.pushNotifications === true,
      driver.describe('a2a-integration.md §C', '`capabilities.pushNotifications` on the card MUST equal `capabilities.a2a.pushNotifications`'),
    ).toBe(caps.pushNotifications === true);
  });
});
