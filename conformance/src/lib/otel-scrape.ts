/**
 * Driver helpers for the OTel + debug-bundle test seams (E.2 + E.3).
 *
 * Used by aiEnvelope + cost-attribution scenarios that need to verify
 * span-attribute redaction (no BYOK canary in OTel attributes) and
 * debug-bundle export shape.
 */

import { driver } from './driver.js';

export interface TestSpan {
  readonly spanId: string;
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly envelopeId?: string;
  readonly runId?: string;
  readonly timestamp: string;
}

export interface DebugBundle {
  readonly runId: string;
  readonly events: unknown[];
  readonly spans: TestSpan[];
  readonly exportedAt: string;
}

export type ScrapeOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'seam_unavailable' }
  | { ok: false; reason: 'http_error'; status: number };

export async function queryTestSpans(
  filter: { envelopeId?: string; runId?: string; name?: string } = {},
): Promise<ScrapeOutcome<TestSpan[]>> {
  const qs = new URLSearchParams();
  if (filter.envelopeId) qs.set('envelopeId', filter.envelopeId);
  if (filter.runId) qs.set('runId', filter.runId);
  if (filter.name) qs.set('name', filter.name);
  const url = `/v1/host/sample/test/otel/spans${qs.toString() ? '?' + qs.toString() : ''}`;
  const res = await driver.get(url);
  if (res.status === 404) return { ok: false, reason: 'seam_unavailable' };
  if (res.status !== 200) return { ok: false, reason: 'http_error', status: res.status };
  const body = res.json as { spans?: TestSpan[] };
  return { ok: true, data: body.spans ?? [] };
}

export async function exportDebugBundle(runId: string): Promise<ScrapeOutcome<DebugBundle>> {
  const res = await driver.post('/v1/host/sample/test/debug-bundle/export', { runId });
  if (res.status === 404) return { ok: false, reason: 'seam_unavailable' };
  if (res.status !== 200) return { ok: false, reason: 'http_error', status: res.status };
  const body = res.json as { bundle?: DebugBundle };
  if (!body.bundle) return { ok: false, reason: 'http_error', status: 500 };
  return { ok: true, data: body.bundle };
}

export async function isOtelSeamAvailable(): Promise<boolean> {
  const res = await queryTestSpans({ runId: '__probe__' });
  return res.ok;
}
