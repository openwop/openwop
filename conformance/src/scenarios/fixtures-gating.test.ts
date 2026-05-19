/**
 * Fixture-gating helper unit tests (RFC 0003).
 *
 * Server-free. Verifies the in-memory cache and predicate behavior of
 * `lib/fixtures.ts`. The full suite-init flow (top-level await in
 * `setup.ts` reading the live host's discovery doc) is integration-
 * level and exercised by every other fixture-dependent scenario.
 *
 * Critical invariants verified here:
 *   1. Predicate returns false until the cache is populated.
 *   2. Setting a non-array `fixtures` field collapses to "advertises
 *      none" (resilience against host bugs).
 *   3. Empty-string entries are filtered out.
 *   4. Vendor-prefixed ids are passed through unchanged.
 *   5. The cache is replaced (not merged) on subsequent calls.
 *
 * @see lib/fixtures.ts
 * @see RFCS/0003-fixture-gating.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isFixtureAdvertised,
  setAdvertisedFixtures,
  getAdvertisedFixtures,
  isFixtureCacheReady,
  __resetForTests,
} from '../lib/fixtures.js';
import { isScenarioOptedOut } from '../lib/env.js';

beforeEach(() => {
  __resetForTests();
});

describe('fixtures: cache lifecycle', () => {
  it('returns false from isFixtureAdvertised before cache is populated', () => {
    expect(isFixtureCacheReady()).toBe(false);
    expect(isFixtureAdvertised('conformance-noop')).toBe(false);
  });

  it('returns null from getAdvertisedFixtures before cache is populated', () => {
    expect(getAdvertisedFixtures()).toBe(null);
  });

  it('isFixtureCacheReady becomes true after setAdvertisedFixtures', () => {
    setAdvertisedFixtures({ fixtures: [] });
    expect(isFixtureCacheReady()).toBe(true);
  });

  it('returns empty set when called with null', () => {
    setAdvertisedFixtures(null);
    expect(getAdvertisedFixtures()?.size).toBe(0);
    expect(isFixtureAdvertised('conformance-noop')).toBe(false);
  });

  it('returns empty set when called with undefined', () => {
    setAdvertisedFixtures(undefined);
    expect(getAdvertisedFixtures()?.size).toBe(0);
  });
});

describe('fixtures: discovery-payload parsing', () => {
  it('populates cache from a well-formed payload', () => {
    setAdvertisedFixtures({ fixtures: ['conformance-noop', 'conformance-delay'] });
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);
    expect(isFixtureAdvertised('conformance-delay')).toBe(true);
    expect(isFixtureAdvertised('conformance-not-advertised')).toBe(false);
  });

  it('treats absent fixtures field as "advertises none"', () => {
    setAdvertisedFixtures({ protocolVersion: '1.0' });
    expect(getAdvertisedFixtures()?.size).toBe(0);
    expect(isFixtureAdvertised('conformance-noop')).toBe(false);
  });

  it('treats non-array fixtures field as "advertises none"', () => {
    setAdvertisedFixtures({ fixtures: 'conformance-noop' as unknown as string[] });
    expect(getAdvertisedFixtures()?.size).toBe(0);
  });

  it('filters out empty-string entries', () => {
    setAdvertisedFixtures({ fixtures: ['', 'conformance-noop', ''] });
    const set = getAdvertisedFixtures();
    expect(set?.size).toBe(1);
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);
  });

  it('filters out non-string entries', () => {
    setAdvertisedFixtures({
      fixtures: ['conformance-noop', 42, null, undefined] as unknown as string[],
    });
    expect(getAdvertisedFixtures()?.size).toBe(1);
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);
  });

  it('passes vendor-prefixed ids through unchanged', () => {
    setAdvertisedFixtures({
      fixtures: ['conformance-noop', 'openwop.smoke.byok', 'acme.fixture.foo'],
    });
    expect(isFixtureAdvertised('openwop.smoke.byok')).toBe(true);
    expect(isFixtureAdvertised('acme.fixture.foo')).toBe(true);
  });

  it('deduplicates entries via Set semantics', () => {
    setAdvertisedFixtures({
      fixtures: ['conformance-noop', 'conformance-noop', 'conformance-noop'],
    });
    expect(getAdvertisedFixtures()?.size).toBe(1);
  });
});

describe('fixtures: cache replacement (not merge)', () => {
  it('a second setAdvertisedFixtures call replaces the cache, not merges', () => {
    setAdvertisedFixtures({ fixtures: ['conformance-noop'] });
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);

    setAdvertisedFixtures({ fixtures: ['conformance-delay'] });
    expect(isFixtureAdvertised('conformance-noop')).toBe(false);
    expect(isFixtureAdvertised('conformance-delay')).toBe(true);
  });

  it('replacing with empty array means no fixtures advertised', () => {
    setAdvertisedFixtures({ fixtures: ['conformance-noop'] });
    setAdvertisedFixtures({ fixtures: [] });
    expect(getAdvertisedFixtures()?.size).toBe(0);
    expect(isFixtureAdvertised('conformance-noop')).toBe(false);
  });
});

describe('fixtures: __resetForTests', () => {
  it('returns the cache to the pre-populated state', () => {
    setAdvertisedFixtures({ fixtures: ['conformance-noop'] });
    expect(isFixtureCacheReady()).toBe(true);
    __resetForTests();
    expect(isFixtureCacheReady()).toBe(false);
    expect(getAdvertisedFixtures()).toBe(null);
  });
});

describe('fixtures: OPENWOP_OPTED_OUT_FIXTURES env filtering', () => {
  // The opt-out predicate is re-read inside setAdvertisedFixtures() on
  // every call, so mutating process.env between cases (and re-calling
  // setAdvertisedFixtures) re-evaluates the parse. afterEach restores
  // the original env so other suites aren't affected.
  const ORIGINAL = process.env.OPENWOP_OPTED_OUT_FIXTURES;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OPENWOP_OPTED_OUT_FIXTURES;
    else process.env.OPENWOP_OPTED_OUT_FIXTURES = ORIGINAL;
  });

  it('exact id is filtered out of the advertised set', () => {
    process.env.OPENWOP_OPTED_OUT_FIXTURES = 'conformance-dispatch-input-mapping';
    setAdvertisedFixtures({
      fixtures: ['conformance-noop', 'conformance-dispatch-input-mapping'],
    });
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);
    expect(isFixtureAdvertised('conformance-dispatch-input-mapping')).toBe(false);
  });

  it('trailing-* glob filters every matching id', () => {
    process.env.OPENWOP_OPTED_OUT_FIXTURES = 'conformance-dispatch-*';
    setAdvertisedFixtures({
      fixtures: [
        'conformance-noop',
        'conformance-dispatch-input-mapping',
        'conformance-dispatch-output-mapping',
        'conformance-dispatch-cross-worker-handoff',
      ],
    });
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);
    expect(isFixtureAdvertised('conformance-dispatch-input-mapping')).toBe(false);
    expect(isFixtureAdvertised('conformance-dispatch-output-mapping')).toBe(false);
    expect(isFixtureAdvertised('conformance-dispatch-cross-worker-handoff')).toBe(false);
  });

  it('exact + glob entries mix in one env value', () => {
    process.env.OPENWOP_OPTED_OUT_FIXTURES =
      'conformance-dispatch-*,conformance-subworkflow-input-mapping';
    setAdvertisedFixtures({
      fixtures: [
        'conformance-noop',
        'conformance-dispatch-input-mapping',
        'conformance-subworkflow-input-mapping',
        'conformance-subworkflow-parent',
      ],
    });
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);
    expect(isFixtureAdvertised('conformance-dispatch-input-mapping')).toBe(false);
    expect(isFixtureAdvertised('conformance-subworkflow-input-mapping')).toBe(false);
    // subworkflow-parent is NOT subworkflow-input-mapping — exact match required.
    expect(isFixtureAdvertised('conformance-subworkflow-parent')).toBe(true);
  });

  it('non-matching opt-out entries leave the advertised set intact', () => {
    process.env.OPENWOP_OPTED_OUT_FIXTURES = 'conformance-nonexistent';
    setAdvertisedFixtures({ fixtures: ['conformance-noop'] });
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);
    expect(getAdvertisedFixtures()?.size).toBe(1);
  });

  it('empty / whitespace-only entries are ignored', () => {
    process.env.OPENWOP_OPTED_OUT_FIXTURES = ', ,conformance-noop, ,';
    setAdvertisedFixtures({ fixtures: ['conformance-noop', 'conformance-delay'] });
    expect(isFixtureAdvertised('conformance-noop')).toBe(false);
    expect(isFixtureAdvertised('conformance-delay')).toBe(true);
  });

  it('unset env behaves identically to no filtering', () => {
    delete process.env.OPENWOP_OPTED_OUT_FIXTURES;
    setAdvertisedFixtures({ fixtures: ['conformance-noop', 'conformance-delay'] });
    expect(getAdvertisedFixtures()?.size).toBe(2);
  });

  it('whitespace-only env behaves identically to unset', () => {
    process.env.OPENWOP_OPTED_OUT_FIXTURES = '   ';
    setAdvertisedFixtures({ fixtures: ['conformance-noop'] });
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);
  });

  it('env is re-read on each setAdvertisedFixtures call (no memoization)', () => {
    process.env.OPENWOP_OPTED_OUT_FIXTURES = 'conformance-noop';
    setAdvertisedFixtures({ fixtures: ['conformance-noop', 'conformance-delay'] });
    expect(isFixtureAdvertised('conformance-noop')).toBe(false);

    // Mutate env and re-set — the new env value MUST take effect.
    process.env.OPENWOP_OPTED_OUT_FIXTURES = 'conformance-delay';
    setAdvertisedFixtures({ fixtures: ['conformance-noop', 'conformance-delay'] });
    expect(isFixtureAdvertised('conformance-noop')).toBe(true);
    expect(isFixtureAdvertised('conformance-delay')).toBe(false);
  });
});

describe('env: OPENWOP_OPTED_OUT_SCENARIOS predicate', () => {
  const ORIGINAL = process.env.OPENWOP_OPTED_OUT_SCENARIOS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OPENWOP_OPTED_OUT_SCENARIOS;
    else process.env.OPENWOP_OPTED_OUT_SCENARIOS = ORIGINAL;
  });

  it('unset env → every scenario id returns false', () => {
    delete process.env.OPENWOP_OPTED_OUT_SCENARIOS;
    expect(isScenarioOptedOut('otel-trace-propagation-subworkflow')).toBe(false);
    expect(isScenarioOptedOut('any-scenario')).toBe(false);
  });

  it('exact scenario id match returns true', () => {
    process.env.OPENWOP_OPTED_OUT_SCENARIOS = 'otel-trace-propagation-subworkflow';
    expect(isScenarioOptedOut('otel-trace-propagation-subworkflow')).toBe(true);
    expect(isScenarioOptedOut('otel-trace-propagation')).toBe(false);
  });

  it('CSV with multiple ids matches each entry exactly', () => {
    process.env.OPENWOP_OPTED_OUT_SCENARIOS = 'scenario-a,scenario-b,scenario-c';
    expect(isScenarioOptedOut('scenario-a')).toBe(true);
    expect(isScenarioOptedOut('scenario-b')).toBe(true);
    expect(isScenarioOptedOut('scenario-c')).toBe(true);
    expect(isScenarioOptedOut('scenario-d')).toBe(false);
  });

  it('whitespace around entries is tolerated', () => {
    process.env.OPENWOP_OPTED_OUT_SCENARIOS = '  scenario-a , scenario-b  ';
    expect(isScenarioOptedOut('scenario-a')).toBe(true);
    expect(isScenarioOptedOut('scenario-b')).toBe(true);
  });

  it('env is re-read on each call (no memoization)', () => {
    process.env.OPENWOP_OPTED_OUT_SCENARIOS = 'scenario-a';
    expect(isScenarioOptedOut('scenario-a')).toBe(true);
    expect(isScenarioOptedOut('scenario-b')).toBe(false);

    process.env.OPENWOP_OPTED_OUT_SCENARIOS = 'scenario-b';
    expect(isScenarioOptedOut('scenario-a')).toBe(false);
    expect(isScenarioOptedOut('scenario-b')).toBe(true);
  });
});
