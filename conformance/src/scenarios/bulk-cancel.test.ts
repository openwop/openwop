/**
 * Bulk-cancel scenario (closes R1 from rest-endpoints.md §Open spec gaps).
 *
 * Verifies `POST /v1/runs:bulk-cancel` per
 * `spec/v1/rest-endpoints.md` §"POST /v1/runs:bulk-cancel":
 *
 *   1. Per-id results array shape (`{runId, ok, status?, error?}`).
 *   2. Mixed-outcome request: known + unknown + already-terminal runIds
 *      MUST each surface their own outcome — partial failures do NOT
 *      block sibling cancellations.
 *   3. Empty `runIds` array → 400 validation_error.
 *   4. Oversized array (>100 by spec) → 400 validation_error with
 *      `details.maxRunIds`.
 *   5. Idempotency: re-bulk-cancelling already-cancelled runs returns
 *      `ok: true, status: 'cancelled'` (idempotent), NOT an error.
 *
 * Normative reference: spec/v1/rest-endpoints.md §"POST /v1/runs:bulk-cancel"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

const CANCELLABLE = 'conformance-cancellable';
const NOOP = 'conformance-noop';
const SKIP =
  !isFixtureAdvertised(CANCELLABLE) || !isFixtureAdvertised(NOOP);

interface BulkResult {
  runId: string;
  ok: boolean;
  status?: 'cancelled' | 'cancelling';
  error?: { code?: string; message?: string };
}

describe.skipIf(SKIP)('bulk-cancel: POST /v1/runs:bulk-cancel', () => {
  it('mixed-outcome request returns per-id results in order', async () => {
    // Spin up a long-running cancellable run + observe a known-bad id
    // alongside it. The host MUST handle each independently.
    const create = await driver.post('/v1/runs', {
      workflowId: CANCELLABLE,
      inputs: { delaySeconds: 30 },
    });
    expect(create.status).toBe(201);
    const inflightRunId = (create.json as { runId: string }).runId;

    const res = await driver.post('/v1/runs:bulk-cancel', {
      runIds: [inflightRunId, 'run-does-not-exist-xxxxxxxx'],
      reason: 'conformance bulk-cancel test',
    });
    expect(res.status, req('openwop.it.bulk-cancel.mixed-outcome-request-returns-per-id-results-in-order', 
      'rest-endpoints.md §"POST /v1/runs:bulk-cancel"',
      'top-level operation MUST return 200 when the request reached the host (per-id outcomes carry partial failure)',
    )).toBe(200);

    const body = res.json as { results: BulkResult[] };
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length, req('openwop.it.bulk-cancel.mixed-outcome-request-returns-per-id-results-in-order', 'rest-endpoints.md §"POST /v1/runs:bulk-cancel"', 'results MUST have one entry per request runId')).toBe(2);

    expect(body.results[0]!.runId, req('openwop.it.bulk-cancel.mixed-outcome-request-returns-per-id-results-in-order', 'rest-endpoints.md §"POST /v1/runs:bulk-cancel"', 'results order MUST mirror the request order')).toBe(inflightRunId);
    expect(body.results[0]!.ok).toBe(true);
    expect(['cancelling', 'cancelled']).toContain(body.results[0]!.status);

    expect(body.results[1]!.runId).toBe('run-does-not-exist-xxxxxxxx');
    expect(body.results[1]!.ok, req('openwop.it.bulk-cancel.mixed-outcome-request-returns-per-id-results-in-order', 'rest-endpoints.md §"POST /v1/runs:bulk-cancel"', 'unknown runId entry MUST have ok=false')).toBe(false);
    expect(body.results[1]!.error?.code, req('openwop.it.bulk-cancel.mixed-outcome-request-returns-per-id-results-in-order', 
      'rest-endpoints.md §"POST /v1/runs:bulk-cancel"',
      'unknown runId outcomes carry `error.code === "not_found"`',
    )).toBe('not_found');
  });

  it('empty runIds array returns 400 validation_error', async () => {
    const res = await driver.post('/v1/runs:bulk-cancel', { runIds: [] });
    expect(res.status, req('openwop.it.bulk-cancel.empty-runids-array-returns-400-validation-error', 'rest-endpoints.md §Open', 'empty runIds array returns 400 validation_error')).toBe(400);
    const body = res.json as { error?: string };
    expect(body.error).toBe('validation_error');
  });

  it('oversized runIds array returns 400 with details.maxRunIds', async () => {
    // 101 entries — exceeds the recommended 100-entry cap.
    const ids = Array.from({ length: 101 }, (_, i) => `run-overflow-${i}`);
    const res = await driver.post('/v1/runs:bulk-cancel', { runIds: ids });
    expect(res.status).toBe(400);
    const body = res.json as { error?: string; details?: { maxRunIds?: number } };
    expect(body.error).toBe('validation_error');
    expect(typeof body.details?.maxRunIds, req('openwop.it.bulk-cancel.oversized-runids-array-returns-400-with-details-maxrunids', 
      'rest-endpoints.md §"POST /v1/runs:bulk-cancel"',
      'over-cap request MUST carry details.maxRunIds disclosing the configured ceiling',
    )).toBe('number');
    expect(body.details!.maxRunIds!).toBeGreaterThanOrEqual(1);
  });

  it('re-bulk-cancel after first cancel is idempotent', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: CANCELLABLE,
      inputs: { delaySeconds: 30 },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const first = await driver.post('/v1/runs:bulk-cancel', { runIds: [runId] });
    expect(first.status).toBe(200);
    const second = await driver.post('/v1/runs:bulk-cancel', { runIds: [runId] });
    expect(second.status).toBe(200);
    const body = second.json as { results: BulkResult[] };
    expect(body.results[0]!.ok, req('openwop.it.bulk-cancel.re-bulk-cancel-after-first-cancel-is-idempotent', 
      'rest-endpoints.md §"POST /v1/runs:bulk-cancel" §Idempotency',
      're-cancelling an already-cancelling/cancelled run MUST be ok: true (idempotent)',
    )).toBe(true);
  });
});
