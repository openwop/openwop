/**
 * Shared helpers for the RFC 0056 feedback/annotation conformance scenarios.
 * Lives in lib/ (not a *.test.ts) so the scenarios can import it via the
 * standard `../lib/feedback.js` path.
 */
import { driver } from './driver.js';
import { discoveryFamilies } from './discovery-capabilities.js';
import { isFixtureAdvertised } from './fixtures.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

/** Reads `capabilities.feedback` from discovery; null when unadvertised. */
export async function readFeedbackCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = discoveryFamilies(body);
  const fb = top && typeof top === 'object' ? (top as Record<string, unknown>)['feedback'] : undefined;
  return fb && typeof fb === 'object' ? (fb as Record<string, unknown>) : null;
}

const SEED_FIXTURE = 'conformance-noop';

/** Seeds a run via the basic `conformance-noop` fixture; null (soft-skip)
 *  when the fixture isn't advertised or creation fails. */
export async function seedRun(_label: string): Promise<string | null> {
  if (!isFixtureAdvertised(SEED_FIXTURE)) return null;
  // S41 (2026-08-17): the argument used to be sent as `tenantId` on POST /v1/runs. It was
  // a fabricated label (`mem-attr-emit`, `feedback-cti`, …), and a host that enforces
  // "tenantId MUST match the principal's accessible workspaces" answers 403 — MyndHyve did,
  // which left every scenario on this helper `blocked` and kept `openwop-memory` from
  // certifying. No caller ever needed a SECOND tenant: every leg reads back its own run.
  // The tenant is the credential's own tenant (the host defaults it from the API key —
  // rest-endpoints.md), which is what "a run the bearer provably owns" means.
  const r = await driver.post('/v1/runs', { workflowId: SEED_FIXTURE, inputs: {} });
  if (r.status !== 200 && r.status !== 201) return null;
  return (r.json as { runId?: string } | undefined)?.runId ?? null;
}
