/**
 * tool-hooks-secret-redaction — RFC 0064 §B/§E. A tool arg containing a
 * resolved secret is redacted (SR-1) before hashing; the raw value never
 * appears in `argsHash` or anywhere in the emitted `agent.toolCalled` /
 * `agent.toolReturned` pair.
 *
 * Gated on `capabilities.toolHooks.prePostEvents` + the host tool-hooks seam;
 * soft-skips when either is absent.
 *
 * @see RFCS/0064-tool-invocation-hooks-and-authorization.md §B (argsHash SR-1 redaction), §E (credentials)
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { readToolHooksCap, invokeToolHook } from '../lib/toolHooks.js';

const CANARY = 'sk-canary-rfc0064-do-not-leak-xyz789';

describe('tool-hooks-secret-redaction (RFC 0064 §E)', () => {
  it('a secret-shaped tool arg never appears in the emitted events', async () => {
    const cap = await readToolHooksCap();
    if (cap?.prePostEvents !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.prePostEvents !== true` returned early');
    const res = await invokeToolHook({
      principal: 'core.system',
      toolName: 'web.search',
      args: { apiKey: CANARY, q: 'openwop' },
    });
    if (res === null) return softSkip('blocked', 'seam absent — soft-skip');
    expect(
      JSON.stringify(res).includes(CANARY),
      driver.describe('RFC 0064 §B', 'a resolved secret MUST be redacted before hashing; the raw value MUST NOT appear in argsHash or any emitted field (SR-1)'),
    ).toBe(false);
  });
});
