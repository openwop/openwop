/**
 * Self-test for the RFC 0265 judges (lib/compensation-unwind.ts). Each leg has a
 * conforming host stub that passes and a sabotaged one that fails — the three
 * sabotages RFC 0265 §Conformance names (forward-order unwind, `started` before
 * `requested`, inverses re-executed on replay) among them.
 */

import { describe, expect, it } from 'vitest';
import {
  forwardCompletionOrder, judgePlanBeforeInverse, judgeReverseCompletion, splitLedger,
  judgeInverseOnce, judgeProjectionAgrees, refiredOnFork, type Ev, type LedgerRow, type Finding,
} from './compensation-unwind.js';

const allOk = (fs: readonly Finding[]): boolean => fs.every((x) => x.ok);

const LOG: Ev[] = [
  { sequence: 1, type: 'run.started' },
  { sequence: 2, type: 'node.completed', nodeId: 'e1' },
  { sequence: 3, type: 'node.completed', nodeId: 'e2' },
  { sequence: 4, type: 'node.completed', payload: { nodeId: 'e3' } },
  { sequence: 5, type: 'node.failed', nodeId: 'fail' },
  { sequence: 6, type: 'run.failed' },
  { sequence: 7, type: 'compensation.requested' },
  { sequence: 8, type: 'compensation.started' },
  { sequence: 9, type: 'node.completed', nodeId: 'e3' },
  { sequence: 10, type: 'compensation.completed' },
];

const at = (s: number): string => new Date(Date.UTC(2026, 10, 13, 0, 0, s)).toISOString();
const fwd = (n: string, s: number): LedgerRow => ({ effectId: `t/fwd-${n}-0000000000`, nodeId: n, attempt: 1, at: at(s), state: 'completed' });
const inv = (n: string, s: number, id = `t/inv-${n}-0000000000`): LedgerRow => ({ effectId: id, nodeId: n, attempt: 1, at: at(s), state: 'completed' });
const LEDGER: LedgerRow[] = [fwd('e1', 1), fwd('e2', 2), fwd('e3', 3), inv('e3', 10), inv('e2', 11), inv('e1', 12)];

describe('forwardCompletionOrder', () => {
  it('takes the first node.completed per node by sequence, reading nodeId from the envelope or the payload', () => {
    expect(forwardCompletionOrder([...LOG].reverse())).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('leg 1 — plan before first inverse', () => {
  it('requested then started passes', () => { expect(allOk(judgePlanBeforeInverse(LOG))).toBe(true); });
  it('SABOTAGE: started before requested fails', () => {
    const swapped = LOG.map((e) => (e.type === 'compensation.requested' ? { ...e, sequence: 8 } : e.type === 'compensation.started' ? { ...e, sequence: 7 } : e));
    expect(allOk(judgePlanBeforeInverse(swapped))).toBe(false);
  });
  it('a host that never unwinds cannot pass on absence', () => {
    expect(allOk(judgePlanBeforeInverse(LOG.filter((e) => !String(e.type).startsWith('compensation.'))))).toBe(false);
  });
});

describe('leg 2 — reverse-completion order', () => {
  const attempts = (ns: string[]) => ns.map((nodeId) => ({ nodeId, attempt: 1, outcome: 'succeeded', at: at(0) }));
  it('e3, e2, e1 passes; a retried node does not reorder', () => {
    expect(allOk(judgeReverseCompletion(['e1', 'e2', 'e3'], attempts(['e3', 'e2', 'e2', 'e1'])))).toBe(true);
  });
  it('SABOTAGE: a forward-order unwind fails', () => {
    expect(allOk(judgeReverseCompletion(['e1', 'e2', 'e3'], attempts(['e1', 'e2', 'e3'])))).toBe(false);
  });
  it('an incomplete attempt list fails', () => {
    expect(allOk(judgeReverseCompletion(['e1', 'e2', 'e3'], attempts(['e3', 'e2'])))).toBe(false);
  });
});

describe('leg 3 — one inverse per forward effect', () => {
  it('three inverses under the forward node ids pass', () => {
    const s = splitLedger(LEDGER);
    expect(s.missingForward).toEqual([]);
    expect(allOk(judgeInverseOnce(s))).toBe(true);
  });
  it('three inverses under host-chosen node ids pass on the count; a ledgered fail node is not an inverse', () => {
    const rows = [fwd('e1', 1), fwd('e2', 2), fwd('e3', 3), { ...fwd('fail', 4), effectId: 't/fail-00000000000' }, inv('undo-e3', 10), inv('undo-e2', 11), inv('undo-e1', 12)];
    expect(allOk(judgeInverseOnce(splitLedger(rows)))).toBe(true);
  });
  it('SABOTAGE: an unstable inverse identity (a second record for one inverse) fails', () => {
    expect(allOk(judgeInverseOnce(splitLedger([...LEDGER, inv('e2', 13, 't/inv-e2-retry-00000')])))).toBe(false);
  });
  it('SABOTAGE: an inverse executed twice under one identity fails', () => {
    expect(allOk(judgeInverseOnce(splitLedger([...LEDGER, { ...inv('e1', 14), attempt: 2 }])))).toBe(false);
  });
  it('a missing inverse fails', () => {
    expect(allOk(judgeInverseOnce(splitLedger(LEDGER.slice(0, 5))))).toBe(false);
  });
  it('no forward record (R1) reports the node as missing so the scenario blocks instead of judging', () => {
    expect(splitLedger([fwd('e1', 1)]).missingForward).toEqual(['e2', 'e3']);
    expect(splitLedger([]).missingForward).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('leg 4 — projection agrees with events', () => {
  const plan = [{ nodeId: 'e3', order: 0 }, { nodeId: 'e2', order: 1 }, { nodeId: 'e1', order: 2 }];
  it('completed with compensation.completed passes', () => {
    expect(allOk(judgeProjectionAgrees({ status: 'completed', plan, attempts: [] }, LOG))).toBe(true);
  });
  it('SABOTAGE: a projection that reads completed with no compensation.completed in the log fails', () => {
    expect(allOk(judgeProjectionAgrees({ status: 'completed', plan, attempts: [] }, LOG.filter((e) => e.type !== 'compensation.completed')))).toBe(false);
  });
  it('a projection that reads none after the log says completed fails, as does an empty plan', () => {
    expect(allOk(judgeProjectionAgrees({ status: 'none', plan, attempts: [] }, LOG))).toBe(false);
    expect(allOk(judgeProjectionAgrees({ status: 'completed', plan: [], attempts: [] }, LOG))).toBe(false);
  });
});

describe('leg 5 — replay does not re-fire', () => {
  it('an empty per-run fork ledger and an inherited-history ledger both pass', () => {
    expect(refiredOnFork(LEDGER, [])).toEqual([]);
    expect(refiredOnFork(LEDGER, [...LEDGER])).toEqual([]);
  });
  it('SABOTAGE: a fork that re-executes the inverses fails, whether it projects history or not', () => {
    const again = [inv('e3', 30), inv('e2', 31), inv('e1', 32)];
    expect(refiredOnFork(LEDGER, again)).toHaveLength(3);
    expect(refiredOnFork(LEDGER, [...LEDGER, ...again])).toHaveLength(3);
  });
});
