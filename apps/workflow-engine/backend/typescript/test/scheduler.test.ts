/**
 * Pure-function tests for the DAG scheduler. Covers:
 *   - topologicalOrder (stable order + cycle detection)
 *   - evaluateTrigger (all 5 triggerRules)
 *   - evaluateCondition
 *   - buildNodeInputs port-wiring
 *   - inspectDisposition (terminal completed / failed / waiting)
 */

import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  buildNodeInputs,
  evaluateCondition,
  evaluateTrigger,
  freshSnapshot,
  inspectDisposition,
  markCompleted,
  markFailed,
  markSuspended,
  popReady,
  releaseDownstream,
  topologicalOrder,
} from '../src/executor/scheduler.js';
import type { WorkflowDefinition } from '../src/executor/types.js';

function defOf(
  nodes: ReadonlyArray<{ nodeId: string; typeId: string }>,
  edges: ReadonlyArray<{ from: string; to: string; rule?: 'all_success' | 'any_success' | 'all_complete' | 'none_failed' | 'any_failed' }>,
): WorkflowDefinition {
  return {
    workflowId: 'test',
    nodes,
    edges: edges.map((e, i) => ({
      edgeId: `e${i}`,
      sourceNodeId: e.from,
      targetNodeId: e.to,
      ...(e.rule ? { triggerRule: e.rule } : {}),
    })),
  };
}

