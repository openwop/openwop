/**
 * `spec/v2/core/errors.md` is generated FROM `spec/v2/errors.json` and says so —
 * but nothing checked it, and it drifted: the prose claimed 92 codes while the
 * registry carried 94, with `fork_point_invalid` and `webhook_url_rejected`
 * absent from the rendered table. A host reading errors.md as the registry
 * would have refused to emit two codes the spec requires of it.
 *
 * The document is the human surface of a machine-readable file; a count it
 * states and a code it omits are both falsifiable against that file.
 *
 * @see spec/v2/core/errors.md
 * @see spec/v2/errors.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ID = 'openwop.requirement.0171.error-registry-prose-parity';
const SECTION = 'spec/v2/core/errors.md';

describe('v2-error-registry-prose-parity (RFC 0171 §B.1)', () => {
  it('errors.md states the registry count it was generated from and renders every code', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const root = join(SCHEMAS_DIR, '..');
    const registryPath = join(root, 'spec', 'v2', 'errors.json');
    const prosePath = join(root, 'spec', 'v2', 'core', 'errors.md');
    if (!existsSync(registryPath) || !existsSync(prosePath)) {
      return softSkip('inapplicable', 'the v2 error registry or its prose is absent from this layout');
    }
    const rows = (JSON.parse(readFileSync(registryPath, 'utf8')) as { rows: Array<{ code: string }> }).rows;
    const prose = readFileSync(prosePath, 'utf8');

    const missing = rows.map((r) => r.code).filter((code) => !prose.includes(`\`${code}\``));
    expect(
      missing,
      req(ID, SECTION, `every registered code MUST appear in the generated table — a host reading errors.md as the registry refuses codes the spec requires of it (${missing.length} of ${rows.length} absent: ${missing.slice(0, 5).join(', ')})`),
    ).toEqual([]);

    const claimed = [...prose.matchAll(/(\d+) codes/g)].map((m) => Number(m[1]));
    expect(
      claimed.length,
      req(ID, SECTION, 'errors.md states the registry size at least once, so the claim is checkable'),
    ).toBeGreaterThan(0);
    for (const n of claimed) {
      expect(
        n,
        req(ID, SECTION, `every count errors.md states MUST equal the registry's row count (prose says ${n}, spec/v2/errors.json has ${rows.length})`),
      ).toBe(rows.length);
    }
  });
});
