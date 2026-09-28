/**
 * RFC 0223 — the code a rejected approval gate fails with is registered, and
 * the prose that requires it names it.
 *
 * `interrupt.md` §Rejection requires a host to fail an unrouted rejected gate
 * with `approval_rejected`. overview.md §0 forbids a producer from emitting an
 * unregistered code, so the rule is only satisfiable while the registry row
 * exists. Before RFC 0223 the three v2 hosts each failed a rejected gate with a
 * code the registry did not hold. This checks the row, its prose home, and that
 * `ApprovalData.onTimeout` still declares no JSON-Schema `default` (absent means
 * `reject` by prose; a validator filling a default would record a value the
 * host never chose).
 *
 * @see spec/v2/core/interrupt.md §Rejection
 * @see spec/v2/errors.json
 * @see RFCS/0223-approval-reject-disposition.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ID = 'openwop.requirement.0223.code-registered';
const CODE = 'approval_rejected';

describe('v2-approval-reject-registered (RFC 0223)', () => {
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
    const row = rows.find((r) => r.code === CODE);
    expect(row, req(ID, 'spec/v2/errors.json', `${CODE} MUST be registered — interrupt.md §Rejection requires it and overview.md §0 forbids emitting an unregistered code`)).toBeDefined();
    expect({ httpStatus: row?.httpStatus, retriable: row?.retriable }, req(ID, 'spec/v2/errors.json', `${CODE} is a run-ending 422 that is never retried (the run_timeout precedent)`)).toEqual({ httpStatus: 422, retriable: false });

    const prose = readFileSync(prosePath, 'utf8');
    const section = prose.slice(prose.indexOf('### Rejection'));
    expect(prose.includes('### Rejection') && section.includes(`\`${CODE}\``), req(ID, 'spec/v2/core/interrupt.md §Rejection', `interrupt.md MUST carry §Rejection naming ${CODE}`)).toBe(true);

    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { $defs: { ApprovalData: { properties: { onTimeout?: Record<string, unknown> } } } };
    const onTimeout = schema.$defs.ApprovalData.properties.onTimeout;
    expect(onTimeout !== undefined && !('default' in onTimeout), req(ID, 'schemas/v2/suspend-request.schema.json ApprovalData.onTimeout', 'onTimeout MUST exist and declare no default — absent means reject by prose (RFC 0223)')).toBe(true);
  });
});
