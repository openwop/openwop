/**
 * Shared helpers for the RFC 0057 memory write-attribution scenarios.
 * Lives in lib/ (not a *.test.ts) so scenarios import it via `../lib/memoryAttribution.js`.
 */
import { driver } from './driver.js';
import { discoveryFamilies } from './discovery-capabilities.js';
import { isFixtureAdvertised } from './fixtures.js';

/** Reads `capabilities.memory.attribution` from discovery; null when unadvertised. */
export async function readMemoryAttributionCap(): Promise<Record<string, unknown> | null> {
  const res = await driver.get('/.well-known/openwop');
  const caps = discoveryFamilies(res.json);
  const mem = caps && typeof caps === 'object' ? (caps as Record<string, unknown>)['memory'] : undefined;
  const attr = mem && typeof mem === 'object' ? (mem as Record<string, unknown>)['attribution'] : undefined;
  return attr && typeof attr === 'object' ? (attr as Record<string, unknown>) : null;
}

/** True when the host commits to emitting `memory.written`. */
export function emitsWriteEvents(cap: Record<string, unknown> | null): boolean {
  return cap?.['supported'] === true && cap?.['emitsWriteEvents'] === true;
}

const SEED_FIXTURE = 'conformance-noop';

/** Seeds a basic run (the host writes a run-summary on completion); null
 *  (soft-skip) when the fixture isn't advertised or creation fails. */
export async function seedRun(tenantId: string): Promise<string | null> {
  if (!isFixtureAdvertised(SEED_FIXTURE)) return null;
  const r = await driver.post('/v1/runs', { workflowId: SEED_FIXTURE, tenantId, inputs: {} });
  if (r.status !== 200 && r.status !== 201) return null;
  return (r.json as { runId?: string } | undefined)?.runId ?? null;
}

interface RunEventLike {
  type: string;
  runId?: string;
  payload?: Record<string, unknown>;
}

/** Fetches a run's events and returns only the `memory.written` ones. */
export async function memoryWrittenEvents(runId: string): Promise<RunEventLike[]> {
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events`);
  const events = (res.json as { events?: RunEventLike[] } | undefined)?.events ?? [];
  return events.filter((e) => e.type === 'memory.written');
}
