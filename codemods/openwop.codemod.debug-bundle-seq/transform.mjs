/**
 * openwop.codemod.debug-bundle-seq — RFC 0171 row C4.7: the debug bundle's
 * legacy `seq` event field becomes `sequence`. Renames at any depth inside an
 * `events` array; refuses an event that carries both with different values;
 * a bundle with only `sequence` is unchanged. Idempotent. Pure.
 */
export const id = 'openwop.codemod.debug-bundle-seq';
export const inputSchema = 'schemas/debug-bundle.schema.json';
function fix(ev, path) {
  if (!ev || typeof ev !== 'object' || !('seq' in ev)) return ev;
  if ('sequence' in ev && ev.sequence !== ev.seq) throw new Error(`${id}: ${path} carries seq=${ev.seq} and sequence=${ev.sequence}; refusing to choose`);
  const { seq, ...rest } = ev; return { ...rest, sequence: seq };
}
function walk(v, path) {
  if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
  if (v && typeof v === 'object') { const out = {}; for (const [k, val] of Object.entries(v)) out[k] = k === 'events' && Array.isArray(val) ? val.map((e, i) => walk(fix(e, `${path}.events[${i}]`), `${path}.events[${i}]`)) : walk(val, `${path}.${k}`); return out; }
  return v;
}
export function transform(doc) {
  if (doc === null || typeof doc !== 'object') throw new TypeError(`${id}: input must be a debug bundle object`);
  return walk(doc, '$');
}
