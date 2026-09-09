/**
 * tool-hooks-content-free — RFC 0064 §B. When `prePostEvents`, a tool call's
 * `agent.toolCalled` carries `argsHash` (the content-free, SIEM-safe
 * alternative to raw `inputs`) + `agent.toolReturned` carries `status` +
 * `durationMs`.
 *
 * Gated on `capabilities.toolHooks.prePostEvents` + the host tool-hooks seam;
 * soft-skips when either is absent.
 *
 * @see RFCS/0064-tool-invocation-hooks-and-authorization.md §B
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { readToolHooksCap, invokeToolHook } from '../lib/toolHooks.js';
import { req } from '../lib/requirement-ids.js';

describe('tool-hooks-content-free (RFC 0064 §B)', () => {
  it('toolCalled carries argsHash; toolReturned carries status + durationMs', async () => {
    const cap = await readToolHooksCap();
    if (cap?.prePostEvents !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.prePostEvents !== true` returned early');
    const res = await invokeToolHook({ principal: 'core.system', toolName: 'web.search', args: { q: 'openwop' } });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    const called = res.toolCalled ?? {};
    const returned = res.toolReturned ?? {};
    expect(
      typeof called.argsHash === 'string' && (called.argsHash as string).length > 0,
      req('openwop.it.tool-hooks-content-free.toolcalled-carries-argshash-toolreturned-carries-status-durationms', 'RFC 0064 §B', 'agent.toolCalled MUST carry a non-empty argsHash when prePostEvents'),
    ).toBe(true);
    expect(
      ['ok', 'error', 'forbidden', 'rate_limited'].includes(returned.status as string),
      req('openwop.it.tool-hooks-content-free.toolcalled-carries-argshash-toolreturned-carries-status-durationms', 'RFC 0064 §B', 'agent.toolReturned MUST carry a tool-hooks status'),
    ).toBe(true);
    if (returned.status === 'ok') {
      expect(
        typeof returned.durationMs === 'number' && (returned.durationMs as number) >= 0,
        req('openwop.it.tool-hooks-content-free.toolcalled-carries-argshash-toolreturned-carries-status-durationms', 'RFC 0064 §B', 'a completed tool call MUST record a non-negative durationMs'),
      ).toBe(true);
    }
  });
});
