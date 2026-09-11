/**
 * RFC 0182 — `run-list` (suite 2.1.0, target major 2; gated on the `runList`
 * family; `spec/v2/core/runs.md` §List).
 *
 * Witness class: witnessable — gated. A host that advertises `runList` MUST
 * serve `GET /runs` as a tenant-scoped, cursor-paginated list of the caller's
 * runs: two runs the suite just created appear (§A.2), every `runId` in the
 * body carries the caller's tenant segment — the segment of the ids the host
 * minted for this credential moments ago (§A.2), no page exceeds the advertised
 * `maxPageSize` (§A.3), a cursor the host did not mint is refused
 * `400 validation_error` (§A.3), and when the `filters` facet names
 * `workflowId` the filtered list contains only that workflow (§A.4). The body
 * is validated against `run-list-response.schema.json`, which `$ref`s
 * `run-snapshot.schema.json` — so a bare id anywhere fails the shape leg
 * before it fails the tenant leg.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { gateFamily, v2Discovery, v2Validator } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/runs.md §List';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const MAX_PAGES = 50;

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function createRun(): Promise<{ runId: string } | { reason: string }> {
  const res = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
  if (res === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (res.json as { runId?: unknown } | undefined)?.runId;
  if (res.status !== 201 || typeof runId !== 'string') return { reason: `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${res.status} ${readErrorCode(res.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim() };
  return { runId };
}

function tenantOf(runId: string): string { return runId.slice(0, runId.indexOf('/')); }

type Page = { runs?: unknown; nextCursor?: unknown };

/** Walk the list from the first page, collecting run ids, until the last page or MAX_PAGES. */
async function walk(query: string, maxPageSize: number): Promise<{ ids: string[]; pages: Page[]; reason?: string }> {
  const ids: string[] = []; const pages: Page[] = []; let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = `${query}${query ? '&' : '?'}limit=${maxPageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await http(() => driver.get(`/runs${q}`));
    if (res === null) return { ids, pages, reason: `GET /runs${q} unreachable (fetch failed)` };
    if (res.status !== 200) return { ids, pages, reason: `GET /runs${q} answered ${res.status} ${readErrorCode(res.json) ?? ''}` };
    const page = res.json as Page; pages.push(page);
    for (const r of Array.isArray(page.runs) ? page.runs : []) { const id = (r as { runId?: unknown }).runId; if (typeof id === 'string') ids.push(id); }
    if (typeof page.nextCursor !== 'string') break;
    cursor = page.nextCursor;
  }
  return { ids, pages };
}

describe('RFC 0182 — run-list (gated on runList)', () => {
  it('two runs the caller just created appear, every id is bound to the caller\'s tenant, and no page exceeds maxPageSize', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const fam = await gateFamily('runList');
    if (!fam) return softSkip('inapplicable', 'runList family not advertised — no obligation (gate recorded under openwop.family.runList)');
    const maxPageSize = typeof fam['maxPageSize'] === 'number' ? fam['maxPageSize'] : NaN;
    expect(Number.isInteger(maxPageSize) && maxPageSize >= 1, req('openwop.requirement.0182.run-list.facets', 'spec/v2/core/capabilities.md § runList', `runList.maxPageSize MUST be an integer ≥ 1 (got ${String(fam['maxPageSize'])})`)).toBe(true);
    const a = await createRun(); if ('reason' in a) return softSkip('blocked', a.reason);
    const b = await createRun(); if ('reason' in b) return softSkip('blocked', b.reason);
    const tenant = tenantOf(a.runId);
    const walked = await walk('', maxPageSize);
    if (walked.reason && walked.pages.length === 0) return softSkip('blocked', walked.reason);
    const validate = v2Validator('run-list-response');
    for (const page of walked.pages) {
      const v = validate(page);
      expect(v.ok, req('openwop.requirement.0182.run-list.shape', DOC, `every page MUST validate against run-list-response.schema.json — runs[] of RunSnapshot (bound runId) plus optional nextCursor (${v.errors})`)).toBe(true);
      expect((page.runs as unknown[]).length <= maxPageSize, req('openwop.requirement.0182.run-list.page-ceiling', DOC, `a page MUST NOT exceed the advertised runList.maxPageSize (${maxPageSize}); got ${(page.runs as unknown[]).length}`)).toBe(true);
    }
    expect(walked.ids.includes(a.runId) && walked.ids.includes(b.runId), req('openwop.requirement.0182.run-list.contains-created', DOC, `a run the caller just created MUST appear in its unfiltered list — created ${a.runId} and ${b.runId}; walked ${walked.ids.length} id(s) over ${walked.pages.length} page(s)${walked.reason ? ` (${walked.reason})` : ''}`)).toBe(true);
    const foreign = walked.ids.filter((id) => tenantOf(id) !== tenant);
    expect(foreign, req('openwop.requirement.0182.run-list.tenant-scoped', 'spec/v2/core/identity.md §5', `every runId in the list MUST carry the caller's tenant segment (${tenant}) — the list is tenant-scoped by construction; found ${foreign.length} other(s): ${foreign.slice(0, 3).join(', ')}`)).toEqual([]);
  });

  it('a cursor the host did not mint is refused 400 validation_error', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    if (!(await gateFamily('runList'))) return softSkip('inapplicable', 'runList family not advertised — no obligation (gate recorded under openwop.family.runList)');
    const res = await http(() => driver.get('/runs?cursor=openwop-conformance-not-a-cursor'));
    if (res === null) return softSkip('blocked', 'GET /runs?cursor=… unreachable (fetch failed)');
    expect(res.status, req('openwop.requirement.0182.run-list.cursor-refused', DOC, `a cursor the host did not mint MUST be refused 400 validation_error; got ${res.status} ${readErrorCode(res.json) ?? ''}`)).toBe(400);
    expect(readErrorCode(res.json), req('openwop.requirement.0182.run-list.cursor-refused', 'spec/v2/core/errors.md', 'the refusal MUST carry validation_error')).toBe('validation_error');
  });

  it('when the filters facet names workflowId, a filtered list contains only that workflow', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const fam = await gateFamily('runList');
    if (!fam) return softSkip('inapplicable', 'runList family not advertised — no obligation (gate recorded under openwop.family.runList)');
    const filters = Array.isArray(fam['filters']) ? (fam['filters'] as unknown[]) : [];
    if (!filters.includes('workflowId')) return softSkip('inapplicable', 'runList.filters does not name workflowId — the filter leg has no obligation');
    const maxPageSize = typeof fam['maxPageSize'] === 'number' ? fam['maxPageSize'] : 1;
    const c = await createRun(); if ('reason' in c) return softSkip('blocked', c.reason);
    const walked = await walk(`?workflowId=${encodeURIComponent(NOOP_WORKFLOW_ID)}`, maxPageSize);
    if (walked.reason && walked.pages.length === 0) return softSkip('blocked', walked.reason);
    const others = walked.pages.flatMap((p) => (Array.isArray(p.runs) ? p.runs : [])).filter((r) => (r as { workflowId?: unknown }).workflowId !== NOOP_WORKFLOW_ID);
    expect(others.length, req('openwop.requirement.0182.run-list.filter-exact', DOC, `a workflowId filter MUST be exact — every listed run's workflowId MUST equal ${NOOP_WORKFLOW_ID}; found ${others.length} other(s)`)).toBe(0);
    expect(walked.ids.includes(c.runId), req('openwop.requirement.0182.run-list.filter-exact', DOC, `the filtered list MUST still contain the ${NOOP_WORKFLOW_ID} run the caller just created (${c.runId})`)).toBe(true);
  });
});
