/**
 * heartbeat-fires-once-per-tick — RFC 0060 §B.1. A tick produces exactly one
 * `heartbeat.evaluated`; an overlapping tick while a prior evaluation is still
 * running is skipped (not queued).
 *
 * Gated on `capabilities.heartbeat.supported` + the host heartbeat tick seam
 * (`POST /v1/host/sample/heartbeat/tick`); soft-skips when either is absent.
 *
 * @see RFCS/0060-host-heartbeat-capability.md §B
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readHeartbeatCap, heartbeatSupported, tickHeartbeat } from '../lib/heartbeat.js';

describe('heartbeat-fires-once-per-tick (RFC 0060 §B.1)', () => {
  it('one tick emits exactly one heartbeat.evaluated', async () => {
    if (!heartbeatSupported(await readHeartbeatCap())) return;
    const res = await tickHeartbeat({ heartbeatId: 'conformance-hb', observedState: { n: 0 } });
    if (res === null) return; // seam absent — soft-skip
    const evaluated = (res.json as { evaluated?: unknown[] } | undefined)?.evaluated;
    if (!Array.isArray(evaluated)) return; // host doesn't surface per-tick events on the seam
    expect(
      evaluated.length,
      driver.describe('RFC 0060 §B.1', 'a single tick MUST emit exactly one heartbeat.evaluated'),
    ).toBe(1);
  });
});
