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
/** Read a dot-path (RFC 0073 root families) out of a discovery document. */
function readPath(doc: Readonly<Record<string, unknown>>, path: string): unknown {
  let cur: unknown = doc;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * The scenario FILES a profile's floor requires against a given discovery
 * document — the unconditional `required` list plus every `conditional` branch
 * whose `path` array includes its `includes` value. `null` when the floor is
 * conditional and no document was supplied (unevaluable ≠ empty), or when the
 * profile has no floor at all.
 */
export function floorFilesFor(profile: string, document?: Readonly<Record<string, unknown>>): readonly string[] | null {
  const floor = PROFILE_FLOOR_SCENARIOS[profile];
  if (floor === undefined) return null;
  const files = [...floor.required];
  if (floor.conditional !== undefined && floor.conditional.length > 0) {
    if (document === undefined) return null;
    for (const c of floor.conditional) {
      const arr = readPath(document, c.path);
      if (Array.isArray(arr) && arr.includes(c.includes)) files.push(...c.required);
    }
  }
  return [...new Set(files)];
}

/**
 * Requirement ids for a profile's floor. `document` is needed for a
 * discovery-conditional floor (RFC 0148 §C G7 — `openwop-replay-fork`): without
 * it such a floor is UNEVALUABLE and this returns `null`, never `[]`.
 */
export function requirementsFor(profile: string, document?: Readonly<Record<string, unknown>>): readonly string[] | null {
  const floor = PROFILE_FLOOR_SCENARIOS[profile];
  if (floor === undefined) return null;
  if (floor.discoveryOnly === true) return [];
  const files = floorFilesFor(profile, document);
  if (files === null) return null;
  return [
    ...files.map(requirementIdForScenario),
    ...(floor.requiredAnyPrefix ?? []).map(requirementIdForPrefix),
  ];
}

/** Every registered requirement ID across every profile with a runtime floor. */
export function allRequirements(): readonly string[] {
  const ids = new Set<string>();
  for (const [profile, floor] of Object.entries(PROFILE_FLOOR_SCENARIOS)) {
    if (floor.discoveryOnly === true) continue;
    // every branch of a conditional floor is a registered requirement
    for (const f of floor.required) ids.add(requirementIdForScenario(f));
    for (const c of floor.conditional ?? []) for (const f of c.required) ids.add(requirementIdForScenario(f));
    for (const p of floor.requiredAnyPrefix ?? []) ids.add(requirementIdForPrefix(p));
    void profile;
  }
  return [...ids].sort();
}
