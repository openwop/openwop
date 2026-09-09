/**
 * tool-hooks-rate-limit — RFC 0064 §D. Exhausting a `(principal, tool)` token
 * bucket → `agent.toolReturned { status: 'rate_limited' }` and the tool is not
 * invoked, surfacing the existing `rate_limited` (429) error.
 *
 * Gated on `capabilities.toolHooks.perToolRateLimit` + the host tool-hooks
 * seam; soft-skips when either is absent.
 *
 * @see RFCS/0064-tool-invocation-hooks-and-authorization.md §D
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { readToolHooksCap, invokeToolHook } from '../lib/toolHooks.js';
import { req } from '../lib/requirement-ids.js';

describe('tool-hooks-rate-limit (RFC 0064 §D)', () => {
  it('an exhausted (principal, tool) bucket yields status:"rate_limited"', async () => {
    const cap = await readToolHooksCap();
    if (cap?.perToolRateLimit !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.perToolRateLimit !== true` returned early');
    const res = await invokeToolHook({
      principal: 'core.system',
      toolName: 'web.search',
      args: { q: 'x' },
      simulateRateLimitExhausted: true,
    });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    expect(
      (res.toolReturned ?? {}).status,
      req('openwop.it.tool-hooks-rate-limit.an-exhausted-principal-tool-bucket-yields-status-rate-limited', 'RFC 0064 §D', 'an exhausted token bucket MUST yield status:"rate_limited" without invoking the tool'),
    ).toBe('rate_limited');
  });
});
