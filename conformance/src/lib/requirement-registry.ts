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
import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

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
/**
 * Major-2 floors come from `spec/v2/profiles.json`, not from the v1 table.
 * `PROFILE_FLOOR_SCENARIOS` names v1 scenario FILES (`runs-lifecycle.test.ts`,
 * `discovery.test.ts`, …) that `scenario-majors.json` assigns to major 1 and a
 * major-2 run therefore never executes — so every one of them came back
 * unclassified and a v2 host was refused certification for not running v1
 * scenarios. Set by the runner before deriving; empty means the registry
 * declares no floor for that profile, which is a real "witnesses nothing yet",
 * not an unclassified return.
 */
let v2Floors: Readonly<Record<string, readonly string[]>> | null = null;

export function setV2ProfileFloors(floors: Readonly<Record<string, readonly string[]>> | null): void {
  v2Floors = floors;
}

export function requirementsFor(profile: string, document?: Readonly<Record<string, unknown>>): readonly string[] | null {
  if (v2Floors !== null) {
    const files = v2Floors[profile];
    if (files === undefined) return null;
    return files.map(requirementIdForScenario);
  }
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

/**
 * The MAJOR-2 floors, derived from `spec/v2/profiles.json` (itself generated
 * from `spec/v2/declaration.json`), keyed by profile id and resolved to
 * scenario file names. A `planned:<stem>` entry names `v2-<stem>.test.ts`; an
 * entry is kept only if `scenario-majors.json` knows the file.
 *
 * This function exists in ONE place on purpose. Until 2026-09-05 the CLI
 * derived these floors privately for `--certify` while the ledger decided
 * "is this file a floor?" from PROFILE_FLOOR_SCENARIOS — the v1 hand table,
 * which knows no v2 file. So a v2 floor file was MINTED as
 * `openwop.scenario.v2-…` and LOOKED UP at certify time as
 * `openwop.floor.v2-…`: 101 executed-pass rows, `witnessCount: 0` on both
 * claimed profiles, and `REJECTING — openwop-discovery-core: unclassified` on
 * a tier-1 host's first production bundle. Two sources of the same fact, one
 * of them stale, and the join between them silent.
 */
export function v2ProfileFloorFiles(conformanceRoot: string): Record<string, readonly string[]> {
  const candidates: string[] = [];
  try {
    const req = createRequire(resolvePath(conformanceRoot, 'package.json'));
    candidates.push(resolvePath(dirname(req.resolve('@openwop/spec-artifacts/package.json')), 'spec', 'v2', 'profiles.json'));
  } catch { /* not installed as a package; the repo-layout candidates below */ }
  candidates.push(
    resolvePath(conformanceRoot, 'spec', 'v2', 'profiles.json'),
    resolvePath(conformanceRoot, '..', 'spec', 'v2', 'profiles.json'),
  );
  const registryPath = candidates.find((c) => existsSync(c));
  if (registryPath === undefined) return {};
  let known: Set<string>;
  try {
    known = new Set(Object.keys((JSON.parse(readFileSync(resolvePath(conformanceRoot, 'scenario-majors.json'), 'utf8')) as { majors: Record<string, number[]> }).majors));
  } catch {
    known = new Set();
  }
  let registry: { profiles?: Array<{ id?: unknown; floorScenarios?: unknown }> };
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch {
    return {};
  }
  const out: Record<string, readonly string[]> = {};
  for (const p of registry.profiles ?? []) {
    if (typeof p.id !== 'string') continue;
    const raw = Array.isArray(p.floorScenarios) ? (p.floorScenarios as unknown[]).map(String) : [];
    const files: string[] = [];
    for (const entry of raw) {
      const name = entry.startsWith('planned:') ? `v2-${entry.slice('planned:'.length)}.test.ts` : entry.endsWith('.test.ts') ? entry : `${entry}.test.ts`;
      if (known.size === 0 || known.has(name)) files.push(name);
    }
    out[p.id] = files;
  }
  return out;
}
