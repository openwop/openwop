/**
 * scheduling-cron-fires-once — RFC 0052 §B behavioral verification.
 *
 * Status: DRAFT. RFC 0052 (scheduling & time-based triggers) is `Draft`.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.scheduling.supported = true`.
 *
 * What this scenario asserts (via the optional
 * `POST /v1/host/sample/scheduling/tick` test seam, which advances a
 * deterministic clock and reports the runs a cron schedule produced):
 *   1. Once-per-tick — a single cron tick produces exactly one run; no
 *      duplicate concurrent firing (RFC 0052 §B.2).
 *   2. Missed-tick policy — a host-down-across-a-tick window applies the
 *      advertised policy (fire-once-on-recovery OR skip), never a backlog
 *      flood (RFC 0052 §B.4).
 *
 * Hosts without the seam soft-skip the behavioral probes (404). Horizon
 * rejection (`schedule_horizon_exceeded`) is covered by the shape +
 * error-code contract; behavioral horizon assertion is part of the deferred
 * delayed-execution scenario.
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md
 * @see spec/v1/host-capabilities.md §host.scheduling
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface DiscoveryDoc {
  capabilities?: { scheduling?: { supported?: boolean; cron?: boolean } };
}

async function readScheduling(): Promise<{ supported?: boolean; cron?: boolean } | null> {
  const res = await driver.get('/.well-known/openwop');
  return capabilityFamily((res.json as DiscoveryDoc | undefined), 'scheduling') ?? null;
}

describe('scheduling-cron-fires-once: once-per-tick + missed-tick (RFC 0052 §B)', () => {
  it('a single cron tick produces exactly one run', async () => {
    const sched = await readScheduling();
    if (!sched?.supported || sched.cron !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!sched?.supported || sched.cron !== true` returned early (capability-gated)'); // capability-gated
    const res = await driver.post('/v1/host/sample/scheduling/tick', { scenario: 'single-tick' });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    const body = res.json as { runsFired?: number } | undefined;
    expect(
      body?.runsFired,
      req('openwop.it.scheduling-cron-fires-once.a-single-cron-tick-produces-exactly-one-run', 'RFC 0052 §B.2', 'a single cron tick MUST fire exactly one run (no duplicate concurrent firing)'),
    ).toBe(1);
  });

  it('a missed-tick window does not produce a backlog flood', async () => {
    const sched = await readScheduling();
    if (!sched?.supported || sched.cron !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!sched?.supported || sched.cron !== true` returned early (capability-gated)'); // capability-gated
    const res = await driver.post('/v1/host/sample/scheduling/tick', { scenario: 'missed-window', missedTicks: 5 });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    const body = res.json as { runsFired?: number } | undefined;
    expect(
      typeof body?.runsFired === 'number' && body.runsFired <= 1,
      req('openwop.it.scheduling-cron-fires-once.a-missed-tick-window-does-not-produce-a-backlog-flood', 
        'RFC 0052 §B.4',
        `a missed-tick window MUST apply the advertised policy (fire-once-on-recovery or skip), never N backlogged runs; got runsFired=${body?.runsFired}`,
      ),
    ).toBe(true);
  });
});
