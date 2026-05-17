/**
 * core.openwop.flow — spec-canonical flow-control primitives.
 *
 * 25 nodes covering branching, merging, iteration, aggregation,
 * batching, sorting, deduplication, repetition, suspension,
 * sub-workflow invocation, and Make-style error handlers.
 *
 * All nodes are pure or suspending — no external I/O.
 * Side-effects are limited to suspending or terminating the run.
 *
 * @see spec/v1/node-packs.md
 * @see spec/v1/interrupt.md
 * @see spec/v1/replay.md
 */

/* ─── Helpers ─────────────────────────────────────────────────── */

function resolvePath(obj, path) {
  if (!path) return obj;
  const segs = path.split('.');
  let cur = obj;
  for (const s of segs) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[s];
  }
  return cur;
}

function canonical(v) {
  return JSON.stringify(v);
}

const TEMPLATE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;
function applyTemplate(tmpl, ctx) {
  return tmpl.replace(TEMPLATE_RE, (_, k) => {
    const v = resolvePath(ctx, k);
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
}

function evalPredicate(value, op, target) {
  switch (op) {
    case 'eq': return canonical(value) === canonical(target);
    case 'neq': return canonical(value) !== canonical(target);
    case 'lt': return value < target;
    case 'lte': return value <= target;
    case 'gt': return value > target;
    case 'gte': return value >= target;
    case 'in': return Array.isArray(target) && target.some((t) => canonical(t) === canonical(value));
    case 'contains': return typeof value === 'string' ? value.includes(String(target))
      : Array.isArray(value) ? value.some((v) => canonical(v) === canonical(target)) : false;
    case 'starts-with': return typeof value === 'string' && value.startsWith(String(target));
    case 'ends-with': return typeof value === 'string' && value.endsWith(String(target));
    case 'regex': return typeof value === 'string' && new RegExp(target).test(value);
    case 'exists': return value !== undefined && value !== null;
    case 'not-exists': return value === undefined || value === null;
    case 'truthy': return Boolean(value);
    case 'falsy': return !value;
    default:
      throw Object.assign(new Error(`unknown predicate op: ${op}`), { code: 'CONFIG_INVALID' });
  }
}

function runPredicate(predicate, item) {
  const v = resolvePath(item, predicate.path);
  return evalPredicate(v, predicate.op, predicate.value);
}

/* ─── Branching ───────────────────────────────────────────────── */

export async function ifNode(ctx) {
  const matched = runPredicate(ctx.config.predicate, ctx.inputs.value);
  return {
    status: 'success',
    outputs: {
      branch: matched ? 'then' : 'else',
      matched,
      value: ctx.inputs.value,
    },
  };
}

export async function switchNode(ctx) {
  const v = ctx.inputs.value;
  const key = canonical(v);
  const cases = ctx.config.cases || {};
  let label = ctx.config.default ?? null;
  for (const [caseKey, caseLabel] of Object.entries(cases)) {
    if (caseKey === key || caseKey === String(v)) {
      label = caseLabel;
      break;
    }
  }
  return {
    status: 'success',
    outputs: { label, matched: label !== null, value: v },
  };
}

export async function routerNode(ctx) {
  const item = ctx.inputs.value;
  const routes = ctx.config.routes || [];
  const mode = ctx.config.mode || 'first-match';
  const matches = [];
  for (const route of routes) {
    if (!route.predicate || runPredicate(route.predicate, item)) {
      matches.push(route.label);
      if (mode === 'first-match') break;
    }
  }
  if (matches.length === 0 && ctx.config.defaultLabel) matches.push(ctx.config.defaultLabel);
  return {
    status: 'success',
    outputs: { branches: matches, value: item },
  };
}

export async function filterNode(ctx) {
  const passed = runPredicate(ctx.config.predicate, ctx.inputs.value);
  return {
    status: 'success',
    outputs: { passed, value: passed ? ctx.inputs.value : null },
  };
}

/* ─── Merge ───────────────────────────────────────────────────── */

export async function mergeNode(ctx) {
  const mode = ctx.config.mode;
  const inputs = ctx.inputs.inputs || [];
  let merged;
  switch (mode) {
    case 'append':
      merged = inputs.flat();
      break;
    case 'combine-by-key': {
      const key = ctx.config.keyPath;
      const map = new Map();
      for (const arr of inputs) {
        for (const item of arr) {
          const k = canonical(resolvePath(item, key));
          map.set(k, Object.assign({}, map.get(k) || {}, item));
        }
      }
      merged = [...map.values()];
      break;
    }
    case 'combine-by-position': {
      const maxLen = Math.max(0, ...inputs.map((a) => a.length));
      merged = [];
      for (let i = 0; i < maxLen; i++) {
        const row = {};
        for (let j = 0; j < inputs.length; j++) {
          if (inputs[j][i] !== undefined) Object.assign(row, inputs[j][i]);
        }
        merged.push(row);
      }
      break;
    }
    case 'multiplex': {
      merged = [[]];
      for (const arr of inputs) {
        const next = [];
        for (const acc of merged) for (const item of arr) next.push([...acc, item]);
        merged = next;
      }
      break;
    }
    case 'choose-branch':
      merged = inputs.find((a) => Array.isArray(a) && a.length > 0) || [];
      break;
    default:
      throw Object.assign(new Error(`unknown merge mode: ${mode}`), { code: 'CONFIG_INVALID' });
  }
  return { status: 'success', outputs: { merged } };
}

/* ─── Iteration / aggregation ─────────────────────────────────── */

export async function iteratorNode(ctx) {
  const arr = ctx.inputs.array;
  return {
    status: 'success',
    outputs: {
      items: arr.map((item, index) => ({ item, index, total: arr.length })),
      total: arr.length,
    },
  };
}

export async function aggregateArrayNode(ctx) {
  return { status: 'success', outputs: { array: ctx.inputs.items } };
}

export async function aggregateNumericNode(ctx) {
  const arr = ctx.inputs.items;
  const path = ctx.config.path;
  const values = arr
    .map((it) => resolvePath(it, path))
    .filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (values.length === 0) return { status: 'success', outputs: { result: null, count: 0 } };
  let result;
  switch (ctx.config.op) {
    case 'sum': result = values.reduce((a, b) => a + b, 0); break;
    case 'count': result = values.length; break;
    case 'avg': result = values.reduce((a, b) => a + b, 0) / values.length; break;
    case 'min': result = Math.min(...values); break;
    case 'max': result = Math.max(...values); break;
    default: throw Object.assign(new Error(`unknown op: ${ctx.config.op}`), { code: 'CONFIG_INVALID' });
  }
  return { status: 'success', outputs: { result, count: values.length } };
}

export async function aggregateTextNode(ctx) {
  const sep = ctx.config.separator ?? '';
  const path = ctx.config.path;
  const tmpl = ctx.config.template;
  const pieces = ctx.inputs.items.map((it) => {
    if (tmpl) return applyTemplate(tmpl, it);
    const v = resolvePath(it, path);
    return v === undefined || v === null ? '' : String(v);
  });
  return { status: 'success', outputs: { text: pieces.join(sep), count: pieces.length } };
}

export async function aggregateTableNode(ctx) {
  const cols = ctx.config.columns;
  const rows = ctx.inputs.items.map((it) =>
    cols.map((c) => {
      const v = resolvePath(it, c.path);
      return v === undefined ? null : v;
    })
  );
  return {
    status: 'success',
    outputs: {
      columns: cols.map((c) => c.label || c.path),
      rows,
      rowCount: rows.length,
    },
  };
}

/* ─── Batching / sorting / dedup ──────────────────────────────── */

export async function splitInBatchesNode(ctx) {
  const arr = ctx.inputs.array;
  const size = Math.max(1, ctx.config.batchSize | 0);
  const batch = arr.slice(0, size);
  const remaining = arr.slice(size);
  return {
    status: 'success',
    outputs: {
      batch,
      remaining,
      done: remaining.length === 0,
      batchSize: batch.length,
      remainingCount: remaining.length,
    },
  };
}

export async function sortNode(ctx) {
  const keys = ctx.config.keys;
  const out = ctx.inputs.array.slice();
  out.sort((a, b) => {
    for (const k of keys) {
      const av = resolvePath(a, k.path);
      const bv = resolvePath(b, k.path);
      const dir = k.direction === 'desc' ? -1 : 1;
      if (av === bv) continue;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: k.compare === 'natural' });
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
  return { status: 'success', outputs: { array: out } };
}

export async function limitNode(ctx) {
  const off = ctx.config.offset | 0;
  const n = Math.max(0, ctx.config.count | 0);
  const arr = ctx.inputs.array.slice(off, off + n);
  return { status: 'success', outputs: { array: arr, count: arr.length } };
}

export async function distinctNode(ctx) {
  const path = ctx.config.path;
  const seen = new Set();
  const out = [];
  for (const it of ctx.inputs.array) {
    const k = canonical(path ? resolvePath(it, path) : it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return { status: 'success', outputs: { array: out, dropped: ctx.inputs.array.length - out.length } };
}

export async function compareDatasetsNode(ctx) {
  const keyPath = ctx.config.keyPath;
  const a = ctx.inputs.left;
  const b = ctx.inputs.right;
  const aMap = new Map(a.map((x) => [canonical(resolvePath(x, keyPath)), x]));
  const bMap = new Map(b.map((x) => [canonical(resolvePath(x, keyPath)), x]));
  const addedIn2 = [];
  const removedFrom1 = [];
  const changed = [];
  const unchanged = [];
  for (const [k, bv] of bMap) {
    if (!aMap.has(k)) addedIn2.push(bv);
    else if (canonical(aMap.get(k)) !== canonical(bv)) changed.push({ before: aMap.get(k), after: bv });
    else unchanged.push(bv);
  }
  for (const [k, av] of aMap) if (!bMap.has(k)) removedFrom1.push(av);
  return { status: 'success', outputs: { addedIn2, removedFrom1, changed, unchanged } };
}

export async function repeaterNode(ctx) {
  const start = ctx.config.start ?? 0;
  const step = ctx.config.step ?? 1;
  const count = Math.max(0, ctx.config.count | 0);
  const items = Array.from({ length: count }, (_, i) => ({ i: start + i * step, index: i, total: count }));
  return { status: 'success', outputs: { items, count } };
}

export async function noopNode(ctx) {
  return { status: 'success', outputs: { value: ctx.inputs.value } };
}

/* ─── Termination + suspension ────────────────────────────────── */

export async function stopAndErrorNode(ctx) {
  const code = ctx.config.code || 'WORKFLOW_STOPPED';
  const message = ctx.config.message || 'Workflow stopped by stop-and-error';
  const details = ctx.config.details || {};
  // Engines that honor `terminate` short-circuit the run; otherwise we throw.
  const err = Object.assign(new Error(message), { code, details });
  if (typeof ctx.terminate === 'function') {
    return ctx.terminate({ code, message, details });
  }
  throw err;
}

export async function waitNode(ctx) {
  const mode = ctx.config.mode;
  if (typeof ctx.suspend !== 'function') {
    throw Object.assign(new Error('host does not support suspend'), { code: 'HOST_CAPABILITY_MISSING' });
  }
  switch (mode) {
    case 'duration': {
      const seconds = Math.min(86400, Math.max(0, ctx.config.seconds | 0));
      return ctx.suspend({ kind: 'duration', seconds });
    }
    case 'until': {
      return ctx.suspend({ kind: 'until', timestamp: ctx.config.timestamp });
    }
    case 'webhook': {
      return ctx.suspend({ kind: 'webhook', signatureHint: ctx.config.signatureHint });
    }
    default:
      throw Object.assign(new Error(`unknown wait mode: ${mode}`), { code: 'CONFIG_INVALID' });
  }
}

export async function subWorkflowInvokeNode(ctx) {
  if (typeof ctx.invokeSubWorkflow !== 'function') {
    throw Object.assign(new Error('host does not advertise core.subWorkflow contract'), { code: 'HOST_CAPABILITY_MISSING' });
  }
  const { workflowRef, inputs, runOptions } = ctx.inputs;
  const result = await ctx.invokeSubWorkflow({ workflowRef, inputs, runOptions });
  return { status: 'success', outputs: { result } };
}

/* ─── Error handlers ──────────────────────────────────────────── */

function buildErrorHandler(directive) {
  return async function errorHandler(ctx) {
    const upstreamError = ctx.inputs.error;
    const fallback = ctx.config.fallback;
    if (typeof ctx.applyErrorDirective === 'function') {
      return ctx.applyErrorDirective({ directive, fallback, upstreamError });
    }
    // Host without explicit directive support: emit a structured outcome.
    return {
      status: 'success',
      outputs: {
        directive,
        fallback: directive === 'resume' ? fallback : null,
        upstreamError,
      },
    };
  };
}

export const errorHandlerResume = buildErrorHandler('resume');
export const errorHandlerIgnore = buildErrorHandler('ignore');
export const errorHandlerBreak = buildErrorHandler('break');
export const errorHandlerCommit = buildErrorHandler('commit');
export const errorHandlerRollback = buildErrorHandler('rollback');

/* ─── Pack registry ───────────────────────────────────────────── */

export const nodes = {
  'core.flow.if': ifNode,
  'core.flow.switch': switchNode,
  'core.flow.router': routerNode,
  'core.flow.filter': filterNode,
  'core.flow.merge': mergeNode,
  'core.flow.iterator': iteratorNode,
  'core.flow.aggregate-array': aggregateArrayNode,
  'core.flow.aggregate-numeric': aggregateNumericNode,
  'core.flow.aggregate-text': aggregateTextNode,
  'core.flow.aggregate-table': aggregateTableNode,
  'core.flow.split-in-batches': splitInBatchesNode,
  'core.flow.sort': sortNode,
  'core.flow.limit': limitNode,
  'core.flow.distinct': distinctNode,
  'core.flow.compare-datasets': compareDatasetsNode,
  'core.flow.repeater': repeaterNode,
  'core.flow.noop': noopNode,
  'core.flow.stop-and-error': stopAndErrorNode,
  'core.flow.wait': waitNode,
  'core.flow.sub-workflow-invoke': subWorkflowInvokeNode,
  'core.flow.error-handler-resume': errorHandlerResume,
  'core.flow.error-handler-ignore': errorHandlerIgnore,
  'core.flow.error-handler-break': errorHandlerBreak,
  'core.flow.error-handler-commit': errorHandlerCommit,
  'core.flow.error-handler-rollback': errorHandlerRollback,
  // Reserved-typeId aliases (per spec/v1/node-packs.md §"Reserved Core OpenWOP node typeIds").
  // Same runtime behavior as their `core.flow.*` originals; preserves the reserved bare names so
  // workflows authored against the spec's reserved list still resolve to a concrete implementation.
  // NOT aliased: `core.merge` (reserved semantics = fan-in synchronization, distinct from core.flow.merge's array-combine).
  'core.conditional': ifNode,
  'core.delay': waitNode,
  'core.loop': iteratorNode,
  'core.parallel': routerNode,
};

export default nodes;
