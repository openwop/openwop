/**
 * RFC 0175 §D.4 — `refresh-sla` (suite 2.0.0, target major 2; unaided, gated on a2a or mcp).
 *
 * A host MUST re-evaluate its advertised `versions[]` / `revisions[]` against
 * the upstream registry within the window its `refreshedAt` declares, and that
 * window MUST NOT exceed 90 days; an advertisement older than its window is
 * non-conformant (`spec/v2/core/interop.md` §Negotiation is a protocol — The
 * refresh SLA; RFC 0147 R10; RFC 0175 row C8.4).
 *
 * `refreshedAt` is a `date` (`spec/v2/facets/a2a|mcp.schema.json`), REQUIRED on
 * both facets. The check is against the suite's clock: `now - refreshedAt ≤ 90
 * days`, and not in the future (a refresh date ahead of the clock is a claim
 * about a check that has not happened). The preferred version and the floor
 * MUST be members of the offered set, or the advertisement names something a
 * peer cannot act on.
 *
 * @see spec/v2/core/interop.md §Negotiation is a protocol
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, familyAdvertised } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

describe('RFC 0175 §D.4 — refresh-sla (unaided; gated on a2a or mcp)', () => {
  it('refreshedAt on each embedded-protocol facet is within 90 days of now', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const facets: Array<{ family: 'a2a' | 'mcp'; offered: string; preferred: string; floor: string }> = [
      { family: 'a2a', offered: 'versions', preferred: 'preferredVersion', floor: 'minimumVersion' },
      { family: 'mcp', offered: 'revisions', preferred: 'preferredVersion', floor: 'minimumRevision' },
    ];
    let checked = 0;
    const now = Date.now();
    for (const f of facets) {
      const rec = await familyAdvertised(f.family);
      if (!rec) continue;
      checked++;
      const refreshedAt = rec['refreshedAt'];
      expect(
        typeof refreshedAt === 'string' && DATE.test(refreshedAt),
        req('openwop.requirement.0175.refresh-sla', `facets/${f.family}.schema.json refreshedAt`, `${f.family}.refreshedAt is REQUIRED and MUST be a date (got ${JSON.stringify(refreshedAt)})`),
      ).toBe(true);
      const at = Date.parse(`${String(refreshedAt)}T00:00:00Z`);
      const ageDays = (now - at) / DAY_MS;
      expect(
        ageDays,
        req('openwop.requirement.0175.refresh-sla', 'interop.md §The refresh SLA', `${f.family}.refreshedAt (${String(refreshedAt)}) MUST be within ${WINDOW_DAYS} days of now — an advertisement older than its window is non-conformant (RFC 0175 §D.4)`),
      ).toBeLessThanOrEqual(WINDOW_DAYS);
      expect(
        ageDays,
        req('openwop.requirement.0175.refresh-sla', 'interop.md §The refresh SLA', `${f.family}.refreshedAt (${String(refreshedAt)}) MUST NOT be in the future — a refresh that has not happened is not a refresh`),
      ).toBeGreaterThanOrEqual(-1);
      const offered = Array.isArray(rec[f.offered]) ? (rec[f.offered] as unknown[]) : [];
      expect(
        offered.length,
        req('openwop.requirement.0175.refresh-sla', `facets/${f.family}.schema.json ${f.offered}`, `${f.family}.${f.offered}[] MUST offer at least one entry`),
      ).toBeGreaterThan(0);
      expect(
        offered,
        req('openwop.requirement.0175.refresh-sla', 'interop.md §The facets', `${f.family}.${f.preferred} MUST be one of the offered ${f.offered}[]`),
      ).toContain(rec[f.preferred]);
      expect(
        offered,
        req('openwop.requirement.0175.refresh-sla', 'interop.md §The facets', `${f.family}.${f.floor} MUST be one of the offered ${f.offered}[] — a floor below every offer refuses nothing`),
      ).toContain(rec[f.floor]);
    }
    if (checked === 0) return softSkip('inapplicable', 'host advertises neither a2a nor mcp — no refreshedAt to check');
  });
});
