/**
 * Live manifest-dispatch invocation bracket (RFC 0077 §E) — behavioral.
 *
 * Gated on `capabilities.agents.liveRuntime.supported` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape coverage lives in
 * `agent-live-runtime-shape.test.ts`; this asserts host BEHAVIOR: a live
 * invocation brackets its `agent.*` family with
 * `agent.invocation.started` (FIRST agent-scoped event) and
 * `agent.invocation.completed` (LAST), with a matching `invocationId`, a
 * `source` in the enum, an `outcome` in the enum, and both events content-free
 * (no prompt/result body).
 *
 * Drives the OPTIONAL `POST /v1/host/sample/agents/live-invoke` seam + reads the
 * bracket back via the test event-log seam (both deferred per RFC 0077
 * §Conformance — soft-skip on 404).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/multi-agent-execution.md (§"Live manifest dispatch")
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0077-agent-run-lifecycle-and-live-manifest-dispatch.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readLiveRuntimeCap, invokeLive } from '../lib/liveRuntime.js';
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';

const SOURCES = ['workflow-node', 'run-api', 'chat-mention'];
const OUTCOMES = ['completed', 'handed-off', 'escalated', 'refused', 'failed'];
const AGENT_SCOPED = (t: string): boolean => t === 'agent.invocation.started' || t === 'agent.invocation.completed' || t.startsWith('agent.');

describe('agent-live-invocation-bracket (RFC 0077 §E)', () => {
  it('brackets a live invocation with started-first / completed-last + matching invocationId, content-free', async () => {
    const cap = await readLiveRuntimeCap();
    if (!behaviorGate('openwop-live-invocation-bracket', cap?.supported === true)) return;

    if (!(await isEventLogSeamAvailable())) return; // event-log seam absent — soft-skip
    const res = await invokeLive({ source: 'run-api' });
    if (res === null || !res.runId) return; // live-invoke seam absent — soft-skip

    const q = await queryTestEvents(res.runId);
    if (!q.ok) return;
    const events = q.events.slice().sort((a, b) => a.sequence - b.sequence);

    const started = events.filter((e) => e.type === 'agent.invocation.started');
    const completed = events.filter((e) => e.type === 'agent.invocation.completed');
    expect(
      started.length >= 1 && completed.length >= 1,
      driver.describe('multi-agent-execution.md §"Live manifest dispatch"', 'a live invocation MUST emit agent.invocation.started + agent.invocation.completed'),
    ).toBe(true);
    if (started.length === 0 || completed.length === 0) return;

    const start = started[0]!;
    const end = completed[completed.length - 1]!;

    // §E ordering: started is the FIRST agent-scoped event, completed the LAST.
    const agentScoped = events.filter((e) => AGENT_SCOPED(e.type));
    expect(
      agentScoped[0]?.type === 'agent.invocation.started',
      driver.describe('RFC 0077 §E', 'agent.invocation.started MUST be the first agent-scoped event of the invocation'),
    ).toBe(true);
    expect(
      agentScoped[agentScoped.length - 1]?.type === 'agent.invocation.completed',
      driver.describe('RFC 0077 §E', 'agent.invocation.completed MUST be the last agent-scoped event of the invocation'),
    ).toBe(true);

    // Matching invocationId across the bracket.
    const startId = start.payload.invocationId;
    const endId = end.payload.invocationId;
    expect(
      typeof startId === 'string' && startId === endId,
      driver.describe('run-event-payloads.schema.json#agentInvocation*', 'the bracket MUST share one invocationId'),
    ).toBe(true);

    // Enum discipline.
    expect(
      typeof start.payload.source === 'string' && SOURCES.includes(start.payload.source as string),
      driver.describe('run-event-payloads.schema.json#agentInvocationStarted', 'source MUST be workflow-node|run-api|chat-mention'),
    ).toBe(true);
    expect(
      typeof end.payload.outcome === 'string' && OUTCOMES.includes(end.payload.outcome as string),
      driver.describe('run-event-payloads.schema.json#agentInvocationCompleted', 'outcome MUST be in the closed enum'),
    ).toBe(true);

    // Content-free: identifiers + metadata only, never prompt/result body.
    for (const evt of [start, end]) {
      for (const forbidden of ['prompt', 'result', 'body', 'input', 'output', 'apiKey', 'secret', 'credentials', 'token']) {
        expect(
          !(forbidden in evt.payload),
          driver.describe('RFC 0077', `agent.invocation.* MUST be content-free (no ${forbidden})`),
        ).toBe(true);
      }
    }

    await resetTestSeam();
  });
});
