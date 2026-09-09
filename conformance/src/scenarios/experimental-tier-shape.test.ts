/**
 * experimental-tier-shape — RFC 0042 §A + §B + §D advertisement-shape probes.
 *
 * RFC 0042 lands the audit's "Active RFC → experimental carve-out" pattern as
 * an optional `tier ∈ {"stable", "experimental"}` field on capability
 * advertisements, paired with a required `experimentalUntil` ISO-8601 sunset
 * date when `tier === "experimental"`. This scenario asserts:
 *
 *   1. Schema discipline: when `multiAgent.executionModel` advertises `tier:
 *      "experimental"`, `experimentalUntil` MUST be present + match
 *      `YYYY-MM-DD` + be ≤ 365 days in the future.
 *   2. Default-mode soft-skip routing: scenarios consuming
 *      `experimentalGate()` honor the tier — the helper returns `false`
 *      under default mode for `tier: "experimental"` capabilities so the
 *      scenario soft-skips with a dedicated log line.
 *   3. Sunset detection: a host advertising `experimentalUntil` in the
 *      past MUST fail discovery validation (host responsibility — the
 *      conformance probe simply asserts that the date format and bound
 *      hold for hosts that DO advertise correctly).
 *
 * The scenario lives at three describe levels per the RFC 0042 §D
 * "Conformance suite changes" contract.
 *
 * @see RFCS/0042-experimental-capability-tier.md
 * @see schemas/capabilities.schema.json §multiAgent.executionModel.tier
 * @see conformance/src/lib/behavior-gate.ts experimentalGate()
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { experimentalGate } from '../lib/behavior-gate.js';
import { __resetEnvCacheForTests } from '../lib/env.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    multiAgent?: {
      executionModel?: {
        supported?: unknown;
        tier?: unknown;
        experimentalUntil?: unknown;
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

describe.skipIf(HTTP_SKIP)('experimental-tier-shape: §A schema discipline (RFC 0042 §A)', () => {
  it('multiAgent.executionModel.tier (when present) MUST be one of {stable, experimental}', async (ctx) => {
    const d = await readDiscovery();
    const em = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel;
    if (em === undefined) {
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `em === undefined` returned early (seam, prior step, or fixture unavailable)');
    }
    if (em.tier === undefined) {
      ctx.skip(); // tier is optional with default 'stable'
      return softSkip('blocked', 'precondition not met — `em.tier === undefined` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(
      em.tier === 'stable' || em.tier === 'experimental',
      req('openwop.it.experimental-tier-shape.multiagent-executionmodel-tier-when-present-must-be-one-of-stable-experimental', 
        'RFCS/0042-experimental-capability-tier.md §A',
        'multiAgent.executionModel.tier MUST be one of the canonical enum values',
      ),
    ).toBe(true);
  });

  it('when tier === "experimental", experimentalUntil MUST be present + valid date', async (ctx) => {
    const d = await readDiscovery();
    const em = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel;
    if (em === undefined || em.tier !== 'experimental') {
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `em === undefined || em.tier !== \'experimental\'` returned early (seam, prior step, or fixture unavailable)');
    }

    expect(
      typeof em.experimentalUntil,
      req('openwop.it.experimental-tier-shape.when-tier-experimental-experimentaluntil-must-be-present-valid-date', 
        'RFCS/0042-experimental-capability-tier.md §B',
        'when tier is "experimental", experimentalUntil MUST be present (the §B sunset-rule contract)',
      ),
    ).toBe('string');

    const dateStr = em.experimentalUntil as string;
    expect(
      /^\d{4}-\d{2}-\d{2}$/.test(dateStr),
      req('openwop.it.experimental-tier-shape.when-tier-experimental-experimentaluntil-must-be-present-valid-date', 
        'RFCS/0042-experimental-capability-tier.md §B',
        'experimentalUntil MUST match YYYY-MM-DD',
      ),
    ).toBe(true);

    const parsed = new Date(dateStr + 'T00:00:00Z');
    expect(
      !Number.isNaN(parsed.getTime()),
      req('openwop.it.experimental-tier-shape.when-tier-experimental-experimentaluntil-must-be-present-valid-date', 
        'RFCS/0042-experimental-capability-tier.md §B',
        'experimentalUntil MUST parse as a valid ISO-8601 date',
      ),
    ).toBe(true);
  });

  it('experimentalUntil MUST be ≤ 365 days in the future (sunset bound)', async (ctx) => {
    const d = await readDiscovery();
    const em = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel;
    if (em === undefined || em.tier !== 'experimental') {
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `em === undefined || em.tier !== \'experimental\'` returned early (seam, prior step, or fixture unavailable)');
    }
    if (typeof em.experimentalUntil !== 'string') {
      ctx.skip(); // shape probe above will fail; don't double-fail
      return softSkip('blocked', 'precondition not met — `typeof em.experimentalUntil !== \'string\'` returned early (seam, prior step, or fixture unavailable)');
    }
    const target = new Date((em.experimentalUntil as string) + 'T00:00:00Z').getTime();
    const now = Date.now();
    const daysAhead = (target - now) / (1000 * 60 * 60 * 24);
    expect(
      daysAhead <= 365,
      req('openwop.it.experimental-tier-shape.experimentaluntil-must-be-365-days-in-the-future-sunset-bound', 
        'RFCS/0042-experimental-capability-tier.md §B',
        `experimentalUntil MUST be ≤ 365 days from now (got ${Math.floor(daysAhead)} days; advertised ${em.experimentalUntil})`,
      ),
    ).toBe(true);
  });

  it('sunset detection: experimentalUntil in the past is non-conformant', async (ctx) => {
    const d = await readDiscovery();
    const em = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel;
    if (em === undefined || em.tier !== 'experimental') {
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `em === undefined || em.tier !== \'experimental\'` returned early (seam, prior step, or fixture unavailable)');
    }
    if (typeof em.experimentalUntil !== 'string') {
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `typeof em.experimentalUntil !== \'string\'` returned early (seam, prior step, or fixture unavailable)');
    }
    const target = new Date((em.experimentalUntil as string) + 'T00:00:00Z').getTime();
    const now = Date.now();
    expect(
      target >= now,
      req('openwop.it.experimental-tier-shape.sunset-detection-experimentaluntil-in-the-past-is-non-conformant', 
        'RFCS/0042-experimental-capability-tier.md §B',
        `experimentalUntil MUST NOT be in the past (advertised ${em.experimentalUntil}; host MUST either flip tier to stable, retract the advertisement, or re-advertise with a future date + open deprecation RFC)`,
      ),
    ).toBe(true);
  });
});

describe.skipIf(HTTP_SKIP)('experimental-tier-shape: §D experimentalGate helper routing (RFC 0042 §D)', () => {
  it('experimentalGate returns false for tier="experimental" without OPENWOP_REQUIRE_EXPERIMENTAL', () => {
    // Helper-level behavioral probe — no host needed, this is a pure
    // function-routing assertion against the imported helper.
    const prevReqExp = process.env.OPENWOP_REQUIRE_EXPERIMENTAL;
    delete process.env.OPENWOP_REQUIRE_EXPERIMENTAL;
    try {
      const result = experimentalGate('test-profile', true, 'experimental', '2027-05-22');
      expect(
        result,
        req('openwop.it.experimental-tier-shape.experimentalgate-returns-false-for-tier-experimental-without-openwop-require-exp', 
          'RFCS/0042-experimental-capability-tier.md §D',
          'default mode + tier="experimental" MUST soft-skip — helper returns false',
        ),
      ).toBe(false);
    } finally {
      if (prevReqExp !== undefined) process.env.OPENWOP_REQUIRE_EXPERIMENTAL = prevReqExp;
    }
  });

  it('experimentalGate routes through behaviorGate when tier === undefined or "stable"', () => {
    const prevReqBeh = process.env.OPENWOP_REQUIRE_BEHAVIOR;
    delete process.env.OPENWOP_REQUIRE_BEHAVIOR;
    // behaviorGate/experimentalGate read a memoized loadEnv() snapshot. Under a
    // strict suite run (e.g. the conformance-soak sets OPENWOP_REQUIRE_BEHAVIOR=true
    // process-wide) an earlier scenario has already cached requireBehavior=true, so
    // the delete above is a no-op against the cache and the default-mode assertions
    // below would wrongly throw. Bust the memo so this self-test sees default mode.
    __resetEnvCacheForTests();
    try {
      // Stable + advertised → proceed.
      expect(experimentalGate('test-stable', true, 'stable'), req('openwop.it.experimental-tier-shape.experimentalgate-routes-through-behaviorgate-when-tier-undefined-or-stable', 'RFC 0042 §A', 'experimentalGate routes through behaviorGate when tier === undefined or "stable"')).toBe(true);
      expect(experimentalGate('test-stable-undef', true, undefined)).toBe(true);
      // Stable + NOT advertised, default mode → skip (returns false, no throw).
      expect(experimentalGate('test-not-adv', false, 'stable')).toBe(false);
    } finally {
      if (prevReqBeh !== undefined) process.env.OPENWOP_REQUIRE_BEHAVIOR = prevReqBeh;
      // Restore the real env into the memo so later scenarios gate correctly (a
      // leaked default-mode cache would turn their strict behaviorGates into
      // silent soft-skips — a coverage hole).
      __resetEnvCacheForTests();
    }
  });
});
