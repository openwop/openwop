/**
 * Inferred standing commitment — fire-once + content-free (RFC 0068, `Draft`).
 *
 * Gated on `capabilities.agents.commitments.supported`. Drives the
 * documented host seam `POST /v1/host/sample/commitment/fire` (staged per
 * the RFC 0027 §G precedent — soft-skips on 404/501 until a reference host
 * wires it). Asserts:
 *   - a fired commitment emits a content-free `commitment.fired` carrying
 *     `commitmentId` + `memoryRef` provenance + `condition` (RFC 0068 §C);
 *   - the event MUST NOT carry the inferred intention text (no-content);
 *   - the commitment fires at most once per satisfied condition.
 *
 * Hosts that omit the capability skip cleanly.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-memory.md §"Inferred commitments"
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0068-memory-consolidation-and-standing-commitments.md
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';

interface CommitmentCaps {
  agents?: { commitments?: { supported?: boolean } };
}

interface FireResult {
  event?: {
    commitmentId?: string;
    memoryRef?: string;
    condition?: string;
    [k: string]: unknown;
  };
  fireCount?: number;
  /** The plaintext intention the host inferred — used only to assert it does NOT appear on the event. */
  intentionCanary?: string;
}

async function commitmentsSupported(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return false;
  return Boolean((res.json as CommitmentCaps).agents?.commitments?.supported);
}

describe('commitment-fired: fire contract (RFC 0068 §C, capability-gated)', () => {
  it('a fired commitment emits a content-free event with memory provenance, exactly once', async () => {
    if (!(await commitmentsSupported())) return softSkip('inapplicable', 'capability absent — gated skip');

    const res = await driver.post('/v1/host/sample/commitment/fire', {
      memoryRef: 'mem://conformance/commitments',
      condition: 'predicate',
      includeIntentionCanary: true,
    });
    if (res.status === 404 || res.status === 501) return softSkip('blocked', 'seam not wired — soft-skip');

    expect(res.status, driver.describe('RFC 0068 §C', 'an advertised commitment seam MUST succeed')).toBe(200);
    const r = res.json as FireResult;

    // §C — required identifiers.
    expect(r.event?.commitmentId, driver.describe('RFC 0068 §C', 'commitment.fired MUST carry commitmentId')).toBeTruthy();
    expect(
      r.event?.memoryRef,
      driver.describe('RFC 0068 §C.1', 'commitment.fired MUST carry the source memoryRef (CTI-1 provenance)'),
    ).toBeTruthy();

    // §C.3 — content-free: the inferred intention text MUST NOT appear on the event.
    if (typeof r.intentionCanary === 'string' && r.intentionCanary.length > 0) {
      const serialized = JSON.stringify(r.event ?? {});
      expect(
        serialized.includes(r.intentionCanary),
        driver.describe('RFC 0068 §C.3', 'the inferred intention text MUST NOT appear on the commitment.fired payload'),
      ).toBe(false);
    }

    // §C.2 — fire-once-per-condition (when the seam reports a count).
    if (typeof r.fireCount === 'number') {
      expect(
        r.fireCount,
        driver.describe('RFC 0068 §C.2', 'a commitment MUST fire at most once per satisfied condition'),
      ).toBeLessThanOrEqual(1);
    }
  });
});
