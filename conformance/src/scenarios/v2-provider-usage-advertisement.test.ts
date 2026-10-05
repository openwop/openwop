/**
 * v2 — the `providerUsage` advertisement (`spec/v2/core/events.md`
 * §providerUsage; RFC 0026). The v1 twin is the advertisement leg of
 * `provider-usage`; the legs live in `lib/family-advert-witness.ts`.
 *
 *   record         the record validates against its capabilities-schema seat;
 *   costEstimates  one boolean;
 *   currency       an ISO 4217 code, `^[A-Z]{3}$` (absent means USD).
 *
 * Not here: exactly-one-per-invocation emission needs a mock-provider run; the
 * payload shape is the corpus gate `coherence/v2-provider-usage-payload-static`.
 *
 * Dispositions: discovery unreadable ⇒ `blocked`; `providerUsage` absent, or the
 * facet a leg reads absent ⇒ `inapplicable`.
 *
 * @see spec/v2/core/events.md §providerUsage
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { providerUsageCostEstimatesLeg, providerUsageCurrencyLeg, recordSchemaLeg } from '../lib/family-advert-witness.js';

const PROFILE = majorProfile(2);
const DOC = 'events.md §providerUsage';
const UNREADABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 JSON under OpenWOP-Version: 2.0';
const ID_RECORD = 'openwop.requirement.provider-usage.advert-record-schema';
const ID_COST_ESTIMATES_BOOLEAN = 'openwop.requirement.provider-usage.cost-estimates-boolean';
const ID_CURRENCY_ISO_4217 = 'openwop.requirement.provider-usage.currency-iso-4217';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('v2 providerUsage advertisement (events.md §providerUsage)', () => {
  it('the providerUsage record validates against its capabilities-schema seat', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = recordSchemaLeg(PROFILE, doc, 'providerUsage', DOC);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_RECORD, x.doc, x.message)).toBe(true);
  });

  it('providerUsage.costEstimates is one boolean', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = providerUsageCostEstimatesLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_COST_ESTIMATES_BOOLEAN, x.doc, x.message)).toBe(true);
  });

  it('providerUsage.currency is an ISO 4217 code', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREADABLE);
    const out = providerUsageCurrencyLeg(PROFILE, doc);
    if (out.kind === 'skip') return softSkip(out.disposition, out.reason);
    for (const x of out.findings) expect(x.ok, req(ID_CURRENCY_ISO_4217, x.doc, x.message)).toBe(true);
  });
});
