/**
 * Behavior-gate helper for capability-gated conformance scenarios.
 *
 * Some scenarios in `conformance/src/scenarios/` validate optional profiles
 * — audit-log integrity, rate-limit envelope, multi-region idempotency,
 * `configurableSchema`, webhook signature versioning, pause/resume, etc.
 * When a host doesn't advertise the profile, those scenarios have two
 * defensible modes:
 *
 *   - **Default (skip):** log a warning and return early. The suite still
 *     passes overall, reflecting what the host has implemented. This is
 *     what `@openwop/openwop-conformance` runs by default so a v1.0-only
 *     host doesn't suddenly fail the suite when new optional profiles ship.
 *
 *   - **Behavior-required (fail):** set `OPENWOP_REQUIRE_BEHAVIOR=true` to
 *     turn missing advertisements into hard failures. A "passing" run with
 *     this flag means the host advertises every optional profile AND every
 *     scenario exercises real behavior — useful for hosts that want to
 *     claim full coverage in `INTEROP-MATRIX.md`.
 *
 *   - **Strict-mode opt-out (skip in strict mode too):** set
 *     `OPENWOP_OPTED_OUT_PROFILES=name1,name2,...` to declare that the
 *     host operator has deliberately chosen NOT to implement those
 *     profiles. In strict mode the gate skips them with a "honest
 *     opt-out" log line instead of failing — minimal hosts that
 *     advertise only what they implement can still go strict-mode
 *     green without falsifying capability claims. Conflict check:
 *     if a profile appears in BOTH `OPENWOP_OPTED_OUT_PROFILES` AND
 *     the host's discovery `capabilities.auth.profiles[]` (or
 *     equivalent), the gate logs a loud warning — opt-outs and
 *     advertisements are mutually exclusive.
 *
 * Usage:
 *
 *   ```ts
 *   import { behaviorGate } from '../lib/behavior-gate.js';
 *
 *   it('host that claims the profile advertises the right fields', async () => {
 *     const advertised = await isProfileAdvertised();
 *     if (!behaviorGate('openwop-audit-log-integrity', advertised)) {
 *       return; // skipped in default mode; FAIL'd in strict mode
 *     }
 *
 *     // ... assertions ...
 *   });
 *   ```
 *
 * In strict mode, `behaviorGate` throws an assertion error with a citation
 * to the relevant spec section so the failure message is self-explanatory.
 */

import { expect } from 'vitest';
import { loadEnv } from './env.js';

/**
 * Returns true if the scenario should proceed with assertions (advertised),
 * false if the scenario should `return` early (default-mode skip OR
 * strict-mode honest opt-out). In strict mode (`OPENWOP_REQUIRE_BEHAVIOR=true`)
 * with `profileName` NOT in `OPENWOP_OPTED_OUT_PROFILES`, throws — so the
 * caller never receives `false` in that combination.
 *
 * If the host BOTH advertises the profile AND the operator listed it in
 * the opt-out env var, surface a warning (likely typo) and treat as
 * advertised (proceed). Advertisement always wins over opt-out: opting
 * out of a profile you actually implement is meaningless.
 */
export function behaviorGate(profileName: string, advertised: boolean): boolean {
  const env = loadEnv();
  const optedOut = env.optedOutProfiles.has(profileName);

  if (advertised && optedOut) {
    // eslint-disable-next-line no-console
    console.warn(
      `[${profileName}] both ADVERTISED by the host AND listed in OPENWOP_OPTED_OUT_PROFILES — ` +
        `opt-out is ignored. Remove from the env var to clear this warning.`,
    );
  }

  if (advertised) return true;

  if (optedOut) {
    // Honest opt-out: the operator declared the host does not implement
    // this profile. Skip in BOTH default and strict mode.
    // eslint-disable-next-line no-console
    console.warn(
      `[${profileName}] honest opt-out (OPENWOP_OPTED_OUT_PROFILES); skipping`,
    );
    return false;
  }

  if (env.requireBehavior) {
    expect(
      advertised,
      `OPENWOP_REQUIRE_BEHAVIOR=true: host MUST advertise the ${profileName} profile for this scenario to run, ` +
        `or declare opt-out via OPENWOP_OPTED_OUT_PROFILES=${profileName}. ` +
        `See conformance/coverage.md §"Capability-gated scenarios".`,
    ).toBe(true);
    // expect.toBe(true) throws; we won't reach here.
  }

  // Default-mode soft-skip.
  // eslint-disable-next-line no-console
  console.warn(
    `[${profileName}] profile not advertised; skipping (set OPENWOP_REQUIRE_BEHAVIOR=true to fail)`,
  );
  return false;
}

/**
 * RFC 0042 §D — experimental-tier soft-skip router for capability-gated
 * scenarios. Wraps `behaviorGate` with an additional tier check.
 *
 * Returns true if the scenario should proceed with assertions, false if
 * it should skip:
 *   - tier === 'experimental' AND OPENWOP_REQUIRE_EXPERIMENTAL not set → soft-skip
 *     (the scenario does NOT count toward "Failed" or "Skipped (capability-gated)"
 *      in the four-bucket taxonomy — a new fifth bucket "Skipped (experimental)"
 *      SHOULD be tallied by reporters; logged via the dedicated console.warn below.)
 *   - tier === 'experimental' AND OPENWOP_REQUIRE_EXPERIMENTAL=true → behave as
 *     stable (hand off to behaviorGate; honor OPENWOP_REQUIRE_BEHAVIOR + opt-out).
 *   - tier === 'stable' (default) → identical to behaviorGate.
 *
 * The `experimentalUntil` ISO-8601 date is logged for telemetry but does NOT
 * gate behavior — the spec contract is that the wire shape MAY shift before
 * the date, not that the scenario MUST stop running.
 */
export function experimentalGate(
  profileName: string,
  advertised: boolean,
  tier: 'stable' | 'experimental' | undefined,
  experimentalUntil?: string,
): boolean {
  if (tier === 'experimental') {
    const env = loadEnv();
    const requireExperimental = process.env.OPENWOP_REQUIRE_EXPERIMENTAL === 'true';
    if (!requireExperimental) {
      // eslint-disable-next-line no-console
      console.warn(
        `[experimental capability: ${profileName}] host advertises tier='experimental'` +
          (experimentalUntil ? ` until ${experimentalUntil}` : '') +
          `; scenario skipped under default mode (set OPENWOP_REQUIRE_EXPERIMENTAL=true to run)`,
      );
      return false;
    }
    // Strict-mode experimental: hand off to behaviorGate with the standard
    // advertised+opt-out rules. A host that advertises tier='experimental'
    // AND opts the profile out via OPENWOP_OPTED_OUT_PROFILES would surface
    // the standard advertise+opt-out conflict warning from behaviorGate.
    // Don't strip the env.requireBehavior flag — that's a separate axis.
    // eslint-disable-next-line no-console
    console.warn(
      `[experimental capability: ${profileName}] OPENWOP_REQUIRE_EXPERIMENTAL=true; ` +
        `running as strict assertion against advertised='${advertised}'`,
    );
    void env;
  }
  return behaviorGate(profileName, advertised);
}
