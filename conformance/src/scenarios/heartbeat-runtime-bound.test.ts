/**
 * heartbeat-runtime-bound — RFC 0060 §B.2. A predicate exceeding `maxRuntimeMs`
 * is terminated and reported `heartbeat.evaluated { status: "timeout" }`,
 * never left running.
 *
 * Gated on `capabilities.heartbeat.supported` + the host tick seam;
 * soft-skips when either is absent.
 *
 * @see RFCS/0060-host-heartbeat-capability.md §B
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readHeartbeatCap, heartbeatSupported, tickHeartbeat } from '../lib/heartbeat.js';

describe('heartbeat-runtime-bound (RFC 0060 §B.2)', () => {
  it('an over-budget predicate is reported as timeout', async () => {
    if (!heartbeatSupported(await readHeartbeatCap())) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!heartbeatSupported(await readHeartbeatCap())` returned early');
    // `simulateSlowMs` is a host-seam hint asking the predicate to overrun
    // its maxRuntimeMs budget; hosts not honoring it surface no `timeout`.
    const res = await tickHeartbeat({ heartbeatId: 'conformance-hb-slow', observedState: {}, simulateSlowMs: 60_000 });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    const evaluated = (res.json as { evaluated?: Array<{ status?: unknown }> } | undefined)?.evaluated;
    if (!Array.isArray(evaluated) || evaluated.length === 0) return softSkip('blocked', 'host doesn\'t surface per-tick events (!Array.isArray(evaluated) || evaluated.length === 0)');
    expect(
      evaluated.every((e) => e.status === 'timeout'),
      driver.describe('RFC 0060 §B.2', 'an over-budget predicate MUST be terminated and reported status:"timeout"'),
    ).toBe(true);
  });
});
