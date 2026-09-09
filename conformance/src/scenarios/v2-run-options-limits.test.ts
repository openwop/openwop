/**
 * `spec/v2/core/runs.md` §Run options — `tags`, `metadata`, and the closed
 * create body (suite 2.0.0, target major 2; unaided; one run created).
 *
 * `tags` is opaque: a host MUST NOT reject a tag on format and MUST answer
 * `400 validation_error` over the limits (100 entries, 256 characters).
 * `metadata` MUST be persisted and surface unchanged on the snapshot, as MUST
 * `tags`. The create body is closed at the composition, so an unknown ROOT key
 * MUST be refused `400 validation_error` (`v2-configurable-closed` covers keys
 * inside `configurable` only).
 *
 * The refusals are the control for the acceptance and vice versa: a host that
 * accepts everything fails the 400 legs; a host that refuses odd tags fails the
 * 201 leg. `""` is deliberately not among the odd tags — the schema's
 * `minLength: 1` is a length rule, not a format rule (finding 4).
 *
 * @see spec/v2/core/runs.md §Run options
 * @see schemas/v2/run-options.schema.json
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0171.run-options-limits';
const DOC = 'spec/v2/core/runs.md §Run options';
const NOOP = 'conformance-noop';
const ODD_TAGS = ['has space', 'emoji 🚀', 'slash/colon:pipe|', 'UPPER-and_under', 'x'.repeat(256)];
const METADATA = { nested: { a: 1, b: [1, '2', null, true] }, s: 'unicode ∞ ok', n: 0 };

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

async function refused(body: Record<string, unknown>, what: string): Promise<string | null> {
  const res = await http(() => driver.post('/runs', body));
  if (res === null) return `POST /runs unreachable (fetch failed) for ${what}`;
  expect(res.status, req(ID, DOC, `${what} MUST be refused 400 — got ${res.status} ${readErrorCode(res.json) ?? ''}`.trim())).toBe(400);
  expect(readErrorCode(res.json), req(ID, DOC, `the refusal for ${what} MUST be validation_error`)).toBe('validation_error');
  return null;
}

describe('v2 run-options-limits (runs.md §Run options)', () => {
  it('more than 100 tags, a tag over 256 characters, and an unknown root key are each refused 400 validation_error', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const probes: Array<[Record<string, unknown>, string]> = [
      [{ workflowId: NOOP, tags: Array.from({ length: 101 }, (_, i) => `t${i}`) }, '101 tags'],
      [{ workflowId: NOOP, tags: ['y'.repeat(257)] }, 'a 257-character tag'],
      [{ workflowId: NOOP, conformanceUnknownRootKey: 1 }, 'an unknown root key on the create body (closed at the composition)'],
    ];
    for (const [body, what] of probes) { const r = await refused(body, what); if (r) return softSkip('blocked', r); }
  });

  it('odd-format tags and free-form metadata are accepted and surface unchanged on the snapshot', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const res = await http(() => driver.post('/runs', { workflowId: NOOP, tags: ODD_TAGS, metadata: METADATA }));
    if (res === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    expect(res.status, req(ID, DOC, `a host MUST NOT reject a tag on format and MUST accept free-form metadata — got ${res.status} ${readErrorCode(res.json) ?? ''}`.trim())).toBe(201);
    const runId = (res.json as { runId?: unknown } | null)?.runId;
    if (typeof runId !== 'string') return softSkip('blocked', 'the 201 carried no runId');
    const snap = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
    if (snap === null || snap.status !== 200) return softSkip('blocked', `GET /runs/{runId} answered ${snap?.status ?? 'no response'} for the run just created`);
    const body = snap.json as { tags?: unknown; metadata?: unknown } | null;
    expect(body?.tags, req(ID, DOC, 'tags MUST surface unchanged on RunSnapshot')).toEqual(ODD_TAGS);
    expect(body?.metadata, req(ID, DOC, 'metadata MUST be persisted and surface unchanged on RunSnapshot')).toEqual(METADATA);
  });
});
