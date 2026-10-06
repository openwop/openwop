/**
 * The council roster witness (RFC 0239), proven in both directions against a
 * double. Each case turns on ONE defect in an otherwise conforming double and
 * checks that only the legs owning that rule fail.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetV2Discovery } from './v2.js';
import { COUNCIL, OVERSIZE, ROSTER, oversizeLeg, rosterLeg, speakerLeg, type LegOutcome } from './council-roster-witness.js';

type Defect = 'none' | 'roster-dropped' | 'intruder-accepted' | 'refusal-consumes' | 'wrong-code' | 'truncates' | 'no-max' | 'big-max' | 'not-advertised';
let defect: Defect = 'none';
const MAX = 8;

interface Run { status: string; events: Array<{ type: string; sequence: number; payload: Record<string, unknown> }> }
const runs = new Map<string, Run>();
let seq = 0;

function emit(r: Run, type: string, payload: Record<string, unknown> = {}): void { r.events.push({ type, sequence: r.events.length, payload }); }

const server: Server = createServer((req, res) => {
  const send = (status: number, body: unknown): void => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const url = req.url ?? '';
    if (url.startsWith('/.well-known/openwop')) {
      const family = { status: 'experimental', since: '2.0', until: '2027-01-01', witness: 'witnessable-gated', ...(defect === 'no-max' ? {} : { maxParticipants: defect === 'big-max' ? 100 : MAX }) };
      return send(200, { protocolVersions: ['2.0'], multiPartyConversation: family, fixtures: defect === 'not-advertised' ? [] : [COUNCIL, OVERSIZE] });
    }
    if (url === '/runs' && req.method === 'POST') {
      if (body['workflowId'] === OVERSIZE && defect !== 'truncates') return send(422, { error: 'conversation_roster_exceeded', message: 'roster exceeds maxParticipants', details: { maxParticipants: MAX } });
      const runId = `run-${++seq}`;
      const r: Run = { status: 'waiting-input', events: [] };
      emit(r, 'run.started');
      emit(r, 'conversation.opened', { conversationId: 'c1', ...(defect === 'roster-dropped' ? {} : { participants: ROSTER.map((agentId) => ({ agentId })) }) });
      runs.set(runId, r);
      return send(201, { runId });
    }
    const m = /^\/runs\/([^/]+)(\/events\/poll|\/interrupts\/[^/]+)?$/.exec(url);
    const r = m ? runs.get(decodeURIComponent(m[1]!)) : undefined;
    if (!m || !r) return send(404, { error: 'not_found', message: 'no such run' });
    if (!m[2]) return send(200, { runId: m[1], status: r.status });
    if (m[2] === '/events/poll') return send(200, { runId: m[1], events: r.events, lastSequence: r.events.length - 1, status: r.status, isTerminal: r.status === 'completed' });
    const speaker = String((body['resumeValue'] as Record<string, unknown> | undefined)?.['speakerId'] ?? '');
    const member = (ROSTER as readonly string[]).includes(speaker);
    if (r.status !== 'waiting-input') return send(409, { error: 'interrupt_already_resolved', message: 'resolved' });
    if (!member && defect !== 'intruder-accepted') {
      if (defect === 'refusal-consumes') { r.status = 'completed'; }
      return send(422, { error: defect === 'wrong-code' ? 'validation_error' : 'conversation_speaker_not_participant', message: 'not a participant', details: { speakerId: speaker } });
    }
    emit(r, 'conversation.exchanged', { conversationId: 'c1', turnIndex: 0 });
    r.status = 'completed';
    return send(202, { runId: m[1] });
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  vi.stubEnv('OPENWOP_BASE_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  vi.stubEnv('OPENWOP_API_KEY', 'scratch-key');
});
afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => resetV2Discovery());

const legs = { roster: rosterLeg, speaker: speakerLeg, oversize: oversizeLeg };
type Leg = keyof typeof legs;

async function outcomes(d: Defect): Promise<Record<Leg, string>> {
  defect = d;
  resetV2Discovery();
  const out = {} as Record<Leg, string>;
  for (const k of Object.keys(legs) as Leg[]) {
    const o: LegOutcome = await legs[k]();
    out[k] = o.kind === 'skip' ? o.skip : o.findings.length ? 'fail' : 'pass';
  }
  return out;
}
const all = (v: string): Record<Leg, string> => ({ roster: v, speaker: v, oversize: v });

describe('council-roster-witness (RFC 0239)', () => {
  it('a conforming double passes every leg', async () => { expect(await outcomes('none')).toEqual(all('pass')); });
  it('a roster dropped from conversation.opened fails the roster leg only', async () => { expect(await outcomes('roster-dropped')).toEqual({ ...all('pass'), roster: 'fail' }); });
  it('accepting a non-member turn fails the speaker leg only', async () => { expect(await outcomes('intruder-accepted')).toEqual({ ...all('pass'), speaker: 'fail' }); });
  it('a refusal that consumes the interrupt fails the speaker leg only', async () => { expect(await outcomes('refusal-consumes')).toEqual({ ...all('pass'), speaker: 'fail' }); });
  it('refusing with validation_error fails the speaker leg only', async () => { expect(await outcomes('wrong-code')).toEqual({ ...all('pass'), speaker: 'fail' }); });
  it('truncating an oversized roster fails the oversize leg only', async () => { expect(await outcomes('truncates')).toEqual({ ...all('pass'), oversize: 'fail' }); });
  it('no maxParticipants makes the oversize leg inapplicable', async () => { expect(await outcomes('no-max')).toEqual({ ...all('pass'), oversize: 'inapplicable' }); });
  it('a maxParticipants of 64 or more makes the oversize leg inapplicable', async () => { expect(await outcomes('big-max')).toEqual({ ...all('pass'), oversize: 'inapplicable' }); });
  it('unadvertised fixtures make every leg inapplicable', async () => { expect(await outcomes('not-advertised')).toEqual(all('inapplicable')); });
});
