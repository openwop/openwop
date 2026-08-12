/**
 * RFC 0148 §B — strict behavior, and the MUST NOT that was enforced by a warning.
 *
 * §B: "When a host advertises a capability, every required behavioral assertion
 * for that capability MUST execute or fail. `OPENWOP_REQUIRE_BEHAVIOR=true` MUST
 * fail on `blocked`, unclassified early return, or a missing seam unless the
 * profile was explicitly opted out before discovery capture. **A host MUST NOT
 * both advertise and opt out of the same profile.**"
 *
 * That last sentence was not enforced. `behaviorGate()` detected the
 * contradiction, emitted `console.warn`, and proceeded as if advertised. A
 * warning in a conformance run is not a check — nothing consumes it, nothing
 * fails on it, and a certification bundle produced from that run records a pass.
 *
 * It matters because the two claims are opposite in kind. Advertising says *this
 * host implements the profile*; opting out says *the operator declares it does
 * not*. A run where both are true has no defensible reading, and the one the
 * gate chose — advertisement wins — is the one that produces MORE certification
 * claim from a MORE contradictory input.
 *
 * The second half wires §B to §A: a gate decision now records a ledger
 * disposition, so "skipped because opted out" and "not exercised at all" stop
 * being the same observable. Before the ledger there was nothing to record into,
 * which is why §B could not be implemented before §A.
 *
 * Server-free. Manipulates process env, so it restores it per-test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { dispositionOf, resetLedger } from '../lib/requirement-ledger.js';
import { __resetEnvCacheForTests } from '../lib/env.js';

const ENV_KEYS = ['OPENWOP_REQUIRE_BEHAVIOR', 'OPENWOP_OPTED_OUT_PROFILES', 'OPENWOP_BASE_URL', 'OPENWOP_API_KEY'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  resetLedger();
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // `loadEnv()` requires a base URL AND an api key even on paths that reach no
  // host, and it caches — so both are stubbed and the cache dropped per test.
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
});

describe('RFC 0148 §B — advertise and opt-out are mutually exclusive', () => {
  it('advertising AND opting out of the same profile fails', () => {
    // The defect: this was a `console.warn` that then proceeded as advertised.
    // A MUST NOT enforced by a warning is not enforced — nothing consumes the
    // warning, and the bundle produced from that run records a pass.
    process.env['OPENWOP_OPTED_OUT_PROFILES'] = 'openwop-audit-log-integrity';
    __resetEnvCacheForTests();
    expect(
      () => behaviorGate('openwop-audit-log-integrity', true),
      'RFC 0148 §B: "A host MUST NOT both advertise and opt out of the same profile." ' +
        'The two claims are opposite in kind — one says the host implements the profile, the ' +
        'other says the operator declares it does not. A run where both hold has no defensible ' +
        'reading, and resolving it in favour of advertisement extracts MORE certification claim ' +
        'from a MORE contradictory input.',
    ).toThrow(/MUST NOT both advertise and opt out/);
  });

  it('advertising alone proceeds', () => {
    expect(behaviorGate('openwop-audit-log-integrity', true)).toBe(true);
  });

  it('opting out alone skips, in strict mode too', () => {
    process.env['OPENWOP_OPTED_OUT_PROFILES'] = 'openwop-audit-log-integrity';
    __resetEnvCacheForTests();
    process.env['OPENWOP_REQUIRE_BEHAVIOR'] = 'true';
    __resetEnvCacheForTests();
    expect(behaviorGate('openwop-audit-log-integrity', false)).toBe(false);
  });

  it('strict mode fails an unadvertised, non-opted-out profile', () => {
    process.env['OPENWOP_REQUIRE_BEHAVIOR'] = 'true';
    __resetEnvCacheForTests();
    expect(() => behaviorGate('openwop-audit-log-integrity', false)).toThrow();
  });
});

describe('RFC 0148 §B — gate decisions record a ledger disposition', () => {
  it('an honest opt-out records `skipped`, not silence', () => {
    // §A resolves an unrecorded requirement to `blocked`. Without this wiring an
    // opted-out profile and a never-run profile are the same observable, which
    // is the distinction §B exists to make.
    process.env['OPENWOP_OPTED_OUT_PROFILES'] = 'openwop-audit-log-integrity';
    __resetEnvCacheForTests();
    behaviorGate('openwop-audit-log-integrity', false);
    expect(dispositionOf('openwop.profile.openwop-audit-log-integrity')).toBe('skipped');
  });

  it('a default-mode soft-skip records `inapplicable`', () => {
    // The host does not advertise it and the operator made no declaration, so
    // the requirement does not apply to this discovery set. That is a different
    // statement from "we could not check", and it is certifiable where
    // `blocked` is not.
    behaviorGate('openwop-audit-log-integrity', false);
    expect(dispositionOf('openwop.profile.openwop-audit-log-integrity')).toBe('inapplicable');
  });

  it('an unexercised profile stays `blocked`', () => {
    // Nothing called the gate at all. §A's default holds: silence is not a pass,
    // and it is not certifiable either.
    expect(dispositionOf('openwop.profile.openwop-never-touched')).toBe('blocked');
  });
});
