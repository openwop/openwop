/**
 * RFC 0054 — run diff & execution comparison.
 *
 * Exercises `GET /v1/runs/{runId}:diff?against={otherRunId}` per
 * `spec/v1/rest-endpoints.md` §"GET /v1/runs/{runId}:diff" and
 * `schemas/run-diff-response.schema.json`. The endpoint is OPTIONAL —
 * hosts that don't implement it return 404 and these scenarios soft-skip.
 *
 * Coverage:
 *   - identical:  diffing a run against itself ⇒ divergedAtSeq null,
 *                 empty eventDiffs (the determinism floor).
 *   - divergence: diffing two structurally-different runs ⇒ a non-null
 *                 integer divergedAtSeq; eventDiffs begin at that seq.
 *   - state-shape: response conforms to run-diff-response.schema.json and
 *                 stateDiff is redaction-safe (no credential-shaped keys).
 *   - error-surface: missing `against` ⇒ 400; nonexistent `against` ⇒ 404
 *                 (the access boundary; full cross-principal authz needs a
 *                 multi-principal harness — host-specific).
 *
 * @see RFCS/0054-run-diff-and-execution-comparison.md
 * @see api/openapi.yaml §diffRun
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

// Two standard conformance fixtures with structurally-different event
// logs — diffing one against the other is a deterministic divergence.
const FIXTURE_A = 'conformance-agent-reasoning';
const FIXTURE_B = 'conformance-dispatch-loop';

interface DiffResponse {
  a: string;
  b: string;
  divergedAtSeq: number | null;
  eventDiffs: Array<{ seq: number; op: string; aEvent?: unknown; bEvent?: unknown }>;
  stateDiff: Record<string, unknown>;
  truncated?: boolean;
}

async function createRun(workflowId: string): Promise<string | null> {
  const res = await driver.post('/v1/runs', { workflowId });
  if (res.status !== 201) return null;
  return (res.json as { runId: string }).runId;
}

/** Poll until the run is terminal (best-effort; bounded). */
async function settle(runId: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const r = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    const status = (r.json as { status?: string })?.status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return;
    await new Promise((res) => setTimeout(res, 100));
  }
}

