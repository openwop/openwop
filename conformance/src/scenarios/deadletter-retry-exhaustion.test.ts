/**
 * deadletter-retry-exhaustion — RFC 0053 §C behavioral verification.
 *
 * Status: DRAFT. RFC 0053 (dead-letter routing & failure sinks) is `Draft`.
 *
 * Capability-gated: skips when the host does not advertise
 * `capabilities.deadLetter.supported = true`.
 *
 * What this scenario asserts (via the optional
 * `POST /v1/host/sample/deadletter/exhaust` test seam, which drives a node
 * that deterministically exhausts a short retry policy):
 *   1. Retry exhaustion → `run.dead_lettered` — the host emits the event
 *      carrying `{ runId, reason, attempts }` (RFC 0053 §C.1).
 *   2. Fork-eligibility — the dead-lettered run remains forkable per RFC 0011
 *      within the retention window (RFC 0053 §C.2).
 *
 * Hosts without the seam soft-skip the behavioral probes (404). Retention
 * purge is part of the deferred retention scenario (needs a clock seam).
 *
 * @see RFCS/0053-dead-letter-routing-and-failure-sinks.md
 * @see spec/v1/host-capabilities.md §host.deadLetter
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: { deadLetter?: { supported?: boolean } };
}

async function deadLetterSupported(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  return (res.json as DiscoveryDoc | undefined)?.capabilities?.deadLetter?.supported === true;
}

describe('deadletter-retry-exhaustion: retry exhaustion → dead-lettered + fork-eligible (RFC 0053 §C)', () => {
  it('a retry-exhausted run emits run.dead_lettered with attempts', async () => {
    if (!(await deadLetterSupported())) return; // capability-gated
    const res = await driver.post('/v1/host/sample/deadletter/exhaust', { scenario: 'exhaust-retries' });
    if (res.status === 404) return; // seam unwired — soft-skip
    const body = res.json as { event?: { type?: string; payload?: { attempts?: number; runId?: string } } } | undefined;
    expect(
      body?.event?.type,
      driver.describe('RFC 0053 §C.1', 'retry exhaustion MUST emit a run.dead_lettered event'),
    ).toBe('run.dead_lettered');
    expect(
      typeof body?.event?.payload?.attempts === 'number' && body.event.payload.attempts >= 1,
      driver.describe('RFC 0053 §C.1', 'run.dead_lettered MUST carry the total attempts (>= 1)'),
    ).toBe(true);
  });

  it('the dead-lettered run is fork-eligible (RFC 0011)', async () => {
    if (!(await deadLetterSupported())) return; // capability-gated
    const res = await driver.post('/v1/host/sample/deadletter/exhaust', { scenario: 'fork-after-dead-letter' });
    if (res.status === 404) return; // seam unwired — soft-skip
    const body = res.json as { forkEligible?: boolean } | undefined;
    expect(
      body?.forkEligible,
      driver.describe('RFC 0053 §C.2', 'a dead-lettered run MUST remain fork-eligible within the retention window'),
    ).toBe(true);
  });
});
