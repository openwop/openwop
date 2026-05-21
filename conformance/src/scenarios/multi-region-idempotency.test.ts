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

// RFC 0036 — granular `multiRegion` sub-block advertisement shape. Hosts that
// opt into the granular advertisement (separate from the categorical `crossRegion`
// claim) MUST conform to the shape below: supported is boolean (required); when
// supported is true, replicationLagBoundMs is integer [0, 60000] and
// partitionRecoveryStrategy is either the categorical enum or an x-host-<host>-<key>
// extension namespace string. Hosts that don't advertise multiRegion stay on the
// categorical crossRegion claim (above); both forms are compatible.

interface MultiRegionCaps {
  supported?: unknown;
  replicationLagBoundMs?: unknown;
  partitionRecoveryStrategy?: unknown;
}

describe('multi-region-idempotency: granular multiRegion advertisement shape (RFC 0036 §A)', () => {
  it('capabilities.idempotency.multiRegion (when present) conforms to RFC 0036 §A', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const idem =
      (disco.json as { capabilities?: { idempotency?: IdempotencyCaps & { multiRegion?: MultiRegionCaps } } })
        .capabilities?.idempotency;
    const mr = idem?.multiRegion;
    if (mr === undefined) return; // host doesn't advertise the granular block — soft-skip

    expect(
      typeof mr.supported,
      driver.describe(
        'RFCS/0036-multi-region-and-cross-engine-guarantees.md §A',
        'capabilities.idempotency.multiRegion.supported MUST be boolean when present',
      ),
    ).toBe('boolean');

    if (mr.supported === true) {
      if (mr.replicationLagBoundMs !== undefined) {
        const n = mr.replicationLagBoundMs as number;
        expect(
          Number.isInteger(n) && n >= 0 && n <= 60000,
          driver.describe(
            'RFCS/0036-multi-region-and-cross-engine-guarantees.md §A',
            'replicationLagBoundMs MUST be integer in [0, 60000] when supported is true',
          ),
        ).toBe(true);
      }
      if (mr.partitionRecoveryStrategy !== undefined) {
        const s = mr.partitionRecoveryStrategy as string;
        const isCategorical = s === 'last-writer-wins' || s === 'first-writer-wins';
        const isExtension = /^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/.test(s);
        expect(
          isCategorical || isExtension,
          driver.describe(
            'RFCS/0036-multi-region-and-cross-engine-guarantees.md §A',
            'partitionRecoveryStrategy MUST be one of {last-writer-wins, first-writer-wins} OR match ^x-host-<host>-<key>$',
          ),
        ).toBe(true);
      }
    }
  });
});
