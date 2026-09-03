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
import { softSkip } from '../lib/soft-skip.js';
import { readHeartbeatCap, heartbeatSupported, tickHeartbeat } from '../lib/heartbeat.js';
import { req } from '../lib/requirement-ids.js';

describe('heartbeat-fires-once-per-tick (RFC 0060 §B.1)', () => {
  it('one tick emits exactly one heartbeat.evaluated', async () => {
    if (!heartbeatSupported(await readHeartbeatCap())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!heartbeatSupported(await readHeartbeatCap())` returned early');
    const res = await tickHeartbeat({ heartbeatId: 'conformance-hb', observedState: { n: 0 } });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    const evaluated = (res.json as { evaluated?: unknown[] } | undefined)?.evaluated;
    if (!Array.isArray(evaluated)) return softSkip('blocked', 'host doesn\'t surface per-tick events on the seam');
    expect(
      evaluated.length,
      req('openwop.it.heartbeat-fires-once-per-tick.one-tick-emits-exactly-one-heartbeat-evaluated', 'RFC 0060 §B.1', 'a single tick MUST emit exactly one heartbeat.evaluated'),
    ).toBe(1);
  });
});
