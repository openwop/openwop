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
 * false if the scenario should `return` early (default-mode skip). In strict
 * mode (`OPENWOP_REQUIRE_BEHAVIOR=true`), throws if not advertised — so the
 * caller never actually receives `false` in that mode.
 */
export function behaviorGate(profileName: string, advertised: boolean): boolean {
  if (advertised) return true;

  const env = loadEnv();
  if (env.requireBehavior) {
    expect(
      advertised,
      `OPENWOP_REQUIRE_BEHAVIOR=true: host MUST advertise the ${profileName} profile for this scenario to run. ` +
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
