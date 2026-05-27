/**
 * scheduling-capability-shape — RFC 0052 §A advertisement-shape verification.
 *
 * Status: DRAFT. RFC 0052 (scheduling & time-based triggers) is `Draft`. The
 * `capabilities.scheduling` block has landed in
 * `schemas/capabilities.schema.json`.
 *
 * Always runs (shape-only): when the host advertises `capabilities.scheduling`,
 * its fields MUST be well-formed.
 *
 * What this scenario asserts:
 *   1. `capabilities.scheduling` is either absent or a well-formed object.
 *   2. When `supported: true`: `cron`/`delayed`/`calendar` (when present) are
 *      booleans, and `maxFutureHorizon` (when present) is an ISO-8601 duration
 *      (RFC 0052 §A).
 *
 * @see RFCS/0052-scheduling-and-time-based-triggers.md
 * @see spec/v1/host-capabilities.md §host.scheduling
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';

interface DiscoveryScheduling {
  supported?: boolean;
  cron?: boolean;
  delayed?: boolean;
  calendar?: boolean;
  maxFutureHorizon?: string;
}

interface DiscoveryDoc {
  capabilities?: { scheduling?: DiscoveryScheduling };
}

// ISO-8601 duration (e.g. P90D, PT12H, P1DT6H) — the subset the spec uses.
const ISO_DURATION = /^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/;

async function readScheduling(): Promise<DiscoveryScheduling | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  return capabilityFamily(body, 'scheduling') ?? null;
}

describe('scheduling-capability-shape: advertisement shape (RFC 0052 §A)', () => {
  it('capabilities.scheduling is either absent or well-formed', async () => {
    const sched = await readScheduling();
    if (sched === null) return; // host doesn't advertise scheduling at all
    expect(
      typeof sched.supported,
      driver.describe(
        'capabilities.schema.json §scheduling',
        'capabilities.scheduling.supported MUST be a boolean when scheduling is advertised',
      ),
    ).toBe('boolean');
  });

  it('cron/delayed/calendar are booleans when present + supported', async () => {
    const sched = await readScheduling();
    if (!sched?.supported) return;
    for (const k of ['cron', 'delayed', 'calendar'] as const) {
      if (sched[k] === undefined) continue;
      expect(
        typeof sched[k],
        driver.describe('RFC 0052 §A', `capabilities.scheduling.${k} MUST be a boolean when present`),
      ).toBe('boolean');
    }
  });

  it('maxFutureHorizon is an ISO-8601 duration when present', async () => {
    const sched = await readScheduling();
    if (!sched?.supported || sched.maxFutureHorizon === undefined) return;
    expect(
      ISO_DURATION.test(sched.maxFutureHorizon),
      driver.describe(
        'RFC 0052 §A',
        `capabilities.scheduling.maxFutureHorizon MUST be an ISO-8601 duration, got: ${sched.maxFutureHorizon}`,
      ),
    ).toBe(true);
  });
});
