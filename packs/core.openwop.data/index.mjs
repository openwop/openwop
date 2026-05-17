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

/* ─── v1.1 string utilities ─────────────────────────────────── */

export async function stringFormat(ctx) {
  // Mustache-style template substitution from inputs.context.
  const out = applyTemplate(ctx.inputs.template, ctx.inputs.context ?? {});
  return { status: 'success', outputs: { text: out } };
}

export async function stringRegexMatch(ctx) {
  const re = new RegExp(ctx.config.pattern, ctx.config.flags || '');
  const m = ctx.inputs.text.match(re);
  return { status: 'success', outputs: { matched: !!m, match: m?.[0] ?? null, groups: m?.slice(1) ?? [], named: m?.groups ?? {} } };
}

export async function stringRegexReplace(ctx) {
  const re = new RegExp(ctx.config.pattern, ctx.config.flags || 'g');
  const out = ctx.inputs.text.replace(re, ctx.config.replacement ?? '');
  return { status: 'success', outputs: { text: out } };
}

export async function stringRegexExtract(ctx) {
  const re = new RegExp(ctx.config.pattern, (ctx.config.flags || '').includes('g') ? ctx.config.flags : (ctx.config.flags || '') + 'g');
  const matches = [...ctx.inputs.text.matchAll(re)].map((m) => ({ match: m[0], groups: m.slice(1), named: m.groups ?? {}, index: m.index }));
  return { status: 'success', outputs: { matches, count: matches.length } };
}

export async function stringEncode(ctx) {
  const from = ctx.config.from || 'utf8';
  const to = ctx.config.to;
  const buf = Buffer.from(ctx.inputs.text, from);
  return { status: 'success', outputs: { text: buf.toString(to) } };
}

/* ─── v1.1 array utilities ──────────────────────────────────── */

