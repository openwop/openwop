/**
 * The run-budget witness, shared by every major that gives a budget a run wire
 * surface (`major-profile.ts` `runBudget`).
 *
 * Unaided: the suite creates a run of `conformance-budget-tool-calls` (three
 * scripted tool calls, no model, no seam) with a two-call budget, waits for it
 * to end, and reads its event log through the poll.
 *
 * Two halves, as in `backpressure-witness.ts`: {@link drive} observes and
 * asserts nothing; {@link judge} is pure.
 *
 * The fixture is the opt-in. A host that advertises `budget` without seeding it
 * records `inapplicable`: the family is then unwitnessed at this major, which
 * the coverage report shows, and the host is not denied certification for a
 * fixture it was never asked to seed.
 */

import { driver, type OpenWOPResponse } from './driver.js';
import { readErrorCode } from './error-envelope.js';
import { isFixtureAdvertised } from './fixtures.js';
import type { MajorProfile } from './major-profile.js';

export const BUDGET_FIXTURE = 'conformance-budget-tool-calls';
/** The fixture makes 3 calls: 50% is crossed on the first, and the budget cannot cover the third. */
export const BUDGET_POLICY = { maxToolCalls: 2, thresholdPercent: 50, onExhaustion: 'fail' } as const;
const DIMENSION = 'toolCalls';
const CAP_KIND = 'budget-tool-calls';
/** Keys a `budget.*` or `cap.breached` payload must never carry (`budget-no-pricing-leak`). */
export const PRICING_KEYS = ['pricing', 'priceTable', 'prices', 'rate', 'rates', 'unitPrice', 'costModel', 'tokenPrice', 'secret', 'apiKey'] as const;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export interface RunEvent { readonly type: string; readonly sequence: number; readonly payload: Record<string, unknown> }
export interface BudgetObservation {
  readonly enforce: 'hard' | 'advisory' | undefined;
  readonly status: string;
  readonly errorCode: string | undefined;
  readonly events: readonly RunEvent[];
  /** This major's names for the four events the witness reads. */
  readonly names: { readonly reserved: string; readonly threshold: string; readonly exhausted: string; readonly capBreached: string };
}
export type BudgetRun =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'refused'; readonly status: number; readonly code: string | undefined }
  | { readonly kind: 'observed'; readonly observation: BudgetObservation };

