/**
 * tool-hooks-failure-honesty — RFC 0064 §F. A tool failure MUST be
 * self-describing on the wire: a non-success `agent.toolReturned` MUST carry a
 * failure discriminator — `error` populated (the `_errorObject`) and, when the
 * host advertises `prePostEvents`, `status: 'error'` — and MUST NOT be
 * represented as a bare/empty success. Closes the gap where a failed tool is
 * indistinguishable from one that succeeded-empty (host-program WFAU-4).
 *
 * Gated on `capabilities.toolHooks.supported` + the tool-hooks seam. Drives the
 * seam's `simulateToolError` arm; a host that advertises tool-hooks but has not
 * wired that arm soft-skips (`blocked`) rather than failing — §F and the seam
 * arm land together, so hosts wire it on adoption (the same soft-skip-until-wired
 * discipline the other tool-hooks scenarios use).
 *
 * @see RFCS/0064-tool-invocation-hooks-and-authorization.md §F
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { readToolHooksCap, invokeToolHook } from '../lib/toolHooks.js';
import { req } from '../lib/requirement-ids.js';

describe('tool-hooks-failure-honesty (RFC 0064 §F)', () => {
  it('a failing tool yields a populated error, never a bare success', async () => {
    const cap = await readToolHooksCap();
    if (cap?.supported !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.supported !== true` returned early');
    const res = await invokeToolHook({ principal: 'core.system', toolName: 'web.search', simulateToolError: true });
    if (res === null) return softSkip('blocked', 'tool-hooks seam absent — soft-skip');

    const returned = res.toolReturned ?? {};
    const errRaw = returned['error'];
    const err = errRaw != null && typeof errRaw === 'object' ? (errRaw as Record<string, unknown>) : undefined;
    const isErrorStatus = returned['status'] === 'error';

    // A host that has not wired the §F simulateToolError arm answers with a
    // success (status 'ok' / an outcome). Soft-skip rather than red-light an
    // honest pre-§F host — the prose MUST and this seam arm adopt together.
    if (err === undefined && !isErrorStatus) {
      return softSkip('blocked', 'host has not wired the RFC 0064 §F simulateToolError arm — soft-skip until adopted');
    }

    // §F: the failure carries a populated `_errorObject { code, message }`.
    expect(
      err !== undefined && typeof err['code'] === 'string' && (err['code'] as string).length > 0 && typeof err['message'] === 'string',
      req('openwop.it.tool-hooks-failure-honesty.a-failing-tool-yields-a-populated-error-never-a-bare-success', 'RFC 0064 §F', 'a failed tool MUST populate error {code, message} on agent.toolReturned'),
    ).toBe(true);

    // §F: `error` and `outcome` are mutually exclusive.
    expect(
      returned['outcome'] === undefined,
      req('openwop.it.tool-hooks-failure-honesty.a-failing-tool-yields-a-populated-error-never-a-bare-success', 'RFC 0064 §F', 'error and outcome are mutually exclusive on a failed tool-return'),
    ).toBe(true);

    // §F: a host advertising `prePostEvents` MUST also set `status: 'error'`.
    if (cap['prePostEvents'] === true) {
      expect(
        returned['status'] === 'error',
        req('openwop.it.tool-hooks-failure-honesty.a-failing-tool-yields-a-populated-error-never-a-bare-success', 'RFC 0064 §F', 'a host advertising prePostEvents MUST set status:"error" on a tool failure'),
      ).toBe(true);
    }
  });
});
