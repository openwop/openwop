/**
 * Fixture-gating helper (RFC 0003).
 *
 * Reads the host's `/.well-known/openwop` `fixtures` array at suite init,
 * caches the advertised fixture-id set, and exposes a sync predicate
 * (`isFixtureAdvertised`) so each scenario can gate with
 * `it.skipIf(!isFixtureAdvertised('conformance-noop'))`.
 *
 * Why a separate module from `profiles.ts`:
 *   - Profiles answer "does the host claim this surface?" (binary).
 *   - Fixtures answer "did the host claim THIS specific fixture id?"
 *     (per-id). Different shape; profile-style derivation can't carry it.
 *
 * Cache lifecycle:
 *   - `setAdvertisedFixtures(...)` populates the cache from a discovery
 *     payload. Idempotent — calling repeatedly with the same payload is
 *     a no-op. Calling with a different payload replaces the cache.
 *   - `isFixtureAdvertised(...)` returns false until the cache is set
 *     (defensive default — when the cache hasn't loaded yet, scenarios
 *     skip rather than fail). The setupFile populates it before any
 *     `describe()` runs.
 *   - `getAdvertisedFixtures()` returns the cached set or null. Used by
 *     `discovery.test.ts` to assert the field shape end-to-end.
 *   - `__resetForTests()` clears the cache for unit tests of this module.
 *
 * This module is sync. The async fetch lives in `setup.ts` which calls
 * `setAdvertisedFixtures(...)` from a top-level `await`.
 *
 * Honest opt-out (symmetric to `OPENWOP_OPTED_OUT_PROFILES`):
 *   `OPENWOP_OPTED_OUT_FIXTURES` (CSV, supports trailing `*` glob)
 *   subtracts matching fixture-ids from the cached set even when the
 *   host advertises them. Operators use this when the host happens to
 *   carry a fixture file (e.g., it auto-loads every `conformance-*.json`
 *   on disk) but does NOT implement the underlying feature — so the
 *   gated scenario should skip instead of running and failing. The
 *   subtraction happens at cache-population time, so the predicate
 *   remains a single sync set lookup at scenario-evaluation time.
 *
 * @see spec/v1/capabilities.md §`fixtures`
 * @see spec/v1/profiles.md §`openwop-fixtures`
 * @see RFCS/0003-fixture-gating.md
 */

import type { DiscoveryPayload } from './profiles.js';

let _advertisedFixtures: ReadonlySet<string> | null = null;

/**
 * Parse `OPENWOP_OPTED_OUT_FIXTURES` into a match predicate. Each entry
 * is either an exact id or a glob with a trailing `*`. Returns a
 * function that answers "is this fixture-id opted out?" — empty / unset
 * env reduces to "always false."
 */
function loadOptedOutPredicate(): (id: string) => boolean {
  const raw = process.env.OPENWOP_OPTED_OUT_FIXTURES?.trim() ?? '';
  if (raw.length === 0) return () => false;
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const entry of raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) {
    if (entry.endsWith('*')) {
      prefixes.push(entry.slice(0, -1));
    } else {
      exact.add(entry);
    }
  }
  return (id) => exact.has(id) || prefixes.some((p) => id.startsWith(p));
}

/**
 * Populate the cache from a discovery-doc payload. The function is
 * tolerant of malformed inputs — anything other than a string array
 * collapses to "no fixtures advertised" rather than throwing, so the
 * suite remains resilient against host bugs in the discovery surface.
 *
 * Applies `OPENWOP_OPTED_OUT_FIXTURES` at this step: opted-out ids are
 * filtered out of the cache before storage so downstream lookups can
 * stay a single sync set-membership test.
 */
export function setAdvertisedFixtures(c: DiscoveryPayload | null | undefined): void {
  if (c == null || !Array.isArray(c.fixtures)) {
    _advertisedFixtures = new Set();
    return;
  }
  const isOptedOut = loadOptedOutPredicate();
  const ids = c.fixtures.filter(
    (entry): entry is string =>
      typeof entry === 'string' && entry.length > 0 && !isOptedOut(entry),
  );
  _advertisedFixtures = new Set(ids);
}

/**
 * Sync predicate — returns true if the host advertised the given
 * fixture id. Returns false until `setAdvertisedFixtures(...)` has been
 * called (i.e., before the suite-init setup file populates the cache).
 *
 * Use as the predicate inside `it.skipIf(...)` / `describe.skipIf(...)`.
 * Example:
 *
 *   describe.skipIf(!isFixtureAdvertised('conformance-noop'))(
 *     'runs-lifecycle: ...',
 *     () => { it('...', async () => { ... }); },
 *   );
 */
export function isFixtureAdvertised(id: string): boolean {
  return _advertisedFixtures?.has(id) ?? false;
}

/**
 * Returns the cached set or `null` if `setAdvertisedFixtures(...)` has
 * not been called. Used by `discovery.test.ts` and consumers that need
 * the full advertised set.
 */
export function getAdvertisedFixtures(): ReadonlySet<string> | null {
  return _advertisedFixtures;
}

/**
 * `true` once the suite-init setup has populated the cache (even with
 * an empty set). Useful for distinguishing "host advertises no
 * fixtures" from "we haven't called setAdvertisedFixtures yet."
 */
export function isFixtureCacheReady(): boolean {
  return _advertisedFixtures !== null;
}

/** Test-only: reset the module-level cache. */
export function __resetForTests(): void {
  _advertisedFixtures = null;
}
