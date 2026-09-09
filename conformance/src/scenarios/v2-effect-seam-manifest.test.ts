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
 *   2. the facet constant equals the served address.
 *
 * Both legs are unaided (a `GET` and a schema), which is what lets this file sit
 * on the `openwop-core-standard` floor as the `replay` family's witness. The
 * seam-driven no-re-fire leg lived here until rc.45 and moved to
 * `v2-effect-seam-no-refire` (seams-v2 floor): a file's disposition is
 * worst-first, so one seam-gated leg made the whole manifest witness read
 * `blocked` on any host without the seams surface.
 *
 * Completeness of the manifest (a seam outside it) is negative-existence and is
 * not asserted here (RFC 0173 falsifiability table, §C.1 row).
 *
 * @see spec/v2/core/replay.md §The effect-seam manifest
 * @see spec/v2/core/security-defaults.md §Replay suppression
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { v2Discovery, gateFamily, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const MANIFEST_PATH = '/host/effect-seams';
const KINDS = ['http', 'smtp', 'queue', 'storage', 'provider-sdk', 'webhook-fanout', 'other'] as const;

interface SeamRow { seam?: unknown; kind?: unknown; guarded?: unknown; guardedBy?: unknown; branchReFires?: unknown; note?: unknown }
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
      // `other` is the escape for a mechanism the enum does not name, and the
      // note is what keeps it from being a place to hide a seam: a row that
      // cannot say WHICH mechanism it is has not been enumerated, it has been
      // labelled. Suite 2.0.0-rc.61, replay.md §The effect-seam manifest.
      if (String(row.kind) === 'other') {
        expect(
          typeof row.note === 'string' && row.note.trim().length > 0,
          req('openwop.requirement.0173.effect-seam-manifest', 'replay.md §The effect-seam manifest', `a kind: other row MUST carry a note naming the mechanism (raw TCP, gRPC, a filesystem write, a device SDK) — seam ${String(row.seam)} declares other with no note`),
        ).toBe(true);
      }
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

});
