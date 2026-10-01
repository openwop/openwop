/**
 * v2 — a host at capacity answers `503 service_unavailable` with `Retry-After`
 * (`spec/v2/core/conformance.md` §Production profile, `backpressure` facet).
 * The v1 twin is `production-backpressure`; the logic both share is
 * `lib/backpressure-witness.ts`, and what differs between majors is the
 * profile row in `lib/major-profile.ts`.
 *
 * Unaided. Gated on `production.backpressure.inflightCap`, the number a host
 * advertises so the suite can saturate it: `inflightCap` event streams hold
 * the slots and one more request is sent.
 *
 *   refusal        the extra request answers `503`, code `service_unavailable`,
 *                  with `Retry-After`; where `retryAfterSeconds` is advertised
 *                  the header equals it.
 *   retry timing   the refusal carries no `details.retryAfter*`
 *                  (`errors.md` §Retry timing). This is where v2 differs from
 *                  v1, which required `details.retryAfter`.
 *
 * Dispositions: no `production`, no `backpressure`, no `inflightCap`, an
 * `inflightCap` above 64 (the most streams the suite holds open), or the hold
 * or probe fixture unadvertised ⇒ `inapplicable`. A slot that cannot be
 * filled, or a probe with no response ⇒ `blocked`.
 *
 * v1's "discovery is exempt from the cap" leg is not ported: no v2 document
 * states it.
 *
 * Run with `--no-file-parallelism`. Proven both ways against the scratch host
 * in `lib/backpressure-witness.test.ts`.
 *
 * @see spec/v2/core/conformance.md §Production profile
 * @see spec/v2/core/errors.md §Retry timing
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { majorProfile } from '../lib/major-profile.js';
import { judge, saturate, type Saturation } from '../lib/backpressure-witness.js';

const PROFILE = majorProfile(2);
const ID_REFUSAL = 'openwop.requirement.production.backpressure-refusal';
const ID_TIMING = 'openwop.requirement.0171.error-registry.no-retry-details';

/** One saturation per file: two legs read the same refusal. */
let once: Promise<Saturation> | undefined;
function saturation(): Promise<Saturation> {
  once ??= (async (): Promise<Saturation> => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return { kind: 'skip', disposition: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
    return saturate(PROFILE, doc);
  })();
  return once;
}

describe('v2 production backpressure (conformance.md §Production profile)', () => {
  it('with inflightCap slots held, the next request is refused 503 service_unavailable with Retry-After', async () => {
    const s = await saturation();
    if (s.kind === 'skip') return softSkip(s.disposition, s.reason);
    for (const f of judge(PROFILE, s.refusal).filter((x) => x.rule !== 'retry-timing')) {
      expect(f.ok, req(ID_REFUSAL, f.doc, f.message)).toBe(true);
    }
  });

  it('the refusal carries its retry timing in the Retry-After header only', async () => {
    const s = await saturation();
    if (s.kind === 'skip') return softSkip(s.disposition, s.reason);
    if (s.refusal.status !== 503) return softSkip('blocked', `no 503 was observed at inflightCap + 1 (got ${s.refusal.status}) — there is no refusal whose details could be read`);
    for (const f of judge(PROFILE, s.refusal).filter((x) => x.rule === 'retry-timing')) {
      expect(f.ok, req(ID_TIMING, f.doc, f.message)).toBe(true);
    }
  });
});
