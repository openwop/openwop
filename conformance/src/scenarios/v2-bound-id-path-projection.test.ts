/**
 * `spec/v2/core/identity.md` §5 + RFC 0184 §A.1 — a tenant-bound id travels as
 * ONE path segment under the `~`-escape projection (suite 2.2.0, target major
 * 2; unaided; creates one run).
 *
 * A tenant-bound id is two segments joined by `/`. A path parameter is one. The
 * corpus used to say `%2F` carries the separator across, and
 * `v2-created-run-readable.test.ts` records what that cost: a tier-1 host's
 * hosting layer decoded `%2F` back to `/` before forwarding, the backend
 * correctly had no route for a literal slash, and EVERY bound id was
 * unreachable through the host's own front door. One hop behind, the direct
 * service URL answered 200.
 *
 * The projection escapes with `~`, which RFC 3986 §2.3 lists as UNRESERVED — an
 * intermediary has no license to rewrite it, so `~2F` reaches the origin
 * byte-for-byte. That is the whole argument: `%2F` needs a front door to tell a
 * percent-encoded RESERVED octet (§6.2.2.2 says MUST NOT decode) from an
 * unreserved one (SHOULD decode), and deployed front doors do not.
 *
 * **What this file does NOT assert.** The percent-encoded form still MUST work
 * — `identity.md` §5 keeps it, removing it would be breaking, and
 * `v2-created-run-readable` already witnesses it. Duplicating it here would red
 * two rows for one defect and tell a bundle reader nothing new.
 *
 * The codec's own edge cases (marker escaping, UTF-8 vs UTF-16, malformed
 * decode) are a unit concern and live in `src/lib/bound-id.test.ts`, which is
 * sabotage-checked. This file asserts only what needs a HOST to answer.
 *
 * @see spec/v2/core/identity.md §5
 * @see RFCS/0184-bound-id-path-projection.md §A.1
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { projectBoundId } from '../lib/bound-id.js';
import { BOUND_ID as BOUND } from '../lib/bound-id.js';

const ID = 'openwop.requirement.0184.bound-id-path-projection';
const DOC = 'spec/v2/core/identity.md §5';
const NOOP_WORKFLOW_ID = 'conformance-noop';

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

describe('v2 bound-id path projection (identity.md §5)', () => {
  it('a tenant-bound id is readable at its ~-escaped path segment, links carry that form, and a malformed escape is refused', async () => {
    try { if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable'); } catch { return softSkip('blocked', 'v2 discovery unreachable'); }

    const created = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
    if (created === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (created.status === 429) return softSkip('blocked', 'POST /runs answered 429 — the run budget, not the wire');
    const body = (created.json ?? {}) as { runId?: unknown; eventsUrl?: unknown };
    if (created.status !== 201 || typeof body.runId !== 'string') {
      return softSkip('blocked', `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim());
    }
    const runId = body.runId;
    if (!BOUND.test(runId)) return softSkip('blocked', `the created runId is not tenant-bound (${runId}) — nothing to project`);

    const projected = projectBoundId(runId);

    // The projection MUST leave nothing for an intermediary to decode. If this
    // fails the encoder is wrong, not the host — assert it before blaming a 404.
    expect(
      encodeURIComponent(projected),
      req(ID, DOC, `the projection MUST contain only RFC 3986 unreserved characters, so no intermediary can rewrite it (${projected})`),
    ).toBe(projected);

    // ACCEPT SIDE (the new MUST). A 404 here means the host has not implemented
    // the projection: it is not a routing accident, because the segment that
    // reached it is byte-identical to the one sent.
    const read = await http(() => driver.get(`/runs/${projected}`));
    expect(
      read?.status ?? null,
      req(ID, DOC, `GET /runs/{projected} MUST answer 200 — the host MUST accept a tenant-bound id as one ~-escaped segment. Got ${read?.status ?? 'no response'} ${readErrorCode(read?.json) ?? ''} for ${projected} (runId ${runId})`.trim()),
    ).toBe(200);
    expect(
      (read?.json as { runId?: unknown } | undefined)?.runId,
      req(ID, DOC, 'the run read at the projected segment MUST be the run that was created — a host that decodes the escape to a DIFFERENT id has a non-injective decoder'),
    ).toBe(runId);

    // EMIT SIDE. A host MUST hand back the form it wants clients to use; a link
    // still spelling %2F re-creates the front-door defect for every follower.
    if (typeof body.eventsUrl === 'string' && body.eventsUrl.includes(runId.split('/')[1]!)) {
      expect(
        body.eventsUrl.includes('%2F') || body.eventsUrl.includes('%2f'),
        req(ID, DOC, `a link carrying a tenant-bound id MUST use the ~-escaped projection, not %2F — a front door may decode %2F and strand every client that follows this link (eventsUrl ${body.eventsUrl})`),
      ).toBe(false);
      expect(
        body.eventsUrl.includes(projected),
        req(ID, DOC, `eventsUrl MUST carry the runId in its projected form ${projected} (got ${body.eventsUrl})`),
      ).toBe(true);
    }

    // DECODER RULE. A `~` not introducing two hex digits is malformed input, so
    // 400 — not 404, which would say "no such run" about a request that never
    // named one.
    const malformed = await http(() => driver.get(`/runs/${runId.split('/')[0]}~2`));
    expect(
      malformed?.status ?? null,
      req(ID, DOC, `a path segment whose '~' is not followed by two hex digits MUST be refused 400 validation_error — got ${malformed?.status ?? 'no response'} ${readErrorCode(malformed?.json) ?? ''}`.trim()),
    ).toBe(400);
  });
});
