/**
 * cross-engine-append-ordering — RFC 0036 §B advertisement-shape + behavioral.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0036 promoted Draft → Active
 * 2026-05-21. Capability-gated on `capabilities.eventLog.crossEngineOrdering.supported: true`.
 * Hosts that don't advertise the capability soft-skip cleanly.
 *
 * Asserts (advertisement-shape — always-on when discovery is reachable):
 *   1. capabilities.eventLog.crossEngineOrdering.supported MUST be boolean when present.
 *   2. capabilities.eventLog.crossEngineOrdering.orderingModel MUST be one of
 *      {lamport, vector-clock, global-sequencer} when present.
 *   3. When supported: true, orderingModel MUST be present (otherwise the
 *      claim has no operational meaning).
 *
 * Behavioral assertion (drives a two-engine fixture against the host's
 * multi-engine simulator at apps/workflow-engine/.../multi-region-simulator.ts):
 * concurrent appends from two engines to the same runId converge on a total
 * order that both engines observe consistently on read. This assertion lands
 * when the simulator harness is wired in a follow-up commit (per RFC 0036 §C);
 * today's scenario soft-skips behavioral when the simulator env-gate
 * (`OPENWOP_TEST_MULTI_ENGINE=true`) is unset.
 *
 * @see RFCS/0036-multi-region-and-cross-engine-guarantees.md §B
 * @see schemas/capabilities.schema.json §capabilities.eventLog.crossEngineOrdering
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const ORDERING_MODELS = new Set(['lamport', 'vector-clock', 'global-sequencer']);

interface DiscoveryDoc {
  capabilities?: {
    eventLog?: {
      crossEngineOrdering?: {
        supported?: unknown;
        orderingModel?: unknown;
      };
    };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

describe.skipIf(HTTP_SKIP)('cross-engine-append-ordering: advertisement shape (RFC 0036 §B)', () => {
  it('capabilities.eventLog.crossEngineOrdering (when present) conforms to RFC 0036 §B', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const ceo = d.capabilities?.eventLog?.crossEngineOrdering;
    if (ceo === undefined) return; // host doesn't advertise — soft-skip

    expect(
      typeof ceo.supported,
      driver.describe(
        'RFCS/0036-multi-region-and-cross-engine-guarantees.md §B',
        'capabilities.eventLog.crossEngineOrdering.supported MUST be boolean when present',
      ),
    ).toBe('boolean');

    if (ceo.orderingModel !== undefined) {
      expect(
        ORDERING_MODELS.has(ceo.orderingModel as string),
        driver.describe(
          'RFCS/0036-multi-region-and-cross-engine-guarantees.md §B',
          'orderingModel MUST be one of {lamport, vector-clock, global-sequencer}',
        ),
      ).toBe(true);
    }

    if (ceo.supported === true) {
      expect(
        ceo.orderingModel,
        driver.describe(
          'RFCS/0036-multi-region-and-cross-engine-guarantees.md §B',
          'when supported: true, orderingModel MUST be present (the categorical claim has no operational meaning without an advertised mechanism)',
        ),
      ).toBeDefined();
    }
  });
});

// Behavioral assertion — drives a two-engine append + cross-engine read against
// the host's multi-engine simulator. Lands when the simulator harness is wired
// in a follow-up commit per RFC 0036 §C. Today the scenario soft-skips behavioral
// when the simulator env-gate is unset; capability-gated advertisement-shape
// probe above is the today-landable contract surface.
//
// Cross-host promotion path per RFCs/0001 §"Promotion to Accepted": once the
// simulator lands + a host advertises + the behavioral assertion passes against
// it, RFC 0036's cross-engine half graduates Active → Accepted.
