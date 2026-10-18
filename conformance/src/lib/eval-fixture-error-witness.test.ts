/**
 * Self-tests for `eval-fixture-error-witness.ts` (RFC 0245). The judge passes
 * the log a conforming host writes and FAILS each wrong answer a host can give:
 * the RFC 0244-only answer (the error entry served as a success, with
 * `outcome`), a bare error with no code, a missing `status` under tool hooks,
 * counting the served error as a miss, and dropping or retrying a call.
 */

import { describe, it, expect } from 'vitest';
import { judgeFixtureErrorReplayed, type FixtureErrorFinding } from './eval-fixture-error-witness.js';

const AGENT = 'core.conformance.agents.scripted';
const TOOL = 'conformance.eval:lookup';
const failed = (fs: readonly FixtureErrorFinding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);

type P = Record<string, unknown>;
const ev = (sequence: number, type: string, payload: P) => ({ type, sequence, payload: { agentId: AGENT, toolName: TOOL, ...payload } });
const ERR = { error: { code: 'tool_execution_failed', message: 'fixture error' }, status: 'error' };
const OK = { outcome: { status: 'shipped' }, status: 'ok' };
const log = (firstReturn: P = ERR, secondReturn: P = OK) => [
  ev(1, 'agent.tool-called', { callId: 'c1', inputs: { orderId: 'o-1' } }),
  ev(2, 'agent.tool-returned', { callId: 'c1', ...firstReturn }),
  ev(3, 'agent.tool-called', { callId: 'c2', inputs: { orderId: 'o-1' } }),
  ev(4, 'agent.tool-returned', { callId: 'c2', ...secondReturn }),
];
const summary = (miss: unknown = 0) => ({ tasks: [{ taskId: 'recovers', score: 1, passed: true, fixtureMissCount: miss }] });
const judge = (events: ReturnType<typeof log>, s: P = summary(), prePostEvents = true) => failed(judgeFixtureErrorReplayed(events, s, { agentId: AGENT, prePostEvents }));

describe('judgeFixtureErrorReplayed (RFC 0245 §B)', () => {
  it('a conforming host passes, with and without tool hooks', () => {
    expect(judge(log())).toEqual([]);
    expect(judge(log({ error: ERR.error }, { outcome: OK.outcome }), summary(), false)).toEqual([]);
  });
  it('the RFC 0244-only host fails: the error entry is served as a success', () => {
    const fs = judge(log(OK, OK));
    expect(fs.some((m) => /MUST be recorded with error/.test(m))).toBe(true);
    expect(fs.some((m) => /MUST NOT carry outcome/.test(m))).toBe(true);
  });
  it('error and outcome together fail (mutually exclusive)', () => {
    expect(judge(log({ ...ERR, outcome: { status: 'shipped' } })).some((m) => /MUST NOT carry outcome/.test(m))).toBe(true);
  });
  it('an error without a code or message fails', () => {
    expect(judge(log({ error: { code: '', message: 'x' }, status: 'error' })).some((m) => /non-empty/.test(m))).toBe(true);
    expect(judge(log({ error: { code: 'x' }, status: 'error' })).some((m) => /non-empty/.test(m))).toBe(true);
  });
  it('a missing status "error" fails only under tool hooks', () => {
    expect(judge(log({ error: ERR.error })).some((m) => /status "error"/.test(m))).toBe(true);
    expect(judge(log({ error: ERR.error }), summary(), false)).toEqual([]);
  });
  it('counting the served error as a miss fails', () => {
    expect(judge(log(), summary(1)).some((m) => /fixtureMissCount MUST be 0/.test(m))).toBe(true);
  });
  it('the success entry served as an error fails (entries consumed out of order)', () => {
    const fs = judge(log(ERR, ERR));
    expect(fs.some((m) => /following success entry MUST NOT carry error/.test(m))).toBe(true);
    expect(fs.some((m) => /success return MUST NOT carry status "error"/.test(m))).toBe(true);
  });
  it('a success with no outcome passes — outcome is optional (RFC 0064 §F)', () => {
    expect(judge(log(ERR, { status: 'ok' }))).toEqual([]);
    expect(judge(log({ error: ERR.error }, {}), summary(), false)).toEqual([]);
  });
  it('a dropped return or an extra call fails', () => {
    expect(judge(log().slice(0, 3)).some((m) => /two agent\.tool-returned/.test(m))).toBe(true);
    const retried = [...log(), ev(5, 'agent.tool-called', { callId: 'c3' }), ev(6, 'agent.tool-returned', { callId: 'c3', ...OK })];
    expect(judge(retried).some((m) => /two agent\.tool-called/.test(m))).toBe(true);
  });
  it('returns are paired by callId, not position', () => {
    const swapped = [log()[0]!, log()[2]!, ev(5, 'agent.tool-returned', { callId: 'c2', ...OK }), ev(6, 'agent.tool-returned', { callId: 'c1', ...ERR })];
    expect(judge(swapped)).toEqual([]);
  });
  it('a missing task fails', () => {
    expect(judge(log(), { tasks: [] }).some((m) => /MUST carry task recovers/.test(m))).toBe(true);
  });
});
