/**
 * The tableStorage schema witness (`spec/v2/core/storage.md` §`tableStorage`:
 * "an insert or update whose column types diverge from it MUST be refused").
 *
 * Unaided: the suite runs the `conformance-table-schema-probe` fixture three
 * times, each on a fresh table declared `{ k: string, n: number }`:
 *
 *   control          a well-typed insert MUST complete. Without it, a host
 *                    whose probe refuses everything passes the other legs.
 *   insert-mistyped  an insert with `n: "not-a-number"` MUST be refused.
 *   update-mistyped  an update setting `n` to a string MUST be refused.
 *
 * A refusal is `validation_error` with `details.service: tableStorage`
 * (`errors.md` §Host-service refusals; RFC 0228 maps v1's
 * `table_schema_violation` to it).
 *
 * Two halves, as in `budget-witness.ts`: {@link drive} observes and asserts
 * nothing; {@link judge} is pure.
 */

import { randomUUID } from 'node:crypto';
import { driver, type OpenWOPResponse } from './driver.js';
import { readErrorCode } from './error-envelope.js';
import { isFixtureAdvertised } from './fixtures.js';

export const TABLE_FIXTURE = 'conformance-table-schema-probe';
export const NODE_ID = 'table-schema-probe';
export type ProbeAction = 'control' | 'insert-mistyped' | 'update-mistyped';
export const ACTIONS: readonly ProbeAction[] = ['control', 'insert-mistyped', 'update-mistyped'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const DOC = 'spec/v2/core/storage.md §tableStorage';
const REFUSAL_DOC = 'spec/v2/core/errors.md §Host-service refusals';

export interface ProbeOutcome {
  readonly action: ProbeAction;
  readonly status: string;
  readonly code: string | null;
  readonly service: unknown;
}
export type TableRun =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'observed'; readonly outcomes: Readonly<Record<ProbeAction, ProbeOutcome>> };

export interface TableFinding {
  readonly rule: ProbeAction;
  readonly ok: boolean;
  readonly doc: string;
  readonly message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}
const enc = (id: string): string => encodeURIComponent(id);

async function probe(action: ProbeAction, timeoutMs: number): Promise<ProbeOutcome | string> {
  const table = `conformance_schema_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const created = await http(() => driver.post('/runs', { workflowId: TABLE_FIXTURE, inputs: { action, table } }));
  if (created === null) return 'POST /runs unreachable (fetch failed)';
  if (created.status === 429) return 'POST /runs answered 429 — the run budget of the host, not the wire';
  const runId = (created.json as { runId?: unknown } | undefined)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') return `POST /runs {workflowId: ${TABLE_FIXTURE}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the fixture run was refused`.trim();

  const deadline = Date.now() + timeoutMs;
  let status = '';
  for (;;) {
    const snap = await http(() => driver.get(`/runs/${enc(runId)}`));
    status = String((snap?.json as { status?: unknown } | undefined)?.status ?? '');
    if (TERMINAL.has(status)) break;
    if (Date.now() > deadline) {
      await http(() => driver.post(`/runs/${enc(runId)}/cancel`, {}));
      return `the ${action} run did not reach a terminal status within ${timeoutMs} ms (last: ${status || 'unreadable'})`;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const ev = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  const events = (ev?.json as { events?: unknown } | undefined)?.events;
  if (ev?.status !== 200 || !Array.isArray(events)) return `GET /runs/{runId}/events/poll answered ${ev?.status ?? 'nothing'} — the run ended but its log could not be read`;
  const failed = (events as Array<{ type?: unknown; payload?: unknown }>).find((e) => e.type === 'node.failed' && isRecord(e.payload) && e.payload['nodeId'] === NODE_ID)?.payload as Record<string, unknown> | undefined;
  const error = isRecord(failed?.['error']) ? failed['error'] : null;
  const details = isRecord(error?.['details']) ? error['details'] : null;
  return { action, status, code: typeof error?.['code'] === 'string' ? error['code'] : null, service: details?.['service'] };
}

/** Gate, then one fixture run per action. Asserts nothing. */
export async function drive(doc: unknown, timeoutMs = 30_000): Promise<TableRun> {
  const family = isRecord(doc) ? doc['tableStorage'] : undefined;
  if (!isRecord(family)) return { kind: 'skip', disposition: 'inapplicable', reason: 'tableStorage is not advertised in the v2 discovery root' };
  if (!isFixtureAdvertised(TABLE_FIXTURE)) return { kind: 'skip', disposition: 'inapplicable', reason: `${TABLE_FIXTURE} fixture not advertised — tableStorage has no protocol path, and the host has not opted in to the unaided schema witness` };
  const outcomes: Partial<Record<ProbeAction, ProbeOutcome>> = {};
  for (const action of ACTIONS) {
    const o = await probe(action, timeoutMs);
    if (typeof o === 'string') return { kind: 'skip', disposition: 'blocked', reason: o };
    outcomes[action] = o;
  }
  return { kind: 'observed', outcomes: outcomes as Record<ProbeAction, ProbeOutcome> };
}

const show = (o: ProbeOutcome): string => `${o.status}${o.code ? ` ${o.code}` : ''}${o.service !== undefined ? ` (details.service ${JSON.stringify(o.service)})` : ''}`;

/** What each run must show. Pure. */
export function judge(outcomes: Readonly<Record<ProbeAction, ProbeOutcome>>): TableFinding[] {
  const c = outcomes.control;
  const out: TableFinding[] = [{
    rule: 'control',
    ok: c.status === 'completed',
    doc: 'conformance/fixtures.md §The tableStorage schema probe fixture',
    message: `a well-typed insert into a table declared { k: string, n: number } MUST complete (got ${show(c)})`,
  }];
  for (const action of ['insert-mistyped', 'update-mistyped'] as const) {
    const o = outcomes[action];
    const verb = action === 'insert-mistyped' ? 'an insert' : 'an update';
    const refused = o.status === 'failed' && o.code === 'validation_error';
    out.push({
      rule: action,
      ok: refused && o.service === 'tableStorage',
      doc: refused ? REFUSAL_DOC : DOC,
      message: refused
        ? `a refused tableStorage call with the generic code validation_error MUST carry details.service: tableStorage (got ${show(o)})`
        : `${verb} whose column types diverge from the declared schema MUST be refused, as validation_error (got ${show(o)})`,
    });
  }
  return out;
}
