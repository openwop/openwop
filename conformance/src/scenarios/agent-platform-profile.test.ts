/**
 * openwop-agent-platform — operational-annex predicate + status derivation (RFC 0085).
 *
 * Always-on, server-free derivation probe. Verifies that:
 *   - `isAgentPlatformPartial` / `isAgentPlatformFull` / `agentPlatformStatus`
 *     derive `none` / `partial` / `full` correctly from representative discovery
 *     payloads (RFC 0085 §B).
 *   - the floor's replay-OR-nondeterminism term is honored: a host with no
 *     `replay.supported` but `nondeterminismPolicy.declared: true` still meets the
 *     floor.
 *   - the `full` tier requires the governance terms (RBAC + tenant installScope +
 *     memory.attribution + debug-bundle + trigger-bridge + egress-policy); a host
 *     missing any reports `partial`, never `full` (the honest-advertisement rule).
 *   - `capabilities.nondeterminismPolicy.declared` is declared in the schema.
 *
 * The LIVE aggregate-evidence assertion (does every required constituent scenario
 * actually pass against a host claiming `full`?) is the `Active → Accepted` step
 * per RFC 0085 §C — naturally gated on a reference host reaching partial/full, and
 * deferred here. This scenario asserts the discovery-predicate derivation only.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-platform-profile.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0085-agent-platform-meta-profile.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { isAgentPlatformPartial, isAgentPlatformFull, agentPlatformStatus } from '../lib/profiles.js';

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

const CORE = {
  protocolVersion: '1.0',
  supportedEnvelopes: ['clarification.request'],
  schemaVersions: {},
  limits: { clarificationRounds: 1, schemaRounds: 1, envelopesPerTurn: 1 },
};

/** A discovery payload meeting the §B floor (partial). */
function floorPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...CORE,
    agents: { manifestRuntime: { supported: true }, liveRuntime: { supported: true } },
    toolCatalog: { supported: true },
    toolHooks: { supported: true },
    httpClient: { safeFetch: { supported: true } },
    providerUsage: { supported: true },
    prompts: { supported: true },
    memory: { supported: true },
    feedback: { supported: true },
    replay: { supported: true },
    ...extra,
  };
}

describe('agent-platform-profile: floor (partial) predicate (RFC 0085 §B, server-free)', () => {
  it('a host meeting all floor flags is partial', () => {
    const c = floorPayload();
    expect(isAgentPlatformPartial(c), why('agent-platform-profile.md §B', 'all floor flags ⇒ partial')).toBe(true);
    expect(agentPlatformStatus(c)).toBe('partial');
  });

  it('missing a single floor flag (feedback) ⇒ none', () => {
    const c = floorPayload({ feedback: { supported: false } });
    expect(isAgentPlatformPartial(c), why('agent-platform-profile.md §B', 'a missing floor flag ⇒ not partial')).toBe(false);
    expect(agentPlatformStatus(c)).toBe('none');
  });

  it('replay-OR-nondeterminism: no replay but declared nondeterminism still meets the floor', () => {
    const c = floorPayload({ replay: { supported: false }, nondeterminismPolicy: { declared: true } });
    expect(isAgentPlatformPartial(c), why('agent-platform-profile.md §B', 'declared nondeterminism satisfies the replay-OR term')).toBe(true);
  });

  it('neither replay nor declared nondeterminism ⇒ floor unmet', () => {
    const c = floorPayload({ replay: { supported: false } });
    expect(isAgentPlatformPartial(c), why('agent-platform-profile.md §B', 'neither replay nor declared policy ⇒ not partial')).toBe(false);
  });
});

describe('agent-platform-profile: full predicate + honest-advertisement (RFC 0085 §B/§D, server-free)', () => {
  const fullExtra = {
    authorization: { supported: true },
    agents: { manifestRuntime: { supported: true, installScope: 'tenant' }, liveRuntime: { supported: true } },
    memory: { supported: true, attribution: { supported: true } },
    production: { debugBundleSupported: true },
    triggerBridge: { supported: true },
    httpClient: { safeFetch: { supported: true }, egressPolicy: { supported: true } },
  };

  it('a host meeting floor + all governance terms is full', () => {
    const c = floorPayload(fullExtra);
    expect(isAgentPlatformFull(c), why('agent-platform-profile.md §B', 'floor + governance ⇒ full')).toBe(true);
    expect(agentPlatformStatus(c)).toBe('full');
  });

  it('a host advertising governance flags but missing tenant installScope reports partial, not full', () => {
    const c = floorPayload({
      ...fullExtra,
      agents: { manifestRuntime: { supported: true, installScope: 'host' }, liveRuntime: { supported: true } },
    });
    expect(isAgentPlatformFull(c), why('agent-platform-profile.md §D', 'missing a governance term ⇒ MUST NOT be full')).toBe(false);
    expect(agentPlatformStatus(c)).toBe('partial');
  });

  it('eval/deploy/budget are NOT hard full terms (a full host without them is still full)', () => {
    const c = floorPayload(fullExtra); // no agents.evalSuite / agents.deployment / budget
    expect(isAgentPlatformFull(c), why('agent-platform-profile.md §B', 'platform-plus tier is advisory, not a hard full term')).toBe(true);
  });
});

describe('agent-platform-profile: capability shape (RFC 0085, server-free)', () => {
  it('capabilities.nondeterminismPolicy.declared is declared', () => {
    const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8')) as { properties?: Record<string, { properties?: Record<string, unknown> }> };
    expect(
      caps.properties?.nondeterminismPolicy?.properties?.declared,
      why('agent-platform-profile.md §B', 'capabilities.nondeterminismPolicy.declared MUST be declared'),
    ).toBeDefined();
  });
});
