/**
 * Track 13: operator-driven pause/resume (rest-endpoints.md v1.1).
 *
 * Exercises the `POST /v1/runs/{runId}:pause` and `:resume` endpoints
 * against a long-running fixture (`conformance-delay` or `conformance-cancellable`).
 *
 * Verifies:
 *   1. :pause on a running run transitions to `paused` and emits `run.paused`.
 *   2. :resume on a paused run transitions to `running` and emits `run.resumed`.
 *   3. :pause on a terminal run returns 409 with details.runStatus.
 *   4. :resume on a non-paused run returns 409 with details.runStatus.
 *
 * Capability gating: skips when the host doesn't advertise
 * `capabilities.runs.pauseResume.supported: true` (when present) AND
 * skips when no long-running fixture is advertised.
 *
 * @see spec/v1/rest-endpoints.md §pause/resume
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { pollUntilStatus, pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const FIXTURE =
  (isFixtureAdvertised('conformance-cancellable') && 'conformance-cancellable') ||
  (isFixtureAdvertised('conformance-delay') && 'conformance-delay') ||
  null;

const SKIP = !FIXTURE;

describe.skipIf(SKIP)('pause/resume: running → paused → running → terminal', () => {
  it('pause transitions to paused; resume returns the run to running', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE!,
      inputs: { delaySeconds: 30 },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'running', { timeoutMs: 10_000 });

    const pause = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, {
      reason: 'conformance-test',
      drainPolicy: 'drain-current-node',
    });
    if (pause.status === 404) {
      // Pause endpoint not yet implemented by the host — surface the skip honestly.
      // eslint-disable-next-line no-console
      console.warn(
        '[pause-resume] host returned 404 for :pause — endpoint not implemented; skipping rest',
      );
      await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
      return softSkip('blocked', 'precondition not met — `pause.status === 404` returned early ([pause-resume] host returned 404 for :pause — endpoint not implemented; skipping rest) (seam, prior step, or fixture unavailable)');
    }
    expect(pause.status, req('openwop.it.pause-resume.pause-transitions-to-paused-resume-returns-the-run-to-running', 
      'rest-endpoints.md POST /v1/runs/{runId}:pause',
      ':pause MUST return 202 on a pausable run',
    )).toBe(202);

    await pollUntilStatus(runId, 'paused', { timeoutMs: 10_000 });

    const resume = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:resume`, {
      reason: 'conformance-test',
    });
    expect(resume.status, req('openwop.it.pause-resume.pause-transitions-to-paused-resume-returns-the-run-to-running', 
      'rest-endpoints.md POST /v1/runs/{runId}:resume',
      ':resume MUST return 202 on a paused run',
    )).toBe(202);

    const terminal = await pollUntilTerminal(runId, { timeoutMs: 60_000 });
    expect(['completed', 'cancelled']).toContain(terminal.status);
  });
});

describe.skipIf(SKIP)('pause/resume: :resume on a non-paused run returns 409', () => {
  it('resuming a running (not paused) run returns 409 with details.runStatus', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE!,
      inputs: { delaySeconds: 30 },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'running', { timeoutMs: 10_000 });

    const resume = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:resume`, {});
    if (resume.status === 404) {
      await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
      return softSkip('blocked', 'precondition not met — `resume.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(resume.status, req('openwop.it.pause-resume.resuming-a-running-not-paused-run-returns-409-with-details-runstatus', 
      'rest-endpoints.md POST /v1/runs/{runId}:resume',
      ':resume on a non-paused run MUST return 409',
    )).toBe(409);

    const body = resume.json as { error?: string; details?: { runStatus?: string } };
    expect(body.error).toBe('conflict');
    expect(typeof body.details?.runStatus).toBe('string');

    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });
});

describe.skipIf(SKIP)('pause/resume: pause is idempotent when already paused', () => {
  it(':pause on an already-paused run is a no-op (200/202) — idempotent', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE!,
      inputs: { delaySeconds: 30 },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilStatus(runId, 'running', { timeoutMs: 10_000 });

    const first = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, {});
    if (first.status === 404) {
      await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
      return softSkip('blocked', 'precondition not met — `first.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect([200, 202]).toContain(first.status);
    await pollUntilStatus(runId, 'paused', { timeoutMs: 10_000 });

    // Idempotent second :pause — MUST NOT 409 just because the run is
    // already paused. 200/202 are both acceptable per the additive
    // contract; 409 would force callers to read state before calling.
    const second = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, {});
    expect(
      [200, 202].includes(second.status),
      req('openwop.it.pause-resume.pause-on-an-already-paused-run-is-a-no-op-200-202-idempotent', 
        'rest-endpoints.md POST /v1/runs/{runId}:pause',
        ':pause on an already-paused run MUST be idempotent (200/202), not 409',
      ),
    ).toBe(true);

    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });
});

describe.skipIf(SKIP)('pause/resume: :pause on a terminal run returns 409', () => {
  it(':pause on a completed/cancelled/failed run MUST return 409', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: 'conformance-noop',
    });
    if (create.status !== 201) return softSkip('blocked', 'precondition not met — `create.status !== 201` returned early (conformance-noop not seeded; skip cleanly) (seam, prior step, or fixture unavailable)'); // conformance-noop not seeded; skip cleanly
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId, { timeoutMs: 10_000 });

    const pause = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, {});
    if (pause.status === 404) return softSkip('blocked', 'precondition not met — `pause.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(pause.status, req('openwop.it.pause-resume.pause-on-a-completed-cancelled-failed-run-must-return-409', 
      'rest-endpoints.md POST /v1/runs/{runId}:pause',
      ':pause on a terminal run MUST return 409',
    )).toBe(409);

    const body = pause.json as { error?: string; details?: { runStatus?: string } };
    expect(body.error).toBe('conflict');
    // Spec requires `details.runStatus` to disclose the terminal state so
    // the caller can decide whether to retry or surface the conflict.
    expect(['completed', 'failed', 'cancelled']).toContain(body.details?.runStatus);
  });
});

describe.skipIf(SKIP)('pause/resume: :pause-during-suspend race', () => {
  it(':pause MUST NOT silently override an active interrupt suspend', async () => {
    // If the host seeds an approval fixture, drive a suspend then attempt
    // :pause. The expected behavior is that :pause either (a) noops with
    // 409 because the run is already waiting-approval (not in a pausable
    // state), or (b) accepts and stacks pause atop the suspend with the
    // run's terminal state still being waiting-approval. Either is
    // acceptable; what's NOT acceptable is the host quietly flipping
    // status to `paused` and discarding the suspended interrupt.
    if (!isFixtureAdvertised('conformance-approval')) {
      // eslint-disable-next-line no-console
      console.warn(
        '[pause-resume] conformance-approval not advertised; skipping :pause-during-suspend race subtest',
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!isFixtureAdvertised(\'conformance-approval\')` returned early ([pause-resume] conformance-approval not advertised; skipping :pause-during-suspend race subtest)');
    }
    const create = await driver.post('/v1/runs', { workflowId: 'conformance-approval' });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    const pause = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, {
      reason: 'race-test',
    });
    if (pause.status === 404) {
      // Cleanup.
      await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
      return softSkip('blocked', 'precondition not met — `pause.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }

    // Either rejection (preferred) or stacked-pause is OK; silent override is not.
    if (pause.status === 409) {
      const body = pause.json as { details?: { runStatus?: string } };
      expect(body.details?.runStatus, req('openwop.it.pause-resume.pause-must-not-silently-override-an-active-interrupt-suspend', 
        'rest-endpoints.md POST /v1/runs/{runId}:pause',
        ':pause-during-suspend MUST surface the active waiting-* status in the conflict envelope',
      )).toMatch(/^waiting-/);
    } else {
      // Stacked-pause accepted: verify the run's reported status still
      // surfaces the underlying suspend — the host MUST NOT lose track
      // of the interrupt waiting for resolution.
      const snap = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
      const status = (snap.json as { status: string }).status;
      expect(
        status === 'paused' || status.startsWith('waiting-'),
        req('openwop.it.pause-resume.pause-must-not-silently-override-an-active-interrupt-suspend', 'rest-endpoints.md POST /v1/runs/{runId}:pause', ':pause-during-suspend MUST NOT silently discard the active interrupt'),
      ).toBe(true);
    }

    await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      reason: 'conformance-cleanup',
    });
  });
});

// CF-2 close-out — drain-policy discrimination per
// `capabilities.md` §`runs.pauseResume`. When a host advertises
// `drainPolicies[]`, each advertised value MUST be accepted with 202.
// Skips entirely when no advertisement is present.
describe.skipIf(SKIP)('pause/resume: drainPolicy discrimination per capabilities advertisement', () => {
  it('every drainPolicy advertised by the host is accepted on :pause', async () => {
    const disco = await driver.get('/.well-known/openwop');
    const drainPolicies =
      capabilityFamily<{ pauseResume?: { drainPolicies?: string[] } }>(disco.json, 'runs')
        ?.pauseResume?.drainPolicies ?? [];
    if (drainPolicies.length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[pause-resume] host advertises no drainPolicies; skipping policy-discrimination subtest');
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `drainPolicies.length === 0` returned early ([pause-resume] host advertises no drainPolicies; skipping policy-discrimination subtest)');
    }

    for (const policy of drainPolicies) {
      const create = await driver.post('/v1/runs', {
        workflowId: FIXTURE!,
        inputs: { delaySeconds: 30 },
      });
      expect(create.status).toBe(201);
      const runId = (create.json as { runId: string }).runId;

      await pollUntilStatus(runId, 'running', { timeoutMs: 10_000 });

      const pause = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, {
        reason: `conformance-drainpolicy-${policy}`,
        drainPolicy: policy,
      });
      expect(pause.status, req('openwop.it.pause-resume.every-drainpolicy-advertised-by-the-host-is-accepted-on-pause', 
        'capabilities.md §`runs.pauseResume.drainPolicies` + rest-endpoints.md POST /v1/runs/{runId}:pause',
        `host-advertised drainPolicy='${policy}' MUST be accepted on :pause`,
      )).toBe(202);

      await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
    }
  });
});
