/**
 * Cap-breach scenarios (G4 / CC-1) — exercises `conformance-cap-breach`
 * fixture with `RunOptions.configurable.recursionLimit: 3` to trigger the
 * per-run nodeExecutionCount cap.
 *
 * Verifies:
 *   1. Run reaches terminal `failed` with `error.code = "recursion_limit_exceeded"`.
 *   2. `cap.breached` event is emitted with `kind: "node-executions"` payload
 *      containing `limit`, `observed`, and `nodeId`.
 *   3. `cap.breached` precedes `run.failed` in the event log (the breach is
 *      detected BEFORE the over-limit node fires, so `node.started` for the
 *      over-limit node MUST NOT appear).
 *
 * Spec references:
 *   - run-options.md §recursionLimit
 *   - observability.md §cap.breached
 *   - schemas/run-event-payloads.schema.json §capBreached
 *   - docs/spec gap G4
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

const WORKFLOW_ID = 'conformance-cap-breach';
const RECURSION_LIMIT = 3;
const SKIP_NO_FIXTURE = !isFixtureAdvertised(WORKFLOW_ID);

interface RunEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly nodeId?: string;
  readonly type: string;
  readonly sequence: number;
  readonly payload?: unknown;
}

describe.skipIf(SKIP_NO_FIXTURE)('cap-breach: conformance-cap-breach fixture fails with recursion_limit_exceeded', () => {
  it('emits cap.breached + transitions to terminal failed when configurable.recursionLimit is exceeded', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      configurable: { recursionLimit: RECURSION_LIMIT },
    });
    expect(create.status, req('openwop.it.cap-breach.emits-cap-breached-transitions-to-terminal-failed-when-configurable-recursionlim', 
      'rest-endpoints.md POST /v1/runs',
      'run creation MUST accept the request even when configurable.recursionLimit is below the workflow size',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);

    expect(terminal.status, req('openwop.it.cap-breach.emits-cap-breached-transitions-to-terminal-failed-when-configurable-recursionlim', 
      'fixtures.md conformance-cap-breach §Terminal status',
      'fixture MUST reach terminal `failed` when recursion limit is exceeded',
    )).toBe('failed');

    expect(terminal.error?.code, req('openwop.it.cap-breach.emits-cap-breached-transitions-to-terminal-failed-when-configurable-recursionlim', 
      'run-options.md §recursionLimit',
      'RunSnapshot.error.code MUST equal "recursion_limit_exceeded"',
    )).toBe('recursion_limit_exceeded');

    expect(typeof terminal.error?.message, req('openwop.it.cap-breach.emits-cap-breached-transitions-to-terminal-failed-when-configurable-recursionlim', 
      'rest-endpoints.md RunSnapshot.error.message',
      'RunSnapshot.error.message MUST be a string',
    )).toBe('string');

    const eventsRes = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
    );
    expect(eventsRes.status).toBe(200);
    const events = (eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? [];

    const capBreachEvents = events.filter((e) => e.type === 'cap.breached');
    expect(capBreachEvents.length, req('openwop.it.cap-breach.emits-cap-breached-transitions-to-terminal-failed-when-configurable-recursionlim', 
      'observability.md §cap.breached',
      'exactly one cap.breached event MUST be emitted on recursion-limit exceedance',
    )).toBe(1);

    const breach = capBreachEvents[0];
    const payload = breach.payload as
      | { kind?: string; limit?: number; observed?: number; nodeId?: string }
      | undefined;

    expect(payload?.kind, req('openwop.it.cap-breach.emits-cap-breached-transitions-to-terminal-failed-when-configurable-recursionlim', 
      'run-event-payloads.schema.json §capBreached.kind',
      'cap.breached payload MUST carry kind="node-executions"',
    )).toBe('node-executions');

    expect(payload?.limit, req('openwop.it.cap-breach.emits-cap-breached-transitions-to-terminal-failed-when-configurable-recursionlim', 
      'run-event-payloads.schema.json §capBreached.limit',
      'cap.breached payload MUST carry the resolved limit (3 from configurable.recursionLimit)',
    )).toBe(RECURSION_LIMIT);

    expect(typeof payload?.observed, req('openwop.it.cap-breach.emits-cap-breached-transitions-to-terminal-failed-when-configurable-recursionlim', 
      'run-event-payloads.schema.json §capBreached.observed',
      'cap.breached payload MUST carry the observed count as a number',
    )).toBe('number');
    expect(payload?.observed).toBeGreaterThan(RECURSION_LIMIT);

    expect(typeof payload?.nodeId, req('openwop.it.cap-breach.emits-cap-breached-transitions-to-terminal-failed-when-configurable-recursionlim', 
      'run-event-payloads.schema.json §capBreached.nodeId',
      'cap.breached payload MUST carry the offending nodeId for node-executions kind',
    )).toBe('string');
  });

  it('cap.breached precedes run.failed in the event sequence (breach detected before over-limit node fires)', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: WORKFLOW_ID,
      configurable: { recursionLimit: RECURSION_LIMIT },
    });
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const eventsRes = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
    );
    const events = (eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? [];

    const capBreach = events.find((e) => e.type === 'cap.breached');
    const runFailed = events.find((e) => e.type === 'run.failed');

    expect(capBreach, req('openwop.it.cap-breach.cap-breached-precedes-run-failed-in-the-event-sequence-breach-detected-before-ov', 'observability.md §event ordering', 'cap.breached MUST be emitted')).toBeDefined();
    expect(runFailed, req('openwop.it.cap-breach.cap-breached-precedes-run-failed-in-the-event-sequence-breach-detected-before-ov', 'observability.md §event ordering', 'run.failed MUST be emitted')).toBeDefined();

    expect(capBreach!.sequence, req('openwop.it.cap-breach.cap-breached-precedes-run-failed-in-the-event-sequence-breach-detected-before-ov', 
      'observability.md §event ordering',
      'cap.breached MUST precede run.failed in sequence (breach detected BEFORE over-limit node fires)',
    )).toBeLessThan(runFailed!.sequence);

    // Count node.started events. With recursionLimit=3 and the breach
    // detected BEFORE the 4th node fires, AT MOST 3 node.started events
    // SHOULD appear (the over-limit node MUST NOT receive node.started).
    // We assert a range rather than equality to tolerate transient pre-
    // breach node failures (e.g. a `node.failed` cutting the chain
    // short) — those would emit fewer than `RECURSION_LIMIT` started
    // events while still satisfying the invariant.
    const nodeStarted = events.filter((e) => e.type === 'node.started');
    expect(nodeStarted.length, req('openwop.it.cap-breach.cap-breached-precedes-run-failed-in-the-event-sequence-breach-detected-before-ov', 
      'run-options.md §recursionLimit',
      'at most `limit` node.started events MUST be emitted; the over-limit node MUST NOT receive node.started',
    )).toBeLessThanOrEqual(RECURSION_LIMIT);
    expect(nodeStarted.length, req('openwop.it.cap-breach.cap-breached-precedes-run-failed-in-the-event-sequence-breach-detected-before-ov', 
      'run-options.md §recursionLimit',
      'at least one node MUST start before the breach (otherwise the workflow never executed)',
    )).toBeGreaterThan(0);
  });
});
