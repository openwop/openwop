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
    const em = d?.capabilities?.multiAgent?.executionModel;
    if (em === undefined) {
      ctx.skip();
      return;
    }
    if (em.tier === undefined) {
      ctx.skip(); // tier is optional with default 'stable'
      return;
    }
    expect(
      em.tier === 'stable' || em.tier === 'experimental',
      driver.describe(
        'RFCS/0042-experimental-capability-tier.md §A',
        'multiAgent.executionModel.tier MUST be one of the canonical enum values',
      ),
    ).toBe(true);
  });

  it('when tier === "experimental", experimentalUntil MUST be present + valid date', async (ctx) => {
    const d = await readDiscovery();
    const em = d?.capabilities?.multiAgent?.executionModel;
    if (em === undefined || em.tier !== 'experimental') {
      ctx.skip();
      return;
    }

    expect(
      typeof em.experimentalUntil,
      driver.describe(
        'RFCS/0042-experimental-capability-tier.md §B',
        'when tier is "experimental", experimentalUntil MUST be present (the §B sunset-rule contract)',
      ),
    ).toBe('string');

    const dateStr = em.experimentalUntil as string;
    expect(
      /^\d{4}-\d{2}-\d{2}$/.test(dateStr),
      driver.describe(
        'RFCS/0042-experimental-capability-tier.md §B',
        'experimentalUntil MUST match YYYY-MM-DD',
      ),
    ).toBe(true);

    const parsed = new Date(dateStr + 'T00:00:00Z');
    expect(
      !Number.isNaN(parsed.getTime()),
      driver.describe(
        'RFCS/0042-experimental-capability-tier.md §B',
        'experimentalUntil MUST parse as a valid ISO-8601 date',
      ),
    ).toBe(true);
  });

  it('experimentalUntil MUST be ≤ 365 days in the future (sunset bound)', async (ctx) => {
    const d = await readDiscovery();
    const em = d?.capabilities?.multiAgent?.executionModel;
    if (em === undefined || em.tier !== 'experimental') {
      ctx.skip();
      return;
    }
    if (typeof em.experimentalUntil !== 'string') {
      ctx.skip(); // shape probe above will fail; don't double-fail
      return;
    }
    const target = new Date((em.experimentalUntil as string) + 'T00:00:00Z').getTime();
    const now = Date.now();
    const daysAhead = (target - now) / (1000 * 60 * 60 * 24);
    expect(
      daysAhead <= 365,
      driver.describe(
        'RFCS/0042-experimental-capability-tier.md §B',
        `experimentalUntil MUST be ≤ 365 days from now (got ${Math.floor(daysAhead)} days; advertised ${em.experimentalUntil})`,
      ),
    ).toBe(true);
  });

  it('sunset detection: experimentalUntil in the past is non-conformant', async (ctx) => {
    const d = await readDiscovery();
    const em = d?.capabilities?.multiAgent?.executionModel;
    if (em === undefined || em.tier !== 'experimental') {
      ctx.skip();
      return;
    }
    if (typeof em.experimentalUntil !== 'string') {
      ctx.skip();
      return;
    }
    const target = new Date((em.experimentalUntil as string) + 'T00:00:00Z').getTime();
    const now = Date.now();
    expect(
      target >= now,
      driver.describe(
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
        driver.describe(
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
    try {
      // Stable + advertised → proceed.
      expect(experimentalGate('test-stable', true, 'stable')).toBe(true);
      expect(experimentalGate('test-stable-undef', true, undefined)).toBe(true);
      // Stable + NOT advertised, default mode → skip (returns false, no throw).
      expect(experimentalGate('test-not-adv', false, 'stable')).toBe(false);
    } finally {
      if (prevReqBeh !== undefined) process.env.OPENWOP_REQUIRE_BEHAVIOR = prevReqBeh;
    }
  });
});
