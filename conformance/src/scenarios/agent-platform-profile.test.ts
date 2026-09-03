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
 * The LIVE aggregate-evidence assertion (the §C honest-advertisement rule on a
 * host claiming `openwop-agent-platform`) is the `Active → Accepted` step per RFC
 * 0085 §C — capability-gated, server-requiring, and lives in the sibling
 * `agent-platform-aggregate-evidence.test.ts`. THIS scenario asserts the
 * discovery-predicate derivation only (always-on, server-free).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-platform-profile.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0085-agent-platform-meta-profile.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { isAgentPlatformPartial, isAgentPlatformFull, agentPlatformStatus, agentPlatformSatisfiedTerms } from '../lib/profiles.js';
import { req } from '../lib/requirement-ids.js';

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
    expect(isAgentPlatformPartial(c), req('openwop.it.agent-platform-profile.a-host-meeting-all-floor-flags-is-partial', 'agent-platform-profile.md §B', 'all floor flags ⇒ partial')).toBe(true);
    expect(agentPlatformStatus(c), req('openwop.it.agent-platform-profile.a-host-meeting-all-floor-flags-is-partial', 'RFC 0085', 'a host meeting all floor flags is partial')).toBe('partial');
  });

  it('missing a single floor flag (feedback) ⇒ none', () => {
    const c = floorPayload({ feedback: { supported: false } });
    expect(isAgentPlatformPartial(c), req('openwop.it.agent-platform-profile.missing-a-single-floor-flag-feedback-none', 'agent-platform-profile.md §B', 'a missing floor flag ⇒ not partial')).toBe(false);
    expect(agentPlatformStatus(c), req('openwop.it.agent-platform-profile.missing-a-single-floor-flag-feedback-none', 'RFC 0085', 'missing a single floor flag (feedback) ⇒ none')).toBe('none');
  });

  it('replay-OR-nondeterminism: no replay but declared nondeterminism still meets the floor', () => {
    const c = floorPayload({ replay: { supported: false }, nondeterminismPolicy: { declared: true } });
    expect(isAgentPlatformPartial(c), req('openwop.it.agent-platform-profile.replay-or-nondeterminism-no-replay-but-declared-nondeterminism-still-meets-the-f', 'agent-platform-profile.md §B', 'declared nondeterminism satisfies the replay-OR term')).toBe(true);
  });

  it('neither replay nor declared nondeterminism ⇒ floor unmet', () => {
    const c = floorPayload({ replay: { supported: false } });
    expect(isAgentPlatformPartial(c), req('openwop.it.agent-platform-profile.neither-replay-nor-declared-nondeterminism-floor-unmet', 'agent-platform-profile.md §B', 'neither replay nor declared policy ⇒ not partial')).toBe(false);
  });
});

describe('agent-platform-profile: full predicate + honest-advertisement (RFC 0085 §B/§D, server-free)', () => {
  const fullExtra = {
    authorization: { supported: true },
    agents: { manifestRuntime: { supported: true, installScope: 'tenant' }, liveRuntime: { supported: true } },
    memory: { supported: true, attribution: { supported: true } },
    debugBundle: { supported: true },
    triggerBridge: { supported: true },
    httpClient: { safeFetch: { supported: true }, egressPolicy: { supported: true } },
  };

  it('a host meeting floor + all governance terms is full', () => {
    const c = floorPayload(fullExtra);
    expect(isAgentPlatformFull(c), req('openwop.it.agent-platform-profile.a-host-meeting-floor-all-governance-terms-is-full', 'agent-platform-profile.md §B', 'floor + governance ⇒ full')).toBe(true);
    expect(agentPlatformStatus(c), req('openwop.it.agent-platform-profile.a-host-meeting-floor-all-governance-terms-is-full', 'RFC 0085', 'a host meeting floor + all governance terms is full')).toBe('full');
  });

  it('a host advertising governance flags but missing tenant installScope reports partial, not full', () => {
    const c = floorPayload({
      ...fullExtra,
      agents: { manifestRuntime: { supported: true, installScope: 'host' }, liveRuntime: { supported: true } },
    });
    expect(isAgentPlatformFull(c), req('openwop.it.agent-platform-profile.a-host-advertising-governance-flags-but-missing-tenant-installscope-reports-part', 'agent-platform-profile.md §D', 'missing a governance term ⇒ MUST NOT be full')).toBe(false);
    expect(agentPlatformStatus(c), req('openwop.it.agent-platform-profile.a-host-advertising-governance-flags-but-missing-tenant-installscope-reports-part', 'RFC 0085', 'a host advertising governance flags but missing tenant installScope reports partial, not full')).toBe('partial');
  });

  it('eval/deploy/budget are NOT hard full terms (a full host without them is still full)', () => {
    const c = floorPayload(fullExtra); // no agents.evalSuite / agents.deployment / budget
    expect(isAgentPlatformFull(c), req('openwop.it.agent-platform-profile.eval-deploy-budget-are-not-hard-full-terms-a-full-host-without-them-is-still-ful', 'agent-platform-profile.md §B', 'platform-plus tier is advisory, not a hard full term')).toBe(true);
  });
});

