/**
 * The prompt-library witness at major 2, proven in both directions against a
 * scratch double. Each case turns on ONE defect in an otherwise conforming
 * double and checks that only the legs owning the rule fail.
 *
 * The double is a test double, not a host: nothing it does is evidence about
 * any implementation.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { API_KEY, PromptDouble, type PromptDefect } from './prompt-double.js';
import { v2Validator } from './v2.js';
import {
  deterministicLeg, driveLifecycle, etagLeg, fetchLeg, filterLeg, gateOffReadLeg, gateOffWriteLeg, judgeLifecycle, listLeg, packListLeg, packStampLeg,
  promptAdverts, readOnlyLeg, referencePackLeg, renderShapeLeg, unauthenticatedWriteLeg, unboundRequiredLeg, unknownLeg, variesLeg,
  type LifecycleStep, type PromptOutcome,
} from './prompt-library-witness.js';

const V2 = majorProfile(2);
const host = new PromptDouble();
const tpl = v2Validator('prompt-template');
const env = v2Validator('error-envelope');
const a = () => promptAdverts(V2, host.discovery);

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', API_KEY);
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
});
afterAll(async () => { vi.unstubAllEnvs(); await host.stop(); });
beforeEach(() => host.reset('none'));

const failed = (o: PromptOutcome): string[] => (o.kind === 'observed' ? o.findings.filter((x) => !x.ok).map((x) => x.message) : [`skip:${o.disposition}`]);

/** Every leg that binds when the double advertises every facet. Lifecycle steps are judged one by one. */
const legs: Record<string, () => Promise<string[]>> = {
  list: async () => failed(await listLeg(a(), tpl)),
  filter: async () => failed(await filterLeg(a())),
  fetch: async () => failed(await fetchLeg(V2, a(), tpl)),
  etag: async () => failed(await etagLeg(V2, a())),
  unknown: async () => failed(await unknownLeg(V2, a(), env)),
  readOnly: async () => failed(await readOnlyLeg(V2, a())),
  unauthenticated: async () => failed(await unauthenticatedWriteLeg(a())),
  deterministic: async () => failed(await deterministicLeg(a())),
  varies: async () => failed(await variesLeg(a())),
  renderShape: async () => failed(await renderShapeLeg(a())),
  unbound: async () => failed(await unboundRequiredLeg(a())),
  packList: async () => failed(await packListLeg(a(), { requireInstalled: true })),
  packStamp: async () => failed(await packStampLeg(a(), tpl)),
  referencePack: async () => failed(await referencePackLeg(V2, a())),
  ...Object.fromEntries((['create', 'read', 'duplicate', 'update', 'nonMonotonic', 'remove'] as LifecycleStep[]).map((step) => [step, async () => {
    const o = await driveLifecycle(V2, a());
    return 'kind' in o ? [`skip:${o.disposition}`] : judgeLifecycle(o)[step].filter((x) => !x.ok).map((x) => x.message);
  }])),
};

async function failingLegs(defect: PromptDefect, discovery?: Record<string, unknown>): Promise<string[]> {
  const out: string[] = [];
  for (const [k, run] of Object.entries(legs)) { host.reset(defect, discovery); if ((await run()).length > 0) out.push(k); }
  return out;
}

describe('prompt-library witness at major 2 (host-services.md §prompts)', () => {
  it('a conforming double passes every leg, under hashed and under full observability', async () => {
    expect(await failingLegs('none')).toEqual([]);
    expect(await failingLegs('none', PromptDouble.adverts({ observability: 'full' }))).toEqual([]);
  });

  it.each<[PromptDefect, string[]]>([
    ['list-invalid-item', ['list']],
    ['filter-ignored', ['filter', 'packList']],
    ['unknown-200', ['unknown', 'remove']], // a deleted id is then unknown, and reads 200 too
    ['unknown-nested-envelope', ['unknown']],
    ['create-no-location', ['create']],
    ['source-not-user', ['read']],
    ['dup-accepted', ['duplicate']],
    ['update-not-stored', ['update']],
    ['non-monotonic-accepted', ['nonMonotonic']],
    ['delete-not-gone', ['remove']],
    ['builtin-deletable', ['readOnly']],
    ['writes-unauthenticated', ['unauthenticated']],
    ['render-nondeterministic', ['deterministic']],
    ['render-ignores-vars', ['varies']],
    ['render-bad-hash', ['renderShape']],
    ['render-leaks-body', ['renderShape']],
    ['render-unbound-ok', ['unbound']],
    ['pack-unstamped', ['list', 'packStamp']],
    ['reference-pack-404', ['referencePack']],
  ])('defect %s fails exactly %j', async (defect, want) => {
    expect(await failingLegs(defect)).toEqual(want);
  });

  it('an ETag that does not revalidate to 304 is advisory: inapplicable, never failed and never a pass', async () => {
    host.reset('etag-no-304');
    expect(await etagLeg(V2, a())).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });

  it('no ETag is inapplicable (a SHOULD), never a false pass', async () => {
    host.reset('no-etag');
    expect(await etagLeg(V2, a())).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });

  it('gate off: an unadvertised endpointsSupported or mutableLibrary answers 404 not_found, and serving it fails', async () => {
    const readOff = PromptDouble.adverts({ endpointsSupported: false });
    host.reset('none', readOff);
    expect(failed(await gateOffReadLeg(a()))).toEqual([]);
    host.reset('gate-off-serves', readOff);
    expect(failed(await gateOffReadLeg(a()))).toHaveLength(2);
    const writeOff = PromptDouble.adverts({ mutableLibrary: false });
    host.reset('none', writeOff);
    expect(failed(await gateOffWriteLeg(V2, a()))).toEqual([]);
    host.reset('mutable-gate-off-serves', writeOff);
    expect(failed(await gateOffWriteLeg(V2, a()))).toHaveLength(2);
    host.reset('none');
    expect(await gateOffReadLeg(a())).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await gateOffWriteLeg(V2, a())).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });

  it('packs: listing pack templates without packsSupported fails; without it the stamp and reference legs are inapplicable', async () => {
    host.reset('none', PromptDouble.adverts({ packsSupported: false }));
    expect(failed(await packListLeg(a()))).toHaveLength(1);
    expect(await packStampLeg(a(), tpl)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(await referencePackLeg(V2, a())).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
  });

  it('every leg is inapplicable without the prompts record, and the gate-off read binds', async () => {
    host.reset('none', {});
    const none = a();
    for (const o of [await listLeg(none, tpl), await fetchLeg(V2, none, tpl), await deterministicLeg(none), await packStampLeg(none, tpl), await readOnlyLeg(V2, none)]) {
      expect(o).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    }
    expect(await driveLifecycle(V2, none)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    expect(failed(await gateOffReadLeg(none))).toEqual([]);
  });
});
