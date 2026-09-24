/**
 * RFC 0208 §A — `openwop.requirement.0208.map-coherent`: the A2A/MCP operation
 * map (`spec/v2/interop-map.json`) agrees with the v2 wire it maps onto.
 *
 * Runs in the corpus gate (scripts/check-spec-coherence.mjs), never in a host
 * bundle: it spawns `scripts/check-interop-map.mjs` and records the verdict
 * under the RFC's `(corpus)` requirement id, so `evidence/corpus-ledger.json`
 * carries the row the falsifiability table names.
 *
 * An exit-0 wrapper around a gate that is already green witnesses nothing, so
 * the same `it` also feeds the gate eleven sabotaged copies of the map — each one
 * a defect the gate exists to catch — and asserts every one is REFUSED. The
 * copies are written to a scratch directory (`--map`); the tracked file is never
 * mutated.
 *
 * @see RFCS/0208-v2-a2a-mcp-operation-mappings.md §A, Falsifiability
 * @see scripts/check-interop-map.mjs
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ROOT = join(SCHEMAS_DIR, '..');
const ID = 'openwop.requirement.0208.map-coherent';
const DOC = 'RFCS/0208 §A; spec/v2/core/interop.md §"The operation mappings"';
const GATE = join(ROOT, 'scripts', 'check-interop-map.mjs');

interface Row { http?: string; runStatus?: string; v2Operation?: string | null; upstream?: string; clientProjection?: string; requires?: string[]; reason?: string }
interface MapDoc { a2a: { operations: Row[]; taskState: Row[]; errors: Row[] }; mcp: { tasks: { status: Row[]; methods: Row[] } } }

const run = (args: string[] = []): { status: number | null; out: string } => {
  const r = spawnSync('node', [GATE, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const SABOTAGE: Array<[string, (m: MapDoc) => void, RegExp]> = [
  ['the paused taskState row deleted', (m) => { m.a2a.taskState = m.a2a.taskState.filter((r) => r.runStatus !== 'paused'); }, /`paused` has 0 default row/],
  ['getRun renamed getRunX', (m) => { for (const r of m.a2a.operations) if (r.v2Operation === 'getRun') r.v2Operation = 'getRunX'; }, /getRunX` is not an operationId/],
  ['a clientProjection that is no errors.json code', (m) => { m.a2a.errors[0]!.clientProjection = 'nope'; }, /`nope` is not a code/],
  ['requires naming a facet the family does not have', (m) => { const sub = m.a2a.operations.find((r) => r.upstream === 'SubscribeToTask')!; sub.requires = ['a2a.durable']; }, /`durable` is not a property/],
  ['a tenth A2A error', (m) => { m.a2a.errors.push({ ...m.a2a.errors[0]!, upstream: 'BogusError' }); }, /`BogusError` is not one of the nine/],
  // RFC 0198: the mcp.tasks rows are held to the same wire.
  ['the waiting-external mcp.tasks.status row deleted', (m) => { m.mcp.tasks.status = m.mcp.tasks.status.filter((r) => r.runStatus !== 'waiting-external'); }, /mcp\.tasks\.status: run status `waiting-external` has 0 default row/],
  ['tasks/update mapped to resolveInterrupt', (m) => { for (const r of m.mcp.tasks.methods) if (r.upstream === 'tasks/update') r.v2Operation = 'resolveInterrupt'; }, /tasks\/update: v2Operation `resolveInterrupt` is not an operationId/],
  ['ContentTypeNotSupportedError removed', (m) => { m.a2a.errors = m.a2a.errors.filter((e) => e.upstream !== 'ContentTypeNotSupportedError'); }, /`ContentTypeNotSupportedError` has 0 row/],
  // 2.36.2: the `http` column is held to the vendored A2A v1.0.1 proto.
  ['GetTask bound to POST', (m) => { m.a2a.operations.find((r) => r.upstream === 'GetTask')!.http = 'POST /tasks/{id}'; }, /GetTask: verb POST ≠ proto GET/],
  ['GetTask path misspelled', (m) => { m.a2a.operations.find((r) => r.upstream === 'GetTask')!.http = 'GET /task/{id}'; }, /GetTask: path `\/task\/\{id\}` ≠ proto/],
  ['the GetExtendedAgentCard row deleted', (m) => { m.a2a.operations = m.a2a.operations.filter((r) => r.upstream !== 'GetExtendedAgentCard'); }, /proto rpc GetExtendedAgentCard has an HTTP binding but no row covers it/],
  // RFC 0211 §A: every named A2A error carries its ErrorInfo reason.
  ['TaskNotFoundError reason misspelled', (m) => { m.a2a.errors.find((e) => e.upstream === 'TaskNotFoundError')!.reason = 'TASK_NOTFOUND'; }, /TaskNotFoundError: reason MUST be TASK_NOT_FOUND/],
  ['VersionNotSupportedError reason removed', (m) => { delete m.a2a.errors.find((e) => e.upstream === 'VersionNotSupportedError')!.reason; }, /VersionNotSupportedError: reason MUST be VERSION_NOT_SUPPORTED/],
  ['a reason on the invalid-parameters row', (m) => { m.a2a.errors.find((e) => e.upstream === '(invalid parameters)')!.reason = 'INVALID_PARAMETERS'; }, /\(invalid parameters\): a parenthesized \(non-A2A\) row MUST NOT carry a reason/],
];

describe('RFC 0208 §A — v2 interop map coherence (corpus gate)', () => {
  it('the map agrees with the v2 wire, and the gate refuses each defect it exists to catch', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout — the gate script and api/v2 live in the corpus repository');
    const clean = run();
    expect(clean.status, req(ID, DOC, `check-interop-map.mjs MUST pass on the committed map: ${clean.out.slice(-600)}`)).toBe(0);
    const base = readFileSync(join(ROOT, 'spec', 'v2', 'interop-map.json'), 'utf8');
    const dir = mkdtempSync(join(tmpdir(), 'openwop-0208-sabotage-'));
    try {
      for (const [label, mutate, expected] of SABOTAGE) {
        const m = JSON.parse(base) as MapDoc;
        mutate(m);
        const p = join(dir, 'map.json');
        writeFileSync(p, JSON.stringify(m));
        const r = run(['--map', p]);
        expect([r.status, expected.test(r.out)], req(ID, DOC, `sabotage "${label}" MUST be refused with its named reason (exit 1); got exit ${String(r.status)}: ${r.out.slice(-400)}`)).toEqual([1, true]);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
