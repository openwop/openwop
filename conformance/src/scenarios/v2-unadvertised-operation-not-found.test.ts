/**
 * v2 — an operation gated on an unadvertised family or facet answers
 * `404 not_found` (suite 2.45; RFC 0228 §H; `spec/v2/core/errors.md`
 * §Unadvertised operations).
 *
 * v1 answered these `501 capability_not_provided`. The registry holds
 * `capability_not_provided` at `422`, and a bare `501` carries no registered
 * code, so v2 answers the route that is absent the way it answers any other
 * absent route. Both legs are unaided: the suite reads discovery and probes a
 * read the host does not advertise.
 *
 *   prompts   (hosts whose `prompts` record omits `endpointsSupported`, or
 *             that do not advertise `prompts`) `GET /prompts` answers
 *             `404 not_found`.
 *   content   (hosts that do not advertise `content`) `GET /content/settings`
 *             answers `404 not_found`.
 *
 * A host that advertises the facet records the leg `inapplicable`.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';

const DOC = 'spec/v2/core/errors.md §Unadvertised operations';
const UNREACHABLE = 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function get(path: string): Promise<OpenWOPResponse | null> {
  try { return await driver.get(path); } catch { return null; }
}
const record = (doc: Record<string, unknown>, key: string): Record<string, unknown> | null => {
  const r = doc[key];
  return r !== null && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : null;
};

describe('v2 unadvertised operations answer 404 not_found (RFC 0228 §H)', () => {
  it('GET /prompts answers 404 not_found when prompts.endpointsSupported is not advertised', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREACHABLE);
    if (record(doc, 'prompts')?.['endpointsSupported'] === true) return softSkip('inapplicable', 'the host advertises prompts.endpointsSupported — the /prompts* surface is served');
    const res = await get('/prompts');
    if (res === null) return softSkip('blocked', 'GET /prompts unreachable (fetch failed)');
    const ID = 'openwop.requirement.0228.unadvertised-prompts-not-found';
    expect(res.status, req(ID, DOC, `an operation gated on prompts.endpointsSupported, which the host does not advertise, MUST answer 404 (got ${res.status}; v1's 501 is not a v2 answer)`)).toBe(404);
    expect(readErrorCode(res.json), req(ID, DOC, 'the 404 for an unadvertised gated operation MUST carry the registered code not_found')).toBe('not_found');
  });

  it('GET /content/settings answers 404 not_found when content is not advertised', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', UNREACHABLE);
    if (record(doc, 'content') !== null) return softSkip('inapplicable', 'the host advertises content — the /content/* surface is served');
    const res = await get('/content/settings');
    if (res === null) return softSkip('blocked', 'GET /content/settings unreachable (fetch failed)');
    const ID = 'openwop.requirement.0228.unadvertised-content-not-found';
    expect(res.status, req(ID, DOC, `an operation gated on content, which the host does not advertise, MUST answer 404 (got ${res.status}; v1's 501 is not a v2 answer)`)).toBe(404);
    expect(readErrorCode(res.json), req(ID, DOC, 'the 404 for an unadvertised gated operation MUST carry the registered code not_found')).toBe('not_found');
  });
});
