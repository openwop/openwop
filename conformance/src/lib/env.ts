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
 *
 *   OPENWOP_OPTED_OUT_FIXTURES — comma-separated fixture ids (or
 *     trailing-`*` globs) the host operator has DELIBERATELY chosen
 *     not to honor. Applied in `lib/fixtures.ts` by filtering matching
 *     entries out of the cached advertised-fixture set, so any
 *     scenario gated via `isFixtureAdvertised(...)` skips cleanly.
 *     Use when a host auto-loads every `conformance-*.json` on disk
 *     (so the fixture id IS in the discovery doc) but the host doesn't
 *     implement the gated feature. Symmetric to `OPENWOP_OPTED_OUT_
 *     PROFILES` for the fixture-id axis. Example for SQLite:
 *       OPENWOP_OPTED_OUT_FIXTURES=conformance-dispatch-*,conformance-subworkflow-input-mapping*
 *
 *   OPENWOP_OPTED_OUT_SCENARIOS — comma-separated scenario ids that
 *     individual tests consult to skip themselves where neither
 *     profile-opt-out nor fixture-opt-out is fine-grained enough
 *     (e.g., OTel trace-inheritance across `core.subWorkflow` —
 *     `conformance-subworkflow-parent` is correctly advertised because
 *     non-OTel subworkflow scenarios pass, but the host doesn't
 *     propagate traceparent across the dispatch boundary). Use
 *     `isScenarioOptedOut(scenarioId)` from `env.ts` in the test's
 *     skip predicate. Reserved for cases where the suite-wide
 *     skip mechanisms can't carry the granularity.
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
  /**
   * Scenario ids the host operator has declared the host does NOT
   * implement at a granularity finer than profile-opt-out or
   * fixture-opt-out can express. Set via
   * `OPENWOP_OPTED_OUT_SCENARIOS=id1,id2`. Individual tests consult
   * this set via `isScenarioOptedOut(...)` inside their `describe.skipIf`
   * predicate. Reserved for cases where the suite-wide mechanisms
   * (profile gate, fixture gate) can't carry the needed granularity.
   */
  readonly optedOutScenarios: ReadonlySet<string>;
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

  const parseCsv = (raw: string | undefined): ReadonlySet<string> =>
    new Set(
      (raw ?? '')
        .trim()
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );

  const optedOutProfiles = parseCsv(process.env.OPENWOP_OPTED_OUT_PROFILES);
  const optedOutScenarios = parseCsv(process.env.OPENWOP_OPTED_OUT_SCENARIOS);

  cached = {
    baseUrl: normalizedBase,
    apiKey,
    implementationName: process.env.OPENWOP_IMPLEMENTATION_NAME?.trim() ?? 'unknown',
    implementationVersion: process.env.OPENWOP_IMPLEMENTATION_VERSION?.trim() ?? 'unknown',
    requireBehavior: process.env.OPENWOP_REQUIRE_BEHAVIOR === 'true',
    optedOutProfiles,
    optedOutScenarios,
  };
  return cached;
}

/**
 * Returns true when the operator has listed `scenarioId` in
 * `OPENWOP_OPTED_OUT_SCENARIOS`. Use inside a test's `describe.skipIf`
 * predicate when neither profile-opt-out nor fixture-opt-out is
 * granular enough. Logs the skip reason via the caller — this helper
 * is silent so callers can format their own message.
 */
export function isScenarioOptedOut(scenarioId: string): boolean {
  return loadEnv().optedOutScenarios.has(scenarioId);
}
