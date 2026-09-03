/**
 * Standing goals — judge-based completion + bounded continuation (RFC 0097;
 * `agent-runtime.md` §"Standing goals"). Public tests for the protocol-tier
 * SECURITY invariants `goal-continuation-bounded` and
 * `goal-completion-judge-only`.
 *
 * Two layers:
 *
 *   A. Always-on, server-free schema legs — the capability block, the
 *      `goal.schema.json` shape, and the content-free `goal.evaluated` /
 *      `goal.closed` event payloads.
 *
 *   B. Capability-gated behavioral legs — on a host advertising
 *      `capabilities.agents.goals` that exposes the `/v1/host/sample/goals`
 *      seam: bounded termination (a never-satisfied goal halts at
 *      `maxLoopIterations` with `state: bound-exceeded`) and judge-only
 *      completion (a client-supplied `state: satisfied` is refused). Hosts
 *      without the seam soft-skip (404); unadvertised hosts skip via the gate.
 *
 * @see spec/v1/agent-runtime.md §"Standing goals"
 * @see SECURITY/invariants.yaml id: goal-continuation-bounded, goal-completion-judge-only
 * @see RFCS/0097-standing-goals-and-judge-based-continuation.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('goal-standing-continuation: capability advertisement (RFC 0097 §A, server-free)', () => {
  it('capabilities schema declares agents.goals with its required sub-flags', () => {
    const caps = loadSchema('capabilities.schema.json');
    const agents = (caps.properties as Record<string, { properties?: Record<string, { properties?: Record<string, unknown>; required?: string[] }> }>).agents;
    const goals = agents?.properties?.goals;
    expect(goals, req('openwop.it.goal-standing-continuation.capabilities-schema-declares-agents-goals-with-its-required-sub-flags', 'capabilities.md §agents', 'agents.goals MUST be declared')).toBeDefined();
    for (const flag of ['judge', 'continuation', 'requiresBounds']) {
      expect(goals?.properties?.[flag], req('openwop.it.goal-standing-continuation.capabilities-schema-declares-agents-goals-with-its-required-sub-flags', 'RFC 0097 §A', `agents.goals.${flag} MUST be declared`)).toBeDefined();
    }
    expect(goals?.required, req('openwop.it.goal-standing-continuation.capabilities-schema-declares-agents-goals-with-its-required-sub-flags', 'RFC 0097 §A', 'judge + continuation MUST be required')).toEqual(
      expect.arrayContaining(['judge', 'continuation']),
    );
  });
});

describe('goal-standing-continuation: Goal shape (RFC 0097 §B, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema('goal.schema.json'));

  const good = {
    id: 'goal-1',
    objective: 'ship the release checklist',
    state: 'active',
    completion: { check: 'verifier', verifierRef: 'vf-1' },
    continuation: { mode: 'schedule', armRef: 'job-1' },
    bounds: { maxLoopIterations: 7 },
    owner: { tenant: 'acme' },
    createdAt: '2026-06-13T00:00:00Z',
  };

  it('validates a conforming active goal', () => {
    expect(validate(good), req('openwop.it.goal-standing-continuation.validates-a-conforming-active-goal', 'RFC 0097 §B', `a conforming goal MUST validate. Errors: ${JSON.stringify(validate.errors)}`)).toBe(true);
  });

  it('rejects an unknown state, an unknown judge, and a bad continuation mode', () => {
    expect(validate({ ...good, state: 'done' }), req('openwop.it.goal-standing-continuation.rejects-an-unknown-state-an-unknown-judge-and-a-bad-continuation-mode', 'RFC 0097 §B', 'a state outside the lifecycle enum MUST be rejected')).toBe(false);
    expect(validate({ ...good, completion: { check: 'vibes' } }), req('openwop.it.goal-standing-continuation.rejects-an-unknown-state-an-unknown-judge-and-a-bad-continuation-mode', 'RFC 0097 §B', 'judge check outside {verifier,host} MUST be rejected')).toBe(false);
    expect(validate({ ...good, continuation: { mode: 'whenever' } }), req('openwop.it.goal-standing-continuation.rejects-an-unknown-state-an-unknown-judge-and-a-bad-continuation-mode', 'RFC 0097 §B', 'continuation mode outside the enum MUST be rejected')).toBe(false);
  });
});

describe('goal-standing-continuation: content-free events (RFC 0097 §D, server-free)', () => {
  const runEvent = loadSchema('run-event.schema.json');
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(payloads, 'payloads');

  it('goal.evaluated and goal.closed are in the RunEventType enum', () => {
    const en = (runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum ?? [];
    expect(en, req('openwop.it.goal-standing-continuation.goal-evaluated-and-goal-closed-are-in-the-runeventtype-enum', 'RFC 0097', 'goal.evaluated and goal.closed are in the RunEventType enum')).toContain('goal.evaluated');
    expect(en).toContain('goal.closed');
  });

  it('goal.evaluated is content-free — an objective text field is rejected; goal.closed requires a terminal finalState', () => {
    const evaluated = ajv.getSchema('payloads#/$defs/goalEvaluated')!;
    expect(evaluated({ goalId: 'g1', satisfied: false, confidence: 0.4, runId: 'r1', iterations: 2 }), req('openwop.it.goal-standing-continuation.goal-evaluated-is-content-free-an-objective-text-field-is-rejected-goal-closed-r', 'RFC 0097 §D', 'a content-free goal.evaluated MUST validate')).toBe(true);
    expect(evaluated({ goalId: 'g1', satisfied: false, runId: 'r1', iterations: 2, objective: 'ship it' }), req('openwop.it.goal-standing-continuation.goal-evaluated-is-content-free-an-objective-text-field-is-rejected-goal-closed-r', 'RFC 0097 §D', 'goal.evaluated MUST NOT carry objective text')).toBe(false);
    const closed = ajv.getSchema('payloads#/$defs/goalClosed')!;
    expect(closed({ goalId: 'g1', finalState: 'bound-exceeded' }), req('openwop.it.goal-standing-continuation.goal-evaluated-is-content-free-an-objective-text-field-is-rejected-goal-closed-r', 'RFC 0097 §D', 'goal.closed with a terminal finalState MUST validate')).toBe(true);
    expect(closed({ goalId: 'g1', finalState: 'active' }), req('openwop.it.goal-standing-continuation.goal-evaluated-is-content-free-an-objective-text-field-is-rejected-goal-closed-r', 'RFC 0097 §D', 'goal.closed MUST NOT use the non-terminal `active` state')).toBe(false);
  });
});

describe('goal-standing-continuation: behavioral (RFC 0097 §E, capability-gated)', () => {
  it('a goal cannot be created without bounds when requiresBounds is advertised (422)', async () => {
    const agents = await readCapabilityFamily<{ goals?: { requiresBounds?: boolean } }>('agents');
    if (!behaviorGate('agents.goals', agents?.goals !== undefined)) return;
    if (agents?.goals?.requiresBounds === false) return softSkip('blocked', 'precondition not met — `agents?.goals?.requiresBounds === false` returned early (host opted out of mandatory bounds) (seam, prior step, or fixture unavailable)'); // host opted out of mandatory bounds

    const res = await driver.post('/v1/host/sample/goals', {
      objective: 'unbounded work',
      completion: { check: 'host' },
      continuation: { mode: 'manual' },
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    expect(
      res.status,
      req('openwop.it.goal-standing-continuation.a-goal-cannot-be-created-without-bounds-when-requiresbounds-is-advertised-422', 'agent-runtime.md §"Standing goals" clause 2', 'POST /goals without RFC 0058 bounds MUST be rejected (422) when requiresBounds is advertised'),
    ).toBe(422);
  });

  it('a client MUST NOT set state: satisfied directly', async () => {
    const agents = await readCapabilityFamily<{ goals?: unknown }>('agents');
    if (!behaviorGate('agents.goals', agents?.goals !== undefined)) return;

    const list = await driver.get('/v1/host/sample/goals?state=active');
    if (list.status === 404 || list.status === 403) return softSkip('blocked', 'precondition not met — `list.status === 404 || list.status === 403` returned early (seam, prior step, or fixture unavailable)');
    const goals = (list.json as { goals?: Array<{ id: string }> })?.goals ?? [];
    if (goals.length === 0) return softSkip('blocked', 'precondition not met — `goals.length === 0` returned early (seam, prior step, or fixture unavailable)');

    const res = await driver.post(`/v1/host/sample/goals/${goals[0]!.id}`, { state: 'satisfied' });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam, prior step, or fixture unavailable)');
    expect(
      res.status >= 400,
      req('openwop.it.goal-standing-continuation.a-client-must-not-set-state-satisfied-directly', 'agent-runtime.md §"Standing goals" clause 1', 'a client-supplied state: satisfied MUST be refused — completion is the judge\'s verdict'),
    ).toBe(true);
  });
});
