/**
 * `spec/v2/core/runs.md` §Annotations, artifacts, eval summary — an annotation
 * is a live notification, never a run event (suite 2.0.0, target major 2; gated
 * on `feedback`; one run created).
 *
 * `createAnnotation` answers 201 with `schemas/v2/annotation.schema.json`;
 * `listAnnotations` returns `{ annotations[] }` carrying it (the control — a host
 * that discards annotations would otherwise pass the next assertion for free);
 * the run's event log MUST NOT carry it: no `run.annotated` in the poll, and
 * the event count MUST NOT grow across the create. `runs.md` §Surface says
 * `501` when `feedback` is unadvertised while the registry has no 501 code but
 * `credential_unavailable` (finding 4, filed); 501 or 404 records inapplicable.
 *
 * @see spec/v2/core/runs.md §Annotations, artifacts, eval summary
 * @see schemas/v2/annotation-create.schema.json
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily, v2Validator } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0170.run-annotation-not-event';
const DOC = 'spec/v2/core/runs.md §Annotations, artifacts, eval summary';
const NOOP = 'conformance-noop';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
const enc = (id: string): string => encodeURIComponent(id);
async function events(runId: string): Promise<Array<{ type?: unknown }> | null> {
  const res = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  const ev = (res?.json as { events?: unknown } | null)?.events;
  return res?.status === 200 && Array.isArray(ev) ? (ev as Array<{ type?: unknown }>) : null;
}

describe('v2 run-annotation-not-event (runs.md §Annotations)', () => {
  it('an annotation is created and listed, and never enters the run\'s event log', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('feedback'))) return softSkip('inapplicable', 'feedback family not advertised (gate recorded under openwop.family.feedback) — annotations are gated on feedback (runs.md §Surface)');
    const created = await http(() => driver.post('/runs', { workflowId: NOOP }));
    if (created === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (created.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs answered ${created.status} ${readErrorCode(created.json) ?? ''}`.trim());
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) { const s = await http(() => driver.get(`/runs/${enc(runId)}`)); if (s?.status === 200 && TERMINAL.has(String((s.json as { status?: unknown }).status))) break; await new Promise((r) => setTimeout(r, 250)); }
    const before = await events(runId);
    if (before === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll did not answer 200 before the annotation');

    const ann = await http(() => driver.post(`/runs/${enc(runId)}/annotations`, { signal: { kind: 'label', label: 'conformance' }, note: 'openwop conformance annotation' }));
    if (ann === null) return softSkip('blocked', 'POST /runs/{runId}/annotations unreachable (fetch failed)');
    if (ann.status === 501 || ann.status === 404) return softSkip('blocked', `POST /runs/{runId}/annotations answered ${ann.status} although feedback is advertised — the surface is not mounted (an unadvertised feedback answers 404 not_found; 501 is not a registered shape)`);
    expect(ann.status, req(ID, DOC, `createAnnotation MUST answer 201 — got ${ann.status} ${readErrorCode(ann.json) ?? ''}`.trim())).toBe(201);
    const check = v2Validator('annotation')(ann.json);
    expect(check.ok, req(ID, 'schemas/v2/annotation.schema.json', `the 201 body MUST validate: ${check.errors}`)).toBe(true);
    const annotationId = (ann.json as { annotationId?: unknown } | null)?.annotationId;

    const list = await http(() => driver.get(`/runs/${enc(runId)}/annotations`));
    if (list === null) return softSkip('blocked', 'GET /runs/{runId}/annotations unreachable (fetch failed)');
    expect(list.status, req(ID, DOC, `listAnnotations MUST answer 200 — got ${list.status}`)).toBe(200);
    const rows = (list.json as { annotations?: unknown } | null)?.annotations;
    expect(Array.isArray(rows) && rows.some((r) => (r as { annotationId?: unknown }).annotationId === annotationId), req(ID, DOC, 'listAnnotations MUST return the annotation just created (the control: a host that discards annotations must not pass the log assertion for free)')).toBe(true);

    const after = await events(runId);
    if (after === null) return softSkip('blocked', 'GET /runs/{runId}/events/poll did not answer 200 after the annotation');
    expect(after.some((e) => String(e.type) === 'run.annotated'), req(ID, DOC, 'run.annotated is a live notification and MUST NOT enter the event log')).toBe(false);
    expect(after.length, req(ID, DOC, `the event log MUST NOT grow across an annotation (${before.length} → ${after.length})`)).toBe(before.length);
  }, 30_000);
});
