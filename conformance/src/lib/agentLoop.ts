/**
 * Shared helper for the RFC 0061 stateful agent-loop-lifecycle
 * (`multiAgent.executionModel.version: 5`) conformance scenarios. Lives in lib/
 * (not a *.test.ts) so scenarios import it via `../lib/agentLoop.js`.
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `multiAgent.executionModel` from discovery (root-first per RFC 0073);
 *  null when the host advertises no execution model (treated as no support). */
export async function readExecutionModelCap(): Promise<Record<string, unknown> | null> {
  const ma = await readCapabilityFamily<{ executionModel?: unknown }>('multiAgent');
  const em = ma?.executionModel;
  return em && typeof em === 'object' ? (em as Record<string, unknown>) : null;
}

/** True when the host advertises `executionModel.version >= 5`. */
export function isVersion5(em: Record<string, unknown> | null): boolean {
  return typeof em?.version === 'number' && (em.version as number) >= 5;
}

/** True when the host advertises `workspace.supported: true` (root-first per RFC 0073). */
export async function hasWorkspace(): Promise<boolean> {
  const ws = await readCapabilityFamily<{ supported?: unknown }>('workspace');
  return ws?.supported === true;
}

interface LoopResult {
  decisions?: Array<{ iteration?: unknown }>;
  workspaceVisible?: { atWriteTurn?: unknown; atNextTurn?: unknown };
  resumedIteration?: unknown;
}

/** Drives one bounded stateful loop via the host-sample seam, or null
 *  (soft-skip) when the host doesn't expose it. The seam is host-extension
 *  surface specified in host-sample-test-seams.md §"Open seams":
 *  `POST /v1/host/sample/agentloop/run` returns the ordered
 *  `runOrchestrator.decided` payloads (each carrying `iteration`) the host
 *  would emit, plus optional workspace-visibility + resume reports. */
export async function invokeAgentLoop(body: Record<string, unknown>): Promise<LoopResult | null> {
  const res = await driver.post('/v1/host/sample/agentloop/run', body);
  if (res.status === 404 || res.status === 405) return null; // seam absent — soft-skip
  return (res.json as LoopResult | undefined) ?? {};
}
