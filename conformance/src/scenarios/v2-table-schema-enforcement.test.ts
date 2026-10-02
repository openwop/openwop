/**
 * v2 — a `tableStorage` row MUST conform to the table's declared schema
 * (`spec/v2/core/storage.md` §`tableStorage`). The v1 twin is
 * `table-schema-enforcement`, which drives the `/v1/host/sample/test/surface`
 * seam; this port is unaided, through the `conformance-table-schema-probe`
 * fixture. The logic is `lib/table-schema-witness.ts`.
 *
 *   control          a well-typed insert into `{ k: string, n: number }`
 *                    completes (the positive control).
 *   insert-mistyped  an insert with `n: "not-a-number"` fails the probe node
 *                    `validation_error`, `details.service: tableStorage`.
 *   update-mistyped  an update setting `n` to a string fails the same way.
 *
 * The refusal code is v2's: RFC 0228 maps v1's `table_schema_violation` to
 * `validation_error`, and a generic code carries `details.service`
 * (`errors.md` §Host-service refusals).
 *
 * Dispositions: `tableStorage` not in the v2 root, or the fixture not
 * advertised ⇒ `inapplicable`. The fixture is the opt-in, as for the budget
 * and safeFetch witnesses. A fixture run that cannot be created or read ⇒
 * `blocked`. A failed control ⇒ the control row fails and the two refusal
 * rows are not asserted, since a host that refuses every insert would pass
 * them vacuously.
 *
 * Proven both ways against the scratch host in
 * `lib/table-schema-witness.test.ts`.
 *
 * @see spec/v2/core/storage.md §tableStorage
 * @see conformance/fixtures.md §The tableStorage schema probe fixture
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { drive, judge, type TableFinding, type TableRun } from '../lib/table-schema-witness.js';

const ID_CONTROL = 'openwop.requirement.storage.table-schema-control-insert-completes';
const ID_INSERT = 'openwop.requirement.storage.table-schema-insert-mistyped-refused';
const ID_UPDATE = 'openwop.requirement.storage.table-schema-update-mistyped-refused';

/** One set of probe runs per file: the three legs read it. */
let once: Promise<TableRun> | undefined;
function tableRun(): Promise<TableRun> {
  once ??= (async (): Promise<TableRun> => {
    let doc: Record<string, unknown> | null;
    try { doc = await v2Discovery(); } catch { doc = null; }
    if (!doc) return { kind: 'skip', disposition: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
    return drive(doc);
  })();
  return once;
}

type Leg = { readonly skip: readonly ['inapplicable' | 'blocked', string] } | { readonly finding: TableFinding };
async function leg(rule: TableFinding['rule']): Promise<Leg> {
  const r = await tableRun();
  if (r.kind === 'skip') return { skip: [r.disposition, r.reason] };
  const findings = judge(r.outcomes);
  const control = findings.find((f) => f.rule === 'control')!;
  if (rule !== 'control' && !control.ok) return { skip: ['blocked', `the control insert did not complete, so a refusal here would prove nothing (${control.message})`] };
  return { finding: findings.find((f) => f.rule === rule)! };
}

describe('v2 tableStorage schema enforcement (storage.md §tableStorage)', () => {
  it('a well-typed insert completes (positive control)', async () => {
    const l = await leg('control');
    if ('skip' in l) return softSkip(...l.skip);
    expect(l.finding.ok, req(ID_CONTROL, l.finding.doc, l.finding.message)).toBe(true);
  }, 120_000);

  it('an insert whose column type diverges from the schema is refused validation_error', async () => {
    const l = await leg('insert-mistyped');
    if ('skip' in l) return softSkip(...l.skip);
    expect(l.finding.ok, req(ID_INSERT, l.finding.doc, l.finding.message)).toBe(true);
  }, 120_000);

  it('an update whose column type diverges from the schema is refused validation_error', async () => {
    const l = await leg('update-mistyped');
    if ('skip' in l) return softSkip(...l.skip);
    expect(l.finding.ok, req(ID_UPDATE, l.finding.doc, l.finding.message)).toBe(true);
  }, 120_000);
});
