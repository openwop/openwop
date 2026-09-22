/**
 * RFC 0194 §A — a run's terminal event is emitted once and ends its forward
 * execution (`spec/v2/core/events.md` §The terminal event). Target major 2.
 *
 * Found by two independently written hosts under duplicate delivery: one wrote
 * `run.completed` then `node.failed`, the other two `run.completed` events
 * (openwop#1445). Nothing in v2 said either was wrong.
 *
 * A DEDICATED file rather than a check bolted onto every scenario that reaches
 * a terminal state: a host that violates this RFC must fail this RFC's rows,
 * not unrelated ones (openwop#1450 showed what misattribution costs).
 *
 * The log is read after it SETTLES — two reads at least 2 s apart returning the
 * same length, bounded at 20 s — because the second delivery's executor can
 * finish after the first terminal event. Growth after a terminal event is the
 * violation's own evidence, not an inconclusive read.
 *
 * @see spec/v2/core/events.md §The terminal event
 * @see RFCS/0194-terminal-event-ends-forward-execution.md
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip } from '../lib/soft-skip.js';
import { scaledTimeoutMs } from '../lib/polling.js';
import { req } from '../lib/requirement-ids.js';
import { receiverBinding, resolveRegistrationUrl } from '../lib/webhook-receiver.js';
import { terminalShapeViolation, TERMINAL_RUN_EVENTS } from '../lib/terminal-shape.js';

const ONCE = 'openwop.requirement.0194.terminal-once';
const DUP = 'openwop.requirement.0194.terminal-once.duplicate-delivery';
const DOC = 'spec/v2/core/events.md §The terminal event (RFC 0194 §A)';
const TERMINAL_STATUS = new Set(['completed', 'failed', 'cancelled']);
const KILL_SEAM = '/host/durability/kill';

async function http<T>(fn: () => Promise<T>): Promise<T | null> { try { return await fn(); } catch { return null; } }

async function status(runId: string): Promise<string | null> {
  const r = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
  return r !== null && r.status === 200 ? String((r.json as { status?: unknown } | null)?.status ?? '') : null;
}
async function waitStatus(runId: string, want: (s: string) => boolean, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + scaledTimeoutMs(timeoutMs);
  let s: string | null = null;
  while (Date.now() < deadline) { s = await status(runId); if (s !== null && want(s)) return s; await new Promise((r) => setTimeout(r, 250)); }
  return s;
}
async function logTypes(runId: string): Promise<string[] | null> {
  const r = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`));
  if (r === null || r.status !== 200) return null;
  const ev = (r.json as { events?: Array<{ type?: unknown }> } | null)?.events;
  return Array.isArray(ev) ? ev.map((e) => String(e.type)) : null;
}
/** Re-read until two reads ≥ 2 s apart agree (bounded); returns the last read. */
async function settledLog(runId: string): Promise<string[] | null> {
  const deadline = Date.now() + scaledTimeoutMs(20_000);
  let last = await logTypes(runId);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    const next = await logTypes(runId);
    if (next === null) return last;
    if (last !== null && next.length === last.length) return next;
    last = next;
  }
  return last;
}

