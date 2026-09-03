/**
 * Track 13: multi-region idempotency capability shape (idempotency.md v1.1).
 *
 * Verifies that hosts advertising the multi-region idempotency annex
 * surface a valid `capabilities.idempotency.crossRegion` value AND, when
 * claiming `'reconciled-records'` or `'fenced-effects'`, expose the
 * operator-tier metric names per `idempotency.md` §"Operator surface".
 *
 * RFC 0150 §D revised the vocabulary. `best-effort` became
 * `reconciled-records` — it always meant the RECORDS converge, and the old
 * name invited hearing "a best effort at not duplicating effects". `strict`
 * was removed rather than renamed: it promised only that read-visibility was
 * bounded by `multiRegion.replicationLagBoundMs`, a LATENCY claim sitting at
 * the top of a ladder implementers read as effect safety. `fenced-effects`
 * takes that slot and means something different and stronger, so promoting
 * old `strict` advertisements into it by rename would have asserted evidence
 * no host produced.
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
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const ALLOWED = new Set(['single-region', 'reconciled-records', 'fenced-effects']);
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
    const idem = capabilityFamily<IdempotencyCaps>(disco.json, 'idempotency');

    if (!idem || idem.crossRegion === undefined) {
      // eslint-disable-next-line no-console
      console.warn(
        '[multi-region-idempotency] capabilities.idempotency.crossRegion not advertised; skipping',
      );
      return softSkip('blocked', 'precondition not met — `!idem || idem.crossRegion === undefined` returned early (seam, prior step, or fixture unavailable)');
    }

    expect(ALLOWED.has(idem.crossRegion), req('openwop.it.multi-region-idempotency.idempotency-crossregion-when-advertised-must-be-one-of-the-closed-enum', 
      'idempotency.md §"Multi-region idempotency" §"Capability advertisement"',
      'crossRegion MUST be one of {"single-region","reconciled-records","fenced-effects"}',
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
    const idem = capabilityFamily<IdempotencyCaps>(disco.json, 'idempotency');
    const observability = capabilityFamily<ObservabilityCaps>(disco.json, 'observability');
    const crossRegion = idem?.crossRegion;

    if (crossRegion !== 'reconciled-records' && crossRegion !== 'fenced-effects') {
      // Single-region hosts have no conflicts to count — skip.
      return softSkip('blocked', 'precondition not met — `crossRegion !== \'reconciled-records\' && crossRegion !== \'fenced-effects\'` returned early (seam, prior step, or fixture unavailable)');
    }

    const advertised = new Set(observability?.metrics?.names ?? []);
    for (const name of REQUIRED_METRICS_WHEN_MULTI_REGION) {
      expect(advertised.has(name), req('openwop.it.multi-region-idempotency.multi-region-hosts-should-expose-the-cross-region-conflict-counter-per-operator', 
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
    const idem = capabilityFamily<IdempotencyCaps & { multiRegion?: MultiRegionCaps }>(
      disco.json,
      'idempotency',
    );
    const mr = idem?.multiRegion;
    if (mr === undefined) return softSkip('inapplicable', 'host doesn\'t advertise the granular block — soft-skip');

    expect(
      typeof mr.supported,
      req('openwop.it.multi-region-idempotency.capabilities-idempotency-multiregion-when-present-conforms-to-rfc-0036-a', 
        'RFCS/0036-multi-region-and-cross-engine-guarantees.md §A',
        'capabilities.idempotency.multiRegion.supported MUST be boolean when present',
      ),
    ).toBe('boolean');

    if (mr.supported === true) {
      if (mr.replicationLagBoundMs !== undefined) {
        const n = mr.replicationLagBoundMs as number;
        expect(
          Number.isInteger(n) && n >= 0 && n <= 60000,
          req('openwop.it.multi-region-idempotency.capabilities-idempotency-multiregion-when-present-conforms-to-rfc-0036-a', 
            'RFCS/0036-multi-region-and-cross-engine-guarantees.md §A',
            'replicationLagBoundMs MUST be integer in [0, 60000] when supported is true',
          ),
        ).toBe(true);
      }
      if (mr.partitionRecoveryStrategy !== undefined) {
        const s = mr.partitionRecoveryStrategy as string;
        const isCategorical = s === 'lexicographic-min-run-id';
        const isExtension = /^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/.test(s);
        expect(
          isCategorical || isExtension,
          req('openwop.it.multi-region-idempotency.capabilities-idempotency-multiregion-when-present-conforms-to-rfc-0036-a', 
            'RFCS/0036-multi-region-and-cross-engine-guarantees.md §A',
            'partitionRecoveryStrategy MUST be `lexicographic-min-run-id` OR match ^x-host-<host>-<key>$ (RFC 0150 §D removed the time-ordered rules: with no shared clock under a partition, each region believes it wrote last, so neither can produce the reproducible survivor the annex requires)',
          ),
        ).toBe(true);
      }
    }
  });
});
