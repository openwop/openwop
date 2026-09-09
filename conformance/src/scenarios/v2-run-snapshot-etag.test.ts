/**
 * `spec/v2/core/runs.md` §Snapshot — the conditional GET (suite 2.0.0, target
 * major 2; unaided; one run created).
 *
 * The 200 SHOULD carry a strong `ETag`; WHEN PRESENT, a matching
 * `If-None-Match` MUST receive `304` with no body. The SHOULD gates the MUST:
 * a host that sends no ETag records `inapplicable`. Every response carries
 * `OpenWOP-Version` (versioning.md §1.4), the 304 included.
 *
 * Control: a non-matching `If-None-Match` MUST receive 200 with the body — a
 * host that answers 304 to any conditional request fails here. `headers.md`
 * scopes `If-None-Match` to the discovery document; runs.md applies it to the
 * snapshot with a MUST (finding 5, filed).
 *
 * @see spec/v2/core/runs.md §Snapshot
 * @see spec/v2/core/versioning.md §1.4
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0170.run-snapshot-etag';
const DOC = 'spec/v2/core/runs.md §Snapshot';
const NOOP = 'conformance-noop';

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

describe('v2 run-snapshot-etag (runs.md §Snapshot)', () => {
  it('a matching If-None-Match receives 304 with no body and the version header; a non-matching one receives 200', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const created = await http(() => driver.post('/runs', { workflowId: NOOP }));
    if (created === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (created.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs answered ${created.status} ${readErrorCode(created.json) ?? ''} — create refused`.trim());
    const path = `/runs/${encodeURIComponent(runId)}`;
    // Let the noop settle so the tag is stable across the two conditional reads.
    await new Promise((r) => setTimeout(r, 1_000));
    const first = await http(() => driver.get(path));
    if (first === null || first.status !== 200) return softSkip('blocked', `GET /runs/{runId} answered ${first?.status ?? 'no response'}`);
    const etag = first.headers.get('etag');
    if (!etag) return softSkip('inapplicable', 'the snapshot carries no ETag — runs.md §Snapshot makes the ETag a SHOULD; the 304 rule applies only when it is present');
    const hit = await http(() => driver.get(path, { headers: { 'If-None-Match': etag } }));
    if (hit === null) return softSkip('blocked', 'conditional GET unreachable (fetch failed)');
    expect(hit.status, req(ID, DOC, `a request whose If-None-Match matches the ETag MUST receive 304 — got ${hit.status}`)).toBe(304);
    expect(hit.text.length, req(ID, DOC, `the 304 MUST carry no body (got ${hit.text.length} byte(s))`)).toBe(0);
    expect(hit.headers.get('openwop-version'), req(ID, 'spec/v2/core/versioning.md §1.4', 'every response carries OpenWOP-Version, the 304 included')).not.toBeNull();
    const miss = await http(() => driver.get(path, { headers: { 'If-None-Match': '"openwop-conformance-no-such-tag"' } }));
    if (miss === null) return softSkip('blocked', 'conditional GET unreachable (fetch failed)');
    expect(miss.status, req(ID, DOC, `a non-matching If-None-Match MUST receive 200 with the body — got ${miss.status} (a host answering 304 to any conditional request is not honouring the tag)`)).toBe(200);
    expect((miss.json as { runId?: unknown } | null)?.runId, req(ID, DOC, 'the 200 body is the snapshot')).toBe(runId);
  });
});