describe('topologicalOrder', () => {
  it('returns source-first order for a linear chain', () => {
    const d = defOf(
      [{ nodeId: 'a', typeId: 't' }, { nodeId: 'b', typeId: 't' }, { nodeId: 'c', typeId: 't' }],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    );
    expect(topologicalOrder(d, buildGraph(d))).toEqual(['a', 'b', 'c']);
  });

  it('handles fan-out: a → {b, c} then merge into d', () => {
    const d = defOf(
      [
        { nodeId: 'a', typeId: 't' },
        { nodeId: 'b', typeId: 't' },
        { nodeId: 'c', typeId: 't' },
        { nodeId: 'd', typeId: 't' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
      ],
    );
    const order = topologicalOrder(d, buildGraph(d));
    expect(order[0]).toBe('a');
    expect(order[3]).toBe('d');
    expect(new Set(order.slice(1, 3))).toEqual(new Set(['b', 'c']));
  });

  it('throws cycle_detected on a cyclic graph', () => {
    const d = defOf(
      [{ nodeId: 'a', typeId: 't' }, { nodeId: 'b', typeId: 't' }, { nodeId: 'c', typeId: 't' }],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
    );
    expect(() => topologicalOrder(d, buildGraph(d))).toThrow(/cycle/i);
  });
});

describe('evaluateTrigger — all 5 rules', () => {
  // Two upstreams a, b → target c. Tweak per-rule.
  function setup(rule: 'all_success' | 'any_success' | 'all_complete' | 'none_failed' | 'any_failed') {
    const d = defOf(
      [{ nodeId: 'a', typeId: 't' }, { nodeId: 'b', typeId: 't' }, { nodeId: 'c', typeId: 't' }],
      [{ from: 'a', to: 'c', rule }, { from: 'b', to: 'c', rule }],
    );
    return { graph: buildGraph(d), snapshot: freshSnapshot(d) };
  }

  it('all_success: waits for both, then ready', () => {
    const { graph, snapshot } = setup('all_success');
    expect(evaluateTrigger('c', graph, snapshot)).toBe('wait');
    markCompleted('a', { output: 1 }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('wait');
    markCompleted('b', { output: 2 }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('ready');
  });

  it('all_success: skips if any failed', () => {
    const { graph, snapshot } = setup('all_success');
    markCompleted('a', { output: 1 }, snapshot);
    markFailed('b', { code: 'x', message: 'boom' }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('skip');
  });

  it('any_success: fires on first success', () => {
    const { graph, snapshot } = setup('any_success');
    expect(evaluateTrigger('c', graph, snapshot)).toBe('wait');
    markCompleted('a', { output: 1 }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('ready');
  });

  it('any_success: skips when all upstream failed', () => {
    const { graph, snapshot } = setup('any_success');
    markFailed('a', { code: 'x', message: 'boom' }, snapshot);
    markFailed('b', { code: 'x', message: 'boom' }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('skip');
  });

  it('all_complete: fires when all terminal regardless of outcome', () => {
    const { graph, snapshot } = setup('all_complete');
    markFailed('a', { code: 'x', message: 'boom' }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('wait');
    markCompleted('b', { output: 2 }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('ready');
  });

  it('none_failed: fires when all completed without failure', () => {
    const { graph, snapshot } = setup('none_failed');
    markCompleted('a', { output: 1 }, snapshot);
    markCompleted('b', { output: 2 }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('ready');
  });

  it('none_failed: skips on any failure', () => {
    const { graph, snapshot } = setup('none_failed');
    markFailed('a', { code: 'x', message: 'boom' }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('skip');
  });

  it('any_failed: fires on first failure (error-routing)', () => {
    const { graph, snapshot } = setup('any_failed');
    expect(evaluateTrigger('c', graph, snapshot)).toBe('wait');
    markFailed('a', { code: 'x', message: 'boom' }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('ready');
  });

  it('any_failed: skips when no upstream fails', () => {
    const { graph, snapshot } = setup('any_failed');
    markCompleted('a', { output: 1 }, snapshot);
    markCompleted('b', { output: 2 }, snapshot);
    expect(evaluateTrigger('c', graph, snapshot)).toBe('skip');
  });
});

describe('evaluateCondition', () => {
  it('eq matches identical primitives', () => {
    expect(evaluateCondition({ path: 'k', op: 'eq', value: 'v' }, { k: 'v' })).toBe(true);
    expect(evaluateCondition({ path: 'k', op: 'eq', value: 'v' }, { k: 'other' })).toBe(false);
  });
  it('truthy / falsy work', () => {
    expect(evaluateCondition({ path: 'k', op: 'truthy' }, { k: 1 })).toBe(true);
    expect(evaluateCondition({ path: 'k', op: 'falsy' }, { k: 0 })).toBe(true);
  });
  it('exists vs absent', () => {
    expect(evaluateCondition({ path: 'k', op: 'exists' }, { k: '' })).toBe(true);
    expect(evaluateCondition({ path: 'k', op: 'exists' }, {})).toBe(false);
  });
  it('contains: string + array', () => {
    expect(evaluateCondition({ path: 'k', op: 'contains', value: 'foo' }, { k: 'foobar' })).toBe(true);
    expect(evaluateCondition({ path: 'k', op: 'contains', value: 2 }, { k: [1, 2, 3] })).toBe(true);
  });
  it('resolves nested paths', () => {
    expect(evaluateCondition({ path: 'a.b.c', op: 'eq', value: 7 }, { a: { b: { c: 7 } } })).toBe(true);
  });
});

describe('buildNodeInputs', () => {
  it('source node gets run.inputs on its `input` port', () => {
    const d = defOf([{ nodeId: 'a', typeId: 't' }], []);
    const inputs = buildNodeInputs('a', buildGraph(d), freshSnapshot(d), { hello: 'world' });
    expect(inputs.input).toEqual({ hello: 'world' });
  });

  it('downstream node receives upstream outputs by port name', () => {
    const d = defOf(
      [{ nodeId: 'a', typeId: 't' }, { nodeId: 'b', typeId: 't' }],
      [{ from: 'a', to: 'b' }],
    );
    const graph = buildGraph(d);
    const snapshot = freshSnapshot(d);
    markCompleted('a', { output: 42 }, snapshot);
    const inputs = buildNodeInputs('b', graph, snapshot, null);
    expect(inputs.input).toBe(42);
  });

  it('skips contributions from failed upstreams', () => {
    const d = defOf(
      [{ nodeId: 'a', typeId: 't' }, { nodeId: 'b', typeId: 't' }, { nodeId: 'c', typeId: 't' }],
      [
        { from: 'a', to: 'c', rule: 'all_complete' },
        { from: 'b', to: 'c', rule: 'all_complete' },
      ],
    );
    const graph = buildGraph(d);
    const snapshot = freshSnapshot(d);
    markCompleted('a', { output: 1 }, snapshot);
    markFailed('b', { code: 'x', message: 'boom' }, snapshot);
    const inputs = buildNodeInputs('c', graph, snapshot, null);
    // Single completed upstream contributes; failed upstream's port is absent.
    expect(Object.keys(inputs)).toEqual(['input']);
  });
});

describe('releaseDownstream', () => {
  it('flips ready when triggerRule is satisfied', () => {
    const d = defOf(
      [{ nodeId: 'a', typeId: 't' }, { nodeId: 'b', typeId: 't' }],
      [{ from: 'a', to: 'b' }],
    );
    const graph = buildGraph(d);
    const snapshot = freshSnapshot(d);
    // b starts pending.
    expect(snapshot.nodeState.get('b')).toBe('pending');
    markCompleted('a', { output: 1 }, snapshot);
    releaseDownstream('a', graph, snapshot);
    expect(snapshot.nodeState.get('b')).toBe('ready');
  });

  it('propagates skip when failure flows through any_success', () => {
    const d = defOf(
      [
        { nodeId: 'a', typeId: 't' },
        { nodeId: 'b', typeId: 't' },
        { nodeId: 'c', typeId: 't' },
      ],
      [
        { from: 'a', to: 'b', rule: 'any_success' },
        { from: 'b', to: 'c' },
      ],
    );
    const graph = buildGraph(d);
    const snapshot = freshSnapshot(d);
    markFailed('a', { code: 'x', message: 'boom' }, snapshot);
    releaseDownstream('a', graph, snapshot);
    expect(snapshot.nodeState.get('b')).toBe('skipped');
    expect(snapshot.nodeState.get('c')).toBe('skipped');
  });
});

describe('inspectDisposition', () => {
  it('reports done:completed when all nodes complete', () => {
    const d = defOf(
      [{ nodeId: 'a', typeId: 't' }, { nodeId: 'b', typeId: 't' }],
      [{ from: 'a', to: 'b' }],
    );
    const graph = buildGraph(d);
    const snapshot = freshSnapshot(d);
    markCompleted('a', { output: 1 }, snapshot);
    markCompleted('b', { output: 2 }, snapshot);
    const disp = inspectDisposition(snapshot, graph, 0);
    expect(disp).toEqual({ done: true, status: 'completed' });
  });

  it('reports done:waiting when a branch is suspended', () => {
    const d = defOf(
      [{ nodeId: 'a', typeId: 't' }, { nodeId: 'b', typeId: 't' }],
      [{ from: 'a', to: 'b' }],
    );
    const graph = buildGraph(d);
    const snapshot = freshSnapshot(d);
    markCompleted('a', { output: 1 }, snapshot);
    snapshot.nodeState.set('b', 'ready');
    markSuspended('b', snapshot);
    const disp = inspectDisposition(snapshot, graph, 0);
    expect(disp.done).toBe(true);
    expect(disp.status).toBe('waiting');
    expect(disp.suspendedNodeId).toBe('b');
  });

  it('reports done:failed when a node fails and no all_complete rescues', () => {
    const d = defOf(
      [{ nodeId: 'a', typeId: 't' }, { nodeId: 'b', typeId: 't' }],
      [{ from: 'a', to: 'b' }],
    );
    const graph = buildGraph(d);
    const snapshot = freshSnapshot(d);
    markFailed('a', { code: 'x', message: 'boom' }, snapshot);
    releaseDownstream('a', graph, snapshot);
    const disp = inspectDisposition(snapshot, graph, 0);
    expect(disp.done).toBe(true);
    expect(disp.status).toBe('failed');
  });
});

describe('popReady — concurrency cap honored', () => {
  it('caps to requested count', () => {
    const d = defOf(
      [
        { nodeId: 'a', typeId: 't' },
        { nodeId: 'b', typeId: 't' },
        { nodeId: 'c', typeId: 't' },
        { nodeId: 'd', typeId: 't' },
      ],
      [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'a', to: 'd' },
      ],
    );
    const graph = buildGraph(d);
    const snapshot = freshSnapshot(d);
    markCompleted('a', { output: 1 }, snapshot);
    releaseDownstream('a', graph, snapshot);
    // All three of b, c, d are now ready.
    const batch1 = popReady(2, snapshot);
    expect(batch1).toHaveLength(2);
    expect(snapshot.nodeState.get(batch1[0]!)).toBe('running');
    const batch2 = popReady(2, snapshot);
    expect(batch2).toHaveLength(1);
  });
});
