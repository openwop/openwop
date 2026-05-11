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

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isFixtureAdvertised,
  setAdvertisedFixtures,
  getAdvertisedFixtures,
  isFixtureCacheReady,
  __resetForTests,
} from '../lib/fixtures.js';

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
