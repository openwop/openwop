/**
 * heartbeat-capability-shape — RFC 0060 §A. The `capabilities.heartbeat`
 * advertisement block is either absent or a well-formed object.
 *
 * Status: ACTIVE (advertisement-shape; always runs). Behavioral coverage
 * lives in the sibling heartbeat-*.test.ts scenarios, gated on
 * `capabilities.heartbeat.supported` + the host's heartbeat tick seam.
 *
 * @see RFCS/0060-host-heartbeat-capability.md §A
 * @see spec/v1/host-capabilities.md §host.heartbeat
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readHeartbeatCap } from '../lib/heartbeat.js';

describe('heartbeat-capability-shape: advertisement (RFC 0060 §A)', () => {
  it('capabilities.heartbeat is absent or a well-formed object', async () => {
    const cap = await readHeartbeatCap();
    if (cap === null) return; // not advertised — valid
    expect(
      typeof cap.supported,
      driver.describe('capabilities.schema.json §heartbeat', 'heartbeat.supported MUST be a boolean when the block is present'),
    ).toBe('boolean');
    for (const k of ['minIntervalSec', 'maxRuntimeMs'] as const) {
      if (cap[k] !== undefined) {
        const v = cap[k];
        expect(
          typeof v === 'number' && Number.isInteger(v) && v >= 1,
          driver.describe('capabilities.schema.json §heartbeat', `heartbeat.${k} MUST be a positive integer when present`),
        ).toBe(true);
      }
    }
  });
});
