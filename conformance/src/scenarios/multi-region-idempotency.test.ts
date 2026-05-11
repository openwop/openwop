/**
 * Track 13: multi-region idempotency capability shape (idempotency.md v1.1).
 *
 * Verifies that hosts advertising the multi-region idempotency annex
 * surface a valid `capabilities.idempotency.crossRegion` value. The
 * end-to-end partition behavior cannot be exercised black-box; this
 * scenario validates the discovery-document shape so clients can rely
 * on the capability for routing decisions.
 *
 * @see spec/v1/idempotency.md §"Multi-region idempotency"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const ALLOWED = new Set(['single-region', 'best-effort', 'strict']);

interface IdempotencyCaps {
  supported?: boolean;
  layer1RetentionSeconds?: number;
  layer2RetentionSeconds?: number;
  crossRegion?: string;
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
});