export async function arraySort(ctx) {
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

export async function arrayUnique(ctx) {
  const path = ctx.config.path;
  const seen = new Set();
  const out = [];
  for (const it of ctx.inputs.array) {
    const k = JSON.stringify(path ? resolvePath(it, path) : it);
    if (seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return { status: 'success', outputs: { array: out, dropped: ctx.inputs.array.length - out.length } };
}

export async function arrayFlatten(ctx) {
  const depth = ctx.config.depth ?? 1;
  return { status: 'success', outputs: { array: ctx.inputs.array.flat(depth) } };
}

export async function arrayChunk(ctx) {
  const size = Math.max(1, ctx.config.size | 0);
  const out = [];
  for (let i = 0; i < ctx.inputs.array.length; i += size) out.push(ctx.inputs.array.slice(i, i + size));
  return { status: 'success', outputs: { chunks: out, chunkCount: out.length } };
}

export async function arrayZip(ctx) {
  const arrays = ctx.inputs.arrays;
  const maxLen = Math.max(0, ...arrays.map((a) => a.length));
  const out = [];
  for (let i = 0; i < maxLen; i++) out.push(arrays.map((a) => a[i]));
  return { status: 'success', outputs: { array: out } };
}

export async function arrayReduce(ctx) {
  const initial = ctx.config.initial;
  const op = ctx.config.op;
  const path = ctx.config.path;
  const vals = ctx.inputs.array.map((it) => resolvePath(it, path));
  let acc = initial;
  for (const v of vals) {
    switch (op) {
      case 'sum': acc = (acc ?? 0) + (Number(v) || 0); break;
      case 'product': acc = (acc ?? 1) * (Number(v) || 1); break;
      case 'concat': acc = (acc ?? '') + String(v ?? ''); break;
      case 'count': acc = (acc ?? 0) + (v !== undefined && v !== null ? 1 : 0); break;
      default: throw Object.assign(new Error(`unknown reduce op: ${op}`), { code: 'CONFIG_INVALID' });
    }
  }
  return { status: 'success', outputs: { result: acc } };
}

/* ─── v1.1 object utilities ─────────────────────────────────── */

export async function objectPick(ctx) {
  const keys = ctx.config.keys;
  const src = ctx.inputs.object;
  const out = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return { status: 'success', outputs: { object: out } };
}

export async function objectOmit(ctx) {
  const keys = new Set(ctx.config.keys);
  const out = {};
  for (const [k, v] of Object.entries(ctx.inputs.object)) if (!keys.has(k)) out[k] = v;
  return { status: 'success', outputs: { object: out } };
}

export async function objectRenameKeys(ctx) {
  const map = ctx.config.map;
  const out = {};
  for (const [k, v] of Object.entries(ctx.inputs.object)) {
    out[map[k] ?? k] = v;
  }
  return { status: 'success', outputs: { object: out } };
}

export async function objectGetPath(ctx) {
  const v = resolvePath(ctx.inputs.object, ctx.config.path);
  return { status: 'success', outputs: { value: v ?? null, present: v !== undefined } };
}

export async function objectSetPath(ctx) {
  const out = JSON.parse(JSON.stringify(ctx.inputs.object));
  const segs = ctx.config.path.split('.');
  let cur = out;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur[segs[i]] === undefined || cur[segs[i]] === null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = ctx.inputs.value;
  return { status: 'success', outputs: { object: out } };
}

/* ─── v1.1 JSON utilities ───────────────────────────────────── */

export async function jsonParse(ctx) {
  try {
    return { status: 'success', outputs: { value: JSON.parse(ctx.inputs.text), error: null } };
  } catch (e) {
    if (ctx.config.failOnError === false) return { status: 'success', outputs: { value: null, error: e.message } };
    throw Object.assign(new Error('JSON parse failed: ' + e.message), { code: 'JSON_PARSE_FAILED' });
  }
}

export async function jsonStringify(ctx) {
  const text = JSON.stringify(ctx.inputs.value, null, ctx.config.indent ?? 0);
  return { status: 'success', outputs: { text } };
}

function validateAgainstSchema(value, schema, path = '') {
  if (!schema) return [];
  const errs = [];
  if (schema.type) {
    const t = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const want = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!want.includes(t)) errs.push({ path, message: `expected ${want.join('|')}, got ${t}` });
  }
  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    errs.push({ path, message: 'not in enum' });
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errs.push({ path, message: 'does not match const' });
  }
  if (schema.required && typeof value === 'object' && value !== null) {
    for (const k of schema.required) {
      if (!(k in value)) errs.push({ path: path + '/' + k, message: 'missing required key' });
    }
  }
  if (schema.properties && typeof value === 'object' && value !== null) {
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (k in value) errs.push(...validateAgainstSchema(value[k], sub, path + '/' + k));
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((v, i) => errs.push(...validateAgainstSchema(v, schema.items, path + '/' + i)));
  }
  if (schema.additionalProperties === false && schema.properties && typeof value === 'object' && value !== null) {
    for (const k of Object.keys(value)) {
      if (!(k in schema.properties)) errs.push({ path: path + '/' + k, message: 'additional property not allowed' });
    }
  }
  return errs;
}

export async function jsonSchemaValidate(ctx) {
  const errs = validateAgainstSchema(ctx.inputs.value, ctx.inputs.schema);
  return { status: 'success', outputs: { valid: errs.length === 0, errors: errs } };
}

/* ─── v1.1 JSONPath (minimal dot/bracket subset) ────────────── */

function jsonPathQuery(value, path) {
  if (path === '$' || path === '') return [value];
  let tokens = path.replace(/^\$\.?/, '').split(/[.[\]]+/).filter(Boolean);
  let stack = [value];
  for (const t of tokens) {
    const next = [];
    for (const v of stack) {
      if (v === null || v === undefined) continue;
      if (t === '*') {
        if (Array.isArray(v)) next.push(...v);
        else if (typeof v === 'object') next.push(...Object.values(v));
      } else if (Array.isArray(v) && /^\d+$/.test(t)) {
        next.push(v[Number(t)]);
      } else {
        next.push(v[t]);
      }
    }
    stack = next;
  }
  return stack.filter((v) => v !== undefined);
}

export async function jsonpathQuery(ctx) {
  const results = jsonPathQuery(ctx.inputs.value, ctx.config.path);
  return { status: 'success', outputs: { results, count: results.length } };
}

/* ─── v1.1 CSV (minimal RFC 4180) ───────────────────────────── */

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQuote = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export async function csvParse(ctx) {
  const lines = ctx.inputs.text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { status: 'success', outputs: { rows: [], headers: [] } };
  const headers = ctx.config.hasHeader === false ? null : parseCsvLine(lines.shift());
  const rows = lines.map((l) => {
    const cols = parseCsvLine(l);
    if (!headers) return cols;
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i] ?? null; });
    return obj;
  });
  return { status: 'success', outputs: { rows, headers: headers ?? [] } };
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function csvStringify(ctx) {
  const rows = ctx.inputs.rows;
  const headers = ctx.config.headers ?? (rows.length > 0 && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : null);
  const lines = [];
  if (headers && ctx.config.emitHeader !== false) lines.push(headers.map(csvEscape).join(','));
  for (const r of rows) {
    const cells = Array.isArray(r) ? r : headers.map((h) => r[h]);
    lines.push(cells.map(csvEscape).join(','));
  }
  return { status: 'success', outputs: { text: lines.join('\n') + '\n' } };
}

