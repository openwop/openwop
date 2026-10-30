/**
 * v2-interrupt-form-rules — RFC 0255 §E, `spec/v2/core/interrupt.md` §Forms
 * (target major 2; gated on fixtures, no capability or seam).
 *
 * A `clarification` MAY carry `data.form`, a closed declarative form
 * (`schemas/v2/interrupt-form.schema.json`). The suite cannot make a node invent
 * a form, so every leg runs a fixture whose `core.clarificationGate` node passes
 * `config.form` verbatim as `data.form` (fixtures.md §conformance-interrupt-form).
 *
 * Legs:
 *   1. the positive fixture suspends `waiting-input`, and its `interrupt.requested`
 *      validates against `InterruptPayload` and carries the form unchanged beside
 *      `questions`;
 *   2. `{ answers: [{ id, answer }] }` resolves it and the run completes;
 *   3. neither probe is raised with its form: `-refused` fails the schema (an
 *      obscured TextField solicits a secret), `-unbound` is schema-valid but its
 *      input names no `questions[].id`. The positive fixture is the control in the
 *      same leg, so a host that raises no form at all cannot pass.
 *
 * Forms are OPTIONAL: a host advertising none of the fixtures records every leg
 * `inapplicable`. A host advertising the positive fixture but not both probes
 * records leg 3 `blocked`, so it cannot claim forms without the refusal.
 * Rendering (closed catalog, no code execution, no fetch) is render-side and is
 * witnessed by the reference-impl invariants `interrupt-form-no-code-exec` and
 * `interrupt-form-no-network-egress`, not here.
 *
 * @see spec/v2/core/interrupt.md §Forms
 * @see RFCS/0255-delete-the-ai-envelope.md §E
 * @see SECURITY/invariants.yaml id: interrupt-form-action-confinement
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { FIXTURES_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

type Json = Record<string, unknown>;
interface Ev { type?: string; payload?: Json }

const DOC = 'spec/v2/core/interrupt.md §Forms (RFC 0255 §E)';
const R = (slug: string): string => `openwop.requirement.0255.${slug}`;
const POSITIVE = 'conformance-interrupt-form';
const PROBES = ['conformance-interrupt-form-refused', 'conformance-interrupt-form-unbound'] as const;
const NODE = 'ask';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const validInterrupt = v2Validator('suspend-request');

const formOf = (fixture: string): Json => (JSON.parse(readFileSync(join(FIXTURES_DIR, `${fixture}.json`), 'utf8')) as { nodes: Array<{ config: { form: Json } }> }).nodes[0]!.config.form;
const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
async function discovery(): Promise<Json | null> { try { return await v2Discovery(); } catch { return null; } }

async function statusOf(runId: string): Promise<string | null> {
  const r = await http(() => driver.get(`/runs/${enc(runId)}`));
  return r?.status === 200 ? String((r.json as { status?: unknown } | null)?.status ?? '') : null;
}
/** Wait until the run is terminal or suspended (any `waiting-*`), or `ms` elapses. */
async function settle(runId: string, ms = 10_000): Promise<string | null> {
  const end = Date.now() + ms;
  for (;;) {
    const s = await statusOf(runId);
    if (s !== null && (TERMINAL.has(s) || s.startsWith('waiting-'))) return s;
    if (Date.now() > end) return s;
    await new Promise((ok) => setTimeout(ok, 200));
  }
}
async function events(runId: string): Promise<Ev[]> {
  const r = await http(() => driver.get(`/runs/${enc(runId)}/events/poll?timeout=1`));
  return (r?.json as { events?: Ev[] } | null)?.events ?? [];
}
const requested = (evs: Ev[]): Ev[] => evs.filter((e) => e.type === 'interrupt.requested');
const dataOf = (e: Ev | undefined): Json | undefined => (e?.payload?.['data'] as Json | undefined);

