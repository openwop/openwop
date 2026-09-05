/**
 * `spec/v2/core/runs.md` §Cancel — `bulkCancelRuns` (suite 2.0.0, target major 2;
 * unaided).
 *
 * Legs:
 *   1. over the cap: 101 syntactically valid tenant-bound ids MUST be refused
 *      `400 validation_error` with `details.maxRunIds` (creates nothing);
 *   2. `[own, foreign-tenant, own]` MUST answer `200 { results[] }` in request
 *      order even when every entry failed; the foreign entry is `ok: false` with
 *      an error envelope in the entry — never a top-level 403. The prose names
 *      `run_forbidden` for a run the caller cannot see while identity.md §5 names
 *      `id_tenant_mismatch` / `not_found` for a foreign tenant segment; the leg
 *      accepts any of the three and the disagreement is filed (finding 3). An
 *      own entry on an already-terminal noop is `ok: true` with
 *      `cancelling | cancelled` or `ok: false` with `run_terminal` (finding 1).
 *
 * The foreign id matches the runId grammar, so a 400 on leg 2 is a host defect,
 * not body validation.
 *
 * @see spec/v2/core/runs.md §Cancel
 * @see spec/v2/core/identity.md §5
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, v2Validator } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0170.run-bulk-cancel';
const DOC = 'spec/v2/core/runs.md §Cancel';
const NOOP = 'conformance-noop';
const FOREIGN = 'openwop-conformance-foreign-tenant/foreignopaque0123456789abcdef';

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }
async function create(): Promise<{ runId: string } | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId: NOOP }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | null)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs answered ${res.status} ${readErrorCode(res.json) ?? ''} — create refused`.trim() };
  return { runId };
}
interface Entry { runId?: unknown; ok?: unknown; status?: unknown; error?: unknown }

describe('v2 run-bulk-cancel (runs.md §Cancel)', () => {
  it('101 ids are refused 400 validation_error with details.maxRunIds', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const runIds = Array.from({ length: 101 }, (_, i) => `openwop-conformance-bulk-cap/opaque${String(i).padStart(3, '0')}0123456789abcdef`);
    const res = await http(() => driver.post('/runs:bulk-cancel', { runIds }));
    if (res === null) return softSkip('blocked', 'POST /runs:bulk-cancel unreachable (fetch failed)');
    if (res.status === 404) return softSkip('blocked', 'POST /runs:bulk-cancel answered 404 — bulkCancelRuns is a core operation (runs.md §Surface) and is not mounted');
    expect(res.status, req(ID, DOC, `over the cap (RECOMMENDED 100) the host MUST answer 400 — got ${res.status}`)).toBe(400);
    expect(readErrorCode(res.json), req(ID, DOC, 'the refusal MUST be validation_error')).toBe('validation_error');
    // The v2 envelope is { error: <code>, message, details? } — `details` at the ROOT
    // (schemas/v2/error-envelope.schema.json). rc.48/rc.49 read `error.details`
    // and reported a host defect that was this reader's; retracted in rc.50.
    const max = (res.json as { details?: { maxRunIds?: unknown } } | null)?.details?.maxRunIds;
    expect(typeof max === 'number' && max >= 1 && max <= 100, req(ID, DOC, `details.maxRunIds MUST state the cap (got ${String(max)})`)).toBe(true);
  });

  it('results[] come back in request order, each id processed independently, a foreign id refused in its entry and never as a top-level 403', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const a = await create(); if ('reason' in a) return softSkip('blocked', a.reason);
    const b = await create(); if ('reason' in b) return softSkip('blocked', b.reason);
    const runIds = [a.runId, FOREIGN, b.runId];
    const res = await http(() => driver.post('/runs:bulk-cancel', { runIds, reason: 'conformance' }));
    if (res === null) return softSkip('blocked', 'POST /runs:bulk-cancel unreachable (fetch failed)');
    if (res.status === 404) return softSkip('blocked', 'POST /runs:bulk-cancel answered 404 — not mounted');
    expect(res.status, req(ID, DOC, `bulkCancelRuns MUST answer 200 even when entries fail — a foreign id MUST NOT surface as a top-level ${res.status} ${readErrorCode(res.json) ?? ''}`.trim())).toBe(200);
    const results = (res.json as { results?: unknown } | null)?.results;
    expect(Array.isArray(results) && results.length === 3, req(ID, DOC, `results[] MUST carry one entry per requested id (got ${Array.isArray(results) ? results.length : typeof results})`)).toBe(true);
    const entries = results as Entry[];
    expect(entries.map((e) => e.runId), req(ID, DOC, 'results[] MUST be in request order')).toEqual(runIds);
    const foreign = entries[1]!;
    expect(foreign.ok, req(ID, DOC, 'the foreign-tenant entry MUST be ok: false')).toBe(false);
    // An entry's `error` IS the error envelope (api/v2/openapi.yaml: `$ref error-envelope`):
    // { error: <code>, message, details? } nested under the entry — so the code is
    // `entry.error.error`, read the same way as a top-level envelope.
    const env = v2Validator('error-envelope')(foreign.error);
    expect(env.ok, req(ID, 'api/v2/openapi.yaml bulkCancelRuns results[].error', `an ok: false entry's error MUST be the error envelope { error: <code>, message, details? } (schemas/v2/error-envelope.schema.json; the OpenAPI $refs it for results[].error) — got ${JSON.stringify(foreign.error)}: ${env.errors}`)).toBe(true);
    const fcode = String(readErrorCode(foreign.error));
    expect(['id_tenant_mismatch', 'not_found'].includes(fcode), req(ID, 'spec/v2/core/identity.md §5', `an id whose tenant segment is not the caller's MUST be refused inside the entry with id_tenant_mismatch (or not_found where existence is not leaked) — identity.md §5 applies inside a bulk entry exactly as on a path; run_forbidden is for a same-tenant run the caller may not cancel — got ${fcode}`)).toBe(true);
    for (const own of [entries[0]!, entries[2]!]) {
      const okShape = own.ok === true && ['cancelling', 'cancelled'].includes(String(own.status));
      const terminalShape = own.ok === false && readErrorCode(own.error) === 'run_terminal';
      expect(okShape || terminalShape, req(ID, DOC, `an own entry MUST be ok: true with cancelling|cancelled, or ok: false run_terminal when the noop already completed — got ${JSON.stringify(own)}`)).toBe(true);
    }
  });
});
