/**
 * openwop-agent-platform — LIVE aggregate-evidence (RFC 0085 §C) — behavioral.
 *
 * The `Active → Accepted` bar for the meta-profile. Capability-gated on a host
 * CLAIMING the operational annex — i.e. its live discovery `profiles[]` includes
 * `openwop-agent-platform`. Soft-skips when unclaimed (default) / hard-fails
 * under `OPENWOP_REQUIRE_BEHAVIOR=true`.
 *
 * The always-on derivation legs in `agent-platform-profile.test.ts` prove the
 * §B predicate logic against synthetic payloads; THIS asserts the §C/§D
 * honest-advertisement rule against the LIVE discovery doc: a host MAY advertise
 * `openwop-agent-platform` only if its real wire satisfies the §B floor
 * predicate — the platform claim is **backed by** the per-capability evidence
 * (each constituent cap's gated scenario — agent-manifest-runtime,
 * agent-live-*, tool-catalog/hooks, safe-fetch, provider-usage, prompts, memory,
 * feedback, replay, + the governance scenarios — runs in this same suite run and
 * must pass), never asserted on the profile string alone.
 *
 * When the operator declares the cert tier `full`
 * (`OPENWOP_AGENT_PLATFORM_TIER=full`), the full predicate (all governance terms
 * + tenant installScope) MUST hold non-vacuously.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-platform-profile.md (§C/§D)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0085-agent-platform-meta-profile.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isAgentPlatformPartial, isAgentPlatformFull, agentPlatformStatus, agentPlatformSatisfiedTerms } from '../lib/profiles.js';

describe('agent-platform-aggregate-evidence (RFC 0085 §C)', () => {
  it('a host claiming openwop-agent-platform satisfies the §B floor on live discovery; full when the operator certifies full', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    const disco = (res.status === 200 ? res.json : null) as Record<string, unknown> | null;
    const profiles = Array.isArray(disco?.profiles) ? (disco!.profiles as unknown[]) : [];
    const claims = disco !== null && profiles.includes('openwop-agent-platform');
    if (!behaviorGate('openwop-agent-platform', claims)) return;

    // §C / §D honest-advertisement: the profile claim MUST be backed by the §B
    // floor predicate holding on the live discovery payload — never asserted on
    // the profile string alone.
    expect(
      isAgentPlatformPartial(disco!),
      driver.describe('agent-platform-profile.md §C', 'claiming openwop-agent-platform MUST satisfy the §B floor predicate on live discovery (claim backed by per-capability evidence)'),
    ).toBe(true);

    const status = agentPlatformStatus(disco!);
    expect(
      status === 'partial' || status === 'full',
      driver.describe('agent-platform-profile.md §D', 'a claimed openwop-agent-platform host MUST derive to partial or full, never none'),
    ).toBe(true);

    // Non-vacuous FULL bar: when the operator declares the cert tier `full`,
    // every governance term + tenant installScope MUST hold + all 16 §D terms.
    if (process.env.OPENWOP_AGENT_PLATFORM_TIER === 'full') {
      expect(
        isAgentPlatformFull(disco!),
        driver.describe('agent-platform-profile.md §B/§D', 'a host certifying `full` MUST satisfy every governance term: authorization + tenant installScope + memory.attribution + debugBundle + triggerBridge + httpClient.egressPolicy'),
      ).toBe(true);
      expect(
        agentPlatformSatisfiedTerms(disco!).length,
        driver.describe('agent-platform-profile.md §D', 'a host certifying `full` satisfies all 16 §D terms'),
      ).toBe(16);
    }
  });
});
