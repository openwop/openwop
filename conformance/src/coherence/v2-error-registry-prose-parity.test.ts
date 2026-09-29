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
 * RFC 0223 adds a second leg: `approval_rejected`, the code `interrupt.md`
 * §Rejection requires, is registered as a non-retriable 422 and named by that
 * section, and `ApprovalData.onTimeout` declares no JSON-Schema `default`
 * (absent means `reject` by prose; a validator filling a default would record a
 * value the host never chose).
 *
 * RFC 0227: the table moved to spec/v2/generated/error-codes.md (a generated
 * restatement, outside the budgeted kernel). The row now checks that errors.md
 * links it and that it holds every code — the same guarantee, at its new home.
 *
 * @see spec/v2/core/errors.md
 * @see spec/v2/generated/error-codes.md
 * @see spec/v2/errors.json
 * @see spec/v2/core/interrupt.md §Rejection
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ID = 'openwop.requirement.0171.error-registry-prose-parity';
const SECTION = 'spec/v2/core/errors.md';
const ID_0223 = 'openwop.requirement.0223.code-registered';
const CODE_0223 = 'approval_rejected';

describe('v2-error-registry-prose-parity (RFC 0171 §B.1)', () => {
  it('errors.md states the registry count and links the generated table, which renders every code', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const root = join(SCHEMAS_DIR, '..');
    const registryPath = join(root, 'spec', 'v2', 'errors.json');
    const prosePath = join(root, 'spec', 'v2', 'core', 'errors.md');
    const tablePath = join(root, 'spec', 'v2', 'generated', 'error-codes.md');
    if (!existsSync(registryPath) || !existsSync(prosePath)) {
      return softSkip('inapplicable', 'the v2 error registry or its prose is absent from this layout');
    }
    const rows = (JSON.parse(readFileSync(registryPath, 'utf8')) as { rows: Array<{ code: string }> }).rows;
    const prose = readFileSync(prosePath, 'utf8');

    // The table is a generated restatement of the registry and lives outside the
    // budgeted kernel (RFC 0190 §A as amended). The property this row protects is
    // unchanged: a host reading the spec finds every registered code. errors.md
    // must lead to the table, and the table must hold every code.
    expect(
      prose.includes('](../generated/error-codes.md)'),
      req(ID, SECTION, 'errors.md MUST link the generated code table (spec/v2/generated/error-codes.md), so a reader of the spec reaches every registered code'),
    ).toBe(true);
    expect(existsSync(tablePath), req(ID, 'spec/v2/generated/error-codes.md', 'the generated code table MUST exist beside the registry it restates')).toBe(true);
    const table = existsSync(tablePath) ? readFileSync(tablePath, 'utf8') : '';
    const missing = rows.map((r) => r.code).filter((code) => !table.includes(`\`${code}\``));
    expect(
      missing,
      req(ID, 'spec/v2/generated/error-codes.md', `every registered code MUST appear in the generated table — a host reading the spec as the registry refuses codes the spec requires of it (${missing.length} of ${rows.length} absent: ${missing.slice(0, 5).join(', ')})`),
    ).toEqual([]);

    const claimed = [...prose.matchAll(/(\d+) codes/g), ...table.matchAll(/(\d+) codes/g)].map((m) => Number(m[1]));
    expect(
      claimed.length,
      req(ID, SECTION, 'errors.md and the generated table state the registry size, so the claim is checkable'),
    ).toBeGreaterThan(1);
    for (const n of claimed) {
      expect(
        n,
        req(ID, SECTION, `every count errors.md or the generated table states MUST equal the registry's row count (says ${n}, spec/v2/errors.json has ${rows.length})`),
      ).toBe(rows.length);
    }
  });
});

describe('v2-error-registry-prose-parity — RFC 0223 approval_rejected', () => {
  it('approval_rejected is a registered 422, not retriable, and interrupt.md §Rejection names it', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const root = join(SCHEMAS_DIR, '..');
    const registryPath = join(root, 'spec', 'v2', 'errors.json');
    const prosePath = join(root, 'spec', 'v2', 'core', 'interrupt.md');
    const schemaPath = join(SCHEMAS_DIR, 'v2', 'suspend-request.schema.json');
    if (!existsSync(registryPath) || !existsSync(prosePath) || !existsSync(schemaPath)) {
      return softSkip('inapplicable', 'the v2 registry, interrupt.md or suspend-request.schema.json is absent from this layout');
    }
    const rows = (JSON.parse(readFileSync(registryPath, 'utf8')) as { rows: Array<{ code: string; httpStatus: number; retriable: boolean }> }).rows;
    const row = rows.find((r) => r.code === CODE_0223);
    expect(row, req(ID_0223, 'spec/v2/errors.json', `${CODE_0223} MUST be registered — interrupt.md §Rejection requires it and overview.md §0 forbids emitting an unregistered code`)).toBeDefined();
    expect({ httpStatus: row?.httpStatus, retriable: row?.retriable }, req(ID_0223, 'spec/v2/errors.json', `${CODE_0223} is a run-ending 422 that is never retried (the run_timeout precedent)`)).toEqual({ httpStatus: 422, retriable: false });

    const prose = readFileSync(prosePath, 'utf8');
    const section = prose.slice(prose.indexOf('### Rejection'));
    expect(prose.includes('### Rejection') && section.includes(`\`${CODE_0223}\``), req(ID_0223, 'spec/v2/core/interrupt.md §Rejection', `interrupt.md MUST carry §Rejection naming ${CODE_0223}`)).toBe(true);

    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { $defs: { ApprovalData: { properties: { onTimeout?: Record<string, unknown> } } } };
    const onTimeout = schema.$defs.ApprovalData.properties.onTimeout;
    expect(onTimeout !== undefined && !('default' in onTimeout), req(ID_0223, 'schemas/v2/suspend-request.schema.json ApprovalData.onTimeout', 'onTimeout MUST exist and declare no default — absent means reject by prose (RFC 0223)')).toBe(true);
  });
});
