/**
 * The council roster (RFC 0239; `spec/v2/core/conversation.md`
 * §multiPartyConversation), observed through normative operations only: run
 * creation, the run snapshot and event poll, and `resolveInterrupt`.
 *
 * Each leg observes through the suite driver and returns findings or the
 * reason it could not run, so the scenario and the self-test double run the
 * same code. The `judge*` functions are pure.
 */

import { driver } from './driver.js';
import { v2Discovery } from './v2.js';
import { readErrorCode } from './error-envelope.js';
import { majorProfile } from './major-profile.js';
import { readEvents, readRun, type Ev } from './fixture-run-observer.js';

export const COUNCIL = 'conformance-multi-party-council';
export const OVERSIZE = 'conformance-multi-party-council-oversize';
export const OVERSIZE_COUNT = 64;
export const GATE_NODE = 'convo';
export const ROSTER = ['host:conformance-council-a', 'host:conformance-council-b', 'host:conformance-council-c'] as const;
export const INTRUDER = 'host:conformance-intruder';

export type Skip = { readonly kind: 'skip'; readonly skip: 'blocked' | 'inapplicable'; readonly reason: string };
export type LegOutcome = { readonly kind: 'observed'; readonly findings: string[] } | Skip;
const skip = (s: 'blocked' | 'inapplicable', reason: string): Skip => ({ kind: 'skip', skip: s, reason });
const P = majorProfile(2);
const WAITING = new Set(['waiting-input', 'waiting-approval', 'waiting-external', 'paused']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `conversation.opened.participants` agent ids, in order. */
export function rosterOf(events: readonly Ev[]): string[] | null {
  const opened = events.find((e) => e.type === 'conversation.opened');
  if (!opened) return null;
  const p = opened.payload['participants'];
  return Array.isArray(p) ? p.map((x) => (isRecord(x) ? String(x['agentId']) : String(x))) : [];
}

/** §A.2 — the configured roster is carried unchanged. */
export function judgeRoster(events: readonly Ev[]): string[] {
  const got = rosterOf(events);
  if (got === null) return ['no conversation.opened event was emitted'];
  return JSON.stringify(got) === JSON.stringify([...ROSTER]) ? [] : [`conversation.opened.participants MUST carry the configured roster ${JSON.stringify(ROSTER)}; got ${JSON.stringify(got)}`];
}

/** §B.2–§B.3 — the non-member turn is refused with its code, unconsumed. */
export function judgeRefusal(status: number, body: unknown, statusAfter: string | null, exchangedAfter: number): string[] {
  const out: string[] = [];
  const code = readErrorCode(body);
  if (status !== 422 || code !== 'conversation_speaker_not_participant') out.push(`a turn from ${INTRUDER} MUST be refused 422 conversation_speaker_not_participant; got ${status} ${String(code)}`);
  const speaker = isRecord(body) && isRecord(body['details']) ? body['details']['speakerId'] : undefined;
  if (status === 422 && speaker !== INTRUDER) out.push(`details.speakerId MUST name the refused speaker ${INTRUDER}; got ${String(speaker)}`);
  if (statusAfter === null || !WAITING.has(statusAfter)) out.push(`the refused turn MUST NOT be consumed: the run MUST still wait on the interrupt; it is ${String(statusAfter)}`);
  if (exchangedAfter > 0) out.push(`a refused turn MUST NOT emit conversation.exchanged; ${exchangedAfter} were emitted`);
  return out;
}

/** The control — a member's turn still resolves the interrupt. */
export function judgeMemberAccepted(status: number, exchanged: number): string[] {
  if (status >= 200 && status < 300 && exchanged > 0) return [];
  return [`after the refusal, a turn from ${ROSTER[0]} MUST resolve the interrupt and emit conversation.exchanged; got ${status} with ${exchanged} conversation.exchanged`];
}

/** §C — the oversized roster is refused at creation with its code. */
export function judgeOversize(status: number, body: unknown, max: number): string[] {
  const code = readErrorCode(body);
  const out: string[] = [];
  if (status !== 422 || code !== 'conversation_roster_exceeded') out.push(`a ${OVERSIZE_COUNT}-member roster over maxParticipants ${max} MUST be refused 422 conversation_roster_exceeded at run creation; got ${status} ${String(code)}`);
  const d = isRecord(body) && isRecord(body['details']) ? body['details']['maxParticipants'] : undefined;
  if (status === 422 && d !== max) out.push(`details.maxParticipants MUST be the advertised ${max}; got ${String(d)}`);
  return out;
}

// ------------------------------------------------------------------ the legs

async function gate(fixture: string): Promise<{ family: Record<string, unknown> } | Skip> {
  let doc: Record<string, unknown> | null = null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return skip('blocked', 'v2 discovery unreachable');
  const family = doc['multiPartyConversation'];
  if (!isRecord(family)) return skip('inapplicable', 'the host does not advertise multiPartyConversation');
  const fixtures = Array.isArray(doc['fixtures']) ? (doc['fixtures'] as unknown[]) : [];
  if (!fixtures.includes(fixture)) return skip('inapplicable', `the host does not advertise the ${fixture} fixture (RFC 0239 §E; RFC 0003)`);
  return { family };
}

async function waitRun(runId: string, timeoutMs = 15_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await readRun(P, runId);
    const s = typeof r.snapshot['status'] === 'string' ? (r.snapshot['status'] as string) : null;
    if ((s && (WAITING.has(s) || TERMINAL.has(s))) || Date.now() > deadline) return s;
    await new Promise((res) => setTimeout(res, 250));
  }
}

