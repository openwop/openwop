/**
 * deadletter-capability-shape — RFC 0053 §A advertisement-shape verification.
 *
 * Status: DRAFT. RFC 0053 (dead-letter routing & failure sinks) is `Draft`.
 * The `capabilities.deadLetter` block has landed in
 * `schemas/capabilities.schema.json`.
 *
 * Always runs (shape-only): when the host advertises
 * `capabilities.deadLetter`, its fields MUST be well-formed.
 *
 * What this scenario asserts:
 *   1. `capabilities.deadLetter` is either absent or a well-formed object.
 *   2. When `supported: true`, `retentionDays` (when present) is an integer ≥ 1
 *      (RFC 0053 §A).
 *
 * @see RFCS/0053-dead-letter-routing-and-failure-sinks.md
 * @see spec/v1/host-capabilities.md §host.deadLetter
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface DiscoveryDeadLetter {
  supported?: boolean;
  retentionDays?: number;
}

interface DiscoveryDoc {
  capabilities?: { deadLetter?: DiscoveryDeadLetter };
}

async function readDeadLetter(): Promise<DiscoveryDeadLetter | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily(body, 'deadLetter') ?? null;
}

describe('deadletter-capability-shape: advertisement shape (RFC 0053 §A)', () => {
  it('capabilities.deadLetter is either absent or well-formed', async () => {
    const dl = await readDeadLetter();
    if (dl === null) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `dl === null` returned early (host doesn\'t advertise deadLetter at all)'); // host doesn't advertise deadLetter at all
    expect(
      typeof dl.supported,
      req('openwop.it.deadletter-capability-shape.capabilities-deadletter-is-either-absent-or-well-formed', 
        'capabilities.schema.json §deadLetter',
        'capabilities.deadLetter.supported MUST be a boolean when deadLetter is advertised',
      ),
    ).toBe('boolean');
  });

  it('retentionDays is an integer >= 1 when present + supported', async () => {
    const dl = await readDeadLetter();
    if (!dl?.supported || dl.retentionDays === undefined) return softSkip('blocked', 'precondition not met — `!dl?.supported || dl.retentionDays === undefined` returned early (seam, prior step, or fixture unavailable)');
    expect(
      Number.isInteger(dl.retentionDays) && dl.retentionDays >= 1,
      req('openwop.it.deadletter-capability-shape.retentiondays-is-an-integer-1-when-present-supported', 'RFC 0053 §A', `capabilities.deadLetter.retentionDays MUST be an integer >= 1, got: ${dl.retentionDays}`),
    ).toBe(true);
  });
});
