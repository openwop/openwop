/**
 * The prompt events witness at major 2, proven in both directions against a
 * scratch double that plays the two prompt fixtures' event logs. Each case
 * turns on ONE defect and checks that only the judges owning the rule fail.
 *
 * The double is a test double, not a host: nothing it does is evidence about
 * any implementation.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { majorProfile } from './major-profile.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { API_KEY, PromptDouble, type PromptDefect } from './prompt-double.js';
import { v2RefValidator } from './v2.js';
import { ALL_FOUR_FIXTURE, END_TO_END_FIXTURE, driveFixture, judgeAllFourKinds, judgeChain, judgeEndToEnd, judgeOrdering, type EventFinding } from './prompt-events-witness.js';

const V2 = majorProfile(2);
const host = new PromptDouble();
const v = {
  resolved: v2RefValidator('run-event-payloads.schema.json#/$defs/agentPromptResolved'),
  composed: v2RefValidator('run-event-payloads.schema.json#/$defs/promptComposed'),
};

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', API_KEY);
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  setAdvertisedFixtures({ fixtures: [ALL_FOUR_FIXTURE, END_TO_END_FIXTURE] });
});
afterAll(async () => { vi.unstubAllEnvs(); await host.stop(); });
beforeEach(() => host.reset('none'));

const bad = (xs: readonly EventFinding[]): string[] => xs.filter((x) => !x.ok).map((x) => x.message);
async function judged(fixture: string, judge: (o: Exclude<Awaited<ReturnType<typeof driveFixture>>, { kind: 'skip' }>) => EventFinding[]): Promise<string[]> {
  const o = await driveFixture(V2, host.discovery, fixture, { timeoutMs: 2000, pollMs: 5 });
  return 'kind' in o ? [`skip:${o.disposition}`] : bad(judge(o));
}
const legs: Record<string, () => Promise<string[]>> = {
  allFour: () => judged(ALL_FOUR_FIXTURE, (o) => judgeAllFourKinds(o, v)),
  orderingAll: () => judged(ALL_FOUR_FIXTURE, judgeOrdering),
  endToEnd: () => judged(END_TO_END_FIXTURE, (o) => judgeEndToEnd(o, v)),
  orderingE2E: () => judged(END_TO_END_FIXTURE, judgeOrdering),
  chain: () => judged(END_TO_END_FIXTURE, judgeChain),
};

async function failingLegs(defect: PromptDefect, discovery?: Record<string, unknown>): Promise<string[]> {
  const out: string[] = [];
  for (const [k, run] of Object.entries(legs)) { host.reset(defect, discovery); if ((await run()).length > 0) out.push(k); }
  return out;
}

describe('prompt events witness at major 2 (host-services.md §prompts → §Resolution, §Composition)', () => {
  it('a conforming double passes every judge under hashed, full and off observability', async () => {
    expect(await failingLegs('none')).toEqual([]);
    expect(await failingLegs('none', PromptDouble.adverts({ observability: 'full' }))).toEqual([]);
    expect(await failingLegs('none', PromptDouble.adverts({ observability: 'off' }))).toEqual([]);
  });

  it.each<[PromptDefect, string[]]>([
    ['composed-before-resolved', ['orderingAll', 'orderingE2E']],
    ['missing-few-shot-2', ['allFour']],
    ['chain-two-applied', ['chain']],
    ['chain-source-mismatch', ['chain']],
    ['v1-event-name', ['allFour', 'orderingAll', 'endToEnd', 'orderingE2E', 'chain']],
    ['body-under-hashed', ['endToEnd']],
    ['bad-hash', ['allFour', 'endToEnd']],
    ['wrong-layer', ['endToEnd']],
  ])('defect %s fails exactly %j', async (defect, want) => {
    expect(await failingLegs(defect)).toEqual(want);
  });

  it('a composition emitted under observability off fails the fixture judges', async () => {
    expect(await failingLegs('body-under-hashed', PromptDouble.adverts({ observability: 'off' }))).toEqual(['allFour', 'endToEnd']);
  });

  it('without the prompts record or the fixture, the run is never created: inapplicable', async () => {
    expect(await driveFixture(V2, {}, END_TO_END_FIXTURE)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: [] });
    expect(await driveFixture(V2, host.discovery, ALL_FOUR_FIXTURE)).toMatchObject({ kind: 'skip', disposition: 'inapplicable' });
    setAdvertisedFixtures({ fixtures: [ALL_FOUR_FIXTURE, END_TO_END_FIXTURE] });
  });
});
