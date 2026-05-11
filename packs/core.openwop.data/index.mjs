/**
 * core.openwop.data — spec-canonical data-utility pack runtime.
 *
 * Five pure, replay-safe nodes for common workflow data
 * transformations: string-case, string-split, array-filter,
 * array-map (with template substitution), and shallow object-merge.
 *
 * All nodes:
 *   - Pure functions of (config, inputs) — no side effects
 *   - Replay-safe by construction
 *   - Declared `cacheable` in pack.json; engine MAY cache results
 *   - Zero npm deps; Node 20+
 *
 * @see spec/v1/node-packs.md
 * @see docs/PACKS-MVP-PLAN.md
 */

const TEMPLATE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

/**
 * Resolve a dot-notation path against an object/array. Empty path
 * returns the object itself. Missing intermediate keys return
 * undefined.
 */
function resolvePath(obj, path) {
  if (!path) return obj;
  const segments = path.split('.');
  let cur = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Substitute `{{key}}` placeholders in a template string from an
 * object's keys (dot-notation supported). Missing keys produce empty
 * strings. Non-string values are JSON-stringified.
 */
function applyTemplate(template, ctx) {
  return template.replace(TEMPLATE_RE, (_match, key) => {
    const v = resolvePath(ctx, key);
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  });
}

/**
 * Naive title case: first letter of each whitespace-delimited word
 * uppercased, rest lowercased. Locale-independent.
 */
function toTitleCase(s) {
  return s.replace(/\S+/g, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
}

/**
 * Split with Python-style maxsplit semantics: the LAST piece carries
 * the un-split remainder rather than discarding (JS default discards).
 */
function pythonStyleSplit(text, sep, limit) {
  if (limit === undefined) return text.split(sep);
  if (sep === '') {
    // empty-sep: split per character, with the last piece carrying the rest
    const parts = [];
    let i = 0;
    while (parts.length < limit - 1 && i < text.length) {
      parts.push(text[i]);
      i++;
    }
    if (i < text.length) parts.push(text.slice(i));
    return parts;
  }
  const parts = [];
  let cursor = 0;
  while (parts.length < limit - 1) {
    const idx = text.indexOf(sep, cursor);
    if (idx === -1) break;
    parts.push(text.slice(cursor, idx));
    cursor = idx + sep.length;
  }
  parts.push(text.slice(cursor));
  return parts;
}

/* ─── Node implementations ────────────────────────────────────── */

export async function stringCase(ctx) {
  const mode = ctx.config.mode;
  const text = ctx.inputs.text;
  let out;
  switch (mode) {
    case 'upper':
      out = text.toUpperCase();
      break;
    case 'lower':
      out = text.toLowerCase();
      break;
    case 'title':
      out = toTitleCase(text);
      break;
    default:
      // Schema rejects this; defensive runtime path.
      throw Object.assign(new Error(`unknown mode: ${mode}`), { code: 'CONFIG_INVALID' });
  }
  return { status: 'success', outputs: { text: out } };
}

export async function stringSplit(ctx) {
  const text = ctx.inputs.text;
  const sep = ctx.config.separator;
  const limit = ctx.config.limit;
  const parts = pythonStyleSplit(text, sep, limit);
  return { status: 'success', outputs: { parts } };
}

export async function arrayFilter(ctx) {
  const array = ctx.inputs.array;
  const { path, equals } = ctx.config;
  // Strict-equality via JSON canonicalization handles primitives + null.
  const equalsJson = JSON.stringify(equals);
  const filtered = array.filter((el) => {
    const v = resolvePath(el, path);
    return JSON.stringify(v) === equalsJson;
  });
  return {
    status: 'success',
    outputs: {
      array: filtered,
      matched: filtered.length,
      total: array.length,
    },
  };
}

export async function arrayMap(ctx) {
  const array = ctx.inputs.array;
  const template = ctx.config.template;
  const mapped = array.map((el) => applyTemplate(template, el));
  return { status: 'success', outputs: { array: mapped } };
}

export async function objectMerge(ctx) {
  const { base, override } = ctx.inputs;
  // Shallow merge — Object.assign already implements "later wins."
  // Create a fresh object so callers can't mutate the inputs.
  const merged = Object.assign({}, base, override);
  return { status: 'success', outputs: { merged } };
}

/* ─── Pack registry ───────────────────────────────────────────── */

export const nodes = {
  'core.openwop.data.string-case': stringCase,
  'core.openwop.data.string-split': stringSplit,
  'core.openwop.data.array-filter': arrayFilter,
  'core.openwop.data.array-map': arrayMap,
  'core.openwop.data.object-merge': objectMerge,
};

export default nodes;
