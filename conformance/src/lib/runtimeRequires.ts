/**
 * Shared helper for the RFC 0076 §A `runtime.requires[]` install-gate
 * conformance scenarios. Lives in lib/ (not a *.test.ts) so scenarios import it
 * via `../lib/runtimeRequires.js`.
 *
 * Drives the conformance-only host seam specified in host-sample-test-seams.md
 * §"Open seams": `POST /v1/host/sample/packs/install-gate`. The seam evaluates a
 * manifest's `runtime.requires[]` against a simulated host grant-set and returns
 * the install-time outcome the host would produce — letting a single seam
 * exercise the grant / refuse / non-sandbox-projection behaviors deterministically.
 */
import { driver } from './driver.js';

export interface InstallGateRequest {
  /** The candidate pack manifest (carrying runtime.requires[]). */
  manifest: Record<string, unknown>;
  /** Primitives the simulated sandbox grants. Ignored when `gating === false`. */
  grantSet?: string[];
  /** Whether the simulated host gates platform access. Default true (sandbox host). */
  gating?: boolean;
}

export interface InstallGateResponse {
  /** HTTP status the seam returned (200 install, 400 refuse). */
  status: number;
  /** Parsed response body. */
  body: Record<string, unknown>;
}

/**
 * Drives one install-gate evaluation via the host-sample seam, or null
 * (soft-skip) when the host doesn't expose it.
 */
export async function installGate(req: InstallGateRequest): Promise<InstallGateResponse | null> {
  const res = await driver.post('/v1/host/sample/packs/install-gate', req as unknown as Record<string, unknown>);
  if (res.status === 404 || res.status === 405) return null; // seam absent — soft-skip
  return { status: res.status, body: (res.json as Record<string, unknown> | undefined) ?? {} };
}
