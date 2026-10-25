/**
 * Self-tests for `eval-counter-witness.ts` (RFC 0244 §D, G2). Each judge
 * passes the logs a conforming host produces and FAILS each wrong answer: a
 * miss that ran live, a fixture entry served twice or out of order, a live
 * miss not counted. A counter that did not persist between runs is `blocked`,
 * never a pass.
 */

import { describe, it, expect } from 'vitest';
import { counterCalls, judgeFirstUnconsumed, judgeLiveMiss, judgeMissNoLiveCall, COUNTER_TOOL, type CounterEvent, type CounterVerdict } from './eval-counter-witness.js';

const AGENT = 'core.conformance.agents.scripted';
type Step = { key: string; op: string; outcome?: unknown; error?: unknown };
function log(steps: Step[]): CounterEvent[] {
  return steps.flatMap((s, i) => [
    { type: 'agent.tool-called', payload: { agentId: AGENT, toolName: COUNTER_TOOL, callId: `c${i}`, inputs: { key: s.key, op: s.op } } },
    { type: 'agent.tool-returned', payload: { agentId: AGENT, toolName: COUNTER_TOOL, callId: `c${i}`, ...(s.error !== undefined ? { error: s.error } : { outcome: s.outcome }) } },
  ]);
}
const live = (l: number, f: number, s: number) => counterCalls(log([
  { key: 'L', op: 'inc', outcome: { key: 'L', count: l } },
  { key: 'L', op: 'inc', outcome: { key: 'L', count: l + 1 } },
  { key: 'F', op: 'read', outcome: { key: 'F', count: f } },
  { key: 'S', op: 'read', outcome: { key: 'S', count: s } },
]), AGENT);
const ERR = { code: 'fixture_miss', message: 'no fixture' };
const miss = (over: Partial<Record<number, Step>> = {}) => counterCalls(log([
  { key: 'S', op: 'inc', outcome: { served: 1 } },
  { key: 'S', op: 'inc', outcome: { served: 2 } },
  { key: 'S', op: 'inc', error: ERR },
  { key: 'F', op: 'inc', error: ERR },
].map((s, i) => over[i] ?? s)), AGENT);

const failed = (v: CounterVerdict): string[] => (v.kind === 'judged' ? v.findings.filter((x) => !x.ok).map((x) => x.message) : [`blocked: ${v.reason}`]);

describe('judgeLiveMiss (§D onMiss "live")', () => {
  it('a conforming host passes', () => expect(failed(judgeLiveMiss(live(4, 0, 2), 4))).toEqual([]));
  it('an uncounted live miss fails', () => expect(failed(judgeLiveMiss(live(4, 0, 2), 0)).some((m) => /fixtureMissCount > 0/.test(m))).toBe(true));
  it('a counter that does not advance fails', () => {
    const calls = counterCalls(log([{ key: 'L', op: 'inc', outcome: { count: 4 } }, { key: 'L', op: 'inc', outcome: { count: 4 } }, { key: 'F', op: 'read', outcome: { count: 0 } }, { key: 'S', op: 'read', outcome: { count: 0 } }]), AGENT);
    expect(failed(judgeLiveMiss(calls, 4)).some((m) => /advance/.test(m))).toBe(true);
  });
  it('no recorded outcome is blocked, not a pass', () => {
    const calls = counterCalls(log([{ key: 'L', op: 'inc' }, { key: 'L', op: 'inc' }, { key: 'F', op: 'read' }, { key: 'S', op: 'read' }]), AGENT);
    expect(judgeLiveMiss(calls, 4).kind).toBe('blocked');
  });
});

describe('judgeFirstUnconsumed (§D selection)', () => {
  it('a conforming host passes', () => expect(failed(judgeFirstUnconsumed(miss()))).toEqual([]));
  it('serving the first entry twice fails', () => expect(failed(judgeFirstUnconsumed(miss({ 1: { key: 'S', op: 'inc', outcome: { served: 1 } } }))).some((m) => /consumed once/.test(m))).toBe(true));
  it('serving out of order fails', () => expect(failed(judgeFirstUnconsumed(miss({ 0: { key: 'S', op: 'inc', outcome: { served: 2 } }, 1: { key: 'S', op: 'inc', outcome: { served: 1 } } }))).length).toBe(2));
  it('a third call answered live fails', () => expect(failed(judgeFirstUnconsumed(miss({ 2: { key: 'S', op: 'inc', outcome: { key: 'S', count: 3 } } }))).some((m) => /tool error/.test(m))).toBe(true));
  it('a third call re-served from a consumed entry fails', () => expect(failed(judgeFirstUnconsumed(miss({ 2: { key: 'S', op: 'inc', outcome: { served: 2 } } }))).some((m) => /tool error/.test(m))).toBe(true));
});

describe('judgeMissNoLiveCall (§D onMiss "fail")', () => {
  it('a conforming host passes', () => expect(failed(judgeMissNoLiveCall(live(4, 7, 2), miss(), live(6, 7, 2)))).toEqual([]));
  it('a miss that ran live fails on F', () => expect(failed(judgeMissNoLiveCall(live(4, 7, 2), miss(), live(6, 8, 2))).some((m) => /counter F/.test(m))).toBe(true));
  it('a miss answered with a live count fails on F', () => expect(failed(judgeMissNoLiveCall(live(4, 7, 2), miss({ 3: { key: 'F', op: 'inc', outcome: { key: 'F', count: 8 } } }), live(6, 8, 2))).length).toBe(2));
  it('fixture-served calls that also ran live fail on S', () => expect(failed(judgeMissNoLiveCall(live(4, 7, 2), miss(), live(6, 7, 5))).some((m) => /counter S/.test(m))).toBe(true));
  it('state that did not persist is blocked, not a pass', () => {
    expect(judgeMissNoLiveCall(live(4, 7, 2), miss(), live(1, 7, 2)).kind).toBe('blocked');
    expect(judgeMissNoLiveCall(live(4, 7, 2), miss(), live(9, 7, 2)).kind).toBe('blocked');
  });
  it('counterCalls ignores other tools and agents', () => {
    const extra: CounterEvent[] = [{ type: 'agent.tool-called', payload: { agentId: 'judge', toolName: COUNTER_TOOL, callId: 'x', inputs: { key: 'F', op: 'inc' } } }, ...log([{ key: 'F', op: 'read', outcome: { count: 1 } }])];
    expect(counterCalls(extra, AGENT)).toHaveLength(1);
  });
});
