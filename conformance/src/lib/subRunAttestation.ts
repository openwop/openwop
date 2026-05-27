/**
 * Shared helper for the RFC 0063 sub-run output-attestation conformance
 * scenarios. Lives in lib/ (not a *.test.ts) so scenarios import it via
 * `../lib/subRunAttestation.js`.
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `agents.subRunAttestation` from discovery (root-first per RFC 0073);
 *  null when the host advertises no `agents` block (treated as no support). */
export async function readSubRunAttestationCap(): Promise<boolean | null> {
  const agents = await readCapabilityFamily<Record<string, unknown>>('agents');
  if (!agents || typeof agents !== 'object') return null;
  const flag = agents['subRunAttestation'];
  return flag === undefined ? null : flag === true;
}

interface AttestResult {
  attestation?: { checksum?: unknown; algorithm?: unknown };
  harvestedEvent?: Record<string, unknown>;
  merged?: unknown;
  mergedValues?: Record<string, unknown>;
}

/** Drives one sub-run harvest-then-merge via the host-sample seam, or null
 *  (soft-skip) when the host doesn't expose it. The seam is host-extension
 *  surface specified in host-sample-test-seams.md §"Open seams":
 *  `POST /v1/host/sample/subrun/attest` returns the `attestation` the host
 *  would surface on `core.workflowChain.event { phase: 'output.harvested' }`,
 *  plus whether the merge proceeded. */
export async function invokeSubRunAttest(body: Record<string, unknown>): Promise<AttestResult | null> {
  const res = await driver.post('/v1/host/sample/subrun/attest', body);
  if (res.status === 404 || res.status === 405) return null; // seam absent — soft-skip
  return (res.json as AttestResult | undefined) ?? {};
}
