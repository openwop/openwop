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
 * **Minting (RFC 0184 §A.2), a second `it`.** A host MUST NOT mint a
 * tenant-bound id containing `~`; ids already minted MUST still resolve, so only
 * an id this run mints is checked, never every id a body carries. Unescaped, a
 * literal `~` is ambiguous with the codec's own marker. openwop-app minted
 * `user~3A<hash>/<id>` for personal and org tenants (app ADR 0814: it projected
 * the tenant key instead of mapping it), and no leg saw it, because the
 * conformance key sat in the clean tenant `default`. **The leg bites only when
 * the suite's credential sits in a tenant whose key is not already clean**: on a
 * clean tenant a host with that defect still mints a clean id, so a green row is
 * evidence only under a non-clean posture; the `it` title says so. Proven on
 * openwop-app 800722836 (2026-10-05): under `acme@corp.example` the ADR 0814 map
 * passes (`x-61636d65…/…`) and the reverted projection fails
 * (`acme~40corp.example/…`); under `default` both builds pass. The in-process
 * harness (`conformance/run.ts`) overwrites `OPENWOP_API_KEYS` with a `:*` key, so
 * moving the tenant needs that line edited, not just the env var.
 *
 * Since 2.45.23 the leg also mints one run under `OPENWOP_TEST_TENANT_B_API_KEY`
 * when it is set, so a host can bind tenant B to a non-clean tenant and make the
 * leg bite in a production cut without moving the primary key (asked by
 * openwop-app, whose primary production tenant is clean).
 *
 * The codec's own edge cases (marker escaping, UTF-8 vs UTF-16, malformed
 * decode) are a unit concern and live in `src/lib/bound-id.test.ts`, which is
 * sabotage-checked. This file asserts only what needs a HOST to answer.
 *
 * @see spec/v2/core/identity.md §5
 * @see RFCS/0184-bound-id-path-projection.md §A.1
 * @see RFCS/0184-bound-id-path-projection.md §A.2
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
const ID_MINT = 'openwop.requirement.0184.mint-no-tilde';
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

    // APPLY-ONCE. The codec is deliberately NOT idempotent — escaping the
    // marker is what makes it injective — so a host that projects twice breaks
    // its OWN links. Both reporting hosts found they already compose payload
    // projections on a single read path, so this is a live shape, not a
    // thought experiment. Asserting 404 (not merely "not 200") keeps the leg
    // from passing on a 500.
    // What "not resolve" looks like depends on the host's majors. Decoded once, a
    // double projection is a BARE id (it still carries `~2F`, no slash). Through
    // the overlap the bare form is admitted and resolved under the caller's tenant
    // — no such run, 404. Once the host advertises no 1.x member, identity.md §5
    // requires the bare form itself to be refused `400 validation_error` — and
    // the reference host's retirement lane (2.3.2) failed a CONFORMANT retired
    // host on an unconditional 404 here.
    const twice = projectBoundId(projected);
    const doubled = await http(() => driver.get(`/runs/${twice}`));
    const disc = await v2Discovery();
    const versions = Array.isArray(disc?.['protocolVersions']) ? (disc?.['protocolVersions'] as unknown[]).map(String) : [];
    const singleMajor = !versions.some((v) => v.startsWith('1.'));
    const want = singleMajor ? 400 : 404;
    expect(
      doubled?.status ?? null,
      req(ID, DOC, `a DOUBLE-projected segment MUST NOT resolve — the codec is not idempotent, so projecting twice yields a different id and a host that does it strands its own links. Expected ${want} (${singleMajor ? 'single-major host: the decoded bare form is refused 400 validation_error' : 'dual-stack host: the bare form resolves under the caller tenant and is not found'}) for ${twice}, got ${doubled?.status ?? 'no response'} ${readErrorCode(doubled?.json) ?? ''}`.trim()),
    ).toBe(want);
    if (singleMajor) {
      expect(readErrorCode(doubled?.json), req(ID, DOC, 'a single-major host refuses the bare form with validation_error (identity.md §5), not not_found')).toBe('validation_error');
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

  it('a tenant-bound id the host mints for this run contains no ~ (bites only when the credential tenant is not grammar-clean)', async () => {
    try { if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable'); } catch { return softSkip('blocked', 'v2 discovery unreachable'); }
    const created = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
    if (created === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    if (created.status === 429) return softSkip('blocked', 'POST /runs answered 429 — the run budget, not the wire');
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (created.status !== 201 || typeof runId !== 'string') {
      return softSkip('blocked', `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim());
    }
    // The body carries the bound id, never the projection (identity.md §5: ids in
    // documents and bodies are bound). So a `~` here was minted, not escaped.
    expect(
      runId.includes('~'),
      req(ID_MINT, DOC, `a host MUST NOT mint a tenant-bound id containing ~ (RFC 0184 §A.2) — the created runId is ${runId}. A literal ~ is ambiguous with the path projection's escape marker; map the tenant key to a clean segment instead of projecting it`),
    ).toBe(false);

    // The second-tenant credential, when configured, mints one more run, so a
    // host can put tenant B in a non-clean tenant without moving the primary key
    // every other scenario depends on. A refused create here skips only this half.
    const other = process.env['OPENWOP_TEST_TENANT_B_API_KEY']?.trim();
    if (other && other !== process.env['OPENWOP_API_KEY']?.trim()) {
      const createdB = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }, { headers: { Authorization: `Bearer ${other}` } }));
      const runIdB = (createdB?.json as { runId?: unknown } | null | undefined)?.runId;
      if (createdB?.status === 201 && typeof runIdB === 'string') {
        expect(
          runIdB.includes('~'),
          req(ID_MINT, DOC, `a host MUST NOT mint a tenant-bound id containing ~ (RFC 0184 §A.2) — the runId created under the second-tenant credential is ${runIdB}`),
        ).toBe(false);
      }
    }
  });
});
