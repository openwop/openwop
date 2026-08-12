/**
 * RFC 0148 §A — stable requirement IDs for the certification floor.
 *
 * §A requires "every normative conformance assertion included in a certifiable
 * profile" to carry a stable `requirementId`. This registry is the first tranche:
 * the floor scenarios that `PROFILE_FLOOR_SCENARIOS` already makes certification
 * depend on. It is deliberately NOT a sweep over all 421 scenario files.
 *
 * The reason is the measurement in `docs/RFC-LIFECYCLE-COHERENCE.md`, applied to
 * a different surface: a gate that fires hundreds of times on its first run gets
 * disabled rather than fixed. Tagging every assertion in one pass would produce a
 * registry nobody could review, and an unreviewed requirement ID is worth less
 * than no requirement ID — it looks like coverage.
 *
 * So the scope is exactly what certification consumes today. `requirementsFor()`
 * returns the IDs a profile's claim rests on, and anything outside this registry
 * is honestly outside §A's coverage rather than silently assumed covered.
 *
 * Adding a requirement is deliberately cheap; adding it *without* a scenario
 * recording a disposition for it is deliberately loud, because the ledger
 * resolves an unrecorded requirement to `blocked`.
 */

import { PROFILE_FLOOR_SCENARIOS } from './profiles.js';

/** `runs-lifecycle.test.ts` → `openwop.floor.runs-lifecycle`. */
export function requirementIdForScenario(scenarioFile: string): string {
  return `openwop.floor.${scenarioFile.replace(/\.test\.ts$/, '')}`;
}

/** Prefix groups become one requirement: `interrupt-` → `openwop.floor.any.interrupt-`. */
export function requirementIdForPrefix(prefix: string): string {
  return `openwop.floor.any.${prefix}`;
}

/**
 * The requirement IDs a profile's certification rests on.
 *
 * Returns `null` — not an empty array — when the corpus has no floor for the
 * profile. An empty array would flow into `verifyProfileRequirements()` and read
 * as "nothing blocking", which is the `[].every(...)` shape this program exists
 * to close. `null` forces the caller to decide between `discoveryOnly` (an empty
 * floor by design) and unspecified (no floor written yet).
 */
export function requirementsFor(profile: string): readonly string[] | null {
  const floor = PROFILE_FLOOR_SCENARIOS[profile];
  if (floor === undefined) return null;
  if (floor.discoveryOnly === true) return [];
  return [
    ...floor.required.map(requirementIdForScenario),
    ...(floor.requiredAnyPrefix ?? []).map(requirementIdForPrefix),
  ];
}

/** Every registered requirement ID across every profile with a runtime floor. */
export function allRequirements(): readonly string[] {
  const ids = new Set<string>();
  for (const profile of Object.keys(PROFILE_FLOOR_SCENARIOS)) {
    for (const id of requirementsFor(profile) ?? []) ids.add(id);
  }
  return [...ids].sort();
}
