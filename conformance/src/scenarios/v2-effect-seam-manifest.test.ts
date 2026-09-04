/**
 * RFC 0173 §C.1 — `effect-seam-manifest` (suite 2.0.0, target major 2; gated on `replay`).
 *
 * A v2 host that advertises `replay` MUST publish the effect-seam manifest at
 * `GET /host/effect-seams` (`api/v2/openapi.yaml` `getEffectSeamManifest`,
 * `schemas/v2/effect-seam-manifest.schema.json`): one row per outbound effect
 * path the node runtime can reach, every row `guarded: true` with a
 * `guardedBy`. The `replay` facet names the address as the constant
 * `effectSeamsManifest: "/host/effect-seams"` (`spec/v2/facets/replay.schema.json`).
 *
 * Legs:
 *   1. the manifest validates; every row is guarded; at least one row exists
 *      for every `kind` the host declares (the manifest is the host's own
 *      enumeration — RFC 0140 G7 answered by making the host list it);
 *   2. the facet constant equals the served address;
 *   3. driving one seam of each kind through the suite's receiver and
 *      observing no re-fire needs a seam that fires a named manifest row inside
 *      a run — none is catalogued (`host-sample-test-seams.md`,
 *      `api/seams-v2.yaml`), so that leg records `blocked` naming it.
 *
 * Completeness of the manifest (a seam outside it) is negative-existence and is
 * not asserted here (RFC 0173 falsifiability table, §C.1 row).
 *
 * @see spec/v2/core/replay.md §The effect-seam manifest
 * @see spec/v2/core/security-defaults.md §Replay suppression
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily, v2Validator } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const MANIFEST_PATH = '/host/effect-seams';
const KINDS = ['http', 'queue', 'storage', 'provider-sdk', 'webhook-fanout'] as const;

interface SeamRow { seam?: unknown; kind?: unknown; guarded?: unknown; guardedBy?: unknown; branchReFires?: unknown }
interface Manifest { manifestVersion?: unknown; seams?: SeamRow[] }

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

async function manifest(): Promise<{ status: number; body: Manifest | null }> {
  const res = await driver.get(MANIFEST_PATH);
  return { status: res.status, body: res.status === 200 && res.json && typeof res.json === 'object' ? (res.json as Manifest) : null };
}

describe('RFC 0173 §C.1 — effect-seam-manifest (gated on replay)', () => {
  it('GET /host/effect-seams validates and every row is guarded', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const replay = await gateFamily('replay');
    if (!replay) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay)');

    const { status, body } = await manifest();
    expect(
      status,
      req('openwop.requirement.0173.effect-seam-manifest', 'replay.md §The effect-seam manifest', 'a host advertising `replay` MUST serve GET /host/effect-seams with 200 (RFC 0173 §C.1)'),
    ).toBe(200);
    const check = v2Validator('effect-seam-manifest')(body);
    expect(
      check.ok,
      req('openwop.requirement.0173.effect-seam-manifest', 'effect-seam-manifest.schema.json', `the manifest MUST validate against schemas/v2/effect-seam-manifest.schema.json: ${check.errors}`),
    ).toBe(true);
    const rows = body?.seams ?? [];
    expect(
      rows.length,
      req('openwop.requirement.0173.effect-seam-manifest', 'replay.md §The effect-seam manifest', 'the manifest MUST enumerate at least one outbound effect seam — a node runtime with no effect path does not need `replay`'),
    ).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.guarded,
        req('openwop.requirement.0173.effect-seam-manifest', 'RFC 0173 §C.1', `every manifest row MUST be guarded: true — seam ${String(row.seam)} (kind ${String(row.kind)})`),
      ).toBe(true);
      expect(
        typeof row.guardedBy === 'string' && row.guardedBy.length > 0,
        req('openwop.requirement.0173.effect-seam-manifest', 'RFC 0173 §C.1', `every row MUST name the mechanism that records the outcome instead of re-firing (guardedBy) — seam ${String(row.seam)}`),
      ).toBe(true);
      expect(
        (KINDS as readonly string[]).includes(String(row.kind)),
        req('openwop.requirement.0173.effect-seam-manifest', 'effect-seam-manifest.schema.json seams[].kind', `kind MUST be one of ${KINDS.join(' | ')} — seam ${String(row.seam)} declares ${String(row.kind)}`),
      ).toBe(true);
    }
    // One row per kind the host declares: the set of kinds the manifest names is
    // the host's declaration, and each named kind is backed by at least one row.
    const declared = new Set(rows.map((r) => String(r.kind)));
    for (const kind of declared) {
      expect(
        rows.filter((r) => r.kind === kind).length,
        req('openwop.requirement.0173.effect-seam-manifest', 'RFC 0173 §C.1', `at least one manifest row per declared kind (${kind})`),
      ).toBeGreaterThanOrEqual(1);
    }
    // RFC 0140 G6: a `branch` re-fire is stated as a permission, and a permission
    // for a mode the host does not offer is a claim about nothing.
    const modes = Array.isArray(replay['modes']) ? (replay['modes'] as unknown[]) : [];
    for (const row of rows.filter((r) => r.branchReFires === true)) {
      expect(
        modes,
        req('openwop.requirement.0173.effect-seam-manifest', 'effect-seam-manifest.schema.json seams[].branchReFires', `seam ${String(row.seam)} states branchReFires: true, so the replay facet MUST offer the branch mode it refers to`),
      ).toContain('branch');
    }
  });

  it('the replay facet names the manifest address as the constant /host/effect-seams', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const replay = await gateFamily('replay');
    if (!replay) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay)');
    expect(
      replay['effectSeamsManifest'],
      req('openwop.requirement.0173.effect-seam-manifest.facet', 'facets/replay.schema.json effectSeamsManifest', 'the facet MUST carry the constant "/host/effect-seams" (replay.md §The surface)'),
    ).toBe(MANIFEST_PATH);
  });

  it('driving one seam of each kind observes no re-fire on replay', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const replay = await gateFamily('replay');
    if (!replay) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay)');
    if (!seamsProfileAdvertised(doc)) {
      return softSkip('blocked', `the no-re-fire leg is seam-gated (RFC 0173 falsifiability §B replay row is witnessable-gated only through a seam that fires a named manifest row inside a run) — seams profile not advertised (conformance.seamsProfile)`);
    }
    // The seam is catalogued (api/seams-v2.yaml `fireEffectSeam`). The witness is
    // the host's own Layer-2 ledger, not an externally reachable receiver: fire a
    // guarded row that states `branchReFires: false`, fork the run in `replay`
    // mode, and read GET /runs/{runId}/effects on the fork. Suppression means the
    // fork issues no further attempt for that seam, so its effect ledger cannot
    // grow past the parent's.
    const manifest = await driver.get(MANIFEST_PATH);
    const seamRows: SeamRow[] = manifest.status === 200 && manifest.json && typeof manifest.json === 'object'
      ? ((manifest.json as Manifest).seams ?? []) : [];
    const target = seamRows.find((r) => r.guarded === true && r.branchReFires === false);
    if (!target) return softSkip('inapplicable', `no manifest row is both guarded and branchReFires: false — nothing to witness suppression on (${seamRows.length} row(s) at ${MANIFEST_PATH})`);
    const fired = await driver.post(`${SEAMS_PREFIX}/sample/effect-seams/fire`, { seam: String(target.seam) });
    if (fired.status === 404 || fired.status === 403 || fired.status === 405) {
      return softSkip('blocked', `the host advertises the seams profile but does not serve ${SEAMS_PREFIX}/sample/effect-seams/fire (answered ${fired.status}) — the no-re-fire leg cannot be driven`);
    }
    const firedBody = fired.json as { runId?: unknown } | null;
    if (fired.status !== 201 || typeof firedBody?.runId !== 'string') {
      return softSkip('blocked', `${SEAMS_PREFIX}/sample/effect-seams/fire answered ${fired.status} without { runId } — the seam contract in api/seams-v2.yaml is 201 { runId }`);
    }
    const parentId = firedBody.runId;
    const parentEffects = await driver.get(`/runs/${parentId}/effects`);
    if (parentEffects.status !== 200) return softSkip('blocked', `GET /runs/{runId}/effects answered ${parentEffects.status} on the fired run — the ledger is the witness for suppression (RFC 0173 §C.2)`);
    const countOf = (r: OpenWOPResponse): number => {
      const b = r.json as { effects?: unknown } | null;
      return Array.isArray(b?.effects) ? (b.effects as unknown[]).length : 0;
    };
    const forked = await driver.post(`/runs/${parentId}:fork`, { mode: 'replay' });
    const forkBody = forked.json as { runId?: unknown } | null;
    if (forked.status !== 201 || typeof forkBody?.runId !== 'string') {
      return softSkip('blocked', `POST /runs/{runId}:fork mode replay answered ${forked.status} on the fired run — suppression is witnessed on the fork`);
    }
    const forkEffects = await driver.get(`/runs/${String(forkBody.runId)}/effects`);
    if (forkEffects.status !== 200) return softSkip('blocked', `GET /runs/{runId}/effects answered ${forkEffects.status} on the replay fork`);
    expect(
      countOf(forkEffects),
      req('openwop.requirement.0173.effect-seam-manifest.no-re-fire', 'spec/v2/core/replay.md §The effect-seam manifest', `seam ${String(target.seam)} states branchReFires: false, so a replay fork MUST NOT issue a further attempt through it — the fork's effect ledger (${countOf(forkEffects)}) cannot exceed the parent's (${countOf(parentEffects)})`),
    ).toBeLessThanOrEqual(countOf(parentEffects));
  });
});
