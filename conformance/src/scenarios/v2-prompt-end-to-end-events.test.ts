/**
 * v2 — a node's systemPromptRef resolves and composes on real dispatch
 * (`spec/v2/core/host-services.md` §`prompts` → §Resolution, §Composition;
 * RFCs 0027 §E, 0029 §A). The v1 twin is `prompt-end-to-end-events`; the
 * judges live in `lib/prompt-events-witness.ts`.
 *
 * A run of `conformance-prompt-end-to-end` (node `writer`, `systemPromptRef:
 * prompt:conformance.prompt.writer-system@1.0.0`) is created with
 * `POST /runs`, and its log read with `GET /runs/{runId}/events/poll`:
 *   resolution   the run completes; `agent.prompt-resolved` (kind `system`,
 *                node `writer`) names the node layer as the applied entry and
 *                resolves the configured ref;
 *   composition  unless observability is `off`, `prompt.composed` carries a
 *                `sha256:<hex64>` hash and kind `system-only`; bodies
 *                (`composed`, `systemPrompt`) only under `full` — NEW at v2:
 *                under `hashed` (the default) no body field appears (v1
 *                required a body unconditionally); under `off`, no
 *                `prompt.composed` at all;
 *   ordering     every `prompt.composed` follows an `agent.prompt-resolved`
 *                for its node.
 *
 * Dispositions: `prompts` not advertised or the fixture not in `fixtures[]` ⇒
 * `inapplicable`; discovery unreadable ⇒ `blocked`.
 *
 * Proven against a scratch double in `lib/prompt-events-witness.test.ts`.
 *
 * @see spec/v2/core/host-services.md §Resolution, §Composition
 * @see conformance/fixtures/conformance-prompt-end-to-end.json
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, v2RefValidator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { END_TO_END_FIXTURE, driveFixture, judgeEndToEnd, judgeOrdering, type FixtureObservation, type Skip } from '../lib/prompt-events-witness.js';

const PROFILE = majorProfile(2);
const ID_E2E = 'openwop.requirement.prompts.end-to-end-resolution-and-composition';
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
  run ??= driveFixture(PROFILE, doc, END_TO_END_FIXTURE);
  const o = await run;
  if ('kind' in o) return { ok: false, skip: () => softSkip(o.disposition, o.reason) };
  return { ok: true, o };
}

describe('v2 prompt events: end to end (host-services.md §Resolution, §Composition)', () => {
  it('the node layer wins, and prompt.composed carries the hash with bodies only under full', async () => {
    const r = await observed();
    if (!r.ok) return r.skip();
    for (const x of judgeEndToEnd(r.o, validators)) expect(x.ok, req(ID_E2E, x.doc, x.message)).toBe(true);
  }, 60_000);

  it('agent.prompt-resolved precedes prompt.composed for the node', async () => {
    const r = await observed();
    if (!r.ok) return r.skip();
    for (const x of judgeOrdering(r.o)) expect(x.ok, req(ID_ORDER, x.doc, x.message)).toBe(true);
  }, 60_000);
});
