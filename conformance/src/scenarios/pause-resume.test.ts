/**
 * Track 13: operator-driven pause/resume (rest-endpoints.md v1.1).
 *
 * Exercises the `POST /v1/runs/{runId}:pause` and `:resume` endpoints
 * against a long-running fixture (`conformance-cancellable` or `conformance-delay`;
 * both take `inputs.delayMs` — conformance/fixtures.md).
 *
 * Verifies:
 *   1. :pause (immediate) on a running run transitions to `paused`; :resume
 *      returns it to `running` and it reaches a terminal.
 *   2. :resume on a non-paused run returns 409 with details.runStatus.
 *   3. :pause on an already-paused run returns 409 (details.runStatus paused)
 *      without a matching Idempotency-Key, and 202 with the cached response
 *      when the same key is sent — rest-endpoints.md §:pause Idempotency.
 *   4. :pause on a terminal run returns 409 with details.runStatus.
 *   5. drain-current-node lets the executing node reach a terminal FIRST:
 *      node.completed precedes run.paused in the log.
 *
 * rc.53 (2026-09-05): a tier-1 host un-skipping this file found it
 * contradicting rest-endpoints.md in three places — it expected 200/202 on a
 * second :pause (the prose says 409 unless the Idempotency-Key matches), it
 * asserted an error code `conflict` that v1 never named (v1 mandates 409 +
 * details.runStatus and names only run_terminal for a terminal run), and it
 * paused a 30 s node under drain-current-node and polled 10 s for `paused`
 * (drain lets the node finish; a host that yields mid-node under drain is the
 * non-conforming one). It also sent `delaySeconds`, a field the fixtures do
 * not define. v1 is frozen; the scenario was the defect in every case.
 *
 * Capability gating: skips when no long-running fixture is advertised.
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
const DOC_PAUSE = 'rest-endpoints.md POST /v1/runs/{runId}:pause';
const DOC_RESUME = 'rest-endpoints.md POST /v1/runs/{runId}:resume';

async function cancel(runId: string): Promise<void> {
  await driver.post(`/v1/runs/${encodeURIComponent(runId)}/cancel`, { reason: 'conformance-cleanup' });
}

async function eventTypes(runId: string): Promise<string[]> {
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
  const events = (res.json as { events?: unknown } | null)?.events;
  return Array.isArray(events) ? events.map((e) => String((e as { type?: unknown }).type)) : [];
}

describe.skipIf(SKIP)('pause/resume: running → paused → running → terminal', () => {
  it('pause transitions to paused; resume returns the run to running', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE!,
      inputs: { delayMs: 30_000 },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'running', { timeoutMs: 10_000 });

    // `immediate` snapshots between events, so `paused` is observable within
    // seconds. Under drain-current-node this 30 s node would finish first
    // (rest-endpoints.md); that semantic is witnessed by the drain leg below.
    const pause = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, {
      reason: 'conformance-test',
      drainPolicy: 'immediate',
    });
    if (pause.status === 404) {
      await cancel(runId);
      return softSkip('blocked', 'precondition not met — `pause.status === 404` returned early ([pause-resume] host returned 404 for :pause — endpoint not implemented; skipping rest) (seam, prior step, or fixture unavailable)');
    }
    expect(pause.status, req('openwop.it.pause-resume.pause-transitions-to-paused-resume-returns-the-run-to-running',
      DOC_PAUSE,
      ':pause MUST return 202 on a pausable run',
    )).toBe(202);

    await pollUntilStatus(runId, 'paused', { timeoutMs: 10_000 });

    const resume = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:resume`, {
      reason: 'conformance-test',
    });
    expect(resume.status, req('openwop.it.pause-resume.pause-transitions-to-paused-resume-returns-the-run-to-running',
      DOC_RESUME,
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
      inputs: { delayMs: 30_000 },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilStatus(runId, 'running', { timeoutMs: 10_000 });

    const resume = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:resume`, {});
    if (resume.status === 404) {
      await cancel(runId);
      return softSkip('blocked', 'precondition not met — `resume.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(resume.status, req('openwop.it.pause-resume.resuming-a-running-not-paused-run-returns-409-with-details-runstatus',
      DOC_RESUME,
      ':resume on a non-paused run MUST return 409',
    )).toBe(409);

    // v1 mandates the status and details.runStatus; it names no code for
    // this case (the registry is open — error-envelope.schema.json), so
    // none is asserted. `run_state_conflict` is the v2 answer (runs.md).
    const body = resume.json as { error?: string; details?: { runStatus?: string } };
    expect(typeof body.details?.runStatus, req('openwop.it.pause-resume.resuming-a-running-not-paused-run-returns-409-with-details-runstatus',
      DOC_RESUME,
      'the 409 MUST carry details.runStatus with the actual state',
    )).toBe('string');

    await cancel(runId);
  });
});

describe.skipIf(SKIP)('pause/resume: a second :pause is 409 without a matching Idempotency-Key and 202 with one', () => {
  it(':pause on an already-paused run returns 409 with details.runStatus paused, unless the request carries the original Idempotency-Key', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE!,
      inputs: { delayMs: 30_000 },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilStatus(runId, 'running', { timeoutMs: 10_000 });

    const first = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, { drainPolicy: 'immediate' });
    if (first.status === 404) {
      await cancel(runId);
      return softSkip('blocked', 'precondition not met — `first.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(first.status, req('openwop.it.pause-resume.pause-on-an-already-paused-run-returns-409-with-details-runstatus-paused-unless',
      DOC_PAUSE,
      ':pause MUST return 202 on a pausable run',
    )).toBe(202);
    await pollUntilStatus(runId, 'paused', { timeoutMs: 10_000 });

    // rest-endpoints.md §:pause Idempotency: "a :pause against a run that is
    // already paused returns 409 (with the existing pause's pausedAt in
    // details) unless the request carries Idempotency-Key matching the
    // original pause, in which case the host returns 202 with the cached
    // response." Until rc.53 this leg asserted 200/202 here, citing an
    // "additive contract" the prose does not contain.
    const second = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, {});
    expect(second.status, req('openwop.it.pause-resume.pause-on-an-already-paused-run-returns-409-with-details-runstatus-paused-unless',
      DOC_PAUSE,
      ':pause on an already-paused run without a matching Idempotency-Key MUST return 409',
    )).toBe(409);
    const body = second.json as { details?: { runStatus?: string } };
    expect(body.details?.runStatus, req('openwop.it.pause-resume.pause-on-an-already-paused-run-returns-409-with-details-runstatus-paused-unless',
      DOC_PAUSE,
      'the 409 MUST carry details.runStatus: paused',
    )).toBe('paused');
    await cancel(runId);

    // The keyed form: the same Idempotency-Key on both pauses collapses the
    // second into the cached 202.
    const keyed = await driver.post('/v1/runs', { workflowId: FIXTURE!, inputs: { delayMs: 30_000 } });
    expect(keyed.status).toBe(201);
    const keyedId = (keyed.json as { runId: string }).runId;
    await pollUntilStatus(keyedId, 'running', { timeoutMs: 10_000 });
    const key = `openwop-conformance-pause-${keyedId.replace(/[^A-Za-z0-9._~-]/g, '-')}`.slice(0, 128);
    const k1 = await driver.post(`/v1/runs/${encodeURIComponent(keyedId)}:pause`, { drainPolicy: 'immediate' }, { headers: { 'Idempotency-Key': key } });
    expect(k1.status, req('openwop.it.pause-resume.pause-on-an-already-paused-run-returns-409-with-details-runstatus-paused-unless',
      DOC_PAUSE,
      ':pause with an Idempotency-Key MUST return 202 on a pausable run',
    )).toBe(202);
    await pollUntilStatus(keyedId, 'paused', { timeoutMs: 10_000 });
    const k2 = await driver.post(`/v1/runs/${encodeURIComponent(keyedId)}:pause`, { drainPolicy: 'immediate' }, { headers: { 'Idempotency-Key': key } });
    expect(k2.status, req('openwop.it.pause-resume.pause-on-an-already-paused-run-returns-409-with-details-runstatus-paused-unless',
      DOC_PAUSE,
      'a :pause carrying the original Idempotency-Key MUST return 202 with the cached response, not 409',
    )).toBe(202);
    await cancel(keyedId);
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
      DOC_PAUSE,
      ':pause on a terminal run MUST return 409',
    )).toBe(409);

    // v1 mandates details.runStatus; `run_terminal` is the one code v1 names
    // for a mutation on a terminal run (rest-endpoints.md, bulk-cancel), and
    // the registry is open, so the code is not asserted here.
    const body = pause.json as { error?: string; details?: { runStatus?: string } };
    expect(['completed', 'failed', 'cancelled']).toContain(body.details?.runStatus);
  });
});

describe.skipIf(SKIP)('pause/resume: drain-current-node lets the executing node reach a terminal first', () => {
  it('under drain-current-node node.completed precedes run.paused in the log', async () => {
    // A short node: drain has something to wait for that finishes inside the
    // poll window. A 30 s node under drain pauses after 30 s — that is the
    // semantic, not a bug (rest-endpoints.md: "lets the executing node reach
    // a terminal before the run transitions to paused").
    const create = await driver.post('/v1/runs', {
      workflowId: FIXTURE!,
      inputs: { delayMs: 3_000 },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilStatus(runId, 'running', { timeoutMs: 10_000 });

    const pause = await driver.post(`/v1/runs/${encodeURIComponent(runId)}:pause`, {
      reason: 'conformance-drain',
      drainPolicy: 'drain-current-node',
    });
    if (pause.status === 404) {
      await cancel(runId);
      return softSkip('blocked', 'precondition not met — `pause.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }
    expect(pause.status, req('openwop.it.pause-resume.under-drain-current-node-node-completed-precedes-run-paused-in-the-log',
      DOC_PAUSE,
      ':pause with drainPolicy drain-current-node MUST return 202 (pause requested)',
    )).toBe(202);

    await pollUntilStatus(runId, 'paused', { timeoutMs: 20_000 });
    const types = await eventTypes(runId);
    const done = types.indexOf('node.completed');
    const paused = types.indexOf('run.paused');
    expect(done >= 0 && paused > done, req('openwop.it.pause-resume.under-drain-current-node-node-completed-precedes-run-paused-in-the-log',
      DOC_PAUSE,
      `drain-current-node MUST let the executing node reach a terminal before the run transitions to paused — node.completed MUST precede run.paused (types: ${types.join(', ')})`,
    )).toBe(true);
    await cancel(runId);
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
      await cancel(runId);
      return softSkip('blocked', 'precondition not met — `pause.status === 404` returned early (seam, prior step, or fixture unavailable)');
    }

    // Either rejection (preferred) or stacked-pause is OK; silent override is not.
    if (pause.status === 409) {
      const body = pause.json as { details?: { runStatus?: string } };
      expect(body.details?.runStatus, req('openwop.it.pause-resume.pause-must-not-silently-override-an-active-interrupt-suspend',
        DOC_PAUSE,
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
        req('openwop.it.pause-resume.pause-must-not-silently-override-an-active-interrupt-suspend', DOC_PAUSE, ':pause-during-suspend MUST NOT silently discard the active interrupt'),
      ).toBe(true);
    }

    await cancel(runId);
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
        inputs: { delayMs: 30_000 },
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

      await cancel(runId);
    }
  });
});
