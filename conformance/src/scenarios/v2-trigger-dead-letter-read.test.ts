/**
 * v2 — the trigger dead-letter read's own rules (RFC 0232 §B;
 * `spec/v2/core/webhooks.md` §Inbound triggers). The v1 twin is
 * `trigger-dead-letter-read`; the requirement ids are shared, and the legs live
 * in `lib/trigger-delivery-witness.ts`.
 *
 *   paging        `limit` is clamped, and a short page carries `nextCursor`.
 *   cursor-bound  a cursor minted for one subscription is refused on another,
 *                 `400 validation_error`.
 *   tenant-bound  another tenant's read answers `404`, exactly as an id never
 *                 minted. Needs `OPENWOP_TEST_TENANT_B_API_KEY`, else `blocked`.
 *
 * Dispositions: `triggerBridge`, `triggerBridge.deadLetter` or
 * `ingestion.inboundSigning` not advertised ⇒ `inapplicable`.
 *
 * Proven against a scratch double in `lib/trigger-delivery-witness.test.ts`.
 *
 * @see spec/v2/core/webhooks.md §Inbound triggers
 * @see RFCS/0232-trigger-dead-letter-read.md §B
 */

import { describe, it, expect } from 'vitest';
import { familyAdvertised, v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { loadEnv } from '../lib/env.js';
import { majorProfile } from '../lib/major-profile.js';
import { adverts, cursorLeg, pagingLeg, tenantLeg, type TriggerAdverts } from '../lib/trigger-delivery-witness.js';

const PROFILE = majorProfile(2);
const R_PAGING = 'openwop.requirement.0232.trigger-dead-letters.paging';
const R_CURSOR = 'openwop.requirement.0232.trigger-dead-letters.cursor-bound';
const R_TENANT = 'openwop.requirement.0232.trigger-dead-letters.tenant-bound';

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

describe('v2 trigger dead-letter read (RFC 0232 §B)', () => {
  it('clamps limit and continues a short page with nextCursor', async () => {
    const a = await discovered();
    if (a === 'GATED') return softSkip('inapplicable', 'the host does not advertise triggerBridge at major 2: no obligation');
    if (typeof a === 'string') return softSkip('blocked', a);
    const out = await pagingLeg(PROFILE, a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(R_PAGING, x.doc, x.message)).toBe(true);
  });

  it('refuses a cursor minted for another subscription', async () => {
    const a = await discovered();
    if (a === 'GATED') return softSkip('inapplicable', 'the host does not advertise triggerBridge at major 2: no obligation');
    if (typeof a === 'string') return softSkip('blocked', a);
    const out = await cursorLeg(PROFILE, a);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(R_CURSOR, x.doc, x.message)).toBe(true);
  });

  it("answers another tenant's read of a subscription 404, as for an id never minted", async () => {
    const a = await discovered();
    if (a === 'GATED') return softSkip('inapplicable', 'the host does not advertise triggerBridge at major 2: no obligation');
    if (typeof a === 'string') return softSkip('blocked', a);
    const out = await tenantLeg(PROFILE, a, process.env['OPENWOP_TEST_TENANT_B_API_KEY'], loadEnv().apiKey);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(R_TENANT, x.doc, x.message)).toBe(true);
  });
});
