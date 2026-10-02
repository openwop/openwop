/**
 * The tableStorage schema witness, proven in both directions against the
 * scratch host. No host advertises `tableStorage` at major 2, so each case
 * turns on one defect.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { drive, judge, NODE_ID, TABLE_FIXTURE, type ProbeAction, type TableFinding } from './table-schema-witness.js';
import { setAdvertisedFixtures } from './fixtures.js';
import { majorProfile } from './major-profile.js';
import { ScratchHost, type ScriptedRun } from './scratch-host.js';

const V2 = majorProfile(2);
const DOC = { tableStorage: { status: 'stable', since: '2.0', witness: 'witnessable-gated' } };

const completed: ScriptedRun = { status: 'completed', events: [{ type: 'node.completed', payload: { nodeId: NODE_ID, outputs: { result: { inserted: true, rowId: 'r1' } } } }] };
const refusedWith = (code: string, details: Record<string, unknown>): ScriptedRun => ({
  status: 'failed',
  error: { code, message: code },
  events: [{ type: 'node.failed', payload: { nodeId: NODE_ID, error: { code, message: code, details } } }],
});
const refused = refusedWith('validation_error', { service: 'tableStorage', reason: 'schema-mismatch' });

const host = new ScratchHost({ profile: V2, discovery: DOC });
const seen: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  vi.stubEnv('OPENWOP_BASE_URL', await host.start());
  vi.stubEnv('OPENWOP_API_KEY', 'k');
  vi.stubEnv('OPENWOP_TARGET_MAJOR', '2');
  setAdvertisedFixtures({ fixtures: [TABLE_FIXTURE] });
});
afterAll(async () => { await host.stop(); });

async function run(byAction: Partial<Record<ProbeAction, ScriptedRun>>, doc: Record<string, unknown> = DOC): Promise<TableFinding[] | string> {
  seen.length = 0;
  host.reconfigure({
    discovery: doc,
    script: (_w, body) => {
      seen.push({ ...body });
      const action = (body['inputs'] as { action?: ProbeAction } | undefined)?.action ?? 'control';
      return byAction[action] ?? { status: 'running', events: [] };
    },
  });
  const r = await drive(doc, 1_000);
  if (r.kind === 'skip') return `${r.disposition}: ${r.reason}`;
  return judge(r.outcomes);
}
const failed = (r: TableFinding[] | string): string[] => (typeof r === 'string' ? [r] : r.filter((f) => !f.ok).map((f) => f.rule));
const conforming = { control: completed, 'insert-mistyped': refused, 'update-mistyped': refused };

describe('table schema witness against the scratch host (major 2)', () => {
  it('a conforming host passes all three rules, and each run names the fixture, its action and a fresh table', async () => {
    expect(failed(await run(conforming))).toEqual([]);
    expect(seen.map((b) => (b['inputs'] as { action: string }).action)).toEqual(['control', 'insert-mistyped', 'update-mistyped']);
    for (const b of seen) expect(b['workflowId']).toBe(TABLE_FIXTURE);
    const tables = seen.map((b) => (b['inputs'] as { table: string }).table);
    expect(new Set(tables).size).toBe(3);
    for (const t of tables) expect(t).toMatch(/^conformance_schema_[0-9a-f]{16}$/);
  });

  it('a host that accepts a mistyped insert fails the insert rule only', async () => {
    expect(failed(await run({ ...conforming, 'insert-mistyped': completed }))).toEqual(['insert-mistyped']);
  });

  it('a host that accepts a mistyped update fails the update rule only', async () => {
    expect(failed(await run({ ...conforming, 'update-mistyped': completed }))).toEqual(['update-mistyped']);
  });

  it('v1\'s table_schema_violation is not the v2 code', async () => {
    const v1code = refusedWith('table_schema_violation', { service: 'tableStorage' });
    expect(failed(await run({ ...conforming, 'insert-mistyped': v1code, 'update-mistyped': v1code }))).toEqual(['insert-mistyped', 'update-mistyped']);
  });

  it('validation_error without details.service fails, and names the errors.md rule', async () => {
    const r = await run({ ...conforming, 'insert-mistyped': refusedWith('validation_error', {}) });
    expect(failed(r)).toEqual(['insert-mistyped']);
    expect((r as TableFinding[]).find((f) => f.rule === 'insert-mistyped')!.doc).toBe('spec/v2/core/errors.md §Host-service refusals');
  });

  it('a host whose probe refuses everything fails the control, which is what keeps the refusal rows from passing vacuously', async () => {
    expect(failed(await run({ control: refused, 'insert-mistyped': refused, 'update-mistyped': refused }))).toEqual(['control']);
  });

  it('no tableStorage, or no fixture, is inapplicable and starts no run', async () => {
    expect(await run(conforming, {})).toMatch(/^inapplicable: tableStorage is not advertised/);
    setAdvertisedFixtures({ fixtures: [] });
    try {
      expect(await run(conforming)).toMatch(/^inapplicable: conformance-table-schema-probe fixture not advertised/);
    } finally {
      setAdvertisedFixtures({ fixtures: [TABLE_FIXTURE] });
    }
    expect(seen).toEqual([]);
  });

  it('a run that never ends is blocked, not failed', async () => {
    expect(await run({ ...conforming, 'update-mistyped': { status: 'running', events: [] } })).toMatch(/^blocked: the update-mistyped run did not reach a terminal status/);
  });
});
