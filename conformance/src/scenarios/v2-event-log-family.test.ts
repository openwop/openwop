/**
 * v2 — what a host advertising `eventLog` owes on its log
 * (`spec/v2/core/persistence.md` §The `eventLog` family). Gated on `eventLog`.
 * Unaided.
 *
 * The family's three MUSTs, one leg each:
 *
 *   stamp        "MUST stamp `eventLogSchemaVersion` on every run it creates".
 *                Every creation path the suite can drive from outside: a run
 *                made by `createRun`, and, where `replay` is advertised, a run
 *                made by `forkRun`. Each snapshot carries the era discovery
 *                advertises, and that era is `3` (§The era key). The ungated
 *                `v2-era-stamp-universal` checks `createRun` only; a host whose
 *                fork path writes no era fails here.
 *   cursor       "MUST serve the cursor contract of events.md §Poll over that
 *                log". A cursor at EVERY position of a settled log returns
 *                exactly the tail after it (a page-limited host may return a
 *                non-empty prefix of it); chaining `afterSequence` through the
 *                pages rebuilds the log with no gap and no duplicate and ends
 *                on an empty page; each event keeps its `eventId` across reads;
 *                and every response's `lastSequence` is the highest sequence in
 *                the log, a cursor past the end included. `v2-poll-cursor-v2`
 *                checks one position.
 *   codemap      "MUST NOT emit an event `type` the codemap does not name".
 *                Every type on the logs of the advertised lifecycle fixtures
 *                (`conformance-noop`, and `conformance-multi-node` and
 *                `conformance-failure` where seeded) is a v2 name in
 *                `spec/v2/event-codemap.json`, or a vendor type whose org is
 *                registered in `spec/v2/declaration.json` `extensions`
 *                (§The codemap is data). The failure fixture reaches
 *                `run.failed` / `node.failed`, which `v2-event-type-closed`'s
 *                noop log never does.
 *
 * Dispositions: no `eventLog` ⇒ `inapplicable` (gate `openwop.family.eventLog`).
 * A create refused, a run that does not settle, or a log that grows between
 * reads ⇒ `blocked`. A fork that is declined is noted after the `createRun`
 * path is judged, so that row is a partial-witness pass.
 *
 * @see spec/v2/core/persistence.md §The eventLog family
 * @see spec/v2/core/persistence.md §The era key
 * @see spec/v2/core/events.md §Poll
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { familyAdvertised, gateFamily, v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { registeredOrgs } from '../lib/era2-seed.js';
import { SPEC_V2_DIR } from '../lib/paths.js';
import { blockedDespiteAssertions, softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID_STAMP = 'openwop.requirement.0036.event-log-stamp-every-path';
const ID_CURSOR = 'openwop.requirement.0036.event-log-cursor-contract';
const ID_CODEMAP = 'openwop.requirement.0036.event-log-codemap-types';
const DOC_FAMILY = 'spec/v2/core/persistence.md §The eventLog family';
const DOC_ERA = 'spec/v2/core/persistence.md §The era key';
const DOC_POLL = 'spec/v2/core/events.md §Poll';
const DOC_CODEMAP = 'spec/v2/core/persistence.md §The codemap is data';
const NOOP = 'conformance-noop';
const MULTI = 'conformance-multi-node';
const FAILURE = 'conformance-failure';
const V2_ERA = 3;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const SETTLE_MS = Number(process.env['OPENWOP_LIFECYCLE_TIMEOUT_MS'] ?? 15_000);
const MAX_PAGES = 200;

interface Read { readonly sequence: number; readonly eventId: string; readonly type: string }
interface Page { readonly status: number; readonly events: readonly Read[]; readonly lastSequence: unknown }

const enc = encodeURIComponent;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}
async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

/** Create a run of `workflowId` and wait for it to settle. */
async function settledRun(workflowId: string): Promise<{ runId: string; snapshot: Record<string, unknown> } | { reason: string }> {
  const created = await http(() => driver.post('/runs', { workflowId }));
  if (created === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = isRecord(created.json) ? created.json['runId'] : undefined;
  if (created.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${workflowId}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the create was refused (fixture not seeded?)`.trim() };
  return settle(runId);
}
async function settle(runId: string): Promise<{ runId: string; snapshot: Record<string, unknown> } | { reason: string }> {
  const deadline = Date.now() + SETTLE_MS;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const res = await http(() => driver.get(`/runs/${enc(runId)}`));
    last = res !== null && res.status === 200 && isRecord(res.json) ? res.json : null;
    if (last !== null && TERMINAL.has(String(last['status']))) return { runId, snapshot: last };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { reason: `run ${runId} did not reach a terminal status within ${SETTLE_MS} ms (last: ${last === null ? 'unreadable' : String(last['status'])})` };
}

async function poll(runId: string, after: number | null): Promise<Page | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1${after === null ? '' : `&afterSequence=${after}`}`));
  if (res === null) return null;
  const body = isRecord(res.json) ? res.json : {};
  const raw = Array.isArray(body['events']) ? body['events'] : [];
  const events = raw.filter(isRecord).map((e): Read => ({ sequence: typeof e['sequence'] === 'number' ? e['sequence'] : Number.NaN, eventId: String(e['eventId']), type: String(e['type']) }));
  return { status: res.status, events, lastSequence: body['lastSequence'] };
}
const seqs = (p: Page): number[] => p.events.map((e) => e.sequence);

