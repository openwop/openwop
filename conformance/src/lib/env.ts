/**
 * Env-var validation for the openwop conformance suite.
 *
 * Required:
 *   OPENWOP_BASE_URL — the server root, e.g., https://api.example.com
 *   OPENWOP_API_KEY  — credential for runs:read / manifest:read scopes
 *
 * Optional (cosmetic — surfaced in failure messages):
 *   OPENWOP_IMPLEMENTATION_NAME    — e.g., "acme-openwop-server"
 *   OPENWOP_IMPLEMENTATION_VERSION — e.g., "1.0"
 *
 * Optional (behavior-gate strictness):
 *   OPENWOP_REQUIRE_BEHAVIOR=true — capability-gated scenarios (audit-log
 *     integrity, rate-limit envelope, multi-region idempotency, etc.) FAIL
 *     instead of skipping when the host doesn't advertise the profile.
 *     Default is false — scenarios skip with a warning so default conformance
 *     runs cover what the host has implemented. See `lib/behavior-gate.ts`
 *     and `conformance/coverage.md` §"Capability-gated scenarios".
 *
 *   OPENWOP_OPTED_OUT_PROFILES — comma-separated profile names the host
 *     operator has DELIBERATELY chosen not to implement. In strict mode
 *     these scenarios skip (logged as "honest opt-out") rather than
 *     failing — distinguishes "host doesn't claim this surface" (good)
 *     from "host claims but doesn't deliver" (bug). Lets honest minimal
 *     hosts go strict-mode green without falsifying capability claims.
 *     Example for SQLite:
 *       OPENWOP_OPTED_OUT_PROFILES=openwop-production,openwop-auth-mtls
 */

export interface ConformanceEnv {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly implementationName: string;
  readonly implementationVersion: string;
  readonly requireBehavior: boolean;
  /**
   * Profiles the host operator has declared the host does NOT claim. Set
   * via `OPENWOP_OPTED_OUT_PROFILES=name1,name2`. In strict mode, the
   * behavior-gate honors this set as PASS-by-opt-out rather than failing
   * the scenario. Never include a profile the host actually advertises —
   * that's a typo, not an opt-out, and `behaviorGate` will surface a
   * warning if it detects the conflict.
   */
  readonly optedOutProfiles: ReadonlySet<string>;
}

let cached: ConformanceEnv | null = null;

export function loadEnv(): ConformanceEnv {
  if (cached) return cached;

  const baseUrl = process.env.OPENWOP_BASE_URL?.trim();
  const apiKey = process.env.OPENWOP_API_KEY?.trim();

  if (!baseUrl) {
    throw new Error(
      'OPENWOP_BASE_URL env var is required. Example: OPENWOP_BASE_URL=https://api.example.com',
    );
  }
  if (!apiKey) {
    throw new Error(
      'OPENWOP_API_KEY env var is required. See auth.md for credential format.',
    );
  }

  // Strip trailing slash so URL composition is consistent.
  const normalizedBase = baseUrl.replace(/\/$/, '');

  const optedOutRaw = process.env.OPENWOP_OPTED_OUT_PROFILES?.trim() ?? '';
  const optedOutProfiles = new Set(
    optedOutRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

  cached = {
    baseUrl: normalizedBase,
    apiKey,
    implementationName: process.env.OPENWOP_IMPLEMENTATION_NAME?.trim() ?? 'unknown',
    implementationVersion: process.env.OPENWOP_IMPLEMENTATION_VERSION?.trim() ?? 'unknown',
    requireBehavior: process.env.OPENWOP_REQUIRE_BEHAVIOR === 'true',
    optedOutProfiles,
  };
  return cached;
}
