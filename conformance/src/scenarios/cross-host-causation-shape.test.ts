/**
 * cross-host-causation-shape — RFC 0040 advertisement-shape + payload-field shape.
 *
 * Status: ACTIVE (advertisement-shape). RFC 0040 Phase 3 filed Draft
 * 2026-05-22. Capability-gated on
 * `capabilities.multiAgent.executionModel.crossHostCausation.supported: true`.
 * Hosts that don't advertise soft-skip cleanly.
 *
 * Asserts (advertisement-shape — always-on when discovery is reachable):
 *
 *   1. capabilities.multiAgent.executionModel.crossHostCausation.supported
 *      MUST be boolean when present.
 *   2. When crossHostCausation.supported: true, hostId MUST be present + non-empty.
 *   3. ancestryEndpointSupported (when present) MUST be boolean.
 *   4. When crossHostCausation.supported: true, the host's executionModel.version
 *      MUST be >= 3 (Phase 3 requires the multi-agent execution model framework).
 *
 * Behavioral assertion (payload-field shape, soft-skipped when no host
 * emits cross-host events): cross-host event payloads carry
 * `causationHostId` matching the originating host's hostId. Lands when
 * a cross-host composition test fixture ships.
 *
 * @see RFCS/0040-multi-agent-cross-host-causation.md
 * @see spec/v1/multi-agent-execution.md §"Cross-host causation (RFC 0040 Phase 3, normative)"
 * @see schemas/capabilities.schema.json §multiAgent.executionModel.crossHostCausation
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    multiAgent?: {
      executionModel?: {
        supported?: unknown;
        version?: unknown;
        crossHostCausation?: {
          supported?: unknown;
          hostId?: unknown;
          ancestryEndpointSupported?: unknown;
        };
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

describe.skipIf(HTTP_SKIP)('cross-host-causation-shape: advertisement shape (RFC 0040 §D)', () => {
  it('crossHostCausation (when present) conforms to RFC 0040 §D', async (ctx) => {
    const d = await readDiscovery();
    if (d === null) {
      softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
      ctx.skip();
      return softSkip('blocked', 'precondition not met — `d === null` returned early (seam, prior step, or fixture unavailable)');
    }
    const chc = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.crossHostCausation;
    if (chc === undefined) {
      softSkip('inapplicable', 'optional advertisement — `multiAgent.executionModel.crossHostCausation` not advertised by this host (RFC 0040 §D)');
      ctx.skip(); // host doesn't advertise — soft-skip
      return softSkip('blocked', 'precondition not met — `chc === undefined` returned early (seam, prior step, or fixture unavailable)');
    }

    expect(
      typeof chc.supported,
      req('openwop.it.cross-host-causation-shape.crosshostcausation-when-present-conforms-to-rfc-0040-d', 
        'RFCS/0040-multi-agent-cross-host-causation.md §D',
        'crossHostCausation.supported MUST be boolean when present',
      ),
    ).toBe('boolean');

    if (chc.supported === true) {
      const version = capabilityFamily<{ executionModel?: { [k: string]: unknown; crossHostCausation?: Record<string, unknown>; replayDeterminism?: Record<string, unknown> } }>(d, 'multiAgent')?.executionModel?.version as number | undefined;
      expect(
        typeof version === 'number' && version >= 3,
        req('openwop.it.cross-host-causation-shape.crosshostcausation-when-present-conforms-to-rfc-0040-d', 
          'RFCS/0040-multi-agent-cross-host-causation.md §D',
          'when crossHostCausation.supported: true, multiAgent.executionModel.version MUST be >= 3',
        ),
      ).toBe(true);

      expect(
        typeof chc.hostId === 'string' && (chc.hostId as string).length >= 1,
        req('openwop.it.cross-host-causation-shape.crosshostcausation-when-present-conforms-to-rfc-0040-d', 
          'RFCS/0040-multi-agent-cross-host-causation.md §D',
          'when crossHostCausation.supported: true, hostId MUST be present + non-empty',
        ),
      ).toBe(true);
    }

    if (chc.ancestryEndpointSupported !== undefined) {
      expect(
        typeof chc.ancestryEndpointSupported,
        req('openwop.it.cross-host-causation-shape.crosshostcausation-when-present-conforms-to-rfc-0040-d', 
          'RFCS/0040-multi-agent-cross-host-causation.md §D',
          'ancestryEndpointSupported MUST be boolean when present',
        ),
      ).toBe('boolean');
    }
  });
});

// Behavioral payload-field assertion lands when a cross-host composition test
// fixture ships. Expected: a `core.workflowChain.event` (or any payload type
// listed in spec/v1/multi-agent-execution.md §"causationHostId payload field")
// emitted in response to a cross-host invocation carries `causationHostId`
// equal to the originating host's advertised hostId. Today's reference
// workflow-engine sample doesn't have a cross-host fixture; the assertion
// soft-skips on hosts that don't emit cross-host events.
