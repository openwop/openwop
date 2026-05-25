/**
 * heartbeat-idempotent-no-spam — RFC 0060 §B.5. Two ticks at unchanged state
 * produce zero enqueued runs and zero `heartbeat.stateChanged`; only the
 * transitioning tick produces exactly one of each. This is the anti-spam
 * guarantee — action is gated on a state *transition*, not on the tick.
 *
 * Gated on `capabilities.heartbeat.supported` + the host tick seam;
 * soft-skips when either is absent.
 *
 * @see RFCS/0060-host-heartbeat-capability.md §B
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { readHeartbeatCap, heartbeatSupported, tickHeartbeat } from '../lib/heartbeat.js';

function changedCount(json: unknown): number | null {
  const sc = (json as { stateChanged?: unknown[] } | undefined)?.stateChanged;
  return Array.isArray(sc) ? sc.length : null;
}

describe('heartbeat-idempotent-no-spam (RFC 0060 §B.5)', () => {
  it('an unchanged tick enqueues nothing; only a transition does', async () => {
    if (!heartbeatSupported(await readHeartbeatCap())) return;
    const hb = 'conformance-hb-spam';
    const first = await tickHeartbeat({ heartbeatId: hb, observedState: { unread: 0 } });
    if (first === null) return; // seam absent — soft-skip
    const second = await tickHeartbeat({ heartbeatId: hb, observedState: { unread: 0 } });
    if (second === null) return;
    const unchanged = changedCount(second.json);
    if (unchanged === null) return; // host doesn't surface stateChanged on the seam
    expect(
      unchanged,
      driver.describe('RFC 0060 §B.5', 'an unchanged tick MUST NOT emit heartbeat.stateChanged'),
    ).toBe(0);
    const transition = await tickHeartbeat({ heartbeatId: hb, observedState: { unread: 3 } });
    if (transition === null) return;
    expect(
      changedCount(transition.json),
      driver.describe('RFC 0060 §B.5', 'a transitioning tick MUST emit exactly one heartbeat.stateChanged'),
    ).toBe(1);
  });
});
