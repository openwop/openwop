/**
 * RFC 0148 §B / RFC 0147 program scenario — `conformance-advertised-seam-required`:
 * under `OPENWOP_REQUIRE_BEHAVIOR=true` an advertised capability whose
 * observation seam is missing FAILS; it never soft-skips into a pass.
 *
 * Three mechanisms carry the rule and each is pinned here with the env
 * toggled in-process:
 *   - `behaviorGate(profile, advertised=false)` — a profile the host does not
 *     advertise and did not opt out of: default mode records `inapplicable`
 *     and returns false; strict mode THROWS (advertise or opt out explicitly);
 *   - `behaviorGatePresent(profile, null)` — a seam helper returned nothing:
 *     the same rule, because an advertised capability with no seam is a claim
 *     the suite cannot check;
 *   - `seamAbsent(reason)` — an advertised capability whose seam answered
 *     404/403 mid-scenario: default mode notes `blocked` with the reason;
 *     strict mode THROWS (RFC 0148 §B; RFC 0139 G14 flip). A 403 is not a
 *     pass.
 * `OPENWOP_OPTED_OUT_PROFILES` is the only sanctioned way to keep strict mode
 * green for a profile a host genuinely does not implement — and it records
 * `skipped` with the reason, never a pass.
 *
 * Server-free, always-on; MUST NOT capability-skip (RFC 0148 §Conformance).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { behaviorGate, behaviorGatePresent } from '../lib/behavior-gate.js';
import { seamAbsent, softSkipDisposition, resetSoftSkips } from '../lib/soft-skip.js';
import { dispositionOf, resetLedger, suspendSinkForFixtures } from '../lib/requirement-ledger.js';
import { __resetEnvCacheForTests } from '../lib/env.js';
import { req } from '../lib/requirement-ids.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'server-free: toggles OPENWOP_REQUIRE_BEHAVIOR in-process and pins the advertised-missing-seam rule';

const PROFILE = 'openwop-conformance-advertised-seam-probe';
const ENV_KEYS = ['OPENWOP_REQUIRE_BEHAVIOR', 'OPENWOP_OPTED_OUT_PROFILES', 'OPENWOP_BASE_URL', 'OPENWOP_API_KEY'] as const;
let saved: Record<string, string | undefined> = {};
let restoreSink: (() => void) | undefined;

beforeAll(() => {
  // this file records fixture profile ids into the ledger — keep them out of a live sink
  restoreSink = suspendSinkForFixtures();
});
afterAll(() => restoreSink?.());

beforeEach(() => {
  resetLedger();
  resetSoftSkips();
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // `loadEnv()` requires a base URL and an api key even on paths that reach no
  // host, and it caches — stub both and drop the cache per test.
  process.env['OPENWOP_BASE_URL'] = 'https://conformance.invalid';
  process.env['OPENWOP_API_KEY'] = 'dummy-not-used-no-request-is-made';
  __resetEnvCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetEnvCacheForTests();
  resetLedger();
  resetSoftSkips();
});

describe('RFC 0148 §B — conformance-advertised-seam-required', () => {
  it('default mode: an unadvertised profile records inapplicable and gates false — never a pass', () => {
    delete process.env['OPENWOP_REQUIRE_BEHAVIOR'];
    __resetEnvCacheForTests();
    delete process.env['OPENWOP_OPTED_OUT_PROFILES'];
    expect(behaviorGate(PROFILE, false), req('openwop.it.conformance-advertised-seam-required.default-mode-an-unadvertised-profile-records-inapplicable-and-gates-false-never', 'RFC 0148 §B', 'default mode: an unadvertised profile records inapplicable and gates false — never a pass')).toBe(false);
    expect(dispositionOf(`openwop.profile.${PROFILE}`)).toBe('inapplicable');
  });

  it('strict mode: an unadvertised, un-opted-out profile FAILS (advertise or opt out explicitly)', () => {
    process.env['OPENWOP_REQUIRE_BEHAVIOR'] = 'true';
    __resetEnvCacheForTests();
    delete process.env['OPENWOP_OPTED_OUT_PROFILES'];
    expect(() => behaviorGate(PROFILE, false), req('openwop.it.conformance-advertised-seam-required.strict-mode-an-unadvertised-un-opted-out-profile-fails-advertise-or-opt-out-expl', 'RFC 0148 §B', 'strict mode: an unadvertised, un-opted-out profile FAILS (advertise or opt out explicitly)')).toThrow(/OPENWOP_REQUIRE_BEHAVIOR=true/);
  });

  it('strict mode: an advertised capability whose seam helper returned nothing FAILS (behaviorGatePresent)', () => {
    process.env['OPENWOP_REQUIRE_BEHAVIOR'] = 'true';
    __resetEnvCacheForTests();
    delete process.env['OPENWOP_OPTED_OUT_PROFILES'];
    expect(() => behaviorGatePresent(PROFILE, null), req('openwop.it.conformance-advertised-seam-required.strict-mode-an-advertised-capability-whose-seam-helper-returned-nothing-fails-be', 'RFC 0148 §B', 'strict mode: an advertised capability whose seam helper returned nothing FAILS (behaviorGatePresent)')).toThrow();
    // and with a value present it narrows and passes through
    delete process.env['OPENWOP_REQUIRE_BEHAVIOR'];
    __resetEnvCacheForTests();
    expect(behaviorGatePresent(PROFILE, { ok: true })).toBe(true);
  });

  it('strict mode: seamAbsent (advertised, seam answered 404/403 mid-scenario) FAILS; default mode notes blocked with the reason', () => {
    process.env['OPENWOP_REQUIRE_BEHAVIOR'] = 'true';
    __resetEnvCacheForTests();
    expect(() => seamAbsent('host advertises X but /v1/host/sample/x answered 404'), req('openwop.it.conformance-advertised-seam-required.strict-mode-seamabsent-advertised-seam-answered-404-403-mid-scenario-fails-defau', 'RFC 0148 §B', 'strict mode: seamAbsent (advertised, seam answered 404/403 mid-scenario) FAILS; default mode notes blocked with the reason')).toThrow(/RFC 0148 §B/);
    delete process.env['OPENWOP_REQUIRE_BEHAVIOR'];
    __resetEnvCacheForTests();
    resetSoftSkips();
    expect(seamAbsent('host advertises X but /v1/host/sample/x answered 403')).toBeUndefined();
    const noted = softSkipDisposition('conformance-advertised-seam-required.test.ts');
    expect(noted?.kind).toBe('blocked');
    expect(noted?.reason).toContain('answered 403');
  });

  it('the sanctioned escape is an explicit opt-out, which records skipped with the reason — still never a pass', () => {
    process.env['OPENWOP_REQUIRE_BEHAVIOR'] = 'true';
    __resetEnvCacheForTests();
    process.env['OPENWOP_OPTED_OUT_PROFILES'] = PROFILE;
    __resetEnvCacheForTests();
    expect(behaviorGate(PROFILE, false), req('openwop.it.conformance-advertised-seam-required.the-sanctioned-escape-is-an-explicit-opt-out-which-records-skipped-with-the-reas', 'RFC 0148 §B', 'the sanctioned escape is an explicit opt-out, which records skipped with the reason — still never a pass')).toBe(false);
    expect(dispositionOf(`openwop.profile.${PROFILE}`)).toBe('skipped');
  });
});