/** Start `fixture` and return its runId, or why it could not be started. */
async function start(fixture: string): Promise<{ runId: string } | { reason: string }> {
  const r = await http(() => driver.post('/runs', { workflowId: fixture }));
  if (r === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (r.json as { runId?: unknown } | null)?.runId;
  if (r.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs (${fixture}) answered ${r.status} ${readErrorCode(r.json) ?? ''}`.trim() };
  return { runId };
}
/** The positive fixture, suspended, with its `interrupt.requested`. */
async function raised(): Promise<{ runId: string; ev: Ev | undefined } | { reason: string }> {
  const s = await start(POSITIVE);
  if ('reason' in s) return s;
  const status = await settle(s.runId);
  if (status !== 'waiting-input') return { reason: `the ${POSITIVE} run did not suspend waiting-input (status ${String(status)})` };
  return { runId: s.runId, ev: requested(await events(s.runId)).find((e) => e.payload?.['kind'] === 'clarification') };
}

describe('v2 interrupt-form-rules (interrupt.md §Forms, RFC 0255 §E)', () => {
  it('a clarification raised with a form carries it unchanged, beside questions, in a valid InterruptPayload', async () => {
    if (!isFixtureAdvertised(POSITIVE)) return softSkip('inapplicable', `${POSITIVE} is not advertised — forms are OPTIONAL and this host claims none`);
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const r = await raised();
    if ('reason' in r) return softSkip('blocked', r.reason);
    expect(r.ev, req(R('interrupt-form-rules'), DOC, 'the suspended run MUST record interrupt.requested { kind: "clarification" }')).toBeDefined();
    const v = validInterrupt(r.ev?.payload);
    expect(v.ok, req(R('interrupt-form-rules'), DOC, `interrupt.requested MUST validate against InterruptPayload, form included: ${v.errors}`)).toBe(true);
    const data = dataOf(r.ev);
    expect((data?.['questions'] as Array<{ id?: unknown }> | undefined)?.map((q) => q.id), req(R('interrupt-form-rules'), DOC, 'questions MUST stay beside the form as its fallback')).toEqual(['q1']);
    expect(data?.['form'], req(R('interrupt-form-rules'), DOC, 'data.form MUST be the fixture\'s form, unchanged')).toEqual(formOf(POSITIVE));
  }, 45_000);

  it('a form resolves with { answers: [{ id, answer }] } and the run completes', async () => {
    if (!isFixtureAdvertised(POSITIVE)) return softSkip('inapplicable', `${POSITIVE} is not advertised — forms are OPTIONAL and this host claims none`);
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const r = await raised();
    if ('reason' in r) return softSkip('blocked', r.reason);
    const resumeValue = { answers: [{ id: 'q1', answer: 'blue' }] };
    const res = await http(() => driver.post(`/runs/${enc(r.runId)}/interrupts/${NODE}`, { resumeValue }));
    if (res === null) return softSkip('blocked', 'the resolve was unreachable (fetch failed)');
    expect(res.status, req(R('interrupt-form-resume-answers'), DOC, `a resolve carrying { answers: [{ id, answer }] } MUST be accepted (got ${res.status} ${readErrorCode(res.json) ?? ''})`)).toBeGreaterThanOrEqual(200);
    expect(res.status, req(R('interrupt-form-resume-answers'), DOC, 'the resolve MUST be a 2xx')).toBeLessThan(300);
    expect(await settle(r.runId), req(R('interrupt-form-resume-answers'), DOC, 'the resolved run MUST complete')).toBe('completed');
  }, 45_000);

  it('a form that fails the schema or binds an input to no question is never raised', async () => {
    if (!isFixtureAdvertised(POSITIVE)) return softSkip('inapplicable', `${POSITIVE} is not advertised — forms are OPTIONAL and this host claims none`);
    const missing = PROBES.filter((p) => !isFixtureAdvertised(p));
    if (missing.length > 0) return softSkip('blocked', `${POSITIVE} is advertised but ${missing.join(', ')} is not — a host claiming forms MUST also advertise the refusal probes`);
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const control = await raised();
    if ('reason' in control) return softSkip('blocked', `control: ${control.reason}`);
    expect(dataOf(control.ev)?.['form'], req(R('interrupt-form-refused'), DOC, 'control: the positive fixture MUST raise its form, or a host raising none would pass')).toEqual(formOf(POSITIVE));
    for (const probe of PROBES) {
      const s = await start(probe);
      // Refusing the run at creation also never raises the form; only a non-answer is undecidable.
      if ('reason' in s) { if (/answered 4\d\d/.test(s.reason)) continue; return softSkip('blocked', `${probe}: ${s.reason}`); }
      const status = await settle(s.runId);
      const carrying = requested(await events(s.runId)).filter((e) => dataOf(e)?.['form'] !== undefined);
      expect(carrying.map((e) => dataOf(e)?.['form']), req(R('interrupt-form-refused'), DOC, `${probe}: no interrupt.requested may carry the form (run status ${String(status)})`)).toEqual([]);
      await http(() => driver.post(`/runs/${enc(s.runId)}/cancel`, {}));
    }
    await http(() => driver.post(`/runs/${enc(control.runId)}/cancel`, {}));
  }, 60_000);
});
