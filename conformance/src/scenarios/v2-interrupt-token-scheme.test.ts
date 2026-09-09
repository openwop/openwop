/**
 * v2 — `interrupt-token-scheme` (suite 2.0.0; RFC 0170 §E.1;
 * `spec/v2/core/identity.md` §4 "Resume tokens"; `spec/v2/core/interrupt.md` §Tokens).
 *
 * Witness class: witnessable — unaided. A resume token is
 * `ow2.<alg>.<kid>.<payload>.<mac>`. A host MUST refuse a token whose `alg` it
 * does not advertise or whose `kid` it does not hold with
 * `401 interrupt_token_invalid`. The signed-token surface
 * (`GET /interrupts/{token}`) is a SHOULD, so a host that answers `404
 * not_found` to every token probe records `inapplicable`; once the surface is
 * observed to be mounted, a well-formed token under an unheld `kid` MUST be
 * `interrupt_token_invalid`, never `not_found`.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/identity.md §4';
const UNPREFIXED = 'b3BlbndvcC1jb25mb3JtYW5jZQ.0123456789abcdef0123456789abcdef';
const UNHELD_KID = 'ow2.hs256.nokid.b3BlbndvcC1jb25mb3JtYW5jZQ.0123456789abcdef0123456789abcdef';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}
function inspect(token: string): Promise<OpenWOPResponse | null> {
  return http(() => driver.get(`/interrupts/${encodeURIComponent(token)}`, { authenticated: false }));
}

describe('v2 interrupt-token-scheme (RFC 0170 §E.1)', () => {
  it('a token without the ow2. prefix is refused', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const res = await inspect(UNPREFIXED);
    if (res === null) return softSkip('blocked', 'GET /interrupts/{token} unreachable (fetch failed)');
    expect([401, 404].includes(res.status), req('openwop.requirement.0170.interrupt-token-scheme.unprefixed-refused', DOC, `a token outside the ow2.<alg>.<kid>.<payload>.<mac> grammar MUST NOT resolve — 401 interrupt_token_invalid (or 404 not_found where the signed-token surface is not mounted); got ${res.status}`)).toBe(true);
    const code = readErrorCode(res.json);
    expect(res.status === 401 ? code === 'interrupt_token_invalid' : (code === 'not_found' || code === 'interrupt_not_found'), req('openwop.requirement.0170.interrupt-token-scheme.unprefixed-refused', 'spec/v2/core/interrupt.md §Tokens', `the refusal MUST carry a registered code (401 → interrupt_token_invalid; 404 → not_found OR the more precise interrupt_not_found, both registered in spec/v2/errors.json for this state — a scenario narrower than its own registry fails the host that answers more precisely); got ${String(code)}`)).toBe(true);
  });

  it('a well-formed token under a kid the host does not hold is 401 interrupt_token_invalid', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0');
    const probe = await inspect(UNPREFIXED);
    const res = await inspect(UNHELD_KID);
    if (probe === null || res === null) return softSkip('blocked', 'GET /interrupts/{token} unreachable (fetch failed)');
    if (probe.status === 404 && res.status === 404) return softSkip('inapplicable', 'the signed-token surface GET /interrupts/{token} is not mounted (404 to every token probe) — a SHOULD in interrupt.md; the kid rule cannot be observed');
    expect(res.status, req('openwop.requirement.0170.interrupt-token-scheme.unheld-kid-refused', DOC, 'a host MUST refuse a token whose kid it does not hold with 401')).toBe(401);
    expect(readErrorCode(res.json), req('openwop.requirement.0170.interrupt-token-scheme.unheld-kid-refused', DOC, 'the refusal code MUST be interrupt_token_invalid (one code per state — never not_found for a token the host cannot verify)')).toBe('interrupt_token_invalid');
  });
});
