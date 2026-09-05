/**
 * RFC 0173 §C.2 — `effect-seam-no-refire` (suite 2.0.0, target major 2; gated
 * on `replay`, driven through the seams profile).
 *
 * A guarded manifest row that states `branchReFires: false` MUST NOT be fired
 * again by a replay fork: the fork's Layer-2 effect ledger cannot grow past the
 * parent's for that seam. The witness is the host's own ledger, reached by
 * firing a named manifest row inside a run through the catalogued seam
 * (`api/seams-v2.yaml` `fireEffectSeam`), forking in `replay` mode, and reading
 * `GET /runs/{runId}/effects` on both.
 *
 * This leg lived in `v2-effect-seam-manifest` until rc.45. It is the one leg of
 * that file that needs the seam, and a file's disposition is worst-first — so
 * on a host without the seams surface the whole manifest file recorded
 * `blocked`, and the manifest witness (unaided, a `GET` and a schema) could not
 * sit on the `openwop-core-standard` floor without dragging a seam gate onto
 * it. Split, the manifest file is a core-standard floor witness for the
 * `replay` family and this file is a seams-v2 floor witness; each records its
 * own truth.
 *
 * @see spec/v2/core/replay.md §The effect-seam manifest
 * @see spec/v2/core/security-defaults.md §Replay suppression
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { seamsProfileAdvertised, SEAMS_PREFIX } from '../lib/seams.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const MANIFEST_PATH = '/host/effect-seams';

interface SeamRow { seam?: unknown; kind?: unknown; guarded?: unknown; guardedBy?: unknown; branchReFires?: unknown }
interface Manifest { manifestVersion?: unknown; seams?: SeamRow[] }

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('RFC 0173 §C.2 — effect-seam-no-refire (gated on replay, seam-driven)', () => {
  it('driving one seam of each kind observes no re-fire on replay', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const replay = await gateFamily('replay');
    if (!replay) return softSkip('inapplicable', 'replay family not advertised (gate recorded under openwop.family.replay)');
    if (!seamsProfileAdvertised(doc)) {
      return softSkip('inapplicable', `the no-re-fire leg is seam-gated (RFC 0173 falsifiability §B replay row is witnessable-gated only through a seam that fires a named manifest row inside a run) — seams profile not advertised (conformance.seamsProfile)`);
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
    const parentEffects = await driver.get(`/runs/${encodeURIComponent(parentId)}/effects`);
    if (parentEffects.status !== 200) return softSkip('blocked', `GET /runs/{runId}/effects answered ${parentEffects.status} on the fired run — the ledger is the witness for suppression (RFC 0173 §C.2)`);
    const countOf = (r: OpenWOPResponse): number => {
      const b = r.json as { effects?: unknown } | null;
      return Array.isArray(b?.effects) ? (b.effects as unknown[]).length : 0;
    };
    const forked = await driver.post(`/runs/${encodeURIComponent(parentId)}:fork`, { mode: 'replay' });
    const forkBody = forked.json as { runId?: unknown } | null;
    if (forked.status !== 201 || typeof forkBody?.runId !== 'string') {
      return softSkip('blocked', `POST /runs/{runId}:fork mode replay answered ${forked.status} on the fired run — suppression is witnessed on the fork`);
    }
    const forkEffects = await driver.get(`/runs/${encodeURIComponent(String(forkBody.runId))}/effects`);
    if (forkEffects.status !== 200) return softSkip('blocked', `GET /runs/{runId}/effects answered ${forkEffects.status} on the replay fork`);
    expect(
      countOf(forkEffects),
      req('openwop.requirement.0173.effect-seam-no-refire', 'spec/v2/core/replay.md §The effect-seam manifest', `seam ${String(target.seam)} states branchReFires: false, so a replay fork MUST NOT issue a further attempt through it — the fork's effect ledger (${countOf(forkEffects)}) cannot exceed the parent's (${countOf(parentEffects)})`),
    ).toBeLessThanOrEqual(countOf(parentEffects));
  });
});