describe('v2 terminal event (RFC 0194 §A)', () => {
  it('every run observed to a terminal state has exactly one terminal event and no forward execution after it', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    req(ONCE, DOC, 'a run\'s log MUST contain exactly one terminal run event and no forward-execution event after it');
    const cases: Array<{ fixture: string; cancel: boolean; want: string }> = [
      { fixture: 'conformance-noop', cancel: false, want: 'completed' },
      { fixture: 'conformance-noop', cancel: false, want: 'completed' },
      { fixture: 'conformance-failure', cancel: false, want: 'failed' },
      { fixture: 'conformance-cancellable', cancel: true, want: 'cancelled' },
    ];
    const observed: Array<{ fixture: string; runId: string }> = [];
    for (const c of cases) {
      if (!isFixtureAdvertised(c.fixture)) continue;
      const create = await http(() => driver.post('/runs', { workflowId: c.fixture }));
      const runId = (create?.json as { runId?: unknown } | null)?.runId;
      if (create === null || create.status !== 201 || typeof runId !== 'string') continue;
      if (c.cancel) await http(() => driver.post(`/runs/${encodeURIComponent(runId)}/cancel`, {}));
      // `cancelling` is not terminal; wait for the terminal status itself.
      const s = await waitStatus(runId, (x) => TERMINAL_STATUS.has(x), 30_000);
      if (s !== null && TERMINAL_STATUS.has(s)) observed.push({ fixture: c.fixture, runId });
    }
    if (observed.length === 0) return softSkip('blocked', 'no advertised fixture produced a run that reached a terminal status — there is no log to check');
    for (const o of observed) {
      const types = await settledLog(o.runId);
      if (types === null) return softSkip('blocked', `GET /runs/{runId}/events/poll did not answer for ${o.fixture} — the log is unobservable`);
      expect(terminalShapeViolation(types), req(ONCE, DOC, `${o.fixture} run ${o.runId}: exactly one terminal run event, and no forward-execution event after it — log: ${types.join(' ')}`)).toBeNull();
    }
  }, 180_000);

  it('work delivered twice still leaves one terminal event and no forward execution after it', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    req(DUP, DOC, 'under a duplicate delivery the log MUST still contain exactly one terminal run event and no forward-execution event after it');
    const probe = await http(() => driver.get(KILL_SEAM));
    if (probe === null) return softSkip('blocked', `GET ${KILL_SEAM} unreachable (fetch failed)`);
    if (probe.status === 404 || probe.status === 405) return softSkip('inapplicable', `no RFC 0158 durability test hook at ${KILL_SEAM} (HTTP ${probe.status}) — a black-box suite cannot make a host redeliver accepted work, so this row needs the hook`);
    const rx = await startEffectReceiver();
    try {
      const target = resolveRegistrationUrl(rx.url);
      const fired = await http(() => driver.post(KILL_SEAM, { mode: 'duplicate-delivery', effectUrl: target.url }));
      const runId = (fired?.json as { runId?: unknown } | null)?.runId;
      if (fired === null || fired.status >= 400 || typeof runId !== 'string') return softSkip('blocked', `the durability hook answered ${fired?.status ?? 'no response'} for mode=duplicate-delivery — no redelivered run to read`);
      const s = await waitStatus(runId, (x) => TERMINAL_STATUS.has(x), 60_000);
      if (s === null || !TERMINAL_STATUS.has(s)) return softSkip('blocked', `the redelivered run did not reach a terminal status (last: ${s ?? 'unreadable'})`);
      const deadline = Date.now() + scaledTimeoutMs(20_000);
      while (rx.arrivals === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      const types = await settledLog(runId);
      if (types === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll did not answer — the log is unobservable');
      expect(types.some((t) => TERMINAL_RUN_EVENTS.has(t)), req(DUP, DOC, 'the redelivered run\'s log reached a terminal event')).toBe(true);
      expect(terminalShapeViolation(types), req(DUP, DOC, `work delivered twice MUST leave exactly one terminal run event and nothing forward after it — log: ${types.join(' ')}`)).toBeNull();
    } finally {
      await new Promise<void>((ok) => rx.server.close(() => ok()));
    }
  }, 180_000);
});

async function startEffectReceiver(): Promise<{ server: Server; url: string; arrivals: number }> {
  const state = { arrivals: 0 };
  const server = createServer((request: IncomingMessage, res: ServerResponse) => {
    request.on('data', () => { /* drain */ });
    request.on('end', () => { state.arrivals++; res.writeHead(204); res.end(); });
  });
  const pinned = Number(process.env['OPENWOP_WEBHOOK_RECEIVER_PORT'] ?? '');
  const bindPort = Number.isInteger(pinned) && pinned > 0 && pinned < 65536 ? pinned : 0;
  const binding = receiverBinding();
  await new Promise<void>((resolve) => server.listen(bindPort, binding.bind, () => resolve()));
  const addr = server.address();
  const out = { server, url: `http://${binding.advertise}:${typeof addr === 'object' && addr ? addr.port : 0}/effect`, get arrivals() { return state.arrivals; } };
  return out;
}