describe('agent-platform-profile: satisfiedTerms[] non-contiguous adoption (RFC 0085 §D, server-free)', () => {
  it('a host honoring full-tier terms but failing floor terms is status none yet has a non-empty satisfiedTerms[]', () => {
    // The real-host (MyndHyve) shape: RBAC + memory.attribution + tenant installScope (3 full terms)
    // satisfied, while liveRuntime / toolCatalog / providerUsage / memory floor terms are absent.
    const c = {
      ...CORE,
      agents: { manifestRuntime: { supported: true, installScope: 'tenant' } }, // no liveRuntime
      authorization: { supported: true },
      memory: { attribution: { supported: true } }, // attribution but NOT memory.supported
      toolHooks: { supported: true },
      httpClient: { safeFetch: { supported: true } },
      prompts: { supported: true },
      feedback: { supported: true },
      replay: { supported: true },
    } as Record<string, unknown>;
    expect(agentPlatformStatus(c), req('openwop.it.agent-platform-profile.a-host-honoring-full-tier-terms-but-failing-floor-terms-is-status-none-yet-has-a', 'agent-platform-profile.md §D', 'floor unmet ⇒ none')).toBe('none');
    const terms = agentPlatformSatisfiedTerms(c);
    expect(terms.includes('full:authorization'), req('openwop.it.agent-platform-profile.a-host-honoring-full-tier-terms-but-failing-floor-terms-is-status-none-yet-has-a', '§D', 'a satisfied full term is reported even at none')).toBe(true);
    expect(terms.includes('full:memory.attribution'), req('openwop.it.agent-platform-profile.a-host-honoring-full-tier-terms-but-failing-floor-terms-is-status-none-yet-has-a', 'RFC 0085', 'a host honoring full-tier terms but failing floor terms is status none yet has a non-empty satisfiedTerms[]')).toBe(true);
    expect(terms.includes('full:tenant-installScope')).toBe(true);
    expect(terms.includes('floor:agents.liveRuntime'), req('openwop.it.agent-platform-profile.a-host-honoring-full-tier-terms-but-failing-floor-terms-is-status-none-yet-has-a', '§D', 'an unmet floor term is NOT reported')).toBe(false);
    expect(terms.length).toBeGreaterThan(0); // distinguishable from a 0/16 do-nothing host
  });

  it('a full host reports all sixteen terms satisfied', () => {
    const c = floorPayload({
      authorization: { supported: true },
      agents: { manifestRuntime: { supported: true, installScope: 'tenant' }, liveRuntime: { supported: true } },
      memory: { supported: true, attribution: { supported: true } },
      debugBundle: { supported: true },
      triggerBridge: { supported: true },
      httpClient: { safeFetch: { supported: true }, egressPolicy: { supported: true } },
    });
    expect(agentPlatformSatisfiedTerms(c).length, req('openwop.it.agent-platform-profile.a-full-host-reports-all-sixteen-terms-satisfied', '§D', 'a full host satisfies all 16 terms')).toBe(16);
  });
});

describe('agent-platform-profile: capability shape (RFC 0085, server-free)', () => {
  it('capabilities.nondeterminismPolicy.declared is declared', () => {
    const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8')) as { properties?: Record<string, { properties?: Record<string, unknown> }> };
    expect(
      caps.properties?.nondeterminismPolicy?.properties?.declared,
      req('openwop.it.agent-platform-profile.capabilities-nondeterminismpolicy-declared-is-declared', 'agent-platform-profile.md §B', 'capabilities.nondeterminismPolicy.declared MUST be declared'),
    ).toBeDefined();
  });
});