async function openCouncil(): Promise<{ runId: string } | Skip> {
  const g = await gate(COUNCIL);
  if ('kind' in g) return g;
  const created = await driver.post(P.runsPath, { workflowId: COUNCIL });
  const runId = isRecord(created.json) ? created.json['runId'] : undefined;
  if (created.status !== 201 || typeof runId !== 'string') return skip('blocked', `POST /runs for the advertised ${COUNCIL} answered ${created.status} ${String(readErrorCode(created.json) ?? '')}`.trim());
  const s = await waitRun(runId);
  if (s === null || !WAITING.has(s)) return skip('blocked', `the council run did not suspend on its conversation.exchange interrupt (status ${String(s)})`);
  return { runId };
}

const resolve = (runId: string, speakerId: string) =>
  driver.post(`${P.runsPath}/${P.idSegment(runId)}/interrupts/${encodeURIComponent(GATE_NODE)}`, { resumeValue: { role: 'agent', speakerId, content: 'openwop-conformance turn' } });
const exchangedCount = async (runId: string): Promise<number> => (await readEvents(P, runId)).filter((e) => e.type === 'conversation.exchanged').length;

/** §A.2, `openwop.requirement.0239.council.roster-carried`. */
export async function rosterLeg(): Promise<LegOutcome> {
  const o = await openCouncil();
  if ('kind' in o) return o;
  return { kind: 'observed', findings: judgeRoster(await readEvents(P, o.runId)) };
}

/** §B, `openwop.requirement.0239.council.speaker-refused`. */
export async function speakerLeg(): Promise<LegOutcome> {
  const o = await openCouncil();
  if ('kind' in o) return o;
  const refused = await resolve(o.runId, INTRUDER);
  const after = await readRun(P, o.runId);
  const statusAfter = typeof after.snapshot['status'] === 'string' ? (after.snapshot['status'] as string) : null;
  const findings = judgeRefusal(refused.status, refused.json, statusAfter, await exchangedCount(o.runId));
  const member = await resolve(o.runId, ROSTER[0]);
  await waitRun(o.runId, 5_000);
  findings.push(...judgeMemberAccepted(member.status, await exchangedCount(o.runId)));
  return { kind: 'observed', findings };
}

/** §C, `openwop.requirement.0239.council.roster-exceeded`. */
export async function oversizeLeg(): Promise<LegOutcome> {
  const g = await gate(OVERSIZE);
  if ('kind' in g) return g;
  const max = g.family['maxParticipants'];
  if (typeof max !== 'number') return skip('inapplicable', 'the host advertises no multiPartyConversation.maxParticipants, so no roster is oversized');
  if (max >= OVERSIZE_COUNT) return skip('inapplicable', `maxParticipants is ${max}; the ${OVERSIZE_COUNT}-member fixture cannot exceed it (RFC 0239 §Decisions 4, gap G2)`);
  const created = await driver.post(P.runsPath, { workflowId: OVERSIZE });
  return { kind: 'observed', findings: judgeOversize(created.status, created.json, max) };
}
