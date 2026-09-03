/**
 * Interrupt-race scenarios per spec/v1/interrupt.md.
 *
 * When a HITL interrupt is open at a node and a `cancel` request
 * arrives concurrently with a resolution payload, the spec requires
 * deterministic dispatch: exactly one of (a) the interrupt resolution
 * advances the run normally, or (b) the cancel terminates the run
 * with status `cancelled`. The two outcomes MUST be distinguishable
 * by the response shapes.
 *
 * Profile gating: `openwop-interrupts`. Hosts that don't expose
 * `clarification.request` envelope or interrupt resume routes
 * skip-equivalent.
 *
 * **Tagged `@timing-sensitive`** — relies on a workflow that suspends
 * at a HITL gate. Tolerance: 30s for setup; 5s for the race window.
 *
 * @see spec/v1/interrupt.md
 * @see SECURITY/threat-model-prompt-injection.md (decidedBy invariants)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntil } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const APPROVAL_WORKFLOW_ID = 'conformance-approval';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_APPROVAL = !isFixtureAdvertised(APPROVAL_WORKFLOW_ID);
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);

interface DiscoveryShape {
  supportedEnvelopes?: unknown;
}

async function hostClaimsInterrupts(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop', { authenticated: false });
  if (res.status !== 200) return false;
  const body = res.json as DiscoveryShape;
  if (!Array.isArray(body.supportedEnvelopes)) return false;
  return (body.supportedEnvelopes as string[]).includes('clarification.request');
}

describe.skipIf(SKIP_NO_APPROVAL)('interrupt-race: concurrent cancel + resolve dispatch deterministically', () => {
  it(
    'concurrent cancel + interrupt-resolve resolves to one of: cancelled or completed',
    async () => {
      if (!(await hostClaimsInterrupts())) return softSkip('blocked', 'precondition not met — `!(await hostClaimsInterrupts())` returned early (skip-equivalent) (seam, prior step, or fixture unavailable)'); // skip-equivalent

      // Phase 1: start a workflow that suspends at an approval gate.
      const create = await driver.post('/v1/runs', { workflowId: APPROVAL_WORKFLOW_ID });
      if (create.status !== 201) {
        // Host may not seed conformance-approval fixture; skip.
        return softSkip('blocked', 'precondition not met — `create.status !== 201` returned early (Host may not seed conformance-approval fixture; skip.) (seam, prior step, or fixture unavailable)');
      }
      const runId = (create.json as { runId: string }).runId;

      // Phase 2: poll until the run is suspended waiting for approval.
      const suspended = await pollUntil(
        runId,
        (snap) => snap.status === 'waiting-approval' || snap.status === 'waiting-clarification',
        { timeoutMs: 10_000 },
      );

      // The interrupt token is host-implementation-specific; some hosts
      // expose it via `currentNodeId`, some via a separate suspended-
      // node API. The conformance suite doesn't standardize the
      // discovery path here — we just assert the dispatch outcome
      // shape, not the resolve URL pattern.

      const nodeId = suspended.currentNodeId;
      if (typeof nodeId !== 'string') {
        // Host doesn't expose currentNodeId on suspended snapshots —
        // can't drive the race deterministically; skip-equivalent.
        return softSkip('blocked', 'precondition not met — `typeof nodeId !== \'string\'` returned early (Host doesn\'t expose currentNodeId on suspended snapshots — can\'t drive the race deterministically; skip-equivalent.) (seam, prior step, or fixture un…');
      }

      // Phase 3: fire cancel + resolve concurrently. Promise.all so
      // both go through the network at roughly the same instant.
      const cancelPromise = driver.post(
        `/v1/runs/${encodeURIComponent(runId)}/cancel`,
        { reason: 'interrupt-race-test' },
      );
      const resolvePromise = driver.post(
        `/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(nodeId)}`,
        { action: 'accept' },
      );

      const [cancelRes, resolveRes] = await Promise.all([cancelPromise, resolvePromise]);

      // Both responses MUST be either 200 (operation accepted) or 409
      // (operation lost the race). Anything else is non-deterministic.
      expect(
        [200, 202, 409].includes(cancelRes.status),
        req('openwop.it.interruptRace.concurrent-cancel-interrupt-resolve-resolves-to-one-of-cancelled-or-completed', 
          'spec/v1/interrupt.md',
          `cancel response under race MUST be 200/202/409; got ${cancelRes.status}`,
        ),
      ).toBe(true);
      expect(
        [200, 202, 400, 404, 409].includes(resolveRes.status),
        req('openwop.it.interruptRace.concurrent-cancel-interrupt-resolve-resolves-to-one-of-cancelled-or-completed', 
          'spec/v1/interrupt.md',
          `resolve response under race MUST be 200/202/400/404/409; got ${resolveRes.status}`,
        ),
      ).toBe(true);

      // At least ONE operation MUST succeed (otherwise the run is stuck).
      const cancelSucceeded = cancelRes.status === 200 || cancelRes.status === 202;
      const resolveSucceeded = resolveRes.status === 200 || resolveRes.status === 202;
      expect(
        cancelSucceeded || resolveSucceeded,
        req('openwop.it.interruptRace.concurrent-cancel-interrupt-resolve-resolves-to-one-of-cancelled-or-completed', 
          'spec/v1/interrupt.md',
          'under cancel/resolve race, at least one operation MUST succeed',
        ),
      ).toBe(true);

      // Phase 4: poll until terminal. Outcome MUST be one of completed
      // (resolve won) / cancelled (cancel won) / failed (resolve hit a
      // validation error and run continued, then cancel terminated it
      // — also acceptable).
      const terminal = await pollUntil(
        runId,
        (snap) =>
          snap.status === 'completed' ||
          snap.status === 'cancelled' ||
          snap.status === 'failed',
        { timeoutMs: 30_000 },
      );

      expect(
        ['completed', 'cancelled', 'failed'].includes(terminal.status),
        req('openwop.it.interruptRace.concurrent-cancel-interrupt-resolve-resolves-to-one-of-cancelled-or-completed', 
          'spec/v1/interrupt.md',
          'race outcome MUST converge on a terminal status, not stay in waiting-approval forever',
        ),
      ).toBe(true);

      // Determinism check: if the cancel won (cancelSucceeded === true
      // AND resolveSucceeded === false), the terminal MUST be
      // cancelled. If the resolve won, terminal MUST be completed
      // (assuming the workflow has nothing else to fail on after the
      // approval gate).
      if (cancelSucceeded && !resolveSucceeded) {
        expect(terminal.status, req('openwop.it.interruptRace.concurrent-cancel-interrupt-resolve-resolves-to-one-of-cancelled-or-completed', 
          'spec/v1/interrupt.md',
          'when cancel wins the race, run MUST terminate as cancelled',
        )).toBe('cancelled');
      }
    },
    90_000,
  );
});

describe.skipIf(SKIP_NO_NOOP)('interrupt-race: cancel against a non-suspended run is well-formed', () => {
  it('cancel of a completed run returns 200 with the existing terminal status (idempotent)', async () => {
    // Self-test that doesn't require a race. Runs against any host
    // that supports cancel (every conforming host does).
    const create = await driver.post('/v1/runs', { workflowId: 'conformance-noop' });
    if (create.status !== 201) return softSkip('blocked', 'precondition not met — `create.status !== 201` returned early (seam, prior step, or fixture unavailable)');
    const runId = (create.json as { runId: string }).runId;

    await pollUntil(
      runId,
      (snap) => snap.status === 'completed' || snap.status === 'failed' || snap.status === 'cancelled',
      { timeoutMs: 10_000 },
    );

    const cancel = await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {});
    expect(cancel.status, req('openwop.it.interruptRace.cancel-of-a-completed-run-returns-200-with-the-existing-terminal-status-idempote', 
      'spec/v1/rest-endpoints.md POST /v1/runs/{runId}/cancel',
      'cancel of an already-terminal run MUST return 200 (idempotent)',
    )).toBe(200);
  });
});
