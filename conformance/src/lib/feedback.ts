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
export async function seedRun(tenantId: string): Promise<string | null> {
  if (!isFixtureAdvertised(SEED_FIXTURE)) return null;
  const r = await driver.post('/v1/runs', { workflowId: SEED_FIXTURE, tenantId, inputs: {} });
  if (r.status !== 200 && r.status !== 201) return null;
  return (r.json as { runId?: string } | undefined)?.runId ?? null;
}
