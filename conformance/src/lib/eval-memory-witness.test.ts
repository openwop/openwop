/**
 * Self-tests for `eval-memory-witness.ts` (RFC 0244 §B, G3). The judge passes
 * the log of isolated trials, run in sequence or interleaved, and FAILS each
 * leak: a later trial reading an earlier trial's write, and a trial that did
 * not start from the seed. A memory tool whose writes never read back is
 * `blocked`, never a pass.
 */

import { describe, it, expect } from 'vitest';
import { judgeTrialMemoryIsolated, memoryCalls, MEMORY_TOOL, NOTE, SEEDED, type MemoryEvent, type MemoryVerdict } from './eval-memory-witness.js';

const AGENT = 'core.conformance.agents.scripted';
type Step = { op: string; id: string; got: unknown };
function log(steps: Step[]): MemoryEvent[] {
  return steps.flatMap((s, i) => [
    { type: 'agent.tool-called', payload: { agentId: AGENT, toolName: MEMORY_TOOL, callId: `m${i}`, inputs: { op: s.op, id: s.id } } },
    { type: 'agent.tool-returned', payload: { agentId: AGENT, toolName: MEMORY_TOOL, callId: `m${i}`, outcome: s.op === 'read' ? { id: s.id, content: s.got } : { id: s.id } } },
  ]);
}
/** One trial's four steps: the seed read, the first note read, the write, the read-back. */
const trial = (seed: unknown, first: unknown, back: unknown = NOTE.content): Step[] => [
  { op: 'read', id: SEEDED.id, got: seed },
  { op: 'read', id: NOTE.id, got: first },
  { op: 'write', id: NOTE.id, got: undefined },
  { op: 'read', id: NOTE.id, got: back },
];
const judge = (steps: Step[]): MemoryVerdict => judgeTrialMemoryIsolated(memoryCalls(log(steps), AGENT), 2);
const failed = (v: MemoryVerdict): string[] => (v.kind === 'judged' ? v.findings.filter((x) => !x.ok).map((x) => x.message) : [`blocked: ${v.reason}`]);

describe('judgeTrialMemoryIsolated (RFC 0244 §B)', () => {
  it('two isolated trials in sequence pass', () => {
    expect(failed(judge([...trial(SEEDED.content, null), ...trial(SEEDED.content, null)]))).toEqual([]);
  });
  it('two isolated trials interleaved pass', () => {
    const [a, b] = [trial(SEEDED.content, null), trial(SEEDED.content, null)];
    expect(failed(judge(a.flatMap((s, i) => [s, b[i]!])))).toEqual([]);
  });
  it('a later trial reading the earlier trial\'s write fails', () => {
    expect(failed(judge([...trial(SEEDED.content, null), ...trial(SEEDED.content, NOTE.content)])).some((m) => /MUST NOT be visible/.test(m))).toBe(true);
  });
  it('a trial that does not start from the seed fails', () => {
    expect(failed(judge([...trial(SEEDED.content, null), ...trial(null, null)])).some((m) => /memorySeed snapshot/.test(m))).toBe(true);
  });
  it('a memory tool whose writes never read back is blocked, not a pass', () => {
    expect(judge([...trial(SEEDED.content, null, null), ...trial(SEEDED.content, null, null)]).kind).toBe('blocked');
  });
  it('a missing call is blocked', () => {
    expect(judge([...trial(SEEDED.content, null), ...trial(SEEDED.content, null).slice(0, 3)]).kind).toBe('blocked');
  });
  it('calls by another agent are not counted', () => {
    const other = log(trial(SEEDED.content, NOTE.content)).map((e) => ({ ...e, payload: { ...e.payload, agentId: 'someone.else' } }));
    expect(memoryCalls([...log([...trial(SEEDED.content, null), ...trial(SEEDED.content, null)]), ...other], AGENT)).toHaveLength(8);
  });
});
