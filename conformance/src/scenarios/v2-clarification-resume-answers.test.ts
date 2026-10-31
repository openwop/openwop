/**
 * `spec/v2/core/interrupt.md` §"Re-entry and resume values" — a host MUST accept
 * `{ answers: [{ id, answer }] }`, each `id` a `questions[].id`, as a
 * `clarification` resume value, with or without a form (suite 2.46.37, target
 * major 2; one run created).
 *
 * Until 2.46.37 `fixtures.md` taught `{answers: {q1: "blue"}}` for
 * `conformance-clarification`, and only the form row (`v2-interrupt-form-rules`)
 * resolved a clarification with the array at major 2. A host can take the keyed
 * object from the fixture text and refuse the array, as the v2 reference host
 * did until openwop-examples#179.
 *
 * Leg: `conformance-clarification` suspends `waiting-input` with question `q1`;
 * `{ answers: [{ id: "q1", answer: "blue" }] }` resolves it with a 2xx; the run
 * completes. A host not advertising the fixture records the leg `inapplicable`.
 *
 * @see spec/v2/core/interrupt.md §Re-entry and resume values
 * @see conformance/fixtures.md §conformance-clarification
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/interrupt.md §Re-entry and resume values';
const ID = 'openwop.requirement.interrupt.clarification-resume-answers';
const FIXTURE = 'conformance-clarification';
const NODE = 'ask';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

const enc = (id: string): string => encodeURIComponent(id);
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

/** Wait until the run is terminal or suspended (any `waiting-*`), or `ms` elapses. */
async function settle(runId: string, ms = 10_000): Promise<string | null> {
  const end = Date.now() + ms;
  for (;;) {
    const r = await http(() => driver.get(`/runs/${enc(runId)}`));
    const s = r?.status === 200 ? String((r.json as { status?: unknown } | null)?.status ?? '') : null;
    if (s !== null && (TERMINAL.has(s) || s.startsWith('waiting-'))) return s;
    if (Date.now() > end) return s;
    await new Promise((ok) => setTimeout(ok, 200));
  }
}

describe('v2 clarification resume value (interrupt.md §Re-entry and resume values)', () => {
  it('a clarification resolves with { answers: [{ id, answer }] } and the run completes', async () => {
    if (!isFixtureAdvertised(FIXTURE)) return softSkip('inapplicable', `${FIXTURE} is not advertised — the suite cannot raise a clarification`);
    try { await v2Discovery(); } catch { return softSkip('blocked', 'v2 discovery unreachable'); }
    const create = await http(() => driver.post('/runs', { workflowId: FIXTURE }));
    if (create === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    const runId = (create.json as { runId?: unknown } | null)?.runId;
    if (create.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs (${FIXTURE}) answered ${create.status} ${readErrorCode(create.json) ?? ''}`.trim());
    const suspended = await settle(runId);
    if (suspended !== 'waiting-input') return softSkip('blocked', `the ${FIXTURE} run did not suspend waiting-input (status ${String(suspended)})`);
    const res = await http(() => driver.post(`/runs/${enc(runId)}/interrupts/${NODE}`, { resumeValue: { answers: [{ id: 'q1', answer: 'blue' }] } }));
    if (res === null) return softSkip('blocked', 'the resolve was unreachable (fetch failed)');
    expect(res.status, req(ID, DOC, `a clarification resolve carrying { answers: [{ id, answer }] } MUST be accepted (got ${res.status} ${readErrorCode(res.json) ?? ''})`)).toBeGreaterThanOrEqual(200);
    expect(res.status, req(ID, DOC, 'the resolve MUST be a 2xx')).toBeLessThan(300);
    expect(await settle(runId), req(ID, DOC, 'the resolved run MUST complete')).toBe('completed');
  });
});
