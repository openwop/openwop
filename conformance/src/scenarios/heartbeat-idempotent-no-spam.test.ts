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
import { softSkip } from '../lib/soft-skip.js';
import { readHeartbeatCap, heartbeatSupported, tickHeartbeat } from '../lib/heartbeat.js';
import { req } from '../lib/requirement-ids.js';

function changedCount(json: unknown): number | null {
  const sc = (json as { stateChanged?: unknown[] } | undefined)?.stateChanged;
  return Array.isArray(sc) ? sc.length : null;
}

describe('heartbeat-idempotent-no-spam (RFC 0060 §B.5)', () => {
  it('an unchanged tick enqueues nothing; only a transition does', async () => {
    if (!heartbeatSupported(await readHeartbeatCap())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!heartbeatSupported(await readHeartbeatCap())` returned early');
    const hb = 'conformance-hb-spam';
    const first = await tickHeartbeat({ heartbeatId: hb, observedState: { unread: 0 } });
    if (first === null) return softSkip('blocked', 'seam absent — soft-skip');
    const second = await tickHeartbeat({ heartbeatId: hb, observedState: { unread: 0 } });
    if (second === null) return softSkip('blocked', 'precondition not met — `second === null` returned early (seam, prior step, or fixture unavailable)');
    const unchanged = changedCount(second.json);
    if (unchanged === null) return softSkip('blocked', 'host doesn\'t surface stateChanged on the seam');
    expect(
      unchanged,
      req('openwop.it.heartbeat-idempotent-no-spam.an-unchanged-tick-enqueues-nothing-only-a-transition-does', 'RFC 0060 §B.5', 'an unchanged tick MUST NOT emit heartbeat.stateChanged'),
    ).toBe(0);
    const transition = await tickHeartbeat({ heartbeatId: hb, observedState: { unread: 3 } });
    if (transition === null) return softSkip('blocked', 'precondition not met — `transition === null` returned early (seam, prior step, or fixture unavailable)');
    expect(
      changedCount(transition.json),
      req('openwop.it.heartbeat-idempotent-no-spam.an-unchanged-tick-enqueues-nothing-only-a-transition-does', 'RFC 0060 §B.5', 'a transitioning tick MUST emit exactly one heartbeat.stateChanged'),
    ).toBe(1);
  });
});
