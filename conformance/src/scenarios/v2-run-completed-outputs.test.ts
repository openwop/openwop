/**
 * `spec/v2/core/events.md` §Payloads — `run.completed` MUST carry `outputs`
 * (suite 2.0.0, target major 2; unaided).
 *
 * This requirement is one day old, and the reason it needed writing is the
 * reason this file exists. Both majors' payload schemas NAMED `outputs` on
 * `runCompleted` and REQUIRED nothing. v1 also left the object open. So a
 * tier-1 host emitted the singular `output` for its entire life and validated
 * every time; v2 closing the object caught the EXTRA key — and that is the
 * only reason anyone looked. Nothing in either major has ever caught an ABSENT
 * one: a host emitting `run.completed {}` validates in v1 and, until rc.35, in
 * v2. Seventeen scenario files mention `run.completed`; none read its payload.
 *
 * A key that no schema requires and no scenario reads is a requirement that
 * exists only as a property name — the same shape as `eventLogSchemaVersion`,
 * which lived in a schema `description` for the life of v1 while two hosts
 * shipped without it. Asserting the EFFECT (the terminal event of a run that
 * completed carries an outputs object) is the only form of this check a
 * permissive emitter cannot satisfy by accident.
 *
 * @see spec/v2/core/events.md §Payloads
 * @see schemas/v2/run-event-payloads.schema.json $defs/runCompleted
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0171.run-completed-outputs';
const DOC = 'spec/v2/core/events.md §Payloads';
const NOOP_WORKFLOW_ID = 'conformance-noop';

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function createRun(): Promise<{ runId: string } | { reason: string }> {
  try { if (!(await v2Discovery())) return { reason: 'v2 discovery unreachable' }; } catch { return { reason: 'v2 discovery unreachable' }; }
  const res = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${res.status} ${readErrorCode(res.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim() };
  return { runId };
}

interface Ev { readonly type?: unknown; readonly payload?: unknown }

/** Poll until the terminal event lands. The noop workflow completes in well under a second; the bound is for a slow host, not a slow workflow. */
async function terminalEvent(runId: string): Promise<{ ev: Ev } | { reason: string }> {
  let last: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const res = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`));
    if (res === null) return { reason: 'GET /runs/{runId}/events/poll unreachable (fetch failed)' };
    if (res.status !== 200) return { reason: `GET /runs/{runId}/events/poll answered ${res.status}` };
    const events = (res.json as { events?: unknown } | undefined)?.events;
    if (Array.isArray(events)) {
      const hit = events.find((e): e is Ev => typeof (e as Ev)?.type === 'string' && (e as Ev).type === 'run.completed');
      if (hit) return { ev: hit };
      const failed = events.find((e): e is Ev => typeof (e as Ev)?.type === 'string' && /^run\.(failed|cancelled)$/.test(String((e as Ev).type)));
      if (failed) return { reason: `the noop run reached ${String(failed.type)} rather than run.completed — nothing to assert outputs on` };
      last = `${events.length} event(s), none terminal`;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { reason: `run.completed never appeared (${last ?? 'no events'}) — the host may not run the noop workflow to completion` };
}

describe('v2 run-completed-outputs (events.md §Payloads)', () => {
  it('the run.completed event of a run that completed carries an outputs object', async () => {
    const c = await createRun();
    if ('reason' in c) return softSkip('blocked', c.reason);
    const t = await terminalEvent(c.runId);
    if ('reason' in t) return softSkip('blocked', t.reason);

    const payload = (t.ev.payload ?? null) as { outputs?: unknown; output?: unknown } | null;
    expect(
      payload !== null && typeof payload === 'object',
      req(ID, DOC, 'run.completed MUST carry a payload object'),
    ).toBe(true);
    expect(
      payload !== null && typeof payload.outputs === 'object' && payload.outputs !== null && !Array.isArray(payload.outputs),
      req(ID, DOC, `run.completed MUST carry \`outputs\` as an object (an empty object is valid) — a client cannot tell "no outputs" from "outputs not rendered" when the key is absent, and no schema in either major required it until rc.35, which is how a host emitted the singular \`output\` for its whole life. Got keys ${JSON.stringify(payload ? Object.keys(payload) : null)}`),
    ).toBe(true);

    // The schema now requires it too; assert through the validator so the two
    // cannot drift apart again without this leg saying which one moved.
    const r = v2Validator('run-event')(t.ev);
    expect(r.ok, req(ID, DOC, `the terminal event MUST validate against run-event.schema.json, whose runCompleted payload now requires outputs (${r.errors})`)).toBe(true);
  });
});
