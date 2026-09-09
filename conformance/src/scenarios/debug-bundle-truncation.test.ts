/**
 * Debug-bundle truncation contract (debug-bundle.md §"Bundle size limits").
 *
 * Verifies that when a bundle would exceed the host's size cap, the
 * response surfaces `truncated: true` + a non-empty `truncatedReason`
 * and the `events` array is a strict prefix of what the run produced.
 *
 * Driving truncation deterministically requires either a fixture that
 * generates ≥ 8MB of events (impractical) or a host-implementation
 * override. The SQLite reference host accepts a `?maxEvents=N` query
 * parameter (host-implementation choice per the spec — "Hosts MAY
 * raise the cap via implementation-defined configuration"). When
 * neither the cap can be lowered nor a high-event fixture is available,
 * this scenario soft-skips the assertion.
 *
 * @see spec/v1/debug-bundle.md §"Bundle size limits"
 * @see spec/v1/production-profile.md §"Debug bundle behavior" (RFC 0009
 *      — this scenario satisfies the truncation-metadata predicate when
 *      the host advertises capabilities.production.debugBundle.truncationMetadata: true)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

// `conformance-multi-node` produces enough events (run.started, three
// node.started/completed pairs, run.completed = ~8 events) that
// `?maxEvents=2` reliably forces truncation.
const FIXTURE = 'conformance-multi-node';

describe('debug-bundle-truncation: truncated: true contract', () => {
  it('host that supports ?maxEvents=N (or otherwise caps) surfaces truncated + truncatedReason', async () => {
    if (!isFixtureAdvertised(FIXTURE)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[debug-bundle-truncation] ${FIXTURE} not advertised; skipping (host doesn't seed a multi-event fixture)`,
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(FIXTURE)` returned early ([debug-bundle-truncation] … not advertised; skipping (host doesn\'t seed a multi-event fixture))');
    }

    const create = await driver.post('/v1/runs', { workflowId: FIXTURE });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId, { timeoutMs: 15_000 });

    // First call: full bundle, so we know how many events the run produced.
    const full = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/debug-bundle`);
    expect(full.status).toBe(200);
    const fullBody = full.json as { events?: unknown[]; truncated?: boolean };
    const fullEventCount = (fullBody.events ?? []).length;
    expect(fullEventCount, req('openwop.it.debug-bundle-truncation.host-that-supports-maxevents-n-or-otherwise-caps-surfaces-truncated-truncatedrea', 'debug-bundle.md §"Bundle size limits"', 'multi-node fixture MUST emit ≥ 3 events')).toBeGreaterThanOrEqual(3);
    expect(fullBody.truncated ?? false, req('openwop.it.debug-bundle-truncation.host-that-supports-maxevents-n-or-otherwise-caps-surfaces-truncated-truncatedrea', 'debug-bundle.md §"Bundle size limits"', 'baseline bundle MUST NOT be truncated')).toBe(false);

    // Force truncation via the host's optional maxEvents override.
    const truncated = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/debug-bundle?maxEvents=2`,
    );

    // Hosts that don't honor `?maxEvents=` will return the full bundle
    // (truncated: false). Soft-skip the assertion in that case so the
    // suite remains forward-compatible with hosts using a different
    // truncation-forcing mechanism.
    const body = truncated.json as {
      truncated?: boolean;
      truncatedReason?: string;
      events?: unknown[];
      metrics?: { eventCount?: number };
    };

    if (body.truncated !== true) {
      // eslint-disable-next-line no-console
      console.warn(
        '[debug-bundle-truncation] host does not honor ?maxEvents=; skipping truncated-shape assertions',
      );
      return softSkip('blocked', 'precondition not met — `body.truncated !== true` returned early ([debug-bundle-truncation] host does not honor ?maxEvents=; skipping truncated-shape assertions) (seam, prior step, or fixture unavailable)');
    }

    expect(typeof body.truncatedReason, req('openwop.it.debug-bundle-truncation.host-that-supports-maxevents-n-or-otherwise-caps-surfaces-truncated-truncatedrea', 
      'debug-bundle.md §"Bundle size limits"',
      'truncated: true MUST be accompanied by a non-empty truncatedReason string',
    )).toBe('string');
    expect((body.truncatedReason ?? '').length).toBeGreaterThan(0);

    expect((body.events ?? []).length, req('openwop.it.debug-bundle-truncation.host-that-supports-maxevents-n-or-otherwise-caps-surfaces-truncated-truncatedrea', 
      'debug-bundle.md §"Bundle size limits"',
      'truncated events array MUST be a prefix (≤ maxEvents)',
    )).toBeLessThanOrEqual(2);

    expect(body.metrics?.eventCount, req('openwop.it.debug-bundle-truncation.host-that-supports-maxevents-n-or-otherwise-caps-surfaces-truncated-truncatedrea', 
      'debug-bundle.md §"Bundle size limits"',
      'metrics.eventCount MUST reflect the TOTAL event count, not the truncated length',
    )).toBe(fullEventCount);
  });
});
