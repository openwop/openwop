/**
 * Self-tests for `host-event-replay-witness.ts` (RFC 0250). Each judge passes
 * what a conforming host serves and FAILS each wrong answer: the cursor event
 * replayed, a gap or a duplicate at the backlog/live handoff, events out of
 * order, an ephemeral event replayed, a stream opened instead of a refusal, a
 * foreign cursor answered differently from an unknown one (an existence
 * oracle), and the new refusal leaking into the legacy mode.
 */

import { describe, it, expect } from 'vitest';
import { judgeLegacy, judgeNoEphemeralReplay, judgeUnauthenticatedNotResumed, judgeRefused, judgeResume, judgeUniform, type RefusalAnswer, type ReplayFinding } from './host-event-replay-witness.js';

const failed = (fs: readonly ReplayFinding[]): string[] => fs.filter((x) => !x.ok).map((x) => x.message);
const fr = (id: string | null, event = 'host-test.durable-triggered', data = `{"eventId":"${id ?? ''}"}`) => ({ id, event, data });
const REFUSAL = '{"error":"host_event_resync_required","message":"The cursor cannot be resumed."}';
const refusal = (text = REFUSAL, status = 409, contentType = 'application/json'): RefusalAnswer => ({ status, contentType, text, json: JSON.parse(text) });

describe('judgeResume', () => {
  it('passes the backlog then live, ignoring frames the suite did not cause', () => {
    expect(failed(judgeResume([fr('hb', 'heartbeat.evaluated'), fr('d2'), fr('d3'), fr('d4')], 'd1', ['d2', 'd3', 'd4'], 'e1'))).toEqual([]);
  });
  it('fails the cursor replayed, a gap, a duplicate and a reorder', () => {
    expect(failed(judgeResume([fr('d1'), fr('d2'), fr('d3'), fr('d4')], 'd1', ['d2', 'd3', 'd4'], 'e1'))).toHaveLength(1);
    expect(failed(judgeResume([fr('d2'), fr('d4')], 'd1', ['d2', 'd3', 'd4'], 'e1')).length).toBeGreaterThan(0);
    expect(failed(judgeResume([fr('d2'), fr('d3'), fr('d3'), fr('d4')], 'd1', ['d2', 'd3', 'd4'], 'e1')).length).toBeGreaterThan(0);
    expect(failed(judgeResume([fr('d3'), fr('d2'), fr('d4')], 'd1', ['d2', 'd3', 'd4'], 'e1'))).toHaveLength(1);
  });
});

describe('judgeNoEphemeralReplay', () => {
  it('passes durable-only; fails the ephemeral event coming back, found by the eventId in its data', () => {
    expect(failed(judgeNoEphemeralReplay([fr('d2')], 'e1'))).toEqual([]);
    expect(failed(judgeNoEphemeralReplay([fr(null, 'host-test.ephemeral-triggered', '{"eventId":"e1"}')], 'e1'))).toHaveLength(1);
  });
});

describe('judgeRefused', () => {
  it('passes 409 resync before any SSE byte', () => {
    expect(failed(judgeRefused(refusal(), 'unknown'))).toEqual([]);
  });
  it('fails an opened stream, a 400, another code and an SSE content-type', () => {
    expect(failed(judgeRefused(null, 'unknown'))).toHaveLength(1);
    expect(failed(judgeRefused(refusal('{"error":"validation_error","message":"x"}', 400), 'unknown'))).toHaveLength(2);
    expect(failed(judgeRefused(refusal(REFUSAL, 409, 'text/event-stream'), 'unknown'))).toHaveLength(1);
  });
});

describe('judgeUniform', () => {
  it('passes identical refusals; fails a foreign cursor answered differently (an oracle)', () => {
    expect(failed(judgeUniform([{ what: 'unknown', a: refusal() }, { what: 'foreign', a: refusal() }]))).toEqual([]);
    expect(failed(judgeUniform([{ what: 'unknown', a: refusal() }, { what: 'foreign', a: refusal('{"error":"host_event_resync_required","message":"Cursor belongs to another tenant."}') }]))).toHaveLength(1);
    expect(failed(judgeUniform([{ what: 'unknown', a: refusal() }, { what: 'foreign', a: refusal('{"error":"forbidden","message":"x"}', 403) }]))).toHaveLength(1);
  });
});

describe('judgeUnauthenticatedNotResumed', () => {
  it('passes 401 or the uniform 409; fails a resumed stream or a 200', () => {
    expect(failed(judgeUnauthenticatedNotResumed(refusal('{"error":"unauthenticated","message":"x"}', 401)))).toEqual([]);
    expect(failed(judgeUnauthenticatedNotResumed(refusal()))).toEqual([]);
    expect(failed(judgeUnauthenticatedNotResumed(null))).toHaveLength(1);
    expect(failed(judgeUnauthenticatedNotResumed(refusal('{}', 200, 'text/event-stream')))).toHaveLength(1);
  });
});

describe('judgeLegacy', () => {
  it('passes a 200 stream; fails the new refusal without the opt-in', () => {
    expect(failed(judgeLegacy(200))).toEqual([]);
    expect(failed(judgeLegacy(409))).toHaveLength(1);
    expect(failed(judgeLegacy(null))).toHaveLength(1);
  });
});
