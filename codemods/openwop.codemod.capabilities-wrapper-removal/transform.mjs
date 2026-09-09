/**
 * openwop.codemod.capabilities-wrapper-removal — remove the deprecated
 * top-level `capabilities` wrapper from a /.well-known/openwop document
 * (spec/v1/deprecations.json `openwop.deprecation.capabilities-wrapper`,
 * RFC 0073; removed at 2.0 by RFC 0167 child C.2).
 *
 * Pure: JSON in, JSON out, no I/O. Contract (scripts/check-codemods.mjs):
 *   - a document with no wrapper is returned byte-identical (negative control);
 *   - a wrapper whose every family equals its root twin is deleted;
 *   - a wrapper that DISAGREES with the root is refused (throws) — a codemod
 *     never guesses which of two shapes is the truth (Axiom 2);
 *   - idempotent: transform(transform(x)) deep-equals transform(x).
 */
export const id = 'openwop.codemod.capabilities-wrapper-removal';
export const inputSchema = 'schemas/capabilities.schema.json';

function deepEqual(a, b) {
  return JSON.stringify(sort(a)) === JSON.stringify(sort(b));
}
function sort(v) {
  if (Array.isArray(v)) return v.map(sort);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
  return v;
}

export function transform(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${id}: input must be a discovery document object`);
  const wrapper = doc.capabilities;
  if (wrapper === undefined) return doc;
  if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper)) throw new TypeError(`${id}: \`capabilities\` is present but not an object; refusing`);
  const disagreements = Object.keys(wrapper).filter((k) => !(k in doc) || !deepEqual(doc[k], wrapper[k]));
  if (disagreements.length > 0) {
    throw new Error(`${id}: wrapper disagrees with the document root for ${disagreements.join(', ')}; refusing to choose a side — fix the host, then re-run`);
  }
  const { capabilities: _dropped, ...rest } = doc;
  return rest;
}
