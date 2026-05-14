/**
 * Track 13: multi-region idempotency capability shape (idempotency.md v1.1).
 *
 * Verifies that hosts advertising the multi-region idempotency annex
 * surface a valid `capabilities.idempotency.crossRegion` value AND, when
 * claiming `'best-effort'` or `'strict'`, expose the operator-tier
 * metric names per `idempotency.md` §"Operator surface".
 *
 * The annex's partition-replay convergence rule cannot be exercised
 * black-box (it requires multi-region host deployment under a real
 * partition); the algorithm itself is verified in-process via the
 * Postgres host's `multi-region-idempotency.test.ts` smoke against
 * the canonical resolver. This scenario validates the discovery-
 * document shape so clients can rely on the capability for routing
 * decisions.
 *
 * @see spec/v1/idempotency.md §"Multi-region idempotency"
 * @see examples/hosts/postgres/src/multi-region.ts (canonical resolver)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const ALLOWED = new Set(['single-region', 'best-effort', 'strict']);
const REQUIRED_METRICS_WHEN_MULTI_REGION = [
  'openwop.idempotency.cross_region_conflicts_total',
];

interface IdempotencyCaps {
  supported?: boolean;
  layer1RetentionSeconds?: number;
  layer2RetentionSeconds?: number;
  crossRegion?: string;
}

interface ObservabilityCaps {
  metrics?: { names?: string[] };
}

describe('multi-region-idempotency: capability shape', () => {
  it('idempotency.crossRegion (when advertised) MUST be one of the closed enum', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const idem =
      (disco.json as { capabilities?: { idempotency?: IdempotencyCaps } }).capabilities
        ?.idempotency;

    if (!idem || idem.crossRegion === undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        '[multi-region-idempotency] capabilities.idempotency.crossRegion not advertised; skipping',
      );
      return;
    }

    expect(ALLOWED.has(idem.crossRegion), driver.describe(
      'idempotency.md §"Multi-region idempotency" §"Capability advertisement"',
      'crossRegion MUST be one of {"single-region","best-effort","strict"}',
    )).toBe(true);

    if (idem.layer1RetentionSeconds !== undefined) {
      expect(idem.layer1RetentionSeconds).toBeGreaterThan(0);
    }
    if (idem.layer2RetentionSeconds !== undefined) {
      expect(idem.layer2RetentionSeconds).toBeGreaterThan(0);
    }
  });

  it('multi-region hosts SHOULD expose the cross-region conflict counter per §"Operator surface"', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const caps = (disco.json as { capabilities?: { idempotency?: IdempotencyCaps; observability?: ObservabilityCaps } })
      .capabilities;
    const crossRegion = caps?.idempotency?.crossRegion;

    if (crossRegion !== 'best-effort' && crossRegion !== 'strict') {
      // Single-region hosts have no conflicts to count — skip.
      return;
    }

    const advertised = new Set(caps?.observability?.metrics?.names ?? []);
    for (const name of REQUIRED_METRICS_WHEN_MULTI_REGION) {
      expect(advertised.has(name), driver.describe(
        'idempotency.md §"Operator surface"',
        `multi-region hosts SHOULD advertise metric "${name}" so operators can monitor conflict frequency`,
      )).toBe(true);
    }
  });
});