/** The v2 names of `spec/v2/event-codemap.json`, or null when the file is not on disk in this layout. */
function codemapV2Names(): Set<string> | null {
  const file = SPEC_V2_DIR ? join(SPEC_V2_DIR, 'event-codemap.json') : null;
  if (file === null || !existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { rows?: Array<{ v2?: unknown }> };
    const names = new Set((doc.rows ?? []).map((r) => r.v2).filter((v): v is string => typeof v === 'string'));
    return names.size > 0 ? names : null;
  } catch {
    return null;
  }
}

describe('v2 eventLog family (persistence.md §The eventLog family)', () => {
  it('every run the host creates, by createRun and by forkRun, carries the advertised era 3', async () => {
    if ((await gateFamily('eventLog')) === null) return softSkip('inapplicable', 'the host does not advertise eventLog (gate recorded under openwop.family.eventLog)');
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const advertised = doc['eventLogSchemaVersion'];
    expect(advertised, req(ID_STAMP, DOC_ERA, `a host advertising eventLog MUST advertise the era it writes for new runs, and a v2 host writes ${V2_ERA} (discovery eventLogSchemaVersion: ${JSON.stringify(advertised)})`)).toBe(V2_ERA);

    const source = await settledRun(NOOP);
    if ('reason' in source) return softSkip('blocked', source.reason);
    expect(source.snapshot['eventLogSchemaVersion'], req(ID_STAMP, DOC_FAMILY, `a run made by createRun MUST carry eventLogSchemaVersion ${V2_ERA} on its snapshot (got ${JSON.stringify(source.snapshot['eventLogSchemaVersion'])})`)).toBe(V2_ERA);

    // The second creation path. forkRun is gated on `replay` (runs.md §Surface).
    const replay = await familyAdvertised('replay');
    const modes = Array.isArray(replay?.['modes']) ? (replay?.['modes'] as unknown[]).filter((m): m is string => typeof m === 'string') : [];
    // partial-witness-ok: forkRun is a creation path only where replay advertises a fork mode; createRun, the only other, was judged above.
    if (replay === null || modes.length === 0) return softSkip('inapplicable', 'replay is not advertised with a fork mode — createRun is the only creation path the suite can drive, and it was judged above');
    const mode = modes.includes('branch') ? 'branch' : (modes[0] as string);
    const fork = await http(() => driver.post(`/runs/${enc(source.runId)}:fork`, { mode, fromSeq: 0 }));
    const forkId = fork !== null && isRecord(fork.json) ? fork.json['runId'] : undefined;
    if (fork === null || fork.status !== 201 || typeof forkId !== 'string') {
      return softSkip('blocked', `a ${mode} fork at fromSeq 0 answered ${fork?.status ?? 'no response'} ${fork === null ? '' : readErrorCode(fork.json) ?? ''} — the forkRun creation path was not reached (its refusals are v2-run-fork-refusals' to judge)`.trim());
    }
    const forked = await http(() => driver.get(`/runs/${enc(forkId)}`));
    if (forked === null || forked.status !== 200 || !isRecord(forked.json)) return softSkip('blocked', `GET /runs/{fork} answered ${forked?.status ?? 'no response'} — the fork's snapshot is where its era is reported`);
    expect(forked.json['eventLogSchemaVersion'], req(ID_STAMP, DOC_FAMILY, `a run made by forkRun (${mode}) MUST carry eventLogSchemaVersion ${V2_ERA} too: a creation path that writes no era makes runs every reader translates as the v1 era (got ${JSON.stringify(forked.json['eventLogSchemaVersion'])})`)).toBe(V2_ERA);
  });

  it('a cursor at every position of a settled log serves the poll contract', async () => {
    if ((await gateFamily('eventLog')) === null) return softSkip('inapplicable', 'the host does not advertise eventLog (gate recorded under openwop.family.eventLog)');
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const fixture = isFixtureAdvertised(MULTI) ? MULTI : NOOP;
    const run = await settledRun(fixture);
    if ('reason' in run) return softSkip('blocked', run.reason);

    // Observe everything first; judge only a log that stayed put while it was read.
    const whole = await poll(run.runId, null);
    if (whole === null || whole.status !== 200) return softSkip('blocked', `GET /runs/{runId}/events/poll answered ${whole?.status ?? 'no response'}`);
    const all = seqs(whole);
    if (all.length < 2) return softSkip('blocked', `the ${fixture} log holds ${all.length} event(s) — a cursor walk needs an interior position`);
    const atCursor = new Map<number, Page | null>();
    for (const k of all) atCursor.set(k, await poll(run.runId, k));
    const walk: Page[] = [];
    let cursor: number | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const p = await poll(run.runId, cursor);
      if (p === null) break;
      walk.push(p);
      const s = seqs(p);
      if (p.status !== 200 || s.length === 0 || !Number.isFinite(s[s.length - 1] as number)) break;
      cursor = s[s.length - 1] as number;
    }
    const pastEnd = await poll(run.runId, Math.max(...all) + 1000);
    const again = await poll(run.runId, null);
    if (again === null || again.status !== 200 || seqs(again).join(',') !== all.join(',')) {
      return softSkip('blocked', `the log changed between reads (before [${all.join(',')}], after [${again === null ? 'unreadable' : seqs(again).join(',')}]) — a settled run is still appending, so reads of it are not comparable`);
    }

    const max = Math.max(...all);
    const idAt = new Map<number, string>(whole.events.map((e): [number, string] => [e.sequence, e.eventId]));
    const tail = (k: number): number[] => all.filter((s) => s > k);
    for (const [k, p] of atCursor) {
      expect(p?.status, req(ID_CURSOR, DOC_POLL, `afterSequence=${k} MUST answer 200`)).toBe(200);
      const got = p === null ? [] : seqs(p);
      const want = tail(k);
      const prefix = got.length <= want.length && got.every((s, i) => s === want[i]);
      expect(prefix && (want.length === 0 ? got.length === 0 : got.length > 0), req(ID_CURSOR, DOC_POLL, `afterSequence=${k} MUST return the events with sequence > ${k} in order — [${want.join(', ')}], or a non-empty prefix of it; got [${got.join(', ')}]`)).toBe(true);
      expect(p?.lastSequence, req(ID_CURSOR, DOC_POLL, `lastSequence is the highest sequence in the log (${max}) whatever the cursor; afterSequence=${k} answered ${JSON.stringify(p?.lastSequence)}`)).toBe(max);
      for (const e of p?.events ?? []) {
        expect(e.eventId, req(ID_CURSOR, DOC_POLL, `the event at sequence ${e.sequence} MUST keep its eventId across reads — the log is not renumbered (whole read: ${idAt.get(e.sequence) ?? 'absent'}, cursor read: ${e.eventId})`)).toBe(idAt.get(e.sequence));
      }
    }
    const walked = walk.flatMap(seqs);
    expect(walked, req(ID_CURSOR, DOC_POLL, `chaining afterSequence through the pages MUST rebuild the log with no gap and no duplicate: log [${all.join(', ')}], walk [${walked.join(', ')}] over ${walk.length} page(s)`)).toEqual(all);
    const lastPage = walk[walk.length - 1];
    expect(lastPage !== undefined && lastPage.status === 200 && lastPage.events.length === 0, req(ID_CURSOR, DOC_POLL, `the walk MUST end on a 200 with an empty events array once the cursor reaches the end (last page: ${lastPage === undefined ? 'none' : `${lastPage.status}, ${lastPage.events.length} event(s)`}; ${walk.length} page(s), cap ${MAX_PAGES})`)).toBe(true);
    expect(pastEnd?.status, req(ID_CURSOR, DOC_POLL, 'a cursor past the end of the log MUST answer 200')).toBe(200);
    expect(pastEnd?.lastSequence, req(ID_CURSOR, DOC_POLL, `a cursor past the end returns no events, yet lastSequence is still the highest sequence in the log (${max}), not a figure computed from the empty page (got ${JSON.stringify(pastEnd?.lastSequence)})`)).toBe(max);
  });

  it('every event type on the lifecycle fixtures\' logs is a codemap name or a registered vendor type', async () => {
    if ((await gateFamily('eventLog')) === null) return softSkip('inapplicable', 'the host does not advertise eventLog (gate recorded under openwop.family.eventLog)');
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const names = codemapV2Names();
    if (names === null) return softSkip('blocked', 'spec/v2/event-codemap.json is not on disk in this layout — the codemap is the authority this rule names, and the suite will not substitute a list of its own');
    const orgs = registeredOrgs();

    const fixtures = [NOOP, ...[MULTI, FAILURE].filter((f) => isFixtureAdvertised(f))];
    const logs: Array<{ fixture: string; types: string[] }> = [];
    for (const fixture of fixtures) {
      const run = await settledRun(fixture);
      if ('reason' in run) {
        if (logs.length === 0) return softSkip('blocked', run.reason);
        continue;
      }
      const page = await poll(run.runId, null);
      if (page === null || page.status !== 200 || page.events.length === 0) continue;
      logs.push({ fixture, types: page.events.map((e) => e.type) });
    }
    if (logs.length === 0) return softSkip('blocked', `no log of ${fixtures.join(', ')} could be read through the poll`);

    for (const { fixture, types } of logs) {
      for (const type of new Set(types)) {
        const named = names.has(type);
        if (!named && orgs === undefined) return blockedDespiteAssertions(`${fixture} emitted ${type}, which the codemap does not name, and spec/v2/declaration.json is not on disk to say whether its org is registered`);
        const org = type.split('.')[0] ?? '';
        const vendor = !named && org !== 'openwop' && orgs !== undefined && orgs.has(org);
        expect(named || vendor, req(ID_CODEMAP, DOC_CODEMAP, `a host advertising eventLog MUST NOT emit a type the codemap does not name: ${fixture} emitted ${type}, which is not a v2 name in spec/v2/event-codemap.json, and its org "${org}" is not registered in spec/v2/declaration.json extensions`)).toBe(true);
      }
    }
  });
});
