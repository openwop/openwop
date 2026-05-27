/**
 * Shared helper for the RFC 0062 scheduled-memory-distillation ("dreams")
 * conformance scenarios. Lives in lib/ (not a *.test.ts) so scenarios import it
 * via `../lib/distillation.js`.
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `memory.distillation` from discovery (root-first per RFC 0073); null
 *  when the host advertises no distillation sub-block (treated as no support). */
export async function readDistillationCap(): Promise<Record<string, unknown> | null> {
  const memory = await readCapabilityFamily<{ distillation?: unknown }>('memory');
  const d = memory?.distillation;
  return d && typeof d === 'object' ? (d as Record<string, unknown>) : null;
}

interface DistillResult {
  event?: { distillation?: { tokenBudget?: unknown; tokensUsed?: unknown; indexUpdated?: unknown } };
  error?: unknown;
  archiveChecksum?: unknown;
  indexUpdated?: unknown;
  indexFile?: unknown;
}

/** Drives one budgeted distillation run via the host-sample seam, or null
 *  (soft-skip) when the host doesn't expose it. The seam is host-extension
 *  surface specified in host-sample-test-seams.md §"Open seams":
 *  `POST /v1/host/sample/memory/distill` returns the `memory.compacted` event
 *  (with the additive RFC 0062 `distillation` sub-object) the host would emit,
 *  plus the stable archive's checksum. Returns the raw status alongside the
 *  body so scenarios can assert the `token_budget_exceeded` failure path. */
export async function invokeDistill(
  body: Record<string, unknown>,
): Promise<{ status: number; body: DistillResult } | null> {
  const res = await driver.post('/v1/host/sample/memory/distill', body);
  if (res.status === 404 || res.status === 405) return null; // seam absent — soft-skip
  return { status: res.status, body: (res.json as DistillResult | undefined) ?? {} };
}