describe.skipIf(HTTP_SKIP)('run-diff: GET /v1/runs/{runId}:diff (RFC 0054)', () => {
  it('diffing a run against itself ⇒ divergedAtSeq null + empty eventDiffs', async (ctx) => {
    const runId = await createRun(FIXTURE_A);
    if (!runId) { ctx.skip(); return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)'); }
    await settle(runId);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}:diff?against=${encodeURIComponent(runId)}`);
    if (res.status === 404) { ctx.skip(); return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (endpoint not implemented) (seam, prior step, or fixture unavailable)'); } // endpoint not implemented
    expect(res.status, req('openwop.it.run-diff.diffing-a-run-against-itself-divergedatseq-null-empty-eventdiffs', 'spec/v1/rest-endpoints.md §:diff', 'self-diff MUST return 200')).toBe(200);

    const body = res.json as DiffResponse;
    expect(body.a).toBe(runId);
    expect(body.b).toBe(runId);
    expect(
      body.divergedAtSeq,
      req('openwop.it.run-diff.diffing-a-run-against-itself-divergedatseq-null-empty-eventdiffs', 'RFCS/0054 §C', 'identical logs MUST yield divergedAtSeq: null'),
    ).toBeNull();
    expect(body.eventDiffs, req('openwop.it.run-diff.diffing-a-run-against-itself-divergedatseq-null-empty-eventdiffs', 'RFCS/0054 §C', 'identical logs MUST yield an empty eventDiffs array')).toEqual([]);
  });

  it('diffing two structurally-different runs ⇒ non-null divergedAtSeq aligned to eventDiffs[0]', async (ctx) => {
    const [ra, rb] = await Promise.all([createRun(FIXTURE_A), createRun(FIXTURE_B)]);
    if (!ra || !rb) { ctx.skip(); return softSkip('blocked', 'precondition not met — `!ra || !rb` returned early (seam, prior step, or fixture unavailable)'); }
    await Promise.all([settle(ra), settle(rb)]);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(ra)}:diff?against=${encodeURIComponent(rb)}`);
    if (res.status === 404) { ctx.skip(); return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam, prior step, or fixture unavailable)'); }
    expect(res.status).toBe(200);

    const body = res.json as DiffResponse;
    expect(
      typeof body.divergedAtSeq === 'number' && body.divergedAtSeq >= 0,
      req('openwop.it.run-diff.diffing-two-structurally-different-runs-non-null-divergedatseq-aligned-to-eventd', 'RFCS/0054 §C', 'structurally-different runs MUST report a non-null integer divergedAtSeq'),
    ).toBe(true);
    expect(body.eventDiffs.length, req('openwop.it.run-diff.diffing-two-structurally-different-runs-non-null-divergedatseq-aligned-to-eventd', 'RFCS/0054 §C', 'divergent runs MUST report at least one eventDiff')).toBeGreaterThan(0);
    expect(
      body.eventDiffs[0]?.seq,
      req('openwop.it.run-diff.diffing-two-structurally-different-runs-non-null-divergedatseq-aligned-to-eventd', 'RFCS/0054 §C', 'eventDiffs MUST begin at divergedAtSeq'),
    ).toBe(body.divergedAtSeq);
    for (const d of body.eventDiffs) {
      expect(['added', 'removed', 'changed']).toContain(d.op);
    }
  });

  it('response conforms to run-diff-response.schema.json and stateDiff is redaction-safe', async (ctx) => {
    const [ra, rb] = await Promise.all([createRun(FIXTURE_A), createRun(FIXTURE_B)]);
    if (!ra || !rb) { ctx.skip(); return softSkip('blocked', 'precondition not met — `!ra || !rb` returned early (seam, prior step, or fixture unavailable)'); }
    await Promise.all([settle(ra), settle(rb)]);

    const res = await driver.get(`/v1/runs/${encodeURIComponent(ra)}:diff?against=${encodeURIComponent(rb)}`);
    if (res.status === 404) { ctx.skip(); return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam, prior step, or fixture unavailable)'); }
    expect(res.status).toBe(200);

    const body = res.json as DiffResponse;
    expect(typeof body.a === 'string' && typeof body.b === 'string', req('openwop.it.run-diff.response-conforms-to-run-diff-response-schema-json-and-statediff-is-redaction-sa', 'RFCS/0054 §B', 'a + b MUST be strings')).toBe(true);
    expect(Array.isArray(body.eventDiffs), req('openwop.it.run-diff.response-conforms-to-run-diff-response-schema-json-and-statediff-is-redaction-sa', 'RFCS/0054 §B', 'eventDiffs MUST be an array')).toBe(true);
    expect(body.stateDiff !== null && typeof body.stateDiff === 'object', req('openwop.it.run-diff.response-conforms-to-run-diff-response-schema-json-and-statediff-is-redaction-sa', 'RFCS/0054 §B', 'stateDiff MUST be an object')).toBe(true);
    // Redaction-safe: no credential-shaped material leaks into the diff.
    const serialized = JSON.stringify(body.stateDiff);
    expect(
      /sk-|api[_-]?key|secret|bearer\s/i.test(serialized),
      req('openwop.it.run-diff.response-conforms-to-run-diff-response-schema-json-and-statediff-is-redaction-sa', 'RFCS/0054 §B', 'stateDiff MUST be redaction-safe — no credential material'),
    ).toBe(false);
  });

  it('missing `against` ⇒ 400; nonexistent `against` ⇒ 404 (access boundary)', async (ctx) => {
    const runId = await createRun(FIXTURE_A);
    if (!runId) { ctx.skip(); return softSkip('blocked', 'precondition not met — `!runId` returned early (seam, prior step, or fixture unavailable)'); }

    const probe = await driver.get(`/v1/runs/${encodeURIComponent(runId)}:diff?against=${encodeURIComponent(runId)}`);
    if (probe.status === 404) { ctx.skip(); return softSkip('blocked', 'precondition not met — `probe.status === 404` returned early (endpoint not implemented at all) (seam, prior step, or fixture unavailable)'); } // endpoint not implemented at all

    const missing = await driver.get(`/v1/runs/${encodeURIComponent(runId)}:diff`);
    expect(
      missing.status,
      req('openwop.it.run-diff.missing-against-400-nonexistent-against-404-access-boundary', 'api/openapi.yaml §diffRun', 'missing required `against` query param MUST return 400'),
    ).toBe(400);

    const nonexistent = await driver.get(`/v1/runs/${encodeURIComponent(runId)}:diff?against=does-not-exist-${Date.now()}`);
    expect(
      nonexistent.status,
      req('openwop.it.run-diff.missing-against-400-nonexistent-against-404-access-boundary', 'RFCS/0054 §A', 'diffing against a run the caller cannot read/that does not exist MUST NOT return 200'),
    ).toBe(404);
  });
});