export interface Finding {
  readonly rule: 'create' | 'lifecycle' | 'hard-stop' | 'advisory' | 'content-free';
  readonly ok: boolean;
  readonly doc: string;
  readonly message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function readEvents(profile: MajorProfile, runId: string): Promise<RunEvent[] | null> {
  const out: RunEvent[] = [];
  let after = 0;
  for (let page = 0; page < 50; page++) {
    const res = await http(() => driver.get(`${profile.runsPath}/${encodeURIComponent(runId)}/events/poll?timeout=1&afterSequence=${after}`));
    if (res === null || res.status !== 200) return page === 0 ? null : out;
    const batch = (res.json as { events?: unknown } | undefined)?.events;
    if (!Array.isArray(batch) || batch.length === 0) return out;
    for (const e of batch) {
      if (!isRecord(e) || typeof e['type'] !== 'string' || typeof e['sequence'] !== 'number') continue;
      out.push({ type: e['type'], sequence: e['sequence'], payload: isRecord(e['payload']) ? e['payload'] : {} });
      after = Math.max(after, e['sequence']);
    }
  }
  return out;
}

/** Create the budgeted run, wait for it to end, and return its log. */
export async function drive(profile: MajorProfile, discovery: unknown, timeoutMs = 20_000): Promise<BudgetRun> {
  const family = profile.family(discovery, 'budget');
  if (family === null) return { kind: 'skip', disposition: 'inapplicable', reason: 'the host does not advertise budget' };
  const fragment = profile.runBudget(BUDGET_POLICY);
  if (fragment === null) return { kind: 'skip', disposition: 'inapplicable', reason: `major ${profile.major} gives a run budget no createRun surface` };
  const dims = family['dimensions'];
  if (!Array.isArray(dims) || !dims.includes(DIMENSION)) return { kind: 'skip', disposition: 'inapplicable', reason: `budget.dimensions does not list ${DIMENSION} — the host does not enforce the dimension this witness spends` };
  if (!isFixtureAdvertised(BUDGET_FIXTURE)) return { kind: 'skip', disposition: 'inapplicable', reason: `${BUDGET_FIXTURE} fixture not advertised — the host has not opted in to the unaided budget witness` };

  const names = {
    reserved: profile.eventType('budget.reserved'),
    threshold: profile.eventType('budget.threshold.crossed'),
    exhausted: profile.eventType('budget.exhausted'),
    capBreached: profile.eventType('cap.breached'),
  };
  if (names.reserved === undefined || names.threshold === undefined || names.exhausted === undefined || names.capBreached === undefined) {
    return { kind: 'skip', disposition: 'blocked', reason: `the event name map for major ${profile.major} is not on disk in this layout — the witness will not guess event names` };
  }

  const created = await http(() => driver.post(profile.runsPath, { workflowId: BUDGET_FIXTURE, ...fragment }));
  if (created === null) return { kind: 'skip', disposition: 'blocked', reason: `POST ${profile.runsPath} unreachable (fetch failed)` };
  if (created.status === 429) return { kind: 'skip', disposition: 'blocked', reason: `POST ${profile.runsPath} answered 429 — the run budget of the host, not the wire` };
  const runId = (created.json as { runId?: unknown } | undefined)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return { kind: 'refused', status: created.status, code: readErrorCode(created.json) ?? undefined };

  const deadline = Date.now() + timeoutMs;
  let snap: Record<string, unknown> | null = null;
  for (;;) {
    const res = await http(() => driver.get(`${profile.runsPath}/${encodeURIComponent(runId)}`));
    snap = res?.status === 200 && isRecord(res.json) ? res.json : null;
    if (snap !== null && TERMINAL.has(String(snap['status']))) break;
    if (Date.now() > deadline) {
      await http(() => driver.post(`${profile.runsPath}/${encodeURIComponent(runId)}/cancel`, {}));
      return { kind: 'skip', disposition: 'blocked', reason: `the budgeted run did not reach a terminal status within ${timeoutMs} ms (last: ${snap === null ? 'unreadable' : String(snap['status'])})` };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const events = await readEvents(profile, runId);
  if (events === null) return { kind: 'skip', disposition: 'blocked', reason: `GET ${profile.runsPath}/{runId}/events/poll unreadable — the run ended but its log could not be read` };

  const enforce = family['enforce'];
  const error = snap['error'];
  return {
    kind: 'observed',
    observation: {
      enforce: enforce === 'hard' || enforce === 'advisory' ? enforce : undefined,
      status: String(snap['status']),
      errorCode: isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined,
      events,
      names: names as BudgetObservation['names'],
    },
  };
}

/** What the log must show at this major. Pure. */
export function judge(profile: MajorProfile, o: BudgetObservation): Finding[] {
  const home = `${profile.specRoot}/runs.md §budget section`;
  const first = (type: string): RunEvent | undefined => o.events.find((e) => e.type === type);
  const reserved = first(o.names.reserved);
  const threshold = first(o.names.threshold);
  const exhausted = first(o.names.exhausted);
  const breach = o.events.find((e) => e.type === o.names.capBreached && typeof e.payload['kind'] === 'string' && (e.payload['kind'] as string).startsWith('budget-'));
  const out: Finding[] = [];

  out.push({ rule: 'lifecycle', ok: reserved !== undefined, doc: home, message: `a budgeted run MUST emit ${o.names.reserved}` });
  out.push({ rule: 'lifecycle', ok: threshold !== undefined && typeof threshold.payload['percent'] === 'number', doc: home, message: `spending past thresholdPercent MUST emit ${o.names.threshold} with a numeric percent` });
  out.push({ rule: 'lifecycle', ok: exhausted !== undefined, doc: home, message: `a budget that cannot cover the run MUST emit ${o.names.exhausted}` });
  if (reserved !== undefined && threshold !== undefined && exhausted !== undefined) {
    out.push({ rule: 'lifecycle', ok: reserved.sequence < threshold.sequence && threshold.sequence < exhausted.sequence, doc: home, message: `the log MUST order ${o.names.reserved} < ${o.names.threshold} < ${o.names.exhausted}` });
  }

  if (o.enforce === 'hard') {
    out.push({ rule: 'hard-stop', ok: breach !== undefined && breach.payload['kind'] === CAP_KIND, doc: home, message: `hard exhaustion under onExhaustion: fail MUST emit ${o.names.capBreached} with kind ${CAP_KIND} (got ${breach === undefined ? 'none' : String(breach.payload['kind'])})` });
    if (breach !== undefined && exhausted !== undefined) {
      out.push({ rule: 'hard-stop', ok: exhausted.sequence <= breach.sequence, doc: home, message: `${o.names.capBreached} MUST NOT precede ${o.names.exhausted}` });
    }
    out.push({ rule: 'hard-stop', ok: o.status === 'failed' && o.errorCode === 'budget_exhausted', doc: home, message: `hard exhaustion MUST fail the run budget_exhausted (got ${o.status} ${o.errorCode ?? ''})`.trim() });
  }
  if (o.enforce === 'advisory') {
    out.push({ rule: 'advisory', ok: breach === undefined && o.errorCode !== 'budget_exhausted', doc: home, message: 'an advisory host MUST NOT stop the run' });
  }

  const leaks: string[] = [];
  for (const e of o.events) {
    if (!e.type.startsWith('budget.') && e !== breach) continue;
    for (const k of PRICING_KEYS) if (k in e.payload) leaks.push(`${e.type}.${k}`);
  }
  out.push({ rule: 'content-free', ok: leaks.length === 0, doc: home, message: `budget.* and cap.breached MUST NOT carry rate cards, unit prices or credentials (found ${leaks.join(', ') || 'none'})` });
  return out;
}
