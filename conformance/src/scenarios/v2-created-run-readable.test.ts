/**
 * `spec/v2/core/runs.md` §Create + `versioning.md` §1.2 — a run created at a
 * base is readable at that base by the id the base returned, and the links in
 * the create response stay on that base (suite 2.0.0, target major 2; unaided;
 * creates one run).
 *
 * This is the assertion the suite deferred to a soft-skip. `v2-id-grammar`
 * reads the run it just created and, on a non-200, records `blocked` — the
 * honest word for "the host did not let me look". It is the wrong word when
 * the host DID answer and the answer was `404 No route matches this request`,
 * because that is not evidence going unread; it is a routing hole, and a
 * `blocked` row over a routing hole is a vacuous pass one step removed.
 *
 * Measured 2026-09-05 on a tier-1 host through its public origin: a run
 * created at `https://app.openwop.dev` under major 2 could not be read,
 * polled, cancelled or streamed at `https://app.openwop.dev` — the hosting
 * layer decoded the tenant-bound id's `%2F` to `/` before forwarding, and the
 * backend correctly had no route for a literal slash. One hop behind, the
 * direct service URL answered every read with 200. Every bound id was
 * unreachable through the front door, and every bound-id scenario recorded
 * `blocked`. The same create response linked `eventsUrl` and `statusUrl` to
 * `http://<the direct service host>/…` — a client that follows them leaves the
 * origin it discovered on and downgrades to plain http.
 *
 * Two hard assertions, then: the read-back MUST be 200 at the same base, and
 * the links MUST resolve under the request's origin without a scheme
 * downgrade — a relative path satisfies both.
 *
 * @see spec/v2/core/runs.md §Create
 * @see spec/v2/core/versioning.md §1.2
 * @see spec/v2/core/identity.md §5
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0172.created-run-readable';
const DOC = 'spec/v2/core/runs.md §Create';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const RUN_ID = /^[A-Za-z0-9._~-]{1,128}\/[A-Za-z0-9._~-]{16,128}$/;

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** A link is on-base when it is relative, or absolute under the request origin with the same scheme. */
function linkOnBase(link: unknown, baseUrl: string): { ok: boolean; why: string } {
  if (typeof link !== 'string' || link.length === 0) return { ok: false, why: 'not a non-empty string' };
  if (link.startsWith('/')) return { ok: true, why: 'relative' };
  let l: URL; let b: URL;
  try { l = new URL(link); b = new URL(baseUrl); } catch { return { ok: false, why: 'not a URL' }; }
  if (l.protocol === 'http:' && b.protocol === 'https:') return { ok: false, why: `scheme downgrade ${b.protocol} → ${l.protocol}` };
  if (l.origin !== b.origin) return { ok: false, why: `origin ${l.origin} is not the request origin ${b.origin}` };
  return { ok: true, why: 'same-origin absolute' };
}

describe('v2 created-run-readable (runs.md §Create)', () => {
  it('a run created at this base is readable and pollable at this base by the id it returned, and its links stay on this base', async () => {
    try { if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable'); } catch { return softSkip('blocked', 'v2 discovery unreachable'); }
    const { baseUrl } = loadEnv();
    const created = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
    if (created === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (created.status === 429) return softSkip('blocked', 'POST /runs answered 429 — the run budget, not the wire');
    const body = (created.json ?? {}) as { runId?: unknown; eventsUrl?: unknown; statusUrl?: unknown };
    if (created.status !== 201 || typeof body.runId !== 'string') return softSkip('blocked', `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim());
    const runId = body.runId;
    expect(RUN_ID.test(runId), req(ID, 'spec/v2/core/identity.md §5', `the created runId MUST be tenant-bound (got ${runId})`)).toBe(true);

    // HARD, not soft: the base that minted the id MUST resolve it. A 404 here is
    // not evidence going unread; it is the front door not routing its own ids.
    const read = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
    expect(
      read?.status ?? null,
      req(ID, DOC, `GET /runs/{runId} at the base that created the run MUST answer 200 by the id it returned — got ${read?.status ?? 'no response'} ${readErrorCode(read?.json) ?? ''}. A 404 "No route matches" for a tenant-bound id is a hosting layer decoding %2F to / before the backend sees the path: every bound id is unreachable through this base`.trim()),
    ).toBe(200);
    const poll = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`));
    expect(
      poll?.status ?? null,
      req(ID, 'spec/v2/core/events.md §Poll', `GET /runs/{runId}/events/poll at the base that created the run MUST answer 200 — got ${poll?.status ?? 'no response'} ${readErrorCode(poll?.json) ?? ''}`.trim()),
    ).toBe(200);

    // The links in the create response MUST keep the client on this base.
    const ev = linkOnBase(body.eventsUrl, baseUrl);
    expect(
      ev.ok,
      req(ID, DOC, `eventsUrl MUST resolve under the origin the create was made to, without a scheme downgrade — a relative path satisfies both (got ${JSON.stringify(body.eventsUrl)}: ${ev.why}). A link to a different host leaves the origin the client discovered on; http on an https origin is a downgrade`),
    ).toBe(true);
    if (body.statusUrl !== undefined) {
      const st = linkOnBase(body.statusUrl, baseUrl);
      expect(st.ok, req(ID, DOC, `statusUrl, when present, MUST resolve under the request origin without a scheme downgrade (got ${JSON.stringify(body.statusUrl)}: ${st.why})`)).toBe(true);
    }
  });
});
