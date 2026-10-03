/**
 * v2 — the trigger bridge's delivery model on the normative surface
 * (`spec/v2/core/webhooks.md` §Inbound triggers). The v1 twin is
 * `trigger-bridge-delivery`; this file shares its requirement ids, as the v2
 * secrets witness does, so a requirement is one id at every major. The legs
 * live in `lib/trigger-delivery-witness.ts`; what differs between majors is the
 * profile row in `lib/major-profile.ts`.
 *
 * Unaided: the suite registers a `webhook` subscription and posts Standard
 * Webhooks-signed bodies to its `ingestUrl` with no OpenWOP credential.
 *
 *   1. dedup          a repeated `webhook-id` is effectively-once.
 *   2. dead-letter    a refused post starts no run and leaves the subscription
 *                     `active`; a correctly signed post still delivers.
 *   3. causation      the delivered run's `run.started` carries the delivery.
 *   4a. run-less attempt   a dead-lettered attempt is content-free, read through
 *                     `GET /trigger-subscriptions/{subscriptionId}/dead-letters`.
 *   4b. run-less state change   `inapplicable`: no wire surface causes one and
 *                     no seam drives one at major 2 (RFC 0232 §E, gap G2).
 *
 * Dispositions: `triggerBridge` absent, or `ingestion.inboundSigning` not
 * listing `standard-webhooks-1` ⇒ `inapplicable` (major 2 has no other delivery
 * surface). Leg 4a also needs `triggerBridge.deadLetter`.
 *
 * Proven against a scratch double in `lib/trigger-delivery-witness.test.ts`.
 *
 * @see spec/v2/core/webhooks.md §Inbound triggers
 * @see RFCS/0230-inbound-webhook-ingest-contract.md, RFCS/0232-trigger-dead-letter-read.md
 */

import { describe, it, expect } from 'vitest';
import { familyAdvertised, v2Discovery, v2Validator } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { noteObservation } from '../lib/row-observation.js';
import { majorProfile } from '../lib/major-profile.js';
import { adverts, causationLeg, dedupLeg, refusedLeg, runlessAttemptLeg, runlessStateChangeLeg, type TriggerAdverts } from '../lib/trigger-delivery-witness.js';

const PROFILE = majorProfile(2);
const R_DEDUP = 'openwop.requirement.0083.trigger-delivery.dedup';
const R_DEAD_LETTER = 'openwop.requirement.0083.trigger-delivery.dead-letter';
const R_CAUSATION = 'openwop.requirement.0083.trigger-delivery.causation';
const R_RUNLESS_ATTEMPT = 'openwop.requirement.0083.trigger-delivery.runless-attempt-content-free';
const R_RUNLESS_STATE = 'openwop.requirement.0083.trigger-delivery.runless-state-change-content-free';

/**
 * `familyAdvertised`, not `gateFamily`: `triggerBridge` is optional, and a host that does not advertise it
 * has taken on no obligation here. `gateFamily` fails an unadvertised family in strict mode (the 2.45.7
 * `v2-workspace-scope-from-identity` defect).
 */
async function discovered(): Promise<TriggerAdverts | string> {
  if (!(await familyAdvertised('triggerBridge'))) return 'GATED';
  let doc: Record<string, unknown> | null;
  try { doc = await v2Discovery(); } catch { doc = null; }
  return doc ? adverts(PROFILE, doc) : 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0';
}

describe('v2 trigger-bridge delivery (webhooks.md §Inbound triggers)', () => {
  it('de-dups a repeated webhook-id: effectively-once', async () => {
    const a = await discovered();
    if (a === 'GATED') return softSkip('inapplicable', 'the host does not advertise triggerBridge at major 2: no obligation');
    if (typeof a === 'string') return softSkip('blocked', a);
    const out = await dedupLeg(PROFILE, a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(R_DEDUP, x.doc, x.message)).toBe(true);
    noteObservation(`normative-surface path (RFC 0230)${out.note ? `; ${out.note}` : ''}`);
  });

  it('a refused post starts no run and leaves the subscription active', async () => {
    const a = await discovered();
    if (a === 'GATED') return softSkip('inapplicable', 'the host does not advertise triggerBridge at major 2: no obligation');
    if (typeof a === 'string') return softSkip('blocked', a);
    const out = await refusedLeg(PROFILE, a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(R_DEAD_LETTER, x.doc, x.message)).toBe(true);
    noteObservation(`normative-surface path (RFC 0230)${out.note ? `; ${out.note}` : ''}`);
  });

  it('links delivery to run: run.started carries the delivery as causationId', async () => {
    const a = await discovered();
    if (a === 'GATED') return softSkip('inapplicable', 'the host does not advertise triggerBridge at major 2: no obligation');
    if (typeof a === 'string') return softSkip('blocked', a);
    const out = await causationLeg(PROFILE, a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(R_CAUSATION, x.doc, x.message)).toBe(true);
    noteObservation(`normative-surface path (RFC 0230)${out.note ? `; ${out.note}` : ''}`);
  });

  it('keeps a dead-lettered run-less attempt content-free', async () => {
    const a = await discovered();
    if (a === 'GATED') return softSkip('inapplicable', 'the host does not advertise triggerBridge at major 2: no obligation');
    if (typeof a === 'string') return softSkip('blocked', a);
    const out = await runlessAttemptLeg(PROFILE, a, v2Validator('trigger-dead-letter-page'));
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(R_RUNLESS_ATTEMPT, x.doc, x.message)).toBe(true);
    noteObservation(`normative-surface path (RFC 0230)${out.note ? `; ${out.note}` : ''}`);
  });

  it('keeps a run-less subscription state change content-free', async () => {
    const a = await discovered();
    if (a === 'GATED') return softSkip('inapplicable', 'the host does not advertise triggerBridge at major 2: no obligation');
    if (typeof a === 'string') return softSkip('blocked', a);
    const out = runlessStateChangeLeg(a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    expect(out.kind, req(R_RUNLESS_STATE, 'webhooks.md §Inbound triggers', 'unreachable: no major-2 surface causes a state change')).toBe('skip');
  });
});
