/**
 * Unit tests for `summarizeProvenance` — the pure event-log → provenance
 * aggregator behind RunProvenancePanel. No React, no fetch.
 *
 * Runtime note: the frontend package ships no test runner today (see
 * builder/palette/__tests__/configFieldsFromSchema.test.ts). This file is
 * vitest-compatible executable documentation — it becomes a live suite the
 * moment `vitest` is added as a frontend devDep, and is excluded from the
 * `tsc --noEmit` build gate via tsconfig `exclude: src/**​/__tests__/**`.
 */

import { describe, it, expect } from 'vitest';
import type { RunEventDoc, RunSnapshot } from '@openwop/openwop';
import { summarizeProvenance } from '../RunProvenancePanel.js';

let seq = 0;
function ev(type: string, payload: unknown, extra: Partial<RunEventDoc> = {}): RunEventDoc {
  seq += 1;
  return {
    eventId: `e${seq}`,
    runId: 'run-1',
    type,
    payload,
    timestamp: new Date(Date.UTC(2026, 5, 2, 12, 0, seq)).toISOString(),
    sequence: seq,
    ...extra,
  };
}

describe('summarizeProvenance', () => {
  it('returns an empty summary for no events', () => {
    const p = summarizeProvenance([]);
    expect(p.eventCount).toBe(0);
    expect(p.models).toEqual([]);
    expect(p.human.open).toBe(false);
    expect(p.human.interrupts).toBe(0);
  });

  it('derives models, decisions, confidence, and timing from the event log', () => {
    seq = 0;
    const events: RunEventDoc[] = [
      ev('run.started', { inputs: { topic: 'x' } }, { causationId: 'trigger-9', engineVersion: 'wfe-1.2.3' }),
      ev('agent.reasoned', { reasoning: 'thinking' }),
      ev('provider.usage', { provider: 'anthropic', model: 'claude-haiku-4-5', inputTokens: 10, outputTokens: 5 }),
      ev('provider.usage', { provider: 'anthropic', model: 'claude-haiku-4-5', inputTokens: 20, outputTokens: 7 }),
      ev('agent.decided', { decision: 'route:a', confidence: 0.8 }),
      ev('agent.decided', { decision: 'route:b', confidence: 0.4 }),
      ev('run.completed', { output: { ok: true } }),
    ];
    const snapshot = { runId: 'run-1', workflowId: 'wf.demo', status: 'completed' } as RunSnapshot;
    const p = summarizeProvenance(events, snapshot);

    expect(p.workflowId).toBe('wf.demo');
    expect(p.engineVersion).toBe('wfe-1.2.3');
    expect(p.causationId).toBe('trigger-9');
    expect(p.models).toEqual([{ provider: 'anthropic', model: 'claude-haiku-4-5', calls: 2 }]);
    expect(p.reasoningSteps).toBe(1);
    expect(p.decisions).toBe(2);
    expect(p.confidence).toEqual({ min: 0.4, max: 0.8 });
    expect(p.inputs).toEqual({ topic: 'x' });
    expect(p.output).toEqual({ ok: true });
    expect(p.durationMs).toBeGreaterThanOrEqual(0);
    expect(p.human.interrupts).toBe(0);
  });

  it('counts human gates: an interrupt that was resumed', () => {
    seq = 0;
    const events: RunEventDoc[] = [
      ev('run.started', {}),
      ev('interrupt.requested', { kind: 'approval' }),
      ev('run.resumed', {}),
      ev('run.completed', {}),
    ];
    const p = summarizeProvenance(events, { runId: 'run-1', workflowId: 'wf', status: 'completed' } as RunSnapshot);
    expect(p.human.interrupts).toBe(1);
    expect(p.human.kinds).toContain('approval');
    expect(p.human.resumes).toBe(1);
    expect(p.human.open).toBe(false);
  });

  it('flags an open interrupt from the snapshot as awaiting human', () => {
    seq = 0;
    const events: RunEventDoc[] = [ev('run.started', {}), ev('interrupt.requested', { kind: 'approval' })];
    const snapshot = {
      runId: 'run-1', workflowId: 'wf', status: 'suspended',
      interrupt: { kind: 'approval', nodeId: 'n1', interruptToken: 't' },
    } as RunSnapshot;
    const p = summarizeProvenance(events, snapshot);
    expect(p.human.open).toBe(true);
    expect(p.human.interrupts).toBeGreaterThanOrEqual(1);
  });

  it('marks model substitution when model.capability.substituted fired', () => {
    seq = 0;
    const events: RunEventDoc[] = [
      ev('run.started', {}),
      ev('model.capability.substituted', { from: 'reasoning', to: 'standard' }),
      ev('run.completed', {}),
    ];
    const p = summarizeProvenance(events);
    expect(p.substituted).toBe(true);
  });
});