/* ─── v1.1 datetime ─────────────────────────────────────────── */

export async function datetimeNow(ctx) {
  const tz = ctx.config.timezone || 'UTC';
  const now = new Date();
  const iso = now.toISOString();
  return { status: 'success', outputs: { iso, epochMs: now.getTime(), epochSec: Math.floor(now.getTime() / 1000), timezone: tz } };
}

export async function datetimeParse(ctx) {
  const d = new Date(ctx.inputs.text);
  if (isNaN(d.getTime())) return { status: 'success', outputs: { valid: false, iso: null, epochMs: null } };
  return { status: 'success', outputs: { valid: true, iso: d.toISOString(), epochMs: d.getTime() } };
}

export async function datetimeFormat(ctx) {
  const d = new Date(ctx.inputs.timestamp);
  const tz = ctx.config.timezone || 'UTC';
  const fmt = ctx.config.format || 'iso';
  if (fmt === 'iso') return { status: 'success', outputs: { text: d.toISOString() } };
  if (fmt === 'rfc2822') return { status: 'success', outputs: { text: d.toUTCString() } };
  if (fmt === 'epoch-ms') return { status: 'success', outputs: { text: String(d.getTime()) } };
  if (fmt === 'epoch-s') return { status: 'success', outputs: { text: String(Math.floor(d.getTime() / 1000)) } };
  // Locale fallback
  return { status: 'success', outputs: { text: new Intl.DateTimeFormat(ctx.config.locale || 'en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'medium' }).format(d) } };
}

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

export async function datetimeAdd(ctx) {
  const base = new Date(ctx.inputs.timestamp);
  const u = ctx.config.unit || 's';
  const out = new Date(base.getTime() + (Number(ctx.config.amount) || 0) * (UNIT_MS[u] || 1000));
  return { status: 'success', outputs: { iso: out.toISOString(), epochMs: out.getTime() } };
}

export async function datetimeDiff(ctx) {
  const a = new Date(ctx.inputs.a).getTime();
  const b = new Date(ctx.inputs.b).getTime();
  const diffMs = b - a;
  const u = ctx.config.unit || 's';
  const value = diffMs / (UNIT_MS[u] || 1000);
  return { status: 'success', outputs: { diff: value, diffMs, unit: u } };
}

export async function datetimeTimezone(ctx) {
  const d = new Date(ctx.inputs.timestamp);
  const tz = ctx.config.timezone;
  const text = new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short', timeStyle: 'long' }).format(d);
  return { status: 'success', outputs: { text, timezone: tz } };
}

/* ─── v1.1 number ───────────────────────────────────────────── */

export async function numberFormat(ctx) {
  const opts = {};
  if (ctx.config.minimumFractionDigits !== undefined) opts.minimumFractionDigits = ctx.config.minimumFractionDigits;
  if (ctx.config.maximumFractionDigits !== undefined) opts.maximumFractionDigits = ctx.config.maximumFractionDigits;
  if (ctx.config.style) opts.style = ctx.config.style;
  if (ctx.config.currency) opts.currency = ctx.config.currency;
  return { status: 'success', outputs: { text: new Intl.NumberFormat(ctx.config.locale || 'en-US', opts).format(ctx.inputs.value) } };
}

export async function numberRound(ctx) {
  const places = ctx.config.places ?? 0;
  const factor = 10 ** places;
  const mode = ctx.config.mode || 'half-up';
  let v = ctx.inputs.value * factor;
  if (mode === 'floor') v = Math.floor(v);
  else if (mode === 'ceil') v = Math.ceil(v);
  else if (mode === 'trunc') v = Math.trunc(v);
  else v = Math.round(v);
  return { status: 'success', outputs: { value: v / factor } };
}

export async function numberClamp(ctx) {
  const min = ctx.config.min ?? -Infinity;
  const max = ctx.config.max ?? Infinity;
  return { status: 'success', outputs: { value: Math.min(max, Math.max(min, ctx.inputs.value)) } };
}

/* ─── v1.1 uuid ─────────────────────────────────────────────── */

export async function uuid(ctx) {
  // node:crypto.randomUUID is v4.
  const { randomUUID } = await import('node:crypto');
  return { status: 'success', outputs: { uuid: randomUUID() } };
}

/* ─── Pack registry ───────────────────────────────────────────── */

export const nodes = {
  'core.openwop.data.string-case': stringCase,
  'core.openwop.data.string-split': stringSplit,
  'core.openwop.data.array-filter': arrayFilter,
  'core.openwop.data.array-map': arrayMap,
  'core.openwop.data.object-merge': objectMerge,
  // v1.1 strings
  'core.openwop.data.string-format': stringFormat,
  'core.openwop.data.string-regex-match': stringRegexMatch,
  'core.openwop.data.string-regex-replace': stringRegexReplace,
  'core.openwop.data.string-regex-extract': stringRegexExtract,
  'core.openwop.data.string-encode': stringEncode,
  // v1.1 arrays
  'core.openwop.data.array-sort': arraySort,
  'core.openwop.data.array-unique': arrayUnique,
  'core.openwop.data.array-flatten': arrayFlatten,
  'core.openwop.data.array-chunk': arrayChunk,
  'core.openwop.data.array-zip': arrayZip,
  'core.openwop.data.array-reduce': arrayReduce,
  // v1.1 objects
  'core.openwop.data.object-pick': objectPick,
  'core.openwop.data.object-omit': objectOmit,
  'core.openwop.data.object-rename-keys': objectRenameKeys,
  'core.openwop.data.object-get-path': objectGetPath,
  'core.openwop.data.object-set-path': objectSetPath,
  // v1.1 json
  'core.openwop.data.json-parse': jsonParse,
  'core.openwop.data.json-stringify': jsonStringify,
  'core.openwop.data.json-schema-validate': jsonSchemaValidate,
  'core.openwop.data.jsonpath-query': jsonpathQuery,
  // v1.1 csv
  'core.openwop.data.csv-parse': csvParse,
  'core.openwop.data.csv-stringify': csvStringify,
  // v1.1 datetime
  'core.openwop.data.datetime-now': datetimeNow,
  'core.openwop.data.datetime-parse': datetimeParse,
  'core.openwop.data.datetime-format': datetimeFormat,
  'core.openwop.data.datetime-add': datetimeAdd,
  'core.openwop.data.datetime-diff': datetimeDiff,
  'core.openwop.data.datetime-timezone': datetimeTimezone,
  // v1.1 number
  'core.openwop.data.number-format': numberFormat,
  'core.openwop.data.number-round': numberRound,
  'core.openwop.data.number-clamp': numberClamp,
  // v1.1 misc
  'core.openwop.data.uuid': uuid,
};

export default nodes;
