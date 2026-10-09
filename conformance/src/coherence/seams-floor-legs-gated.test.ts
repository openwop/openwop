/**
 * The seams profile's floor holds seam-driven legs only (suite 2.45.30).
 *
 * `openwop-conformance-seams-v2` is claimed by any host whose discovery carries
 * a `conformance` block (`spec/v2/profiles.json`: the predicate is necessary,
 * not sufficient). On a host that does not advertise
 * `conformance.seamsProfile`, every floor leg is meant to record
 * `inapplicable`, so the profile is claimed with `witnessCount 0` and never
 * certified. A floor row is recorded per scenario FILE, so one seam-free leg in
 * a floor file passes the floor on its own. Until 2.45.30 two floor files had
 * one (`v2-v1-signed-webhook-accepted`'s facet leg and
 * `v2-effect-identity-business-key`'s ledger read), and openwop-app's
 * production bundle `4683d9f89` certified the profile with no seam mounted.
 *
 * This check reads the floor from `spec/v2/profiles.json` and requires every
 * `it` in every floor file to reach a seams gate before its first `expect`:
 * `seamsProfileAdvertised(` or `era2Gate(` directly, or through a function
 * declared in the same file that does. It is a syntactic lint against the
 * regression, not a proof that the gate is honoured at runtime.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS_DIR, SPEC_V2_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const PROFILE = 'openwop-conformance-seams-v2';
const GATES = ['seamsProfileAdvertised(', 'era2Gate('];
const ID = 'openwop.it.seams-floor-legs-gated.every-leg-of-a-seams-profile-floor-file-reaches-a-seams-gate-before-its-first-a';

/** Top-level function bodies in a scenario file, by name. */
function localFunctions(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^(?:export )?(?:async )?function (\w+)\s*\(|^(?:export )?const (\w+)\s*=\s*(?:async\s*)?\(/gm;
  const starts: Array<{ name: string; at: number }> = [];
  for (let m = re.exec(src); m !== null; m = re.exec(src)) starts.push({ name: (m[1] ?? m[2]) as string, at: m.index });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? (starts[i + 1] as { at: number }).at : src.length;
    out.set(s.name, src.slice(s.at, end));
  });
  return out;
}

/** Names of local functions that reach a gate, directly or through another local function. */
function gatedHelpers(fns: Map<string, string>): Set<string> {
  const gated = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of fns) {
      if (gated.has(name)) continue;
      if (GATES.some((g) => body.includes(g)) || [...gated].some((h) => body.includes(`${h}(`))) {
        gated.add(name);
        grew = true;
      }
    }
  }
  return gated;
}

/** Each `it(` block's text, from its title to the next `it(` or the end of the file. */
function itBlocks(src: string): Array<{ title: string; body: string }> {
  const re = /^\s*it\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm;
  const hits: Array<{ title: string; at: number }> = [];
  for (let m = re.exec(src); m !== null; m = re.exec(src)) hits.push({ title: m[2] as string, at: m.index });
  return hits.map((h, i) => ({ title: h.title, body: src.slice(h.at, i + 1 < hits.length ? (hits[i + 1] as { at: number }).at : src.length) }));
}

export function ungatedLegs(src: string): string[] {
  const helpers = gatedHelpers(localFunctions(src));
  const out: string[] = [];
  for (const { title, body } of itBlocks(src)) {
    const firstExpect = body.indexOf('expect(');
    const head = firstExpect === -1 ? body : body.slice(0, firstExpect);
    const reaches = GATES.some((g) => head.includes(g)) || [...helpers].some((h) => head.includes(`${h}(`));
    if (!reaches) out.push(title);
  }
  return out;
}

describe('the seams profile floor is seam-driven', () => {
  it('every leg of a seams-profile floor file reaches a seams gate before its first assertion', () => {
    if (V1_DIR === null || SPEC_V2_DIR === null || SCENARIOS_DIR === null) return softSkip('inapplicable', 'not a spec checkout: spec/v2 or the scenario sources are not in this layout');
    const registryPath = join(SPEC_V2_DIR, 'profiles.json');
    if (!existsSync(registryPath)) return softSkip('inapplicable', 'spec/v2/profiles.json not in this layout');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as { profiles?: Array<{ id?: string; floorScenarios?: string[] }> };
    const floor = registry.profiles?.find((p) => p.id === PROFILE)?.floorScenarios ?? [];
    expect(floor.length, req(ID, 'spec/v2/profiles.json', `${PROFILE} declares a floor`)).toBeGreaterThan(0);
    for (const name of floor) {
      const file = join(SCENARIOS_DIR, `${name.replace(/^planned:/, '')}.test.ts`);
      if (!existsSync(file)) continue;
      const src = readFileSync(file, 'utf8');
      expect(itBlocks(src).length, req(ID, 'spec/v2/profiles.json', `${name} has at least one leg`)).toBeGreaterThan(0);
      expect(
        ungatedLegs(src),
        req(ID, 'spec/v2/profiles.json', `${name} is a floor of ${PROFILE}; a leg that runs without a seam passes the floor on a host that mounts none — move it to its own scenario file`),
      ).toEqual([]);
    }
  });
});
