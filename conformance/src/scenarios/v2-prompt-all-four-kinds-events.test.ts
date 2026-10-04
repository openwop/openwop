/**
 * v2 — every PromptKind resolves and composes on real dispatch
 * (`spec/v2/core/host-services.md` §`prompts` → §Resolution, §Composition;
 * RFC 0027 §A). The v1 twin is `prompt-all-four-kinds-events`; the judges live
 * in `lib/prompt-events-witness.ts`.
 *
 * A run of `conformance-prompt-all-four-kinds` (one node: system, user,
 * schema-hint, and two few-shot refs) is created with `POST /runs`, and its
 * log read with `GET /runs/{runId}/events/poll`:
 *   kinds      the run completes; `agent.prompt-resolved` (v1
 *              `agent.promptResolved`) is emitted for each kind, and surfaces
 *              each of the five refs (`fewShotPromptRefs[1]` included); unless
 *              observability is `off`, every ref appears in some
 *              `prompt.composed.refs` — and under `off`, no `prompt.composed`
 *              at all; every payload validates against the v2 payload defs;
 *   ordering   every `prompt.composed` follows an `agent.prompt-resolved` for
 *              its node.
 *
 * Dispositions: `prompts` not advertised or the fixture not in `fixtures[]` ⇒
 * `inapplicable` (the fixture is the opt-in); discovery unreadable ⇒
 * `blocked`; the event codemap unreadable ⇒ `blocked`.
 *
 * Proven against a scratch double in `lib/prompt-events-witness.test.ts`.
 *
 * @see spec/v2/core/host-services.md §Resolution
 * @see conformance/fixtures/conformance-prompt-all-four-kinds.json
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { ALL_FOUR_FIXTURE, driveFixture, judgeAllFourKinds, judgeOrdering, type FixtureObservation, type Skip } from '../lib/prompt-events-witness.js';

const PROFILE = majorProfile(2);
const ID_KINDS = 'openwop.requirement.prompts.all-four-kinds-events';
const ID_ORDER = 'openwop.requirement.prompts.resolution-precedes-composition';
const validators = {
  resolved: v2RefValidator('run-event-payloads.schema.json#/$defs/agentPromptResolved'),
  composed: v2RefValidator('run-event-payloads.schema.json#/$defs/promptComposed'),
};

let run: Promise<Skip | FixtureObservation> | undefined;
type Observed = { ok: true; o: FixtureObservation } | { ok: false; skip: () => undefined };
async function observed(): Promise<Observed> {
  if (!process.env['OPENWOP_BASE_URL']) return { ok: false, skip: () => softSkip('inapplicable', 'no target: OPENWOP_BASE_URL is unset') };
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  if (!doc) return { ok: false, skip: () => softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0') };
  run ??= driveFixture(PROFILE, doc, ALL_FOUR_FIXTURE);
  const o = await run;
  if ('kind' in o) return { ok: false, skip: () => softSkip(o.disposition, o.reason) };
  return { ok: true, o };
}

describe('v2 prompt events: all four kinds (host-services.md §Resolution, §Composition)', () => {
  it('each kind and each configured ref is resolved and composed', async () => {
    const r = await observed();
    if (!r.ok) return r.skip();
    for (const x of judgeAllFourKinds(r.o, validators)) expect(x.ok, req(ID_KINDS, x.doc, x.message)).toBe(true);
  }, 60_000);

  it('every prompt.composed follows an agent.prompt-resolved for its node', async () => {
    const r = await observed();
    if (!r.ok) return r.skip();
    for (const x of judgeOrdering(r.o)) expect(x.ok, req(ID_ORDER, x.doc, x.message)).toBe(true);
  }, 60_000);
});
