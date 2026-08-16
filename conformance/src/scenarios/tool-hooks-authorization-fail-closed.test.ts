/**
 * tool-hooks-authorization-fail-closed — RFC 0064 §C. A principal lacking a
 * tool's required scope (or whose authorization cannot be evaluated) gets
 * `agent.toolReturned { status: 'forbidden' }` and the tool is never invoked —
 * the per-tool application of RFC 0049's `authorization-fail-closed` invariant.
 *
 * Gated on `capabilities.toolHooks.perToolAuthorization` + the host tool-hooks
 * seam; soft-skips when either is absent.
 *
 * @see RFCS/0064-tool-invocation-hooks-and-authorization.md §C
 * @see SECURITY/invariants.yaml — authorization-fail-closed (RFC 0049, reused)
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readToolHooksCap, invokeToolHook } from '../lib/toolHooks.js';

describe('tool-hooks-authorization-fail-closed (RFC 0064 §C)', () => {
  it('a principal lacking a tool scope is denied and the tool is not invoked', async () => {
    const cap = await readToolHooksCap();
    if (cap?.perToolAuthorization !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.perToolAuthorization !== true` returned early');
    // A principal with no scopes against a tool requiring one MUST be denied.
    const res = await invokeToolHook({
      principal: 'conformance-unprivileged',
      toolName: 'db.delete',
      requiredScopes: ['db:write'],
      args: {},
    });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    expect(
      (res.toolReturned ?? {}).status,
      driver.describe('RFC 0064 §C', 'a missing/unevaluable tool scope MUST fail closed → status:"forbidden"'),
    ).toBe('forbidden');
    expect(
      (res.toolReturned ?? {}).durationMs,
      driver.describe('RFC 0064 §C', 'a forbidden call never starts, so durationMs MUST be absent'),
    ).toBeUndefined();
  });
});
