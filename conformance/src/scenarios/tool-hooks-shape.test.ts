/**
 * tool-hooks-shape — RFC 0064 §A. The `capabilities.toolHooks` advertisement
 * block is either absent or a well-formed object.
 *
 * Status: ACTIVE (advertisement-shape; always runs). Behavioral coverage lives
 * in the sibling tool-hooks-*.test.ts scenarios, gated on the sub-flags + the
 * host tool-hooks seam.
 *
 * @see RFCS/0064-tool-invocation-hooks-and-authorization.md §A
 * @see spec/v1/host-capabilities.md §host.toolHooks
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { readToolHooksCap } from '../lib/toolHooks.js';
import { req } from '../lib/requirement-ids.js';

describe('tool-hooks-shape: advertisement (RFC 0064 §A)', () => {
  it('capabilities.toolHooks is absent or a well-formed object', async () => {
    const cap = await readToolHooksCap();
    if (cap === null) return softSkip('inapplicable', 'not advertised — valid');
    expect(
      typeof cap.supported,
      req('openwop.it.tool-hooks-shape.capabilities-toolhooks-is-absent-or-a-well-formed-object', 'capabilities.schema.json §toolHooks', 'toolHooks.supported MUST be a boolean when the block is present'),
    ).toBe('boolean');
    for (const k of ['prePostEvents', 'perToolAuthorization', 'perToolRateLimit'] as const) {
      if (cap[k] !== undefined) {
        expect(
          typeof cap[k],
          req('openwop.it.tool-hooks-shape.capabilities-toolhooks-is-absent-or-a-well-formed-object', 'capabilities.schema.json §toolHooks', `toolHooks.${k} MUST be a boolean when present`),
        ).toBe('boolean');
      }
    }
  });
});
