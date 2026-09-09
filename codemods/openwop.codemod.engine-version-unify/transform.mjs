/**
 * openwop.codemod.engine-version-unify — RFC 0172 §B axis 3 (migration row
 * C5.1): `engineVersion` is an integer at the discovery root and a string on
 * run-event, run-snapshot and three payload carriers in v1. v2 is integer
 * everywhere. This transform rewrites any `engineVersion` string that is the
 * decimal rendering of a non-negative integer (`version-negotiation.md`
 * §"engineVersion axis is split") to that integer, at any depth of a run
 * snapshot, a run event, or an array of either.
 *
 * Refuses a string that is not `^(0|[1-9][0-9]*)$` — such a value was never
 * the rendering the v1 rule prescribed and the codemod cannot know what it
 * meant. Integers pass through. Idempotent. Pure.
 */
export const id = 'openwop.codemod.engine-version-unify';
export const inputSchema = 'schemas/run-snapshot.schema.json | schemas/run-event.schema.json';

const INT = /^(0|[1-9][0-9]*)$/;

function walk(v, path) {
  if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === 'engineVersion') {
        if (typeof val === 'number' && Number.isInteger(val) && val >= 0) out[k] = val;
        else if (typeof val === 'string' && INT.test(val)) out[k] = Number.parseInt(val, 10);
        else throw new Error(`${id}: ${path}.engineVersion is ${JSON.stringify(val)}, not the decimal rendering of a non-negative integer; refusing`);
      } else out[k] = walk(val, `${path}.${k}`);
    }
    return out;
  }
  return v;
}

export function transform(doc) {
  if (doc === null || typeof doc !== 'object') throw new TypeError(`${id}: input must be a run snapshot, a run event, or an array of them`);
  return walk(doc, '$');
}
