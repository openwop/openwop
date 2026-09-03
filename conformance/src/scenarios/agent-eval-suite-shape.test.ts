/**
 * Agent evaluation — suite + summary + event shapes (RFC 0081).
 *
 * Always-on, server-free schema-shape probe. Verifies that:
 *   - `capabilities.agents.evalSuite` is declared with its `supported` / `modes`
 *     sub-flags.
 *   - the `AgentEvalSuite` + `EvalSummary` schemas compile and round-trip a
 *     conforming artifact, and reject malformed ones (a bad `suiteId`; a
 *     `thresholds.passScore` out of 0..1).
 *   - the `eval.started` / `eval.scored` / `eval.completed` payload $defs
 *     validate conforming content-free payloads and reject malformed ones.
 *   - both the summary and the per-task `eval.scored` payload are CONTENT-FREE:
 *     an `EvalSummary` carrying a task-output body and a `safetyFinding` carrying
 *     an excerpt are rejected. This is the public test for the protocol-tier
 *     SECURITY invariant `eval-summary-no-content-leak`.
 *   - all three event names appear in the RunEventType enum.
 *
 * Behavioral assertions (the eval-run event ordering, per-task scoring, the
 * EvalSummary round-trip against a live host, the `mode: "eval"` 501 on
 * unadvertised hosts) are gated on `capabilities.agents.evalSuite.supported` and
 * land in `agent-eval-run.test.ts` (deferred per RFC 0081 §Conformance — reference
 * host deferred). This scenario asserts the wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-evaluation.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0081-agent-evaluation-and-scorecards.md
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (eval-summary-no-content-leak)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('agent-eval-suite-shape: capability advertisement (RFC 0081, server-free)', () => {
  it('the capabilities schema declares agents.evalSuite with its sub-flags', () => {
    const caps = loadSchema('capabilities.schema.json');
    const agents = (caps.properties as Record<string, { properties?: Record<string, { properties?: Record<string, unknown> }> }>).agents;
    const evalSuite = agents?.properties?.evalSuite;
    expect(
      evalSuite,
      req('openwop.it.agent-eval-suite-shape.the-capabilities-schema-declares-agents-evalsuite-with-its-sub-flags', 'capabilities.md §agents', 'agents.evalSuite MUST be declared'),
    ).toBeDefined();
    for (const flag of ['supported', 'modes']) {
      expect(
        evalSuite?.properties?.[flag],
        req('openwop.it.agent-eval-suite-shape.the-capabilities-schema-declares-agents-evalsuite-with-its-sub-flags', 'agent-evaluation.md §Capability advertisement', `agents.evalSuite.${flag} MUST be declared`),
      ).toBeDefined();
    }
  });
});

describe('agent-eval-suite-shape: AgentEvalSuite + EvalSummary schemas (RFC 0081, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const suite = ajv.compile(loadSchema('agent-eval-suite.schema.json'));
  const summary = ajv.compile(loadSchema('eval-summary.schema.json'));

  it('AgentEvalSuite validates a conforming suite and rejects a malformed suiteId / out-of-range threshold', () => {
    const good = {
      suiteId: 'core.openwop.evals.support-resolver',
      version: '1.0.0',
      modes: ['golden', 'regression'],
      thresholds: { passScore: 0.8 },
      tasks: [
        { taskId: 'refund-window', input: { q: 'refund policy?' }, expected: { kind: 'golden', match: { strategy: 'contains', value: '30 days' } } },
      ],
    };
    expect(suite(good), req('openwop.it.agent-eval-suite-shape.agentevalsuite-validates-a-conforming-suite-and-rejects-a-malformed-suiteid-out', 'RFC 0081 §A', 'a conforming AgentEvalSuite MUST validate')).toBe(true);
    // Negative: suiteId must carry the `.evals.` infix.
    expect(suite({ ...good, suiteId: 'core.openwop.support-resolver' }), req('openwop.it.agent-eval-suite-shape.agentevalsuite-validates-a-conforming-suite-and-rejects-a-malformed-suiteid-out', 'RFC 0081 §A', 'a suiteId without the `.evals.` infix MUST be rejected')).toBe(false);
    // Negative: passScore out of 0..1.
    expect(suite({ ...good, thresholds: { passScore: 1.5 } }), req('openwop.it.agent-eval-suite-shape.agentevalsuite-validates-a-conforming-suite-and-rejects-a-malformed-suiteid-out', 'RFC 0081 §A', 'thresholds.passScore > 1 MUST be rejected')).toBe(false);
  });

  it('EvalSummary validates a conforming scorecard and rejects an out-of-range score', () => {
    const good = {
      suiteId: 'core.openwop.evals.support-resolver',
      suiteVersion: '1.0.0',
      aggregateScore: 0.86,
      passed: true,
      taskCount: 2,
      passedCount: 2,
      tasks: [{ taskId: 'refund-window', score: 0.9, passed: true, safetyFindings: [{ kind: 'jailbreak', severity: 'low' }] }],
    };
    expect(summary(good), req('openwop.it.agent-eval-suite-shape.evalsummary-validates-a-conforming-scorecard-and-rejects-an-out-of-range-score', 'RFC 0081 §C', 'a conforming EvalSummary MUST validate')).toBe(true);
    expect(summary({ ...good, aggregateScore: 1.4 }), req('openwop.it.agent-eval-suite-shape.evalsummary-validates-a-conforming-scorecard-and-rejects-an-out-of-range-score', 'RFC 0081 §C', 'aggregateScore > 1 MUST be rejected')).toBe(false);
  });

  it('EvalSummary is content-free — a task-output body and a safety-finding excerpt are rejected (eval-summary-no-content-leak)', () => {
    const base = { suiteId: 'core.openwop.evals.x', suiteVersion: '1.0.0', aggregateScore: 0.5, passed: false, taskCount: 1, passedCount: 0 };
    // Negative: a per-task entry carrying the output body.
    expect(
      summary({ ...base, tasks: [{ taskId: 't1', score: 0.5, passed: false, taskOutput: 'the model said …' }] }),
      req('openwop.it.agent-eval-suite-shape.evalsummary-is-content-free-a-task-output-body-and-a-safety-finding-excerpt-are', 'SECURITY invariant eval-summary-no-content-leak', 'an EvalSummary task entry MUST NOT carry an output body'),
    ).toBe(false);
    // Negative: a safety finding carrying excerpted content rather than a {kind, severity} descriptor.
    expect(
      summary({ ...base, tasks: [{ taskId: 't1', score: 0.5, passed: false, safetyFindings: [{ kind: 'pii-leak', severity: 'high', excerpt: 'SSN 123-45-6789' }] }] }),
      req('openwop.it.agent-eval-suite-shape.evalsummary-is-content-free-a-task-output-body-and-a-safety-finding-excerpt-are', 'SECURITY invariant eval-summary-no-content-leak', 'a safetyFinding MUST NOT carry excerpted content'),
    ).toBe(false);
  });
});

describe('agent-eval-suite-shape: eval event payloads (RFC 0081, server-free)', () => {
  const payloads = loadSchema('run-event-payloads.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(payloads, 'payloads');

  const started = ajv.getSchema('payloads#/$defs/evalStarted');
  const scored = ajv.getSchema('payloads#/$defs/evalScored');
  const completed = ajv.getSchema('payloads#/$defs/evalCompleted');

  it('eval.started validates a content-free start record and requires the suite provenance', () => {
    expect(started, req('openwop.it.agent-eval-suite-shape.eval-started-validates-a-content-free-start-record-and-requires-the-suite-proven', 'RFC 0081', 'the evalStarted $def MUST exist')).toBeTruthy();
    expect(
      started!({ suiteId: 'core.openwop.evals.support-resolver', suiteVersion: '1.0.0', taskCount: 12, modes: ['golden'] }),
      req('openwop.it.agent-eval-suite-shape.eval-started-validates-a-content-free-start-record-and-requires-the-suite-proven', 'RFC 0081 §C', 'a conforming eval.started payload MUST validate'),
    ).toBe(true);
    expect(
      started!({ suiteId: 'core.openwop.evals.x' }),
      req('openwop.it.agent-eval-suite-shape.eval-started-validates-a-content-free-start-record-and-requires-the-suite-proven', 'RFC 0081 §C', 'eval.started without suiteVersion/taskCount/modes MUST be rejected'),
    ).toBe(false);
  });

  it('eval.scored validates a content-free per-task score and requires score + passed', () => {
    expect(scored, req('openwop.it.agent-eval-suite-shape.eval-scored-validates-a-content-free-per-task-score-and-requires-score-passed', 'RFC 0081', 'the evalScored $def MUST exist')).toBeTruthy();
    expect(
      scored!({ taskId: 'refund-window', score: 0.9, passed: true, costUsd: 0.012 }),
      req('openwop.it.agent-eval-suite-shape.eval-scored-validates-a-content-free-per-task-score-and-requires-score-passed', 'RFC 0081 §C', 'a conforming eval.scored payload MUST validate'),
    ).toBe(true);
    expect(
      scored!({ taskId: 'refund-window' }),
      req('openwop.it.agent-eval-suite-shape.eval-scored-validates-a-content-free-per-task-score-and-requires-score-passed', 'RFC 0081 §C', 'eval.scored without score/passed MUST be rejected'),
    ).toBe(false);
  });

  it('eval.completed validates a content-free aggregate record', () => {
    expect(completed, req('openwop.it.agent-eval-suite-shape.eval-completed-validates-a-content-free-aggregate-record', 'RFC 0081', 'the evalCompleted $def MUST exist')).toBeTruthy();
    expect(
      completed!({ aggregateScore: 0.86, passed: true, taskCount: 12, passedCount: 11, regressionVsBaseline: 0.04 }),
      req('openwop.it.agent-eval-suite-shape.eval-completed-validates-a-content-free-aggregate-record', 'RFC 0081 §C', 'a conforming eval.completed payload MUST validate'),
    ).toBe(true);
    expect(
      completed!({ aggregateScore: 2 }),
      req('openwop.it.agent-eval-suite-shape.eval-completed-validates-a-content-free-aggregate-record', 'RFC 0081 §C', 'eval.completed with an out-of-range aggregateScore MUST be rejected'),
    ).toBe(false);
  });

  it('all three eval event names appear in the RunEventType enum', () => {
    const runEvent = loadSchema('run-event.schema.json');
    const enumVals = (runEvent.$defs as Record<string, { enum?: string[] }>).RunEventType?.enum ?? [];
    expect(enumVals, req('openwop.it.agent-eval-suite-shape.all-three-eval-event-names-appear-in-the-runeventtype-enum', 'RFC 0081', 'all three eval event names appear in the RunEventType enum')).toContain('eval.started');
    expect(enumVals).toContain('eval.scored');
    expect(enumVals).toContain('eval.completed');
  });
});
