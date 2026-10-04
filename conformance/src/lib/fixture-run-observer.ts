/**
 * Observe one fixture run on the normative run surface: create it, wait for a
 * terminal status, read its final snapshot and its durable log. Shared by the
 * wave-2 fixture witnesses (`subworkflow-witness.ts`, `dispatch-witness.ts`,
 * `provider-usage-witness.ts`). It observes and asserts nothing; what differs
 * between majors (the run path, the id segment) is the profile row.
 */

import { driver } from './driver.js';
import type { MajorProfile } from './major-profile.js';

export const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/** A finding: one rule, judged. */
export interface Finding { readonly ok: boolean; readonly doc: string; readonly message: string }
export type Skip = { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string };
export type Outcome = Skip | { readonly kind: 'observed'; readonly findings: readonly Finding[] };
export type Validate = (doc: unknown) => { ok: boolean; errors: string };

export const finding = (ok: boolean, doc: string, message: string): Finding => ({ ok, doc, message });
export const skip = (disposition: Skip['disposition'], reason: string): Skip => ({ kind: 'skip', disposition, reason });
export const observed = (findings: readonly Finding[]): Outcome => ({ kind: 'observed', findings });

export interface Ev {
  readonly type: string;
  readonly sequence: number;
  /** The envelope `nodeId`, else the payload's. */
  readonly nodeId: string | undefined;
  readonly payload: Record<string, unknown>;
}

export interface RunRead { readonly status: number; readonly snapshot: Record<string, unknown> }

export interface ObservedRun {
  readonly workflowId: string;
  readonly createStatus: number;
  readonly runId: string | undefined;
  readonly terminalStatus: string | undefined;
  /** The last `GET /runs/{runId}` body. */
  readonly snapshot: Record<string, unknown>;
  /** Sorted by `sequence`. */
  readonly events: readonly Ev[];
}

export interface ObserveOpts { readonly timeoutMs?: number; readonly pollMs?: number }

/** `GET /runs/{runId}`. */
export async function readRun(profile: MajorProfile, runId: string): Promise<RunRead> {
  const r = await driver.get(`${profile.runsPath}/${profile.idSegment(runId)}`);
  return { status: r.status, snapshot: isRecord(r.json) ? r.json : {} };
}

/** `GET /runs/{runId}/events/poll`, normalised and sorted. */
export async function readEvents(profile: MajorProfile, runId: string): Promise<Ev[]> {
  const poll = await driver.get(`${profile.runsPath}/${profile.idSegment(runId)}/events/poll`);
  const raw = isRecord(poll.json) && Array.isArray(poll.json['events']) ? (poll.json['events'] as unknown[]) : [];
  return raw.filter(isRecord).map((e): Ev => {
    const payload = isRecord(e['payload']) ? e['payload'] : {};
    const nodeId = typeof e['nodeId'] === 'string' ? e['nodeId'] : typeof payload['nodeId'] === 'string' ? payload['nodeId'] : undefined;
    return { type: String(e['type']), sequence: typeof e['sequence'] === 'number' ? e['sequence'] : Number.MAX_SAFE_INTEGER, nodeId, payload };
  }).sort((x, y) => x.sequence - y.sequence);
}

/** Wait for a terminal status (or the deadline); return the last read. */
export async function pollTerminal(profile: MajorProfile, runId: string, opts: ObserveOpts = {}): Promise<RunRead> {
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  for (;;) {
    const r = await readRun(profile, runId);
    const s = r.snapshot['status'];
    if ((typeof s === 'string' && TERMINAL.has(s)) || Date.now() > deadline) return r;
    await new Promise((res) => setTimeout(res, opts.pollMs ?? 250));
  }
}

/** Create a run of `workflowId`, wait for it, read its log. Asserts nothing. */
export async function observeRun(profile: MajorProfile, workflowId: string, opts: ObserveOpts = {}): Promise<ObservedRun> {
  const created = await driver.post(profile.runsPath, { workflowId });
  const runId = isRecord(created.json) && typeof created.json['runId'] === 'string' ? created.json['runId'] : undefined;
  if ((created.status !== 201 && created.status !== 202) || runId === undefined) {
    return { workflowId, createStatus: created.status, runId: undefined, terminalStatus: undefined, snapshot: {}, events: [] };
  }
  const r = await pollTerminal(profile, runId, opts);
  const status = r.snapshot['status'];
  return { workflowId, createStatus: created.status, runId, terminalStatus: typeof status === 'string' ? status : undefined, snapshot: r.snapshot, events: await readEvents(profile, runId) };
}

/** The create was accepted and the fixture run ended `completed`, as its catalog entry says. */
export function runCompleted(o: ObservedRun): Finding[] {
  return [
    finding(o.createStatus === 201 || o.createStatus === 202, 'runs.md createRun', `createRun of ${o.workflowId} MUST be accepted (got ${o.createStatus})`),
    finding(o.terminalStatus === 'completed', `fixtures.md ${o.workflowId}`, `the fixture run MUST end completed (got ${String(o.terminalStatus)})`),
  ];
}

/** The `node.completed` events of one node. */
export const completionsOf = (events: readonly Ev[], nodeId: string): Ev[] => events.filter((e) => e.type === 'node.completed' && e.nodeId === nodeId);
