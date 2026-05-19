/**
 * Driver helpers for the test-only event-log query seam
 * (`GET /v1/host/sample/test/runs/:runId/events`).
 *
 * Used by aiEnvelope engine-projection scenarios that verify the
 * spec-prescribed events the host MUST emit on each envelope outcome
 * (per RFC 0021 §A point 1-7 + interrupt.md + capabilities.md
 * §"cap.breached"). All operations soft-skip on HTTP 404 — hosts
 * without the seam keep the existing advertisement-shape coverage.
 *
 * Reset semantics: callers SHOULD `resetTestSeam()` in their test's
 * `afterEach` (or scope each test to a unique runId) to keep state
 * from leaking across scenarios.
 */

import { driver } from './driver.js';

export interface TestEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
  readonly sequence: number;
  readonly causationId?: string;
  readonly nodeId?: string;
  readonly contentTrust?: 'trusted' | 'untrusted';
}

export type QueryOutcome =
  | { ok: true; events: TestEvent[] }
  | { ok: false; reason: 'seam_unavailable' }
  | { ok: false; reason: 'http_error'; status: number };

/** Query the test-only event log for a run, with optional filters. */
export async function queryTestEvents(
  runId: string,
  filter: { type?: string; correlationId?: string; causationId?: string; nodeId?: string } = {},
): Promise<QueryOutcome> {
  const qs = new URLSearchParams();
  if (filter.type) qs.set('type', filter.type);
  if (filter.correlationId) qs.set('correlationId', filter.correlationId);
  if (filter.causationId) qs.set('causationId', filter.causationId);
  if (filter.nodeId) qs.set('nodeId', filter.nodeId);
  const url = `/v1/host/sample/test/runs/${encodeURIComponent(runId)}/events${qs.toString() ? '?' + qs.toString() : ''}`;
  const res = await driver.get(url);
  if (res.status === 404) return { ok: false, reason: 'seam_unavailable' };
  if (res.status !== 200) return { ok: false, reason: 'http_error', status: res.status };
  const body = res.json as { events?: TestEvent[] };
  return { ok: true, events: body.events ?? [] };
}

/** Reset the test-only event log + capability overlay (suite teardown). */
export async function resetTestSeam(): Promise<void> {
  await driver.post('/v1/host/sample/test/reset', {});
}

/** Probe whether the seam is exposed. Use to soft-skip early. */
export async function isEventLogSeamAvailable(): Promise<boolean> {
  const res = await queryTestEvents('__probe__');
  return res.ok;
}
